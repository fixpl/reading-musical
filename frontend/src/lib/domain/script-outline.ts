// 대본 글에서 막·장·곡 제목을 미리 찾아 "이렇게 읽었어요" 요약을 만든다. 서버(AI 구성)가 쓰는 제목 규칙과 같은 규칙이다.
// 결과는 안내용일 뿐이며 실제 구성은 서버가 만든다.
const ACT = /^(오프닝|프롤로그|에필로그|인터미션|피날레|커튼콜|(?:제\s*)?[0-9IVXⅠ-Ⅹ]+\s*[장막](?:\s.{0,30})?)$/;
const SONG = /^(넘버\s*\d+(?:\s|$)|[♪♫]\s*\S)/;
const NOTES = /^연출\s*메모$/;

export type OutlineItem = { level: 0 | 1 | 2; kind: "막" | "장면" | "곡" | "메모"; title: string; line: number };
export type Outline = { items: OutlineItem[]; acts: number; scenes: number; songs: number };

const squeeze = (text: string) => text.replace(/\s+/g, " ").trim();

export function outlineOf(text: string): Outline {
  const lines = text.split(/\r?\n/).map((raw, index) => ({ raw, text: squeeze(raw), line: index + 1 })).filter((line) => line.text);
  const found: Array<OutlineItem & { unit?: string }> = [];
  lines.forEach((line, index) => {
    if (line.text.length > 60) return;
    if (ACT.test(line.text)) {
      const next = lines[index + 1];
      const usable = !line.text.includes(" ") && next && next.text.length <= 30 && !/^[[(（【]/.test(next.text) && !ACT.test(next.text) && !SONG.test(next.text) && !/　/.test(next.raw) && !/[:：]/.test(next.text);
      found.push({ level: 0, kind: "막", title: usable ? `${line.text} ${next.text}` : line.text, line: line.line, unit: line.text.match(/^(?:제\s*)?[0-9IVXⅠ-Ⅹ]+\s*(막|장)/)?.[1] });
    } else if (SONG.test(line.text)) found.push({ level: 1, kind: "곡", title: line.text.replace(/^[♪♫]\s*/, ""), line: line.line });
    else if (NOTES.test(line.text)) found.push({ level: 0, kind: "메모", title: line.text, line: line.line });
  });
  // "1막 > 제1장"처럼 막과 장이 함께 있으면 장은 막 아래 장면이다.
  const hasAct = found.some((item) => item.unit === "막");
  for (const item of found) if (hasAct && item.unit === "장") { item.level = 1; item.kind = "장면"; }
  const items = found.map(({ unit: _unit, ...item }) => item);
  return { items, acts: items.filter((i) => i.kind === "막").length, scenes: items.filter((i) => i.kind === "장면").length, songs: items.filter((i) => i.kind === "곡").length };
}
