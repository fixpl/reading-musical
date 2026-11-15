import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { MailService } from "./mail.service";
function setup(challenge: object | null) {
  const delivery = { id: "mail", toEmail: "applicant@example.invalid", subject: "인증번호", bodyText: "비밀 인증번호 123456", templateKey: "inquiry.access_code", attempts: 0, updatedAt: new Date(1000), metadata: { challengeId: "challenge" } };
  const db = { emailDelivery: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), findMany: jest.fn().mockResolvedValue([delivery]), update: jest.fn() }, inquiryAccess: { findUnique: jest.fn().mockResolvedValue(challenge) } };
  const service = new MailService(db as unknown as PrismaService, { get: () => undefined } as unknown as ConfigService);
  const sender = jest.spyOn(service as unknown as { sendDelivery: (value: unknown) => Promise<{ messageId: string }> }, "sendDelivery").mockResolvedValue({ messageId: "test-mail" });
  return { db, service, sender };
}
describe("inquiry verification mail expiry", () => {
  it.each([null, { consumedAt: new Date(), expiresAt: new Date(Date.now() + 60000) }, { consumedAt: null, expiresAt: new Date(0) }])("never sends an unavailable code %s", async (challenge) => {
    const { db, service, sender } = setup(challenge); const result = await service.processQueuedEmails();
    expect(sender).not.toHaveBeenCalled(); expect(result.skipped).toBe(1);
    expect(db.emailDelivery.updateMany).toHaveBeenCalledWith({ where: { id: "mail", status: "PROCESSING", attempts: 1, lastAttemptAt: expect.any(Date) }, data: { status: "SKIPPED", skippedReason: "CODE_EXPIRED_OR_USED", bodyText: "인증번호 유효기간 종료", nextAttemptAt: null } });
  });
  it("scrubs the queued code text once successfully sent", async () => {
    const { db, service, sender } = setup({ consumedAt: null, expiresAt: new Date(Date.now() + 60000) });
    const result = await service.processQueuedEmails(); expect(result.sent).toBe(1); expect(sender).toHaveBeenCalledTimes(1);
    expect(db.emailDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SENT", bodyText: "인증번호 안내 발송 완료" }) }));
  });
  it("does not retain provider error details or code text after the terminal failure", async () => {
    const { db, service, sender } = setup({ consumedAt: null, expiresAt: new Date(Date.now() + 60000) });
    sender.mockRejectedValue(new Error("provider error with code 123456"));
    await service.processQueuedEmails({ maxAttempts: 1 });
    expect(db.emailDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED", errorMessage: "MAIL_TRANSPORT_FAILED", bodyText: "인증번호 안내 발송 실패" }) }));
  });
});
