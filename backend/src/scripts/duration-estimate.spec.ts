import { estimateLineMs, sceneDurationMs } from "./duration-estimate";

describe("duration estimate", () => {
  test("dialogue grows with length and stays within bounds", () => {
    const short = estimateLineMs("DIALOGUE", "어느 저녁, 두 사람.");
    const long = estimateLineMs("DIALOGUE", "이십 년째 국을 끓이고, 데우고, 또 데워요. 아무도 안 먹어요. 아무도 안 와요.");
    expect(short).toBeGreaterThanOrEqual(1000);
    expect(long).toBeGreaterThan(short);
    expect(estimateLineMs("DIALOGUE", "가".repeat(100000))).toBe(900_000);
  });

  test("a silence direction is held longer than a plain one of the same length", () => {
    expect(estimateLineMs("STAGE_DIRECTION", "[ 긴 침묵 ]")).toBeGreaterThan(estimateLineMs("STAGE_DIRECTION", "[ 걸어 나온다 ]"));
  });

  test("a short music marker reserves a real stretch of time", () => {
    expect(estimateLineMs("STAGE_DIRECTION", "[ 부부 왈츠 중창 ]")).toBeGreaterThanOrEqual(8000);
  });

  test("scene duration prefers explicit line times and never drops below the longest cue", () => {
    const blocks = [
      { type: "DIALOGUE", text: "가나다", durationMs: 4000 },
      { type: "LYRIC", text: "라마바", durationMs: 6000 }
    ];
    expect(sceneDurationMs(blocks)).toBe(10_000);
    expect(sceneDurationMs(blocks, [30, null])).toBe(30_000);
    expect(sceneDurationMs([], [])).toBe(1000);
  });
});
