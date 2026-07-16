import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EmailDeliveryStatus, Prisma } from "@prisma/client";
import nodemailer, { type Transporter } from "nodemailer";
import { PrismaService } from "../prisma/prisma.service";

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
};

type QueuedEmailDelivery = Prisma.EmailDeliveryGetPayload<{
  select: {
    id: true;
    toEmail: true;
    subject: true;
    bodyText: true;
    templateKey: true;
    attempts: true;
  };
}>;

@Injectable()
export class MailService {
  private transporter: Transporter | null = null;

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(ConfigService)
    private readonly config: ConfigService
  ) {}

  async queueEmail(input: QueueEmailInput) {
    const toEmail = input.toEmail.trim().toLowerCase();
    const subject = input.subject.trim();
    if (!toEmail) {
      throw new BadRequestException("메일 수신자 이메일이 필요해요");
    }
    if (!subject) {
      throw new BadRequestException("메일 제목이 필요해요");
    }

    const userPreference = input.userId && !input.bypassUserPreference ? await this.findUserPreference(input.userId) : null;
    const skippedByPreference = Boolean(userPreference && !userPreference.emailNotify);

    return this.prisma.emailDelivery.create({
      data: {
        userId: input.userId,
        productionId: input.productionId,
        toEmail,
        subject,
        bodyText: input.bodyText,
        templateKey: input.templateKey,
        status: skippedByPreference ? EmailDeliveryStatus.SKIPPED : EmailDeliveryStatus.QUEUED,
        skippedReason: skippedByPreference ? "USER_EMAIL_NOTIFY_DISABLED" : undefined,
        metadata: input.metadata ?? undefined
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
        metadata: true
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
      return this.prisma.emailDelivery.update({
        where: { id: existing.id },
        data: {
          subject,
          bodyText,
          metadata,
          skippedReason: skippedByPreference ? "USER_EMAIL_NOTIFY_DISABLED" : null
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
    const limit = this.clampedNumber(options.limit ?? this.numberConfig("MAIL_WORKER_BATCH_SIZE", 25), 1, 100);
    const maxAttempts = this.clampedNumber(options.maxAttempts ?? this.numberConfig("MAIL_WORKER_MAX_ATTEMPTS", 3), 1, 10);
    const retryDelayMs = this.clampedNumber(options.retryDelayMs ?? this.numberConfig("MAIL_WORKER_RETRY_DELAY_MS", 300000), 1000, 86400000);
    const now = new Date();
    const deliveries = await this.prisma.emailDelivery.findMany({
      where: {
        status: EmailDeliveryStatus.QUEUED,
        attempts: { lt: maxAttempts },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }]
      },
      orderBy: [{ createdAt: "asc" }],
      take: limit,
      select: {
        id: true,
        toEmail: true,
        subject: true,
        bodyText: true,
        templateKey: true,
        attempts: true
      }
    });

    const result = {
      picked: deliveries.length,
      sent: 0,
      failed: 0,
      retried: 0,
      skipped: 0
    };

    for (const delivery of deliveries) {
      const claimed = await this.prisma.emailDelivery.updateMany({
        where: { id: delivery.id, status: EmailDeliveryStatus.QUEUED },
        data: {
          status: EmailDeliveryStatus.PROCESSING,
          attempts: { increment: 1 },
          lastAttemptAt: new Date(),
          errorMessage: null,
          nextAttemptAt: null
        }
      });
      if (claimed.count !== 1) {
        result.skipped += 1;
        continue;
      }

      try {
        const info = await this.sendDelivery(delivery);
        await this.prisma.emailDelivery.update({
          where: { id: delivery.id },
          data: {
            status: EmailDeliveryStatus.SENT,
            sentAt: new Date(),
            providerMessageId: info.messageId || null,
            errorMessage: null,
            nextAttemptAt: null
          }
        });
        result.sent += 1;
      } catch (error) {
        const attempts = delivery.attempts + 1;
        const terminal = attempts >= maxAttempts;
        await this.prisma.emailDelivery.update({
          where: { id: delivery.id },
          data: {
            status: terminal ? EmailDeliveryStatus.FAILED : EmailDeliveryStatus.QUEUED,
            errorMessage: this.errorMessage(error),
            nextAttemptAt: terminal ? null : new Date(Date.now() + retryDelayMs)
          }
        });
        if (terminal) {
          result.failed += 1;
        } else {
          result.retried += 1;
        }
      }
    }

    return result;
  }

  private async sendDelivery(delivery: QueuedEmailDelivery) {
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

  private clampedNumber(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, Math.trunc(value)));
  }

  private metadataObject(value: Prisma.JsonValue | Prisma.InputJsonValue | null | undefined) {
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

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000);
  }
}
