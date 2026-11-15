// AI가 만든 대본 초안을 사람이 검수·수정할 때 쓰는 순수 함수. 서버로 보내는 초안 형식을 그대로 유지한다.
export type DraftLine = { kind: string; speaker: string | null; text: string; startMs?: number | null; durationMs?: number | null; [key: string]: unknown };
export type DraftCue = { track: string; seconds?: number | null; [key: string]: unknown };
export type DraftScene = { title: string; summary: string | null; lines: DraftLine[]; cues: DraftCue[]; reviewId?: string };
export type DraftAct = { title: string; scenes: DraftScene[] };
export type DraftCharacter = { name: string; description: string };
export type Draft = { acts: DraftAct[]; characters?: DraftCharacter[] };

const MIN_LINE_MS = 1000;
const MAX_MS = 86_400_000;
// 메모(제작진용 지시)는 시간을 거의 차지하지 않으므로 시간 조정에서 제외한다.
const movable = (line: DraftLine) => line.kind !== "메모" && (line.startMs ?? null) === null;

export function sceneMs(scene: DraftScene): number {
  return scene.lines.reduce((sum, line) => sum + (line.durationMs ?? 0), 0);
}

export function totalMs(draft: Draft): number {
  return draft.acts.reduce((sum, act) => sum + act.scenes.reduce((inner, scene) => inner + sceneMs(scene), 0), 0);
}

/** 장면 길이를 바꾸면 움직일 수 있는 줄들의 시간을 같은 비율로 늘이거나 줄인다. 새 길이를 반환한다. */
export function setSceneMs(scene: DraftScene, targetMs: number): number {
  const lines = scene.lines.filter(movable);
  const fixed = scene.lines.filter((line) => !movable(line)).reduce((sum, line) => sum + (line.durationMs ?? 0), 0);
  const current = lines.reduce((sum, line) => sum + (line.durationMs ?? 0), 0);
  const wanted = Math.min(MAX_MS, Math.max(MIN_LINE_MS, Math.round(targetMs))) - fixed;
  if (!lines.length || !(current > 0) || !(wanted > 0)) return sceneMs(scene);
  const ratio = wanted / current;
  for (const line of lines) line.durationMs = Math.max(MIN_LINE_MS, Math.round((line.durationMs ?? 0) * ratio));
  return sceneMs(scene);
}

export function speakers(draft: Draft): string[] {
  const names = new Set<string>();
  for (const act of draft.acts) for (const scene of act.scenes) {
    for (const line of scene.lines) if (line.speaker) names.add(line.speaker);
    for (const cue of scene.cues) if (typeof cue.character === "string" && cue.character) names.add(cue.character);
  }
  return [...names];
}

export function counts(draft: Draft) {
  let scenes = 0, lines = 0, cues = 0;
  for (const act of draft.acts) for (const scene of act.scenes) { scenes += 1; lines += scene.lines.length; cues += scene.cues.length; }
  return { acts: draft.acts.length, scenes, lines, cues };
}

/** 빈 막은 서버가 거부하므로 장면이 없는 막은 제거한다. */
export function pruned(draft: Draft): Draft {
  return { ...draft, acts: draft.acts.filter((act) => act.scenes.length > 0) };
}

export function formatMmSs(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** "3:30", "210", "3분 30초" 형식을 ms로 바꾼다. 해석할 수 없으면 null. */
export function parseMmSs(text: string): number | null {
  const value = text.trim();
  if (!value) return null;
  const korean = value.match(/^(?:(\d+)\s*분)?\s*(?:(\d+)\s*초)?$/);
  let seconds: number;
  if (korean && (korean[1] || korean[2])) seconds = Number(korean[1] ?? 0) * 60 + Number(korean[2] ?? 0);
  else if (/^\d+:\d{1,2}$/.test(value)) { const [m, s] = value.split(":").map(Number); if (s >= 60) return null; seconds = m * 60 + s; }
  else if (/^\d+$/.test(value)) seconds = Number(value);
  else return null;
  const ms = seconds * 1000;
  return ms >= MIN_LINE_MS && ms <= MAX_MS ? ms : null;
}
