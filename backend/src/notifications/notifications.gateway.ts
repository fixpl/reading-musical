import { Inject, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer
} from "@nestjs/websockets";
import { PlatformRole, ProductionRole } from "@prisma/client";
import { Server, Socket } from "socket.io";
import { PrismaService } from "../prisma/prisma.service";

type NotificationSocketUser = {
  id: string;
  email: string;
  platformRole: PlatformRole;
};

type GuestReadingSocket = {
  accessId: string;
  productionId: string;
  eventId: string;
};

type ReadingSessionJoinBody = {
  productionId?: unknown;
  eventId?: unknown;
};

type NotificationSocket = Socket & {
  data: Socket["data"] & {
    user?: NotificationSocketUser;
    guestReading?: GuestReadingSocket;
  };
};

const READING_VIEW_OPERATOR_ROLES = [
  ProductionRole.PRODUCER,
  ProductionRole.DIRECTOR,
  ProductionRole.MUSIC_DIRECTOR,
  ProductionRole.STAGE_MANAGER
];

@WebSocketGateway({ namespace: "/ws" })
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(NotificationsGateway.name);

  @WebSocketServer()
  private server!: Server;

  constructor(
    @Inject(JwtService)
    private readonly jwt: JwtService,
    @Inject(ConfigService)
    private readonly config: ConfigService,
    @Inject(PrismaService)
    private readonly prisma: PrismaService
  ) {}

  async handleConnection(client: NotificationSocket) {
    const token = this.extractToken(client);
    const guestReadingToken = this.extractGuestReadingToken(client);
    if (!token && !guestReadingToken) {
      client.emit("notification.error", { message: "인증 토큰이 필요해요." });
      client.disconnect(true);
      return;
    }

    if (guestReadingToken && !token) {
      await this.connectGuestReading(client, guestReadingToken);
      return;
    }

    if (!token) {
      client.emit("notification.error", { message: "인증 토큰이 필요해요." });
      client.disconnect(true);
      return;
    }

    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; email: string }>(token, {
        secret: this.config.get<string>("JWT_ACCESS_SECRET")
      });
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, email: true, platformRole: true, status: true, memberships: { select: { productionId: true } } }
      });
      if (!user || user.email !== payload.email || user.status !== "ACTIVE") {
        throw new Error("inactive user");
      }

      client.data.user = { id: user.id, email: user.email, platformRole: user.platformRole };
      await client.join(this.userRoom(user.id));
      await Promise.all(user.memberships.map((membership) => client.join(this.productionRoom(membership.productionId))));
      client.emit("notification.connected", {
        userId: user.id,
        rooms: {
          user: this.userRoom(user.id),
          productions: user.memberships.map((membership) => membership.productionId)
        }
      });
    } catch {
      client.emit("notification.error", { message: "세션이 만료됐어요. 다시 로그인해 주세요." });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: NotificationSocket) {
    if (client.data.user) {
      this.logger.debug(`notification socket disconnected: ${client.data.user.id}`);
    }
    if (client.data.guestReading) {
      this.logger.debug(`guest reading socket disconnected: ${client.data.guestReading.accessId}`);
    }
  }

  @SubscribeMessage("notification.ping")
  handlePing(@ConnectedSocket() client: NotificationSocket, @MessageBody() body: unknown) {
    const user = client.data.user;
    if (!user) {
      return { ok: false, message: "인증되지 않은 연결이에요." };
    }
    return { ok: true, userId: user.id, echo: body ?? null };
  }

  @SubscribeMessage("reading-session.join")
  async handleReadingSessionJoin(@ConnectedSocket() client: NotificationSocket, @MessageBody() body: ReadingSessionJoinBody) {
    const productionId = this.stringValue(body?.productionId);
    const eventId = this.stringValue(body?.eventId);
    if (!productionId || !eventId) {
      return { ok: false, message: "공연과 리딩 일정 정보가 필요해요." };
    }

    const guestReading = client.data.guestReading;
    if (guestReading) {
      if (guestReading.productionId !== productionId || guestReading.eventId !== eventId) {
        return { ok: false, message: "게스트 링크와 다른 리딩 일정에는 접근할 수 없어요." };
      }
      await client.join(this.readingSessionRoom(eventId));
      return { ok: true, mode: "guest", room: this.readingSessionRoom(eventId) };
    }

    const user = client.data.user;
    if (!user) {
      return { ok: false, message: "인증되지 않은 연결이에요." };
    }

    const event = await this.prisma.scheduleEvent.findFirst({
      where: { id: eventId, productionId },
      select: { id: true }
    });
    if (!event) {
      return { ok: false, message: "리딩 일정을 찾을 수 없어요." };
    }

    if (user.platformRole !== PlatformRole.SUPER_ADMIN) {
      const membership = await this.prisma.membership.findFirst({
        where: { productionId, userId: user.id },
        include: { roles: true }
      });
      if (!membership) {
        return { ok: false, message: "이 리딩 일정에 접근할 권한이 없어요." };
      }

      const roles = membership.roles.map((role) => role.role);
      if (!this.hasAnyRole(roles, READING_VIEW_OPERATOR_ROLES)) {
        const attendanceCount = await this.prisma.attendance.count({
          where: { eventId, membershipId: membership.id }
        });
        if (attendanceCount === 0) {
          return { ok: false, message: "참석자로 등록된 리딩 일정만 볼 수 있어요." };
        }
      }
    }

    await client.join(this.readingSessionRoom(eventId));
    return { ok: true, mode: "member", room: this.readingSessionRoom(eventId) };
  }

  emitNotificationCreated(userId: string, notification: unknown) {
    this.server?.to(this.userRoom(userId)).emit("notification.created", notification);
    this.emitSummaryChanged(userId);
  }

  emitNotificationUpdated(userId: string, notification: unknown) {
    this.server?.to(this.userRoom(userId)).emit("notification.updated", notification);
    this.emitSummaryChanged(userId);
  }

  emitSummaryChanged(userId: string) {
    this.server?.to(this.userRoom(userId)).emit("notification.summary_changed", { userId });
  }

  emitReadingSessionEvent(eventId: string, event: unknown) {
    const type = this.readingEventType(event);
    const room = this.readingSessionRoom(eventId);
    this.server?.to(room).emit("reading-session.event", event);
    this.server?.to(room).emit(`reading-session.${type}`, event);
  }

  private async connectGuestReading(client: NotificationSocket, token: string) {
    try {
      const access = await this.prisma.guestReadingAccess.findUnique({
        where: { token },
        select: { id: true, productionId: true, eventId: true, expiresAt: true, revokedAt: true }
      });
      if (!access || access.revokedAt || access.expiresAt.getTime() <= Date.now()) {
        throw new Error("inactive guest token");
      }

      client.data.guestReading = {
        accessId: access.id,
        productionId: access.productionId,
        eventId: access.eventId
      };
      await client.join(this.readingSessionRoom(access.eventId));
      client.emit("reading-session.connected", {
        mode: "guest",
        productionId: access.productionId,
        eventId: access.eventId,
        room: this.readingSessionRoom(access.eventId)
      });
    } catch {
      client.emit("notification.error", { message: "게스트 리딩 링크가 만료되었거나 회수됐어요." });
      client.disconnect(true);
    }
  }

  private extractToken(client: NotificationSocket) {
    const authToken = this.stringValue(client.handshake.auth?.token);
    if (authToken) return authToken;

    const queryToken = this.stringValue(client.handshake.query?.token);
    if (queryToken) return queryToken;

    const header = client.handshake.headers.authorization;
    if (typeof header === "string" && header.toLowerCase().startsWith("bearer ")) {
      return header.slice("bearer ".length).trim();
    }
    return null;
  }

  private extractGuestReadingToken(client: NotificationSocket) {
    return (
      this.stringValue(client.handshake.auth?.guestReadingToken) ||
      this.stringValue(client.handshake.auth?.guestToken) ||
      this.stringValue(client.handshake.query?.guestReadingToken) ||
      this.stringValue(client.handshake.query?.guestToken)
    );
  }

  private readingEventType(event: unknown) {
    if (typeof event === "object" && event && "type" in event) {
      const type = (event as { type?: unknown }).type;
      if (typeof type === "string" && type.trim()) return type.trim();
    }
    return "event";
  }

  private hasAnyRole(roles: ProductionRole[], allowed: ProductionRole[]) {
    return roles.some((role) => allowed.includes(role));
  }

  private stringValue(value: unknown): string | null {
    if (Array.isArray(value)) {
      return this.stringValue(value[0]);
    }
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }

  private userRoom(userId: string) {
    return `user:${userId}`;
  }

  private productionRoom(productionId: string) {
    return `production:${productionId}`;
  }

  private readingSessionRoom(eventId: string) {
    return `reading-session:${eventId}`;
  }
}
