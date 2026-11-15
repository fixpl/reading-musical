import { PlatformRole, ProductionRole, UserStatus } from "@prisma/client";
import { NotificationsGateway } from "./notifications.gateway";

const EVENT = "event";
const PRODUCTION = "production";
const ROOM = `reading-session:${EVENT}`;
const liveEvent = (sequence = 1) => ({ type: "page-sync", eventId: EVENT, productionId: PRODUCTION, progressNote: `진행 메모 ${sequence}` });

function member(id: string, roles: ProductionRole[] = [ProductionRole.ACTOR], attending = true) {
  return {
    id,
    email: `${id}@example.test`,
    status: UserStatus.ACTIVE as UserStatus,
    platformRole: PlatformRole.MEMBER as PlatformRole,
    organizationId: null as string | null,
    memberships: [{ roles: roles.map((role) => ({ role })), attendances: attending ? [{ id: `attendance:${id}` }] : [] }]
  };
}

function setup() {
  const users = new Map<string, ReturnType<typeof member>>();
  const guests = new Map<string, { id: string; eventId: string; productionId: string; expiresAt: Date; revokedAt: Date | null }>();
  let deleted = false;
  const prisma = {
    scheduleEvent: {
      findFirst: jest.fn(async () => deleted ? null : { productionId: PRODUCTION, production: { organizationId: "our-organization" } })
    },
    user: {
      findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.flatMap((id) => users.get(id) ? [users.get(id)!] : [])),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => users.get(where.id) ?? null)
    },
    guestReadingAccess: {
      findMany: jest.fn(async ({ where }: { where: { id: { in: string[] }; expiresAt: { gt: Date } } }) => where.id.in.flatMap((id) => {
        const access = guests.get(id);
        return access && !access.revokedAt && access.expiresAt > where.expiresAt.gt && access.eventId === EVENT && access.productionId === PRODUCTION ? [access] : [];
      }))
    }
  };
  const gateway = new NotificationsGateway({} as never, {} as never, prisma as never);
  const sockets = new Map<string, ReturnType<typeof createSocket>>();
  const namespace = { sockets, to: jest.fn() };
  Object.assign(gateway, { server: namespace });

  function createSocket(id: string, principal: Record<string, unknown>, joined = true) {
    const socket = {
      id,
      data: principal,
      connected: true,
      rooms: new Set(joined ? [ROOM] : []),
      emit: jest.fn(),
      join: jest.fn(async (room: string) => { socket.rooms.add(room); }),
      leave: jest.fn((room: string) => { socket.rooms.delete(room); }),
      disconnect: jest.fn(() => { socket.connected = false; socket.rooms.clear(); })
    };
    sockets.set(id, socket);
    return socket;
  }
  function addUser(id: string, roles?: ProductionRole[], attending?: boolean) {
    const record = member(id, roles, attending);
    users.set(id, record);
    // 연결 후의 DB 상태와 분리해 캐시된 역할로 접근이 유지되지 않는지 검증한다.
    const socket = createSocket(id, { user: { id, email: record.email, platformRole: record.platformRole } });
    socket.rooms.add(`user:${id}`);
    return { record, socket };
  }
  function addGuest(id: string, expiresAt = new Date(Date.now() + 60_000)) {
    const record = { id, eventId: EVENT, productionId: PRODUCTION, expiresAt, revokedAt: null as Date | null };
    guests.set(id, record);
    const socket = createSocket(id, { guestReading: { accessId: id, eventId: EVENT, productionId: PRODUCTION, expiresAt: expiresAt.getTime() } });
    return { record, socket };
  }
  return { gateway, prisma, users, sockets, namespace, addUser, addGuest, deleteProduction: () => { deleted = true; } };
}

function received(socket: { emit: jest.Mock }) {
  return socket.emit.mock.calls.filter(([name]) => name === "reading-session.event").map(([, event]) => event);
}

describe("reading socket authorization at delivery", () => {
  test("current operators and registered participants receive the generic and typed event", async () => {
    const context = setup();
    const director = context.addUser("director", [ProductionRole.DIRECTOR], false);
    const actor = context.addUser("actor");
    await context.gateway.emitReadingSessionEvent(EVENT, liveEvent());
    for (const { socket } of [director, actor]) {
      expect(received(socket)).toEqual([liveEvent()]);
      expect(socket.emit).toHaveBeenCalledWith("reading-session.page-sync", liveEvent());
    }
    expect(context.prisma.user.findMany).toHaveBeenCalledTimes(1);
    expect(context.prisma.scheduleEvent.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: EVENT, production: { deletedAt: null } } }));
    expect(context.namespace.to).not.toHaveBeenCalled();
  });

  test.each(["membership", "attendance", "role"])("removing %s after join ends access before the next internal note", async (change) => {
    const context = setup();
    const { record, socket } = context.addUser("member", change === "role" ? [ProductionRole.DIRECTOR] : [ProductionRole.ACTOR], change !== "role");
    await context.gateway.emitReadingSessionEvent(EVENT, liveEvent(1));
    if (change === "membership") record.memberships = [];
    if (change === "attendance") record.memberships[0].attendances = [];
    if (change === "role") record.memberships[0].roles = [{ role: ProductionRole.ACTOR }];
    await context.gateway.emitReadingSessionEvent(EVENT, liveEvent(2));
    expect(received(socket)).toEqual([liveEvent(1)]);
    expect(socket.leave).toHaveBeenCalledWith(ROOM);
    expect(socket.rooms.has(ROOM)).toBe(false);
    expect(socket.emit).toHaveBeenCalledWith("reading-session.access-ended", expect.objectContaining({ eventId: EVENT }));
    expect(socket.connected).toBe(true);
  });

  test("blocking a member disconnects all their private event delivery", async () => {
    const context = setup();
    const { record, socket } = context.addUser("blocked");
    record.status = UserStatus.BLOCKED;
    await context.gateway.emitReadingSessionEvent(EVENT, liveEvent());
    await context.gateway.emitNotificationCreated(record.id, { body: "개인 알림" });
    expect(received(socket)).toEqual([]);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(socket.emit).not.toHaveBeenCalledWith("notification.created", expect.anything());
  });

  test("a removed platform role cannot keep privileges cached at connection", async () => {
    const context = setup();
    const { record, socket } = context.addUser("former-admin", [], false);
    Object.assign(socket.data.user as object, { platformRole: PlatformRole.SUPER_ADMIN });
    record.memberships = [];
    await context.gateway.emitReadingSessionEvent(EVENT, liveEvent());
    expect(received(socket)).toEqual([]);
    expect(socket.leave).toHaveBeenCalledWith(ROOM);
  });

  test("scoped organization admins can join without membership, foreign admins need ordinary attendance", async () => {
    const context = setup();
    const own = context.addUser("own-admin", [], false);
    const foreign = context.addUser("foreign-admin", [ProductionRole.ACTOR], false);
    own.record.platformRole = foreign.record.platformRole = PlatformRole.ORG_ADMIN;
    own.record.organizationId = "our-organization";
    foreign.record.organizationId = "other-organization";
    own.record.memberships = [];
    const joined = await context.gateway.handleReadingSessionJoin(own.socket as never, { productionId: PRODUCTION, eventId: EVENT });
    expect(joined.ok).toBe(true);
    await context.gateway.emitReadingSessionEvent(EVENT, liveEvent());
    expect(received(own.socket)).toEqual([liveEvent()]);
    expect(received(foreign.socket)).toEqual([]);
    foreign.record.memberships[0].attendances = [{ id: "added-attendance" }];
    await context.gateway.handleReadingSessionJoin(foreign.socket as never, { productionId: PRODUCTION, eventId: EVENT });
    await context.gateway.emitReadingSessionEvent(EVENT, liveEvent(2));
    expect(received(foreign.socket)).toEqual([liveEvent(2)]);
  });

  test("production deletion ends reading access without closing unrelated member notifications", async () => {
    const context = setup();
    const member = context.addUser("member");
    const guest = context.addGuest("guest");
    context.deleteProduction();
    await context.gateway.emitReadingSessionEvent(EVENT, liveEvent());
    expect(received(member.socket)).toEqual([]);
    expect(received(guest.socket)).toEqual([]);
    expect(member.socket.rooms.has(ROOM)).toBe(false);
    expect(member.socket.connected).toBe(true);
    expect(guest.socket.disconnect).toHaveBeenCalledWith(true);
  });

  test.each(["revoked", "expired"])("a %s guest link is checked against current DB state before delivery", async (state) => {
    const context = setup();
    const valid = context.addGuest("valid-guest");
    const rejected = context.addGuest("rejected-guest");
    if (state === "revoked") rejected.record.revokedAt = new Date();
    else rejected.record.expiresAt = new Date(Date.now() - 1);
    await context.gateway.emitReadingSessionEvent(EVENT, liveEvent());
    expect(received(valid.socket)).toEqual([liveEvent()]);
    expect(received(rejected.socket)).toEqual([]);
    expect(rejected.socket.disconnect).toHaveBeenCalledWith(true);
    expect(rejected.socket.emit).toHaveBeenCalledWith("notification.error", expect.objectContaining({ message: expect.any(String) }));
  });

  test("an explicit guest revoke during authorization cannot deliver its pending event", async () => {
    const context = setup();
    const guest = context.addGuest("guest");
    let finish!: (rows: Array<typeof guest.record>) => void;
    context.prisma.guestReadingAccess.findMany.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const delivery = context.gateway.emitReadingSessionEvent(EVENT, liveEvent());
    await new Promise((resolve) => setImmediate(resolve));
    context.gateway.disconnectGuestAccess("guest");
    finish([guest.record]);
    await delivery;
    expect(received(guest.socket)).toEqual([]);
    expect(guest.socket.disconnect).toHaveBeenCalledWith(true);
  });

  test("event authorization is FIFO even when the first query is delayed", async () => {
    const context = setup();
    const { socket } = context.addUser("member");
    let finish!: () => void;
    context.prisma.scheduleEvent.findFirst.mockImplementationOnce(() => new Promise((resolve) => {
      finish = () => resolve({ productionId: PRODUCTION, production: { organizationId: "our-organization" } });
    }));
    const first = context.gateway.emitReadingSessionEvent(EVENT, liveEvent(1));
    const second = context.gateway.emitReadingSessionEvent(EVENT, liveEvent(2));
    await new Promise((resolve) => setImmediate(resolve));
    expect(context.prisma.scheduleEvent.findFirst).toHaveBeenCalledTimes(1);
    finish();
    await Promise.all([first, second]);
    expect(received(socket)).toEqual([liveEvent(1), liveEvent(2)]);
  });

  test("a DB authorization error skips protected payload and permits a later authorized retry", async () => {
    const context = setup();
    const { socket } = context.addUser("member");
    context.prisma.scheduleEvent.findFirst.mockRejectedValueOnce(new Error("unavailable"));
    await expect(context.gateway.emitReadingSessionEvent(EVENT, liveEvent(1))).resolves.toBeUndefined();
    expect(received(socket)).toEqual([]);
    await context.gateway.emitReadingSessionEvent(EVENT, liveEvent(2));
    expect(received(socket)).toEqual([liveEvent(2)]);
  });

  test("joining a room after recipient selection cannot receive an unchecked broadcast", async () => {
    const context = setup();
    const first = context.addUser("first");
    let finish!: () => void;
    context.prisma.scheduleEvent.findFirst.mockImplementationOnce(() => new Promise((resolve) => {
      finish = () => resolve({ productionId: PRODUCTION, production: { organizationId: "our-organization" } });
    }));
    const delivery = context.gateway.emitReadingSessionEvent(EVENT, liveEvent());
    await new Promise((resolve) => setImmediate(resolve));
    const late = context.addUser("late");
    finish();
    await delivery;
    expect(received(first.socket)).toEqual([liveEvent()]);
    expect(received(late.socket)).toEqual([]);
  });
});

describe("personal socket notifications", () => {
  test("a currently blocked account receives no personal payload even without a reading event", async () => {
    const context = setup();
    const { record, socket } = context.addUser("blocked");
    record.status = UserStatus.BLOCKED;
    await context.gateway.emitNotificationUpdated(record.id, { body: "개인 알림" });
    expect(socket.emit).not.toHaveBeenCalledWith("notification.updated", expect.anything());
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  test("ordinary recruitment recipients without membership retain their own notifications and order", async () => {
    const context = setup();
    const { record, socket } = context.addUser("applicant", [], false);
    record.memberships = [];
    await context.gateway.emitNotificationCreated(record.id, { type: "RECRUITMENT_APPLICATION_UPDATED" });
    await context.gateway.emitNotificationUpdated(record.id, { read: true });
    expect(socket.emit.mock.calls.map(([name]) => name)).toEqual([
      "notification.created", "notification.summary_changed", "notification.updated", "notification.summary_changed"
    ]);
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  test("a changed email invalidates the connected identity before private payload delivery", async () => {
    const context = setup();
    const { record, socket } = context.addUser("member");
    record.email = "new@example.test";
    await context.gateway.emitNotificationCreated(record.id, { body: "개인 알림" });
    expect(socket.emit).not.toHaveBeenCalledWith("notification.created", expect.anything());
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });
});
