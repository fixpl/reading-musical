import { scriptSource } from "./ai-contract";
import { assignSongPerformers, canonicalSpeaker, detectHeadings, fitSceneDurations, performersOf, placeOnTimeline, restructureDraft, splitPerformers, stripStageBrackets, type StructLine } from "./script-structure";

const SCRIPT = [
  "오프닝", "찬란한 기억", "[ 암전 ]", "해설자　오늘, 한 가족의 식탁.",
  "넘버 1   Lippen schweigen", "편곡 큐  비엔나 왈츠", "[ 부부 왈츠 중창 ]",
  "I장", "각자의 섬", "해설자　오늘 저녁 여섯 시.", "넘버 3   Being Alive", "아빠　오늘도 잘 버텼네.",
  "연출 메모", "· 무대 중앙: 소품 최소화."
].join("\n");

const line = (sourceLine: number, text: string, kind = "지문"): StructLine => ({ kind, speaker: null, text, startMs: null, durationMs: 5000, sourceLine });

describe("script structure", () => {
  const source = scriptSource(SCRIPT).lines;

  test("finds acts with subtitles, numbered songs and the notes section", () => {
    expect(detectHeadings(source).map((heading) => [heading.kind, heading.title])).toEqual([
      ["act", "오프닝 찬란한 기억"], ["scene", "넘버 1 Lippen schweigen"], ["act", "I장 각자의 섬"], ["scene", "넘버 3 Being Alive"], ["notes", "연출 메모"]
    ]);
  });

  test("moves lines to the scene their title opens and turns cue labels and the notes section into notes", () => {
    const lines = source.filter((item) => item.body).map((item) => line(item.id, item.body));
    // 모델이 곡을 전부 한 장면에 몰아넣은 초안
    const draft = { acts: [{ title: "1막", scenes: [{ title: "전부", summary: null, lines, cues: [] }] }] };
    const result = restructureDraft(draft, source);
    expect(result.acts.map((act) => act.title)).toEqual(["오프닝 찬란한 기억", "I장 각자의 섬"]);
    expect(result.acts[0].scenes.map((scene) => scene.title)).toEqual(["찬란한 기억", "넘버 1 Lippen schweigen"]);
    expect(result.acts[1].scenes.map((scene) => scene.title)).toEqual(["각자의 섬", "넘버 3 Being Alive", "연출 메모"]);
    const song = result.acts[0].scenes[1].lines;
    expect(song.find((item) => item.text.startsWith("편곡 큐"))).toMatchObject({ kind: "메모", durationMs: 1 });
    expect(result.acts[1].scenes[2].lines.every((item) => item.kind === "메모")).toBe(true);
  });

  test("keeps the model's structure when the script has no headings", () => {
    const plain = scriptSource("엄마 안녕\n아빠 어서와").lines;
    const draft = { acts: [{ title: "1막", scenes: [{ title: "집", summary: null, lines: [line(1, "엄마 안녕")], cues: [] }] }] };
    expect(restructureDraft(draft, plain)).toBe(draft);
  });

  test("fits a song scene to the minimum song length and honours an explicit duration", () => {
    const song = { title: "넘버 4 Schlechtes Wetter", lines: [line(1, "[ 노래 ]"), line(2, "[ 끝 ]")] };
    expect(fitSceneDurations(song)).toBe(150_000);
    const talk = { title: "넘버 9 식탁 앞의 말 (약 50초)", lines: [line(1, "해설자 대사 약 50초", "대사"), line(2, "엄마 대사", "대사")] };
    expect(fitSceneDurations(talk)).toBe(50_000);
    const notes = { title: "도입", lines: [line(1, "x", "메모")] };
    expect(fitSceneDurations(notes)).toBe(0);
  });

  test("places lines back to back and starts each cue at the line it points to", () => {
    const sceneA = { title: "가", summary: null, lines: [line(1, "a"), line(2, "b")], cues: [{ sourceLine: 2, startMs: null, seconds: 60 }, { sourceLine: null, startMs: null, seconds: 5 }] };
    const sceneB = { title: "나", summary: null, lines: [line(3, "c")], cues: [{ sourceLine: 3, startMs: null, seconds: 3 }] };
    expect(placeOnTimeline({ acts: [{ title: "막", scenes: [sceneA, sceneB] }] })).toBe(true);
    expect(sceneA.lines.map((item) => item.startMs)).toEqual([0, 5000]);
    // 장면 A는 10초. 두 번째 줄(5초)에서 시작하는 큐 60초는 장면 끝(5초 남음)으로 줄고, 계기 없는 큐는 직전 큐 위치를 따른다.
    expect(sceneA.cues.map((cue) => [cue.startMs, cue.seconds])).toEqual([[5000, 5], [5000, 5]]);
    expect(sceneB.lines[0].startMs).toBe(10_000);
    expect(sceneB.cues[0]).toMatchObject({ startMs: 10_000, seconds: 3 });
  });

  test("leaves source-timed drafts alone", () => {
    const timed = { title: "가", summary: null, lines: [{ ...line(1, "a"), startMs: 1000 }], cues: [] };
    expect(placeOnTimeline({ acts: [{ title: "막", scenes: [timed] }] })).toBe(false);
    expect(timed.lines[0].startMs).toBe(1000);
  });
});

describe("song performers", () => {
  const source = scriptSource([
    "넘버 1   Lippen schweigen", "레하르 《메리 위도우》 · 엄마 × 아빠 중창 · Soprano × Baritone · 독일어", "[ 전주 — 해설자, 짧게 한 줄 ]", "[ 부부 왈츠 중창 — 독일어 원어 ]",
    "넘버 4   Schlechtes Wetter", "R. 슈트라우스 · 엄마 독창 · Soprano · 독일어", "[ 엄마, 창가에 서서 부르듯이. 창밖은 영상으로 ]",
    "넘버 3   Being Alive", "손드하임 《Company》 · 아빠 독창 · Baritone · 영어", "Somebody hold me too close",
    "넘버 11   May It Be", "《반지의 제왕》 OST · 4부 합창 · 영어", "May it be an evening star",
    "넘버 9   식탁 앞의 말", "해설자 × 엄마 · Musical Voice × Soprano · 한국어 · 약 50초", "[ 해설자, 습관처럼 앞으로 나온다. ]"
  ].join("\n")).lines;
  const l = (id: number, text: string, kind = "지문", speaker: string | null = null): StructLine => ({ kind, speaker, text, startMs: null, durationMs: 4000, sourceLine: id });

  test("reads performers from the song header", () => {
    expect(performersOf("레하르 《메리 위도우》 · 엄마 × 아빠 중창 · Soprano × Baritone")).toEqual(["엄마", "아빠"]);
    expect(performersOf("R. 슈트라우스 · 엄마 독창 · Soprano · 독일어")).toEqual(["엄마"]);
    expect(performersOf("《반지의 제왕》 OST · 4부 합창 · 영어")).toEqual(["모두"]);
    expect(performersOf("해설자 × 엄마 · Musical Voice × Soprano")).toBeNull();
    expect(splitPerformers("엄마·아빠")).toEqual(["엄마", "아빠"]);
  });

  test("gives lyric lines and bare performance directions to the people who sing", () => {
    const scenes = [
      { title: "넘버 1 Lippen schweigen", summary: null, cues: [], lines: [l(3, "전주 — 해설자, 짧게 한 줄"), l(4, "부부 왈츠 중창 — 독일어 원어")] },
      { title: "넘버 4 Schlechtes Wetter", summary: null, cues: [], lines: [l(7, "엄마, 창가에 서서 부르듯이. 창밖은 영상으로")] },
      { title: "넘버 3 Being Alive", summary: null, cues: [], lines: [l(10, "Somebody hold me too close", "가사")] },
      { title: "넘버 11 May It Be", summary: null, cues: [], lines: [l(13, "May it be an evening star", "가사"), l(14, "Shines down upon you", "가사", "해설자")] },
      { title: "넘버 9 식탁 앞의 말", summary: null, cues: [], lines: [l(16, "해설자, 습관처럼 앞으로 나온다.")] }
    ];
    assignSongPerformers({ acts: [{ title: "막", scenes }] }, source);
    expect(scenes[0].lines.map((x) => [x.kind, x.speaker, x.label ?? null])).toEqual([["지문", null, null], ["가사", "엄마", "엄마·아빠"]]);
    expect(scenes[1].lines[0]).toMatchObject({ kind: "가사", speaker: "엄마" });
    expect(scenes[2].lines[0].speaker).toBe("아빠");
    expect(scenes[3].lines.map((x) => x.speaker)).toEqual(["모두", "해설자"]);
    expect(scenes[4].lines[0]).toMatchObject({ kind: "지문", speaker: null });
  });
});

describe("막/장 hierarchy and text cleanup", () => {
  const text = [
    "1막", "제1장 새벽의 우체국", "엄마　안녕하세요.", "제2장 낮의 마을", "아빠　어서 와요.",
    "2막", "제1장 비 오는 밤", "엄마　비가 오네요.", "커튼콜", "[ 인사 ]"
  ].join("\n");
  const src = scriptSource(text).lines;
  const heads = new Set(detectHeadings(src).map((h) => h.lineId));
  const l = (id: number, t: string): StructLine => ({ kind: heads.has(id) ? "메모" : "지문", speaker: null, text: t, startMs: null, durationMs: 3000, sourceLine: id });

  test("treats 장 as a scene when 막 headings exist", () => {
    const kinds = detectHeadings(src).map((h) => [h.kind, h.title]);
    expect(kinds).toEqual([["act", "1막"], ["scene", "제1장 새벽의 우체국"], ["scene", "제2장 낮의 마을"], ["act", "2막"], ["scene", "제1장 비 오는 밤"], ["act", "커튼콜"]]);
  });

  test("restructures into act > scene and keeps characters", () => {
    const draft = { acts: [{ title: "1막", scenes: [{ title: "x", summary: null, cues: [], lines: src.map((s) => l(s.id, s.body)) }] }], characters: [{ name: "엄마", description: "우체국장" }] };
    const out = restructureDraft(draft, src) as typeof draft;
    expect(out.acts.map((a) => [a.title, a.scenes.map((s) => s.title)])).toEqual([
      ["1막", ["제1장 새벽의 우체국", "제2장 낮의 마을"]], ["2막", ["제1장 비 오는 밤"]], ["커튼콜", ["커튼콜"]]
    ]);
    expect(out.characters).toEqual(draft.characters);
    // 제목 줄은 장면 이름으로 이미 쓰이므로 줄로 남지 않는다.
    expect(out.acts[0].scenes[0].lines.map((x) => x.text)).toEqual(["엄마　안녕하세요."]);
  });

  test("normalizes group speakers and stage brackets", () => {
    expect(["전체", "전원", "다같이", "모두", "엄마"].map(canonicalSpeaker)).toEqual(["모두", "모두", "모두", "모두", "엄마"]);
    expect(splitPerformers("엄마·전체")).toEqual(["엄마", "모두"]);
    expect(stripStageBrackets("[ 암전 ]")).toBe("암전");
    expect(stripStageBrackets("（조명 페이드）")).toBe("조명 페이드");
    expect(stripStageBrackets("(문을 연다) 그리고 (웃는다)")).toBe("(문을 연다) 그리고 (웃는다)");
  });
});

describe("lyric timing", () => {
  test("keeps at least 8 seconds per sung line", () => {
    const l = (kind: string, ms: number): StructLine => ({ kind, speaker: null, text: "가사", startMs: null, durationMs: ms, sourceLine: 1 });
    const scene = { title: "제1장", lines: [l("가사", 3000), l("가사", 12000), l("대사", 3000)] };
    fitSceneDurations(scene);
    expect(scene.lines.map((x) => x.durationMs)).toEqual([8000, 12000, 3000]);
  });
});
