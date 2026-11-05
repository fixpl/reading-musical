import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { MailService } from "../mail/mail.service";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";

type ScriptChangeType = "script.version_created" | "script.version_restored";

/** 대본 버전 생성/복원 알림·다이제스트 메일 — scripts.service.ts에서 분리. */
@Injectable()
export class ScriptNotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService
  ) {}

  async notifyScriptChange(
    productionId: string,
    scriptId: string,
    actorId: string,
    type: ScriptChangeType,
    payload: Record<string, unknown>
  ) {
    const [script, memberships] = await Promise.all([
      this.prisma.script.findFirst({
        where: { id: scriptId, productionId },
        select: { id: true, title: true, production: { select: { title: true } } }
      }),
      this.prisma.membership.findMany({
        where: { productionId, userId: { not: actorId } },
        select: { userId: true, user: { select: { email: true, name: true } } }
      })
    ]);
    if (!script || memberships.length === 0) return;

    const notificationPayload = {
      scriptId: script.id,
      scriptTitle: script.title,
      ...payload
    } as Prisma.InputJsonValue;
    await Promise.all([
      this.notifications.createNotifications(
        memberships.map((membership) => ({
          productionId,
          userId: membership.userId,
          type,
          payload: notificationPayload
        }))
      ),
      ...memberships.map((membership) =>
        this.mail.queueDigestEmail({
          userId: membership.userId,
          productionId,
          toEmail: membership.user.email,
          templateKey: "script.change_digest",
          subject: `[아트브릿지] ${script.production.title} 대본 변경 요약`,
          bodyText: this.scriptDigestBody({
            recipientName: membership.user.name,
            productionTitle: script.production.title,
            scriptTitle: script.title,
            type,
            payload
          }),
          metadata: {
            scriptId: script.id,
            scriptTitle: script.title,
            notificationType: type,
            ...payload
          }
        })
      )
    ]);
  }

  private scriptDigestBody(input: {
    recipientName: string;
    productionTitle: string;
    scriptTitle: string;
    type: ScriptChangeType;
    payload: Record<string, unknown>;
  }) {
    const action = input.type === "script.version_created" ? "새 대본 버전이 저장되었습니다." : "대본 버전이 복원되었습니다.";
    const label = typeof input.payload.label === "string" ? input.payload.label : null;
    return [
      `${input.recipientName}님,`,
      "",
      `[${input.productionTitle}] ${input.scriptTitle}`,
      action,
      label ? `버전: ${label}` : null,
      "",
      "대본 뷰어에서 변경된 장면, 본인 대사, 큐 마커를 확인해 주세요."
    ].filter(Boolean).join("\n");
  }
}
