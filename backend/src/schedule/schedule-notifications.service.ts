import { BadRequestException, Injectable } from "@nestjs/common";
import { AttendanceStatus, EventType, Prisma } from "@prisma/client";
import type { RequestUser } from "../common/types/request-user";
import { MailService } from "../mail/mail.service";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import type { ConflictItem } from "./schedule.service";
import { attendanceStatusLabel, clampedReminderHours, formatKoreanDateTime, toJson } from "./schedule-shared.util";

export type ScheduleNotificationKind = "created" | "updated" | "canceled";

export type ForcedAttendanceForAudit = {
  id: string;
  membershipId: string;
  forced: boolean;
  forcedReason?: string | null;
  membership: {
    user: { id: string; email: string; name: string };
  };
};

export type ScheduleEventForNotification = Prisma.ScheduleEventGetPayload<{
  include: {
    production: { select: { id: true; title: true; organizationId: true } };
    attendances: {
      include: {
        membership: {
          include: {
            user: { select: { id: true; email: true; name: true; profileType: true; profileComplete: true } };
            roles: { select: { role: true } };
          };
        };
      };
    };
  };
}>;

export type AttendanceForReminder = Prisma.AttendanceGetPayload<{
  include: {
    event: { include: { production: { select: { id: true; title: true } } } };
    membership: { include: { user: { select: { id: true; email: true; name: true } } } };
  };
}>;

/**
 * 일정 생성/변경/취소, 강제 배정, 출석 리마인더의 알림·메일 발송 전담.
 * schedule.service.ts(God Service 3순위)에서 분리.
 */
@Injectable()
export class ScheduleNotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService
  ) {}

  async sendAttendanceReminders(options: { now?: Date; lookaheadHours?: number } = {}) {
    const now = options.now ?? new Date();
    if (Number.isNaN(now.getTime())) {
      throw new BadRequestException("리마인드 기준 시각이 올바르지 않아요");
    }
    const lookaheadHours = clampedReminderHours(options.lookaheadHours ?? 24);
    const windowEnd = new Date(now.getTime() + lookaheadHours * 60 * 60 * 1000);
    const attendances = await this.prisma.attendance.findMany({
      where: {
        status: { in: [AttendanceStatus.INVITED, AttendanceStatus.TENTATIVE] },
        event: {
          startAt: { gt: now, lte: windowEnd }
        }
      },
      orderBy: [{ event: { startAt: "asc" } }, { id: "asc" }],
      include: {
        event: { include: { production: { select: { id: true, title: true } } } },
        membership: { include: { user: { select: { id: true, email: true, name: true } } } }
      }
    });

    let notifications = 0;
    let emailDeliveries = 0;
    let skippedExisting = 0;

    for (const attendance of attendances) {
      if (await this.hasAttendanceReminder(attendance)) {
        skippedExisting += 1;
        continue;
      }

      const user = attendance.membership.user;
      const payload = this.attendanceReminderPayload(attendance);
      await this.notifications.createNotification({
        productionId: attendance.event.productionId,
        userId: user.id,
        type: "schedule.attendance_reminder",
        payload
      });
      notifications += 1;

      await this.mail.queueEmail({
        userId: user.id,
        productionId: attendance.event.productionId,
        toEmail: user.email,
        subject: `[아트브릿지] ${attendance.event.production.title} 출석 응답 요청`,
        templateKey: "schedule.attendance_reminder",
        bodyText: this.attendanceReminderEmailBody(attendance),
        metadata: payload
      });
      emailDeliveries += 1;
    }

    return {
      candidates: attendances.length,
      notifications,
      emailDeliveries,
      skippedExisting,
      windowStartAt: now.toISOString(),
      windowEndAt: windowEnd.toISOString(),
      lookaheadHours
    };
  }

  async createScheduleEventNotifications(
    event: ScheduleEventForNotification,
    actor: RequestUser,
    kind: ScheduleNotificationKind,
    sendEmail: boolean,
    reason?: string
  ) {
    const recipients = this.scheduleNotificationRecipients(event, actor.id);
    if (!recipients.length) {
      return { notifications: 0, emailDeliveries: 0 };
    }

    const type = `schedule.event_${kind}`;
    const payload = this.scheduleNotificationPayload(event, actor, kind, reason);
    await this.notifications.createNotifications(
      recipients.map((recipient) => ({
        productionId: event.productionId,
        userId: recipient.userId,
        type,
        payload
      }))
    );

    if (!sendEmail) {
      return { notifications: recipients.length, emailDeliveries: 0 };
    }

    await Promise.all(
      recipients.map((recipient) =>
        this.mail.queueEmail({
          userId: recipient.userId,
          productionId: event.productionId,
          toEmail: recipient.email,
          subject: this.scheduleEmailSubject(event, kind),
          templateKey: this.scheduleEmailTemplateKey(event, kind),
          bodyText: this.scheduleEmailBody(event, actor, kind, recipient.name, reason),
          metadata: {
            eventId: event.id,
            eventTitle: event.title,
            eventType: event.type,
            startAt: event.startAt.toISOString(),
            endAt: event.endAt.toISOString(),
            actorId: actor.id,
            actorName: actor.name,
            reason: reason || null,
            fromEmail: this.mail.fromEmail()
          }
        })
      )
    );

    return { notifications: recipients.length, emailDeliveries: recipients.length };
  }

  async handleForcedAttendances(input: {
    productionId: string;
    eventId: string;
    eventTitle: string;
    actor: RequestUser;
    attendances: ForcedAttendanceForAudit[];
    conflicts: ConflictItem[];
    reason: string;
  }) {
    const forcedAttendances = input.attendances.filter((attendance) => attendance.forced);
    if (!forcedAttendances.length) {
      return { logs: 0, notifications: 0, emailDeliveries: 0 };
    }

    const production = await this.prisma.production.findUnique({
      where: { id: input.productionId },
      select: { id: true, title: true, organizationId: true }
    });
    if (!production) {
      return { logs: 0, notifications: 0, emailDeliveries: 0 };
    }

    const reason = input.reason.trim() || forcedAttendances.find((attendance) => attendance.forcedReason?.trim())?.forcedReason?.trim() || "강제 배정";
    const conflictMap = this.conflictsByMembership(input.conflicts);

    await this.prisma.activityLog.createMany({
      data: forcedAttendances.map((attendance) => ({
        productionId: input.productionId,
        organizationId: production.organizationId,
        actorId: input.actor.id,
        action: "schedule.attendance_forced",
        entity: "Attendance",
        entityId: attendance.id,
        reason,
        afterJson: toJson({
          eventId: input.eventId,
          eventTitle: input.eventTitle,
          attendanceId: attendance.id,
          membershipId: attendance.membershipId,
          userId: attendance.membership.user.id,
          userName: attendance.membership.user.name,
          conflicts: conflictMap.get(attendance.membershipId) ?? []
        })
      }))
    });

    const payloads = forcedAttendances.map((attendance) => ({
      productionId: input.productionId,
      userId: attendance.membership.user.id,
      type: "schedule.attendance_forced",
      payload: toJson({
        eventId: input.eventId,
        eventTitle: input.eventTitle,
        attendanceId: attendance.id,
        reason,
        actorId: input.actor.id,
        actorName: input.actor.name,
        title: `강제 배정: ${input.eventTitle}`,
        message: "개인 일정 또는 다른 공연 일정과 겹치지만 운영자가 사유를 남기고 배정했어요."
      })
    }));
    await this.notifications.createNotifications(payloads);

    await Promise.all(
      forcedAttendances.map((attendance) =>
        this.mail.queueEmail({
          userId: attendance.membership.user.id,
          productionId: input.productionId,
          toEmail: attendance.membership.user.email,
          subject: `[아트브릿지] ${production.title} 강제 배정 안내`,
          templateKey: "schedule.attendance_forced",
          bodyText: this.forcedAttendanceEmailBody({
            productionTitle: production.title,
            eventTitle: input.eventTitle,
            recipientName: attendance.membership.user.name,
            actorName: input.actor.name,
            reason,
            conflicts: conflictMap.get(attendance.membershipId) ?? []
          }),
          metadata: toJson({
            eventId: input.eventId,
            attendanceId: attendance.id,
            actorId: input.actor.id,
            actorName: input.actor.name
          })
        })
      )
    );

    return {
      logs: forcedAttendances.length,
      notifications: forcedAttendances.length,
      emailDeliveries: forcedAttendances.length
    };
  }

  private conflictsByMembership(conflicts: ConflictItem[]) {
    const map = new Map<string, Array<Omit<ConflictItem, "startAt" | "endAt"> & { startAt: string; endAt: string }>>();
    for (const conflict of conflicts) {
      const serialized = {
        membershipId: conflict.membershipId,
        userId: conflict.userId,
        userName: conflict.userName,
        type: conflict.type,
        reason: conflict.reason,
        startAt: conflict.startAt.toISOString(),
        endAt: conflict.endAt.toISOString(),
        resourceId: conflict.resourceId
      };
      const list = map.get(conflict.membershipId) ?? [];
      list.push(serialized);
      map.set(conflict.membershipId, list);
    }
    return map;
  }

  private forcedAttendanceEmailBody(input: {
    productionTitle: string;
    eventTitle: string;
    recipientName: string;
    actorName: string;
    reason: string;
    conflicts: Array<{ type: "AVAILABILITY" | "EVENT"; reason: string; startAt: string; endAt: string }>;
  }) {
    const conflictLines = input.conflicts.length
      ? input.conflicts.map((conflict) => {
          const label = conflict.type === "AVAILABILITY" ? "개인 일정" : "다른 공연 일정";
          return `- ${label}: ${conflict.reason} (${formatKoreanDateTime(new Date(conflict.startAt))} - ${formatKoreanDateTime(new Date(conflict.endAt))})`;
        })
      : ["- 충돌 상세 없음"];

    return [
      `${input.recipientName}님,`,
      "",
      `${input.productionTitle} 공연의 일정에 강제 배정되었습니다.`,
      "",
      `일정: ${input.eventTitle}`,
      `처리자: ${input.actorName}`,
      `사유: ${input.reason}`,
      "",
      "충돌 정보:",
      ...conflictLines,
      "",
      "내 스케줄에서 참석 여부와 변경 내용을 확인해 주세요."
    ].join("\n");
  }

  private async hasAttendanceReminder(attendance: AttendanceForReminder) {
    const [notification, emailDelivery] = await Promise.all([
      this.prisma.notification.findFirst({
        where: {
          userId: attendance.membership.user.id,
          productionId: attendance.event.productionId,
          type: "schedule.attendance_reminder",
          payload: { path: ["reminderKey"], equals: this.attendanceReminderKey(attendance) }
        },
        select: { id: true }
      }),
      this.prisma.emailDelivery.findFirst({
        where: {
          userId: attendance.membership.user.id,
          productionId: attendance.event.productionId,
          templateKey: "schedule.attendance_reminder",
          metadata: { path: ["reminderKey"], equals: this.attendanceReminderKey(attendance) }
        },
        select: { id: true }
      })
    ]);
    return Boolean(notification || emailDelivery);
  }

  private attendanceReminderPayload(attendance: AttendanceForReminder) {
    const event = attendance.event;
    return toJson({
      attendanceId: attendance.id,
      eventId: event.id,
      eventTitle: event.title,
      eventType: event.type,
      attendanceStatus: attendance.status,
      productionTitle: event.production.title,
      startAt: event.startAt.toISOString(),
      endAt: event.endAt.toISOString(),
      location: event.location,
      meetingUrl: event.meetingUrl,
      reminderKey: this.attendanceReminderKey(attendance),
      title: `출석 응답 요청: ${event.title}`,
      message: `${formatKoreanDateTime(event.startAt)} 일정의 참석 여부를 응답해 주세요.`
    });
  }

  private attendanceReminderEmailBody(attendance: AttendanceForReminder) {
    const event = attendance.event;
    const recipientName = attendance.membership.user.name;
    return [
      `${recipientName}님,`,
      "",
      `${event.production.title} 공연의 일정 참석 응답이 필요합니다.`,
      "",
      `일정: ${event.title}`,
      `유형: ${event.type}`,
      `현재 응답: ${attendanceStatusLabel(attendance.status)}`,
      `시간: ${formatKoreanDateTime(event.startAt)} - ${formatKoreanDateTime(event.endAt)}`,
      event.location ? `장소: ${event.location}` : null,
      event.meetingUrl ? `회의 링크: ${event.meetingUrl}` : null,
      "",
      "일정 시작 전까지 내 스케줄에서 참석, 불참, 미정 중 하나로 응답해 주세요."
    ]
      .filter(Boolean)
      .join("\n");
  }

  private attendanceReminderKey(attendance: AttendanceForReminder) {
    return `attendance:${attendance.id}:${attendance.event.startAt.toISOString()}`;
  }

  private scheduleNotificationRecipients(event: ScheduleEventForNotification, actorId: string) {
    const byUserId = new Map<string, { userId: string; email: string; name: string }>();
    for (const attendance of event.attendances) {
      const user = attendance.membership.user;
      if (user.id === actorId) {
        continue;
      }
      byUserId.set(user.id, { userId: user.id, email: user.email, name: user.name });
    }
    return [...byUserId.values()];
  }

  private scheduleNotificationPayload(event: ScheduleEventForNotification, actor: RequestUser, kind: ScheduleNotificationKind, reason?: string) {
    return {
      eventId: event.id,
      eventTitle: event.title,
      eventType: event.type,
      startAt: event.startAt.toISOString(),
      endAt: event.endAt.toISOString(),
      location: event.location,
      meetingUrl: event.meetingUrl,
      actorId: actor.id,
      actorName: actor.name,
      reason: reason || null,
      title: this.scheduleNotificationTitle(kind, event.title),
      message: this.scheduleNotificationMessage(kind, event, reason)
    } satisfies Prisma.InputJsonObject;
  }

  private scheduleNotificationTitle(kind: ScheduleNotificationKind, eventTitle: string) {
    if (kind === "created") return `새 일정: ${eventTitle}`;
    if (kind === "updated") return `일정 변경: ${eventTitle}`;
    return `일정 취소: ${eventTitle}`;
  }

  private scheduleNotificationMessage(kind: ScheduleNotificationKind, event: ScheduleEventForNotification, reason?: string) {
    const prefix = kind === "created" ? "새 일정이 등록됐어요." : kind === "updated" ? "일정이 변경됐어요." : "일정이 취소됐어요.";
    const reasonText = kind === "canceled" && reason ? ` 사유: ${reason}` : "";
    return `${prefix} ${formatKoreanDateTime(event.startAt)} - ${formatKoreanDateTime(event.endAt)}${reasonText}`;
  }

  private scheduleEmailTemplateKey(event: ScheduleEventForNotification, kind: ScheduleNotificationKind) {
    if (kind === "created" && event.type === EventType.READING) {
      return "schedule.reading_call";
    }
    return `schedule.event_${kind}`;
  }

  private scheduleEmailSubject(event: ScheduleEventForNotification, kind: ScheduleNotificationKind) {
    if (kind === "created" && event.type === EventType.READING) {
      return `[아트브릿지] ${event.production.title} 리딩 소집 안내`;
    }
    if (kind === "created") {
      return `[아트브릿지] ${event.production.title} 새 일정 안내`;
    }
    return `[아트브릿지] ${event.production.title} 일정 ${kind === "canceled" ? "취소" : "변경"} 안내`;
  }

  private scheduleEmailBody(
    event: ScheduleEventForNotification,
    actor: RequestUser,
    kind: ScheduleNotificationKind,
    recipientName: string,
    reason?: string
  ) {
    const action = kind === "created" ? "등록" : kind === "canceled" ? "취소" : "변경";
    const leadingMessage =
      kind === "created" && event.type === EventType.READING
        ? `${event.production.title} 공연의 리딩 일정이 등록되었습니다. 참석 가능 여부를 확인해 주세요.`
        : `${event.production.title} 공연의 일정이 ${action}되었습니다.`;
    const closingMessage =
      kind === "created" && event.type === EventType.READING
        ? "내 스케줄에서 참석 여부를 응답하고, 연결된 대본 장면과 음악 큐를 확인해 주세요."
        : "자세한 내용은 아트브릿지 내 스케줄에서 확인해 주세요.";
    return [
      `${recipientName}님,`,
      "",
      leadingMessage,
      "",
      `일정: ${event.title}`,
      `유형: ${event.type}`,
      `시간: ${formatKoreanDateTime(event.startAt)} - ${formatKoreanDateTime(event.endAt)}`,
      event.location ? `장소: ${event.location}` : null,
      event.meetingUrl ? `회의 링크: ${event.meetingUrl}` : null,
      `처리자: ${actor.name}`,
      kind === "canceled" && reason ? `취소 사유: ${reason}` : null,
      "",
      closingMessage
    ]
      .filter(Boolean)
      .join("\n");
  }
}
