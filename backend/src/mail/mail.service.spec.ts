import { ConfigService } from "@nestjs/config";
import { EmailDeliveryStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { MailService } from "./mail.service";

describe("MailService worker recovery", () => {
  it("requeues deliveries abandoned in PROCESSING before picking new work", async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      emailDelivery: { updateMany, findMany }
    } as unknown as PrismaService;
    const config = {
      get: jest.fn((key: string) => (key === "MAIL_WORKER_PROCESSING_TIMEOUT_MS" ? "300000" : undefined))
    } as unknown as ConfigService;
    const service = new MailService(prisma, config);

    const result = await service.processQueuedEmails();

    expect(result.picked).toBe(0);
    expect(updateMany).toHaveBeenCalledTimes(3);
    const terminalRecovery = updateMany.mock.calls[0][0];
    expect(terminalRecovery.where.status).toBe(EmailDeliveryStatus.PROCESSING);
    expect(terminalRecovery.where.attempts.gte).toBe(3);
    expect(terminalRecovery.where.templateKey).toEqual({ notIn: ["inquiry.access_code", "auth.registration_code"] });
    expect(terminalRecovery.data.status).toBe(EmailDeliveryStatus.FAILED);
    expect(terminalRecovery.data).not.toHaveProperty("bodyText");
    const terminalCodeRecovery = updateMany.mock.calls[1][0];
    expect(terminalCodeRecovery.where).toMatchObject({
      status: EmailDeliveryStatus.PROCESSING, attempts: { gte: 3 },
      templateKey: { in: ["inquiry.access_code", "auth.registration_code"] }
    });
    expect(terminalCodeRecovery.where.lastAttemptAt.lte).toEqual(terminalRecovery.where.lastAttemptAt.lte);
    expect(terminalCodeRecovery.data).toMatchObject({ status: EmailDeliveryStatus.FAILED, bodyText: "인증번호 안내 발송 실패", nextAttemptAt: null });
    const recovery = updateMany.mock.calls[2][0];
    expect(recovery.where.status).toBe(EmailDeliveryStatus.PROCESSING);
    expect(recovery.where.attempts.lt).toBe(3);
    expect(recovery.where.lastAttemptAt.lte).toBeInstanceOf(Date);
    expect(recovery.data).toEqual(
      expect.objectContaining({
        status: EmailDeliveryStatus.QUEUED,
        nextAttemptAt: expect.any(Date)
      })
    );
  });
});

describe("MailService.queueEmail batching", () => {
  const config = { get: jest.fn() } as unknown as ConfigService;

  it("coalesces same-tick queueEmail calls into one preference read and one insert", async () => {
    const findMany = jest.fn().mockResolvedValue([
      { id: "u1", emailNotify: true },
      { id: "u2", emailNotify: false }
    ]);
    const createManyAndReturn = jest.fn().mockImplementation(async ({ data }: { data: Array<Record<string, unknown>> }) =>
      [...data].reverse().map((row) => ({ ...row, createdAt: new Date() }))
    );
    const create = jest.fn();
    const prisma = {
      user: { findMany },
      emailDelivery: { createManyAndReturn, create }
    } as unknown as PrismaService;
    const service = new MailService(prisma, config);
    const base = { subject: "제목", bodyText: "본문", templateKey: "t" };

    const results = await Promise.all([
      service.queueEmail({ ...base, toEmail: "A@x.com", userId: "u1" }),
      service.queueEmail({ ...base, toEmail: "b@x.com", userId: "u2" }),
      service.queueEmail({ ...base, toEmail: "c@x.com", userId: "u1", bypassUserPreference: true })
    ]);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(createManyAndReturn).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
    expect(results.map((row) => row.toEmail)).toEqual(["a@x.com", "b@x.com", "c@x.com"]);
    expect(results.map((row) => row.status)).toEqual([
      EmailDeliveryStatus.QUEUED,
      EmailDeliveryStatus.SKIPPED,
      EmailDeliveryStatus.QUEUED
    ]);
    expect(results[1].skippedReason).toBe("USER_EMAIL_NOTIFY_DISABLED");
  });

  it("uses a plain create for a single email and still rejects invalid input", async () => {
    const create = jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => data);
    const prisma = { user: { findMany: jest.fn() }, emailDelivery: { create } } as unknown as PrismaService;
    const service = new MailService(prisma, config);

    await service.queueEmail({ toEmail: "a@x.com", subject: "s", bodyText: "b", templateKey: "t" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    await expect(service.queueEmail({ toEmail: " ", subject: "s", bodyText: "b", templateKey: "t" })).rejects.toThrow();
  });
});
