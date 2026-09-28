import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import type { PrismaService } from "../prisma/prisma.service";
import type { AssetsService } from "../assets/assets.service";
import type { RequestUser } from "../common/types/request-user";
import { CompositionService } from "./composition.service";
import { AttachReferenceFilesDto } from "./composition.dto";
import { resolveComposition } from "./composition-timing";

const user: RequestUser = { id: "admin", email: "admin@example.test", name: "관리자", platformRole: "SUPER_ADMIN" };
const asset = (id: string, mime = "application/pdf") => ({ id, mime, kind: "DOCUMENT", fileName: `${id}.pdf`, storageKey: `performance-materials/p/${id}.pdf`, sizeBytes: 1024 });
function setup() {
  const tx = {
    production: { findFirst: jest.fn().mockResolvedValue({ id: "p", visibility: "PUBLISHED" }), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    membership: { findFirst: jest.fn().mockResolvedValue({ roles: [{ role: "ACTOR" }] }) },
    asset: { findFirst: jest.fn().mockImplementation(async ({ where }: { where: { id: string } }) => asset(where.id)) },
    performanceSection: { findFirst: jest.fn().mockResolvedValue({ id: "section", productionId: "p" }), findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
    performanceMedia: {
      findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), aggregate: jest.fn().mockResolvedValue({ _max: { order: null } }),
      create: jest.fn().mockImplementation(async ({ data }: { data: { assetId: string } }) => ({ id: `link-${data.assetId}` }))
    },
    activityLog: { create: jest.fn().mockResolvedValue({}) }
  };
  const prisma = { ...tx, $transaction: jest.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)) };
  const storage = { assertStoredObject: jest.fn().mockResolvedValue(undefined) };
  const service = new CompositionService(prisma as unknown as PrismaService, storage as unknown as AssetsService);
  return { tx, prisma, storage, service };
}

describe("reference attachments", () => {
  test("links uploaded originals without playback settings or mode changes", async () => {
    const { service, tx, storage } = setup();
    const result = await service.attachReferences("p", "section", { expectedRevision: 4, assetIds: ["a", "b"] }, user);
    expect(result).toMatchObject({ addedCount: 2, revision: 5, sectionId: "section" });
    expect(storage.assertStoredObject).toHaveBeenCalledTimes(2);
    expect(tx.performanceMedia.create).toHaveBeenNthCalledWith(1, { data: { sectionId: "section", assetId: "a", slot: "SOURCE", label: "a.pdf", order: 0, offsetMs: 0, durationMs: null, sourceStartMs: 0, page: 1, volume: 0, loop: false }, select: { id: true } });
    expect(tx.performanceSection.update).not.toHaveBeenCalled();
  });
  test("reusing an already attached original does not duplicate its link", async () => {
    const { service, tx } = setup();
    tx.performanceMedia.findMany.mockResolvedValue([{ id: "link-a", assetId: "a" }]);
    const result = await service.attachReferences("p", "section", { expectedRevision: 0, assetIds: ["a", "b"] }, user);
    expect(result.addedCount).toBe(1);
    expect(tx.performanceMedia.create).toHaveBeenCalledTimes(1);
    expect(tx.performanceMedia.create.mock.calls[0][0].data.assetId).toBe("b");
  });
  test("rejects foreign assets before checking their storage", async () => {
    const { service, tx, storage } = setup();
    tx.asset.findFirst.mockResolvedValue(null);
    await expect(service.attachReferences("p", "section", { expectedRevision: 0, assetIds: ["foreign"] }, user)).rejects.toMatchObject({ status: 400 });
    expect(tx.asset.findFirst.mock.calls[0][0].where).toEqual({ id: "foreign", productionId: "p" });
    expect(storage.assertStoredObject).not.toHaveBeenCalled();
    expect(tx.performanceMedia.create).not.toHaveBeenCalled();
  });
  test("checks all uploaded files before writing any attachment links", async () => {
    const { service, tx, storage } = setup();
    storage.assertStoredObject.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new BadRequestException("미완료 업로드"));
    await expect(service.attachReferences("p", "section", { expectedRevision: 0, assetIds: ["a", "partial"] }, user)).rejects.toMatchObject({ status: 400 });
    expect(tx.performanceMedia.create).not.toHaveBeenCalled();
  });
  test("rejects unsafe formats, oversized references and exceeded section capacity", async () => {
    const one = setup();
    one.tx.asset.findFirst.mockResolvedValue(asset("a", "text/html"));
    await expect(one.service.attachReferences("p", "section", { expectedRevision: 0, assetIds: ["a"] }, user)).rejects.toMatchObject({ status: 400 });
    const two = setup();
    two.tx.asset.findFirst.mockResolvedValue({ ...asset("a"), sizeBytes: 50 * 1024 * 1024 + 1 });
    await expect(two.service.attachReferences("p", "section", { expectedRevision: 0, assetIds: ["a"] }, user)).rejects.toMatchObject({ status: 400 });
    const three = setup(); three.tx.performanceMedia.count.mockResolvedValue(200);
    await expect(three.service.attachReferences("p", "section", { expectedRevision: 0, assetIds: ["a"] }, user)).rejects.toMatchObject({ status: 400 });
    expect(three.tx.performanceMedia.create).not.toHaveBeenCalled();
  });
  test("retains write authorization and revision guards", async () => {
    const one = setup();
    await expect(one.service.attachReferences("p", "section", { expectedRevision: 0, assetIds: ["a"] }, { ...user, platformRole: "MEMBER" })).rejects.toMatchObject({ status: 403 });
    expect(one.prisma.$transaction).not.toHaveBeenCalled();
    const two = setup(); two.tx.production.updateMany.mockResolvedValue({ count: 0 });
    await expect(two.service.attachReferences("p", "section", { expectedRevision: 0, assetIds: ["a"] }, user)).rejects.toMatchObject({ status: 409 });
    expect(two.tx.performanceMedia.create).not.toHaveBeenCalled();
  });
  test("validates bounded, nonempty, unique UUID batches", () => {
    const id = "f74b6d48-047a-4bcb-97f5-eef4d844765e";
    for (const assetIds of [[], [id, id], ["not-uuid"], Array(11).fill(id)]) {
      expect(validateSync(plainToInstance(AttachReferenceFilesDto, { expectedRevision: 0, assetIds })).length).toBeGreaterThan(0);
    }
    expect(validateSync(plainToInstance(AttachReferenceFilesDto, { expectedRevision: 0, assetIds: [id] }))).toHaveLength(0);
  });
  test("reference materials never extend the timeline even with historical timing fields", () => {
    const section = { id: "s", parentId: null, title: "1장", order: 0, startMs: null, durationMs: null, backgroundMode: "OWN", musicMode: "OWN", scoreMode: "OWN", media: [{ slot: "SOURCE", offsetMs: 120000, durationMs: 300000 }] };
    expect(resolveComposition([section]).durationMs).toBe(60000);
  });
});
