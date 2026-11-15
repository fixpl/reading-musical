import { sectionOrder, type CompositionSection } from "./composition";
import { buildPerformanceTimeline, type TimelineBlock, type TimelineCue, type TimelineItem, type TimelineScene } from "./performance-timeline";

type Character = { id: string; name: string };

/** 구간 텍스트에서 제작진용 메모 줄 앞에 붙는 표시. 대사·지문과 구별한다. */
export const NOTE_MARK = "※";

/** 모두 함께 하는 표기 — 어떤 배역을 골라도 "내 파트"로 잡힌다. */
export const GROUP_SPEAKERS = new Set(["모두", "전원", "합창", "다 같이", "다같이"]);
export const isGroupSpeaker = (name: string | undefined | null) => Boolean(name && GROUP_SPEAKERS.has(name));
/** 목록에서 고를 수 없는 가상 화자: 공동 화자("group:") 또는 "모두". */
export const isPseudoSpeaker = (character: { id: string; name: string }) => character.id.startsWith("group:") || isGroupSpeaker(character.name);
// "엄마·아빠", "엄마 × 아빠" 같은 공동 화자 표기를 이름으로 나눈다.
const splitNames = (name: string) => name.split(/\s*[×·,&/]\s*/).map((part) => part.trim()).filter(Boolean);

/** 줄이 공연에서 차지하는 상대적 무게(ms 단위 추정) — 서버의 시간 추정과 같은 기준이다. */
function lineWeight(type: string, text: string): number {
  const chars = text.replace(/\s+/g, "").length;
  if (type === "SECTION") return 1;
  if (type === "LYRIC") return /^[[(（【]/.test(text) ? 120_000 : Math.max(3_500, (chars / 3) * 1000); // 대괄호 가사 = 곡 전체를 가리키는 줄
  if (type === "DIALOGUE" && !/^[[(（【]/.test(text)) return 1_500 + (chars / 4.5) * 1000;
  return Math.min(25_000, 3_000 + chars * 90);
}

/** Composition timing is authoritative; un-timed text is evenly paced inside its own section. */
export function buildCompositionRehearsal(sections: CompositionSection[], legacyScenes: TimelineScene[], cues: TimelineCue[], characters: Character[], tracks: Array<{ id: string; name: string }> = []) {
  const items: TimelineItem[] = [];
  const scenes: TimelineScene[] = [];
  const original = buildPerformanceTimeline(legacyScenes, cues);
  // 시각을 지정한 큐가 움직여도 장면 기준점은 대본 줄의 시계에 고정한다.
  const scriptClock = buildPerformanceTimeline(legacyScenes, []);
  const scriptStarts = new Map(legacyScenes.map(scene => [scene.id, Math.min(...scriptClock.items.filter(item => item.sceneId === scene.id).map(item => item.startMs))]));
  const sceneStarts = new Map(legacyScenes.map((scene) => [scene.id, Math.min(...original.items.filter((item) => item.sceneId === scene.id).map((item) => item.startMs))]));
  for (const section of sectionOrder(sections)) {
    const parent = sections.find((candidate) => candidate.id === section.parentId);
    const scene: TimelineScene = { id: section.id, title: section.title, order: section.order, act: { id: parent?.id ?? section.id, title: parent?.title ?? "공연 구성", order: parent?.order ?? section.order, scriptId: "composition" } };
    scenes.push(scene);
    const textLines = [
      ...section.scriptText.split(/\r?\n/).filter((text) => text.trim()).map((text) => ({ text: text.trim(), type: "DIALOGUE" })),
      ...section.lyrics.split(/\r?\n/).filter((text) => text.trim()).map((text) => ({ text: text.trim(), type: "LYRIC" }))
    ];
    // 제목과 같은 제작 메모(구조 제목을 메모로 옮긴 줄)는 중복이므로 뺀다.
    const titles = new Set([section.title, parent?.title].filter(Boolean).map((title) => `${NOTE_MARK} ${title}`.replace(/\s+/g, " ")));
    for (let at = textLines.length - 1; at >= 0; at -= 1) if (titles.has(textLines[at].text.replace(/\s+/g, " "))) textLines.splice(at, 1);
    const hasChildren = sections.some((candidate) => candidate.parentId === section.id);
    if (!textLines.length && !hasChildren) textLines.push({ text: section.title, type: "SECTION" });
    // 구간 시간은 줄의 무게에 비례해 나눈다(곡 한 줄이 짧은 대사와 같은 길이를 차지하지 않게).
    const weights = textLines.map((line) => line.text.startsWith(NOTE_MARK) ? 1 : lineWeight(line.type, line.text.replace(/^[^:：\n[(（【※]{1,80}\s*[:：]\s*/, "")));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
    let cumulative = 0;
    for (const [index, line] of textLines.entries()) {
      // 대괄호·괄호로 시작하는 줄은 지문이므로 안의 ":"를 화자 표기로 읽지 않는다.
      const speaker = line.text.match(/^([^:：\n[(（【※]{1,80})\s*[:：]\s*(.*)$/);
      const name = speaker?.[1].trim();
      const fromWeight = cumulative;
      cumulative += weights[index];
      const members = name ? splitNames(name).flatMap((part) => characters.filter((candidate) => candidate.name === part)) : [];
      const assignedCharacter = characters.find((candidate) => candidate.name === name)
        ?? (members.length > 1 || (members.length === 1 && splitNames(name ?? "").length > 1) ? { id: `group:${name}`, name: name! } : undefined);
      const track = name && !assignedCharacter ? tracks.find((candidate) => candidate.name === name) : null;
      const character = name ? assignedCharacter ?? { id: `speaker:${name}`, name } : null;
      const startMs = section.timing.startMs + Math.floor(section.timing.durationMs * fromWeight / totalWeight);
      const endMs = section.timing.startMs + Math.floor(section.timing.durationMs * cumulative / totalWeight);
      if (track && speaker) {
        const cue: TimelineCue = { id: `section:${section.id}:cue:${index}`, trackId: track.id, sceneId: section.id, cueNumber: `${index + 1}`, content: speaker[2], startMs, durationSec: (endMs - startMs) / 1000 };
        items.push({ id: cue.id, kind: "cue", sceneId: section.id, sceneTitle: `${scene.act.title} · ${scene.title}`, cue, startMs, durationMs: Math.max(1, endMs - startMs), estimated: true });
        continue;
      }
      // 제작 메모(※)·지문([ ])·대사를 구분한다. 메모와 지문은 괄호 표시를 떼고 종류로 보여 준다.
      const note = !speaker && line.text.startsWith(NOTE_MARK);
      const direction = !note && line.type === "DIALOGUE" && !speaker && /^[[(（【]/.test(line.text);
      const plain = note ? line.text.slice(NOTE_MARK.length).trim() : direction ? line.text.replace(/^[[(（【]\s*(.*?)\s*[\])）】]$/, "$1") : line.text;
      const block: TimelineBlock = { id: `section:${section.id}:line:${index}`, type: note ? "NOTE" : direction ? "STAGE_DIRECTION" : line.type, text: speaker ? speaker[2] : plain, order: index, character, ...(members.length > 1 || (members.length === 1 && character?.id.startsWith("group:")) ? { characters: members } : {}) };
      items.push({ id: block.id, kind: "line", sceneId: section.id, sceneTitle: `${scene.act.title} · ${scene.title}`, block, startMs, durationMs: Math.max(1, endMs - startMs), estimated: true });
    }
    // Linked cues follow the revised section's start; their original offsets are preserved.
    if (section.sourceSceneId) {
      const originalStart = sceneStarts.get(section.sourceSceneId);
      for (const item of original.items.filter((candidate) => candidate.kind === "cue" && candidate.sceneId === section.sourceSceneId)) {
        const scriptStart = scriptStarts.get(section.sourceSceneId);
        const base = item.cue?.startMs != null && Number.isFinite(scriptStart) ? scriptStart : originalStart;
        const offset = Math.max(0, item.startMs - (Number.isFinite(base) ? base! : 0));
        if (offset >= section.timing.durationMs) continue;
        items.push({ ...item, id: `${item.id}:section:${section.id}`, sceneId: section.id, sceneTitle: `${scene.act.title} · ${scene.title}`, startMs: section.timing.startMs + offset, durationMs: Math.min(item.durationMs, section.timing.durationMs - offset) });
      }
    }
  }
  const durationMs = Math.max(0, ...sections.map((section) => section.timing.startMs + section.timing.durationMs));
  items.push(...original.items.filter((item) => item.kind === "cue" && item.sceneId === null));
  return { scenes, items: items.sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id)), totalMs: Math.max(durationMs, ...items.map((item) => item.startMs + item.durationMs), 0) };
}

export function isMyRehearsalItem(item: TimelineItem, characterIds: string[], trackIds: string[]) {
  if (item.kind !== "line") return Boolean(item.cue && trackIds.includes(item.cue.trackId));
  const block = item.block;
  if (!block?.character) return false;
  if (characterIds.includes(block.character.id) || block.characters?.some((member) => characterIds.includes(member.id))) return true;
  // "모두" 함께 하는 줄은 배역을 고른 사람 모두의 파트이다.
  return isGroupSpeaker(block.character.name) && characterIds.length > 0;
}
