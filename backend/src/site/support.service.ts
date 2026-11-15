import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { SiteService } from "./site.service";
import type { CreateSupportDto, GuestSupportLookupDto, SupportListDto, UpdateSupportDto } from "./site.dto";

const publicFields = { id: true, category: true, subject: true, message: true, answer: true, status: true, createdAt: true, answeredAt: true, expiresAt: true } satisfies Prisma.SupportTicketSelect;
const adminFields = { ...publicFields, userId: true, contactName: true, email: true, internalNote: true, revision: true, privacyConsentedAt: true, privacyDocument: { select: { id: true, title: true, version: true } } } satisfies Prisma.SupportTicketSelect;
const keyHash = (key: string) => createHash("sha256").update(key).digest("hex");

@Injectable()
export class SupportService {
  constructor(private readonly prisma: PrismaService, private readonly site: SiteService) {}

  async create(dto: CreateSupportDto, userId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const policy = await this.site.inquiryConsent(dto, tx);
      const { info } = await this.site.settings(tx);
      const user = userId ? await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, email: true } }) : null;
      const guestKey = user ? null : randomBytes(32).toString("hex");
      const ticket = await tx.supportTicket.create({ data: {
        userId, guestKeyHash: guestKey ? keyHash(guestKey) : null, contactName: user?.name ?? dto.contactName.trim(), email: user?.email ?? dto.email.trim().toLowerCase(),
        category: dto.category, subject: dto.subject.trim(), message: dto.message.trim(), privacyDocumentId: policy.id,
        expiresAt: new Date(Date.now() + info.supportRetentionDays * 86400000)
      }, select: { id: true, createdAt: true, expiresAt: true } });
      return { ...ticket, guestKey };
    });
  }

  async lookup(dto: GuestSupportLookupDto) {
    const ticket = await this.prisma.supportTicket.findFirst({ where: { id: dto.ticketId, userId: null, guestKeyHash: keyHash(dto.key), expiresAt: { gt: new Date() } }, select: publicFields });
    if (!ticket) throw new NotFoundException("조회 정보가 올바르지 않거나 문의 보관기간이 지났습니다.");
    return ticket;
  }

  async mine(userId: string, query: SupportListDto) {
    const where: Prisma.SupportTicketWhereInput = { userId, expiresAt: { gt: new Date() } };
    const page = query.page ?? 1;
    const [items, total] = await Promise.all([
      this.prisma.supportTicket.findMany({ where, select: publicFields, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * 20, take: 20 }),
      this.prisma.supportTicket.count({ where })
    ]);
    return { items, total, page, pageSize: 20 };
  }

  async list(query: SupportListDto) {
    const where: Prisma.SupportTicketWhereInput = { expiresAt: { gt: new Date() }, ...(query.status ? { status: query.status } : {}) };
    const page = query.page ?? 1;
    const [items, total] = await Promise.all([
      this.prisma.supportTicket.findMany({ where, select: adminFields, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 30, skip: (page - 1) * 30 }),
      this.prisma.supportTicket.count({ where })
    ]);
    return { items, total, page, pageSize: 30 };
  }

  async detail(id: string) {
    const ticket = await this.prisma.supportTicket.findFirst({ where: { id, expiresAt: { gt: new Date() } }, select: adminFields });
    if (!ticket) throw new NotFoundException("문의를 찾을 수 없습니다.");
    return ticket;
  }

  async update(id: string, dto: UpdateSupportDto, actorId: string) {
    const answer = dto.answer.trim();
    if (dto.status === "ANSWERED" && !answer) throw new BadRequestException("답변 완료 상태에는 답변 내용이 필요합니다.");
    await this.prisma.$transaction(async (tx) => {
      const ticket = await tx.supportTicket.findFirst({ where: { id, expiresAt: { gt: new Date() } } });
      if (!ticket) throw new NotFoundException("문의를 찾을 수 없습니다.");
      const answerChanged = Boolean(answer && answer !== ticket.answer);
      const result = await tx.supportTicket.updateMany({ where: { id, revision: dto.revision }, data: { status: dto.status, answer: answer || null, internalNote: dto.internalNote.trim() || null, revision: { increment: 1 }, answeredAt: answerChanged ? new Date() : answer ? ticket.answeredAt : null } });
      if (result.count !== 1) throw new ConflictException("다른 운영자가 수정한 문의입니다. 새로고침 후 다시 저장해 주세요.");
      if (answerChanged) {
        // 주소 오입력 시에도 문의 원문·답변을 메일에 노출하지 않는다. 조회에는 로그인 또는 비회원 키가 필요하다.
        await tx.emailDelivery.create({ data: {
          userId: ticket.userId, toEmail: ticket.email, subject: "[고객센터] 문의 답변 안내", templateKey: "site.support_reply", status: "QUEUED",
          bodyText: `운영팀 답변이 등록되었습니다.\n접수번호: ${ticket.id}\n\n사이트 고객센터에서 로그인 후 내 문의를 확인하거나, 접수 시 발급받은 비회원 조회 키로 확인해 주세요.\n본인이 문의하지 않았다면 이 안내를 무시해 주세요.`,
          metadata: { ticketId: ticket.id, transactional: true }
        } });
      }
      await this.site.audit(tx, actorId, "site.support.update", "SupportTicket", id);
    });
    return this.detail(id);
  }

  async purgeExpired() {
    // Worker가 반복 실행해도 안전한 유한 배치. 본문과 연락처가 있는 문의 및 관련 발송 큐를 함께 파기한다.
    const rows = await this.prisma.supportTicket.findMany({ where: { expiresAt: { lte: new Date() } }, select: { id: true }, take: 500 });
    if (!rows.length) return { deleted: 0 };
    const ids = rows.map((row) => row.id);
    return this.prisma.$transaction(async (tx) => {
      await tx.emailDelivery.deleteMany({ where: { templateKey: "site.support_reply", OR: ids.map((id) => ({ metadata: { path: ["ticketId"], equals: id } })) } });
      const result = await tx.supportTicket.deleteMany({ where: { id: { in: ids }, expiresAt: { lte: new Date() } } });
      return { deleted: result.count };
    });
  }
}
