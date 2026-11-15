import OpenAI from "openai";
import { readLlmSettings } from "./ai-contract";
import { requestChatCompletion } from "./llm-request";

const settings = readLlmSettings({
  LLM_BASE_URL: "https://api.exaone.ai/v1", LLM_MODEL: "k-exaone_v2.5", LLM_API_KEY: "synthetic-key"
});
const request = (text: string) => ({ model: settings.model, messages: [{ role: "user" as const, content: text }], stream: false as const });
const success = () => Response.json({ choices: [{ finish_reason: "stop", message: { content: "OK" } }] });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

afterEach(() => jest.restoreAllMocks());

test("queues EXAONE requests until the active request finishes and skips a cancelled waiter", async () => {
  const started = deferred<void>();
  const reply = deferred<Response>();
  const fetch = jest.spyOn(globalThis, "fetch").mockImplementationOnce(() => {
    started.resolve();
    return reply.promise;
  }).mockImplementation(async () => success());
  const first = requestChatCompletion(settings, request("first"));
  await started.promise;
  const abort = new AbortController();
  const cancelled = requestChatCompletion(settings, request("cancelled"), { signal: abort.signal });
  const next = requestChatCompletion(settings, request("next"));
  try {
    abort.abort();
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    reply.resolve(success());
    await Promise.all([first, next]);
  }
  const sent = fetch.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).messages[0].content);
  expect(sent).toEqual(["first", "next"]);
});

test("waits for the provider Retry-After before retrying a rejected EXAONE request", async () => {
  const starts: number[] = [];
  const fetch = jest.spyOn(globalThis, "fetch").mockImplementation(async () => {
    starts.push(performance.now());
    return starts.length === 1
      ? Response.json({ result_code: "rate_limit_exceeded", description: "service is busy, too many concurrent requests" }, {
        status: 429, headers: { "retry-after-ms": "1300" }
      })
      : success();
  });
  await requestChatCompletion(settings, request("retry"));
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(1_290);
});

test("does not resubmit when EXAONE may already have accepted a request", async () => {
  const fetch = jest.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("connection lost"));
  await expect(requestChatCompletion(settings, request("uncertain delivery"))).rejects.toBeInstanceOf(OpenAI.APIConnectionError);
  expect(fetch).toHaveBeenCalledTimes(1);
});
