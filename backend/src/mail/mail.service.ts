import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EmailDeliveryStatus, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import nodemailer, { type Transporter } from "nodemailer";
import { PrismaService } from "../prisma/prisma.service";
import { sendResendEmail } from "./resend-mail.transport";
import { mailReadiness, prepareResendDispatch, retryDecision } from "./mail-dispatch-policy";

export type QueueEmailInput = {
  toEmail: string;
  subject: string;
  bodyText: string;
  templateKey: string;
  userId?: string;
  productionId?: string;
  metadata?: Prisma.InputJsonValue;
  bypassUserPreference?: boolean;
};

export type QueueDigestEmailInput = QueueEmailInput & {
  windowMs?: number;
};

export type ProcessQueuedEmailsOptions = {
  limit?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
  shouldStop?: () => boolean;
};

const QUEUED_EMAIL_SELECT = {
  id: true,
  toEmail: true,
  templateKey: true,
  status: true,
  skippedReason: true,
  createdAt: true
} as const;

type QueuedEmailResult = Prisma.EmailDeliveryGetPayload<{ select: typeof QUEUED_EMAIL_SELECT }>;

type PendingQueueEmail = {
  input: QueueEmailInput;
  toEmail: string;
  subject: string;
  resolve: (value: QueuedEmailResult) => void;
  reject: (reason: unknown) => void;
};

type QueuedEmailDelivery = Prisma.EmailDeliveryGetPayload<{
  select: {
    id: true;
    toEmail: true;
    subject: true;
    bodyText: true;
    templateKey: true;
    attempts: true;
    metadata: true;
    updatedAt: true;
  };
}>;

const VERIFICATION_CODE_TEMPLATE_KEYS = ["inquiry.access_code", "auth.registration_code"];

@Injectable()
export class MailService {
  private transporter: Transporter | null = null;
  private cooldownUntil = 0;

  deliveryReadiness() { return mailReadiness(this.config); }

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(ConfigService)
    private readonly config: ConfigService
  ) {}

  // 같은 틱에 몰려 들어온 queueEmail 호출은 모아서 수신 설정 조회 1회 + 삽입 1회로 처리한다(수신자 N명 -> 2N 쿼리 방지).
  private pendingQueue: PendingQueueEmail[] = [];

  async queueEmail(input: QueueEmailInput) {
    const { toEmail, subject } = this.normalizeQueueInput(input);
    return new Promise<QueuedEmailResult>((resolve, reject) => {
      this.pendingQueue.push({ input, toEmail, subject, resolve, reject });
      if (this.pendingQueue.length === 1) {
        void Promise.resolve().then(() => this.flushPendingQueue());
      }
    });
  }

  async queueEmails(inputs: QueueEmailInput[]) {
    if (inputs.length === 0) return [];
    const items = inputs.map((input) => ({ input, ...this.normalizeQueueInput(input) }));
    return this.insertQueuedEmails(items);
  }

  private normalizeQueueInput(input: QueueEmailInput) {
    const toEmail = input.toEmail.trim().toLowerCase();
    const subject = input.subject.trim();
    if (!toEmail) {
      throw new BadRequestException("메일 수신자 이메일이 필요해요");
    }
    if (!subject) {
      throw new BadRequestException("메일 제목이 필요해요");
    }
    return { toEmail, subject };
  }

  private async flushPendingQueue() {
    const batch = this.pendingQueue;
    this.pendingQueue = [];
    if (batch.length === 0) return;
    try {
      const results = await this.insertQueuedEmails(batch);
      batch.forEach((item, index) => item.resolve(results[index]));
    } catch (error) {
      batch.forEach((item) => item.reject(error));
    }
  }

  private async insertQueuedEmails(items: Array<{ input: QueueEmailInput; toEmail: string; subject: string }>) {
    const userIds = [
      ...new Set(items.flatMap(({ input }) => (input.userId && !input.bypassUserPreference ? [input.userId] : [])))
    ];
    const preferences = userIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, emailNotify: true } })
      : [];
    const emailNotifyByUser = new Map(preferences.map((user) => [user.id, user.emailNotify]));
    const rows = items.map(({ input, toEmail, subject }) => {
      const skippedByPreference =
        Boolean(input.userId && !input.bypassUserPreference) && emailNotifyByUser.get(input.userId as string) === false;
      return {
        id: randomUUID(),
        userId: input.userId,
        productionId: input.productionId,
        toEmail,
        subject,
        bodyText: input.bodyText,
        templateKey: input.templateKey,
        status: skippedByPreference ? EmailDeliveryStatus.SKIPPED : EmailDeliveryStatus.QUEUED,
        skippedReason: skippedByPreference ? "USER_EMAIL_NOTIFY_DISABLED" : undefined,
        metadata: input.metadata ?? undefined
      };
    });

    if (rows.length === 1) {
      return [await this.prisma.emailDelivery.create({ data: rows[0], select: QUEUED_EMAIL_SELECT })];
    }
    const created = await this.prisma.emailDelivery.createManyAndReturn({ data: rows, select: QUEUED_EMAIL_SELECT });
    const byId = new Map(created.map((row) => [row.id, row]));
    return rows.map((row) => byId.get(row.id) as (typeof created)[number]);
  }

  async queueDigestEmail(input: QueueDigestEmailInput) {
    const toEmail = input.toEmail.trim().toLowerCase();
    const subject = input.subject.trim();
    if (!toEmail) {
      throw new BadRequestException("메일 수신자 이메일이 필요해요");
    }
    if (!subject) {
      throw new BadRequestException("메일 제목이 필요해요");
    }

    const now = new Date();
    const windowMs = this.clampedNumber(input.windowMs ?? this.numberConfig("MAIL_DIGEST_WINDOW_MS", 3600000), 60000, 86400000);
    const windowStart = new Date(now.getTime() - windowMs);
    const userPreference = input.userId && !input.bypassUserPreference ? await this.findUserPreference(input.userId) : null;
    const skippedByPreference = Boolean(userPreference && !userPreference.emailNotify);
    const status = skippedByPreference ? EmailDeliveryStatus.SKIPPED : EmailDeliveryStatus.QUEUED;
    const existing = await this.prisma.emailDelivery.findFirst({
      where: {
        userId: input.userId ?? null,
        productionId: input.productionId ?? null,
        toEmail,
        templateKey: input.templateKey,
        status,
        attempts: 0,
        createdAt: { gte: windowStart },
        sentAt: null
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        metadata: true,
        updatedAt: true
      }
    });
    const digestCount = this.digestCount(existing?.metadata) + 1;
    const metadata = {
      ...this.metadataObject(existing?.metadata),
      ...this.metadataObject(input.metadata),
      digest: true,
      digestWindowMs: windowMs,
      digestCount,
      digestUpdatedAt: now.toISOString()
    } as Prisma.InputJsonValue;
    const bodyText = this.withDigestFooter(input.bodyText, digestCount, windowMs);

    if (existing) {
      const changed = await this.prisma.emailDelivery.updateMany({
        where: { id: existing.id, status, attempts: 0, updatedAt: existing.updatedAt },
        data: { subject, bodyText, metadata, skippedReason: skippedByPreference ? "USER_EMAIL_NOTIFY_DISABLED" : null }
      });
      if (changed.count === 1) return this.prisma.emailDelivery.findUniqueOrThrow({
        where: { id: existing.id },
        select: { id: true, toEmail: true, templateKey: true, status: true, skippedReason: true, createdAt: true }
      });
      // The worker or another event claimed the old row. Never mutate an in-flight payload.
      return this.queueEmail({ ...input, bodyText: this.withDigestFooter(input.bodyText, 1, windowMs) });
    }

    return this.prisma.emailDelivery.create({
      data: {
        userId: input.userId,
        productionId: input.productionId,
        toEmail,
        subject,
        bodyText,
        templateKey: input.templateKey,
        status,
        skippedReason: skippedByPreference ? "USER_EMAIL_NOTIFY_DISABLED" : undefined,
        metadata
      },
      select: {
        id: true,
        toEmail: true,
        templateKey: true,
        status: true,
        skippedReason: true,
        createdAt: true
      }
    });
  }

  fromEmail() {
    return this.config.get<string>("MAIL_FROM") || "no-reply@reading-musical.local";
  }

  async processQueuedEmails(options: ProcessQueuedEmailsOptions = {}) {
    const readiness = this.deliveryReadiness();
    const result = { picked: 0, sent: 0, failed: 0, retried: 0, skipped: 0, heldReason: readiness.reason as string | null };
    // Paused mail must not consume retries or falsely mark messages as sent.
    if (!readiness.ready) return result;
    if (Date.now() < this.cooldownUntil) return { ...result, heldReason: "PROVIDER_COOLDOWN" };
    const limit = this.clampedNumber(options.limit ?? this.numberConfig("MAIL_WORKER_BATCH_SIZE", 25), 1, 100);
    const maxAttempts = this.clampedNumber(options.maxAttempts ?? this.numberConfig("MAIL_WORKER_MAX_ATTEMPTS", 3), 1, 10);
    const retryDelayMs = this.clampedNumber(options.retryDelayMs ?? this.numberConfig("MAIL_WORKER_RETRY_DELAY_MS", 60000), 1000, 86400000);
    const now = new Date();
    const staleBefore = new Date(now.getTime() - this.clampedNumber(this.numberConfig("MAIL_WORKER_PROCESSING_TIMEOUT_MS", 300000), 30000, 86400000));
    await this.prisma.emailDelivery.updateMany({
      where: { status: "PROCESSING", attempts: { gte: maxAttempts }, lastAttemptAt: { lte: staleBefore }, templateKey: { notIn: VERIFICATION_CODE_TEMPLATE_KEYS } },
      data: { status: "FAILED", errorMessage: "WORKER_INTERRUPTED_REVIEW_REQUIRED", nextAttemptAt: null }
    });
    await this.prisma.emailDelivery.updateMany({
      where: { status: "PROCESSING", attempts: { gte: maxAttempts }, lastAttemptAt: { lte: staleBefore }, templateKey: { in: VERIFICATION_CODE_TEMPLATE_KEYS } },
      data: { status: "FAILED", errorMessage: "WORKER_INTERRUPTED_REVIEW_REQUIRED", nextAttemptAt: null, bodyText: "인증번호 안내 발송 실패" }
    });
    await this.prisma.emailDelivery.updateMany({
      where: { status: "PROCESSING", attempts: { lt: maxAttempts }, lastAttemptAt: { lte: staleBefore } },
      data: { status: "QUEUED", errorMessage: "WORKER_RECOVERED", nextAttemptAt: now }
    });
    const deliveries = await this.prisma.emailDelivery.findMany({
      where: { status: "QUEUED", attempts: { lt: maxAttempts }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: limit,
      select: { id: true, toEmail: true, subject: true, bodyText: true, templateKey: true, attempts: true, metadata: true, updatedAt: true }
    });
    result.picked = deliveries.length;
    for (const delivery of deliveries) {
      if (options.shouldStop?.()) break;
      let metadata: Prisma.JsonValue | Prisma.InputJsonValue = delivery.metadata;
      let preparationError: unknown;
      if (readiness.transport === "resend") {
        try {
          metadata = prepareResendDispatch(delivery, { from: this.requiredConfig("RESEND_FROM_EMAIL"), replyTo: this.config.get<string>("RESEND_REPLY_TO")?.trim() }).metadata as Prisma.InputJsonValue;
        } catch (error) { preparationError = error; }
      }
      const claimedAt = new Date();
      const claimed = await this.prisma.emailDelivery.updateMany({
        where: { id: delivery.id, status: "QUEUED", attempts: delivery.attempts, updatedAt: delivery.updatedAt },
        data: { status: "PROCESSING", attempts: { increment: 1 }, lastAttemptAt: claimedAt, errorMessage: null, nextAttemptAt: null,
          ...(metadata ? { metadata: metadata as Prisma.InputJsonValue } : {}) }
      });
      if (claimed.count !== 1) { result.skipped += 1; continue; }
      // Fence every completion against worker recovery or another attempt.
      const owned = { id: delivery.id, status: EmailDeliveryStatus.PROCESSING, attempts: delivery.attempts + 1, lastAttemptAt: claimedAt };
      let info: { messageId?: string };
      try {
        if (await this.codeDeliveryUnavailable(delivery, metadata)) {
          await this.prisma.emailDelivery.updateMany({ where: owned, data: { status: "SKIPPED", skippedReason: "CODE_EXPIRED_OR_USED", bodyText: "인증번호 유효기간 종료", nextAttemptAt: null } });
          result.skipped += 1; continue;
        }
        if (preparationError) throw preparationError;
        info = await this.sendDelivery({ ...delivery, metadata });
      } catch (error) {
        const decision = retryDecision(error, delivery.attempts + 1, maxAttempts, retryDelayMs);
        const changed = await this.prisma.emailDelivery.updateMany({ where: owned, data: {
          status: decision.terminal ? "FAILED" : "QUEUED", errorMessage: decision.errorMessage,
          ...(VERIFICATION_CODE_TEMPLATE_KEYS.includes(delivery.templateKey) && decision.terminal ? { bodyText: "인증번호 안내 발송 실패" } : {}),
          nextAttemptAt: decision.terminal ? null : new Date(Date.now() + decision.delayMs)
        } });
        if (changed.count === 1) { if (decision.terminal) result.failed += 1; else result.retried += 1; }
        else result.skipped += 1;
        if (decision.pauseBatch) { this.cooldownUntil = Date.now() + Math.max(60000, decision.delayMs); result.heldReason = "PROVIDER_COOLDOWN"; break; }
        continue;
      }
      // A DB write failure after acceptance is NOT a transport failure. Leave PROCESSING for guarded recovery.
      const completed = await this.prisma.emailDelivery.updateMany({ where: owned, data: {
        status: "SENT", sentAt: new Date(), providerMessageId: info.messageId || null, errorMessage: null, nextAttemptAt: null,
        ...(VERIFICATION_CODE_TEMPLATE_KEYS.includes(delivery.templateKey) ? { bodyText: "인증번호 안내 발송 완료" } : {})
      } });
      if (completed.count === 1) result.sent += 1; else result.skipped += 1;
    }
    return result;
  }

  private async codeDeliveryUnavailable(delivery: QueuedEmailDelivery, metadata: Prisma.JsonValue | Prisma.InputJsonValue) {
    if (!VERIFICATION_CODE_TEMPLATE_KEYS.includes(delivery.templateKey)) return false;
    const challengeId = this.metadataObject(metadata).challengeId;
    if (typeof challengeId !== "string" || !challengeId) return true;
    if (delivery.templateKey === "inquiry.access_code") {
      const challenge = await this.prisma.inquiryAccess.findUnique({ where: { id: challengeId }, select: { consumedAt: true, expiresAt: true } });
      return !challenge || Boolean(challenge.consumedAt) || challenge.expiresAt.getTime() <= Date.now();
    }
    const challenge = await this.prisma.registrationEmailChallenge.findUnique({
      where: { id: challengeId },
      select: { email: true, expiresAt: true, attempts: true, verifiedAt: true, consumedAt: true }
    });
    return !challenge || Boolean(challenge.verifiedAt || challenge.consumedAt) || challenge.attempts >= 5
      || challenge.expiresAt.getTime() <= Date.now() || challenge.email !== delivery.toEmail;
  }

  private async sendDelivery(delivery: Omit<QueuedEmailDelivery, "metadata"> & { metadata: Prisma.JsonValue | Prisma.InputJsonValue }) {
    const transport = (this.config.get<string>("MAIL_TRANSPORT") || "smtp").trim().toLowerCase();
    if (transport === "resend") {
      return sendResendEmail({
        credential: this.requiredConfig("RESEND_API_KEY"),
        idempotencyKey: `email-delivery/${delivery.id}`,
        from: String(this.metadataObject(this.metadataObject(delivery.metadata).mailDispatch).from || this.requiredConfig("RESEND_FROM_EMAIL")),
        replyTo: (this.metadataObject(this.metadataObject(delivery.metadata).mailDispatch).replyTo as string | null) || undefined,
        to: delivery.toEmail,
        subject: delivery.subject,
        text: delivery.bodyText,
        headers: {
          "X-Reading-Musical-Template": delivery.templateKey,
          "X-Reading-Musical-Delivery": delivery.id
        }
      });
    }

    return this.getTransporter().sendMail({
      from: this.fromEmail(),
      to: delivery.toEmail,
      subject: delivery.subject,
      text: delivery.bodyText,
      headers: {
        "X-Reading-Musical-Template": delivery.templateKey,
        "X-Reading-Musical-Delivery": delivery.id
      }
    });
  }

  private getTransporter() {
    if (this.transporter) {
      return this.transporter;
    }

    const transport = (this.config.get<string>("MAIL_TRANSPORT") || "smtp").trim().toLowerCase();
    if (transport === "json") {
      this.transporter = nodemailer.createTransport({ jsonTransport: true });
      return this.transporter;
    }

    const user = this.config.get<string>("MAIL_USER")?.trim();
    const pass = this.config.get<string>("MAIL_PASSWORD")?.trim();
    this.transporter = nodemailer.createTransport({
      host: this.config.get<string>("MAIL_HOST") || "localhost",
      port: this.numberConfig("MAIL_PORT", 1025),
      secure: this.booleanConfig("MAIL_SECURE", false),
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      auth: user ? { user, pass } : undefined
    });
    return this.transporter;
  }

  private findUserPreference(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, emailNotify: true }
    });
  }

  private numberConfig(key: string, fallback: number) {
    const value = Number(this.config.get<string | number>(key) ?? fallback);
    return Number.isFinite(value) ? value : fallback;
  }

  private booleanConfig(key: string, fallback: boolean) {
    const value = this.config.get<string | boolean>(key);
    if (value === undefined) return fallback;
    return String(value).toLowerCase() === "true";
  }

  private requiredConfig(key: string) {
    const value = this.config.get<string>(key)?.trim();
    if (!value) throw new Error(`${key} is required.`);
    return value;
  }

  private clampedNumber(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, Math.trunc(value)));
  }

  private metadataObject(value: unknown) {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  }

  private digestCount(value: Prisma.JsonValue | Prisma.InputJsonValue | null | undefined) {
    const count = Number(this.metadataObject(value).digestCount ?? 0);
    return Number.isFinite(count) ? count : 0;
  }

  private withDigestFooter(bodyText: string, digestCount: number, windowMs: number) {
    const minutes = Math.max(1, Math.round(windowMs / 60000));
    return [bodyText.trim(), "", `최근 ${minutes}분 동안 묶인 변경 알림: ${digestCount}건`].join("\n");
  }

}
