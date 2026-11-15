import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { MailService } from "./mail.service";

type RegistrationChallenge = {
  email: string;
  expiresAt: Date;
  attempts: number;
  verifiedAt: Date | null;
  consumedAt: Date | null;
};

const codeTemplates = ["inquiry.access_code", "auth.registration_code"];
const recipient = "applicant@example.invalid";
const codeBody = "회원가입 인증번호 123456";

function activeChallenge(): RegistrationChallenge {
  return { email: recipient, expiresAt: new Date(Date.now() + 60000), attempts: 0, verifiedAt: null, consumedAt: null };
}

function setup(challenge: RegistrationChallenge | null = activeChallenge(), templateKey = "auth.registration_code") {
  const delivery = {
    id: "mail", toEmail: recipient, subject: "인증번호", bodyText: codeBody, templateKey,
    attempts: 0, updatedAt: new Date(1000), metadata: { challengeId: "challenge", transactional: true }
  };
  const db = {
    emailDelivery: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([delivery])
    },
    registrationEmailChallenge: { findUnique: jest.fn().mockResolvedValue(challenge) },
    inquiryAccess: { findUnique: jest.fn().mockResolvedValue({ consumedAt: null, expiresAt: new Date(Date.now() + 60000) }) }
  };
  const service = new MailService(db as unknown as PrismaService, new ConfigService({ MAIL_TRANSPORT: "json" }));
  const send = jest.spyOn(service as unknown as { sendDelivery: (value: unknown) => Promise<{ messageId: string }> }, "sendDelivery")
    .mockResolvedValue({ messageId: "test-provider-message" });
  return { db, service, send, delivery };
}

describe("registration verification mail", () => {
  it("sends only a current challenge and scrubs the code after provider acceptance", async () => {
    const { db, service, send } = setup();

    expect(await service.processQueuedEmails()).toMatchObject({ sent: 1, failed: 0, skipped: 0 });

    expect(db.registrationEmailChallenge.findUnique).toHaveBeenCalledWith({
      where: { id: "challenge" }, select: { email: true, expiresAt: true, attempts: true, verifiedAt: true, consumedAt: true }
    });
    expect(db.inquiryAccess.findUnique).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ toEmail: recipient, bodyText: codeBody }));
    const claim = db.emailDelivery.updateMany.mock.calls.find(([call]) => call.data.status === "PROCESSING")![0];
    expect(claim.where).toEqual({ id: "mail", status: "QUEUED", attempts: 0, updatedAt: new Date(1000) });
    expect(db.emailDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "mail", status: "PROCESSING", attempts: 1, lastAttemptAt: claim.data.lastAttemptAt },
      data: expect.objectContaining({ status: "SENT", bodyText: "인증번호 안내 발송 완료", providerMessageId: "test-provider-message" })
    }));
  });

  it("sends the original mixed-case address without changing account email matching", async () => {
    const email = "Actor@Example.com";
    const { db, service, send, delivery } = setup({ ...activeChallenge(), email });
    delivery.toEmail = email;

    expect(await service.processQueuedEmails()).toMatchObject({ sent: 1, skipped: 0 });

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ toEmail: email, templateKey: "auth.registration_code" }));
    expect(db.emailDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "SENT", bodyText: "인증번호 안내 발송 완료" })
    }));
  });

  it.each([
    ["missing", null],
    ["expired", { ...activeChallenge(), expiresAt: new Date(0) }],
    ["verified", { ...activeChallenge(), verifiedAt: new Date() }],
    ["consumed", { ...activeChallenge(), consumedAt: new Date() }],
    ["recipient mismatch", { ...activeChallenge(), email: "other@example.invalid" }],
    ["attempt limit", { ...activeChallenge(), attempts: 5 }],
    ["over attempt limit", { ...activeChallenge(), attempts: 6 }]
  ] as const)("skips and scrubs a %s challenge", async (_reason, challenge) => {
    const { db, service, send } = setup(challenge);

    expect(await service.processQueuedEmails()).toMatchObject({ sent: 0, skipped: 1 });

    expect(send).not.toHaveBeenCalled();
    expect(db.emailDelivery.updateMany).toHaveBeenCalledWith({
      where: { id: "mail", status: "PROCESSING", attempts: 1, lastAttemptAt: expect.any(Date) },
      data: { status: "SKIPPED", skippedReason: "CODE_EXPIRED_OR_USED", bodyText: "인증번호 유효기간 종료", nextAttemptAt: null }
    });
  });

  it("skips a delivery without a challenge reference", async () => {
    const { db, service, send, delivery } = setup();
    db.emailDelivery.findMany.mockResolvedValue([{ ...delivery, metadata: { transactional: true } }]);

    expect(await service.processQueuedEmails()).toMatchObject({ sent: 0, skipped: 1 });

    expect(send).not.toHaveBeenCalled();
    expect(db.registrationEmailChallenge.findUnique).not.toHaveBeenCalled();
  });

  it.each(codeTemplates)("scrubs %s after a terminal provider failure", async (templateKey) => {
    const { db, service, send } = setup(activeChallenge(), templateKey);
    send.mockRejectedValue(new Error(`provider rejected ${codeBody}`));

    expect(await service.processQueuedEmails({ maxAttempts: 1 })).toMatchObject({ failed: 1, retried: 0 });

    const failure = db.emailDelivery.updateMany.mock.calls.find(([call]) => call.where.id === "mail" && call.data.status === "FAILED")![0];
    expect(failure.data).toMatchObject({ bodyText: "인증번호 안내 발송 실패", errorMessage: "MAIL_TRANSPORT_FAILED", nextAttemptAt: null });
    expect(JSON.stringify(failure)).not.toContain("123456");
  });

  it.each(codeTemplates)("retains %s only while a provider retry remains possible", async (templateKey) => {
    const { db, service, send, delivery } = setup(activeChallenge(), templateKey);
    send.mockRejectedValue(new Error(`temporary provider failure ${codeBody}`));

    expect(await service.processQueuedEmails({ maxAttempts: 3 })).toMatchObject({ failed: 0, retried: 1 });

    const retry = db.emailDelivery.updateMany.mock.calls.find(([call]) => call.where.id === "mail" && call.data.status === "QUEUED")![0];
    expect(retry.data).toMatchObject({ errorMessage: "MAIL_TRANSPORT_FAILED", nextAttemptAt: expect.any(Date) });
    expect(retry.data).not.toHaveProperty("bodyText");
    expect(delivery.bodyText).toBe(codeBody);
  });

  it("does not query or send a challenge when another worker owns the delivery", async () => {
    const { db, service, send } = setup();
    db.emailDelivery.updateMany.mockImplementation(async (call) => ({ count: call.data.status === "PROCESSING" ? 0 : 1 }));

    expect(await service.processQueuedEmails()).toMatchObject({ sent: 0, skipped: 1 });

    expect(db.registrationEmailChallenge.findUnique).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps ordinary delivery bodies after success and never queries OTP challenges", async () => {
    const { db, service, send } = setup(activeChallenge(), "inquiry.reply");

    expect(await service.processQueuedEmails()).toMatchObject({ sent: 1 });

    expect(send).toHaveBeenCalledTimes(1);
    expect(db.registrationEmailChallenge.findUnique).not.toHaveBeenCalled();
    expect(db.inquiryAccess.findUnique).not.toHaveBeenCalled();
    const complete = db.emailDelivery.updateMany.mock.calls.find(([call]) => call.data.status === "SENT")![0];
    expect(complete.data).not.toHaveProperty("bodyText");
  });

  it("scrubs terminal stale OTP rows without altering ordinary or retryable bodies", async () => {
    const { db, service } = setup();
    db.emailDelivery.findMany.mockResolvedValue([]);

    await service.processQueuedEmails({ maxAttempts: 3 });

    const recoveries = db.emailDelivery.updateMany.mock.calls.map(([call]) => call);
    expect(recoveries).toHaveLength(3);
    expect(recoveries[0]).toMatchObject({
      where: { status: "PROCESSING", attempts: { gte: 3 }, templateKey: { notIn: codeTemplates } },
      data: { status: "FAILED", errorMessage: "WORKER_INTERRUPTED_REVIEW_REQUIRED", nextAttemptAt: null }
    });
    expect(recoveries[0].data).not.toHaveProperty("bodyText");
    expect(recoveries[1]).toMatchObject({
      where: { status: "PROCESSING", attempts: { gte: 3 }, templateKey: { in: codeTemplates } },
      data: { status: "FAILED", bodyText: "인증번호 안내 발송 실패" }
    });
    expect(recoveries[2]).toMatchObject({ where: { status: "PROCESSING", attempts: { lt: 3 } }, data: { status: "QUEUED" } });
    expect(recoveries[2].data).not.toHaveProperty("bodyText");
    for (const recovery of recoveries) expect(recovery.where.lastAttemptAt.lte).toBeInstanceOf(Date);
  });
});
