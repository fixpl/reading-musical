import { UnauthorizedException, BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, createHmac } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { InquiryAccessService } from "./inquiry-access.service";
const SECRET = "unit-test-only-not-a-runtime-secret";
const email = "applicant@example.invalid";
const code = "031274";
const grant = () => ({ id: "grant-id", inquiryId: "inquiry-id", email, codeHash: createHmac("sha256", SECRET).update(`inquiry-email-code:grant-id:${code}`).digest("hex"), consumedAt: null, attempts: 0, expiresAt: new Date(Date.now() + 600000), sessionExpiresAt: new Date(Date.now() + 1800000), inquiry: { email } });
function setup() {
  const db = {
    $queryRaw: jest.fn().mockResolvedValue([]), $transaction: jest.fn(),
    inquiry: { findFirst: jest.fn().mockResolvedValue({ id: "inquiry-id", email }), findUniqueOrThrow: jest.fn().mockResolvedValue({ id: "inquiry-id", status: "IN_REVIEW", messages: [] }), update: jest.fn() },
    inquiryAccess: { findFirst: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(0), create: jest.fn(), updateMany: jest.fn(), findUnique: jest.fn().mockResolvedValue(grant()), update: jest.fn() },
    inquiryMessage: { create: jest.fn() }, emailDelivery: { create: jest.fn() }
  };
  db.$transaction.mockImplementation((callback) => callback(db));
  const config = { get: jest.fn((key: string): string | undefined => key === "JWT_ACCESS_SECRET" ? SECRET : undefined) };
  return { db, config, service: new InquiryAccessService(db as unknown as PrismaService, config as unknown as ConfigService) };
}
describe("non-member inquiry email verification", () => {
  it("does not enqueue undispatchable authentication codes while mail is paused", async () => {
    const { db, config, service } = setup(); config.get.mockImplementation((key: string) => key === "MAIL_SENDING_ENABLED" ? "false" : undefined);
    await expect(service.request({ inquiryId: "inquiry-id", email })).rejects.toThrow("현재 이메일 인증을 이용할 수 없습니다.");
    expect(db.$transaction).not.toHaveBeenCalled(); expect(db.emailDelivery.create).not.toHaveBeenCalled();
  });
  it("returns a generic challenge, stores a keyed hash and queues only a code notification", async () => {
    const { db, service } = setup();
    const result = await service.request({ inquiryId: "inquiry-id", email });
    const stored = db.inquiryAccess.create.mock.calls[0][0].data;
    const queued = db.emailDelivery.create.mock.calls[0][0].data;
    const sentCode = queued.bodyText.match(/인증번호: (\d{6})/)[1];
    expect(stored.id).toBe(result.challengeId);
    expect(stored.codeHash).toBe(createHmac("sha256", SECRET).update(`inquiry-email-code:${stored.id}:${sentCode}`).digest("hex"));
    expect(stored).not.toHaveProperty("code"); expect(result).not.toHaveProperty("code");
    expect(queued.templateKey).toBe("inquiry.access_code"); expect(queued.status).toBe("QUEUED");
    expect(stored.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 600000);
  });
  it("does not reveal missing applications or queue email to arbitrary addresses", async () => {
    const { db, service } = setup(); db.inquiry.findFirst.mockResolvedValue(null);
    const result = await service.request({ inquiryId: "missing", email });
    expect(result.challengeId).toMatch(/^[a-f0-9-]{36}$/);
    expect(Object.keys(result).sort()).toEqual(["challengeId", "message", "retryAfterSeconds"]);
    expect(db.emailDelivery.create).not.toHaveBeenCalled();
  });
  it("throttles duplicate emails without leaking existence through a stable challenge id", async () => {
    const { db, service } = setup(); db.inquiryAccess.findFirst.mockResolvedValue({ id: "recent", consumedAt: null, createdAt: new Date() });
    const first = await service.request({ inquiryId: "inquiry-id", email });
    const second = await service.request({ inquiryId: "inquiry-id", email });
    expect(first.challengeId).toMatch(/^[a-f0-9-]{36}$/);
    expect(first.challengeId).not.toBe("recent"); expect(second.challengeId).not.toBe(first.challengeId);
    expect(first.message).toBe(second.message);
    expect(db.emailDelivery.create).not.toHaveBeenCalled();
  });
  it("limits per-inquiry sending independently of IP limits", async () => {
    const { db, service } = setup(); db.inquiryAccess.count.mockResolvedValue(10);
    await service.request({ inquiryId: "inquiry-id", email }); expect(db.emailDelivery.create).not.toHaveBeenCalled();
  });
  it("commits a failed code attempt before returning an error", async () => {
    const { db, service } = setup();
    await expect(service.verify({ challengeId: "grant-id", code: "999999" })).rejects.toThrow(UnauthorizedException);
    expect(db.inquiryAccess.update).toHaveBeenCalledWith({ where: { id: "grant-id" }, data: { attempts: { increment: 1 } } });
    await expect(db.$transaction.mock.results[0].value).resolves.toBe(false);
  });
  it.each(["expired", "consumed", "attempts", "email-changed"])("rejects %s challenges without creating a session", async (kind) => {
    const { db, service } = setup();
    db.inquiryAccess.findUnique.mockResolvedValue({ ...grant(), ...(kind === "expired" ? { expiresAt: new Date(0) } : kind === "consumed" ? { consumedAt: new Date() } : kind === "attempts" ? { attempts: 5 } : { inquiry: { email: "different@example.invalid" } }) });
    await expect(service.verify({ challengeId: "grant-id", code })).rejects.toThrow(UnauthorizedException);
    expect(db.inquiryAccess.update).not.toHaveBeenCalled();
  });
  it("returns the scoped session token once and stores only its digest", async () => {
    const { db, service } = setup(); const result = await service.verify({ challengeId: "grant-id", code });
    expect(result.accessToken).toMatch(/^[a-f0-9]{64}$/);
    const data = db.inquiryAccess.update.mock.calls[0][0].data;
    expect(data.sessionHash).toBe(createHash("sha256").update(result.accessToken).digest("hex"));
    expect(data.consumedAt).toBeInstanceOf(Date); expect(data.sessionHash).not.toBe(result.accessToken);
  });
  it("selects only the authenticated inquiry and public reply fields", async () => {
    const { db, service } = setup(); await service.read("a".repeat(64));
    const query = db.inquiry.findUniqueOrThrow.mock.calls[0][0];
    expect(query.where).toEqual({ id: "inquiry-id" });
    for (const field of ["adminNote", "planningNote", "production", "source", "handledBy", "accessGrants"]) expect(query.select).not.toHaveProperty(field);
    expect(query.select.messages.where).toEqual({ public: true });
    expect(query.select.messages.select).not.toHaveProperty("authorId");
  });
  it("does not access an inquiry after its scoped session expires", async () => {
    const { db, service } = setup(); db.inquiryAccess.findUnique.mockResolvedValue({ ...grant(), sessionExpiresAt: new Date(0) });
    await expect(service.read("a".repeat(64))).rejects.toThrow(UnauthorizedException);
    expect(db.inquiry.findUniqueOrThrow).not.toHaveBeenCalled();
  });
  it("does not let a message change a production schedule", async () => {
    const { db, service } = setup(); await service.message({ accessToken: "a".repeat(64), body: "시간 변경 요청" });
    expect(db.inquiryMessage.create).toHaveBeenCalledWith({ data: { inquiryId: "inquiry-id", authorKind: "APPLICANT", body: "시간 변경 요청", public: true } });
    expect(db.inquiry.update).toHaveBeenCalledWith({ where: { id: "inquiry-id" }, data: { revision: { increment: 1 }, status: "IN_REVIEW" } });
    expect(db).not.toHaveProperty("production");
  });
  it("rejects further messages on a closed consultation", async () => {
    const { db, service } = setup(); db.inquiry.findUniqueOrThrow.mockResolvedValue({ status: "CLOSED" });
    await expect(service.message({ accessToken: "a".repeat(64), body: "문의" })).rejects.toThrow(BadRequestException);
    expect(db.inquiryMessage.create).not.toHaveBeenCalled();
  });
  it("logs out only the submitted scoped token", async () => {
    const { db, service } = setup(); const token = "b".repeat(64); await service.logout(token);
    expect(db.inquiryAccess.updateMany).toHaveBeenCalledWith({ where: { sessionHash: createHash("sha256").update(token).digest("hex") }, data: { sessionHash: null, sessionExpiresAt: null } });
  });
});
