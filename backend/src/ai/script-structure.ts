import type { SourceLine } from "./ai-contract";

// 대본이 직접 적어 둔 막·곡 제목(오프닝, I장, 넘버 3 …)으로 초안의 막·장면 구조를 다시 짠다.
// 모델은 곡을 막으로 올리거나 장면을 합치는 실수를 하므로, 원문에 제목이 있으면 그것이 구조의 기준이다.
export const ACT_HEADING = /^(오프닝|프롤로그|에필로그|인터미션|피날레|커튼콜|(?:제\s*)?[0-9IVXⅠ-Ⅹ]+\s*[장막](?:\s.{0,30})?)$/;
const SCENE_HEADING = /^넘버\s*\d+(?:\s|$)/;
const NOTES_HEADING = /^연출\s*메모$/;
// 공연 중 읽는 대사가 아니라 제작진에게 주는 지시 라벨. 시간을 차지하지 않는 메모로 본다.
const NOTE_LABEL = /^(편곡\s*큐|작사\s*메모|수정\s*메모|음향\s*큐|협의\s*필요|연출\s*메모)(?:\s|$)/;
const EXPLICIT_SECONDS = /약\s*(\d{1,4})\s*초/;
const MAX_SUBTITLE = 30;
/** 메모 줄이 공연 시간에 더하는 길이(ms). 0은 허용되지 않아 가장 작은 값을 쓴다. */
export const NOTE_MS = 1;

export type Heading = { lineId: number; kind: "act" | "scene" | "notes"; title: string; subtitle: string | null; unit?: "막" | "장" | "keyword" };

export type StructLine = { kind: string; speaker: string | null; label?: string | null; text: string; startMs: number | null; durationMs: number | null; seconds?: number | null; sourceLine: number | null };
export type StructCue = { sourceLine: number | null; startMs?: number | null; seconds?: number | null };
export type StructScene<L extends StructLine = StructLine, C extends StructCue = StructCue> = { title: string; summary: string | null; lines: L[]; cues: C[] };
export type StructDraft<L extends StructLine = StructLine, C extends StructCue = StructCue> = { acts: Array<{ title: string; scenes: Array<StructScene<L, C>> }> };

const squeeze = (text: string) => text.replace(/\s+/g, " ").trim();

export function detectHeadings(lines: SourceLine[]): Heading[] {
  const body = lines.filter((line) => line.body.trim());
  const headings: Heading[] = [];
  body.forEach((line, index) => {
    const text = squeeze(line.body);
    if (ACT_HEADING.test(text)) {
      const titled = text.includes(" ");
      const next = body[index + 1] ? squeeze(body[index + 1].body) : "";
      const usable = !titled && next.length > 0 && next.length <= MAX_SUBTITLE && !/^[[(（【]/.test(next) && !SCENE_HEADING.test(next) && !ACT_HEADING.test(next) && !/[　]/.test(body[index + 1].body);
      const unit = text.match(/^(?:제\s*)?[0-9IVXⅠ-Ⅹ]+\s*(막|장)/)?.[1] as "막" | "장" | undefined;
      headings.push({ lineId: line.id, kind: "act", title: usable ? `${text} ${next}` : text, subtitle: usable ? next : null, unit: unit ?? "keyword" });
    } else if (SCENE_HEADING.test(text)) {
      headings.push({ lineId: line.id, kind: "scene", title: text, subtitle: null });
    } else if (NOTES_HEADING.test(text)) {
      headings.push({ lineId: line.id, kind: "notes", title: text, subtitle: null });
    }
  });
  // "1막 > 제1장"처럼 막과 장이 함께 있으면 막이 상위이고 장은 장면이다. 장만 있으면(I장·II장) 장이 상위 구분이다.
  if (headings.some((heading) => heading.unit === "막")) {
    for (const heading of headings) if (heading.unit === "장") { heading.kind = "scene"; heading.subtitle = null; }
  }
  return headings;
}

/**
 * 원문 제목으로 막·장면을 다시 나눈다. 제목이 거의 없으면 모델의 구조를 그대로 둔다.
 * 줄·큐의 내용은 바꾸지 않고 소속 장면만 옮기며, 연출 지시 라벨 줄과 "연출 메모" 이후는 메모로 바꾼다.
 */
export function restructureDraft<L extends StructLine, C extends StructCue>(draft: StructDraft<L, C>, source: SourceLine[]): StructDraft<L, C> {
  const headings = detectHeadings(source);
  if (headings.filter((heading) => heading.kind !== "notes").length < 2) return draft;

  // 제목 줄이 시작하는 구간(bin) — 각 구간은 하나의 장면이 된다. 막 제목은 새 막의 도입 장면도 연다.
  type Bin = { startLine: number; actIndex: number; title: string; lines: L[]; cues: C[]; notes: boolean };
  const bins: Bin[] = [];
  let actIndex = -1;
  const acts: string[] = [];
  const firstId = source.find((line) => line.body.trim())?.id ?? 1;
  const openAct = (title: string) => { acts.push(title); actIndex = acts.length - 1; };
  const firstHeading = headings[0].lineId;
  const headingLines = new Set(headings.map((heading) => heading.lineId));
  let inNotes = false;
  for (const heading of headings) {
    if (heading.kind === "notes") inNotes = true;
    if (heading.kind === "act" && !inNotes) {
      openAct(heading.title);
      bins.push({ startLine: heading.lineId, actIndex, title: heading.subtitle ?? "도입", lines: [], cues: [], notes: false });
    } else {
      if (actIndex < 0) openAct("공연");
      // "연출 메모" 아래의 소제목(넘버 9 — 배우 지시 등)은 새 장면이 아니라 같은 메모 장면에 담는다.
      if (inNotes && heading.kind !== "notes") continue;
      bins.push({ startLine: heading.lineId, actIndex, title: heading.title, lines: [], cues: [], notes: inNotes });
    }
  }
  const binFor = (lineId: number) => {
    let found = bins[0];
    for (const bin of bins) if (bin.startLine <= lineId) found = bin;
    return found;
  };

  for (const act of draft.acts) for (const scene of act.scenes) {
    let anchor = Math.min(...scene.lines.map((line) => line.sourceLine ?? Infinity));
    for (const line of scene.lines) {
      const bin = binFor(line.sourceLine ?? anchor);
      // 제작진용 메모는 공연 시간을 차지하지 않는다.
      // 표지(첫 제목 앞)와 제작진용 지시 라벨도 메모이다.
      const preamble = (line.sourceLine ?? anchor) < firstHeading;
      if (bin.notes || preamble || NOTE_LABEL.test(squeeze(line.text))) Object.assign(line, { kind: "메모", speaker: null, seconds: 1, ...(line.startMs === null ? { durationMs: NOTE_MS } : {}) });
      // 표지·등장인물 소개(첫 제목 앞)와 막·장 제목 줄 자체는 장면 이름·배역 설명에 이미 담기므로 장면의 줄로 남기지 않는다.
      if (line.kind === "메모" && !bin.notes && (preamble || headingLines.has(line.sourceLine ?? -1))) continue;
      bin.lines.push(line);
    }
    for (const cue of scene.cues) {
      if (cue.sourceLine !== null) anchor = cue.sourceLine;
      binFor(cue.sourceLine ?? (Number.isFinite(anchor) ? anchor : firstId)).cues.push(cue);
    }
  }

  // 공연할 내용이 없는 구간(표지·등장인물 소개, 막 제목만 있는 도입)은 다음 구간의 앞 메모로 합친다.
  for (let i = 0; i < bins.length - 1; i += 1) {
    const bin = bins[i];
    if (bin.notes || bin.cues.length || bin.lines.some((line) => line.kind !== "메모")) continue;
    if (!bin.lines.length) continue;
    bins[i + 1].lines.unshift(...bin.lines);
    bin.lines = [];
  }

  const rebuilt: StructDraft<L, C> = { ...draft, acts: [] };
  for (const [index, title] of acts.entries()) {
    const scenes = bins.filter((bin) => bin.actIndex === index && (bin.lines.length || bin.cues.length))
      .map((bin) => ({ title: bin.title, summary: null, lines: bin.lines, cues: bin.cues }));
    // 장면이 하나뿐이고 이름이 없는 도입이면 막 이름을 그대로 쓴다(예: 커튼콜).
    if (scenes.length === 1 && scenes[0].title === "도입") scenes[0].title = title.replace(/^(오프닝|프롤로그|에필로그|인터미션|피날레|커튼콜)\s.*/, "$1");
    if (scenes.length) rebuilt.acts.push({ title, scenes });
  }
  return rebuilt;
}

/**
 * 장면 전체 길이(초)를 정하고 줄 시간을 비례 조정한다. 원문 시간표시가 있는 줄(startMs 보유)은 건드리지 않는다.
 * - 장면 안에 "약 50초"처럼 길이가 적혀 있으면 그 값을 쓴다.
 * - "넘버 N" 곡 장면은 가사가 발췌여도 곡 길이만큼은 차지하므로 최소 길이를 보장한다.
 */
export const MIN_SONG_SECONDS = 150;
export const MIN_LYRIC_LINE_MS = 8000;
export function fitSceneDurations<L extends StructLine>(scene: { title: string; lines: L[] }): number {
  // 노래 가사는 읽는 속도가 아니라 부르는 속도이므로, AI가 짧게 잡은 줄도 한 줄에 최소 8초는 잡는다.
  for (const line of scene.lines) if (line.kind === "가사" && line.startMs === null && (line.durationMs ?? 0) < MIN_LYRIC_LINE_MS) line.durationMs = MIN_LYRIC_LINE_MS;
  const movable = scene.lines.filter((line) => line.startMs === null && line.kind !== "메모");
  const fixed = scene.lines.filter((line) => line.startMs !== null).reduce((sum, line) => sum + (line.durationMs ?? 0), 0);
  const current = movable.reduce((sum, line) => sum + (line.durationMs ?? 0), 0);
  const explicit = scene.lines.map((line) => line.text.match(EXPLICIT_SECONDS)?.[1]).find(Boolean);
  const isSong = SCENE_HEADING.test(scene.title);
  let target = current;
  if (explicit) target = Number(explicit) * 1000 - fixed;
  else if (isSong) target = Math.max(current, MIN_SONG_SECONDS * 1000 - fixed);
  if (!(target > 0) || !(current > 0) || Math.abs(target - current) < 500) return fixed + current;
  const ratio = target / current;
  for (const line of movable) line.durationMs = Math.max(1000, Math.round((line.durationMs ?? 0) * ratio));
  return fixed + movable.reduce((sum, line) => sum + (line.durationMs ?? 0), 0);
}

/**
 * 시간이 없는 새 대본에 공연 시계(ms)를 부여한다. 장면은 순서대로 이어 붙고, 줄은 장면 안에서 차례로 이어진다.
 * 큐는 자신이 가리키는 원문 줄의 시작 시각에 놓이고(없으면 직전 큐 위치), 길이는 장면 끝을 넘지 않게 줄인다.
 * 이미 시간이 있는 줄·큐가 하나라도 있으면 원문 시간표시를 존중하여 아무것도 바꾸지 않는다.
 */
export function placeOnTimeline<L extends StructLine, C extends StructCue>(draft: StructDraft<L, C>): boolean {
  const scenes = draft.acts.flatMap((act) => act.scenes);
  if (scenes.some((scene) => scene.lines.some((line) => line.startMs !== null) || scene.cues.some((cue) => (cue.startMs ?? null) !== null))) return false;
  let cursor = 0;
  for (const scene of scenes) {
    const sceneStart = cursor;
    let offset = 0;
    const starts = new Map<number, number>();
    for (const line of scene.lines) {
      line.startMs = sceneStart + offset;
      if (line.sourceLine !== null) starts.set(line.sourceLine, line.startMs);
      offset += line.durationMs ?? 0;
    }
    const sceneEnd = sceneStart + Math.max(offset, 1000);
    let previous = sceneStart;
    for (const cue of scene.cues) {
      const at = cue.sourceLine !== null && starts.has(cue.sourceLine) ? starts.get(cue.sourceLine)! : previous;
      cue.startMs = at;
      previous = at;
      if (cue.seconds) cue.seconds = Math.max(1, Math.min(cue.seconds, Math.floor((sceneEnd - at) / 1000)));
    }
    cursor = sceneEnd;
  }
  return true;
}

// ── 노래 부르는 사람 ─────────────────────────────────────────────────────────
// 곡 머리의 "아빠 독창", "엄마 × 아빠 중창", "4부 합창" 표기로 가사·공연 줄의 화자를 채운다.
export const GROUP_SPEAKER = "모두";
const PERFORM_KIND = /^(.*?)\s*(독창|중창|합창|듀엣|제창)\s*$/;
const NAME_SPLIT = /\s*[×xX,&/·]\s*|\s+(?:와|과|및)\s+/;
const PERFORMANCE_LINE = /(곡 시작|독창|중창|합창|듀엣|부르|노래)/;

/** "엄마 × 아빠" 같은 공동 화자 표기를 이름 목록으로 나눈다. 한 명이면 그 이름 하나. */
export function splitPerformers(name: string): string[] {
  return name.split(NAME_SPLIT).map((part) => part.trim()).filter(Boolean).map(canonicalSpeaker);
}

const GROUP_ALIASES = new Set(["전체", "전원", "다같이", "다 같이", "모두", "함께", "다함께", "다 함께", "합창단", "앙상블", "ALL", "All", "all"]);
/** "전체·전원·다같이" 같은 단체 표기는 배역이 아니라 하나의 "모두"로 통일한다. */
export function canonicalSpeaker(name: string): string {
  return GROUP_ALIASES.has(name.trim()) ? GROUP_SPEAKER : name.trim();
}

/** 지문 겉의 괄호( ) （ ） [ ] 【 】 를 벗긴다. 화면에서 다시 [ ] 로 감싸 보여 주므로 저장은 본문만. */
export function stripStageBrackets(text: string): string {
  const PAIRS: Record<string, string> = { "[": "]", "(": ")", "（": "）", "【": "】" };
  let out = text.trim();
  for (let i = 0; i < 2; i += 1) {
    const close = PAIRS[out[0]];
    // 첫 글자의 짝이 맨 끝에 있고, 그 사이에 같은 종류 괄호가 더 없을 때만 겉 괄호로 본다("(a) 그리고 (b)"는 그대로).
    if (!close || !out.endsWith(close) || out.slice(1, -1).includes(close)) break;
    out = out.slice(1, -1).trim();
  }
  return out || text.trim();
}

/** 곡 머리줄(예: "손드하임 《Company》 · 아빠 독창 · Baritone · 영어")에서 부르는 사람들. 알 수 없으면 null. */
export function performersOf(header: string): string[] | null {
  for (const part of header.split(/\s*[·•|]\s*/)) {
    const match = part.match(PERFORM_KIND);
    if (!match) continue;
    const names = splitPerformers(match[1]);
    const valid = names.filter((name) => /^[가-힣A-Za-z]{1,8}$/.test(name));
    if (names.length && valid.length === names.length) return valid;
    return match[2] === "합창" || match[2] === "제창" ? [GROUP_SPEAKER] : null; // "4부 합창"처럼 이름이 아닌 표기
  }
  return null;
}

/**
 * 곡 장면의 가사 줄(화자 없는 것)에 부르는 사람을 채운다. 가사가 대본에 없는 곡은 "곡 시작·부르듯이" 같은
 * 공연 지문 한 줄을 그 사람의 노래 줄로 바꿔, 연습에서 "내 파트"가 곡 시간만큼 잡히게 한다.
 * 둘 이상이 함께 부르면 화자는 첫 사람이고 전체 표기는 label("엄마·아빠")에 둔다.
 */
export function assignSongPerformers<L extends StructLine, C extends StructCue>(draft: StructDraft<L, C>, source: SourceLine[]): number {
  const body = source.filter((line) => line.body.trim());
  const byTitle = new Map<string, string[]>();
  for (const heading of detectHeadings(source)) {
    if (heading.kind !== "scene" || !SCENE_HEADING.test(heading.title)) continue;
    const at = body.findIndex((line) => line.id === heading.lineId);
    for (const line of body.slice(at + 1, at + 4)) {
      const performers = performersOf(squeeze(line.body));
      if (performers) { byTitle.set(heading.title, performers); break; }
    }
  }
  let changed = 0;
  for (const act of draft.acts) for (const scene of act.scenes) {
    const performers = byTitle.get(squeeze(scene.title));
    if (!performers) continue;
    const label = performers.length > 1 ? performers.join("·") : null;
    // 곡 전체를 가리키는 줄이라는 표시로 대괄호를 유지한다(연습 화면이 이 표시로 곡 시간을 길게 잡는다).
    const sing = (line: L) => { line.kind = "가사"; line.speaker = performers[0]; line.label = label; if (!/^[[(（【]/.test(line.text)) line.text = `[ ${line.text} ]`; changed += 1; };
    const lyrics = scene.lines.filter((line) => line.kind === "가사");
    if (lyrics.length) { for (const line of lyrics) if (!line.speaker) sing(line); continue; }
    const target = scene.lines.find((line) => line.kind !== "메모" && !line.speaker && PERFORMANCE_LINE.test(line.text))
      ?? scene.lines.find((line) => line.kind === "지문" && !line.speaker);
    if (target) sing(target);
  }
  return changed;
}
