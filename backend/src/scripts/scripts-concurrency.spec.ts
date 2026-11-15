import "reflect-metadata";
import { ScriptEntityLookupService } from "./script-entity-lookup.service";
import { ScriptSnapshotService } from "./script-snapshot.service";
import { ScriptImportService } from "./script-import.service";
import { ScriptsService } from "./scripts.service";
import type { RequestUser } from "../common/types/request-user";

const admin: RequestUser = { id: "admin", email: "admin@example.test", name: "운영자", platformRole: "SUPER_ADMIN" };
test("a stale line save cannot overwrite the current text; a current save returns the new timestamp", async () => {
  const current = { id: "line", sceneId: "scene", order: 1, text: "다른 사람이 저장한 글", updatedAt: new Date("2026-10-09T00:00:02.000Z") };
  const tx = {
    production: { update: jest.fn().mockResolvedValue({}) },
    sceneBlock: {
      findFirst: jest.fn().mockResolvedValue(current),
      updateMany: jest.fn().mockImplementation(async ({ where, data }) => {
        if (where.updatedAt.getTime() !== current.updatedAt.getTime()) return { count: 0 };
        Object.assign(current, data, { updatedAt: new Date("2026-10-09T00:00:03.000Z") }); return { count: 1 };
      }),
      findUniqueOrThrow: jest.fn().mockImplementation(async () => current)
    },
    $transaction: jest.fn()
  };
  tx.$transaction.mockImplementation(work => work(tx));
  const service = new ScriptsService(tx as never, new ScriptEntityLookupService(tx as never), new ScriptSnapshotService(tx as never), {} as never);
  await expect(service.updateBlock("show", "line", { text: "오래된 편집", expectedUpdatedAt: "2026-10-09T00:00:01.000Z" }, admin)).rejects.toMatchObject({ status: 409 });
  expect(current.text).toBe("다른 사람이 저장한 글");
  expect(tx.sceneBlock.findUniqueOrThrow).not.toHaveBeenCalled();
  await expect(service.updateBlock("show", "line", { text: "최신 편집", expectedUpdatedAt: current.updatedAt.toISOString() }, admin)).resolves.toMatchObject({ text: "최신 편집", updatedAt: new Date("2026-10-09T00:00:03.000Z") });
  expect(tx.production.update.mock.invocationCallOrder[0]).toBeLessThan(tx.sceneBlock.updateMany.mock.invocationCallOrder[0]);
});

function importService(claimCount: number) {
  const tx = {
    production: { update: jest.fn().mockResolvedValue({}) },
    scriptImport: { updateMany: jest.fn().mockResolvedValue({ count: claimCount }) },
    act: { aggregate: jest.fn().mockResolvedValue({ _max: { order: 2 } }), createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    scene: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    sceneBlock: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
    scriptVersion: { create: jest.fn() }
  };
  const prisma = {
    scriptImport: {
      findFirst: jest.fn().mockResolvedValue({
        id: "imp", scriptId: "script", status: "DRAFT",
        parsedJson: { acts: [{ title: "1막", scenes: [{ title: "1장", blocks: [{ type: "DIALOGUE", text: "안녕", speakerName: "가" }, { type: "NARRATION", text: "끝" }] }] }], warnings: [] }
      })
    },
    $transaction: jest.fn().mockImplementation(async (work, options) => work(tx))
  };
  const entities = new ScriptEntityLookupService(prisma as never);
  const snapshot = new ScriptSnapshotService(prisma as never);
  const service = new ScriptImportService(prisma as never, {} as never, entities, snapshot, {} as never);
  jest.spyOn(service as never, "assertMembership").mockResolvedValue(undefined as never);
  jest.spyOn(entities, "assertScript").mockResolvedValue(undefined as never);
  return { service, tx, prisma };
}

test("applying the same import twice: the request that loses the DRAFT claim gets 409 and creates nothing", async () => {
  const { service, tx, prisma } = importService(0);
  await expect(service.applyImport("show", "script", "imp", { createVersion: false }, admin)).rejects.toMatchObject({ status: 409 });
  expect(tx.scriptImport.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "imp", scriptId: "script", status: "DRAFT" } }));
  expect(tx.act.createMany).not.toHaveBeenCalled();
  expect(tx.sceneBlock.createMany).not.toHaveBeenCalled();
  expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 30000 });
});

test("the winning import request bulk-creates acts, scenes and blocks after claiming the draft", async () => {
  const { service, tx } = importService(1);
  const result = await service.applyImport("show", "script", "imp", { createVersion: false }, admin);
  expect(tx.scriptImport.updateMany.mock.invocationCallOrder[0]).toBeLessThan(tx.act.createMany.mock.invocationCallOrder[0]);
  expect(tx.production.update.mock.invocationCallOrder[0]).toBeLessThan(tx.act.aggregate.mock.invocationCallOrder[0]);
  expect(tx.act.createMany).toHaveBeenCalledTimes(1);
  expect(tx.sceneBlock.createMany.mock.calls[0][0].data).toHaveLength(2);
  expect(result.actIds).toHaveLength(1);
  expect(result.blockIds).toHaveLength(2);
});

test("reordering blocks runs in a transaction with the longer timeout", async () => {
  const tx = {
    production: { update: jest.fn().mockResolvedValue({}) },
    sceneBlock: { findMany: jest.fn().mockResolvedValue([{ id: "a" }, { id: "b" }]), update: jest.fn().mockResolvedValue({}) }
  };
  const prisma = { sceneBlock: { findMany: tx.sceneBlock.findMany }, $transaction: jest.fn().mockImplementation(async (work) => work(tx)) };
  const entities = new ScriptEntityLookupService(prisma as never);
  const snapshot = new ScriptSnapshotService(prisma as never);
  const service = new ScriptsService(prisma as never, entities, snapshot, {} as never);
  jest.spyOn(service as never, "assertMembership").mockResolvedValue(undefined as never);
  jest.spyOn(entities, "assertScene").mockResolvedValue(undefined as never);
  await expect(service.reorderBlocks("show", "scene", { blockIds: ["b", "a"] }, admin)).resolves.toEqual({ blockIds: ["b", "a"] });
  expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 30000 });
});

test.each(["act", "scene"] as const)("adding an %s locks the production before calculating its order", async (model) => {
  const tx = {
    production: { update: jest.fn().mockResolvedValue({}) },
    act: { aggregate: jest.fn().mockResolvedValue({ _max: { order: 3 } }), create: jest.fn().mockResolvedValue({ id: "new", order: 4 }) },
    scene: { aggregate: jest.fn().mockResolvedValue({ _max: { order: 3 } }), create: jest.fn().mockResolvedValue({ id: "new", order: 4 }) }
  };
  const prisma = { $transaction: jest.fn().mockImplementation(async (work) => work(tx)) };
  const entities = new ScriptEntityLookupService(prisma as never);
  const snapshot = new ScriptSnapshotService(prisma as never);
  const service = new ScriptsService(prisma as never, entities, snapshot, {} as never);
  jest.spyOn(service as never, "assertMembership").mockResolvedValue(undefined as never);
  jest.spyOn(entities, "assertScript").mockResolvedValue({ id: "script" } as never);
  jest.spyOn(entities, "assertAct").mockResolvedValue({ id: "act" } as never);
  const result = model === "act"
    ? await service.createAct("show", "script", { title: "다음 막" }, admin)
    : await service.createScene("show", "act", { title: "다음 장면" }, admin);
  expect(result).toMatchObject({ order: 4 });
  expect(tx.production.update).toHaveBeenCalledWith({ where: { id: "show" }, data: { compositionRevision: { increment: 0 } } });
  expect(tx.production.update.mock.invocationCallOrder[0]).toBeLessThan(tx[model].aggregate.mock.invocationCallOrder[0]);
  expect(tx[model].aggregate.mock.invocationCallOrder[0]).toBeLessThan(tx[model].create.mock.invocationCallOrder[0]);
});

test("deleting a block renumbers the remaining blocks using the longer transaction timeout", async () => {
  const tx = {
    production: { update: jest.fn().mockResolvedValue({}) },
    annotation: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    musicCue: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    sceneBlock: { delete: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([{ id: "remaining" }]), update: jest.fn().mockResolvedValue({}) }
  };
  const prisma = {
    annotation: { count: jest.fn().mockResolvedValue(0) }, musicCue: { count: jest.fn().mockResolvedValue(0) },
    $transaction: jest.fn().mockImplementation(async (work) => work(tx))
  };
  const entities = new ScriptEntityLookupService(prisma as never);
  const snapshot = new ScriptSnapshotService(prisma as never);
  const service = new ScriptsService(prisma as never, entities, snapshot, {} as never);
  jest.spyOn(service as never, "assertMembership").mockResolvedValue(undefined as never);
  jest.spyOn(entities, "assertBlock").mockResolvedValue({ id: "removed", sceneId: "scene" } as never);
  await service.deleteBlock("show", "removed", false, admin);
  expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 30000 });
  expect(tx.sceneBlock.update).toHaveBeenCalledWith({ where: { id: "remaining" }, data: { order: 1 } });
});
