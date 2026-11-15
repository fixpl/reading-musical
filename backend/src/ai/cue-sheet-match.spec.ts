import { compareCueSheet } from "./cue-sheet-match";
import { runResponses } from "./harness/responses-harness";
import type { DirectorCue } from "./cue-sheet-document";
import { scriptSource } from "./ai-contract";

jest.mock("./harness/responses-harness");

const text = [
  "오프닝", "넘버 1 Lippen schweigen", "엄마 × 아빠 중창", "노래를 시작한다.",
  "I장", "넘버 5 La donna è mobile", "아들 독창", "노래를 시작한다."
].join("\n");
const source = scriptSource(text).lines;
const draft = { acts: [
  { title: "오프닝", scenes: [{ title: "넘버 1 Lippen schweigen", lines: [{ speaker: null, sourceLine: 4 }] }] },
  { title: "I장", scenes: [{ title: "넘버 5 La donna è mobile", lines: [{ speaker: null, sourceLine: 8 }] }] }
] };
function cue(id: string, number: string, section: string, content: string): DirectorCue {
  return { id, row: 2, number, section, startMs: null, note: "", actions: [{ track: "음악", content }] };
}

test("matches a shortened number by the song title and leaves a conflicting solo for review", async () => {
  const result = await compareCueSheet(draft, source, [
    cue("C1", "Q3", "넘버1", "Lippen schweigen"),
    cue("C2", "Q9", "아들 넘버", "Der stürmische Morgen")
  ]);
  expect(result.matches).toMatchObject([
    { number: "Q3", status: "candidate", sceneId: "S1-1", startMs: null },
    { number: "Q9", status: "review", sceneId: null, scriptEvidence: "넘버 5 La donna è mobile", startMs: null }
  ]);
  expect(runResponses).not.toHaveBeenCalled();
});

test("accepts only suggestions returned by the search tool for the same cue", async () => {
  jest.mocked(runResponses).mockImplementationOnce(async options => {
    await options.tools[0].execute({ cueId: "C1" }, new AbortController().signal);
    const value = options.parse('{"suggestions":[{"cueId":"C2","sceneId":"S1-1"},{"cueId":"C1","sceneId":"S1-1"}]}');
    return { value, run: { id: "test", model: "gpt-6.1-terra", skill: "cue-sheet-match", calls: ["find_scene_candidates"] } };
  });
  const result = await compareCueSheet(draft, source, [
    cue("C1", "Q2", "오프닝 전주", "왈츠 전주"),
    cue("C2", "Q4", "현재 전환", "짧은 정적")
  ]);
  expect(result.matches).toMatchObject([
    { status: "review", sceneId: "S1-1" },
    { status: "review", sceneId: null }
  ]);
});
