// 대본에 시간이 없을 때 쓰는 공연 소요 시간 추정. AI가 준 초 단위 추정이 없을 때의 보정값이며 항상 "추정"이다.
export const MIN_LINE_MS = 1_000;
export const MAX_LINE_MS = 900_000;

export type EstimatedBlock = { type: string; text: string; durationMs: number | null };

const SILENCE = /(침묵|정적|사이|멈춘|멈춰|암전|페르마타)/;
const MUSIC_MARK = /(곡\s*시작|중창|독창|합창|노래|반주|전주|간주|후주)/;

const clamp = (ms: number) => Math.min(MAX_LINE_MS, Math.max(MIN_LINE_MS, Math.round(ms)));

/** 한 줄이 무대에서 차지하는 시간(ms). 낭독 속도는 공백 제외 초당 약 4.5자로 본다. */
export function estimateLineMs(type: string, text: string): number {
  const chars = text.replace(/\s+/g, "").length;
  if (type === "DIALOGUE") return clamp(1_500 + (chars / 4.5) * 1000);
  if (type === "LYRIC") return clamp(Math.max(3_500, (chars / 3) * 1000));
  // 지문·메모: 동작 설명이 길수록 오래 걸리고, 침묵·정적 지시는 길게 둔다.
  let ms = 3_000 + chars * 90;
  if (SILENCE.test(text)) ms += 2_000;
  if (MUSIC_MARK.test(text) && chars < 30) ms = Math.max(ms, 8_000);
  return clamp(Math.min(ms, 25_000));
}

/** 장면 길이(ms) = 줄이 이어지는 시간. 줄 시간이 없는 줄은 추정값을 쓰고, 큐가 더 길면 큐 길이를 따른다. */
export function sceneDurationMs(blocks: EstimatedBlock[], cueSeconds: Array<number | null> = []): number {
  const lines = blocks.reduce((sum, block) => sum + (block.durationMs ?? estimateLineMs(block.type, block.text)), 0);
  const cues = Math.max(0, ...cueSeconds.map((seconds) => (seconds ?? 0) * 1000));
  return Math.max(MIN_LINE_MS, lines, cues);
}
