// 엑셀·구글시트·한글 문서의 표(CSV·탭 구분)를 큐시트 행으로 읽는다. 열 이름은 흔한 표기를 모두 받는다.
export type ImportRow = { cueNumber?: string; track: string; scene?: string; content: string; trigger?: string; note?: string; character?: string; durationSec?: number | null; startMs?: number | null };
export type ParsedSheet = { rows: ImportRow[]; problems: string[]; headers: string[]; delimiter: string };

const COLUMN_ALIASES: Record<keyof ImportRow, string[]> = {
  cueNumber: ["큐번호", "큐", "번호", "q", "q번호", "cue", "cue번호", "no", "no."],
  track: ["부서", "트랙", "파트", "담당부서", "dept", "department", "track"],
  scene: ["장면", "장", "씬", "scene", "막장면", "구간"],
  content: ["내용", "지시", "동작", "큐내용", "content", "action", "cue내용"],
  trigger: ["계기", "트리거", "신호", "대사계기", "trigger", "cue타이밍"],
  note: ["비고", "메모", "참고", "note", "notes", "remarks"],
  character: ["출연", "출연진", "인물", "배역", "배우", "character", "cast"],
  durationSec: ["길이(초)", "길이", "소요", "소요(초)", "초", "duration", "length"],
  startMs: ["시간", "시작", "시작시간", "시각", "time", "start", "타임코드"]
};

/** 따옴표·줄바꿈이 든 칸까지 읽는 CSV 해석기. 쉼표·탭·세미콜론 중 첫 줄에 가장 많은 것을 구분자로 쓴다. */
export function parseTable(input: string): { cells: string[][]; delimiter: string } {
  const text = input.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [",", "\t", ";"].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const cells: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') { if (text[i + 1] === '"') { field += '"'; i += 1; } else quoted = false; } else field += char;
    } else if (char === '"' && field === "") quoted = true;
    else if (char === delimiter) { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field); field = "";
      if (row.some((cell) => cell.trim())) cells.push(row);
      row = [];
    } else field += char;
  }
  row.push(field);
  if (row.some((cell) => cell.trim())) cells.push(row);
  return { cells, delimiter };
}

const norm = (value: string) => value.normalize("NFC").replace(/[\s_·]/g, "").toLowerCase();

/** "1:30", "01:02:03", "90", "1분 30초" → 밀리초. 읽을 수 없으면 null. */
export function parseClock(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  const korean = text.match(/^(?:(\d+)\s*분)?\s*(?:(\d+(?:\.\d+)?)\s*초)?$/);
  if (korean && (korean[1] || korean[2])) return Math.round((Number(korean[1] ?? 0) * 60 + Number(korean[2] ?? 0)) * 1000);
  const parts = text.split(":").map((part) => part.trim());
  if (parts.length > 3 || parts.some((part) => !/^\d+(\.\d+)?$/.test(part))) return null;
  const numbers = parts.map(Number);
  const seconds = numbers.length === 3 ? numbers[0] * 3600 + numbers[1] * 60 + numbers[2] : numbers.length === 2 ? numbers[0] * 60 + numbers[1] : numbers[0];
  return Math.round(seconds * 1000);
}

export function parseCuesheet(input: string): ParsedSheet {
  const { cells, delimiter } = parseTable(input);
  const problems: string[] = [];
  if (cells.length < 2) return { rows: [], problems: ["표에 머리글과 내용을 한 줄 이상 입력해 주세요."], headers: [], delimiter };
  const header = cells[0].map((cell) => cell.trim());
  const index = {} as Partial<Record<keyof ImportRow, number>>;
  header.forEach((name, column) => {
    const key = (Object.keys(COLUMN_ALIASES) as Array<keyof ImportRow>).find((candidate) => !(candidate in index) && COLUMN_ALIASES[candidate].some((alias) => norm(alias) === norm(name)));
    if (key) index[key] = column;
  });
  if (index.track === undefined) problems.push("‘부서’(또는 트랙) 열을 찾지 못했어요. 머리글 이름을 확인해 주세요.");
  if (index.content === undefined) problems.push("‘내용’ 열을 찾지 못했어요. 머리글 이름을 확인해 주세요.");
  if (problems.length) return { rows: [], problems, headers: header, delimiter };
  const rows: ImportRow[] = [];
  cells.slice(1).forEach((line, offset) => {
    // 내보내기가 수식 방지로 붙인 작은따옴표(')와 "장면 미지정" 표기는 되돌린다.
    const get = (key: keyof ImportRow) => {
      const value = index[key] === undefined ? "" : (line[index[key]!] ?? "").replace(/\s+/g, " ").trim();
      if (key === "scene" && value === "장면 미지정") return "";
      return /^'[=+\-@]/.test(value) ? value.slice(1) : value;
    };
    const label = `${offset + 2}번째 줄`;
    const track = get("track"), content = get("content");
    if (!content && !track) return;
    if (!track) { problems.push(`${label}: 부서가 비어 있어 건너뛰어요.`); return; }
    if (!content) { problems.push(`${label}: 내용이 비어 있어 건너뛰어요.`); return; }
    const startRaw = get("startMs"), startMs = startRaw ? parseClock(startRaw) : null;
    if (startRaw && startMs === null) problems.push(`${label}: 시간 “${startRaw}”을 읽지 못해 시각 없이 가져와요(예: 1:30).`);
    const durationRaw = get("durationSec");
    const durationParsed = durationRaw ? (/^\d+(\.\d+)?$/.test(durationRaw) ? Math.round(Number(durationRaw)) : Math.round((parseClock(durationRaw) ?? 0) / 1000)) : null;
    if (durationRaw && !(durationParsed && durationParsed >= 1 && durationParsed <= 3600)) problems.push(`${label}: 길이 “${durationRaw}”는 1~3600초로 읽을 수 없어 비워 둬요.`);
    rows.push({
      cueNumber: get("cueNumber").slice(0, 20) || undefined, track: track.slice(0, 40), scene: get("scene").slice(0, 200) || undefined, content: content.slice(0, 500),
      trigger: get("trigger").slice(0, 200) || undefined, note: get("note").slice(0, 200) || undefined, character: get("character").slice(0, 60) || undefined,
      durationSec: durationParsed && durationParsed >= 1 && durationParsed <= 3600 ? durationParsed : null, startMs: startMs !== null && startMs <= 86_400_000 ? startMs : null
    });
  });
  if (rows.length > 500) { problems.push(`한 번에 500줄까지 가져올 수 있어요. 앞 500줄만 사용해요(전체 ${rows.length}줄).`); rows.length = 500; }
  return { rows, problems, headers: header, delimiter };
}
