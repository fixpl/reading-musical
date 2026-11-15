import { buildMatchPrompt, sanitizeMatches } from "./media-match";

const scenes = [{ id: "a", title: "넘버 3 Being Alive", excerpt: "" }, { id: "b", title: "제2장 비 오는 밤", excerpt: "비" }];

describe("media match", () => {
  test("keeps valid picks, drops unknown ids and duplicate scenes", () => {
    const out = sanitizeMatches({ matches: [
      { file: "#3.mov", sectionId: "a", reason: "번호 일치" },
      { file: "#3_1.mov", sectionId: "a", reason: "번호 일치" },
      { file: "rain.mp4", sectionId: "zzz" }
    ] }, ["#3.mov", "#3_1.mov", "rain.mp4", "missing.mp4"], scenes);
    expect(out.map((m) => [m.file, m.sectionId])).toEqual([["#3.mov", "a"], ["#3_1.mov", null], ["rain.mp4", null], ["missing.mp4", null]]);
  });
  test("tolerates malformed responses", () => {
    expect(sanitizeMatches("nope", ["x.mp4"], scenes)).toEqual([{ file: "x.mp4", sectionId: null, reason: null }]);
  });
  test("lists scenes and files in the prompt", () => {
    const prompt = buildMatchPrompt(["#3.mov"], scenes);
    expect(prompt).toContain("id=a | 넘버 3 Being Alive");
    expect(prompt).toContain("- #3.mov");
  });
});
