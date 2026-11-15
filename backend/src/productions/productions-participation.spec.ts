import { ProductionAccessService } from "./production-access.service";
import type { RequestUser } from "../common/types/request-user";
import { ProductionsService } from "./productions.service";

const user = { id: "u1", platformRole: "ORG_ADMIN", name: "참여자" } as RequestUser;
function build() {
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue({ organizationId: "org-a" }) },
    production: { findMany: jest.fn().mockResolvedValue([
      { id: "p-own", organizationId: "org-a" }, { id: "p-other", organizationId: "org-b" }
    ]) },
    membership: { findMany: jest.fn().mockResolvedValue([
      { id: "m1", productionId: "p-other", primaryRole: "STAFF", roles: [{ role: "STAFF" }, { role: "ACTOR" }] }
    ]) }
  };
  return { prisma, service: new ProductionsService(prisma as never, new ProductionAccessService(prisma as never), {} as never, {} as never, {} as never) };
}

describe("ProductionsService organization and participation list", () => {
  it("does not treat two missing organizations as an administrator grant", async () => {
    const prisma = {
      production: { findUnique: jest.fn().mockResolvedValue({ id: "p1", title: "무소속 공연", organizationId: null }) },
      user: { findUnique: jest.fn().mockResolvedValue({ organizationId: null }) },
      membership: { findUnique: jest.fn().mockResolvedValue(null) }
    };
    const service = new ProductionsService(prisma as never, new ProductionAccessService(prisma as never), {} as never, {} as never, {} as never);
    await expect(service.findOne("p1", user)).rejects.toThrow("찾을 수 없어요");
  });
  it("unions own-organization productions with foreign productions having a membership", async () => {
    const { prisma, service } = build();
    const result = await service.listForUser(user);
    expect(prisma.production.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      archived: false, deletedAt: null, OR: [{ organizationId: "org-a" }, { memberships: { some: { userId: "u1" } } }]
    } }));
    expect(result).toEqual([
      expect.objectContaining({ id: "p-own", canManageProduction: true }),
      expect.objectContaining({ id: "p-other", canManageProduction: false, myMembership: { id: "m1", primaryRole: "STAFF", roles: ["STAFF", "ACTOR"] } })
    ]);
  });
  it("honors an explicitly assigned producer role in the foreign production", async () => {
    const { prisma, service } = build();
    prisma.membership.findMany.mockResolvedValue([{ id: "m1", productionId: "p-other", primaryRole: "STAFF", roles: [{ role: "PRODUCER" }] }]);
    const result = await service.listForUser(user);
    expect(result.find((item) => item.id === "p-other")).toMatchObject({ canManageProduction: true });
  });
});
