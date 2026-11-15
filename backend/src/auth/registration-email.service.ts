import { HttpException, HttpStatus, Injectable, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { mailReadiness } from "../mail/mail-dispatch-policy";
import { PrismaService } from "../prisma/prisma.service";
import { RequestRegistrationEmailDto, VerifyRegistrationEmailDto } from "./dto";

const CODE_LIFETIME_MS = 10 * 60_000;
const PROOF_LIFETIME_MS = 10 * 60_000;
const RESEND_INTERVAL_MS = 60_000;
const MAX_FAILED_ATTEMPTS = 5;
const HOURLY_REQUEST_LIMIT = 10;
const proofHash = (value: string) => createHash("sha256").update(value).digest("hex");
const invalidCode = () => new UnauthorizedException({ code: "REGISTRATION_EMAIL_CODE_INVALID",
  message: "인증번호가 맞지 않거나 만료됐어요. 새 인증번호를 요청해 주세요." });
const invalidProof = () => new UnauthorizedException({ code: "REGISTRATION_EMAIL_VERIFICATION_INVALID",
  message: "이메일 인증 시간이 지났어요. 이메일 인증을 다시 진행해 주세요." });

@Injectable()
export class RegistrationEmailService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  async request(dto: RequestRegistrationEmailDto) {
    if (!mailReadiness(this.config).ready) {
      throw new ServiceUnavailableException("지금은 인증 메일을 보낼 수 없어요. 잠시 후 다시 시도해 주세요.");
    }
    // 설정 오류는 challenge를 무효화하거나 메일을 쌓기 전에 확인한다.
    const secret = this.signingSecret();
    return this.prisma.$transaction(async (tx) => {
      await this.lockEmail(tx, dto.email);
      const now = new Date();
      const latest = await tx.registrationEmailChallenge.findFirst({
        where: { email: { equals: dto.email, mode: "insensitive" } }, orderBy: { createdAt: "desc" }, select: { createdAt: true }
      });
      if (latest && latest.createdAt.getTime() > now.getTime() - RESEND_INTERVAL_MS) {
        throw this.throttled(Math.ceil((latest.createdAt.getTime() + RESEND_INTERVAL_MS - now.getTime()) / 1000));
      }
      const count = await tx.registrationEmailChallenge.count({
        where: { email: { equals: dto.email, mode: "insensitive" }, createdAt: { gt: new Date(now.getTime() - 60 * 60_000) } }
      });
      if (count >= HOURLY_REQUEST_LIMIT) throw this.throttled(60 * 60);
      const id = randomUUID();
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      const expiresAt = new Date(now.getTime() + CODE_LIFETIME_MS);
      // 메일함별 발급 제한·무효화만 대소문자를 무시한다. User와 가입 proof의 이메일 식별은 원문을 유지한다.
      await tx.registrationEmailChallenge.updateMany({
        where: { email: { equals: dto.email, mode: "insensitive" }, consumedAt: null }, data: { consumedAt: now, proofHash: null, proofExpiresAt: null }
      });
      await tx.registrationEmailChallenge.create({
        data: { id, email: dto.email, codeHash: this.codeHash(secret, id, code), expiresAt }
      });
      await tx.emailDelivery.create({ data: {
        toEmail: dto.email, subject: "[아트브릿지] 회원가입 인증번호", templateKey: "auth.registration_code", status: "QUEUED",
        bodyText: `회원가입 인증번호: ${code}\n\n10분 안에 입력해 주세요. 인증번호는 다른 사람에게 알려주지 마세요.\n본인이 요청하지 않았다면 이 메일을 무시해 주세요.`,
        metadata: { challengeId: id, transactional: true, expiresAt: expiresAt.toISOString() }
      } });
      return { challengeId: id, expiresAt, retryAfterSeconds: RESEND_INTERVAL_MS / 1000 };
    }).catch((error: unknown) => {
      if (error instanceof HttpException) throw error;
      // outbox 예외의 query 인자에 인증번호가 포함될 수 있어 Nest 기본 오류 로그로 넘기지 않는다.
      throw new ServiceUnavailableException("인증 메일을 준비하지 못했어요. 잠시 후 다시 시도해 주세요.");
    });
  }

  async verify(dto: VerifyRegistrationEmailDto) {
    const secret = this.signingSecret();
    const token = randomBytes(32).toString("hex");
    const expiresAt = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM registration_email_challenges WHERE id = ${dto.challengeId} FOR UPDATE`;
      const challenge = await tx.registrationEmailChallenge.findUnique({ where: { id: dto.challengeId } });
      const now = new Date();
      if (!challenge || challenge.email !== dto.email || challenge.consumedAt || challenge.verifiedAt
        || challenge.expiresAt <= now || challenge.attempts >= MAX_FAILED_ATTEMPTS) return null;
      const expected = Buffer.from(challenge.codeHash, "hex");
      const actual = Buffer.from(this.codeHash(secret, challenge.id, dto.code), "hex");
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
        // 실패 횟수를 commit한 뒤 바깥에서 오류를 반환한다.
        await tx.registrationEmailChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
        return null;
      }
      const proofExpiresAt = new Date(now.getTime() + PROOF_LIFETIME_MS);
      await tx.registrationEmailChallenge.update({
        where: { id: challenge.id }, data: { verifiedAt: now, proofHash: proofHash(token), proofExpiresAt }
      });
      return proofExpiresAt;
    });
    if (!expiresAt) throw invalidCode();
    return { emailVerificationToken: token, expiresAt };
  }

  async consumeProof(tx: Prisma.TransactionClient, email: string, token: string) {
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) throw invalidProof();
    await this.lockEmail(tx, email);
    const now = new Date();
    // 계정·동의 저장과 같은 transaction에서 조건부 갱신해야 proof 재사용과 경합을 차단한다.
    const consumed = await tx.registrationEmailChallenge.updateMany({
      where: { email, proofHash: proofHash(token), verifiedAt: { not: null }, proofExpiresAt: { gt: now }, consumedAt: null },
      data: { consumedAt: now, proofHash: null, proofExpiresAt: null }
    });
    if (consumed.count !== 1) throw invalidProof();
  }

  private async lockEmail(tx: Prisma.TransactionClient, email: string) {
    const key = `registration-email:${email.toLowerCase()}`;
    // 최초 요청도 메일함별로 직렬화한다. 이 정규화는 잠금에만 쓰며 사용자 이메일 식별에는 적용하지 않는다.
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }

  private signingSecret() {
    const secret = this.config.get<string>("JWT_ACCESS_SECRET");
    if (!secret) throw new ServiceUnavailableException("지금은 이메일 인증을 처리할 수 없어요. 잠시 후 다시 시도해 주세요.");
    return secret;
  }

  private codeHash(secret: string, id: string, code: string) {
    return createHmac("sha256", secret).update(`registration-email-code:${id}:${code}`).digest("hex");
  }

  private throttled(retryAfterSeconds: number) {
    return new HttpException({ statusCode: HttpStatus.TOO_MANY_REQUESTS, code: "REGISTRATION_EMAIL_RATE_LIMITED",
      message: "인증 메일을 요청한 지 얼마 되지 않았어요. 잠시 후 다시 시도해 주세요.", retryAfterSeconds }, HttpStatus.TOO_MANY_REQUESTS);
  }
}
