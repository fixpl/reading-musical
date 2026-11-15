import { createHmac, randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { PlatformRole } from "@prisma/client";
import type { RequestUser } from "../common/types/request-user";
import { PrismaService } from "../prisma/prisma.service";
import { ScheduleService } from "../schedule/schedule.service";

const PREVIEW_AUDIENCE = "production-assistant-schedule-confirmation";
const MAX_SCHEDULE_MATCHES = 8;
const activeProduction = { archived: false, deletedAt: null };
const eventSelect = {
  id: true, title: true, startAt: true, endAt: true, productionId: true, production: { select: { title: true } }
} as const;

type EventRow = {
  id: string; title: string; startAt: Date; endAt: Date; productionId: string; production: { title: string };
};
type Approval = { auditId: string; eventId: string; productionId: string; startAt: string; endAt: string; eventVersion: string };

function eventCard({ production, ...event }: EventRow) {
  return { ...event, productionTitle: production.title };
}

export function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function seoulScheduleTime(value: string) {
  if (!value) return "";
  if (!isIsoDate(value.slice(0, 10)) || !/^T(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.slice(10))) return null;
  return value + ":00+09:00";
}

@Injectable()
export class AssistantScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly schedule: ScheduleService,
    private readonly config: ConfigService,
    private readonly jwt: JwtService
  ) {}

  async getFocusedEvent(eventId: string, user: RequestUser) {
    this.assertOperator(user);
    const event = await this.prisma.scheduleEvent.findFirst({
      where: { id: eventId, production: activeProduction }, select: eventSelect
    });
    return event ? eventCard(event) : null;
  }

  async findEvents(productionQuery: string, eventQuery: string, onDate: string, user: RequestUser) {
    this.assertOperator(user);
    const date = onDate ? new Date(onDate + "T00:00:00+09:00") : undefined;
    const nextDate = date ? new Date(+date + 86_400_000) : undefined;
    const rows = await this.prisma.scheduleEvent.findMany({
      where: {
        production: { ...activeProduction, title: productionQuery ? { contains: productionQuery, mode: "insensitive" } : undefined },
        title: eventQuery ? { contains: eventQuery, mode: "insensitive" } : undefined,
        startAt: date ? { gte: date, lt: nextDate } : undefined
      },
      select: eventSelect,
      orderBy: [{ startAt: "asc" }, { id: "asc" }],
      take: MAX_SCHEDULE_MATCHES + 1
    });
    return { items: rows.slice(0, MAX_SCHEDULE_MATCHES).map(eventCard), hasMore: rows.length > MAX_SCHEDULE_MATCHES };
  }

  async preview(productionId: string, eventId: string, startAt: string, endAt: string, user: RequestUser) {
    this.assertOperator(user);
    const { eventVersion, ...review } = await this.schedule.previewTimeChange(productionId, eventId, startAt, endAt, user);
    let approvalToken: string | null = null;
    if (review.timeChanged && !review.conflicts.length) {
      const approval: Approval = {
        eventId, productionId, eventVersion, auditId: randomUUID(),
        startAt: review.after.startAt.toISOString(), endAt: review.after.endAt.toISOString()
      };
      approvalToken = this.jwt.sign(approval, {
        secret: this.signingSecret(), algorithm: "HS256", subject: user.id, audience: PREVIEW_AUDIENCE, expiresIn: "10m"
      });
    }
    return { ...review, approvalToken };
  }

  async confirm(approvalToken: string, user: RequestUser) {
    this.assertOperator(user);
    const secret = this.signingSecret();
    let approval: Approval;
    try {
      approval = this.jwt.verify<Approval>(approvalToken, { secret, algorithms: ["HS256"], subject: user.id, audience: PREVIEW_AUDIENCE });
    } catch {
      throw new BadRequestException({ code: "SCHEDULE_PREVIEW_EXPIRED", message: "일정 변경을 다시 확인한 뒤 저장해 주세요." });
    }
    const { productionId, eventId, startAt, endAt, eventVersion, auditId } = approval;
    try {
      const event = await this.schedule.updateEvent(productionId, eventId, { startAt, endAt }, user, { eventVersion, auditId });
      return { status: "saved" as const, notificationWarning: "notificationWarning" in event, previouslySaved: false };
    } catch (error) {
      if (!(error instanceof ConflictException)) throw error;
      if (await this.schedule.wasAssistantTimeChangeSaved(auditId, eventId, user)) {
        return { status: "saved" as const, notificationWarning: false, previouslySaved: true };
      }
      return { status: "review" as const, preview: await this.preview(productionId, eventId, startAt, endAt, user) };
    }
  }

  private assertOperator(user: RequestUser) {
    if (user.platformRole !== PlatformRole.SUPER_ADMIN) throw new ForbiddenException("운영 관리자만 사용할 수 있어요.");
  }

  private signingSecret() {
    const secret = this.config.get<string>("JWT_ACCESS_SECRET");
    if (!secret) throw new ServiceUnavailableException("일정 변경 확인을 처리할 수 없어요.");
    // An approval token cannot authenticate to the application's access-token guard.
    return createHmac("sha256", secret).update(PREVIEW_AUDIENCE).digest("hex");
  }
}
