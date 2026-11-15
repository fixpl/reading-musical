import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CreateScheduleEventDto, UpsertAttendanceDto } from "./dto";
import { ScheduleNotificationsService } from "./schedule-notifications.service";
import { ScheduleService } from "./schedule.service";

// Offline tests: mock database queries, but execute the real schedule service.
function fixture() {
  const member = { id: "member-a", userId: "user-1", user: { id: "user-1", name: "배우" } };
  const prisma = {
    membership: { findMany: jest.fn().mockResolvedValue([member]) },
    availability: { findMany: jest.fn().mockResolvedValue([]) },
    attendance: { findMany: jest.fn().mockResolvedValue([]) },
    scheduleEvent: { findMany: jest.fn().mockResolvedValue([]) },
    notification: { findFirst: jest.fn().mockResolvedValue(null) },
    emailDelivery: { findFirst: jest.fn().mockResolvedValue(null) }
  };
  const notificationsService = new ScheduleNotificationsService(prisma as never, {} as never, {} as never);
  const service = new ScheduleService(prisma as never, notificationsService);
  // Private methods are exercised deliberately to inspect the exact Prisma boundary.
  const internal = service as any;
  const range = { startAt: new Date("2026-09-08T10:00:00+09:00"), endAt: new Date("2026-09-08T11:00:00+09:00") };
  return { prisma, service, internal, notificationsService, range };
}

describe("schedule conflict and permission regressions", () => {
  it("finds the same person in another production without exposing its title or ID", async () => {
    const { prisma, internal, range } = fixture();
    prisma.attendance.findMany.mockResolvedValue([{
      membershipId: "member-in-other-production",
      membership: { userId: "user-1" },
      event: { id: "private-event", productionId: "production-b", title: "비공개 공연 제목", ...range }
    }]);
    const conflicts = await internal.findConflicts("production-a", ["member-a"], range, "editing-event");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ membershipId: "member-a", userId: "user-1", type: "EVENT", reason: "다른 공연 일정과 겹침", resourceId: "" });
    expect(JSON.stringify(conflicts)).not.toContain("비공개");
    const query = prisma.attendance.findMany.mock.calls[0][0];
    expect(query.where.membership).toEqual({ userId: { in: ["user-1"] } });
    expect(query.where.event.productionId).toBeUndefined();
    expect(query.where.event.production).toEqual({ deletedAt: null });
    expect(query.where.status).toEqual({ not: "DECLINED" });
    expect(query.where.eventId).toEqual({ not: "editing-event" });
    expect(query.where.event.startAt).toEqual({ lt: range.endAt });
    expect(query.where.event.endAt).toEqual({ gt: range.startAt });
  });

  it("preserves links to conflicts in the same production and hides personal details", async () => {
    const { prisma, internal, range } = fixture();
    prisma.attendance.findMany.mockResolvedValue([{
      membership: { userId: "user-1" },
      event: { id: "shared-event", productionId: "production-a", title: "합주", ...range }
    }]);
    prisma.availability.findMany.mockResolvedValue([{ id: "personal", userId: "user-1", title: "개인 제목", reason: "개인 메모", ...range }]);
    const conflicts = await internal.findConflicts("production-a", ["member-a"], range);
    expect(conflicts[0].reason).toBe("개인 일정과 겹침");
    expect(conflicts[1]).toMatchObject({ resourceId: "shared-event", reason: "합주" });
    expect(JSON.stringify(conflicts)).not.toContain("개인 메모");
  });

  it("does not query anyone's schedule for an empty attendee list", async () => {
    const { prisma, internal, range } = fixture();
    expect(await internal.findConflicts("production-a", [], range)).toEqual([]);
    expect(prisma.attendance.findMany).not.toHaveBeenCalled();
  });

  it("requires valid ranges and uses exclusive calendar boundaries", async () => {
    const { prisma, internal, service, range, notificationsService } = fixture();
    expect(() => internal.parseRange("invalid", range.endAt.toISOString())).toThrow(BadRequestException);
    expect(() => internal.parseRange(range.startAt.toISOString(), range.startAt.toISOString())).toThrow(BadRequestException);
    jest.spyOn(internal, "assertMembership").mockResolvedValue(null);
    await service.listEvents("production-a", {} as never, range.startAt.toISOString(), range.endAt.toISOString());
    expect(prisma.scheduleEvent.findMany.mock.calls[0][0].where.AND).toEqual([
      { endAt: { gt: range.startAt } }, { startAt: { lt: range.endAt } }
    ]);
    await expect(service.listEvents("production-a", {} as never, range.endAt.toISOString(), range.startAt.toISOString())).rejects.toThrow(BadRequestException);
  });

  it("cannot gain edit access by changing a rehearsal to music practice", async () => {
    const { internal, service } = fixture();
    jest.spyOn(internal, "assertEvent").mockResolvedValue({ type: "REHEARSAL" });
    const permission = jest.spyOn(internal, "assertEditPermission").mockRejectedValue(new ForbiddenException());
    await expect(service.updateEvent("p", "e", { type: "MUSIC_PRACTICE" } as never, {} as never)).rejects.toThrow(ForbiddenException);
    expect(permission).toHaveBeenCalledWith("p", {}, "REHEARSAL");
  });

  it("deduplicates reminders by attendance and current start time", async () => {
    const { prisma, notificationsService, range } = fixture();
    const internal = notificationsService as any;
    const attendance = { id: "a", event: { productionId: "p", ...range }, membership: { user: { id: "u" } } };
    await internal.hasAttendanceReminder(attendance);
    const key = `attendance:a:${range.startAt.toISOString()}`;
    expect(prisma.notification.findFirst.mock.calls[0][0].where.payload).toEqual({ path: ["reminderKey"], equals: key });
    expect(prisma.emailDelivery.findFirst.mock.calls[0][0].where.metadata).toEqual({ path: ["reminderKey"], equals: key });
  });

  it("rejects duplicate attendee IDs and whitespace-only titles before database writes", async () => {
    const id = "123e4567-e89b-42d3-a456-426614174000";
    const dto = plainToInstance(CreateScheduleEventDto, { title: "  ", startAt: "2026-09-08T10:00:00+09:00", endAt: "2026-09-08T11:00:00+09:00", attendeeMembershipIds: [id, id] });
    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toEqual(expect.arrayContaining(["title", "attendeeMembershipIds"]));
    const attendance = plainToInstance(UpsertAttendanceDto, { attendances: [{ membershipId: id }, { membershipId: id }] });
    expect((await validate(attendance)).some((error) => error.property === "attendances")).toBe(true);
  });

  it("saves bulk attendance in one transaction so a failing row leaves nothing behind", async () => {
    const { prisma, internal, service, range, notificationsService } = fixture();
    const tx = { attendance: { upsert: jest.fn().mockResolvedValueOnce({ id: "a1" }).mockRejectedValueOnce(new Error("db down")) } };
    const transaction = jest.fn(async (callback: (client: typeof tx) => Promise<unknown>, _options?: { timeout: number }) => callback(tx));
    (prisma as any).$transaction = transaction;
    jest.spyOn(internal, "assertEvent").mockResolvedValue({ id: "e", title: "합주", type: "REHEARSAL", ...range, attendances: [] });
    jest.spyOn(internal, "getUserMembership").mockResolvedValue(null);
    jest.spyOn(internal, "assertEditPermission").mockResolvedValue(undefined);
    jest.spyOn(internal, "assertMembershipIds").mockResolvedValue(undefined);
    jest.spyOn(internal, "findConflicts").mockResolvedValue([]);
    const forced = jest.spyOn(notificationsService, "handleForcedAttendances").mockResolvedValue({ logs: 0, notifications: 0, emailDeliveries: 0 });
    await expect(service.upsertAttendance("p", "e", { membershipIds: ["m1", "m2"] } as never, { id: "u" } as never)).rejects.toThrow("db down");
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction.mock.calls[0][1]).toEqual({ timeout: 20000 });
    expect(tx.attendance.upsert).toHaveBeenCalledTimes(2);
    expect(forced).not.toHaveBeenCalled();
  });

  it("replaces event scenes and cues with a single createMany instead of per-row creates", async () => {
    const { prisma, internal, service } = fixture();
    const eventScene = { deleteMany: jest.fn().mockReturnValue("del-scene"), createMany: jest.fn().mockReturnValue("create-scene"), create: jest.fn() };
    const eventMusicCue = { deleteMany: jest.fn().mockReturnValue("del-cue"), createMany: jest.fn().mockReturnValue("create-cue"), create: jest.fn() };
    const transaction = jest.fn().mockResolvedValue([]);
    Object.assign(prisma, { eventScene, eventMusicCue, $transaction: transaction });
    jest.spyOn(internal, "assertEvent").mockResolvedValue({ id: "e", type: "REHEARSAL" });
    jest.spyOn(internal, "assertEditPermission").mockResolvedValue(undefined);
    jest.spyOn(internal, "assertScenes").mockResolvedValue(undefined);
    jest.spyOn(internal, "assertMusicCues").mockResolvedValue(undefined);
    await service.putEventScenes("p", "e", { sceneIds: ["s1", "s2"] }, {} as never);
    await service.putEventMusicCues("p", "e", { musicCueIds: ["c1", "c2"] }, {} as never);
    expect(eventScene.create).not.toHaveBeenCalled();
    expect(eventMusicCue.create).not.toHaveBeenCalled();
    expect(eventScene.createMany).toHaveBeenCalledWith({ data: [{ eventId: "e", sceneId: "s1" }, { eventId: "e", sceneId: "s2" }], skipDuplicates: true });
    expect(eventMusicCue.createMany).toHaveBeenCalledWith({ data: [{ eventId: "e", cueId: "c1" }, { eventId: "e", cueId: "c2" }], skipDuplicates: true });
    expect(transaction.mock.calls[0][0]).toEqual(["del-scene", "create-scene"]);
  });

  it("limits ID lists: DTO arrays to 500 and suggest query ids to 200", async () => {
    const ids = Array.from({ length: 501 }, (_, index) => `123e4567-e89b-42d3-a456-${String(index).padStart(12, "0")}`);
    const event = plainToInstance(CreateScheduleEventDto, { title: "합주", startAt: "2026-09-08T10:00:00+09:00", endAt: "2026-09-08T11:00:00+09:00", attendeeMembershipIds: ids });
    expect((await validate(event)).some((error) => error.property === "attendeeMembershipIds")).toBe(true);
    const attendance = plainToInstance(UpsertAttendanceDto, { attendances: ids.map((membershipId) => ({ membershipId })) });
    expect((await validate(attendance)).some((error) => error.property === "attendances")).toBe(true);
    const { internal } = fixture();
    expect(internal.splitIds(ids.slice(0, 200).join(","))).toHaveLength(200);
    expect(() => internal.splitIds(ids.slice(0, 201).join(","))).toThrow(BadRequestException);
  });
});
