import "reflect-metadata";
import { parseCompositionText } from "./composition-parser";
import { resolveComposition, type TimingSection } from "./composition-timing";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { WriteSectionDto, WriteCompositionMediaDto, ReorderSectionsDto } from "./composition.dto";

const node = (id: string, changes: Partial<TimingSection> = {}): TimingSection => ({
  id, parentId: null, title: id, order: 0, startMs: null, durationMs: null,
  backgroundMode: "INHERIT", musicMode: "INHERIT", scoreMode: "INHERIT", media: [], ...changes
});

describe("reading musical composition timing", () => {
  test("allows an empty show and empty chapters", () => {
    expect(resolveComposition([]).durationMs).toBe(0);
    expect(resolveComposition([node("a")]).durationMs).toBe(60000);
  });
  test("does not add parents to their children or sum parallel music and video", () => {
    const result = resolveComposition([
      node("a", { musicMode: "OWN", backgroundMode: "OWN", media: [{ slot: "MUSIC", offsetMs: 0, durationMs: 120000 }, { slot: "BACKGROUND", offsetMs: 0, durationMs: 120000 }] }),
      node("b", { parentId: "a" }), node("c", { parentId: "a", order: 1 }), node("d", { order: 1 })
    ]);
    expect(result.durationMs).toBe(180000);
    expect(result.entries.find((s) => s.id === "c")?.startMs).toBe(60000);
    expect(result.entries.find((s) => s.id === "d")?.startMs).toBe(120000);
  });
  test("moving a parent moves its children without changing their relative offsets", () => {
    const result = resolveComposition([node("p", { startMs: 90000 }), node("c", { parentId: "p", startMs: 5000, durationMs: 10000 })]);
    expect(result.entries[1]).toMatchObject({ startMs: 95000, relativeStartMs: 5000, durationMs: 10000 });
    expect(result.durationMs).toBe(105000);
  });
  test("disabled media do not extend duration", () => {
    expect(resolveComposition([node("a", { musicMode: "NONE", media: [{ slot: "MUSIC", offsetMs: 0, durationMs: 180000 }] })]).durationMs).toBe(60000);
  });
  test("rejects overlaps, orphan/cyclic/deep nodes and impossible parent length", () => {
    expect(() => resolveComposition([node("a"), node("b", { order: 1, startMs: 1000 })])).toThrow("겹칩니다");
    expect(() => resolveComposition([node("a", { parentId: "missing" })])).toThrow("최상위");
    expect(() => resolveComposition([node("a", { parentId: "b" }), node("b", { parentId: "a" })])).toThrow();
    expect(() => resolveComposition([node("a"), node("b", { parentId: "a" }), node("c", { parentId: "b" })])).toThrow();
    expect(() => resolveComposition([node("a", { durationMs: 1000 }), node("b", { parentId: "a" })])).toThrow("짧습니다");
  });
  test("rejects out-of-range time and media that start after the section", () => {
    expect(() => resolveComposition([node("a", { durationMs: Number.NaN })])).toThrow();
    expect(() => resolveComposition([node("a", { durationMs: 1000, musicMode: "OWN", media: [{ slot: "MUSIC", offsetMs: 1000, durationMs: null }] })])).toThrow("구간 밖");
  });
});

describe("composition import", () => {
  test("recognizes chapters with acts and keeps duplicate titles as distinct identities", () => {
    const { sections } = parseCompositionText("1장 시작\n도입\n1막\n배우: 안녕\n♪ 노래\n1막\n다른 대사\n2장 끝\n끝");
    expect(sections.map((s) => s.title)).toEqual(["1장 시작", "1막", "1막", "2장 끝"]);
    expect(sections[1].parentKey).toBe(sections[0].key);
    expect(sections[2].key).not.toBe(sections[1].key);
    expect(sections[1].lyrics).toBe("노래");
  });
  test("also recognizes traditional act/chapter order and markdown", () => {
    const a = parseCompositionText("제1막\n제1장\n대사\n제2장\n대사").sections;
    expect(a[1].parentKey).toBe(a[0].key);
    const b = parseCompositionText("# 첫 장\n## 첫 막\n대사\n# 첫 장\n반복").sections;
    expect(b[2].key).not.toBe(b[0].key);
    expect(b[2].parentKey).toBeNull();
  });
  test("understands compound chapter/act headings", () => {
    const a = parseCompositionText("1장 1막 출발\n대사\n1장 2막 바다\n대사\n2장 1막\n마지막").sections;
    expect(a.map((s) => s.parentKey)).toEqual([null, a[0].key, a[0].key, null, a[3].key]);
  });
  test("does not treat dialogue containing a chapter name as a heading", () => {
    expect(parseCompositionText("배우: 1장에서 시작해\n다음 말").sections).toHaveLength(1);
    expect(parseCompositionText("").sections).toHaveLength(0);
  });
});

describe("composition DTO boundaries", () => {
  test("requires a revision and rejects null text, negative time and duplicate ordering IDs", () => {
    expect(validateSync(plainToInstance(WriteSectionDto, { title: "1장" })).length).toBeGreaterThan(0);
    expect(validateSync(plainToInstance(WriteSectionDto, { expectedRevision: 0, scriptText: null })).length).toBeGreaterThan(0);
    expect(validateSync(plainToInstance(WriteSectionDto, { expectedRevision: 0, startMs: -1 })).length).toBeGreaterThan(0);
    const id = "f74b6d48-047a-4bcb-97f5-eef4d844765e";
    expect(validateSync(plainToInstance(ReorderSectionsDto, { expectedRevision: 0, sectionIds: [id, id] })).length).toBeGreaterThan(0);
    expect(validateSync(plainToInstance(WriteSectionDto, { expectedRevision: 0, startMs: null, durationMs: null, parentId: null }))).toHaveLength(0);
  });
  test("rejects unknown slots and invalid pages/volumes", () => {
    expect(validateSync(plainToInstance(WriteCompositionMediaDto, { expectedRevision: 0, assetId: "f74b6d48-047a-4bcb-97f5-eef4d844765e", slot: "HTML", page: 0, volume: 2 })).length).toBeGreaterThan(0);
  });
});
