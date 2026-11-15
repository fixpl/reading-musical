import "reflect-metadata";
import { ScriptEntityLookupService } from "./script-entity-lookup.service";
import { ScriptSnapshotService } from "./script-snapshot.service";
import { ScriptImportService } from "./script-import.service";
import { ScriptNotificationsService } from "./script-notifications.service";
import { ScriptsService } from "./scripts.service";
import type { RequestUser } from "../common/types/request-user";

const admin: RequestUser = { id: "admin", email: "admin@example.test", name: "운영자", platformRole: "SUPER_ADMIN" };
const metadata = { id: true, label: true, createdAt: true, authorId: true };
const snapshot = { id: "script", title: "대본", acts: [{ id: "act", order: 1, title: "1막", scenes: [{ id: "scene", order: 1, title: "1장", summary: null, blocks: [] }] }] };

function servicesFor(prisma: object, assets?: object) {
  const entities = new ScriptEntityLookupService(prisma as never);
  const snapshotService = new ScriptSnapshotService(prisma as never);
  const notifications = new ScriptNotificationsService(prisma as never, {} as never, {} as never);
  const service = new ScriptsService(prisma as never, entities, snapshotService, notifications);
  const importer = new ScriptImportService(prisma as never, assets as never, entities, snapshotService, notifications);
  jest.spyOn(service as never, "assertMembership").mockResolvedValue(undefined as never);
  jest.spyOn(importer as never, "assertMembership").mockResolvedValue(undefined as never);
  return { service, importer, entities, snapshotService, notifications };
}

test("version snapshots select only restorable script content, excluding annotations and nested versions", async () => {
  const prisma = {
    script: { findFirst: jest.fn().mockResolvedValue({ id: "script" }), findUniqueOrThrow: jest.fn().mockResolvedValue(snapshot) },
    scriptVersion: { create: jest.fn().mockResolvedValue({ id: "version", label: "초안" }) }
  };
  const { service, notifications } = servicesFor(prisma);
  jest.spyOn(notifications, "notifyScriptChange").mockResolvedValue(undefined as never);
  await service.createVersion("show", "script", { label: "초안" }, admin);
  const query = prisma.script.findUniqueOrThrow.mock.calls[0][0];
  expect(query).not.toHaveProperty("include");
  expect(Object.keys(query.select).sort()).toEqual(["acts", "id", "title"]);
  const blockSelect = query.select.acts.select.scenes.select.blocks.select;
  expect(blockSelect).toEqual({ id: true, order: true, type: true, characterId: true, cueLabel: true, text: true, startMs: true, durationMs: true });
  expect(prisma.scriptVersion.create).toHaveBeenCalledWith({ data: { scriptId: "script", label: "초안", authorId: "admin", snapshot } });
});

test("script list and detail select version metadata without exposing version snapshots", async () => {
  const prisma = {
    script: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(snapshot) }
  };
  const { service } = servicesFor(prisma);
  jest.spyOn(service as never, "hasAnyRole").mockResolvedValue(false as never);
  await service.listScripts("show", admin);
  await service.getScript("show", "script", admin);
  expect(prisma.script.findMany.mock.calls[0][0].include.versions).toEqual({ orderBy: { createdAt: "desc" }, take: 5, select: metadata });
  expect(prisma.script.findFirst.mock.calls[0][0].include.versions).toEqual({ orderBy: { createdAt: "desc" }, select: metadata });
});

describe("deleted scripts cannot be reached through edit and annotation lookups", () => {
  const cases = [
    ["assertScript", "script", { id: "item", productionId: "show", deletedAt: null }],
    ["assertAct", "act", { id: "item", script: { productionId: "show", deletedAt: null } }],
    ["assertScene", "scene", { id: "item", act: { script: { productionId: "show", deletedAt: null } } }],
    ["assertBlock", "sceneBlock", { id: "item", scene: { act: { script: { productionId: "show", deletedAt: null } } } }],
    ["assertAnnotation", "annotation", { id: "note", anchorBlockId: "item", anchorBlock: { scene: { act: { script: { productionId: "show", deletedAt: null } } } } }]
  ] as const;
  test.each(cases)("%s requires an active script", async (method, model, expectedWhere) => {
    const findFirst = jest.fn().mockImplementation(async ({ where }) => JSON.stringify(where).includes('"deletedAt":null') ? null : { id: "item" });
    const { entities } = servicesFor({ [model]: { findFirst } });
    const internals = entities as unknown as Record<string, (...args: string[]) => Promise<unknown>>;
    await expect(internals[method]("show", "item", "note")).rejects.toMatchObject({ status: 404 });
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expectedWhere }));
  });
});

test("version restore also scopes the version and current script to active scripts", async () => {
  const prisma = {
    script: { findFirst: jest.fn().mockResolvedValueOnce({ id: "script" }).mockResolvedValueOnce(null) },
    scriptVersion: { findFirst: jest.fn().mockResolvedValue({ id: "version", snapshot }) }
  };
  const { service } = servicesFor(prisma);
  await expect(service.restoreVersion("show", "script", "version", {}, admin)).rejects.toMatchObject({ status: 404 });
  expect(prisma.scriptVersion.findFirst).toHaveBeenCalledWith({ where: { id: "version", scriptId: "script", script: { productionId: "show", deletedAt: null } } });
  expect(prisma.script.findFirst.mock.calls[1][0].where).toEqual({ id: "script", productionId: "show", deletedAt: null });
});

test("import parser recognizes directions, notes and lyrics before speaker prefixes", async () => {
  const prisma = { script: { findFirst: jest.fn().mockResolvedValue({ id: "script" }) }, scriptImport: { create: jest.fn().mockResolvedValue({ id: "import", status: "DRAFT" }) } };
  const { importer } = servicesFor(prisma);
  jest.spyOn(importer as never, "resolveImportSource").mockResolvedValue({
    assetId: "asset", sourceType: "PASTE", rawText: "메모: 소품 확인\nNOTE: 조명 확인\n※ 음악: 작게\n[장면 전환: 암전]\n(조명: 밝게)\n♪ 민지: 노래해\n민지: 안녕하세요"
  } as never);
  const result = await importer.createImport("show", "script", { rawText: "사용자 입력" }, admin);
  expect(result.blocks.map(({ type, text, speakerName }) => ({ type, text, speakerName }))).toEqual([
    { type: "NOTE", text: "소품 확인", speakerName: undefined },
    { type: "NOTE", text: "조명 확인", speakerName: undefined },
    { type: "NOTE", text: "음악: 작게", speakerName: undefined },
    { type: "STAGE_DIRECTION", text: "장면 전환: 암전", speakerName: undefined },
    { type: "STAGE_DIRECTION", text: "조명: 밝게", speakerName: undefined },
    { type: "LYRIC", text: "민지: 노래해", speakerName: undefined },
    { type: "DIALOGUE", text: "안녕하세요", speakerName: "민지" }
  ]);
});

test("uploaded import text exceeding 200000 characters is rejected before parsing or persisting a draft", async () => {
  const prisma = { script: { findFirst: jest.fn().mockResolvedValue({ id: "script" }) }, scriptImport: { create: jest.fn() } };
  const assets = { readMockObject: jest.fn().mockResolvedValue({ asset: { id: "asset", productionId: "show", kind: "DOCUMENT", mime: "text/plain" }, body: Buffer.from("가".repeat(200001)) }) };
  const { importer } = servicesFor(prisma, assets);
  await expect(importer.createImport("show", "script", { assetId: "asset" }, admin)).rejects.toMatchObject({ status: 400 });
  expect(prisma.scriptImport.create).not.toHaveBeenCalled();
});

function restoreService(timing: object) {
  const block = { id: "block", order: 1, type: "DIALOGUE", text: "대사", characterId: null, cueLabel: null, ...timing };
  const stored = { ...snapshot, acts: [{ ...snapshot.acts[0], scenes: [{ ...snapshot.acts[0].scenes[0], blocks: [block] }] }] };
  const tx = {
    script: { update: jest.fn().mockResolvedValue({}) },
    act: { upsert: jest.fn().mockResolvedValue({}) }, scene: { upsert: jest.fn().mockResolvedValue({}) }, sceneBlock: { upsert: jest.fn().mockResolvedValue({}) }
  };
  const prisma = {
    script: { findFirst: jest.fn().mockResolvedValue(stored) },
    scriptVersion: { findFirst: jest.fn().mockResolvedValue({ id: "version", label: "저장본", snapshot: stored }) },
    role: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn().mockImplementation(async (work) => work(tx))
  };
  const { service, snapshotService, notifications } = servicesFor(prisma);
  jest.spyOn(snapshotService, "getRestoreImpact").mockResolvedValue({ removing: { acts: 0, scenes: 0, blocks: 0 }, sceneLinks: { total: 0 }, blockAnchors: { total: 0 } } as never);
  jest.spyOn(notifications, "notifyScriptChange").mockResolvedValue(undefined as never);
  return { service, prisma, tx };
}

test.each([
  [{ startMs: 1500, durationMs: 4500 }, { startMs: 1500, durationMs: 4500 }],
  [{ startMs: 0, durationMs: 1 }, { startMs: 0, durationMs: 1 }],
  [{ startMs: null, durationMs: null }, { startMs: null, durationMs: null }],
  [{}, { startMs: null, durationMs: null }]
])("restoring a version restores timing or uses automatic timing for old snapshots: %p", async (timing, expected) => {
  const { service, tx } = restoreService(timing);
  await service.restoreVersion("show", "script", "version", { createBackupVersion: false }, admin);
  expect(tx.sceneBlock.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining(expected), create: expect.objectContaining(expected) }));
});

test.each([
  { startMs: -1 }, { startMs: 0.5 }, { startMs: "1000" }, { startMs: 2_147_483_648 },
  { durationMs: 0 }, { durationMs: -1 }, { durationMs: 0.5 }, { durationMs: "1000" }, { durationMs: 2_147_483_648 }
])("invalid snapshot timing is rejected before writing a restore: %p", async (timing) => {
  const { service, prisma } = restoreService(timing);
  await expect(service.restoreVersion("show", "script", "version", { createBackupVersion: false }, admin)).rejects.toMatchObject({ status: 400 });
  expect(prisma.$transaction).not.toHaveBeenCalled();
});
