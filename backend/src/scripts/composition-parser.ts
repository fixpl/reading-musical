import type { ReviewedSectionDto, SectionKind } from "./composition.dto";

// Names are labels, never identities. Repeated headings create separate keys.
export function parseCompositionText(rawText: string): { sections: ReviewedSectionDto[]; warnings: string[] } {
  const sections: ReviewedSectionDto[] = [];
  const warnings: string[] = [];
  let root: ReviewedSectionDto | undefined;
  let current: ReviewedSectionDto | undefined;
  let rootUnit: string | undefined;
  let rootNumber: string | undefined;
  let headings = 0;
  const kind = (unit?: string): SectionKind => unit === "장" ? "CHAPTER" : unit === "막" ? "ACT" : "SECTION";
  const heading = /^(?:제\s*)?([0-9]+|[일이삼사오육칠팔구십백]+)\s*(장|막)(?=$|[\s:：.\-–—])/;
  const add = (title: string, sectionKind: SectionKind, parentKey: string | null) => {
    const section: ReviewedSectionDto = { key: `section-${sections.length + 1}`, parentKey, title: title.slice(0, 200), kind: sectionKind, scriptText: "", lyrics: "" };
    sections.push(section);
    current = section;
    if (!parentKey) root = section;
    return section;
  };
  for (const rawLine of rawText.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    const markdown = line.match(/^(#{1,2})\s+(.+)$/);
    const text = markdown?.[2] ?? line;
    const match = text.match(heading);
    if (markdown || match) {
      headings += 1;
      const level = markdown?.[1].length;
      const unit = match?.[2];
      // “1장 1막 …” and “1장 2막 …” retain their current parent but create distinct children.
      const remainder = match ? text.slice(match[0].length).trim() : "";
      const nested = remainder.match(heading);
      if (!markdown && match && nested && nested[2] !== unit) {
        if (!root || rootUnit !== unit || rootNumber !== match[1]) {
          add(`${match[1]}${unit}`, kind(unit), null);
          rootUnit = unit;
          rootNumber = match[1];
        }
        add(remainder, kind(nested[2]), root!.key);
      } else if (level === 2) {
        if (!root) add("도입", "SECTION", null);
        add(text, kind(unit), root!.key);
      } else if (level === 1 || !root || !rootUnit || unit === rootUnit) {
        add(text, kind(unit), null);
        if (unit) { rootUnit = unit; rootNumber = match?.[1]; }
      } else {
        add(text, kind(unit), root.key);
      }
      continue;
    }
    if (!current && !line) continue;
    if (!current) add("1장", "CHAPTER", null);
    if (line.startsWith("♪")) {
      current!.lyrics += `${current!.lyrics ? "\n" : ""}${line.replace(/^♪\s*/, "")}`;
    } else {
      current!.scriptText += `${current!.scriptText ? "\n" : ""}${rawLine}`;
    }
  }
  for (const section of sections) { section.scriptText = section.scriptText.trim(); section.lyrics = section.lyrics.trim(); }
  if (!headings && sections.length) warnings.push("장·막 제목을 찾지 못해 하나의 구간으로 만들었습니다. 반영 전에 제목과 구성을 확인하세요.");
  if (!sections.length) warnings.push("추출된 텍스트가 없습니다. 스캔 악보는 장·막을 만든 뒤 ‘악보·이미지’로 원본을 등록하세요.");
  warnings.push("자동 분할은 초안입니다. 제목·상하위 관계·대사와 가사를 검수한 뒤 추가하세요. 기존 대본은 변경하지 않습니다.");
  return { sections, warnings };
}
