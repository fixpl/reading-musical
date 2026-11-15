import { PlatformRole } from "@prisma/client";
import { AdminOpsService } from "../admin/admin-ops.service";
import { AiService } from "./ai.service";

const admin = { id: "admin", email: "admin@example.com", name: "관리자", platformRole: PlatformRole.SUPER_ADMIN };
const dialogue = "연습을 시작하기 전에 창문을 열어 주세요. 첫 장면에서 필요한 소품은 창가의 의자 위에 놓여 있어요.";
const lighting = "객석을 어둡게 하고 무대 중앙의 조명을 켠다.";
const script = [
  "1막",
  "장면 1. 연습실",
  "00:00:10.250 --> 00:00:14.750",
  `유리: ${dialogue}`,
  `[00:00:15.000 --> 00:00:17.000] 조명: ${lighting}`
].join("\n");
const providerDraft = {
  acts: [{ title: "1막", scenes: [{ title: "연습실", lines: [
    { sourceLine: 4, kind: "대사", speaker: "유리", text: dialogue, startMs: 5_000, durationMs: 3_000 },
    { sourceLine: 5, kind: "지문", text: lighting }
  ], cues: [{ sourceLine: 5, track: "조명", content: lighting, startMs: 8_000, seconds: 6 }] }] }]
};

const exaoneEnv = {
  LLM_BASE_URL: "https://api.exaone.ai/v1",
  LLM_MODEL: "k-exaone_v2.5",
  LLM_API_KEY: "synthetic-exaone-key",
  LLM_EXTRA_BODY_JSON: '{"reasoning_effort":"low"}',
  LLM_SEED: "42"
};

describe("AiService provider requests", () => {
  afterEach(() => jest.restoreAllMocks());

  function mockCompletion() {
    return jest.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(providerDraft) } }]
    }));
  }

  test("EXAONE uses the shared LLM key, omits seed, and restores script and cue timecodes", async () => {
    jest.replaceProperty(process, "env", exaoneEnv);
    const fetch = mockCompletion();

    const result = await new AiService({} as never).generateCueDraft("production", { text: script }, admin);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, request] = fetch.mock.calls[0];
    expect(String(url)).toBe("https://api.exaone.ai/v1/chat/completions");
    expect(new Headers(request?.headers).get("authorization")).toBe("Bearer synthetic-exaone-key");
    const body = JSON.parse(String(request?.body));
    expect(body).toMatchObject({ model: "k-exaone_v2.5", reasoning_effort: "low" });
    expect(body).not.toHaveProperty("seed");
    expect(body).not.toHaveProperty("response_format");

    expect(result.model).toBe("k-exaone_v2.5");
    const scene = result.draft.acts[0].scenes[0];
    expect(scene.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceLine: 4, startMs: 10_250, durationMs: 4_500 }),
      expect.objectContaining({ sourceLine: 5, startMs: 15_000, durationMs: 2_000 })
    ]));
    expect(scene.cues).toEqual([expect.objectContaining({ sourceLine: 5, startMs: 15_000, seconds: 2 })]);
  });

  test("both EXAONE status checks leave an in-flight script request alone", async () => {
    jest.replaceProperty(process, "env", exaoneEnv);
    let respond!: (response: Response) => void;
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const reply = new Promise<Response>((resolve) => { respond = resolve; });
    const fetch = mockCompletion().mockImplementationOnce(() => {
      signalStarted();
      return reply;
    });
    const service = new AiService({} as never);
    const adminOps = new AdminOpsService({ $queryRaw: jest.fn().mockResolvedValue([]) } as never);
    const draft = service.generateCueDraft("production", { text: script }, admin);
    await started;
    try {
      expect(await service.status("production", admin)).toMatchObject({ available: false, reason: expect.stringContaining("진행 중") });
      expect(await adminOps.health(true)).toMatchObject({ ai: { configured: true, ok: false, error: expect.stringContaining("진행 중") } });
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      respond(Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(providerDraft) } }] }));
      await draft;
    }
  });

  test("NVIDIA still sends its configured seed", async () => {
    jest.replaceProperty(process, "env", { NVIDIA_API_KEY: "synthetic-nvidia-key", LLM_SEED: "123" });
    const fetch = mockCompletion();

    await new AiService({} as never).generateCueDraft("production", { text: script }, admin);

    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({ seed: 123 });
  });

  test("Terra uses native OpenAI request options and preserves the source timecodes", async () => {
    jest.replaceProperty(process, "env", {
      LLM_BASE_URL: "https://api.openai.com/v1",
      LLM_MODEL: "gpt-6.1-terra",
      LLM_API_KEY: "synthetic-openai-key",
      LLM_EXTRA_BODY_JSON: '{"reasoning_effort":"low"}',
      LLM_JSON_MODE: "true"
    });
    const fetch = mockCompletion();

    const result = await new AiService({} as never).generateCueDraft("production", { text: script }, admin);

    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe("https://api.openai.com/v1/chat/completions");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      model: "gpt-6.1-terra", max_completion_tokens: 16_384, store: false,
      reasoning_effort: "low", response_format: { type: "json_object" }
    });
    for (const field of ["max_tokens", "seed", "temperature", "top_p"]) expect(body).not.toHaveProperty(field);
    expect(result.draft.acts[0].scenes[0].lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceLine: 4, startMs: 10_250, durationMs: 4_500 })
    ]));
  });
});
