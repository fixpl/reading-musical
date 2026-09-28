export type SectionKind = "CHAPTER" | "ACT" | "SCENE" | "SECTION";
export type MediaSlot = "SCORE" | "BACKGROUND" | "MUSIC" | "SOURCE";
export type MediaMode = "INHERIT" | "OWN" | "NONE";
export type MediaAsset = { id: string; kind: string; mime: string; fileName: string | null; storageKey: string; sizeBytes: number };
export type CompositionMedia = {
  id: string; sectionId: string; assetId: string; slot: MediaSlot; label: string; order: number;
  offsetMs: number; durationMs: number | null; sourceStartMs: number; page: number; volume: number; loop: boolean; asset: MediaAsset;
};
export type SectionTiming = { id: string; parentId: string | null; startMs: number; relativeStartMs: number; durationMs: number; depth: number; autoStart: boolean; autoDuration: boolean };
export type CompositionSection = {
  id: string; parentId: string | null; title: string; kind: SectionKind; order: number;
  scriptText: string; lyrics: string; startMs: number | null; durationMs: number | null;
  backgroundMode: MediaMode; musicMode: MediaMode; scoreMode: MediaMode;
  sourceScriptId: string | null; sourceSceneId: string | null; media: CompositionMedia[]; timing: SectionTiming;
};
export type CompositionBoard = {
  production: { id: string; title: string }; revision: number; canEdit: boolean; durationMs: number;
  sections: CompositionSection[]; scripts: Array<{ id: string; title: string }>;
  archived: Array<{ id: string; title: string; parentId: string | null; deletedAt: string }>;
};
export type ImportSection = { key: string; parentKey: string | null; title: string; kind: SectionKind; scriptText: string; lyrics: string; sourceScriptId?: string | null; sourceSceneId?: string | null };
export type ImportPreview = { sections: ImportSection[]; warnings: string[]; sourceAssetId?: string };
export type ResolvedMedia = { media: CompositionMedia; owner: CompositionSection; startMs: number; endMs: number };
export type SectionWrite = Partial<Pick<CompositionSection, "title" | "kind" | "parentId" | "scriptText" | "lyrics" | "startMs" | "durationMs" | "backgroundMode" | "musicMode" | "scoreMode">>;
export type MediaWrite = Pick<CompositionMedia, "assetId" | "slot" | "label" | "offsetMs" | "durationMs" | "sourceStartMs" | "page" | "volume" | "loop">;
export const KIND_LABELS: Record<SectionKind, string> = { CHAPTER: "장", ACT: "막", SCENE: "장면", SECTION: "구간" };
export const SLOT_LABELS: Record<MediaSlot, string> = { SCORE: "악보 · 이미지", BACKGROUND: "배경 영상 · 이미지", MUSIC: "음악", SOURCE: "원본 자료" };
export const MODE_LABELS: Record<MediaMode, string> = { INHERIT: "상위 자료 사용", OWN: "이 구간의 자료 사용", NONE: "사용하지 않음" };
export const MODE_FIELD = { SCORE: "scoreMode", BACKGROUND: "backgroundMode", MUSIC: "musicMode" } as const;

export function assetName(asset: MediaAsset): string {
  return asset.fileName || (asset.storageKey.split("/").pop() ?? "자료").replace(/^[0-9a-f-]{36}-/i, "");
}
export function sectionOrder(sections: CompositionSection[]): CompositionSection[] {
  const sorted = [...sections].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return sorted.filter((s) => !s.parentId).flatMap((root) => [root, ...sorted.filter((s) => s.parentId === root.id)]);
}
export function activeSection(sections: CompositionSection[], timeMs: number): CompositionSection | null {
  return sections.filter((s) => timeMs >= s.timing.startMs && timeMs < s.timing.startMs + s.timing.durationMs)
    .sort((a, b) => b.timing.depth - a.timing.depth)[0] ?? null;
}
export function mediaOwner(sections: CompositionSection[], section: CompositionSection | null, slot: Exclude<MediaSlot, "SOURCE">): CompositionSection | null {
  if (!section || section[MODE_FIELD[slot]] === "NONE") return null;
  if (section[MODE_FIELD[slot]] === "OWN") return section;
  const parent = sections.find((s) => s.id === section.parentId && !s.parentId);
  return parent?.[MODE_FIELD[slot]] === "OWN" ? parent : null;
}
export function mediaAt(sections: CompositionSection[], section: CompositionSection | null, slot: Exclude<MediaSlot, "SOURCE">, timeMs: number): ResolvedMedia | null {
  const owner = mediaOwner(sections, section, slot);
  if (!owner) return null;
  // Inherited clips keep their parent's clock across child boundaries.
  const media = owner.media.filter((m) => m.slot === slot && owner.timing.startMs + m.offsetMs <= timeMs)
    .sort((a, b) => b.offsetMs - a.offsetMs || b.order - a.order || b.id.localeCompare(a.id))[0];
  if (!media) return null;
  const startMs = owner.timing.startMs + media.offsetMs;
  const endMs = Math.min(owner.timing.startMs + owner.timing.durationMs, media.durationMs === null ? Infinity : startMs + media.durationMs);
  return timeMs < endMs ? { media, owner, startMs, endMs } : null;
}
export function sourceTimeSeconds(clip: ResolvedMedia, timeMs: number, sourceDuration: number): number {
  const start = clip.media.sourceStartMs / 1000;
  const elapsed = Math.max(0, timeMs - clip.startMs) / 1000;
  const finite = Number.isFinite(sourceDuration) && sourceDuration > 0;
  const available = finite ? Math.max(0, sourceDuration - start) : Infinity;
  if (clip.media.loop && finite && available > 0) return start + elapsed % available;
  return Math.min(finite ? sourceDuration : Infinity, start + elapsed);
}
export function formatTime(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(sec / 3600);
  return `${h ? `${h}:` : ""}${String(Math.floor(sec / 60) % 60).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
}
export function secondsInput(value: string, nullable = true, minimumMs = 0): number | null {
  if (!value.trim()) { if (nullable) return null; throw new Error("시간을 입력하세요."); }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 86400) throw new Error("시간은 0~86,400초의 숫자로 입력하세요.");
  const ms = Math.round(number * 1000);
  if (ms < minimumMs) throw new Error(`길이는 ${minimumMs / 1000}초 이상이어야 합니다.`);
  return ms;
}
export function acceptsAsset(asset: Pick<MediaAsset, "mime">, slot: MediaSlot): boolean {
  const images = ["image/png", "image/jpeg", "image/webp"];
  if (slot === "SCORE") return asset.mime === "application/pdf" || images.includes(asset.mime);
  if (slot === "BACKGROUND") return images.includes(asset.mime) || ["video/mp4", "video/webm", "video/quicktime"].includes(asset.mime);
  if (slot === "MUSIC") return ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/mp4", "audio/aac", "audio/x-m4a"].includes(asset.mime);
  return images.includes(asset.mime) || ["application/pdf", "text/plain", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"].includes(asset.mime);
}
