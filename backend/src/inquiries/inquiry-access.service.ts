import { BadRequestException, Injectable, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { APPLICANT_STATUS_LABELS } from "./inquiry-domain";
import { mailReadiness } from "../mail/mail-dispatch-policy";
import type { ApplicantMessageDto, RequestInquiryAccessDto, VerifyInquiryAccessDto } from "./inquiry-access.dto";

type Tx = Prisma.TransactionClient;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const badCode = () => new UnauthorizedException("인증번호가 올바르지 않거나 만료되었습니다. 새 인증번호를 요청해 주세요.");

@Injectable()
export class InquiryAccessService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}
  private codeHash(id: string, code: string) {
    const secret = this.config.get<string>("JWT_ACCESS_SECRET");
    if (!secret) throw new ServiceUnavailableException("현재 인증을 처리할 수 없습니다.");
    return createHmac("sha256", secret).update(`inquiry-email-code:${id}:${code}`).digest("hex");
  }

  async request(dto: RequestInquiryAccessDto) {
    if (!mailReadiness(this.config).ready) throw new ServiceUnavailableException("현재 이메일 인증을 이용할 수 없습니다. 잠시 후 다시 시도해 주세요.");
    const fallbackId = randomUUID();
    const result = await this.prisma.$transaction(async (tx) => {
      const inquiry = await tx.inquiry.findFirst({ where: { id: dto.inquiryId, email: { equals: dto.email, mode: "insensitive" } }, select: { id: true, email: true } });
      if (!inquiry) return fallbackId;
      await tx.$queryRaw`SELECT id FROM inquiries WHERE id = ${inquiry.id} FOR UPDATE`;
      const now = new Date();
      const latest = await tx.inquiryAccess.findFirst({ where: { inquiryId: inquiry.id, email: inquiry.email }, orderBy: { createdAt: "desc" } });
      // Return an indistinguishable fresh opaque ID on throttled requests too;
      // reusing the real ID would disclose a matching inquiry/email pair on two calls.
      if (latest && !latest.consumedAt && latest.createdAt.getTime() > now.getTime() - 60000) return fallbackId;
      const count = await tx.inquiryAccess.count({ where: { inquiryId: inquiry.id, createdAt: { gt: new Date(now.getTime() - 3600000) } } });
      if (count >= 10) return fallbackId;
      const id = randomUUID(); const code = String(randomInt(0, 1000000)).padStart(6, "0");
      await tx.inquiryAccess.updateMany({ where: { inquiryId: inquiry.id, consumedAt: null }, data: { consumedAt: now } });
      await tx.inquiryAccess.create({ data: { id, inquiryId: inquiry.id, email: inquiry.email, codeHash: this.codeHash(id, code), expiresAt: new Date(now.getTime() + 10 * 60000) } });
      await tx.emailDelivery.create({ data: { toEmail: inquiry.email, subject: "공연 신청 확인 인증번호", templateKey: "inquiry.access_code", status: "QUEUED",
        bodyText: `공연 신청 확인 인증번호: ${code}\n\n10분 안에 입력해 주세요. 타인에게 공유하지 마세요.\n본인이 요청하지 않았다면 이 메일을 무시해 주세요.`,
        metadata: { inquiryId: inquiry.id, challengeId: id, transactional: true, expiresAt: new Date(now.getTime() + 10 * 60000).toISOString() } } });
      return id;
    });
    // No application existence, recipient identity or code is returned.
    return { challengeId: result, message: "입력한 신청 정보가 일치하면 등록 이메일로 인증번호를 안내합니다.", retryAfterSeconds: 60 };
  }

  async verify(dto: VerifyInquiryAccessDto) {
    const token = randomBytes(32).toString("hex");
    const sessionExpiresAt = new Date(Date.now() + 30 * 60000);
    const ok = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM inquiry_accesses WHERE id = ${dto.challengeId} FOR UPDATE`;
      const grant = await tx.inquiryAccess.findUnique({ where: { id: dto.challengeId }, include: { inquiry: { select: { email: true } } } });
      if (!grant || grant.consumedAt || grant.expiresAt.getTime() <= Date.now() || grant.attempts >= 5 || grant.email !== grant.inquiry.email) return false;
      const expected = Buffer.from(grant.codeHash, "hex"); const actual = Buffer.from(this.codeHash(grant.id, dto.code), "hex");
      const valid = expected.length === actual.length && timingSafeEqual(expected, actual);
      // Wrong attempts commit before the outer method reports failure.
      await tx.inquiryAccess.update({ where: { id: grant.id }, data: { attempts: { increment: 1 }, ...(valid ? { consumedAt: new Date(), sessionHash: sha(token), sessionExpiresAt } : {}) } });
      return valid;
    });
    if (!ok) throw badCode();
    return { accessToken: token, sessionExpiresAt };
  }

  private async grant(token: string, db: Tx = this.prisma) {
    if (!/^[a-f0-9]{64}$/.test(token)) throw badCode();
    const grant = await db.inquiryAccess.findUnique({ where: { sessionHash: sha(token) }, include: { inquiry: { select: { email: true } } } });
    if (!grant || !grant.sessionExpiresAt || grant.sessionExpiresAt.getTime() <= Date.now() || grant.email !== grant.inquiry.email) throw new UnauthorizedException("조회 시간이 만료되었습니다. 이메일 인증을 다시 진행해 주세요.");
    return grant;
  }
  async read(token: string) {
    const grant = await this.grant(token);
    const inquiry = await this.prisma.inquiry.findUniqueOrThrow({ where: { id: grant.inquiryId }, select: {
      id: true, orgName: true, contactName: true, email: true, phone: true, preferredTiming: true, audience: true, message: true,
      status: true, createdAt: true, updatedAt: true,
      messages: { where: { public: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100, select: { id: true, authorKind: true, body: true, createdAt: true } }
    } });
    return { ...inquiry, statusLabel: APPLICANT_STATUS_LABELS[inquiry.status], messages: inquiry.messages.reverse(), sessionExpiresAt: grant.sessionExpiresAt };
  }
  async message(dto: ApplicantMessageDto) {
    await this.prisma.$transaction(async (tx) => {
      const grant = await this.grant(dto.accessToken, tx);
      await tx.$queryRaw`SELECT id FROM inquiries WHERE id = ${grant.inquiryId} FOR UPDATE`;
      const inquiry = await tx.inquiry.findUniqueOrThrow({ where: { id: grant.inquiryId }, select: { status: true } });
      if (inquiry.status === "CLOSED") throw new BadRequestException("종료된 상담입니다. 새 공연 신청을 접수해 주세요.");
      await tx.inquiryMessage.create({ data: { inquiryId: grant.inquiryId, authorKind: "APPLICANT", body: dto.body.trim(), public: true } });
      await tx.inquiry.update({ where: { id: grant.inquiryId }, data: { revision: { increment: 1 }, status: inquiry.status === "CONVERTED" ? "CONVERTED" : "IN_REVIEW" } });
    });
    return this.read(dto.accessToken);
  }
  async logout(token: string) {
    await this.prisma.inquiryAccess.updateMany({ where: { sessionHash: sha(token) }, data: { sessionHash: null, sessionExpiresAt: null } });
    return { ok: true };
  }
}
