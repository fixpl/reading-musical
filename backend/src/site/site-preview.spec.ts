import { NotFoundException } from "@nestjs/common";
import type { LegalDocument } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SiteService } from "./site.service";

const document: LegalDocument = { id: "published-terms", kind: "TERMS", version: 3, title: "이용약관", body: "공개 약관 내용", purpose: "", items: "", retention: "", refusal: "", publishedAt: new Date("2020-01-01"), effectiveAt: new Date("2020-01-01"), createdAt: new Date("2020-01-01"), createdById: "admin" };
function setup(items: LegalDocument[] = []) {
  const db = {
    systemSetting: { findUnique: jest.fn().mockResolvedValue(null) },
    legalDocument: { findMany: jest.fn().mockResolvedValue(items), findFirst: jest.fn().mockResolvedValue(document) },
    user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ marketingPrivacy: false, marketingEmail: false, marketingRevision: 1 }) },
    consentEvent: { findMany: jest.fn().mockResolvedValue([]) }
  };
  return { db, service: new SiteService(db as unknown as PrismaService) };
}
describe("public policy publication boundary", () => {
  it.each(["development", "production", "staging", "test"])("does not expose any preview catalog in %s", async (environment) => {
    const old = process.env.NODE_ENV; process.env.NODE_ENV = environment;
    try {
      const { db, service } = setup(); const result = await service.publicInfo();
      expect(result).not.toHaveProperty("policyPreviews");
      expect(result.registration).not.toHaveProperty("mode");
      expect(result.ready.signup).toBe(false);
      expect(db.legalDocument.findMany).toHaveBeenCalledTimes(1);
      expect(db.legalDocument.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { publishedAt: { not: null }, effectiveAt: { lte: expect.any(Date) } } }));
      await expect(service.publicDocument("TERMS", "old-bootstrap-id", true)).rejects.toThrow(NotFoundException);
      expect(db.legalDocument.findFirst).not.toHaveBeenCalled();
    } finally { if (old === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = old; }
  });
  it("returns exact published text and preserves its internal revision", async () => {
    const { service } = setup([document]); const result = await service.publicDocument("TERMS", document.id);
    expect(result.document.body).toBe(document.body);
    expect(result.document.version).toBe(3);
    expect(result.document).not.toHaveProperty("createdById");
    expect(result.document).not.toHaveProperty("preview");
  });
  it("cannot open an unpublished id through the normal detail endpoint", async () => {
    const { db, service } = setup(); db.legalDocument.findFirst.mockResolvedValue(null);
    await expect(service.publicDocument("TERMS", "unpublished-id")).rejects.toThrow(NotFoundException);
    expect(db.legalDocument.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "unpublished-id", publishedAt: { not: null }, effectiveAt: { lte: expect.any(Date) } }) }));
  });
  it("excludes former test records from ordinary consent history without changing stored records", async () => {
    const { db, service } = setup(); await service.myConsents("member");
    expect(db.consentEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "member", source: { in: ["REGISTER", "PREFERENCES", "PROFILE_UPDATE", "PROFILE_PHOTO"] } } }));
    expect(db.consentEvent).not.toHaveProperty("deleteMany");
  });
});
