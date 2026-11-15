// 큐시트(대본 줄, SceneBlock)와 장·막 구성(구간 텍스트)이 같은 글을 서로 오갈 때 쓰는 순수 함수.
//   대사   "엄마: 안녕"          (함께 부르면 "엄마·아빠: …")
//   지문   "[ 조명이 식는다 ]"
//   메모   "※ 편곡 큐: …"        (제작진용 — 공연 시간을 차지하지 않는다)
//   가사   lyrics 칸의 줄
// 대본→텍스트→대본으로 한 바퀴 돌아도 같은 줄이 같은 블록으로 남도록(시간·주석 보존) 줄 단위로 맞춰 본다.

export type BlockLike = { id: string; order: number; type: string; text: string; characterId: string | null; characterName: string | null; cueLabel: string | null };
export type LineType = "DIALOGUE" | "STAGE_DIRECTION" | "NOTE" | "LYRIC";
export type ParsedLine = { group: "script" | "lyric"; type: LineType; names: string[]; text: string };

export const NOTE_MARK = "※";
const oneLine = (text: string) => text.replace(/\s*\n\s*/g, " ").trim();
const groupOf = (type: string): "script" | "lyric" => (type === "LYRIC" ? "lyric" : "script");
const SPEAKER = /^([^:：\n[(（【※]{1,80}?)\s*[:：]\s*(.*)$/;

/** "엄마·아빠", "엄마 × 아빠" 같은 공동 화자 표기를 이름으로 나눈다. */
export function splitNames(name: string): string[] {
  return name.split(/\s*[×·,&/]\s*/).map((part) => part.trim()).filter(Boolean);
}

/** 블록이 말하는 사람 표기 — 함께 부르는 경우 cueLabel("엄마·아빠"), 아니면 배역 이름. */
export function speakerOf(block: Pick<BlockLike, "cueLabel" | "characterName">): string | null {
  return block.cueLabel?.trim() || block.characterName || null;
}

function formatBlock(block: BlockLike): string {
  const text = oneLine(block.text);
  if (block.type === "STAGE_DIRECTION") return `[ ${text} ]`;
  if (block.type === "NOTE") return `${NOTE_MARK} ${text}`;
  const speaker = speakerOf(block);
  return speaker ? `${speaker}: ${text}` : text;
}

/** 장면의 블록을 구성 텍스트(대본·가사)로 바꾼다. 장·막 가져오기와 같은 형식이다. */
export function blocksToText(blocks: BlockLike[]): { scriptText: string; lyrics: string } {
  const sorted = [...blocks].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return {
    scriptText: sorted.filter((block) => block.type !== "LYRIC").map(formatBlock).join("\n"),
    lyrics: sorted.filter((block) => block.type === "LYRIC").map(formatBlock).join("\n")
  };
}

/** 구성 텍스트를 줄 단위 블록 후보로 나눈다. blocksToText의 역변환이다. */
export function textToLines(scriptText: string, lyrics: string): ParsedLine[] {
  const rows = (text: string) => text.split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
  const lines: ParsedLine[] = [];
  for (const raw of rows(scriptText)) {
    if (raw.startsWith(NOTE_MARK)) { lines.push({ group: "script", type: "NOTE", names: [], text: raw.slice(NOTE_MARK.length).trim() }); continue; }
    const direction = raw.match(/^[[(（【]\s*([\s\S]*?)\s*[\])）】]$/);
    if (direction) { lines.push({ group: "script", type: "STAGE_DIRECTION", names: [], text: direction[1] }); continue; }
    const spoken = raw.match(SPEAKER);
    if (spoken) lines.push({ group: "script", type: "DIALOGUE", names: splitNames(spoken[1]), text: spoken[2] });
    else lines.push({ group: "script", type: "DIALOGUE", names: [], text: raw });
  }
  for (const raw of rows(lyrics)) {
    const spoken = raw.match(SPEAKER);
    if (spoken) lines.push({ group: "lyric", type: "LYRIC", names: splitNames(spoken[1]), text: spoken[2] });
    else lines.push({ group: "lyric", type: "LYRIC", names: [], text: raw });
  }
  return lines.filter((line) => line.text);
}

const keyOfLine = (line: ParsedLine) => `${line.type}|${line.names.join("·")}|${oneLine(line.text)}`;
const keyOfBlock = (block: BlockLike) => `${block.type}|${speakerOf(block) ?? ""}|${oneLine(block.text)}`;

/** 두 텍스트가 같은 내용인지 — 공백·줄바꿈 차이는 무시한다. */
export function sameText(a: { scriptText: string; lyrics: string }, b: { scriptText: string; lyrics: string }): boolean {
  const norm = (text: string) => text.split(/\r?\n/).map((row) => row.trim().replace(/\s+/g, " ")).filter(Boolean).join("\n");
  return norm(a.scriptText) === norm(b.scriptText) && norm(a.lyrics) === norm(b.lyrics);
}

export type PlanEntry =
  | { kind: "keep"; block: BlockLike }
  | { kind: "update"; block: BlockLike; line: ParsedLine }
  | { kind: "create"; line: ParsedLine };
export type SyncPlan = { entries: PlanEntry[]; deleted: BlockLike[] };

type GroupAlignment = { entries: PlanEntry[]; deleted: BlockLike[] };

// 같은 종류(대본/가사) 안에서 최장 공통 부분열로 같은 줄을 찾고, 사이에 낀 줄은 순서대로 "수정"으로 짝짓는다.
function align(oldBlocks: BlockLike[], lines: ParsedLine[]): GroupAlignment {
  const n = oldBlocks.length, m = lines.length;
  const oldKeys = oldBlocks.map(keyOfBlock), newKeys = lines.map(keyOfLine);
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  if (n * m <= 4_000_000) {
    for (let i = n - 1; i >= 0; i -= 1) for (let j = m - 1; j >= 0; j -= 1) {
      table[i][j] = oldKeys[i] === newKeys[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const matches: Array<[number, number]> = [];
  for (let i = 0, j = 0; i < n && j < m;) {
    if (oldKeys[i] === newKeys[j]) { matches.push([i, j]); i += 1; j += 1; }
    else if (table[i + 1][j] >= table[i][j + 1]) i += 1;
    else j += 1;
  }
  const entries: PlanEntry[] = [];
  const deleted: BlockLike[] = [];
  let oi = 0, nj = 0;
  const flushGap = (oldEnd: number, newEnd: number) => {
    const oldGap = oldBlocks.slice(oi, oldEnd), newGap = lines.slice(nj, newEnd);
    // 사이에 낀 줄은 순서를 지키며 같은 종류끼리 "수정"으로 짝짓는다(같은 화자를 먼저). 짝이 없으면 새 줄/삭제.
    let cursor = 0;
    const used = new Set<number>();
    for (const line of newGap) {
      const wanted = line.names.join("·");
      let found = -1;
      for (const strict of [true, false]) {
        for (let k = cursor; k < oldGap.length && found < 0; k += 1) {
          if (oldGap[k].type === line.type && (!strict || (speakerOf(oldGap[k]) ?? "") === wanted)) found = k;
        }
        if (found >= 0) break;
      }
      if (found >= 0) { entries.push({ kind: "update", block: oldGap[found], line }); used.add(found); cursor = found + 1; }
      else entries.push({ kind: "create", line });
    }
    oldGap.forEach((block, k) => { if (!used.has(k)) deleted.push(block); });
  };
  for (const [mi, mj] of matches) {
    flushGap(mi, mj);
    entries.push({ kind: "keep", block: oldBlocks[mi] });
    oi = mi + 1; nj = mj + 1;
  }
  flushGap(n, m);
  return { entries, deleted };
}

/**
 * 구성 텍스트에 맞춰 블록을 고치는 계획. 그대로인 줄은 같은 블록으로 남겨 시간·주석·음악 큐 연결을 지키고,
 * 새 줄은 만들고, 사라진 줄만 지운다. 최종 순서는 기존 블록의 앞뒤 관계를 따른다.
 */
export function planSync(oldBlocks: BlockLike[], lines: ParsedLine[]): SyncPlan {
  const sorted = [...oldBlocks].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const parts = (group: "script" | "lyric") => align(sorted.filter((block) => groupOf(block.type) === group), lines.filter((line) => line.group === group));
  const script = parts("script"), lyric = parts("lyric");
  const lists = { script: script.entries, lyric: lyric.entries };
  const pointer = { script: 0, lyric: 0 };
  const entryOf = new Map<string, PlanEntry>();
  for (const entry of [...script.entries, ...lyric.entries]) if (entry.kind !== "create") entryOf.set(entry.block.id, entry);
  const entries: PlanEntry[] = [];
  for (const block of sorted) {
    const entry = entryOf.get(block.id);
    if (!entry) continue; // 삭제 대상
    const group = groupOf(block.type);
    const at = lists[group].indexOf(entry);
    while (pointer[group] <= at) entries.push(lists[group][pointer[group]++]);
    // 새 줄은 앞선 기존 줄 바로 뒤에 놓는다.
    while (pointer[group] < lists[group].length && lists[group][pointer[group]].kind === "create") entries.push(lists[group][pointer[group]++]);
  }
  for (const group of ["script", "lyric"] as const) while (pointer[group] < lists[group].length) entries.push(lists[group][pointer[group]++]);
  return { entries, deleted: [...script.deleted, ...lyric.deleted] };
}
