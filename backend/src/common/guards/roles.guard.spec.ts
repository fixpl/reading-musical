import { ForbiddenException, NotFoundException, type ExecutionContext } from "@nestjs/common";
import { PATH_METADATA } from "@nestjs/common/constants";
import type { Reflector } from "@nestjs/core";
import type { PlatformRole, ProductionRole } from "@prisma/client";
import { ALLOW_DELETED_PRODUCTION } from "../decorators/allow-deleted-production.decorator";
import { PLATFORM_ROLES_KEY } from "../decorators/platform-roles.decorator";
import { PRODUCTION_ROLES_KEY } from "../decorators/production-roles.decorator";
import type { RequestUser } from "../types/request-user";
import { RolesGuard } from "./roles.guard";

type Setup = {
  platformRoles?: PlatformRole[];
  productionRoles?: ProductionRole[];
  allowDeleted?: boolean;
  controllerPath?: string;
  user?: RequestUser;
  params?: Record<string, string | undefined>;
  body?: Record<string, unknown>;
  production?: { deletedAt?: Date | null; organizationId?: string | null } | null;
  callerOrganizationId?: string | null;
  membership?: { id: string } | null;
};

const user = (platformRole: PlatformRole, id = "u1"): RequestUser => ({ id, email: `${id}@x.io`, name: id, platformRole });

function run(setup: Setup) {
  const reflector = {
    getAllAndOverride: jest.fn((key: string) => {
      if (key === PLATFORM_ROLES_KEY) return setup.platformRoles;
      if (key === PRODUCTION_ROLES_KEY) return setup.productionRoles;
      if (key === ALLOW_DELETED_PRODUCTION) return setup.allowDeleted;
      return undefined;
    }),
    get: jest.fn((key: string) => (key === PATH_METADATA ? setup.controllerPath : undefined))
  };
  const prisma = {
    production: { findUnique: jest.fn().mockResolvedValue(setup.production === undefined ? { deletedAt: null, organizationId: "org1" } : setup.production) },
    user: { findUnique: jest.fn().mockResolvedValue({ organizationId: setup.callerOrganizationId === undefined ? "org1" : setup.callerOrganizationId }) },
    membership: { findFirst: jest.fn().mockResolvedValue(setup.membership ?? null) }
  };
  const request = { user: setup.user, params: setup.params ?? {}, body: setup.body };
  const context = {
    getHandler: () => () => undefined,
    getClass: () => class Dummy {},
    switchToHttp: () => ({ getRequest: () => request })
  } as unknown as ExecutionContext;
  const guard = new RolesGuard(reflector as unknown as Reflector, prisma as never);
  return { guard, context, prisma };
}

describe("RolesGuard", () => {
  describe("no role metadata", () => {
    it("lets anyone through, even without a user", async () => {
      const { guard, context } = run({ params: {} });
      await expect(guard.canActivate(context)).resolves.toBe(true);
    });
  });

  describe("deleted production", () => {
    it("404s on a soft-deleted production for any caller, even SUPER_ADMIN", async () => {
      const { guard, context } = run({
        platformRoles: ["SUPER_ADMIN"],
        user: user("SUPER_ADMIN"),
        params: { productionId: "p1" },
        production: { deletedAt: new Date() }
      });
      await expect(guard.canActivate(context)).rejects.toThrow(NotFoundException);
    });

    it("404s even on routes with no role metadata", async () => {
      const { guard, context } = run({ params: { pid: "p1" }, production: { deletedAt: new Date() } });
      await expect(guard.canActivate(context)).rejects.toThrow(NotFoundException);
    });

    it("skips the deleted check when the handler is marked AllowDeletedProduction", async () => {
      const { guard, context, prisma } = run({
        platformRoles: ["SUPER_ADMIN"],
        allowDeleted: true,
        user: user("SUPER_ADMIN"),
        params: { productionId: "p1" },
        production: { deletedAt: new Date() }
      });
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(prisma.production.findUnique).not.toHaveBeenCalled();
    });

    it("treats :id as a production id only for the productions controller or production-role handlers", async () => {
      const plain = run({ params: { id: "x1" }, controllerPath: "admin/users", production: { deletedAt: new Date() } });
      await expect(plain.guard.canActivate(plain.context)).resolves.toBe(true);
      expect(plain.prisma.production.findUnique).not.toHaveBeenCalled();

      const productions = run({ params: { id: "p1" }, controllerPath: "productions", production: { deletedAt: new Date() } });
      await expect(productions.guard.canActivate(productions.context)).rejects.toThrow(NotFoundException);

      const scoped = run({ params: { id: "p1" }, productionRoles: ["PRODUCER"], user: user("MEMBER"), production: { deletedAt: new Date() } });
      await expect(scoped.guard.canActivate(scoped.context)).rejects.toThrow(NotFoundException);
    });

    it("passes through when the production does not exist (handler decides)", async () => {
      const { guard, context } = run({ params: { pid: "p1" }, production: null });
      await expect(guard.canActivate(context)).resolves.toBe(true);
    });
  });

  describe("PlatformRoles only", () => {
    it("rejects a missing user", async () => {
      const { guard, context } = run({ platformRoles: ["SUPER_ADMIN"] });
      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });

    it("allows the listed platform role", async () => {
      const { guard, context } = run({ platformRoles: ["SUPER_ADMIN"], user: user("SUPER_ADMIN") });
      await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it("rejects other platform roles", async () => {
      for (const role of ["ORG_ADMIN", "MEMBER"] as PlatformRole[]) {
        const { guard, context } = run({ platformRoles: ["SUPER_ADMIN"], user: user(role) });
        await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      }
    });

    it("does not treat :id as a production for ORG_ADMIN on admin routes (no organization lookup)", async () => {
      const { guard, context, prisma } = run({
        platformRoles: ["SUPER_ADMIN", "ORG_ADMIN"],
        user: user("ORG_ADMIN"),
        params: { id: "some-user-id" },
        controllerPath: "admin"
      });
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
  });

  describe("ProductionRoles", () => {
    const base = { productionRoles: ["PRODUCER"] as ProductionRole[], params: { productionId: "p1" } };

    it("rejects a missing user", async () => {
      const { guard, context } = run(base);
      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });

    it("lets SUPER_ADMIN in when platformRoles lists it, without a membership lookup", async () => {
      const { guard, context, prisma } = run({ ...base, platformRoles: ["SUPER_ADMIN", "ORG_ADMIN"], user: user("SUPER_ADMIN") });
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(prisma.membership.findFirst).not.toHaveBeenCalled();
    });

    describe("ORG_ADMIN", () => {
      const withOrg = { ...base, platformRoles: ["SUPER_ADMIN", "ORG_ADMIN"] as PlatformRole[], user: user("ORG_ADMIN") };

      it("is allowed for a production in the same organization", async () => {
        const { guard, context } = run({ ...withOrg, production: { deletedAt: null, organizationId: "org1" }, callerOrganizationId: "org1" });
        await expect(guard.canActivate(context)).resolves.toBe(true);
      });

      it("is rejected for a production in another organization", async () => {
        const { guard, context } = run({ ...withOrg, production: { deletedAt: null, organizationId: "org2" }, callerOrganizationId: "org1" });
        await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      });

      it("is rejected when the caller has no organization, even if the production has none either", async () => {
        const { guard, context } = run({ ...withOrg, production: { deletedAt: null, organizationId: null }, callerOrganizationId: null });
        await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      });

      it("is rejected when the production has no organization but the caller does", async () => {
        const { guard, context } = run({ ...withOrg, production: { deletedAt: null, organizationId: null }, callerOrganizationId: "org1" });
        await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      });

      it("is rejected when the production cannot be found", async () => {
        const { guard, context } = run({ ...withOrg, production: null, callerOrganizationId: "org1" });
        await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      });

      it("is rejected when no production id can be resolved", async () => {
        const { guard, context } = run({ ...withOrg, params: {}, callerOrganizationId: "org1" });
        await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      });
    });

    describe("members and non-members (platform role MEMBER)", () => {
      it.each(["PRODUCER", "ACTOR", "STAFF"] as ProductionRole[])("allows a %s member holding a required role", async (role) => {
        const { guard, context, prisma } = run({
          productionRoles: [role],
          params: { productionId: "p1" },
          user: user("MEMBER"),
          membership: { id: "m1" }
        });
        await expect(guard.canActivate(context)).resolves.toBe(true);
        expect(prisma.membership.findFirst).toHaveBeenCalledWith({
          where: { userId: "u1", productionId: "p1", roles: { some: { role: { in: [role] } } } },
          select: { id: true }
        });
      });

      it("rejects a member without a required role (query returns none)", async () => {
        const { guard, context } = run({ ...base, user: user("MEMBER"), membership: null });
        await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      });

      it("rejects a non-member", async () => {
        const { guard, context } = run({ ...base, user: user("MEMBER"), membership: null });
        await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      });

      it("rejects an ORG_ADMIN when platformRoles does not list ORG_ADMIN and they are not a member", async () => {
        const { guard, context } = run({ ...base, platformRoles: ["SUPER_ADMIN"], user: user("ORG_ADMIN"), membership: null });
        await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      });

      it("rejects when the production id cannot be resolved", async () => {
        const { guard, context, prisma } = run({ productionRoles: ["PRODUCER"], params: {}, user: user("MEMBER") });
        await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
        expect(prisma.membership.findFirst).not.toHaveBeenCalled();
      });

      it("resolves the production id from pid, then productionId, then id, then body", async () => {
        const fromBody = run({ productionRoles: ["PRODUCER"], params: {}, body: { productionId: "pb" }, user: user("MEMBER"), membership: { id: "m" } });
        await fromBody.guard.canActivate(fromBody.context);
        expect(fromBody.prisma.membership.findFirst.mock.calls[0][0].where.productionId).toBe("pb");

        const fromPid = run({ productionRoles: ["PRODUCER"], params: { pid: "pp", productionId: "px", id: "pi" }, body: { productionId: "pb" }, user: user("MEMBER"), membership: { id: "m" } });
        await fromPid.guard.canActivate(fromPid.context);
        expect(fromPid.prisma.membership.findFirst.mock.calls[0][0].where.productionId).toBe("pp");
      });
    });
  });
});
