import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { RequestUser } from "../common/types/request-user";
import { PrismaService } from "../prisma/prisma.service";
import { CHANGE_NOTIFICATION_TYPES } from "./notification.constants";
import { NotificationCategoryFilter, NotificationListQueryDto, NotificationStatusFilter } from "./dto";
import { NotificationsGateway } from "./notifications.gateway";

type NotificationWithProduction = Prisma.NotificationGetPayload<{
  include: { production: { select: { id: true; title: true; currentPhase: true } } };
}>;

export type CreateNotificationInput = {
  userId: string;
  productionId?: string | null;
  type: string;
  payload?: Prisma.InputJsonValue;
};

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    @Inject(NotificationsGateway)
    private readonly gateway: NotificationsGateway
  ) {}

  async listMine(user: RequestUser, query: NotificationListQueryDto = {}) {
    const where = this.buildWhere(user.id, query);
    const filteredUnreadWhere = this.buildWhere(user.id, { ...query, status: NotificationStatusFilter.UNREAD });
    const [items, unreadCount, filteredUnreadCount, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: query.take ?? 50,
        include: { production: { select: { id: true, title: true, currentPhase: true } } }
      }),
      this.prisma.notification.count({ where: { userId: user.id, readAt: null } }),
      this.prisma.notification.count({ where: filteredUnreadWhere }),
      this.prisma.notification.count({ where })
    ]);

    return {
      unreadCount,
      filteredUnreadCount,
      total,
      items: items.map((notification) => this.serialize(notification))
    };
  }

  async getSummary(user: RequestUser) {
    const [unreadCount, latest] = await Promise.all([
      this.prisma.notification.count({ where: { userId: user.id, readAt: null } }),
      this.prisma.notification.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { production: { select: { id: true, title: true, currentPhase: true } } }
      })
    ]);

    return {
      unreadCount,
      latest: latest.map((notification) => this.serialize(notification))
    };
  }

  async markRead(user: RequestUser, notificationId: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
      include: { production: { select: { id: true, title: true, currentPhase: true } } }
    });
    if (!notification) {
      throw new NotFoundException("알림을 찾을 수 없어요");
    }
    if (notification.userId !== user.id) {
      throw new ForbiddenException("본인 알림만 처리할 수 있어요");
    }
    if (notification.readAt) {
      return this.serialize(notification);
    }

    const updated = await this.prisma.notification.update({
      where: { id: notificationId },
      data: { readAt: new Date() },
      include: { production: { select: { id: true, title: true, currentPhase: true } } }
    });
    const serialized = this.serialize(updated);
    this.gateway.emitNotificationUpdated(user.id, serialized);
    return serialized;
  }

  async markAllRead(user: RequestUser, query: NotificationListQueryDto = {}) {
    const updated = await this.prisma.notification.updateMany({
      where: this.buildWhere(user.id, { ...query, status: NotificationStatusFilter.UNREAD }),
      data: { readAt: new Date() }
    });
    const result = await this.listMine(user, { ...query, status: query.status ?? NotificationStatusFilter.ALL });
    this.gateway.emitSummaryChanged(user.id);
    return { ...result, markedCount: updated.count };
  }

  async createNotification(input: CreateNotificationInput) {
    const notification = await this.prisma.notification.create({
      data: {
        userId: input.userId,
        productionId: input.productionId ?? null,
        type: input.type,
        payload: input.payload ?? {}
      },
      include: { production: { select: { id: true, title: true, currentPhase: true } } }
    });
    const serialized = this.serialize(notification);
    this.gateway.emitNotificationCreated(input.userId, serialized);
    return serialized;
  }

  async createNotifications(inputs: CreateNotificationInput[]) {
    const unique = this.uniqueInputs(inputs);
    const created = [];
    for (const input of unique) {
      created.push(await this.createNotification(input));
    }
    return created;
  }

  emitReadingSessionEvent(eventId: string | null | undefined, event: unknown) {
    if (!eventId) return;
    this.gateway.emitReadingSessionEvent(eventId, event);
  }

  private buildWhere(userId: string, query: NotificationListQueryDto): Prisma.NotificationWhereInput {
    const where: Prisma.NotificationWhereInput = {
      userId,
      productionId: query.productionId || undefined
    };
    if (query.category === NotificationCategoryFilter.CHANGE) {
      where.type = { in: [...CHANGE_NOTIFICATION_TYPES] };
    }
    if (query.status === NotificationStatusFilter.UNREAD) {
      where.readAt = null;
    }
    if (query.status === NotificationStatusFilter.READ) {
      where.readAt = { not: null };
    }
    const q = query.q?.trim();
    if (q) {
      where.OR = [
        { type: { contains: q, mode: "insensitive" } },
        { production: { title: { contains: q, mode: "insensitive" } } }
      ];
    }
    return where;
  }

  private serialize(notification: NotificationWithProduction) {
    const payload = this.toPayload(notification.payload);
    const presentation = this.presentation(notification.type, notification.productionId, payload);
    return {
      id: notification.id,
      productionId: notification.productionId,
      production: notification.production,
      type: notification.type,
      title: presentation.title,
      body: presentation.body,
      href: presentation.href,
      payload,
      readAt: notification.readAt,
      createdAt: notification.createdAt,
      unread: !notification.readAt
    };
  }

  private toPayload(payload: Prisma.JsonValue): Record<string, unknown> {
    return typeof payload === "object" && payload !== null && !Array.isArray(payload) ? payload : {};
  }

  private presentation(type: string, productionId: string | null, payload: Record<string, unknown>) {
    const eventId = this.stringValue(payload.eventId);
    const scriptTitle = this.stringValue(payload.scriptTitle);
    const cueNumber = this.stringValue(payload.cueNumber);
    const message = this.stringValue(payload.message);
    const reason = this.stringValue(payload.reason);
    const titleFromPayload = this.stringValue(payload.title);
    const productionTitle = this.stringValue(payload.productionTitle);
    const roles = this.stringListValue(payload.roles);
    const beforeRoles = this.stringListValue(payload.beforeRoles);
    const productionRoot = productionId ? `/app/p/${productionId}` : "/app";

    if (type === "profile.request") {
      return {
        title: "프로필 보완 요청",
        body: message || reason || "운영자가 프로필 정보 보완을 요청했어요.",
        href: "/app/profile"
      };
    }
    if (type === "production.member_added") {
      const roleText = roles.length ? `${roles.join(", ")} 역할` : "역할";
      return {
        title: "공연에 매칭됐어요",
        body: productionTitle
          ? `${productionTitle}에서 ${roleText}로 연결됐어요. 내 공연에서 작업을 확인해 주세요.`
          : "새 공연에 연결됐어요. 내 공연에서 작업을 확인해 주세요.",
        href: productionRoot
      };
    }
    if (type === "production.member_role_updated") {
      const beforeText = beforeRoles.length ? beforeRoles.join(", ") : "이전 역할";
      const nextText = roles.length ? roles.join(", ") : "새 역할";
      return {
        title: "공연 역할이 변경됐어요",
        body: `${beforeText}에서 ${nextText}로 변경됐어요. 역할별 할 일을 확인해 주세요.`,
        href: productionRoot
      };
    }
    if (type === "production.member_removed") {
      return {
        title: "공연 매칭이 해제됐어요",
        body: productionTitle
          ? `${productionTitle} 공연 접근 권한이 제거됐어요. 내 공연 목록을 확인해 주세요.`
          : "공연 접근 권한이 제거됐어요. 내 공연 목록을 확인해 주세요.",
        href: "/app"
      };
    }
    if (type === "production.published") {
      return {
        title: "공연이 공개됐어요",
        body: productionTitle ? `${productionTitle} 공연이 내 공연 목록에 공개됐어요.` : "공연이 내 공연 목록에 공개됐어요.",
        href: productionRoot
      };
    }
    if (type === "checklist.waiting_approval") {
      return {
        title: "체크리스트 승인 대기",
        body: "담당자가 항목을 완료했고 승인이 필요해요.",
        href: productionRoot
      };
    }
    if (type === "checklist.approved") {
      return {
        title: "체크리스트 승인 완료",
        body: "제출한 항목이 승인되었어요.",
        href: productionRoot
      };
    }
    if (type === "checklist.rejected") {
      return {
        title: "체크리스트 반려",
        body: "제출한 항목이 반려되었어요. 메모를 확인해 주세요.",
        href: productionRoot
      };
    }
    if (type === "schedule.event_created") {
      return {
        title: titleFromPayload || "새 일정이 등록됐어요",
        body: message || "내 스케줄에서 참석 여부와 장소를 확인해 주세요.",
        href: `${productionRoot}/schedule${eventId ? `?eventId=${eventId}` : ""}`
      };
    }
    if (type === "schedule.event_updated") {
      return {
        title: titleFromPayload || "일정이 변경됐어요",
        body: message || "변경된 시간과 장소를 확인해 주세요.",
        href: `${productionRoot}/schedule${eventId ? `?eventId=${eventId}` : ""}`
      };
    }
    if (type === "schedule.event_canceled") {
      return {
        title: titleFromPayload || "일정이 취소됐어요",
        body: message || "취소된 일정을 확인해 주세요.",
        href: `${productionRoot}/schedule`
      };
    }
    if (type === "schedule.attendance_forced") {
      return {
        title: titleFromPayload || "강제 배정된 일정이 있어요",
        body: message || reason || "불가일 또는 다른 일정 충돌이 있지만 운영자가 사유를 남기고 배정했어요.",
        href: `${productionRoot}/schedule${eventId ? `?eventId=${eventId}` : ""}`
      };
    }
    if (type === "schedule.attendance_reminder") {
      return {
        title: titleFromPayload || "출석 응답이 필요해요",
        body: message || "다가오는 일정의 참석 여부를 응답해 주세요.",
        href: `${productionRoot}/schedule${eventId ? `?eventId=${eventId}` : ""}`
      };
    }
    if (type === "script.version_created") {
      return {
        title: "새 대본 버전이 등록됐어요",
        body: scriptTitle ? `${scriptTitle} 최신 버전을 확인해 주세요.` : "최신 대본 버전을 확인해 주세요.",
        href: `${productionRoot}/script`
      };
    }
    if (type === "script.version_restored") {
      return {
        title: "대본 버전이 복원됐어요",
        body: scriptTitle ? `${scriptTitle} 복원본 기준으로 변경 위치를 확인해 주세요.` : "복원된 대본 기준으로 변경 위치를 확인해 주세요.",
        href: `${productionRoot}/script`
      };
    }
    if (type === "music.cue_created") {
      return {
        title: "음악 큐가 추가됐어요",
        body: cueNumber ? `${cueNumber} 큐의 대본 anchor와 재생 지시값을 확인해 주세요.` : "새 음악 큐를 확인해 주세요.",
        href: `${productionRoot}/cuesheet`
      };
    }
    if (type === "music.cue_updated") {
      return {
        title: "음악 큐가 변경됐어요",
        body: cueNumber ? `${cueNumber} 큐의 변경 내용을 확인해 주세요.` : "변경된 음악 큐를 확인해 주세요.",
        href: `${productionRoot}/cuesheet`
      };
    }
    if (type === "music.cue_anchor_updated") {
      return {
        title: "음악 큐 anchor가 변경됐어요",
        body: cueNumber ? `${cueNumber} 큐가 연결된 대본 위치를 확인해 주세요.` : "음악 큐가 연결된 대본 위치를 확인해 주세요.",
        href: `${productionRoot}/cuesheet`
      };
    }
    if (type === "music.cue_deleted") {
      return {
        title: "음악 큐가 삭제됐어요",
        body: cueNumber ? `${cueNumber} 큐가 삭제됐어요. 진행표와 리딩 cue marker를 확인해 주세요.` : "삭제된 음악 큐의 영향을 확인해 주세요.",
        href: `${productionRoot}/cuesheet`
      };
    }
    if (type === "READING_SESSION_STARTED") {
      return {
        title: "리딩이 시작됐어요",
        body: titleFromPayload ? `${titleFromPayload} 리딩 진행 화면으로 이동할 수 있어요.` : "리딩 진행 화면으로 이동할 수 있어요.",
        href: `${productionRoot}/cuesheet`
      };
    }
    if (type === "READING_SESSION_ENDED") {
      return {
        title: "리딩이 종료됐어요",
        body: "리딩 종료 메모와 후속 체크리스트를 확인해 주세요.",
        href: `${productionRoot}/cuesheet`
      };
    }
    return {
      title: "새 알림",
      body: titleFromPayload || message || "확인할 작업이 있어요.",
      href: productionRoot
    };
  }

  private stringValue(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }

  private stringListValue(value: unknown) {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
  }

  private uniqueInputs(inputs: CreateNotificationInput[]) {
    const seen = new Set<string>();
    const unique: CreateNotificationInput[] = [];
    for (const input of inputs) {
      const key = `${input.userId}:${input.productionId ?? ""}:${input.type}:${JSON.stringify(input.payload ?? {})}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      unique.push(input);
    }
    return unique;
  }
}
