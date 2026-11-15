import "reflect-metadata";
import { RehearsalService } from "./rehearsal.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { RequestUser } from "../common/types/request-user";

const actor: RequestUser = { id: "actor", email: "actor@example.test", name: "배우", platformRole: "MEMBER" };
const data = { source: "composition", positionMs: 1000, completedKeys: ["section:part"], notes: { "section:part": "첫 등장 전 호흡" }, expectedRevision: 0 };
function fixture() {
  const prisma = {
    production: { findFirst: jest.fn().mockResolvedValue({ id: "show" }) },
    membership: { findUnique: jest.fn().mockResolvedValue({ id: "member" }) },
    script: { findFirst: jest.fn().mockResolvedValue(null) },
    performanceSection: { findMany: jest.fn().mockResolvedValue([{ id: "part" }]) },
    scene: { findMany: jest.fn().mockResolvedValue([]) },
    trackCue: { findMany: jest.fn().mockResolvedValue([{ id: "cue" }]) },
    personalRehearsal: {
      findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ ...data, revision: 1 }), updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ revision: 2 })
    },
    $transaction: jest.fn()
  };
  prisma.$transaction.mockImplementation((work) => work(prisma));
  return { prisma, service: new RehearsalService(prisma as unknown as PrismaService) };
}

describe("personal rehearsal isolation", () => {
  test("reads only the caller's records even for an administrator", async () => {
    const { prisma, service } = fixture();
    await service.list("show", { ...actor, platformRole: "SUPER_ADMIN" });
    expect(prisma.personalRehearsal.findMany).toHaveBeenCalledWith({ where: { productionId: "show", userId: "actor" } });
  });
  test("unassigned users cannot read or save rehearsal records", async () => {
    const { prisma, service } = fixture();
    prisma.membership.findUnique.mockResolvedValue(null);
    await expect(service.list("show", actor)).rejects.toMatchObject({ status: 403 });
    await expect(service.save("show", data, actor)).rejects.toMatchObject({ status: 403 });
    expect(prisma.personalRehearsal.findMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  test("deleted productions are unavailable", async () => {
    const { prisma, service } = fixture();
    prisma.production.findFirst.mockResolvedValue(null);
    await expect(service.list("show", actor)).rejects.toMatchObject({ status: 404 });
  });
  test("notes and completed sections from another performance are rejected", async () => {
    const { prisma, service } = fixture();
    await expect(service.save("show", { ...data, completedKeys: ["section:foreign"] }, actor)).rejects.toMatchObject({ status: 400 });
    await expect(service.save("show", { ...data, notes: { "section:foreign": "private" } }, actor)).rejects.toMatchObject({ status: 400 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  test("a script from another performance is rejected", async () => {
    const { service } = fixture();
    await expect(service.save("show", { ...data, source: "foreign-script" }, actor)).rejects.toMatchObject({ status: 400 });
  });
  test("stores a personal record without changing shared reading or composition state", async () => {
    const { prisma, service } = fixture();
    await service.save("show", data, actor);
    expect(prisma.personalRehearsal.create).toHaveBeenCalledWith({ data: { userId: actor.id, productionId: "show", source: "composition", positionMs: 1000, completedKeys: data.completedKeys, notes: data.notes, revision: 1 } });
  });
  test("stale updates cannot overwrite a newer device's record", async () => {
    const { prisma, service } = fixture();
    prisma.personalRehearsal.findUnique.mockResolvedValue({ id: "record", revision: 3 });
    prisma.personalRehearsal.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.save("show", data, actor)).rejects.toMatchObject({ status: 409 });
    expect(prisma.personalRehearsal.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "record", userId: actor.id, revision: 0 } }));
  });
  test("non-string notes and oversized notes are rejected before persistence", async () => {
    const { service, prisma } = fixture();
    await expect(service.save("show", { ...data, notes: { overview: 12 } as unknown as Record<string, string> }, actor)).rejects.toMatchObject({ status: 400 });
    await expect(service.save("show", { ...data, notes: { overview: "a".repeat(5001) } }, actor)).rejects.toMatchObject({ status: 400 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
