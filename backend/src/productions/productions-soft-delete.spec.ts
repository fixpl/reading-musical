import { ProductionAccessService } from "./production-access.service";
import { ProductionActivityLogService } from "./production-activity-log.service";
import type { RequestUser } from "../common/types/request-user";
import { ProductionsService } from "./productions.service";

const admin = { id: "admin", platformRole: "SUPER_ADMIN", name: "운영자" } as RequestUser;

function build(deletedAt: Date | null) {
  const prisma = {
    production: {
      findUnique: jest.fn().mockResolvedValue({ id: "p1", organizationId: null, deletedAt }),
      update: jest.fn().mockResolvedValue({ id: "p1", deletedAt: new Date() })
    },
    guestReadingAccess: { findMany: jest.fn().mockResolvedValue([{ id: "g1" }, { id: "g2" }]) },
    productionShowcase: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    recruitmentRound: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(),
    activityLog: { create: jest.fn() }
  };
  prisma.$transaction.mockImplementation((operation) => operation(prisma));
  const gateway = { disconnectGuestAccess: jest.fn() };
  const service = new ProductionsService(
    prisma as never,
    new ProductionAccessService(prisma as never),
    new ProductionActivityLogService(prisma as never),
    {} as never,
    gateway as never
  );
  return { service, prisma, gateway };
}

describe("ProductionsService.softDelete", () => {
  it("disconnects every guest socket of the production after the delete commit", async () => {
    const { service, prisma, gateway } = build(null);
    await service.softDelete("p1", admin);
    expect(prisma.production.update).toHaveBeenCalled();
    expect(prisma.productionShowcase.updateMany).toHaveBeenCalledWith({
      where: { productionId: "p1", publishedAt: { not: null } },
      data: expect.objectContaining({ publishedAt: null, publishedById: null, revision: { increment: 1 } })
    });
    expect(prisma.guestReadingAccess.findMany).toHaveBeenCalledWith({ where: { productionId: "p1" }, select: { id: true } });
    expect(gateway.disconnectGuestAccess).toHaveBeenCalledTimes(2);
    expect(gateway.disconnectGuestAccess).toHaveBeenCalledWith("g1");
    expect(gateway.disconnectGuestAccess).toHaveBeenCalledWith("g2");
  });

  it("clears a stale public snapshot when a deleted production is restored", async () => {
    const { service, prisma } = build(new Date());
    await service.restore("p1", admin);
    expect(prisma.production.update).toHaveBeenCalledWith(expect.objectContaining({ data: { deletedAt: null } }));
    expect(prisma.productionShowcase.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("clears a public snapshot in the same transaction as archiving", async () => {
    const { service, prisma } = build(null);
    await service.archive("p1", admin);
    expect(prisma.production.update).toHaveBeenCalledWith(expect.objectContaining({ data: { archived: true, visibility: "DRAFT" } }));
    expect(prisma.productionShowcase.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("does nothing for an already deleted production", async () => {
    const { service, gateway } = build(new Date());
    await service.softDelete("p1", admin);
    expect(gateway.disconnectGuestAccess).not.toHaveBeenCalled();
  });
});
