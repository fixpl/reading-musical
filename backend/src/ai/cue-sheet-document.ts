import { BadRequestException } from "@nestjs/common";
import mammoth from "mammoth";
import { parseTimecode } from "./ai-contract";

type WordNode = { type: string; children?: WordNode[]; value?: string; colSpan?: number; rowSpan?: number };
export const cueTracks = ["영상", "음악", "효과음", "조명", "배우", "해설"] as const;
export type CueTrackName = typeof cueTracks[number];
export type DirectorCue = {
  id: string;
  row: number;
  number: string;
  section: string;
  startMs: number | null;
  note: string;
  actions: Array<{ track: CueTrackName; content: string }>;
};

function cellText(node: WordNode): string {
  if (node.type === "text") return node.value ?? "";
  if (node.type === "tab" || node.type === "break") return " ";
  return (node.children ?? []).map(cellText).join(node.type === "tableCell" ? " " : "");
}

function cueTable(tables: WordNode[][]): DirectorCue[] {
  const normalize = (value: string) => value.normalize("NFC").replace(/\s/g, "");
  const supported = tables.flatMap(table => {
    const headingRow = table.findIndex(row => {
      const labels = (row.children ?? []).map(cell => normalize(cellText(cell)));
      return labels.some(label => ["큐", "큐번호"].includes(label)) &&
        labels.some(label => ["구간", "장면"].includes(label)) &&
        labels.some(label => ["영상", "음악", "음악/효과", "음향", "효과음", "조명", "배우", "해설"].includes(label));
    });
    return headingRow === -1 ? [] : [{ table, headingRow }];
  });
  if (supported.length !== 1) throw new BadRequestException("큐 번호·구간·부서별 지시가 있는 표 한 개를 Word 파일에서 찾아야 해요.");

  const { table, headingRow } = supported[0];
  const header = (table[headingRow].children ?? []).map(cell => normalize(cellText(cell)));
  const col = (...names: string[]) => header.findIndex(label => names.includes(label));
  const columns: Array<{ column: number; track: CueTrackName }> = [
    { column: col("영상"), track: "영상" },
    { column: col("음악", "음악/효과", "음향"), track: "음악" },
    { column: col("효과음"), track: "효과음" },
    { column: col("조명"), track: "조명" },
    { column: col("배우"), track: "배우" },
    { column: col("해설"), track: "해설" }
  ];
  const rows: DirectorCue[] = [];
  const seen = new Set<string>();
  for (const [index, row] of table.slice(headingRow + 1).entries()) {
    const cells = row.children ?? [];
    const values = cells.map(cell => cellText(cell).replace(/\s+/g, " ").trim());
    if (values.every(value => !value)) continue;
    const rowNumber = headingRow + index + 2;
    if (cells.length !== header.length || cells.some(cell => (cell.colSpan ?? 1) !== 1 || (cell.rowSpan ?? 1) !== 1)) {
      throw new BadRequestException(`큐시트 표 ${rowNumber}행의 병합된 셀이나 열 수를 확인해 주세요.`);
    }
    const number = values[col("큐", "큐번호")] ?? "";
    const section = values[col("구간", "장면")] ?? "";
    const note = values[col("핵심메모", "메모", "비고")] ?? "";
    if (!number || number.length > 20 || !section || section.length > 120 || note.length > 300 || seen.has(normalize(number).toLowerCase())) {
      throw new BadRequestException(`큐시트 표 ${rowNumber}행의 큐 번호, 구간 또는 메모를 확인해 주세요. 큐 번호는 중복될 수 없어요.`);
    }
    const actions = columns.flatMap(({ column, track }) => {
      const content = values[column] ?? "";
      return content && !/^(?:[-–—]|없음|해당 없음)$/.test(content) ? [{ track, content }] : [];
    });
    if (!actions.length || actions.some(action => action.content.length > 500)) {
      throw new BadRequestException(`큐시트 표 ${rowNumber}행에는 500자 이내의 부서별 지시가 필요해요.`);
    }
    const time = values[col("시간", "시각", "타임코드", "시작시간")] ?? "";
    let startMs: number | null = null;
    if (time) {
      try { startMs = parseTimecode(time); }
      catch { throw new BadRequestException(`큐시트 표 ${rowNumber}행의 시간은 01:30처럼 입력해 주세요.`); }
    }
    seen.add(normalize(number).toLowerCase());
    rows.push({ id: `C${rows.length + 1}`, row: rowNumber, number, section, note, startMs, actions });
  }
  if (!rows.length || rows.length > 100) throw new BadRequestException("큐시트 한 장에 큐를 1개 이상, 100개 이하로 넣어 주세요.");
  return rows;
}

export async function readCueSheetDocument(buffer: Buffer): Promise<DirectorCue[]> {
  let tables: WordNode[][] = [];
  try {
    await mammoth.convertToHtml({ buffer }, {
      externalFileAccess: false,
      includeEmbeddedStyleMap: false,
      transformDocument(document: WordNode) {
        tables = (document.children ?? []).filter(node => node.type === "table").map(node => node.children ?? []);
        // Only the parsed table tree is needed. Skip HTML generation for the original document.
        return { ...document, children: [] };
      }
    });
  } catch {
    throw new BadRequestException("큐시트 Word 파일을 읽지 못했어요. .docx 파일을 확인해 주세요.");
  }
  return cueTable(tables);
}
