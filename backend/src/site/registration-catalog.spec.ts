import { BadRequestException, ConflictException, ServiceUnavailableException } from "@nestjs/common";
import type { LegalDocument, Prisma } from "@prisma/client";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { PrismaService } from "../prisma/prisma.service";
import { registrationCatalog } from "./registration-catalog";
import { SiteService } from "./site.service";
import { RegistrationConsentDto } from "./site.dto";

const kinds = ["TERMS", "PRIVACY_POLICY", "SIGNUP_PRIVACY", "OPTIONAL_PROFILE", "MARKETING_PRIVACY", "MARKETING_EMAIL"];
const documents = kinds.map((kind): LegalDocument => ({ id: `doc-${kind}`, kind, version: 2, title: kind, body: "약관 내용", purpose: "목적", items: "항목", retention: "기간", refusal: "거부권", publishedAt: new Date("2020-01-01"), effectiveAt: new Date("2020-01-01"), createdAt: new Date("2020-01-01"), createdById: "admin" }));
const agreement = (): RegistrationConsentDto => ({ terms: true, privacy: true, age14: true, optionalProfile: true, marketingPrivacy: true, marketing: true, termsDocumentId: "doc-TERMS", privacyDocumentId: "doc-SIGNUP_PRIVACY", optionalProfileDocumentId: "doc-OPTIONAL_PROFILE", marketingPrivacyDocumentId: "doc-MARKETING_PRIVACY", marketingEmailDocumentId: "doc-MARKETING_EMAIL" });
function setup(items = documents) {
  const db = { legalDocument: { findMany: jest.fn().mockResolvedValue(items) } };
  return { db, service: new SiteService(db as unknown as PrismaService), tx: db as unknown as Prisma.TransactionClient };
}
describe("published registration catalog", () => {
  it("keeps immutable document identities without a test mode", () => {
    const result = registrationCatalog(documents);
    expect(result.ready).toEqual({ signup: true, optionalProfile: true, marketing: true });
    expect(result.policies).toEqual(documents);
    expect(result).not.toHaveProperty("mode");
    expect(result.policies[0]).not.toHaveProperty("testOnly");
  });
  it("does not use drafts or future publications", () => {
    expect(registrationCatalog(documents.map((doc) => ({ ...doc, publishedAt: null }))).policies).toEqual([]);
    expect(registrationCatalog(documents.map((doc) => ({ ...doc, effectiveAt: new Date("2999-01-01") }))).ready.signup).toBe(false);
  });
  it("allows required-only registration with no optional catalogs", () => {
    const result = registrationCatalog(documents.slice(0, 3));
    expect(result.ready).toEqual({ signup: true, optionalProfile: false, marketing: false });
  });
  it("requires all three mandatory publications", () => {
    for (const kind of kinds.slice(0, 3)) expect(registrationCatalog(documents.filter((doc) => doc.kind !== kind)).ready.signup).toBe(false);
  });
  it("records real selections with the displayed document IDs", async () => {
    const { service, tx } = setup();
    const result = await service.registrationConsents(agreement(), "000-0000-0000", tx);
    expect(result.marketingPrivacy).toBe(true); expect(result.marketingEmail).toBe(true);
    expect(result.events).toHaveLength(6);
    expect(result.events.every((event) => event.source === "REGISTER")).toBe(true);
    expect(result.events).toContainEqual({ kind: "TERMS", documentId: "doc-TERMS", granted: true, source: "REGISTER" });
  });
  it("does not make marketing or contact a prerequisite for membership", async () => {
    const { service, tx } = setup();
    const result = await service.registrationConsents({ ...agreement(), optionalProfile: false, marketingPrivacy: false, marketing: false }, undefined, tx);
    expect(result.marketingEmail).toBe(false);
    expect(result.events.some((event) => event.kind === "OPTIONAL_PROFILE")).toBe(false);
  });
  it("requires mandatory choices and a separate phone consent", async () => {
    const { service, tx } = setup();
    await expect(service.registrationConsents({ ...agreement(), age14: false }, undefined, tx)).rejects.toThrow(BadRequestException);
    await expect(service.registrationConsents({ ...agreement(), optionalProfile: false }, "000-0000-0000", tx)).rejects.toThrow(BadRequestException);
  });
  it("rejects stale document IDs", async () => {
    const { service, tx } = setup();
    await expect(service.registrationConsents({ ...agreement(), termsDocumentId: "older-document" }, undefined, tx)).rejects.toThrow(ConflictException);
  });
  it("does not automatically approve an incomplete policy catalog", async () => {
    const { service, tx } = setup([]);
    await expect(service.registrationConsents(agreement(), undefined, tx)).rejects.toThrow(ServiceUnavailableException);
  });
  it.each(["development", "production", "staging", "test"])("rejects the retired signup mode even with NODE_ENV=%s", async (environment) => {
    const old = process.env.NODE_ENV;
    process.env.NODE_ENV = environment;
    try {
      const { service, db, tx } = setup();
      const stale = { ...agreement(), mode: "development" } as unknown as RegistrationConsentDto;
      await expect(service.registrationConsents(stale, undefined, tx)).rejects.toThrow(ConflictException);
      expect(db.legalDocument.findMany).not.toHaveBeenCalled();
    } finally { if (old === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = old; }
  });
  it("rejects the retired mode during DTO validation", async () => {
    const errors = await validate(plainToInstance(RegistrationConsentDto, { terms: true, privacy: true, age14: true, mode: "development" }));
    expect(errors.some((error) => error.property === "mode")).toBe(true);
  });
});
