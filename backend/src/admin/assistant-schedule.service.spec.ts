import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { PlatformRole } from "@prisma/client";
import type { RequestUser } from "../common/types/request-user";
import type { PrismaService } from "../prisma/prisma.service";
import type { ScheduleService } from "../schedule/schedule.service";
import { AssistantScheduleService } from "./assistant-schedule.service";

const operator: RequestUser = { id: "admin", name: "관리자", email: "admin@example.test", platformRole: PlatformRole.SUPER_ADMIN };
const before = { startAt: new Date("2026-11-27T08:00:00Z"), endAt: new Date("2026-11-27T09:30:00Z") };
const after = { startAt: new Date("2026-11-27T10:30:00Z"), endAt: new Date("2026-11-27T12:00:00Z") };
const review = { before, after, timeChanged: true, eventVersion: "event-version", conflicts: [], reconfirm: [{ name: "배우" }] };

function fixture() {
  const schedule = {
    previewTimeChange: jest.fn().mockResolvedValue(review),
    updateEvent: jest.fn().mockResolvedValue({ id: "event" }),
    wasAssistantTimeChangeSaved: jest.fn().mockResolvedValue(false)
  };
  const accessSecret = "test-secret-for-assistant-schedule";
  const jwt = new JwtService();
  const service = new AssistantScheduleService({} as PrismaService, schedule as unknown as ScheduleService,
    new ConfigService({ JWT_ACCESS_SECRET: accessSecret }), jwt);
  const preview = () => service.preview("production", "event", "2026-11-27T19:30:00+09:00", "", operator);
  return { service, schedule, preview, jwt, accessSecret };
}

test("preview grants only its operator a confirmation for these exact times", async () => {
  const { service, schedule, preview, jwt, accessSecret } = fixture();
  const proposed = await preview();
  const token = proposed.approvalToken!;
  expect(token).toBeTruthy();
  expect(() => jwt.verify(token, { secret: accessSecret })).toThrow();
  await expect(service.confirm(token, { ...operator, id: "different-admin" })).rejects.toThrow(BadRequestException);
  await expect(service.confirm(token, { ...operator, platformRole: PlatformRole.MEMBER })).rejects.toThrow(ForbiddenException);
  expect(schedule.updateEvent).not.toHaveBeenCalled();
  await expect(service.confirm(token, operator)).resolves.toMatchObject({ status: "saved", previouslySaved: false });
  expect(schedule.updateEvent).toHaveBeenCalledWith("production", "event", {
    startAt: after.startAt.toISOString(), endAt: after.endAt.toISOString()
  }, operator, { eventVersion: review.eventVersion, auditId: expect.any(String) });
});

test("a new schedule conflict returns an updated preview without an approval token", async () => {
  const { service, schedule, preview } = fixture();
  const { approvalToken } = await preview();
  const conflicts = [{ userName: "배우", reason: "개인 일정과 겹침", ...after }];
  schedule.updateEvent.mockRejectedValueOnce(new ConflictException());
  schedule.previewTimeChange.mockResolvedValueOnce({ ...review, conflicts });
  await expect(service.confirm(approvalToken!, operator)).resolves.toMatchObject({ status: "review", preview: { conflicts, approvalToken: null } });
  expect(schedule.updateEvent).toHaveBeenCalledTimes(1);
});

test("already committed confirmations return the stored outcome without a new preview", async () => {
  const { service, schedule, preview } = fixture();
  const { approvalToken } = await preview();
  schedule.updateEvent.mockRejectedValueOnce(new ConflictException());
  schedule.wasAssistantTimeChangeSaved.mockResolvedValueOnce(true);
  await expect(service.confirm(approvalToken!, operator)).resolves.toMatchObject({ status: "saved", previouslySaved: true });
  expect(schedule.previewTimeChange).toHaveBeenCalledTimes(1);
});
