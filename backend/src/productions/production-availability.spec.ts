import { ConflictException, ExecutionContext, NotFoundException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PrismaService } from "../prisma/prisma.service";
import { ActiveInvitationProductionGuard, NoRunningReadingGuard } from "./production-availability.guard";
import { ProductionDeletionImpactController } from "./deletion-impact.controller";
import { RolesGuard } from "../common/guards/roles.guard";
import { ALLOW_DELETED_PRODUCTION } from "../common/decorators/allow-deleted-production.decorator";
import { PLATFORM_ROLES_KEY } from "../common/decorators/platform-roles.decorator";
const context = (params: object) => ({ switchToHttp: () => ({ getRequest: () => ({ params, user: { id: "operator", platformRole: "SUPER_ADMIN" } }) }), getClass: () => class {}, getHandler: () => function handler() {} }) as unknown as ExecutionContext;

describe("trash preconditions and retained relationships", () => {
  it("blocks trashing an active reading without mutating data", async () => {
    const db = { readingSession: { count: jest.fn().mockResolvedValue(1) } };
    const guard = new NoRunningReadingGuard(db as unknown as PrismaService);
    await expect(guard.canActivate(context({ id: "production" }))).rejects.toThrow(ConflictException);
    expect(db.readingSession.count).toHaveBeenCalledWith({ where: { productionId: "production", startedAt: { not: null }, endedAt: null } });
  });
  it("allows the existing authorized trash flow when no reading is running", async () => {
    const db = { readingSession: { count: jest.fn().mockResolvedValue(0) } };
    await expect(new NoRunningReadingGuard(db as unknown as PrismaService).canActivate(context({ id: "production" }))).resolves.toBe(true);
  });
  it.each([{ deletedAt: new Date(), archived: false }, { deletedAt: null, archived: true }])("cannot accept invitations to unavailable performances %s", async (production) => {
    const db = { invitation: { findUnique: jest.fn().mockResolvedValue({ production }) } };
    await expect(new ActiveInvitationProductionGuard(db as unknown as PrismaService).canActivate(context({ token: "invitation-token" }))).rejects.toThrow(NotFoundException);
  });
  it("keeps normal invitation validation available on active productions", async () => {
    const db = { invitation: { findUnique: jest.fn().mockResolvedValue({ production: { deletedAt: null, archived: false } }) } };
    await expect(new ActiveInvitationProductionGuard(db as unknown as PrismaService).canActivate(context({ token: "invitation-token" }))).resolves.toBe(true);
  });
  it("keeps deleted production resources unavailable, including for platform administrators", async () => {
    const db = { production: { findUnique: jest.fn().mockResolvedValue({ deletedAt: new Date() }) } };
    const reflector = { get: jest.fn().mockReturnValue("productions"), getAllAndOverride: jest.fn().mockImplementation((key) => key === PLATFORM_ROLES_KEY ? ["SUPER_ADMIN"] : undefined) };
    await expect(new RolesGuard(reflector as unknown as Reflector, db as unknown as PrismaService).canActivate(context({ id: "production" }))).rejects.toThrow(NotFoundException);
  });
  it("allows only an explicitly marked restore handler to inspect a deleted performance", async () => {
    const db = { production: { findUnique: jest.fn() } };
    const reflector = { get: jest.fn().mockReturnValue("productions"), getAllAndOverride: jest.fn().mockImplementation((key) => key === ALLOW_DELETED_PRODUCTION ? true : key === PLATFORM_ROLES_KEY ? ["SUPER_ADMIN"] : undefined) };
    await expect(new RolesGuard(reflector as unknown as Reflector, db as unknown as PrismaService).canActivate(context({ id: "production" }))).resolves.toBe(true);
    expect(db.production.findUnique).not.toHaveBeenCalled();
  });
  it("does not interpret an admin user id as a production id", async () => {
    const db = { production: { findUnique: jest.fn() } };
    const reflector = { get: jest.fn().mockReturnValue("admin/users"), getAllAndOverride: jest.fn().mockImplementation((key) => key === PLATFORM_ROLES_KEY ? ["SUPER_ADMIN"] : undefined) };
    await expect(new RolesGuard(reflector as unknown as Reflector, db as unknown as PrismaService).canActivate(context({ id: "user" }))).resolves.toBe(true);
    expect(db.production.findUnique).not.toHaveBeenCalled();
  });
  it("reports actors, staff, files, and linked applications without an irreversible action", async () => {
    const db = {
      production: { findUnique: jest.fn().mockResolvedValue({ id: "production", title: "공연", deletedAt: new Date(), _count: { assets: 2, scripts: 1 } }) },
      membership: { findMany: jest.fn().mockResolvedValue([{ id: "a", primaryRole: "ACTOR", roles: [{ role: "ACTOR" }] }, { id: "b", primaryRole: "STAFF", roles: [] }]) },
      scheduleEvent: { count: jest.fn().mockResolvedValue(1) }, readingSession: { count: jest.fn().mockResolvedValue(0) },
      asset: { aggregate: jest.fn().mockResolvedValue({ _sum: { sizeBytes: 1000 } }) },
      inquiry: { findMany: jest.fn().mockResolvedValue([{ id: "inquiry", orgName: "기관", status: "CONVERTED" }]) }
    };
    const result = await new ProductionDeletionImpactController(db as unknown as PrismaService).impact("production");
    expect(result.counts).toEqual(expect.objectContaining({ actors: 1, staff: 1, members: 2, assets: 2, fileBytes: 1000, inquiries: 1 }));
    expect(result.guidance.accountsPreserved).toBe(true);
    expect(result.guidance.permanentDeletionAvailable).toBe(false);
    expect(result.inquiries[0].id).toBe("inquiry");
    expect(db).not.toHaveProperty("user");
  });
});
