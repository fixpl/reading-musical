import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { MailService } from "./mail.service";
import { ResendDeliveryError } from "./resend-mail.transport";
const delivery = () => ({ id: "mail", toEmail: "to@example.invalid", subject: "subject", bodyText: "private", templateKey: "inquiry.reply", attempts: 0, metadata: {}, updatedAt: new Date(1000) });
function setup(values: Record<string, string | undefined> = {}) {
  const db = { emailDelivery: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), findMany: jest.fn().mockResolvedValue([delivery()]), findFirst: jest.fn(), create: jest.fn(), findUniqueOrThrow: jest.fn() } };
  const config = new ConfigService({ MAIL_TRANSPORT: "resend", RESEND_API_KEY: "test-only", RESEND_FROM_EMAIL: "mail@example.invalid", ...values });
  const service = new MailService(db as unknown as PrismaService, config);
  const send = jest.spyOn(service as unknown as { sendDelivery: (value: unknown) => Promise<{ messageId: string }> }, "sendDelivery").mockResolvedValue({ messageId: "provider-id" });
  return { db, service, send };
}
describe("mail worker ownership and paused deployment", () => {
  it.each([{ MAIL_SENDING_ENABLED: "false" }, { RESEND_API_KEY: "" }])("does not touch the queue when sending is unavailable %s", async (values) => {
    const { db, service, send } = setup(values); const result = await service.processQueuedEmails();
    expect(result.picked).toBe(0); expect(result.heldReason).toBeTruthy();
    expect(db.emailDelivery.updateMany).not.toHaveBeenCalled(); expect(db.emailDelivery.findMany).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  });
  it("claims the exact loaded version and fences the successful completion", async () => {
    const { db, service, send } = setup(); const result = await service.processQueuedEmails();
    const claim = db.emailDelivery.updateMany.mock.calls.find(([call]) => call.data.status === "PROCESSING")![0];
    expect(claim.where).toMatchObject({ id: "mail", status: "QUEUED", attempts: 0, updatedAt: new Date(1000) });
    expect(claim.data.metadata.mailDispatch.transport).toBe("resend");
    expect(send.mock.calls[0][0]).toMatchObject({ metadata: { mailDispatch: { from: "mail@example.invalid" } } });
    const complete = db.emailDelivery.updateMany.mock.calls.find(([call]) => call.data.status === "SENT")![0];
    expect(complete.where).toEqual({ id: "mail", status: "PROCESSING", attempts: 1, lastAttemptAt: claim.data.lastAttemptAt });
    expect(result.sent).toBe(1);
  });
  it("does not send a stale row claimed or edited by a different operation", async () => {
    const { db, service, send } = setup();
    db.emailDelivery.updateMany.mockImplementation(async (call) => ({ count: call.data.status === "PROCESSING" ? 0 : 1 }));
    expect((await service.processQueuedEmails()).skipped).toBe(1); expect(send).not.toHaveBeenCalled();
  });
  it("does not count a lost completion lease as successful", async () => {
    const { db, service } = setup(); db.emailDelivery.updateMany.mockImplementation(async (call) => ({ count: call.data.status === "SENT" ? 0 : 1 }));
    expect(await service.processQueuedEmails()).toMatchObject({ sent: 0, skipped: 1 });
  });
  it("does not misclassify a database failure after provider acceptance as a sending failure", async () => {
    const { db, service } = setup(); db.emailDelivery.updateMany.mockImplementation(async (call) => { if (call.data.status === "SENT") throw new Error("db unavailable"); return { count: 1 }; });
    await expect(service.processQueuedEmails()).rejects.toThrow("db unavailable");
    const completions = db.emailDelivery.updateMany.mock.calls.filter(([call]) => call.where.id === "mail" && call.where.status === "PROCESSING");
    expect(completions).toHaveLength(1); expect(completions[0][0].data.status).toBe("SENT");
  });
  it("honors rate-limit cooldown and does not burn through the rest of the queue", async () => {
    const { db, service, send } = setup(); db.emailDelivery.findMany.mockResolvedValue([delivery(), { ...delivery(), id: "second" }]);
    send.mockRejectedValue(new ResendDeliveryError("RATE_LIMITED", true, 429, 120000));
    const result = await service.processQueuedEmails(); expect(result.retried).toBe(1); expect(result.heldReason).toBe("PROVIDER_COOLDOWN"); expect(send).toHaveBeenCalledTimes(1);
    await service.processQueuedEmails(); expect(send).toHaveBeenCalledTimes(1);
    const failed = db.emailDelivery.updateMany.mock.calls.find(([call]) => call.where.id === "mail" && call.data.status === "QUEUED")![0];
    expect(failed.data.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 110000);
  });
  it("stops invalid requests without automatic retries", async () => {
    const { db, service, send } = setup(); send.mockRejectedValue(new ResendDeliveryError("REQUEST_REJECTED", false, 422));
    expect((await service.processQueuedEmails()).failed).toBe(1);
    expect(db.emailDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "mail", attempts: 1 }), data: expect.objectContaining({ status: "FAILED", nextAttemptAt: null }) }));
  });
  it("stops taking work after a graceful shutdown request", async () => {
    const { service, send } = setup(); await service.processQueuedEmails({ shouldStop: () => true }); expect(send).not.toHaveBeenCalled();
  });
  it("does not edit a digest already claimed by the worker", async () => {
    const { db, service } = setup(); db.emailDelivery.findFirst.mockResolvedValue({ id: "mail", metadata: { digestCount: 1 }, updatedAt: new Date(1000) });
    db.emailDelivery.updateMany.mockResolvedValue({ count: 0 }); db.emailDelivery.create.mockResolvedValue({ id: "fresh" });
    await service.queueDigestEmail({ toEmail: "to@example.invalid", subject: "updated", bodyText: "updated", templateKey: "board.update" });
    expect(db.emailDelivery.updateMany.mock.calls[0][0].where).toMatchObject({ attempts: 0, status: "QUEUED", updatedAt: new Date(1000) });
    expect(db.emailDelivery.create).toHaveBeenCalledTimes(1);
  });
});
