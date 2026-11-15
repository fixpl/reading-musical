import { SectionSyncService } from "./section-sync.service";

type Row = { id: string; sceneId: string; order: number; type: string; text: string; characterId: string | null; cueLabel: string | null; durationMs: number | null; character: { name: string } | null };

function fixture(section: { scriptText: string; lyrics: string }, rows: Row[]) {
  const store = [...rows];
  const sectionRow = { id: "sec", sourceSceneId: "scene", ...section };
  const roles = [{ id: "r-mom", name: "엄마" }, { id: "r-nar", name: "해설자" }];
  const roleName = (id: string | null) => roles.find((role) => role.id === id)?.name ?? null;
  const tx = {
    performanceSection: { findFirst: jest.fn().mockImplementation(async () => ({ ...sectionRow })), update: jest.fn().mockImplementation(async ({ data }) => Object.assign(sectionRow, data)) },
    scene: { findFirst: jest.fn().mockResolvedValue({ id: "scene" }) },
    role: { findMany: jest.fn().mockResolvedValue(roles), create: jest.fn() },
    annotation: { updateMany: jest.fn() }, musicCue: { updateMany: jest.fn() },
    sceneBlock: {
      findMany: jest.fn().mockImplementation(async () => store.map((row) => ({ ...row, character: row.characterId ? { name: roleName(row.characterId) } : null }))),
      update: jest.fn().mockImplementation(async ({ where, data }) => { Object.assign(store.find((row) => row.id === where.id)!, data); }),
      create: jest.fn().mockImplementation(async ({ data }) => { store.push({ id: `new-${store.length}`, character: null, ...data }); }),
      delete: jest.fn().mockImplementation(async ({ where }) => { store.splice(store.findIndex((row) => row.id === where.id), 1); })
    }
  };
  return { tx, store, sectionRow, service: new SectionSyncService({} as never) };
}

const row = (id: string, order: number, type: string, text: string, characterId: string | null = null, durationMs: number | null = 5000): Row =>
  ({ id, sceneId: "scene", order, type, text, characterId, cueLabel: null, durationMs, character: null });

describe("section sync push", () => {
  test("keeps unchanged lines (with their timing), edits one, adds one, removes one and tidies the section text", async () => {
    const rows = [row("a", 1, "DIALOGUE", "안녕", "r-nar"), row("b", 2, "STAGE_DIRECTION", "조명이 식는다"), row("c", 3, "DIALOGUE", "그게 다예요?", "r-mom", 7000)];
    const { tx, store, sectionRow, service } = fixture({ scriptText: "해설자: 안녕하세요\n(조명이 식는다)\n엄마: 그게 다예요?\n엄마: 새 대사", lyrics: "" }, rows);
    const result = await service.push(tx as never, "prod", "sec");
    expect(result).toEqual({ created: 1, updated: 1, deleted: 0 });
    expect(store.map((item) => [item.id.startsWith("new") ? "new" : item.id, item.text, item.type])).toEqual([
      ["a", "안녕하세요", "DIALOGUE"], ["b", "조명이 식는다", "STAGE_DIRECTION"], ["c", "그게 다예요?", "DIALOGUE"], ["new", "새 대사", "DIALOGUE"]
    ]);
    expect(store[2].durationMs).toBe(7000);
    expect(sectionRow.scriptText).toBe("해설자: 안녕하세요\n[ 조명이 식는다 ]\n엄마: 그게 다예요?\n엄마: 새 대사");
  });

  test("an unknown 'label:' prefix stays in the text instead of creating a role", async () => {
    const { tx, store, service } = fixture({ scriptText: "배경 영상 전환: 오프닝 장면으로", lyrics: "" }, []);
    await service.push(tx as never, "prod", "sec");
    expect(tx.role.create).not.toHaveBeenCalled();
    expect(store[0]).toMatchObject({ text: "배경 영상 전환: 오프닝 장면으로", characterId: null });
  });

  test("a speaker that is not a registered role also stays in the text", async () => {
    const { tx, store, service } = fixture({ scriptText: "할머니: 어서 와라", lyrics: "" }, []);
    await service.push(tx as never, "prod", "sec");
    expect(tx.role.create).not.toHaveBeenCalled();
    expect(store[0]).toMatchObject({ text: "할머니: 어서 와라", characterId: null });
  });
});

describe("section sync concurrent pull", () => {
  function pullFixture() {
    const section = { id: "sec", productionId: "prod", sourceSceneId: "scene", deletedAt: null, scriptText: "기존 글", lyrics: "" };
    let text = "기존 글";
    const db = {
      production: { update: jest.fn().mockResolvedValue({}) },
      performanceSection: {
        findMany: jest.fn().mockImplementation(async () => [{ ...section }]),
        updateMany: jest.fn().mockImplementation(async ({ where, data }) => {
          if (section.scriptText !== where.scriptText || section.lyrics !== where.lyrics || section.sourceSceneId !== where.sourceSceneId || section.deletedAt !== where.deletedAt) return { count: 0 };
          Object.assign(section, data); return { count: 1 };
        })
      },
      sceneBlock: { findMany: jest.fn().mockImplementation(async () => [{ ...row("line", 1, "DIALOGUE", text), sceneId: "scene" }]) },
      $transaction: jest.fn()
    };
    db.$transaction.mockImplementation(work => work(db));
    return { db, section, service: new SectionSyncService(db as never), edit: (value: string) => { text = value; } };
  }

  test("preserves a composition edit made while the original script save is in flight", async () => {
    const { db, section, service, edit } = pullFixture();
    await service.keepInSync("prod", "scene", async () => { section.scriptText = "다른 편집자의 구성 글"; edit("대본에서 고친 글"); return "saved"; });
    expect(section.scriptText).toBe("다른 편집자의 구성 글");
    expect(db.production.update).toHaveBeenCalledTimes(1);
    expect(await service.states(db as never, [section])).toEqual(new Map([["sec", "DIVERGED"]]));
  });

  test("updates unchanged linked sections and advances the revision once", async () => {
    const { db, section, service, edit } = pullFixture();
    await expect(service.keepInSync("prod", "scene", async () => { edit("새 글"); return "saved"; })).resolves.toBe("saved");
    expect(section.scriptText).toBe("새 글");
    expect(db.production.update).toHaveBeenLastCalledWith({ where: { id: "prod" }, data: { compositionRevision: { increment: 1 } } });
  });

  test("does not overwrite an already diverged section or synchronize a failed save", async () => {
    const { db, section, service } = pullFixture();
    section.scriptText = "별도 글";
    await service.keepInSync("prod", "scene", async () => "saved");
    expect(db.performanceSection.updateMany).not.toHaveBeenCalled();
    section.scriptText = "기존 글";
    await expect(service.keepInSync("prod", "scene", async () => { throw new Error("conflict"); })).rejects.toThrow("conflict");
    expect(db.performanceSection.updateMany).not.toHaveBeenCalled();
  });
});
