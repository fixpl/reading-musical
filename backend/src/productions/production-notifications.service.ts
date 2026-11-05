import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ProductionRole } from "@prisma/client";
import type { RequestUser } from "../common/types/request-user";
import { MailService } from "../mail/mail.service";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import { roleLabel, roleLabels } from "./production-shared.util";

/**
 * 공연 관련 알림/메일 발송 전담. productions.service.ts(공개 전환)와
 * production-members.service.ts(멤버 추가/변경/해제)가 공통으로 쓰던
 * 이메일 본문 템플릿과 발송 로직을 모은다.
 */
@Injectable()
export class ProductionNotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService
  ) {}

  appPublicUrl(): string {
    return (this.config.get<string>("APP_PUBLIC_URL") || "http://localhost:5173").replace(/\/+$/, "");
  }

  async notifyProductionPublished(productionId: string, productionTitle: string, actor: RequestUser) {
    const memberships = await this.prisma.membership.findMany({
      where: { productionId, userId: { not: actor.id } },
      include: {
        user: { select: { id: true, email: true, name: true } },
        roles: { select: { role: true } }
      },
      orderBy: { createdAt: "asc" }
    });
    if (!memberships.length) {
      return { notifications: 0, emailDeliveries: 0 };
    }

    await this.notifications.createNotifications(
      memberships.map((membership) => ({
        userId: membership.userId,
        productionId,
        type: "production.published",
        payload: {
          productionId,
          productionTitle,
          membershipId: membership.id,
          roles: membership.roles.map((role) => role.role),
          publishedByUserId: actor.id,
          publishedByUserName: actor.name
        }
      }))
    );

    await Promise.all(
      memberships.map((membership) =>
        this.mail.queueEmail({
          userId: membership.user.id,
          productionId,
          toEmail: membership.user.email,
          subject: `[아트브릿지] ${productionTitle} 공연 공개 안내`,
          templateKey: "production.published",
          bodyText: this.productionPublishedEmailBody({
            productionTitle,
            recipientName: membership.user.name,
            roles: membership.roles.map((role) => role.role),
            actorName: actor.name,
            productionUrl: `${this.appPublicUrl()}/app/p/${productionId}`
          }),
          metadata: {
            productionId,
            membershipId: membership.id,
            roles: membership.roles.map((role) => role.role),
            publishedByUserId: actor.id,
            publishedByUserName: actor.name,
            fromEmail: this.mail.fromEmail()
          }
        })
      )
    );

    return { notifications: memberships.length, emailDeliveries: memberships.length };
  }

  memberAddedEmailBody(input: {
    productionTitle: string;
    recipientName: string;
    roles: ProductionRole[];
    primaryRole: ProductionRole;
    productionUrl: string;
  }) {
    return [
      `${input.recipientName}님, ${input.productionTitle} 공연에 매칭되었습니다.`,
      "",
      `부여 역할: ${roleLabels(input.roles)}`,
      `대표 역할: ${roleLabel(input.primaryRole)}`,
      "",
      "내 공연에서 대본, 일정, 체크리스트, 알림을 확인해 주세요.",
      input.productionUrl
    ].join("\n");
  }

  memberRoleUpdatedEmailBody(input: {
    productionTitle: string;
    recipientName: string;
    beforeRoles: ProductionRole[];
    roles: ProductionRole[];
    primaryRole: ProductionRole;
    actorName: string;
    productionUrl: string;
  }) {
    return [
      `${input.recipientName}님, ${input.productionTitle} 공연 역할이 변경되었습니다.`,
      "",
      `이전 역할: ${roleLabels(input.beforeRoles)}`,
      `현재 역할: ${roleLabels(input.roles)}`,
      `대표 역할: ${roleLabel(input.primaryRole)}`,
      `변경자: ${input.actorName}`,
      "",
      "역할에 따라 대시보드 할 일과 접근 가능한 화면이 달라질 수 있습니다.",
      input.productionUrl
    ].join("\n");
  }

  memberRemovedEmailBody(input: {
    productionTitle: string;
    recipientName: string;
    roles: ProductionRole[];
    actorName: string;
    productionsUrl: string;
  }) {
    return [
      `${input.recipientName}님, ${input.productionTitle} 공연 매칭이 해제되었습니다.`,
      "",
      `해제된 역할: ${roleLabels(input.roles)}`,
      `처리자: ${input.actorName}`,
      "",
      "이 공연의 대본, 일정, 체크리스트, 진행표 화면 접근 권한이 제거되었습니다.",
      "다른 참여 공연은 내 공연 목록에서 계속 확인할 수 있습니다.",
      input.productionsUrl
    ].join("\n");
  }

  productionPublishedEmailBody(input: {
    productionTitle: string;
    recipientName: string;
    roles: ProductionRole[];
    actorName: string;
    productionUrl: string;
  }) {
    return [
      `${input.recipientName}님, ${input.productionTitle} 공연이 공개되었습니다.`,
      "",
      `내 역할: ${roleLabels(input.roles)}`,
      `공개 처리: ${input.actorName}`,
      "",
      "이제 내 공연 목록에서 공연을 확인할 수 있습니다.",
      "대본, 일정, 체크리스트, 알림을 확인해 주세요.",
      input.productionUrl
    ].join("\n");
  }
}
