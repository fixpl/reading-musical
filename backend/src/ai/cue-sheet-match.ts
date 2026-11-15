import type { SourceLine } from "./ai-contract";
import { detectHeadings, performersOf } from "./script-structure";
import { type DirectorCue } from "./cue-sheet-document";
import { type AgentRun, runResponses } from "./harness/responses-harness";
import { ServiceUnavailableException } from "@nestjs/common";

export type CueScene = { id: string; actIndex: number; sceneIndex: number; title: string; act: string; line: number | null; speakers: string[] };
export type CueMatch = DirectorCue & {
  status: "candidate" | "review";
  sceneId: string | null;
  reason: string;
  scriptEvidence: string | null;
};
type MatchDraft = { acts: Array<{ title: string; scenes: Array<{ title: string; lines: Array<{ speaker: string | null; sourceLine: number | null }> }> }> };

const normalize = (text: string) => text.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const numberOf = (title: string) => /^넘버\s*(\d+)(?!\d)/.exec(title)?.[1];
const songOf = (title: string) => title.replace(/^넘버\s*\d+\s*/, "").replace(/\s*\([^)]*\)\s*$/, "").trim();
const coreName = (name: string) => /[\p{Script=Latin}]{3}/u.test(name);
const interlude = /^(프리셋|프롤로그|오프닝 전주|현재 전환|.*세팅|.*전환|피날레 진입|커튼콜 멘트)$/;

function bySource(draft: MatchDraft, source: SourceLine[]): CueScene[] {
  const headings = detectHeadings(source);
  return draft.acts.flatMap((act, actIndex) => act.scenes.map((scene, sceneIndex) => {
    const named = headings.filter(item => normalize(item.title) === normalize(scene.title));
    const firstLine = scene.lines.find(line => line.sourceLine !== null)?.sourceLine ?? null;
    const line = named.length === 1 ? named[0].lineId : firstLine;
    const metadata = line !== null && numberOf(scene.title)
      ? source.slice(line, line + 8).filter(item => item.body).slice(0, 3).flatMap(item => performersOf(item.body) ?? [])
      : [];
    return {
      id: `S${actIndex + 1}-${sceneIndex + 1}`, actIndex, sceneIndex, act: act.title, title: scene.title,
      line,
      speakers: [...new Set([...metadata, ...scene.lines.flatMap(line => line.speaker ? [line.speaker] : [])])].slice(0, 12)
    };
  }));
}

function knownMatch(row: DirectorCue, scenes: CueScene[]): CueMatch {
  const base = { ...row, status: "review" as const, sceneId: null, scriptEvidence: null };
  const song = row.actions.find(action => action.track === "음악")?.content.split(/\s+\+\s+/)[0] ?? "";
  const expectedNumber = numberOf(row.section);
  const numbered = scenes.filter(scene => expectedNumber && numberOf(scene.title) === expectedNumber);
  const role = /^(.*?)\s*(?:넘버|독창|폭발|회복)$/.exec(row.section)?.[1].trim();
  const roleScenes = scenes.filter(scene => role && numberOf(scene.title) && scene.speakers.includes(role));
  const sameTitle = scenes.filter(scene => normalize(scene.title) === normalize(row.section));
  const normSong = normalize(song);
  const matchesSong = scenes.filter(scene => {
    if (!numberOf(scene.title) || normSong.length < 5 || (expectedNumber && numberOf(scene.title) !== expectedNumber)) return false;
    const title = normalize(songOf(scene.title));
    return title === normSong || (coreName(song) && title.startsWith(normSong));
  });

  const conflictingSong = (scene: CueScene) => {
    const title = songOf(scene.title);
    const comparable = coreName(song) && coreName(title);
    return comparable && !matchesSong.includes(scene);
  };
  if (matchesSong.length === 1 && !interlude.test(row.section) && (!role || matchesSong[0].speakers.includes(role) || !roleScenes.length)) {
    const scene = matchesSong[0];
    return { ...row, status: "candidate", sceneId: scene.id, reason: "두 문서의 곡명이 일치해요.", scriptEvidence: scene.title };
  }
  const obvious = numbered.length === 1 ? numbered[0] : sameTitle.length === 1 ? sameTitle[0] : null;
  if (obvious && !conflictingSong(obvious)) {
    return { ...row, status: "candidate", sceneId: obvious.id, reason: numbered.length ? "대본과 큐시트의 넘버가 같아요." : "두 문서의 구간 이름이 일치해요.", scriptEvidence: obvious.title };
  }
  const different = obvious && conflictingSong(obvious) ? [obvious] :
    coreName(song) && !matchesSong.length ? roleScenes.filter(conflictingSong) : [];
  if (different.length) {
    return { ...base, reason: "대본과 큐시트의 곡명이 달라요.", scriptEvidence: different.map(scene => scene.title).slice(0, 3).join(" · ") };
  }
  return { ...base, reason: "연결할 장면을 확인해 주세요." };
}

export async function compareCueSheet(draft: MatchDraft, source: SourceLine[], rows: DirectorCue[], signal?: AbortSignal) {
  const scenes = bySource(draft, source);
  const matches = rows.map(row => knownMatch(row, scenes));
  const unresolved = matches.filter(row => row.sceneId === null && !row.scriptEvidence).slice(0, 24);
  let run: AgentRun | null = null;
  let warning: string | null = null;
  if (unresolved.length && scenes.length) {
    const offered = new Map<string, Set<string>>();
    try {
      const result = await runResponses({
        skill: "cue-sheet-match",
        firstTool: "find_scene_candidates",
        input: { cues: unresolved.map(({ id, number, section, actions }) => ({
          id, number, section, hints: actions.map(({ track, content }) => ({ track, content: content.slice(0, 120) }))
        })) },
        signal,
        tools: [
          {
            name: "find_scene_candidates",
            description: "Return the nearest script scene candidates for an unresolved cue in this upload. Use the cue ID to compare its words and neighbors. The result is for review only.",
            properties: { cueId: { type: "string", description: "ID from the unresolved list.", maxLength: 12 } },
            execute: ({ cueId }) => {
              const index = matches.findIndex(item => item.id === cueId);
              const row = unresolved.find(item => item.id === cueId);
              if (!row) return { error: "cue_not_found" };
              const previous = matches.slice(0, index).reverse().find(item => item.sceneId);
              const next = matches.slice(index + 1).find(item => item.sceneId);
              const first = previous ? scenes.findIndex(scene => scene.id === previous.sceneId) : 0;
              const last = next ? scenes.findIndex(scene => scene.id === next.sceneId) : scenes.length - 1;
              const labels = [row.section, ...row.actions.map(action => action.content)].map(normalize).filter(value => value.length > 1);
              const candidates = scenes.map((scene, position) => {
                const names = [scene.title, scene.act, ...scene.speakers].map(normalize);
                const textScore = names.some(name => name.length > 2 && labels.some(label => label.includes(name) || name.includes(label))) ? 3 : 0;
                const adjacent = position >= Math.min(first, last) && position <= Math.max(first, last);
                return { scene, score: textScore + Number(adjacent), position };
              }).sort((a, b) => b.score - a.score || Math.abs(a.position - first) - Math.abs(b.position - first)).slice(0, 4);
              offered.set(cueId, new Set(candidates.map(item => item.scene.id)));
              return { cueId, candidates: candidates.map(({ scene }) => ({ id: scene.id, title: scene.title, act: scene.act, sourceLine: scene.line, speakers: scene.speakers })) };
            }
          },
          {
            name: "read_source_excerpt",
            description: "Read the title and a short excerpt for a scene already returned by find_scene_candidates. Use it if the title alone is ambiguous.",
            properties: { sceneId: { type: "string", description: "Previously offered scene ID.", maxLength: 20 } },
            execute: ({ sceneId }) => {
              const scene = scenes.find(item => item.id === sceneId);
              if (!scene || ![...offered.values()].some(ids => ids.has(sceneId))) return { error: "scene_not_offered" };
              return { sceneId, lines: source.filter(line => scene.line !== null && line.id >= scene.line - 1 && line.id <= scene.line + 5 && line.body)
                .map(line => ({ line: line.id, text: line.body.slice(0, 220) })) };
            }
          }
        ],
        schema: { type: "object", required: ["suggestions"], additionalProperties: false, properties: {
          suggestions: { type: "array", items: { type: "object", required: ["cueId", "sceneId"], additionalProperties: false,
            properties: { cueId: { type: "string" }, sceneId: { type: "string" } } } }
        } },
        parse: (text) => {
          const value: unknown = JSON.parse(text);
          if (!value || typeof value !== "object" || !("suggestions" in value) || !Array.isArray(value.suggestions)) throw new Error("invalid suggestions");
          return value.suggestions as unknown[];
        }
      });
      run = result.run;
      for (const suggestion of result.value) {
        if (!suggestion || typeof suggestion !== "object" || !("cueId" in suggestion) || !("sceneId" in suggestion) ||
            typeof suggestion.cueId !== "string" || typeof suggestion.sceneId !== "string" || !offered.get(suggestion.cueId)?.has(suggestion.sceneId)) continue;
        const row = unresolved.find(item => item.id === suggestion.cueId);
        const scene = scenes.find(item => item.id === suggestion.sceneId);
        if (!row || !scene || row.sceneId) continue;
        Object.assign(row, { sceneId: scene.id, scriptEvidence: scene.title, reason: "AI가 찾은 후보예요. 원문을 보고 연결을 확인해 주세요." });
      }
    } catch (error) {
      if (signal?.aborted || !(error instanceof ServiceUnavailableException)) throw error;
      warning = "AI가 추가 대조를 마치지 못했어요. 표에서 찾은 후보와 확인이 필요한 큐를 표시했어요.";
    }
  }
  return { matches, scenes, run, warning };
}
