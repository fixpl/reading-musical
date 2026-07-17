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
    expect(updateMany).toHaveBeenCalledTimes(2);
    const terminalRecovery = updateMany.mock.calls[0][0];
    expect(terminalRecovery.where.status).toBe(EmailDeliveryStatus.PROCESSING);
    expect(terminalRecovery.where.attempts.gte).toBe(3);
    expect(terminalRecovery.data.status).toBe(EmailDeliveryStatus.FAILED);
    const recovery = updateMany.mock.calls[1][0];
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
