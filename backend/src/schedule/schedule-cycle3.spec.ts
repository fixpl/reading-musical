import "reflect-metadata";
import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { AttendanceStatus, EventType, ProductionRole } from "@prisma/client";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { PRODUCTION_ROLES_KEY } from "../common/decorators/production-roles.decorator";
import { CreateAvailabilityDto, CreateScheduleEventDto, DeleteScheduleEventDto, UpsertAttendanceDto } from "./dto";
import { ProductionScheduleController } from "./schedule.controller";
import { foldIcsLine } from "./schedule-ics.util";
import { ScheduleNotificationsService } from "./schedule-notifications.service";
import { ScheduleService } from "./schedule.service";

function fixture() {
  const actor = { id: "operator", name: "제작진" };
  const event = {
    id: "event", productionId: "production", type: EventType.REHEARSAL as EventType, title: "합본",
    startAt: new Date("2026-10-23T10:00:00Z"), endAt: new Date("2026-10-23T11:00:00Z"),
    location: null, meetingUrl: null, production: { id: "production", title: "공연", organizationId: "org" },
    attendances: [{
      id: "attendance", membershipId: "member", status: AttendanceStatus.ACCEPTED,
      forced: true, forcedReason: "필수 리허설",
      membership: { user: { id: "actor", name: "배우", email: "actor@example.test" } }
    }], scenes: [], musicCues: []
  };
  const tx = {
    attendance: { upsert: jest.fn().mockResolvedValue(event.attendances[0]), updateMany: jest.fn(), deleteMany: jest.fn() },
    scheduleEvent: { update: jest.fn().mockResolvedValue(event) }
  };
  const prisma = {
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    attendance: { findMany: jest.fn().mockResolvedValue([]) },
    availability: { findMany: jest.fn().mockResolvedValue([]) }
  };
  const scheduleNotifications = new ScheduleNotificationsService(prisma as never, {} as never, {} as never);
  const service = new ScheduleService(prisma as never, scheduleNotifications);
  const internal = service as any;
  jest.spyOn(internal, "assertEvent").mockResolvedValue(event);
  jest.spyOn(internal, "assertEditPermission").mockResolvedValue(undefined);
  jest.spyOn(internal, "assertMembershipIds").mockResolvedValue(undefined);
  const conflicts = jest.spyOn(internal, "findConflicts").mockResolvedValue([]);
  const notify = jest.spyOn(scheduleNotifications, "createScheduleEventNotifications").mockResolvedValue({ notifications: 0, emailDeliveries: 0 });
  jest.spyOn(scheduleNotifications, "handleForcedAttendances").mockResolvedValue({ logs: 0, notifications: 0, emailDeliveries: 0 });
  return { service, internal, actor, event, prisma, tx, conflicts, notify, scheduleNotifications };
}

describe("schedule cycle 3 regressions", () => {
  it("preserves forced attendance and responses when only title or location changes", async () => {
    const { service, actor, conflicts, tx, notify, event } = fixture();
    conflicts.mockResolvedValue([{ membershipId: "member" }]);
    await service.updateEvent("production", "event", { title: "수정한 합본", location: "연습실" }, actor as never);
    expect(conflicts).not.toHaveBeenCalled();
    expect(tx.attendance.upsert).not.toHaveBeenCalled();
    expect(tx.attendance.updateMany).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(event, actor, "updated", true, undefined, false);
  });

  it("does not clear forced state when the same attendee list is submitted", async () => {
    const { service, actor, conflicts, tx } = fixture();
    await service.updateEvent("production", "event", { attendeeMembershipIds: ["member"] }, actor as never);
    expect(conflicts).not.toHaveBeenCalled();
    expect(tx.attendance.upsert.mock.calls[0][0].update).toEqual({});
    expect(tx.attendance.updateMany).not.toHaveBeenCalled();
  });

  it("checks changed times and resets only accepted or tentative responses in the transaction", async () => {
    const { service, actor, conflicts, tx, notify, event } = fixture();
    await service.updateEvent("production", "event", { startAt: "2026-10-23T09:30:00Z" }, actor as never);
    expect(conflicts).toHaveBeenCalledWith("production", ["member"], {
      startAt: new Date("2026-10-23T09:30:00Z"), endAt: event.endAt
    }, "event");
    expect(tx.attendance.updateMany).toHaveBeenCalledWith({
      where: { eventId: "event", status: { in: [AttendanceStatus.ACCEPTED, AttendanceStatus.TENTATIVE] } },
      data: { status: AttendanceStatus.INVITED }
    });
    expect(notify).toHaveBeenCalledWith(event, actor, "updated", true, undefined, true);
  });

  it("returns the saved schedule when preparing update notifications fails after commit", async () => {
    const { service, actor, tx, notify, event } = fixture();
    notify.mockRejectedValueOnce(new Error("mail queue unavailable"));
    await expect(service.updateEvent("production", "event", { location: "연습실 B" }, actor as never))
      .resolves.toMatchObject({ id: event.id, notificationWarning: true });
    expect(tx.scheduleEvent.update).toHaveBeenCalledTimes(1);
  });

  it("still rejects conflicts when the attendee list changes", async () => {
    const { service, actor, conflicts, prisma } = fixture();
    conflicts.mockResolvedValue([{ membershipId: "new-member" }]);
    await expect(service.updateEvent("production", "event", { attendeeMembershipIds: ["new-member"] }, actor as never))
      .rejects.toThrow(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("asks for a new response in notifications and mail only when time changed", () => {
    const { scheduleNotifications, actor, event } = fixture();
    const internal = scheduleNotifications as any;
    expect(internal.scheduleNotificationPayload(event, actor, "updated", undefined, true).message).toContain("다시 응답해 주세요");
    expect(internal.scheduleEmailBody(event, actor, "updated", "배우", undefined, true)).toContain("다시 응답해 주세요");
    expect(internal.scheduleNotificationPayload(event, actor, "updated").message).not.toContain("다시 응답");
    expect(internal.scheduleEmailBody(event, actor, "updated", "배우")).not.toContain("다시 응답");
  });

  it("excludes soft-deleted productions from reminder candidates", async () => {
    const { scheduleNotifications, prisma } = fixture();
    await scheduleNotifications.sendAttendanceReminders({ now: new Date("2026-10-23T00:00:00Z") });
    expect(prisma.attendance.findMany.mock.calls[0][0].where.event.production).toEqual({ deletedAt: null });
  });

  it("limits suggestion access to roles that can create schedules, including at the service boundary", async () => {
    const roles = Reflect.getMetadata(PRODUCTION_ROLES_KEY, ProductionScheduleController.prototype.suggest) as ProductionRole[];
    expect(roles).toContain(ProductionRole.ACTOR);
    expect(roles).toContain(ProductionRole.STAFF);
    expect(roles).not.toContain(ProductionRole.GUEST);
    const { service, internal, actor } = fixture();
    const permission = jest.spyOn(internal, "assertMembership").mockRejectedValue(new ForbiddenException());
    await expect(service.suggest("production", actor as never, {})).rejects.toThrow(ForbiddenException);
    expect(permission).toHaveBeenCalledWith("production", actor, expect.any(Array));
    expect(new Set(permission.mock.calls[0][2] as ProductionRole[])).toEqual(new Set(roles));
  });

  it("keeps an existing attendance response if an administrator omits status", async () => {
    const { service, internal, actor, tx } = fixture();
    jest.spyOn(internal, "getUserMembership").mockResolvedValue(null);
    await service.upsertAttendance("production", "event", { membershipId: "member" }, actor as never);
    const write = tx.attendance.upsert.mock.calls[0][0];
    expect(write.update.status).toBeUndefined();
    expect(write.create.status).toBe(AttendanceStatus.INVITED);
  });

  it("folds Korean and emoji ICS content within 75 UTF-8 octets without splitting characters", () => {
    const original = `SUMMARY:${"한글🎭".repeat(40)}`;
    const lines = foldIcsLine(original);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((line) => Buffer.byteLength(line, "utf8") <= 75)).toBe(true);
    expect(lines.slice(1).every((line) => line.startsWith(" "))).toBe(true);
    expect(lines.map((line, index) => index ? line.slice(1) : line).join("")).toBe(original);
  });

  it("uses the same Korean event labels in mail, reminders and ICS exports", async () => {
    const { service, scheduleNotifications, actor, event, prisma } = fixture();
    const internal = scheduleNotifications as any;
    event.type = EventType.MUSIC_PRACTICE;
    const attendance = { ...event.attendances[0], event };
    prisma.attendance.findMany.mockResolvedValue([attendance] as never);
    expect(internal.scheduleEmailBody(event, actor, "created", "배우")).toContain("유형: 음악연습");
    expect(internal.attendanceReminderEmailBody(attendance)).toContain("유형: 음악연습");
    expect(await service.exportMyScheduleIcs(actor as never)).toContain("일정 유형: 음악연습");
  });

  it("rejects schedule strings over the field-specific limits", async () => {
    const event = plainToInstance(CreateScheduleEventDto, {
      title: "가".repeat(121), location: "가".repeat(121), venue: "가".repeat(121), overrideReason: "가".repeat(501),
      startAt: "2026-10-23T10:00:00Z", endAt: "2026-10-23T11:00:00Z"
    });
    expect((await validate(event)).map((error) => error.property)).toEqual(expect.arrayContaining(["title", "location", "venue", "overrideReason"]));
    const personal = plainToInstance(CreateAvailabilityDto, {
      title: "가".repeat(121), reason: "가".repeat(501), startAt: "2026-10-23T10:00:00Z", endAt: "2026-10-23T11:00:00Z"
    });
    expect((await validate(personal)).map((error) => error.property)).toEqual(expect.arrayContaining(["title", "reason"]));
    expect((await validate(plainToInstance(DeleteScheduleEventDto, { reason: "가".repeat(501) }))).some((error) => error.property === "reason")).toBe(true);
    expect((await validate(plainToInstance(UpsertAttendanceDto, { overrideReason: "가".repeat(501) }))).some((error) => error.property === "overrideReason")).toBe(true);
  });

  it("excludes deleted script scenes from new connections and the scene picker", async () => {
    const { internal, prisma } = fixture();
    const scene = { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) };
    Object.assign(prisma, { scene });
    await expect(internal.assertScenes("production", ["deleted-scene"])).rejects.toThrow(BadRequestException);
    expect(scene.count).toHaveBeenCalledWith({
      where: { id: { in: ["deleted-scene"] }, act: { script: { productionId: "production", deletedAt: null } } }
    });
    expect(await internal.getProductionScenes("production")).toEqual([]);
    expect(scene.findMany.mock.calls[0][0].where).toEqual({ act: { script: { productionId: "production", deletedAt: null } } });
  });

  it("retains historical scene connections when listing existing events", async () => {
    const { service, internal, actor, event, prisma } = fixture();
    const historicalEvent = { ...event, scenes: [{ sceneId: "deleted-scene", scene: { title: "휴지통 장면" } }] };
    const scheduleEvent = { findMany: jest.fn().mockResolvedValue([historicalEvent]) };
    Object.assign(prisma, { scheduleEvent });
    jest.spyOn(internal, "assertMembership").mockResolvedValue(null);
    expect(await service.listEvents("production", actor as never)).toEqual([historicalEvent]);
    expect(scheduleEvent.findMany.mock.calls[0][0].include.scenes.where).toBeUndefined();
  });
});
