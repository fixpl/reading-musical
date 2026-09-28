import "reflect-metadata";
import { CompositionService } from "./composition.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { AssetsService } from "../assets/assets.service";
import type { RequestUser } from "../common/types/request-user";

const productionId = "production-a";
const admin: RequestUser = { id: "admin", email: "admin@example.test", name: "운영자", platformRole: "SUPER_ADMIN" };

function fixture() {
  const tx = {
    production: {
      findFirst: jest.fn().mockResolvedValue({ id: productionId, visibility: "PUBLISHED" }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 })
    },
    membership: { findFirst: jest.fn().mockResolvedValue(null) },
    performanceSection: {
      findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 2 }), update: jest.fn().mockResolvedValue({ id: "root" }),
      create: jest.fn().mockResolvedValue({ id: "new" }),
      aggregate: jest.fn().mockResolvedValue({ _max: { order: 3 } }), count: jest.fn().mockResolvedValue(0)
    },
    performanceMedia: { findFirst: jest.fn(), delete: jest.fn().mockResolvedValue({ id: "link" }) },
    asset: { findFirst: jest.fn(), delete: jest.fn() },
    activityLog: { create: jest.fn().mockResolvedValue({ id: "log" }) }
  };
  const prisma = { ...tx, $transaction: jest.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)) };
  return { tx, prisma, service: new CompositionService(prisma as unknown as PrismaService, {} as AssetsService) };
}

describe("composition service safety and restoration", () => {
  test("restores a family without resetting child-relative offsets", async () => {
    const { tx, service } = fixture();
    tx.performanceSection.findFirst.mockResolvedValue({ id: "root", productionId, parentId: null, archiveBatchId: "family", startMs: 300000 });
    const result = await service.restore(productionId, "root", { expectedRevision: 7 }, admin);
    expect(tx.performanceSection.updateMany).toHaveBeenCalledWith({
      where: { productionId, archiveBatchId: "family" },
      data: { deletedAt: null, archiveBatchId: null }
    });
    expect(tx.performanceSection.update).toHaveBeenCalledWith({ where: { id: "root" }, data: { order: 4, startMs: null } });
    expect(result).toEqual({ id: "root", revision: 8 });
  });

  test("a stale revision stops before modifying sections", async () => {
    const { tx, service } = fixture();
    tx.production.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.restore(productionId, "root", { expectedRevision: 2 }, admin)).rejects.toMatchObject({ status: 409 });
    expect(tx.performanceSection.findFirst).not.toHaveBeenCalled();
    expect(tx.performanceSection.updateMany).not.toHaveBeenCalled();
    expect(tx.activityLog.create).not.toHaveBeenCalled();
  });

  test("a child cannot be created under an unavailable or foreign parent", async () => {
    const { tx, service } = fixture();
    tx.performanceSection.findFirst.mockResolvedValue(null);
    await expect(service.create(productionId, { title: "1막", parentId: "foreign", expectedRevision: 0 }, admin)).rejects.toMatchObject({ status: 400 });
    expect(tx.performanceSection.findFirst).toHaveBeenCalledWith({ where: { id: "foreign", productionId, deletedAt: null, parentId: null }, select: { id: true } });
    expect(tx.performanceSection.create).not.toHaveBeenCalled();
  });

  test("an actor can view but cannot mutate the composition", async () => {
    const { tx, prisma, service } = fixture();
    tx.membership.findFirst.mockResolvedValue({ roles: [{ role: "ACTOR" }] });
    await expect(service.create(productionId, { title: "1장", expectedRevision: 0 }, { ...admin, platformRole: "MEMBER" })).rejects.toMatchObject({ status: 403 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test("unlinking removes only the section link, never the shared original", async () => {
    const { tx, service } = fixture();
    tx.performanceSection.findFirst.mockResolvedValue({ id: "section", productionId });
    tx.performanceMedia.findFirst.mockResolvedValue({ id: "link", sectionId: "section", assetId: "shared" });
    const result = await service.unlinkMedia(productionId, "section", "link", { expectedRevision: 0 }, admin);
    expect(tx.performanceMedia.delete).toHaveBeenCalledWith({ where: { id: "link" } });
    expect(tx.asset.delete).not.toHaveBeenCalled();
    expect(result).toEqual({ id: "link", sectionId: "section", revision: 1 });
  });
});
