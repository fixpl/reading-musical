export const MAX_TIMELINE_MS = 86_400_000;
export const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
export const NVIDIA_MODEL = "deepseek-ai/deepseek-v4-pro-0813";

/** Server-only settings. Extra request properties are top-level in the JS SDK. */
export function readLlmSettings(env: Record<string, string | undefined>) {
  const baseURL = env.LLM_BASE_URL?.trim() || NVIDIA_BASE_URL;
  const url = new URL(baseURL);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("LLM_BASE_URL은 인증정보가 없는 HTTPS 주소여야 합니다");
  }
  const nvidia = url.hostname === "integrate.api.nvidia.com";
  if (env.NVIDIA_API_KEY?.trim() && !nvidia) {
    throw new Error("NVIDIA_API_KEY와 LLM_BASE_URL의 공급자가 다릅니다. NVIDIA 주소를 설정해 주세요");
  }
  const apiKey = (nvidia ? env.NVIDIA_API_KEY?.trim() || env.LLM_API_KEY?.trim() : env.LLM_API_KEY?.trim());
  if (!apiKey) throw new Error("서버에 NVIDIA_API_KEY 또는 해당 공급자의 LLM_API_KEY를 설정해 주세요");
  const number = (key: string, fallback: number, min: number, max: number, integer = false) => {
    const value = env[key]?.trim() ? Number(env[key]) : fallback;
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
      throw new Error(`${key} 설정 범위를 확인해 주세요 (${min}~${max})`);
    }
    return value;
  };
  const model = env.LLM_MODEL?.trim() || NVIDIA_MODEL;
  let extra: Record<string, unknown> = nvidia && model.startsWith("deepseek-ai/deepseek-v4")
    ? { chat_template_kwargs: { thinking: false } } : {};
  if (env.LLM_EXTRA_BODY_JSON?.trim()) {
    const parsed: unknown = JSON.parse(env.LLM_EXTRA_BODY_JSON);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("LLM_EXTRA_BODY_JSON은 JSON 객체여야 합니다");
    extra = parsed as Record<string, unknown>;
    const protectedKeys = ["model", "messages", "stream", "temperature", "top_p", "max_tokens", "seed", "response_format", "api_key", "headers", "baseURL", "__proto__", "constructor", "prototype"];
    if (protectedKeys.some((key) => Object.prototype.hasOwnProperty.call(extra, key))) {
      throw new Error("LLM_EXTRA_BODY_JSON에 기본 요청이나 인증 설정을 덮어쓰는 키를 넣을 수 없습니다");
    }
  }
  return {
    apiKey, baseURL, model, extra,
    temperature: number("LLM_TEMPERATURE", 1, 0, 1),
    topP: number("LLM_TOP_P", 0.95, 0.01, 1),
    maxTokens: number("LLM_MAX_TOKENS", 16_384, 256, 16_384, true),
    seed: number("LLM_SEED", 42, 0, 2_147_483_647, true),
    timeout: number("LLM_TIMEOUT_MS", 180_000, 1_000, 300_000, true),
    maxRetries: number("LLM_MAX_RETRIES", 2, 0, 3, true),
    jsonMode: env.LLM_JSON_MODE === "true"
  };
}

export function milliseconds(value: unknown, duration = false): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < (duration ? 1 : 0) || value > MAX_TIMELINE_MS) {
    throw new Error("타임라인 시간은 0~24시간 범위의 정수 밀리초여야 합니다 (길이는 0보다 커야 합니다)");
  }
  return value;
}

export function parseTimecode(value: string): number {
  if (!/^\d{1,3}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?$/.test(value)) throw new Error("시간표시 형식이 올바르지 않습니다");
  const parts = value.replace(",", ".").split(":").map(Number);
  const seconds = parts[parts.length - 1];
  if (seconds >= 60 || (parts.length === 3 && parts[1] >= 60)) throw new Error("분·초는 60 미만이어야 합니다");
  const total = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + seconds : parts[0] * 60 + seconds;
  return milliseconds(Math.round(total * 1000))!;
}

export type SourceLine = { id: number; body: string; startMs: number | null; durationMs: number | null };
const PREFIX = /^\s*(\[|\()?(\d{1,3}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)(?:\s*(?:-->|~|–|-)\s*(\d{1,3}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?))?(\]|\))?\s*/;

/** Parse source timestamps before invoking a model. Times are performance-relative. */
export function scriptSource(text: string): { annotated: string; lines: SourceLine[] } {
  let pending: Pick<SourceLine, "startMs" | "durationMs"> | null = null;
  const lines = text.split(/\r?\n/).map((raw, index): SourceLine => {
    const match = raw.match(PREFIX);
    let body = raw.trim();
    let timing: Pick<SourceLine, "startMs" | "durationMs"> = { startMs: null, durationMs: null };
    if (match) {
      if ((match[1] === "[" && match[4] !== "]") || (match[1] === "(" && match[4] !== ")") || (!match[1] && match[4])) {
        throw new Error(`${index + 1}행의 시간표시 괄호를 확인해 주세요`);
      }
      const startMs = parseTimecode(match[2]);
      const endMs = match[3] ? parseTimecode(match[3]) : null;
      if (endMs !== null && endMs <= startMs) throw new Error(`${index + 1}행의 종료 시각은 시작보다 뒤여야 합니다`);
      timing = { startMs, durationMs: endMs === null ? null : endMs - startMs };
      body = raw.slice(match[0].length).trim();
      pending = body ? null : timing;
    } else if (pending && body) {
      timing = pending;
      pending = null;
    }
    return { id: index + 1, body, ...timing };
  });
  return {
    lines,
    annotated: lines.map((line) => `[L${line.id}]${line.startMs === null ? "" : ` [startMs=${line.startMs}${line.durationMs === null ? "" : ` durationMs=${line.durationMs}`}]`} ${line.body}`).join("\n")
  };
}

type TimedDraft = { acts: Array<{ scenes: Array<{
  lines: Array<{ text: string; sourceLine?: number | null; startMs: number | null; durationMs: number | null }>;
  cues: Array<{ sourceLine?: number | null; startMs: number | null; seconds: number | null }>;
}> }> };
const comparable = (text: string) => text.replace(/\s+/g, " ").trim();

/** Never trust a model's guessed start time over the uploaded source. */
export function bindSourceTimes(draft: TimedDraft, source: SourceLine[], requiredLineIds?: Set<number>) {
  const scoped = source.filter((line) => !requiredLineIds || requiredLineIds.has(line.id));
  const byId = new Map(scoped.map((line) => [line.id, line]));
  const used = new Set<number>();
  for (const act of draft.acts) for (const scene of act.scenes) {
    for (const line of scene.lines) {
      const text = comparable(line.text);
      let original = line.sourceLine ? byId.get(line.sourceLine) : undefined;
      if (!original || !comparable(original.body).includes(text)) {
        const candidates = scoped.filter((item) => item.body && comparable(item.body).includes(text));
        original = candidates.length === 1 ? candidates[0] : undefined;
      }
      if (!original || !text) throw new Error("원문과 연결되지 않는 대사가 있습니다. 초안을 다시 분석해 주세요");
      if (used.has(original.id)) throw new Error(`원문 ${original.id}행이 중복되었습니다. 한 행을 여러 대사로 나누지 않고 다시 분석해 주세요`);
      line.sourceLine = original.id;
      line.startMs = original.startMs;
      line.durationMs = original.durationMs;
      used.add(original.id);
    }
    for (const cue of scene.cues) {
      const original = cue.sourceLine ? byId.get(cue.sourceLine) : undefined;
      if (cue.sourceLine && !original) throw new Error("큐가 현재 분석 범위를 벗어난 원문을 참조합니다");
      cue.startMs = original?.startMs ?? null;
      if (original?.durationMs != null) {
        cue.seconds = Math.ceil(original.durationMs / 1000);
        if (cue.seconds > 3600) throw new Error("큐 한 개의 길이는 1시간 이내로 나누어 주세요");
      }
    }
  }
  // A cue summary is not a substitute for the source dialogue or stage direction.
  const missing = scoped.filter((line) => line.body && !used.has(line.id));
  if (missing.length) throw new Error(`원문 ${missing[0].id}행이 대본에서 누락되었습니다. 시간표시 유무와 관계없이 원문을 보존하여 다시 분석해 주세요`);
}
