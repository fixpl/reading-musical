import "reflect-metadata";
import { BadRequestException, ConflictException, ServiceUnavailableException } from "@nestjs/common";
import type { LegalDocument, Prisma } from "@prisma/client";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { PLATFORM_ROLES_KEY } from "../common/decorators/platform-roles.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { PrismaService } from "../prisma/prisma.service";
import { AdminSiteController, SiteController } from "./site.controller";
import { assertMarketingSelection, assertPublishable, publicSiteInfo, requireCurrentDocument, type LegalKind } from "./site-policy";
import { RegistrationConsentDto } from "./site.dto";
import { SiteService } from "./site.service";

const document = (kind: LegalKind): LegalDocument => ({ id: `doc-${kind}`, kind, version: 1, title: kind, body: "본문", purpose: "목적", items: "항목", retention: "기간", refusal: "거부권", effectiveAt: new Date("2026-01-01T00:00:00Z"), publishedAt: new Date("2026-01-01T00:00:00Z"), createdAt: new Date(), createdById: "admin" });
const agreements = () => ({ terms: true, privacy: true, age14: true, termsDocumentId: "doc-TERMS", privacyDocumentId: "doc-SIGNUP_PRIVACY" });

function setup() {
  const db = {
    legalDocument: { findMany: jest.fn().mockResolvedValue([document("TERMS"), document("PRIVACY_POLICY"), document("SIGNUP_PRIVACY")]) },
    user: { findUniqueOrThrow: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    consentEvent: { createMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    emailDelivery: { create: jest.fn() },
    systemSetting: { findUnique: jest.fn().mockResolvedValue(null) },
    faqCategory: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn()
  };
  db.$transaction.mockImplementation((callback: (tx: typeof db) => unknown) => callback(db));
  return { db, service: new SiteService(db as unknown as PrismaService) };
}

describe("site policy boundaries", () => {
  it("never exposes arbitrary system-setting keys as public site metadata", () => {
    const info = publicSiteInfo({ siteName: "서비스", apiSecret: "never-public", jwt: "secret", supportRetentionDays: -1 });
    expect(info.siteName).toBe("서비스"); expect(info).not.toHaveProperty("apiSecret"); expect(info).not.toHaveProperty("jwt"); expect(info.supportRetentionDays).toBe(365);
  });
  it("requires all four disclosures before publishing a consent document", () => {
    expect(() => assertPublishable({ kind: "SIGNUP_PRIVACY", body: "본문", purpose: "목적", items: "이메일", retention: "1년" })).toThrow(BadRequestException);
    expect(() => assertPublishable(document("SIGNUP_PRIVACY"))).not.toThrow();
  });
  it("fails closed when a required policy has not been published", () => {
    expect(() => requireCurrentDocument([], "TERMS", "anything")).toThrow(ServiceUnavailableException);
  });
  it("rejects an agreement for a different version", () => {
    expect(() => requireCurrentDocument([document("TERMS")], "TERMS", "old-document")).toThrow(ConflictException);
  });
  it("cannot enable email marketing by omitting its separate processing consent", () => {
    expect(() => assertMarketingSelection(false, true)).toThrow(BadRequestException);
    expect(() => assertMarketingSelection(false, false)).not.toThrow();
  });
  it("validates booleans as booleans, not truthy strings", async () => {
    const dto = plainToInstance(RegistrationConsentDto, { terms: "true", privacy: true, age14: true });
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === "terms")).toBe(true);
  });
  it("rejects missing or unchecked signup agreements", async () => {
    const { service, db } = setup();
    await expect(service.registrationConsents({ ...agreements(), terms: false }, undefined, db as unknown as Prisma.TransactionClient)).rejects.toThrow(BadRequestException);
    expect(db.legalDocument.findMany).not.toHaveBeenCalled();
  });
  it("stores mandatory versions and leaves marketing false by default", async () => {
    const { service, db } = setup();
    const result = await service.registrationConsents(agreements(), undefined, db as unknown as Prisma.TransactionClient);
    expect(result.marketingEmail).toBe(false); expect(result.marketingPrivacy).toBe(false);
    expect(result.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "TERMS", documentId: "doc-TERMS", granted: true }),
      expect.objectContaining({ kind: "SIGNUP_PRIVACY", documentId: "doc-SIGNUP_PRIVACY", granted: true }),
      expect.objectContaining({ kind: "MARKETING_EMAIL", granted: false })
    ]));
    expect(db.legalDocument.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ publishedAt: { not: null }, effectiveAt: { lte: expect.any(Date) } }) }));
  });
  it("requires separate optional consent when a phone is supplied", async () => {
    const { service, db } = setup();
    await expect(service.registrationConsents(agreements(), "01000000000", db as unknown as Prisma.TransactionClient)).rejects.toThrow(BadRequestException);
  });
  it("does not require phone or optional processing to create a member", async () => {
    const { service, db } = setup();
    await expect(service.registrationConsents(agreements(), "", db as unknown as Prisma.TransactionClient)).resolves.toHaveProperty("marketingEmail", false);
  });
  it("rejects inquiry submissions without consent and honeypot submissions", async () => {
    const { service } = setup();
    await expect(service.inquiryConsent({ privacyConsent: false, privacyDocumentId: "doc", age14: true })).rejects.toThrow(BadRequestException);
    await expect(service.inquiryConsent({ privacyConsent: true, privacyDocumentId: "doc", age14: true, website: "spam" })).rejects.toThrow(BadRequestException);
  });
  it("allows withdrawal even when no current marketing documents exist", async () => {
    const { service, db } = setup();
    db.legalDocument.findMany.mockResolvedValue([]);
    db.user.findUniqueOrThrow.mockResolvedValue({ id: "member", email: "member@example.org", marketingPrivacy: true, marketingEmail: true, marketingRevision: 3 });
    await service.updateMarketing("member", { revision: 3, marketingPrivacy: false, marketing: false });
    expect(db.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "member", marketingRevision: 3 }, data: expect.objectContaining({ marketingEmail: false, marketingPrivacy: false, marketingRevision: { increment: 1 } }) }));
    expect(db.consentEvent.createMany).toHaveBeenCalledWith({ data: expect.arrayContaining([expect.objectContaining({ userId: "member", kind: "MARKETING_EMAIL", granted: false })]) });
  });
  it("rejects stale consent updates before mutating preferences", async () => {
    const { service, db } = setup();
    db.user.findUniqueOrThrow.mockResolvedValue({ marketingRevision: 4 });
    await expect(service.updateMarketing("member", { revision: 3, marketingPrivacy: false, marketing: false })).rejects.toThrow(ConflictException);
    expect(db.user.updateMany).not.toHaveBeenCalled();
  });
  it("filters hidden categories and hidden questions from the public FAQ", async () => {
    const { service, db } = setup(); await service.faqs();
    expect(db.faqCategory.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { active: true, questions: { some: { active: true } } }, include: { questions: expect.objectContaining({ where: { active: true } }) } }));
  });
  it("guards all site administration with authentication and SUPER_ADMIN", () => {
    expect(Reflect.getMetadata(PLATFORM_ROLES_KEY, AdminSiteController)).toEqual(["SUPER_ADMIN"]);
    expect(Reflect.getMetadata("__guards__", AdminSiteController)).toEqual(expect.arrayContaining([JwtAuthGuard, RolesGuard]));
    expect(Reflect.getMetadata("__guards__", SiteController.prototype.consents)).toContain(JwtAuthGuard);
    expect(Reflect.getMetadata("__guards__", SiteController.prototype.mine)).toContain(JwtAuthGuard);
  });
});
