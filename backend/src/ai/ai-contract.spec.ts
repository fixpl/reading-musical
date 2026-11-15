import { bindSourceTimes, scriptSource } from "./ai-contract";

const draftOf = (lines: Array<{ text: string; sourceLine: number }>) => ({
  acts: [{ scenes: [{ lines: lines.map((line) => ({ ...line, startMs: null, durationMs: null })), cues: [] }] }]
});

describe("bindSourceTimes", () => {
  const source = scriptSource("제목\n엄마 안녕\n[ 조명 변화 ]\n아빠 어서와").lines;

  test("rejects a draft that silently drops an original line", () => {
    const draft = draftOf([{ text: "엄마 안녕", sourceLine: 2 }, { text: "아빠 어서와", sourceLine: 4 }]);
    expect(() => bindSourceTimes(draft, source)).toThrow("누락");
  });

  test("keeps dropped original lines as notes in source order instead of failing", () => {
    const draft = draftOf([{ text: "엄마 안녕", sourceLine: 2 }, { text: "아빠 어서와", sourceLine: 4 }]);
    bindSourceTimes(draft, source, undefined, { keepMissingAsNotes: true });
    const lines = draft.acts[0].scenes[0].lines as Array<{ text: string; kind?: string; sourceLine: number }>;
    expect(lines.map((line) => line.sourceLine)).toEqual([1, 2, 3, 4]);
    expect(lines.find((line) => line.sourceLine === 3)).toMatchObject({ kind: "메모", text: "[ 조명 변화 ]" });
  });
});
