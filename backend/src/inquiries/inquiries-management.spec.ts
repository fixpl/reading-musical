import { ConflictException, ForbiddenException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SiteService } from "../site/site.service";
import { ProductionsService } from "../productions/productions.service";
import type { RequestUser } from "../common/types/request-user";
import { InquiriesService } from "./inquiries.service";
const user = { id: "operator", platformRole: "SUPER_ADMIN" } as RequestUser;
const record = { id: "inquiry", revision: 3, status: "IN_REVIEW", productionId: null, orgName: "기관", contactName: "담당자", email: "applicant@example.invalid", phone: "000", message: "비공개 상담 원문", planningNote: "내부 기획", adminNote: "운영 메모" };
function setup() {
  const db = {
    $queryRaw: jest.fn(), $transaction: jest.fn(),
    inquiry: { findUnique: jest.fn().mockResolvedValue(record), update: jest.fn().mockResolvedValue({ ...record, revision: 4 }), create: jest.fn().mockResolvedValue(record), findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), groupBy: jest.fn().mockResolvedValue([]) },
    inquiryMessage: { create: jest.fn() }, emailDelivery: { create: jest.fn() }, activityLog: { create: jest.fn() },
    production: { create: jest.fn().mockResolvedValue({ id: "production", title: "새 공연" }), findUnique: jest.fn().mockResolvedValue({ id: "production", title: "기존 공연", deletedAt: null, archived: false }) },
    user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ organizationId: "organization" }) },
    checklistTemplate: { count: jest.fn().mockResolvedValue(1), findMany: jest.fn().mockResolvedValue([]) }
  };
  db.$transaction.mockImplementation((callback) => callback(db));
  const site = { inquiryConsent: jest.fn().mockResolvedValue({ id: "document" }) };
  return { db, site, service: new InquiriesService(db as unknown as PrismaService, {} as ProductionsService, site as unknown as SiteService) };
}
describe("performance inquiry administration", () => {
  it("creates a private application and receipt within the same transaction", async () => {
    const { db, site, service } = setup();
    const result = await service.create({ orgName: " 기관 ", contactName: "담당자", email: record.email, message: record.message, privacyConsent: true, age14: true, privacyDocumentId: "document" });
    expect(site.inquiryConsent.mock.calls[0][1]).toBe(db);
    expect(db.inquiry.create.mock.calls[0][0].data.orgName).toBe("기관");
    expect(db.emailDelivery.create.mock.calls[0][0].data.bodyText).not.toContain(record.message);
    expect(result.receiptDelivery).toBe("QUEUED");
  });
  it("rejects stale admin edits before changing any data", async () => {
    const { db, service } = setup(); await expect(service.update("inquiry", { revision: 2, adminNote: "수정" }, user)).rejects.toThrow(ConflictException);
    expect(db.inquiry.update).not.toHaveBeenCalled();
  });
  it("guards conversion in the service, not only the controller", async () => {
    const { db, service } = setup(); await expect(service.convertToProduction("inquiry", { revision: 3 }, { ...user, platformRole: "MEMBER" })).rejects.toThrow(ForbiddenException);
    expect(db.production.create).not.toHaveBeenCalled();
  });
  it("returns an existing connection instead of creating a duplicate on repeat conversion", async () => {
    const { db, service } = setup(); db.inquiry.findUnique.mockResolvedValue({ ...record, productionId: "production" });
    const result = await service.convertToProduction("inquiry", { revision: 2 }, user);
    expect(result.alreadyLinked).toBe(true); expect(db.production.create).not.toHaveBeenCalled();
  });
  it("creates a private production atomically and does not copy contact data or private notes", async () => {
    const { db, service } = setup(); await service.convertToProduction("inquiry", { revision: 3, title: "새 공연" }, user);
    const data = db.production.create.mock.calls[0][0].data;
    expect(data.visibility).toBe("DRAFT"); expect(data.memberships.create.userId).toBe(user.id);
    for (const secret of [record.email, record.phone, record.message, record.adminNote, record.planningNote]) expect(JSON.stringify(data)).not.toContain(secret);
    expect(data).not.toHaveProperty("planningMemos"); expect(data).not.toHaveProperty("description");
    expect(db.inquiry.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ productionId: "production", status: "CONVERTED", revision: { increment: 1 } }) }));
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20000 });
  });
  it("never reconnects an inquiry silently to a different production", async () => {
    const { db, service } = setup(); db.inquiry.findUnique.mockResolvedValue({ ...record, productionId: "old" });
    await expect(service.link("inquiry", { revision: 3, productionId: "different" }, user)).rejects.toThrow(ConflictException);
    expect(db.inquiry.update).not.toHaveBeenCalled();
  });
  it.each(["deletedAt", "archived"])("rejects a target with %s", async (field) => {
    const { db, service } = setup(); db.production.findUnique.mockResolvedValue({ id: "production", title: "기존 공연", deletedAt: null, archived: false, [field]: field === "archived" ? true : new Date() });
    await expect(service.link("inquiry", { revision: 3, productionId: "production" }, user)).rejects.toThrow();
    expect(db.inquiry.update).not.toHaveBeenCalled();
  });
  it("stores a public answer separately from internal notes and keeps mail notification minimal", async () => {
    const { db, service } = setup(); await service.reply("inquiry", { revision: 3, body: "신청자에게 답변" }, user);
    expect(db.inquiryMessage.create.mock.calls[0][0].data).toEqual({ inquiryId: "inquiry", authorKind: "OPERATOR", authorId: user.id, body: "신청자에게 답변", public: true });
    const mail = db.emailDelivery.create.mock.calls[0][0].data;
    expect(mail.bodyText).not.toContain("신청자에게 답변"); expect(mail.bodyText).not.toContain(record.adminNote);
    expect(db.inquiry.update.mock.calls[0][0].data).not.toHaveProperty("adminNote");
  });
  it("paginates and filters linked inquiries on the server", async () => {
    const { db, service } = setup(); await service.listForAdmin({ productionId: "production", page: 3, take: 30, q: "기관" });
    expect(db.inquiry.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ productionId: "production" }), skip: 60, take: 30 }));
  });
});
