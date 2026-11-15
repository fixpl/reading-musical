import { BadRequestException, ConflictException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SiteService } from "./site.service";
import { UsersService } from "../users/users.service";
import { AssetsController } from "../assets/assets.controller";
import { AssetsService } from "../assets/assets.service";
import { AssetPurpose, CreateAssetDto } from "../assets/dto";
import type { RequestUser } from "../common/types/request-user";

function setup() {
  const documents = [
    { id: "policy", kind: "PRIVACY_POLICY" },
    { id: "profile-v2", kind: "PROFILE_PRIVACY" },
    { id: "phone-v1", kind: "OPTIONAL_PROFILE" }
  ];
  const previous = { id: "member", phone: "01000000000", address: "서울", birthDate: new Date("1990-01-01"), photoAssetId: null, gender: "UNSPECIFIED", profileDetails: {}, updatedAt: new Date("2026-10-01T00:00:00Z") };
  const db = {
    systemSetting: { findUnique: jest.fn().mockResolvedValue(null) },
    legalDocument: { findMany: jest.fn().mockResolvedValue(documents) },
    consentEvent: { create: jest.fn().mockResolvedValue({ id: "consent" }) },
    user: { findUniqueOrThrow: jest.fn().mockResolvedValue(previous), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    $transaction: jest.fn()
  };
  db.$transaction.mockImplementation((callback: (tx: typeof db) => unknown) => callback(db));
  return { db, service: new SiteService(db as unknown as PrismaService) };
}

describe("site follow-up regressions", () => {
  it("keeps signup closed and exposes setup status when the generated client is old", async () => {
    const { db } = setup();
    const service = new SiteService({ ...db, legalDocument: undefined } as unknown as PrismaService);
    const result = await service.publicInfo();
    expect(result.setupRequired).toBe(true);
    expect(result.policies).toEqual([]);
    expect(result.ready.signup).toBe(false);
    expect(result.ready.inquiry).toBe(false);
    expect(result.info).toHaveProperty("siteName");
  });
  it("distinguishes an empty policy catalog from missing schema", async () => {
    const { db, service } = setup(); db.legalDocument.findMany.mockResolvedValue([]);
    await expect(service.publicInfo()).resolves.toEqual(expect.objectContaining({ setupRequired: false, policies: [] }));
  });
  it("handles missing tables without fabricating published agreements", async () => {
    const { db, service } = setup();
    db.legalDocument.findMany.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("missing", { code: "P2021", clientVersion: "test" }));
    await expect(service.publicInfo()).resolves.toEqual(expect.objectContaining({ setupRequired: true, policies: [], ready: expect.objectContaining({ signup: false }) }));
  });
  it("does not hide unrelated database failures as initial setup", async () => {
    const { db, service } = setup(); db.legalDocument.findMany.mockRejectedValue(new Error("database offline"));
    await expect(service.publicInfo()).rejects.toThrow("database offline");
  });
  it("returns a controlled preparation error for ungenerated legal models", () => {
    const { db } = setup(); const service = new SiteService({ ...db, legalDocument: undefined } as unknown as PrismaService);
    expect(() => service.currentDocuments()).toThrow(ServiceUnavailableException);
  });
  it("does not infer profile consent from unchecked or string-valued input", async () => {
    const { db, service } = setup();
    await expect(service.recordProfileConsent("member", { profilePrivacyConsent: false }, "PROFILE_UPDATE")).rejects.toThrow(BadRequestException);
    await expect(service.recordProfileConsent("member", { profilePrivacyConsent: "true" as unknown as boolean }, "PROFILE_UPDATE")).rejects.toThrow(BadRequestException);
    expect(db.consentEvent.create).not.toHaveBeenCalled();
  });
  it("cannot reuse a signup phone document for broader optional profile data", async () => {
    const { db, service } = setup();
    await expect(service.recordProfileConsent("member", { profilePrivacyConsent: true, profilePrivacyDocumentId: "phone-v1" }, "PROFILE_UPDATE")).rejects.toThrow(ConflictException);
    expect(db.consentEvent.create).not.toHaveBeenCalled();
  });
  it("records the exact profile document and action source", async () => {
    const { db, service } = setup();
    await service.recordProfileConsent("member", { profilePrivacyConsent: true, profilePrivacyDocumentId: "profile-v2" }, "PROFILE_PHOTO");
    expect(db.consentEvent.create).toHaveBeenCalledWith({ data: { userId: "member", kind: "PROFILE_PRIVACY", granted: true, documentId: "profile-v2", source: "PROFILE_PHOTO" } });
  });
  it("persists explicit nulls when a member clears optional profile fields", async () => {
    const { db, service } = setup();
    const record = jest.spyOn(service, "recordProfileConsent");
    const users = new UsersService(db as unknown as PrismaService, service);
    await users.updateMe("member", { phone: null, birthDate: null, address: "" });
    expect(record).not.toHaveBeenCalled();
    expect(db.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ phone: null, birthDate: null, address: null }) }));
  });
  it("rejects adding a phone before a profile write when consent is absent", async () => {
    const { db, service } = setup(); const users = new UsersService(db as unknown as PrismaService, service);
    await expect(users.updateMe("member", { phone: "01099999999" })).rejects.toThrow(BadRequestException);
    expect(db.user.updateMany).not.toHaveBeenCalled();
  });
  it("reports concurrent profile updates without treating the save as successful", async () => {
    const { db, service } = setup(); db.user.updateMany.mockResolvedValue({ count: 0 });
    const users = new UsersService(db as unknown as PrismaService, service);
    await expect(users.updateMe("member", { phone: null })).rejects.toThrow(ConflictException);
  });
  it("checks photo consent before issuing an upload URL", async () => {
    const { service } = setup(); const assets = { createAsset: jest.fn() };
    const controller = new AssetsController(assets as unknown as AssetsService, service);
    const photo: CreateAssetDto = { purpose: AssetPurpose.PROFILE_PHOTO, fileName: "profile.jpg", mimeType: "image/jpeg", size: 10 };
    await expect(controller.createAsset(photo, { id: "member" } as RequestUser)).rejects.toThrow(BadRequestException);
    expect(assets.createAsset).not.toHaveBeenCalled();
  });
});
