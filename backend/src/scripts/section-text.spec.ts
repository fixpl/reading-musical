import { blocksToText, planSync, sameText, textToLines, type BlockLike } from "./section-text";

const block = (id: string, order: number, type: string, text: string, name: string | null = null, label: string | null = null): BlockLike =>
  ({ id, order, type, text, characterId: name ? `role-${name}` : null, characterName: name, cueLabel: label });

const blocks = [
  block("n", 1, "NOTE", "편곡 큐 비엔나 왈츠"),
  block("d1", 2, "DIALOGUE", "어느 저녁, 두 사람.", "해설자"),
  block("s", 3, "STAGE_DIRECTION", "부부가 마주 본다"),
  block("l1", 4, "LYRIC", "[ 부부 왈츠 중창 ]", "엄마", "엄마·아빠"),
  block("d2", 5, "DIALOGUE", "그게 다예요?", "엄마"),
  block("l2", 6, "LYRIC", "Lippen schweigen", "엄마", "엄마·아빠")
];

describe("section text", () => {
  test("blocks → text → lines round trip", () => {
    const text = blocksToText(blocks);
    expect(text.scriptText).toBe("※ 편곡 큐 비엔나 왈츠\n해설자: 어느 저녁, 두 사람.\n[ 부부가 마주 본다 ]\n엄마: 그게 다예요?");
    expect(text.lyrics).toBe("엄마·아빠: [ 부부 왈츠 중창 ]\n엄마·아빠: Lippen schweigen");
    const lines = textToLines(text.scriptText, text.lyrics);
    expect(lines.map((line) => [line.type, line.names.join("·"), line.text])).toEqual([
      ["NOTE", "", "편곡 큐 비엔나 왈츠"], ["DIALOGUE", "해설자", "어느 저녁, 두 사람."], ["STAGE_DIRECTION", "", "부부가 마주 본다"], ["DIALOGUE", "엄마", "그게 다예요?"],
      ["LYRIC", "엄마·아빠", "[ 부부 왈츠 중창 ]"], ["LYRIC", "엄마·아빠", "Lippen schweigen"]
    ]);
  });

  test("an unchanged text keeps every block", () => {
    const text = blocksToText(blocks);
    const plan = planSync(blocks, textToLines(text.scriptText, text.lyrics));
    expect(plan.deleted).toEqual([]);
    expect(plan.entries.every((entry) => entry.kind === "keep")).toBe(true);
    expect(plan.entries.map((entry) => (entry.kind === "create" ? "new" : entry.block.id))).toEqual(["n", "d1", "s", "l1", "d2", "l2"]);
  });

  test("an edited line is updated in place, a new line is created in its spot, a removed line is deleted", () => {
    const text = blocksToText(blocks);
    const edited = text.scriptText
      .replace("어느 저녁, 두 사람.", "오늘 저녁, 두 사람.") // 수정
      .replace("[ 부부가 마주 본다 ]\n", "[ 부부가 마주 본다 ]\n해설자: 새 대사\n") // 추가
      .replace("※ 편곡 큐 비엔나 왈츠\n", ""); // 삭제
    const plan = planSync(blocks, textToLines(edited, text.lyrics));
    expect(plan.deleted.map((item) => item.id)).toEqual(["n"]);
    expect(plan.entries.map((entry) => entry.kind === "create" ? `new:${entry.line.text}` : `${entry.kind}:${entry.block.id}`)).toEqual([
      "update:d1", "keep:s", "new:새 대사", "keep:l1", "keep:d2", "keep:l2"
    ]);
  });

  test("compares texts ignoring whitespace", () => {
    expect(sameText({ scriptText: "a:  b\n\nc", lyrics: "" }, { scriptText: "a: b\nc ", lyrics: "" })).toBe(true);
    expect(sameText({ scriptText: "a", lyrics: "" }, { scriptText: "a", lyrics: "x" })).toBe(false);
  });
});
