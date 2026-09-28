// Pure, millisecond-based layout. Rendering width never changes performance time.
export const MAX_TIME_MS = 86_400_000;
export type TimingMedia = { slot: string; offsetMs: number; durationMs: number | null };
export type TimingSection = {
  id: string; parentId: string | null; title: string; order: number;
  startMs: number | null; durationMs: number | null;
  backgroundMode: string; musicMode: string; scoreMode: string;
  media: TimingMedia[];
};
export type SectionTiming = {
  id: string; parentId: string | null; startMs: number; durationMs: number;
  relativeStartMs: number; depth: number; autoStart: boolean; autoDuration: boolean;
};
export class CompositionLayoutError extends Error {}

export function resolveComposition(sections: TimingSection[]): { entries: SectionTiming[]; durationMs: number } {
  if (sections.length > 1000) throw new CompositionLayoutError("한 공연에는 최대 1,000개 구간을 등록할 수 있습니다.");
  const byId = new Map(sections.map((s) => [s.id, s]));
  if (byId.size !== sections.length) throw new CompositionLayoutError("구간 ID가 중복되었습니다.");
  const children = new Map<string | null, TimingSection[]>();
  for (const section of sections) {
    if (section.parentId !== null) {
      const parent = byId.get(section.parentId);
      if (!parent || parent.id === section.id || parent.parentId !== null) {
        throw new CompositionLayoutError("하위 구간은 같은 공연의 최상위 장·막 아래에만 둘 수 있습니다.");
      }
    }
    if (section.startMs !== null && (!Number.isInteger(section.startMs) || section.startMs < 0 || section.startMs > MAX_TIME_MS)) {
      throw new CompositionLayoutError("시작 시간은 0초 이상, 24시간 이내여야 합니다.");
    }
    if (section.durationMs !== null && (!Number.isInteger(section.durationMs) || section.durationMs < 1000 || section.durationMs > MAX_TIME_MS)) {
      throw new CompositionLayoutError("구간 길이는 1초 이상, 24시간 이내여야 합니다.");
    }
    const list = children.get(section.parentId) ?? [];
    list.push(section);
    children.set(section.parentId, list);
  }
  for (const list of children.values()) list.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  const walk = (parentId: string | null, baseMs: number, depth: number): { entries: SectionTiming[]; durationMs: number } => {
    const entries: SectionTiming[] = [];
    let cursor = 0;
    for (const section of children.get(parentId) ?? []) {
      const relativeStartMs = section.startMs ?? cursor;
      if (relativeStartMs < cursor) {
        throw new CompositionLayoutError(`“${section.title}”의 시작이 앞 구간과 겹칩니다. 시작을 늦추거나 순서 변경 후 자동 연결을 사용하세요.`);
      }
      const startMs = baseMs + relativeStartMs;
      const nested = depth === 0 ? walk(section.id, startMs, 1) : { entries: [], durationMs: 0 };
      const enabledMedia = section.media.filter((m) =>
        (m.slot === "BACKGROUND" && section.backgroundMode === "OWN") ||
        (m.slot === "MUSIC" && section.musicMode === "OWN") ||
        (m.slot === "SCORE" && section.scoreMode === "OWN")
      );
      const mediaEnd = enabledMedia.reduce((max, m) => Math.max(max, m.offsetMs + (m.durationMs ?? 1000)), 0);
      // Parent and child are not sequential performances. Their lengths are never added.
      const automatic = Math.max(nested.durationMs, mediaEnd, nested.entries.length ? 1000 : 60000);
      const durationMs = section.durationMs ?? automatic;
      if (durationMs < nested.durationMs) {
        throw new CompositionLayoutError(`“${section.title}”의 길이가 하위 구간보다 짧습니다. 상위 길이를 늘리거나 자동으로 설정하세요.`);
      }
      if (enabledMedia.some((m) => m.offsetMs >= durationMs)) {
        throw new CompositionLayoutError(`“${section.title}”의 자료 시작이 구간 밖입니다. 자료 시간을 줄이거나 구간을 늘리세요.`);
      }
      if (startMs + durationMs > MAX_TIME_MS) throw new CompositionLayoutError("전체 공연은 24시간 이내여야 합니다.");
      entries.push({ id: section.id, parentId, startMs, relativeStartMs, durationMs, depth, autoStart: section.startMs === null, autoDuration: section.durationMs === null }, ...nested.entries);
      cursor = relativeStartMs + durationMs;
    }
    return { entries, durationMs: cursor };
  };
  return walk(null, 0, 0);
}
