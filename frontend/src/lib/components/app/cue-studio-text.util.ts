/**
 * cue-studio.svelte가 쓰는 순수 텍스트 포맷/매칭 함수.
 * 컴포넌트의 반응형 상태($state/$derived)에 전혀 의존하지 않아
 * 별도 파일로 분리해도 안전하다 (드래그/리사이즈 등 상호 참조가 많은
 * 나머지 로직은 컴포넌트 안에 남겨뒀다 — 분리 시 회귀 위험이 큼).
 */

export function formatMinutesAsClock(minutes: number): string {
  const totalSeconds = Math.max(0, Math.round(minutes * 60));
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const ss = String(totalSeconds % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function normalizeForMatch(text: string): string {
  return text.toLocaleLowerCase("ko").replace(/[^0-9a-z가-힣]/g, "");
}

export function findScriptAnchorIndex(
  blocks: Array<{ text: string }>,
  cue: { trigger?: string | null; content: string } | null
): number {
  if (!cue) return -1;
  const trigger = cue.trigger?.trim() ?? "";
  const quoted = [...trigger.matchAll(/["'“”‘’]([^"'“”‘’]{2,})["'“”‘’]/g)].map((match) => normalizeForMatch(match[1]));
  const triggerText = normalizeForMatch(trigger);
  const contentText = normalizeForMatch(cue.content);
  return blocks.findIndex((block) => {
    const blockText = normalizeForMatch(block.text);
    if (blockText.length < 2) return false;
    return (
      quoted.some((text) => blockText.includes(text) || text.includes(blockText)) ||
      (blockText.length >= 4 && triggerText.includes(blockText)) ||
      (contentText.length >= 4 && (blockText.includes(contentText) || contentText.includes(blockText)))
    );
  });
}
