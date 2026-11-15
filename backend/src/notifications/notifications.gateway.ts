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
import { PlatformRole } from "@prisma/client";
import { Server, Socket } from "socket.io";
import { PrismaService } from "../prisma/prisma.service";
import { getReadingSocketAccess } from "./reading-socket-access";

type NotificationSocketUser = {
  id: string;
  email: string;
  platformRole: PlatformRole;
};

type GuestReadingSocket = {
  accessId: string;
  productionId: string;
  eventId: string;
  expiresAt: number;
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

@WebSocketGateway({ namespace: "/ws" })
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(NotificationsGateway.name);
  private readonly deliveries = new Map<string, Promise<void>>();

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

    const guest = client.data.guestReading;
    const user = client.data.user;
    if (!guest && !user) {
      return { ok: false, message: "인증되지 않은 연결이에요." };
    }
    if (guest && (guest.productionId !== productionId || guest.eventId !== eventId)) {
      return { ok: false, message: "게스트 링크와 다른 리딩 일정에는 접근할 수 없어요." };
    }

    try {
      const access = await getReadingSocketAccess(this.prisma, eventId, user ? [user.id] : [], guest ? [guest.accessId] : []);
      const currentGuest = guest ? access.guests.get(guest.accessId) : undefined;
      const currentUser = user ? access.users.get(user.id) : undefined;
      if (access.productionId !== productionId || (guest ? (
        !currentGuest || Math.min(currentGuest.expiresAt, guest.expiresAt) <= Date.now()
      ) : (!currentUser?.allowed || currentUser.email !== user?.email))) {
        if (guest) this.closeGuestSocket(client);
        else if (access.productionId === productionId && (!currentUser || !currentUser.active || currentUser.email !== user?.email)) {
          this.closeMemberSocket(client);
        }
        else this.endReadingAccess(client, eventId, productionId);
        return { ok: false, message: "이 리딩 일정에 접근할 권한이 없어요." };
      }
      if (!client.connected) return { ok: false, message: "연결이 종료됐어요." };
      await client.join(this.readingSessionRoom(eventId));
      return { ok: true, mode: guest ? "guest" : "member", room: this.readingSessionRoom(eventId) };
    } catch {
      return { ok: false, message: "접근 권한을 확인하지 못했어요. 잠시 후 다시 시도해 주세요." };
    }
  }

  emitNotificationCreated(userId: string, notification: unknown) {
    return this.emitUserEvents(userId, [["notification.created", notification], ["notification.summary_changed", { userId }]]);
  }

  emitNotificationUpdated(userId: string, notification: unknown) {
    return this.emitUserEvents(userId, [["notification.updated", notification], ["notification.summary_changed", { userId }]]);
  }

  emitSummaryChanged(userId: string) {
    return this.emitUserEvents(userId, [["notification.summary_changed", { userId }]]);
  }

  emitReadingSessionEvent(eventId: string, event: unknown) {
    return this.enqueueDelivery(this.readingSessionRoom(eventId), () => this.deliverReadingEvent(eventId, event));
  }

  /** 철회된 게스트 링크로 붙어 있는 소켓을 모두 끊는다. */
  disconnectGuestAccess(accessId: string) {
    this.forEachGuestSocket((socket) => {
      if (socket.data.guestReading?.accessId === accessId) this.closeGuestSocket(socket);
    });
  }

  private forEachGuestSocket(callback: (socket: NotificationSocket) => void) {
    for (const socket of this.connectedSockets()) {
      if (socket.data?.guestReading) callback(socket);
    }
  }

  private closeGuestSocket(socket: NotificationSocket) {
    socket.emit("notification.error", { message: "게스트 리딩 링크가 만료되었거나 회수됐어요." });
    socket.disconnect(true);
  }

  emitBoardChanged(userIds: string[], productionId: string, postId: string) {
    // 본문은 현재 API 권한으로 다시 조회한다. 변경 알림에는 식별자만 보낸다.
    return Promise.all([...new Set(userIds)].map((userId) =>
      this.emitUserEvents(userId, [["board.changed", { productionId, postId }]])
    ));
  }

  /** 비동기 권한 조회가 페이지 동기화·큐 발화 순서를 뒤집지 않도록 room별로 직렬화한다. */
  private enqueueDelivery(key: string, deliver: () => Promise<void>) {
    const next = (this.deliveries.get(key) ?? Promise.resolve()).then(deliver).catch(() => {
      // DB 오류에서는 보호된 payload를 전송하지 않는다. 예외 원문에는 인증 정보를 남기지 않는다.
      this.logger.warn("Socket authorization failed; protected delivery skipped");
    });
    this.deliveries.set(key, next);
    void next.then(() => { if (this.deliveries.get(key) === next) this.deliveries.delete(key); });
    return next;
  }

  private connectedSockets(): NotificationSocket[] {
    // namespace gateway의 sockets는 Map이다. 연결 전·종료 뒤에는 전송 대상이 없다.
    const sockets = (this.server as unknown as { sockets?: Map<string, NotificationSocket> } | undefined)?.sockets;
    return sockets && typeof sockets.values === "function" ? Array.from(sockets.values()) : [];
  }

  private socketsInRoom(room: string) {
    return this.connectedSockets().filter((socket) => socket.connected && socket.rooms.has(room));
  }

  private async deliverReadingEvent(eventId: string, event: unknown) {
    const room = this.readingSessionRoom(eventId);
    const sockets = this.socketsInRoom(room);
    if (!sockets.length) return;
    const access = await getReadingSocketAccess(
      this.prisma,
      eventId,
      sockets.flatMap((socket) => socket.data.user ? [socket.data.user.id] : []),
      sockets.flatMap((socket) => socket.data.guestReading ? [socket.data.guestReading.accessId] : [])
    );
    const type = this.readingEventType(event);
    for (const socket of sockets) {
      // 조회 중 철회·disconnect된 연결에는 보호된 payload를 보내지 않는다.
      if (!socket.connected || !socket.rooms.has(room)) continue;
      const guest = socket.data.guestReading;
      const user = socket.data.user;
      if (guest) {
        const current = access.guests.get(guest.accessId);
        if (guest.eventId !== eventId || !current || current.productionId !== guest.productionId ||
          Math.min(current.expiresAt, guest.expiresAt) <= Date.now()) {
          this.closeGuestSocket(socket);
          continue;
        }
      } else if (user) {
        const current = access.users.get(user.id);
        if (access.productionId && (!current || !current.active || current.email !== user.email)) {
          this.closeMemberSocket(socket);
          continue;
        }
        if (!current?.allowed) {
          this.endReadingAccess(socket, eventId, access.productionId);
          continue;
        }
      } else {
        this.endReadingAccess(socket, eventId, access.productionId);
        continue;
      }
      socket.emit("reading-session.event", event);
      socket.emit(`reading-session.${type}`, event);
    }
  }

  private endReadingAccess(socket: NotificationSocket, eventId: string, productionId: string | null) {
    void socket.leave(this.readingSessionRoom(eventId));
    socket.emit("reading-session.access-ended", { productionId, eventId, message: "이 리딩 일정에 접근할 권한이 없어요." });
  }

  private closeMemberSocket(socket: NotificationSocket) {
    socket.emit("notification.error", { message: "세션이 만료됐어요. 다시 로그인해 주세요." });
    socket.disconnect(true);
  }

  private emitUserEvents(userId: string, events: Array<[string, unknown]>) {
    const room = this.userRoom(userId);
    return this.enqueueDelivery(room, async () => {
      const sockets = this.socketsInRoom(room);
      if (!sockets.length) return;
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, status: true } });
      for (const socket of sockets) {
        if (!socket.connected || !socket.rooms.has(room)) continue;
        if (!user || user.status !== "ACTIVE" || socket.data.user?.id !== user.id || socket.data.user.email !== user.email) {
          this.closeMemberSocket(socket);
          continue;
        }
        for (const [name, payload] of events) socket.emit(name, payload);
      }
    });
  }

  private async connectGuestReading(client: NotificationSocket, token: string) {
    try {
      const access = await this.prisma.guestReadingAccess.findUnique({
        where: { token },
        select: {
          id: true,
          productionId: true,
          eventId: true,
          expiresAt: true,
          revokedAt: true,
          production: { select: { deletedAt: true } }
        }
      });
      if (!access || access.revokedAt || access.production.deletedAt || access.expiresAt.getTime() <= Date.now()) {
        throw new Error("inactive guest token");
      }

      client.data.guestReading = {
        accessId: access.id,
        productionId: access.productionId,
        eventId: access.eventId,
        expiresAt: access.expiresAt.getTime()
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

  // 토큰은 auth·Authorization 헤더로만 받는다. query string은 프록시 로그에 남아 받지 않는다.
  private extractToken(client: NotificationSocket) {
    const authToken = this.stringValue(client.handshake.auth?.token);
    if (authToken) return authToken;

    const header = client.handshake.headers.authorization;
    if (typeof header === "string" && header.toLowerCase().startsWith("bearer ")) {
      return header.slice("bearer ".length).trim();
    }
    return null;
  }

  private extractGuestReadingToken(client: NotificationSocket) {
    return (
      this.stringValue(client.handshake.auth?.guestReadingToken) ||
      this.stringValue(client.handshake.auth?.guestToken)
    );
  }

  private readingEventType(event: unknown) {
    if (typeof event === "object" && event && "type" in event) {
      const type = (event as { type?: unknown }).type;
      if (typeof type === "string" && type.trim()) return type.trim();
    }
    return "event";
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
