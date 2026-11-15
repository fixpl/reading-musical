import { setTimeout as sleep } from "node:timers/promises";
import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import type { readLlmSettings } from "./ai-contract";

type LlmSettings = ReturnType<typeof readLlmSettings>;
type RequestOptions = { timeout?: number; maxRetries?: number; signal?: AbortSignal; skipIfBusy?: boolean };

// All EXAONE consumers in this process share the configured provider key.
const EXAONE_INTERVAL_MS = 1_000;
let exaoneTail = Promise.resolve();
let exaonePending = 0;
let exaoneNextStart = 0;

export class LlmBusyError extends Error {
  constructor(message = "AI 요청이 진행 중입니다. 완료 후 연결 상태를 확인해 주세요.") {
    super(message);
  }
}

function enqueueExaone<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  exaonePending += 1;
  const request = exaoneTail.then(() => { signal?.throwIfAborted(); return work(); });
  const settled = () => { exaonePending -= 1; };
  exaoneTail = request.then(settled, settled);
  if (!signal) return request;

  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    void request.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function retryAfterMs(headers: Headers | undefined, attempt: number): number {
  const milliseconds = headers?.get("retry-after-ms")?.trim();
  if (milliseconds && /^\d+(?:\.\d+)?$/.test(milliseconds) && Number.isFinite(Number(milliseconds))) {
    return Math.ceil(Number(milliseconds));
  }
  const value = headers?.get("retry-after")?.trim();
  if (value) {
    const delay = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
    if (Number.isFinite(delay)) return Math.max(0, Math.ceil(delay));
  }
  return 3_000 * 2 ** attempt;
}

export async function requestChatCompletion(settings: LlmSettings, input: ChatCompletionCreateParamsNonStreaming, options: RequestOptions = {}) {
  const { timeout = settings.timeout, maxRetries = settings.maxRetries, signal, skipIfBusy } = options;
  if (settings.isExaone && skipIfBusy && exaonePending > 0) throw new LlmBusyError();
  const client = new OpenAI({
    apiKey: settings.apiKey, baseURL: settings.baseURL, timeout, maxRetries: settings.isExaone ? 0 : maxRetries
  });
  if (settings.isOpenAiTerra) {
    const { max_tokens, temperature: _temperature, top_p: _topP, seed: _seed, ...request } = input;
    return client.chat.completions.create({
      ...request, max_completion_tokens: max_tokens ?? request.max_completion_tokens, store: false
    }, { signal });
  }
  if (!settings.isExaone) return client.chat.completions.create(input, { signal });

  return enqueueExaone(async () => {
    const deadline = performance.now() + timeout;
    const timeoutSignal = AbortSignal.timeout(timeout);
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    try {
      for (let attempt = 0; ; attempt += 1) {
        if (exaoneNextStart >= deadline) throw new LlmBusyError("EXAONE이 대기 중입니다. 잠시 후 다시 시도해 주세요.");
        const wait = exaoneNextStart - performance.now();
        if (wait > 0) await sleep(Math.ceil(wait), undefined, { signal: requestSignal });
        requestSignal.throwIfAborted();
        exaoneNextStart = performance.now() + EXAONE_INTERVAL_MS;
        try {
          return await client.chat.completions.create(input, { signal: requestSignal });
        } catch (error) {
          // A transport timeout can leave an accepted inference running at the provider.
          if (!(error instanceof OpenAI.APIError) || error.status !== 429) throw error;
          exaoneNextStart = Math.max(exaoneNextStart, performance.now() + retryAfterMs(error.headers, attempt));
          if (attempt >= maxRetries || exaoneNextStart >= deadline || error.headers?.get("x-day-rate-limit-remaining") === "0") throw error;
        }
      }
    } catch (error) {
      signal?.throwIfAborted();
      if (timeoutSignal.aborted) throw new OpenAI.APIConnectionTimeoutError();
      throw error;
    }
  }, signal);
}

export function probeLlmConnection(settings: LlmSettings) {
  const reasoningModel = settings.isExaone || settings.isOpenAiTerra;
  return requestChatCompletion(settings, {
    ...settings.extra, model: settings.model, messages: [{ role: "user", content: reasoningModel ? "Reply OK." : "ok" }],
    max_tokens: reasoningModel ? 128 : 1, stream: false
  }, { timeout: 25_000, maxRetries: 0, skipIfBusy: true });
}

export function llmRateLimitMessage(error: unknown): string | undefined {
  if (!(error instanceof OpenAI.APIError) || error.status !== 429) return;
  return /concurren|in.flight|동시/i.test(error.message)
    ? "AI 공급자가 동시 요청 한도에 도달했습니다 (429). 잠시 후 다시 시도해 주세요."
    : "AI 공급자의 호출 한도에 도달했습니다 (429). 잠시 후 다시 시도해 주세요.";
}

export function llmConnectionIssue(error: unknown): string | undefined {
  if (error instanceof LlmBusyError) return error.message;
  if (!(error instanceof OpenAI.APIError)) return;
  if (error.status === 401) return "AI 공급자가 API 키를 거부했습니다. 백엔드의 LLM_API_KEY를 확인해 주세요.";
  if (error.status === 403 || error.status === 404) return "설정된 AI 모델에 접근할 수 없습니다. 모델 ID와 프로젝트 권한을 확인해 주세요.";
  return llmRateLimitMessage(error);
}
