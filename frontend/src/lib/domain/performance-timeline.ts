export type TimelineAsset = { id: string; kind: string; mime: string; storageKey: string };
export type TimelineBlock = { id: string; type: string; text: string; order: number; startMs?: number | null; durationMs?: number | null; character: { id: string; name: string } | null };
export type TimelineScene = { id: string; title: string; order: number; act: { id: string; title: string; order: number; scriptId?: string; script?: { title: string } }; blocks?: TimelineBlock[] };
export type TimelineCue = { id: string; trackId: string; sceneId: string | null; cueNumber: string; content: string; note?: string | null; trigger?: string | null; startMs?: number | null; durationSec?: number | null; asset?: TimelineAsset | null };
export type TimelineItem = { id: string; kind: "line" | "cue"; sceneId: string | null; sceneTitle: string; startMs: number; durationMs: number; estimated: boolean; block?: TimelineBlock; cue?: TimelineCue };
const valid = (value: unknown, minimum = 0): value is number => typeof value === "number" && Number.isFinite(value) && value >= minimum;

/** Actual time, independent of clip width, labels, zoom, and device size. */
export function buildPerformanceTimeline(scenes: TimelineScene[], cues: TimelineCue[]) {
  const items: TimelineItem[] = [];
  let cursor = 0;
  const addScene = (sceneId: string | null, sceneTitle: string, blocks: TimelineBlock[], sceneCues: TimelineCue[]) => {
    const anchors = [...blocks.map((b) => b.startMs), ...sceneCues.map((c) => c.startMs)].filter((v): v is number => valid(v));
    const sceneStart = anchors.length ? Math.min(...anchors) : cursor;
    let lineCursor = sceneStart;
    for (const block of [...blocks].sort((a, b) => a.order - b.order)) {
      const explicitStart = valid(block.startMs);
      const explicitDuration = valid(block.durationMs, 1);
      const startMs = explicitStart ? block.startMs! : lineCursor;
      const durationMs = explicitDuration ? block.durationMs! : 8000;
      items.push({ id: block.id, kind: "line", sceneId, sceneTitle, block, startMs, durationMs, estimated: !explicitStart || !explicitDuration });
      lineCursor = Math.max(lineCursor, startMs + durationMs);
      cursor = Math.max(cursor, startMs + durationMs);
    }
    const trackEnds = new Map<string, number>();
    for (const cue of sceneCues) {
      const explicitStart = valid(cue.startMs);
      const explicitDuration = valid(cue.durationSec, 1);
      const startMs = explicitStart ? cue.startMs! : (trackEnds.get(cue.trackId) ?? sceneStart);
      const durationMs = (explicitDuration ? cue.durationSec! : 30) * 1000;
      items.push({ id: cue.id, kind: "cue", sceneId, sceneTitle, cue, startMs, durationMs, estimated: !explicitStart || !explicitDuration });
      trackEnds.set(cue.trackId, Math.max(trackEnds.get(cue.trackId) ?? 0, startMs + durationMs));
      cursor = Math.max(cursor, startMs + durationMs);
    }
  };
  for (const scene of scenes) addScene(scene.id, `${scene.act.title} · ${scene.title}`, scene.blocks ?? [], cues.filter((cue) => cue.sceneId === scene.id));
  addScene(null, "장면 미지정", [], cues.filter((cue) => cue.sceneId === null));
  return { items: items.sort((a, b) => a.startMs - b.startMs || (a.kind === b.kind ? 0 : a.kind === "line" ? -1 : 1)), totalMs: cursor };
}

export function parseTimelineTime(value: string): number | null {
  const text = value.trim().replace(",", ".");
  if (!text) return null;
  if (!/^\d+(?::\d{2}){0,2}(?:\.\d{1,3})?$/.test(text)) throw new Error("초 또는 분:초 / 시:분:초 형식으로 입력해 주세요");
  const parts = text.split(":").map(Number);
  if (parts.length > 1 && (parts[parts.length - 1] >= 60 || (parts.length === 3 && parts[1] >= 60))) throw new Error("분·초를 확인해 주세요");
  const seconds = parts.reduce((sum, part) => sum * 60 + part, 0);
  const ms = Math.round(seconds * 1000);
  if (!Number.isSafeInteger(ms) || ms < 0 || ms > 86_400_000) throw new Error("공연 시간은 24시간 이내로 입력해 주세요");
  return ms;
}

export function formatTimelineTime(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor(safe / 60_000) % 60;
  const seconds = Math.floor(safe / 1000) % 60;
  const fraction = safe % 1000;
  return `${hours ? `${String(hours).padStart(2, "0")}:` : ""}${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}${fraction ? `.${String(fraction).padStart(3, "0")}` : ""}`;
}
