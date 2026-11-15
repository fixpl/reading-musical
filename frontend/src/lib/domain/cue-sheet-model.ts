import type { CompositionSection } from "./composition";
import { buildCompositionRehearsal } from "./rehearsal-timeline";
import { buildPerformanceTimeline, type TimelineCue, type TimelineScene } from "./performance-timeline";

/** 연습과 같은 계산 결과를 큐시트·표·내보내기에 투영한다. 별도 시간표는 저장하지 않는다. */
export function cueSheetModel<Cue extends TimelineCue>(sections: CompositionSection[], scenes: TimelineScene[], cues: Cue[], characters: Array<{ id: string; name: string }>, tracks: Array<{ id: string; name: string }>) {
  const composed = sections.length > 0;
  const timeline = composed ? buildCompositionRehearsal(sections, scenes, cues, characters, tracks) : { ...buildPerformanceTimeline(scenes, cues), scenes };
  const originals = new Map(cues.map(cue => [cue.id, cue]));
  const rawTimes = new Map(buildPerformanceTimeline(scenes, cues).items.filter(item => item.kind === "cue").map(item => [item.id, item.startMs]));
  const cueSources = new Map<string, { id: string; offsetMs: number; sectionId: string | null }>();
  const projectedCues = timeline.items.flatMap(item => {
    if (item.kind !== "cue" || !item.cue) return [];
    const original = item.cue && originals.get(item.cue.id);
    if (original) cueSources.set(item.id, { id: original.id, offsetMs: item.startMs - (rawTimes.get(original.id) ?? item.startMs), sectionId: composed ? item.sceneId : null });
    return [{ ...item.cue, ...original, id: item.id, sceneId: item.sceneId, startMs: item.startMs, durationSec: item.durationMs / 1000,
      trigger: original?.trigger ?? null, note: original?.note ?? null, fromComposition: !original }];
  });
  const projectedScenes = timeline.scenes.flatMap(scene => {
    const section = sections.find(item => item.id === scene.id);
    const items = timeline.items.filter(item => item.sceneId === scene.id);
    // 내용 없는 상위 장·막은 자식의 제목으로 묶고, 같은 구간을 두 번 펼치지 않는다.
    if (section && sections.some(child => child.parentId === section.id) && !items.length) return [];
    const startMs = section?.timing.startMs ?? Math.min(...items.map(item => item.startMs), timeline.totalMs);
    const durationMs = section?.timing.durationMs ?? Math.max(0, ...items.map(item => item.startMs + item.durationMs - startMs));
    return [{ ...scene, summary: scenes.find(original => original.id === section?.sourceSceneId)?.title ?? null,
      range: { startMs, durationMs },
      blocks: items.flatMap(item => item.block ? [{ ...item.block, startMs: item.startMs, durationMs: item.durationMs, estimated: item.estimated }] : []) }];
  });
  const placed = new Set([...cueSources.values()].map(source => source.id));
  return { composed, totalMs: timeline.totalMs, scenes: projectedScenes, cues: projectedCues, cueSources, unplacedCues: cues.filter(cue => !placed.has(cue.id)) };
}
