import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import { PLATFORM_ROLES_KEY } from "../decorators/platform-roles.decorator";
import { PRODUCTION_ROLES_KEY } from "../decorators/production-roles.decorator";
import { RolesGuard } from "./roles.guard";

function scenario(productionRoles: string[] | undefined, membership: { id: string } | null, sameOrg = false) {
  const reflector = {
    getAllAndOverride: jest.fn((key: string) => key === PLATFORM_ROLES_KEY ? ["SUPER_ADMIN", "ORG_ADMIN"] : key === PRODUCTION_ROLES_KEY ? productionRoles : undefined),
    get: jest.fn()
  };
  const prisma = {
    production: { findUnique: jest.fn().mockResolvedValue({ deletedAt: null, organizationId: sameOrg ? "own-org" : "other-org" }) },
    user: { findUnique: jest.fn().mockResolvedValue({ organizationId: "own-org" }) },
    membership: { findFirst: jest.fn().mockResolvedValue(membership) }
  };
  const context = {
    getHandler: () => () => undefined,
    getClass: () => class Dummy {},
    switchToHttp: () => ({ getRequest: () => ({ user: { id: "u1", platformRole: "ORG_ADMIN" }, params: { pid: "p1" } }) })
  } as unknown as ExecutionContext;
  return { guard: new RolesGuard(reflector as unknown as Reflector, prisma as never), context, prisma };
}

describe("RolesGuard cross-organization participant", () => {
  it("uses only the endpoint's allowed production role in a foreign organization", async () => {
    const { guard, context, prisma } = scenario(["ACTOR", "STAFF"], { id: "m1" });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.membership.findFirst).toHaveBeenCalledWith({
      where: { userId: "u1", productionId: "p1", roles: { some: { role: { in: ["ACTOR", "STAFF"] } } } }, select: { id: true }
    });
  });
  it("does not grant production management from the foreign platform role", async () => {
    const { guard, context, prisma } = scenario(["PRODUCER"], null);
    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    expect(prisma.membership.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ roles: { some: { role: { in: ["PRODUCER"] } } } })
    }));
  });
  it("keeps same-organization administrator access without a membership", async () => {
    const { guard, context, prisma } = scenario(["PRODUCER"], null, true);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.membership.findFirst).not.toHaveBeenCalled();
  });
  it("keeps platform-only endpoints independent from production membership", async () => {
    const { guard, context, prisma } = scenario(undefined, null);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.membership.findFirst).not.toHaveBeenCalled();
  });
});
