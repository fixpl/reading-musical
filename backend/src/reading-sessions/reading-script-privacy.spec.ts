import { ReadingSessionsService } from "./reading-sessions.service";

type Position = { currentSceneId: string | null; currentBlockId: string | null };
type ReadingInternals = {
  getProductionScenes: (productionId: string) => Promise<Array<{ id: string }>>;
  resolveExplicitPosition: (productionId: string, sceneId?: string | null, blockId?: string | null) => Promise<Position>;
  resolveInitialPosition: (productionId: string, runSheet: unknown, sceneId?: string | null, blockId?: string | null) => Promise<Position>;
  resolveUpdatePosition: (productionId: string, runSheetId: string, dto: { runSheetItemId: string }) => Promise<Position>;
};

function fixture() {
  let deleted = true;
  const scene = { id: "scene", blocks: [{ id: "block" }] };
  const prisma = {
    scene: {
      findMany: jest.fn().mockImplementation(async ({ where }) => where.act.script.deletedAt === null && deleted ? [] : [scene]),
      findFirst: jest.fn().mockImplementation(async ({ where }) => where.act.script.deletedAt === null && deleted ? null : scene)
    },
    sceneBlock: { findFirst: jest.fn().mockImplementation(async ({ where }) => where.scene.act.script.deletedAt === null && deleted ? null : { id: "block", sceneId: "scene" }) },
    runSheetItem: { findFirst: jest.fn().mockResolvedValue({ id: "item", sceneId: "scene", cue: null, stageSceneNote: null }) }
  };
  const service = new ReadingSessionsService(prisma as never, {} as never, {} as never, {} as never) as unknown as ReadingInternals;
  return { service, prisma, restore: () => { deleted = false; } };
}

describe("리딩 장면의 휴지통 대본 경계", () => {
  it("공유 장면 목록에서 삭제 대본을 제외하고 복원하면 다시 표시한다", async () => {
    const { service, prisma, restore } = fixture();
    await expect(service.getProductionScenes("production")).resolves.toEqual([]);
    expect(prisma.scene.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { act: { script: { productionId: "production", deletedAt: null } } } }));
    restore();
    await expect(service.getProductionScenes("production")).resolves.toEqual([{ id: "scene", blocks: [{ id: "block" }] }]);
  });

  it.each(["scene", "block"] as const)("삭제 대본의 %s를 리딩 위치로 연결하지 않는다", async (kind) => {
    const { service, restore } = fixture();
    const args = ["production", kind === "scene" ? "scene" : null, kind === "block" ? "block" : null] as const;
    await expect(service.resolveExplicitPosition(...args)).rejects.toMatchObject({ status: 400 });
    restore();
    await expect(service.resolveExplicitPosition(...args)).resolves.toMatchObject({ currentSceneId: "scene" });
  });

  it("첫 장면 자동 선택도 삭제 대본을 제외한다", async () => {
    const { service, restore } = fixture();
    await expect(service.resolveInitialPosition("production", null)).resolves.toEqual({ currentSceneId: null, currentBlockId: null });
    restore();
    await expect(service.resolveInitialPosition("production", null)).resolves.toEqual({ currentSceneId: "scene", currentBlockId: "block" });
  });

  it("진행표를 거쳐 선택한 삭제 장면도 초기·변경 위치에서 거절한다", async () => {
    const { service, restore } = fixture();
    const runSheet = { items: [{ sceneId: "scene", cue: null, stageSceneNote: null }] };
    await expect(service.resolveInitialPosition("production", runSheet)).rejects.toMatchObject({ status: 400 });
    await expect(service.resolveUpdatePosition("production", "sheet", { runSheetItemId: "item" })).rejects.toMatchObject({ status: 400 });
    restore();
    await expect(service.resolveInitialPosition("production", runSheet)).resolves.toEqual({ currentSceneId: "scene", currentBlockId: null });
    await expect(service.resolveUpdatePosition("production", "sheet", { runSheetItemId: "item" })).resolves.toEqual({ currentSceneId: "scene", currentBlockId: null });
  });

  it("삭제 대본을 가리키는 큐는 리딩 기록을 쓰기 전에 거절한다", async () => {
    const { prisma } = fixture();
    const transaction = jest.fn();
    const service = new ReadingSessionsService({ ...prisma, $transaction: transaction } as never, {} as never, {} as never, {} as never);
    jest.spyOn(service as never, "assertMembership").mockResolvedValue(null as never);
    jest.spyOn(service as never, "assertActiveSession").mockResolvedValue({ id: "session" } as never);
    jest.spyOn(service as never, "assertCue").mockResolvedValue({ id: "cue", sceneId: "scene", anchorBlockId: "block" } as never);
    await expect(service.fireCue("production", "session", { cueId: "cue" }, { id: "viewer" } as never)).rejects.toMatchObject({ status: 400 });
    expect(transaction).not.toHaveBeenCalled();
  });
});
