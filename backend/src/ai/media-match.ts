// 영상·음원 파일 이름을 장면에 맞추는 AI 요청과 응답 정리. AI는 영상 내용을 볼 수 없으므로
// 파일 이름(번호·영문/한글 단어)과 장면 제목·내용만 근거로 삼는다.
export type MatchScene = { id: string; title: string; excerpt: string };
export type MediaMatch = { file: string; sectionId: string | null; reason: string | null };

export const MATCH_SYSTEM_PROMPT = `너는 리딩뮤지컬 제작팀의 조수다. 영상·음원 파일 이름과 장면 목록을 보고, 각 파일을 어느 장면의 배경으로 쓸지 정한다.

규칙:
- 너는 파일의 내용을 볼 수 없다. 근거는 파일 이름과 장면 제목·내용뿐이다.
- 파일 이름 앞의 번호(#6, 05, no.3)가 장면 제목의 곡 번호(넘버 6)와 같으면 가장 강한 근거다.
- 번호가 없으면 파일 이름의 단어(영어·한글: moon, car, 번개, rain 등)가 장면 제목·내용의 분위기·소재와 맞는지로 판단한다.
- 한 장면에는 파일을 최대 하나만 배정한다. 같은 번호의 파일이 여러 개면 가장 알맞은 하나만 배정하고 나머지는 null로 둔다.
- 근거가 약하면 억지로 맞추지 말고 sectionId를 null로 둔다.
- sectionId는 장면 목록에 있는 id만 쓴다. 이유(reason)는 한국어 15자 안팎으로 쓴다.

출력: 설명이나 코드 펜스 없이 JSON 객체 하나만. {"matches":[{"file":"파일명","sectionId":"장면 id 또는 null","reason":"이유"}]}`;

export function buildMatchPrompt(files: string[], scenes: MatchScene[]): string {
  const sceneLines = scenes.map((scene) => `- id=${scene.id} | ${scene.title}${scene.excerpt ? ` | ${scene.excerpt}` : ""}`).join("\n");
  return `장면 목록:\n${sceneLines}\n\n파일 목록:\n${files.map((file) => `- ${file}`).join("\n")}`;
}

/** 모델 응답을 파일 순서에 맞춘 안전한 결과로 바꾼다: 모르는 id·중복 배정·누락된 파일을 정리한다. */
export function sanitizeMatches(raw: unknown, files: string[], scenes: MatchScene[]): MediaMatch[] {
  const valid = new Set(scenes.map((scene) => scene.id));
  const list = raw && typeof raw === "object" && Array.isArray((raw as { matches?: unknown }).matches) ? (raw as { matches: unknown[] }).matches : [];
  const byFile = new Map<string, { sectionId: string | null; reason: string | null }>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const { file, sectionId, reason } = item as { file?: unknown; sectionId?: unknown; reason?: unknown };
    if (typeof file !== "string" || byFile.has(file)) continue;
    byFile.set(file, {
      sectionId: typeof sectionId === "string" && valid.has(sectionId) ? sectionId : null,
      reason: typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 60) : null
    });
  }
  const taken = new Set<string>();
  return files.map((file) => {
    const found = byFile.get(file);
    if (!found?.sectionId || taken.has(found.sectionId)) return { file, sectionId: null, reason: found?.sectionId ? "같은 장면에 이미 배정됨" : found?.reason ?? null };
    taken.add(found.sectionId);
    return { file, sectionId: found.sectionId, reason: found.reason };
  });
}
