import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { SiteService } from "../site/site.service";
import { InquiryStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ProductionsService } from "../productions/productions.service";
import { checklistPhaseCreateDataFromTemplates } from "../checklist/checklist-template-seed";
import type { RequestUser } from "../common/types/request-user";
import { assertInquiryRevision, inquirySource, requireInquiryText } from "./inquiry-domain";
import { AdminInquiryListQueryDto, ConvertInquiryDto, CreateInquiryDto, LinkInquiryDto, ReplyInquiryDto, UpdateInquiryDto } from "./dto";

type Tx = Prisma.TransactionClient;
const relation = {
  handledBy: { select: { id: true, name: true } },
  production: { select: { id: true, title: true, deletedAt: true, archived: true } }
} satisfies Prisma.InquiryInclude;
const detail = {
  ...relation,
  planningMemos: { orderBy: { createdAt: "desc" as const }, take: 100, select: { id: true, body: true, createdAt: true, author: { select: { id: true, name: true } } } },
  messages: { orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }], take: 200 }
} satisfies Prisma.InquiryInclude;

@Injectable()
export class InquiriesService {
  constructor(private readonly prisma: PrismaService, private readonly productionsService: ProductionsService, private readonly site: SiteService) {}

  async create(dto: CreateInquiryDto) {
    const orgName = requireInquiryText(dto.orgName, "기관명");
    const contactName = requireInquiryText(dto.contactName, "담당자 이름");
    const message = requireInquiryText(dto.message, "문의 내용");
    return this.prisma.$transaction(async (tx) => {
      const policy = await this.site.inquiryConsent(dto, tx);
      const inquiry = await tx.inquiry.create({ data: {
        privacyDocumentId: policy.id, privacyConsentedAt: new Date(), orgName, contactName,
        email: dto.email.trim().toLowerCase(), phone: dto.phone?.trim() || null,
        preferredTiming: dto.preferredTiming?.trim() || null, audience: dto.audience?.trim() || null,
        message, source: inquirySource(dto)
      }, select: { id: true, createdAt: true, email: true } });
      await tx.emailDelivery.create({ data: { toEmail: inquiry.email, subject: "공연 신청 접수 안내", templateKey: "inquiry.receipt", status: "QUEUED",
        bodyText: `공연 신청이 접수되었습니다.\n접수번호: ${inquiry.id}\n\n사이트의 ‘공연 신청 확인’에서 접수번호와 등록 이메일을 입력한 뒤 인증번호로 진행 상황을 확인할 수 있습니다.\n본인이 신청하지 않았다면 이 안내를 무시해 주세요.`, metadata: { inquiryId: inquiry.id, transactional: true } } });
      return { id: inquiry.id, createdAt: inquiry.createdAt, lookupPath: "/inquiries/lookup", receiptDelivery: "QUEUED" };
    });
  }

  async listForAdmin(query: AdminInquiryListQueryDto) {
    const search: Prisma.InquiryWhereInput = { ...(query.productionId ? { productionId: query.productionId } : {}), ...(query.q?.trim() ? { OR: [
      { orgName: { contains: query.q.trim(), mode: "insensitive" } }, { contactName: { contains: query.q.trim(), mode: "insensitive" } }, { email: { contains: query.q.trim(), mode: "insensitive" } }
    ] } : {}) };
    const where = { ...search, ...(query.status ? { status: query.status } : {}) };
    const take = query.take ?? 30; const page = query.page ?? 1;
    const [items, total, statusCounts] = await Promise.all([
      this.prisma.inquiry.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take, skip: (page - 1) * take, include: relation }),
      this.prisma.inquiry.count({ where }),
      this.prisma.inquiry.groupBy({ by: ["status"], where: search, _count: { _all: true } })
    ]);
    return { items, total, page, pageSize: take, counts: Object.fromEntries(statusCounts.map((row) => [row.status, row._count._all])) };
  }
  async getForAdmin(id: string) {
    const inquiry = await this.prisma.inquiry.findUnique({ where: { id }, include: detail });
    if (!inquiry) throw new NotFoundException("신청을 찾을 수 없습니다.");
    return { ...inquiry, messages: inquiry.messages?.slice().reverse() ?? [] };
  }

  async update(id: string, dto: UpdateInquiryDto, user: RequestUser) {
    await this.transact(async (tx) => {
      const inquiry = await this.lock(tx, id, user);
      assertInquiryRevision(inquiry.revision, dto.revision);
      if (dto.status === "CONVERTED" && !inquiry.productionId) throw new BadRequestException("공연 연결 메뉴에서 실제 공연을 연결해 주세요.");
      await tx.inquiry.update({ where: { id }, data: { status: dto.status ?? undefined, adminNote: dto.adminNote === undefined ? undefined : dto.adminNote?.trim() || null,
        planningNote: dto.planningNote === undefined ? undefined : dto.planningNote?.trim() || null, handledById: user.id, revision: { increment: 1 } } });
      await this.log(tx, user, id, "inquiry.update", { status: dto.status ?? inquiry.status });
    });
    return this.getForAdmin(id);
  }

  async reply(id: string, dto: ReplyInquiryDto, user: RequestUser) {
    const body = requireInquiryText(dto.body, "답변 내용");
    await this.transact(async (tx) => {
      const inquiry = await this.lock(tx, id, user);
      assertInquiryRevision(inquiry.revision, dto.revision);
      await tx.inquiryMessage.create({ data: { inquiryId: id, authorKind: "OPERATOR", authorId: user.id, body, public: true } });
      await tx.inquiry.update({ where: { id }, data: { revision: { increment: 1 }, handledById: user.id, status: inquiry.productionId ? inquiry.status : "REPLIED" } });
      // A mistyped/unverified email must never receive the confidential answer or request body.
      await tx.emailDelivery.create({ data: { toEmail: inquiry.email, subject: "공연 신청 답변 안내", templateKey: "inquiry.reply", status: "QUEUED",
        bodyText: `운영팀의 답변이 등록되었습니다.\n접수번호: ${id}\n사이트의 ‘공연 신청 확인’에서 이메일 인증 후 답변을 확인해 주세요.`, metadata: { inquiryId: id, transactional: true } } });
      await this.log(tx, user, id, "inquiry.reply", { notification: "QUEUED" });
    });
    return this.getForAdmin(id);
  }

  async convertToProduction(id: string, dto: ConvertInquiryDto, user: RequestUser) {
    return this.transact(async (tx) => {
      const inquiry = await this.lock(tx, id, user);
      if (inquiry.productionId) {
        const existing = await tx.production.findUnique({ where: { id: inquiry.productionId }, select: { id: true, title: true, deletedAt: true, archived: true } });
        if (!existing || existing.deletedAt || existing.archived) throw new ConflictException("연결 공연이 보관 또는 삭제 상태입니다. 먼저 공연 상태를 확인해 주세요.");
        return { inquiry, production: { id: existing.id, title: existing.title }, alreadyLinked: true };
      }
      assertInquiryRevision(inquiry.revision, dto.revision);
      if (inquiry.status === "CLOSED") throw new ConflictException("종료한 상담은 먼저 다시 열어 주세요.");
      const actor = await tx.user.findUniqueOrThrow({ where: { id: user.id }, select: { organizationId: true } });
      const organizationId = actor.organizationId ?? (await tx.organization.upsert({ where: { id: "org_default" }, update: {}, create: { id: "org_default", name: "아트브릿지 운영단체" } })).id;
      const title = dto.title?.trim() || `${inquiry.orgName} 공연`;
      const phases = await checklistPhaseCreateDataFromTemplates(tx);
      // Personal contact information and confidential application text remain in the inquiry.
      const production = await tx.production.create({ data: { title, organizationId, visibility: "DRAFT",
        memberships: { create: { userId: user.id, primaryRole: "PRODUCER", roles: { create: { role: "PRODUCER" } } } },
        checklistPhases: { create: phases }
      }, select: { id: true, title: true } });
      const updated = await this.connect(tx, inquiry.id, production, user);
      await tx.activityLog.create({ data: { productionId: production.id, organizationId, actorId: user.id, action: "production.create", entity: "Production", entityId: production.id, reason: "공연 신청 연결", afterJson: { inquiryId: id } } });
      return { inquiry: updated, production, alreadyLinked: false };
    });
  }

  async link(id: string, dto: LinkInquiryDto, user: RequestUser) {
    await this.transact(async (tx) => {
      // Lock the target production before the inquiry, matching lifecycle lock order.
      await tx.$queryRaw`SELECT id FROM productions WHERE id = ${dto.productionId} FOR UPDATE`;
      const inquiry = await this.lock(tx, id, user);
      if (inquiry.productionId === dto.productionId) return;
      assertInquiryRevision(inquiry.revision, dto.revision);
      if (inquiry.productionId) throw new ConflictException("이미 연결된 공연이 있습니다. 기존 연결을 먼저 확인해 주세요.");
      const production = await tx.production.findUnique({ where: { id: dto.productionId }, select: { id: true, title: true, deletedAt: true, archived: true } });
      if (!production || production.deletedAt || production.archived) throw new BadRequestException("진행 가능한 공연을 선택해 주세요. 보관·삭제된 공연은 연결할 수 없습니다.");
      if (inquiry.status === "CLOSED") throw new ConflictException("종료한 상담은 먼저 다시 열어 주세요.");
      await this.connect(tx, id, production, user);
    });
    return this.getForAdmin(id);
  }
  private async connect(tx: Tx, id: string, production: { id: string; title: string }, user: RequestUser) {
    const updated = await tx.inquiry.update({ where: { id }, data: { productionId: production.id,
      productionSnapshot: { id: production.id, title: production.title, linkedAt: new Date().toISOString() }, status: "CONVERTED", handledById: user.id, revision: { increment: 1 } } });
    await tx.inquiryMessage.create({ data: { inquiryId: id, authorKind: "SYSTEM", authorId: user.id, public: false, body: `공연 연결: ${production.title}` } });
    await this.log(tx, user, id, "inquiry.link", { productionId: production.id });
    return updated;
  }
  private async lock(tx: Tx, id: string, user: RequestUser) {
    if (user.platformRole !== "SUPER_ADMIN") throw new ForbiddenException("운영자 권한이 필요합니다.");
    await tx.$queryRaw`SELECT id FROM inquiries WHERE id = ${id} FOR UPDATE`;
    const inquiry = await tx.inquiry.findUnique({ where: { id } });
    if (!inquiry) throw new NotFoundException("신청을 찾을 수 없습니다.");
    return inquiry;
  }
  private async log(tx: Tx, user: RequestUser, id: string, action: string, after: Prisma.InputJsonValue) {
    await tx.activityLog.create({ data: { actorId: user.id, action, entity: "Inquiry", entityId: id, afterJson: after } });
  }
  private async transact<T>(operation: (tx: Tx) => Promise<T>): Promise<T> {
    try { return await this.prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20000 }); }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2002"].includes(error.code)) throw new ConflictException("동시에 변경된 정보나 같은 공연명이 있습니다. 최신 정보를 확인한 뒤 다시 시도해 주세요.");
      throw error;
    }
  }
}
