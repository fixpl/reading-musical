import { NotFoundException, ConflictException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { SiteService } from "./site.service";
import { SupportService } from "./support.service";
import type { CreateSupportDto } from "./site.dto";

function setup() {
  const db = {
    supportTicket: { create: jest.fn().mockResolvedValue({ id: "ticket", expiresAt: new Date() }), findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), updateMany: jest.fn().mockResolvedValue({ count: 1 }), deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ name: "회원", email: "member@example.org" }) },
    emailDelivery: { create: jest.fn(), deleteMany: jest.fn() },
    $transaction: jest.fn()
  };
  db.$transaction.mockImplementation((callback: (tx: typeof db) => unknown) => callback(db));
  const site = { inquiryConsent: jest.fn().mockResolvedValue({ id: "privacy-version" }), settings: jest.fn().mockResolvedValue({ info: { supportRetentionDays: 30 } }), audit: jest.fn() };
  return { db, site, service: new SupportService(db as unknown as PrismaService, site as unknown as SiteService) };
}
const input: CreateSupportDto = { contactName: "손님", email: "guest@example.org", category: "GENERAL", subject: "문의", message: "공개하지 않는 내용", privacyConsent: true, privacyDocumentId: "policy", age14: true };

describe("private support tickets", () => {
  it("returns a guest key once and stores only its SHA256 hash", async () => {
    const { service, db } = setup(); const receipt = await service.create(input);
    expect(receipt.guestKey).toMatch(/^[a-f0-9]{64}$/);
    const stored = db.supportTicket.create.mock.calls[0][0].data;
    expect(stored.guestKeyHash).toBe(createHash("sha256").update(receipt.guestKey!).digest("hex"));
    expect(stored.guestKeyHash).not.toBe(receipt.guestKey);
    expect(stored.privacyDocumentId).toBe("privacy-version");
  });
  it("uses authenticated member identity rather than caller-supplied contact fields", async () => {
    const { service, db } = setup(); const receipt = await service.create(input, "member-id");
    expect(receipt.guestKey).toBeNull();
    expect(db.supportTicket.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: "member-id", contactName: "회원", email: "member@example.org", guestKeyHash: null }) }));
  });
  it("does not allow guessed ids or incorrect guest keys", async () => {
    const { service, db } = setup(); db.supportTicket.findFirst.mockResolvedValue(null);
    await expect(service.lookup({ ticketId: "ticket-id", key: "f".repeat(64) })).rejects.toThrow(NotFoundException);
    const query = db.supportTicket.findFirst.mock.calls[0][0];
    expect(query.where).toEqual(expect.objectContaining({ id: "ticket-id", userId: null, guestKeyHash: expect.any(String), expiresAt: { gt: expect.any(Date) } }));
    expect(query.select).not.toHaveProperty("internalNote"); expect(query.select).not.toHaveProperty("guestKeyHash"); expect(query.select).not.toHaveProperty("email");
  });
  it("isolates member history and paginates it without exposing internal notes", async () => {
    const { service, db } = setup(); await service.mine("owner-id", { page: 2 });
    const query = db.supportTicket.findMany.mock.calls[0][0];
    expect(query.where.userId).toBe("owner-id"); expect(query.skip).toBe(20); expect(query.take).toBe(20);
    expect(query.select).not.toHaveProperty("internalNote");
  });
  it("rejects stale admin edits without queuing a duplicate reply", async () => {
    const { service, db } = setup(); db.supportTicket.findFirst.mockResolvedValue({ id: "ticket", answer: null }); db.supportTicket.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.update("ticket", { revision: 1, status: "ANSWERED", answer: "답변", internalNote: "운영 메모" }, "admin")).rejects.toThrow(ConflictException);
    expect(db.emailDelivery.create).not.toHaveBeenCalled();
  });
  it("never sends the private answer or question to an unverified email address", async () => {
    const { service, db } = setup(); db.supportTicket.findFirst.mockResolvedValue({ id: "ticket", email: "guest@example.org", answer: null, userId: null });
    await service.update("ticket", { revision: 1, status: "ANSWERED", answer: "비공개답변본문", internalNote: "내부메모" }, "admin");
    const mail = db.emailDelivery.create.mock.calls[0][0].data;
    expect(mail.bodyText).not.toContain("비공개답변본문"); expect(mail.bodyText).not.toContain("내부메모"); expect(mail.bodyText).toContain("ticket"); expect(mail.status).toBe("QUEUED");
  });
  it("purges expired tickets together with their reply delivery records", async () => {
    const { service, db } = setup(); db.supportTicket.findMany.mockResolvedValue([{ id: "expired" }]);
    await expect(service.purgeExpired()).resolves.toEqual({ deleted: 1 });
    expect(db.emailDelivery.deleteMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ templateKey: "site.support_reply" }) }));
    expect(db.supportTicket.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["expired"] }, expiresAt: { lte: expect.any(Date) } } });
  });
});
