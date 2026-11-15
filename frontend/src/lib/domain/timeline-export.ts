import { activeSection, mediaAt, sourceTimeSeconds, type CompositionSection } from "./composition";
import type { TimelineAsset, TimelineItem, TimelineScene } from "./performance-timeline";

// 연습 타임라인(대본 + 영상 + 음악)을 파일로 내보내는 데 쓰는 순수 계산. 화면 그리기·녹화는 timeline-export-dialog.svelte가 맡는다.
// 시각·자료 계산은 연습 화면(/live)과 같은 buildCompositionRehearsal 결과와 mediaAt/sourceTimeSeconds를 그대로 쓴다.

export type ExportScope = "SCENE" | "ACT" | "ALL" | "CUSTOM";
export type ExportRange = { startMs: number; endMs: number; label: string };
export type ExportSource = {
  sections: CompositionSection[];
  items: TimelineItem[];
  scenes: TimelineScene[];
  /** 연습 화면에서 "장·막 구성" 대본을 고른 상태인지 */
  fromComposition: boolean;
  totalMs: number;
  defaultBackground: TimelineAsset | null;
};
export type ExportMedia = { key: string; assetId: string; kind: string; mime: string; timeSec: number; volume: number; loop: boolean; sourceStartSec: number };
export type ExportCaption = { speaker: string; text: string; lyric: boolean };
export type ExportFrame = {
  sceneTitle: string;
  captions: ExportCaption[];
  /** 대사가 없을 때 보여 주는 행동 큐·무대 지문 */
  note: { label: string; text: string } | null;
  background: ExportMedia | null;
  /** 배경 영상 소리와 별개로 섞어 넣을 소리: 장면 음악, 음원이 연결된 큐 */
  audio: ExportMedia[];
};

export const MIN_EXPORT_MS = 1000;
export const MAX_EXPORT_MS = 3 * 60 * 60 * 1000;
export const RESOLUTIONS = { "720": { width: 1280, height: 720, label: "1280×720", videoBps: 4_000_000 }, "1080": { width: 1920, height: 1080, label: "1920×1080", videoBps: 8_000_000 } } as const;
export type ResolutionKey = keyof typeof RESOLUTIONS;
const AUDIO_BPS = 128_000;
const MP4_CANDIDATES = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4"];
const WEBM_CANDIDATES = ["video/webm;codecs=vp9,opus", "video/webm"];
export const WEBM_FALLBACK_NOTICE = "이 브라우저는 MP4 녹화를 지원하지 않아 WebM으로 저장했어요(Chrome·Edge 최신, Safari 권장)";
export const CORS_HINT = "영상 서버의 CORS 설정이 필요해요. 운영자에게 자료 저장소(R2)의 CORS 허용을 요청해 주세요.";

const span = (items: TimelineItem[]) => items.length ? { startMs: Math.min(...items.map((item) => item.startMs)), endMs: Math.max(...items.map((item) => item.startMs + item.durationMs)) } : null;

/** 범위 선택을 시작·끝(ms)으로 바꾼다. 현재 장면·막은 nowMs(연습 화면의 재생 위치) 기준이다. */
export function exportRange(source: ExportSource, scope: ExportScope, nowMs: number, custom?: { startMs: number; endMs: number }): { range: ExportRange } | { error: string } {
  const finish = (startMs: number, endMs: number, label: string) => {
    const start = Math.max(0, Math.round(startMs));
    const end = Math.min(source.totalMs, Math.round(endMs));
    if (end - start < MIN_EXPORT_MS) return { error: "내보낼 구간이 1초보다 짧아요. 범위를 다시 골라 주세요." };
    if (end - start > MAX_EXPORT_MS) return { error: "한 번에 최대 3시간까지만 녹화할 수 있어요. 구간을 줄여 주세요." };
    return { range: { startMs: start, endMs: end, label } };
  };
  if (!source.totalMs) return { error: "내보낼 대본이나 큐가 아직 없어요." };
  if (scope === "ALL") return finish(0, source.totalMs, "전체");
  if (scope === "CUSTOM") {
    if (!custom || !Number.isFinite(custom.startMs) || !Number.isFinite(custom.endMs) || custom.endMs <= custom.startMs) return { error: "끝 시각은 시작 시각보다 뒤여야 해요." };
    return finish(custom.startMs, custom.endMs, "구간");
  }
  if (source.fromComposition) {
    const scene = activeSection(source.sections, nowMs);
    if (!scene) return { error: "지금 위치에 해당하는 장면이 없어요. 재생 위치를 옮긴 뒤 다시 골라 주세요." };
    const target = scope === "ACT" ? source.sections.find((section) => section.id === scene.parentId) ?? scene : scene;
    return finish(target.timing.startMs, target.timing.startMs + target.timing.durationMs, target.title);
  }
  const sceneId = source.items.find((item) => item.startMs <= nowMs && nowMs < item.startMs + item.durationMs)?.sceneId ?? null;
  const scene = source.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) return { error: "지금 위치에 해당하는 장면이 없어요. 재생 위치를 옮긴 뒤 다시 골라 주세요." };
  const sceneIds = scope === "ACT" ? new Set(source.scenes.filter((candidate) => candidate.act.id === scene.act.id).map((candidate) => candidate.id)) : new Set([scene.id]);
  const found = span(source.items.filter((item) => item.sceneId && sceneIds.has(item.sceneId)));
  if (!found) return { error: "이 장면에는 내보낼 내용이 없어요." };
  return finish(found.startMs, found.endMs, scope === "ACT" ? scene.act.title : scene.title);
}

/** 시각 timeMs에 화면에 그릴 것: 연습 화면(/live)의 stage와 같은 규칙이다. */
export function frameAt(source: ExportSource, timeMs: number): ExportFrame {
  const { items, sections, scenes, fromComposition } = source;
  const active = items.filter((item) => item.startMs <= timeMs && timeMs < item.startMs + item.durationMs);
  const activeLines = active.filter((item) => item.kind === "line");
  const captions = activeLines.filter((item) => item.block?.type === "DIALOGUE" || item.block?.type === "LYRIC");
  const activeCues = active.filter((item) => item.kind === "cue");
  const activeSceneId = active[0]?.sceneId ?? null;
  const sceneStartMs = activeSceneId ? Math.min(...items.filter((item) => item.sceneId === activeSceneId).map((item) => item.startMs)) : 0;
  const sceneSection = fromComposition ? activeSection(sections, timeMs) : activeSceneId ? sections.find((section) => section.sourceSceneId === activeSceneId) ?? null : null;
  const mediaMs = fromComposition ? timeMs : (sceneSection?.timing.startMs ?? 0) + Math.max(0, timeMs - sceneStartMs);
  const backgroundClip = mediaAt(sections, sceneSection, "BACKGROUND", mediaMs);
  const musicClip = mediaAt(sections, sceneSection, "MUSIC", mediaMs);

  const visualCue = activeCues.filter((item) => ["IMAGE", "VIDEO"].includes(item.cue?.asset?.kind ?? "")).at(-1);
  const visual = backgroundClip?.media.asset ?? visualCue?.cue?.asset ?? source.defaultBackground ?? null;
  const background: ExportMedia | null = visual ? {
    key: backgroundClip ? `bg:${backgroundClip.media.id}` : visualCue ? `bg:cue:${visualCue.id}` : `bg:default:${visual.id}`,
    assetId: visual.id, kind: visual.kind, mime: visual.mime,
    timeSec: backgroundClip ? sourceTimeSeconds(backgroundClip, mediaMs, Infinity) : Math.max(0, timeMs - (visualCue?.startMs ?? 0)) / 1000,
    volume: backgroundClip?.media.volume ?? 1, loop: backgroundClip?.media.loop ?? false, sourceStartSec: (backgroundClip?.media.sourceStartMs ?? 0) / 1000
  } : null;

  const audio: ExportMedia[] = [];
  if (musicClip) audio.push({ key: `music:${musicClip.media.id}`, assetId: musicClip.media.assetId, kind: "AUDIO", mime: musicClip.media.asset.mime, timeSec: sourceTimeSeconds(musicClip, mediaMs, Infinity), volume: musicClip.media.volume, loop: musicClip.media.loop, sourceStartSec: musicClip.media.sourceStartMs / 1000 });
  for (const item of activeCues.filter((cue) => cue.cue?.asset?.kind === "AUDIO")) {
    const asset = item.cue!.asset!;
    audio.push({ key: `cue-audio:${item.id}`, assetId: asset.id, kind: "AUDIO", mime: asset.mime, timeSec: (timeMs - item.startMs) / 1000, volume: 1, loop: false, sourceStartSec: 0 });
  }

  const note = !captions.length && (activeCues.length || activeLines.length)
    ? { label: activeCues.length ? "현재 행동 큐" : "무대 지문", text: activeCues[0]?.cue?.content ?? activeLines[0]?.block?.text ?? "" }
    : null;
  return {
    sceneTitle: (fromComposition ? sceneSection?.title : scenes.find((scene) => scene.id === activeSceneId)?.title) ?? "",
    captions: captions.map((item) => ({ speaker: item.block?.character?.name ?? "해설", text: item.block?.text ?? "", lyric: item.block?.type === "LYRIC" })),
    note: note && note.text ? note : null,
    background,
    audio
  };
}

/** 짧은 자료까지 놓치지 않도록 구간 안에서 화면·소리가 바뀌는 경계의 미디어를 모은다. */
export function mediaInRange(source: ExportSource, range: ExportRange): ExportMedia[] {
  const found = new Map<string, ExportMedia>();
  const times = new Set([range.startMs]);
  const add = (time: number) => { if (time >= range.startMs && time < range.endMs) times.add(time); };
  // 초 단위 샘플링은 짧은 큐를 놓치므로 화면이 바뀌는 경계에서 같은 frameAt 계산을 한다.
  for (const item of source.items) { add(item.startMs); add(item.startMs + item.durationMs); }
  for (const section of source.sections) {
    const boundaries = [section.timing.startMs, section.timing.startMs + section.timing.durationMs];
    for (const media of section.media) {
      boundaries.push(section.timing.startMs + media.offsetMs);
      if (media.durationMs !== null) boundaries.push(section.timing.startMs + media.offsetMs + media.durationMs);
    }
    if (source.fromComposition) boundaries.forEach(add);
    else {
      // 구형 대본은 연결 구간과 장면의 시작 시각이 다를 수 있다. 부모에서 상속한 자료도 같은 시계로 옮긴다.
      for (const target of source.sections.filter((candidate) => candidate.id === section.id || candidate.parentId === section.id)) {
        const items = source.items.filter((item) => item.sceneId && item.sceneId === target.sourceSceneId);
        if (!items.length) continue;
        const startMs = Math.min(...items.map((item) => item.startMs));
        boundaries.forEach((time) => add(startMs + time - target.timing.startMs));
      }
    }
  }
  for (const at of [...times].sort((a, b) => a - b)) {
    const frame = frameAt(source, at);
    for (const media of [frame.background, ...frame.audio]) if (media && !found.has(media.key)) found.set(media.key, media);
  }
  return [...found.values()];
}

/** 녹화 시작 전에 구간 안의 자료 주소를 받아 두기 위한 ID 목록이다. */
export function assetsInRange(source: ExportSource, range: ExportRange): string[] {
  return [...new Set(mediaInRange(source, range).map((media) => media.assetId))];
}

/** MediaRecorder가 지원하는 형식을 고른다. MP4가 우선이고, 안 되면 WebM으로 저장한다. */
export function pickRecorderMime(isSupported: (mime: string) => boolean): { mime: string; extension: "mp4" | "webm"; fallback: boolean } | null {
  const mp4 = MP4_CANDIDATES.find((mime) => isSupported(mime));
  if (mp4) return { mime: mp4, extension: "mp4", fallback: false };
  const webm = WEBM_CANDIDATES.find((mime) => isSupported(mime));
  return webm ? { mime: webm, extension: "webm", fallback: true } : null;
}

export function estimateExport(range: ExportRange, resolution: ResolutionKey) {
  const seconds = Math.ceil((range.endMs - range.startMs) / 1000);
  return { seconds, bytes: Math.round(seconds * (RESOLUTIONS[resolution].videoBps + AUDIO_BPS) / 8) };
}

export function exportFileName(title: string, label: string, extension: string): string {
  const clean = (value: string) => value.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, "_").replace(/^[_.]+|[_.]+$/g, "").slice(0, 60);
  return `${clean(title) || "공연"}_${clean(label) || "연습"}.${extension}`;
}

/** 자막을 maxWidth 안에 들어가도록 줄바꿈한다. measure는 canvas의 measureText 폭을 돌려주는 함수다. */
export function wrapLines(text: string, maxWidth: number, measure: (value: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.split(/(\s+)/).filter(Boolean)) {
      if (measure(line + word) <= maxWidth) { line += word; continue; }
      if (line.trim()) { lines.push(line.trimEnd()); line = ""; }
      if (!word.trim()) continue;
      // 한 단어가 한 줄보다 길면 글자 단위로 나눈다.
      for (const char of word) {
        if (line && measure(line + char) > maxWidth) { lines.push(line); line = ""; }
        line += char;
      }
    }
    if (line.trim() || !paragraph) lines.push(line.trimEnd());
  }
  return lines;
}
