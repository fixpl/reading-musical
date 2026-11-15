import { runResponses, type AgentTool } from "./responses-harness";

const textSchema = { type: "object", required: ["answer"], additionalProperties: false, properties: { answer: { type: "string" } } };
const parse = (output: string) => (JSON.parse(output) as { answer: string }).answer;
const toolCall = (id: string, args = '{"cueId":"C1"}', name = "find_candidate") => ({
  type: "function_call", id, call_id: id, name, arguments: args, status: "completed"
});
const answer = { type: "message", id: "msg_1", role: "assistant", status: "completed", content: [
  { type: "output_text", text: '{"answer":"found"}', annotations: [] }
] };

function mockResponses(...items: unknown[]) {
  const requests: Array<{ instructions: string; input: Array<Record<string, unknown>>; tools: unknown[]; store: boolean; tool_choice: unknown }> = [];
  const fetch = jest.spyOn(globalThis, "fetch").mockImplementation(async (url, options) => {
    expect(String(url)).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse(String(options?.body));
    requests.push(body);
    return Response.json({ object: "response", id: "resp_test", status: "completed", model: "gpt-6.1-terra", output: [items[requests.length - 1]] });
  });
  return { fetch, requests };
}

function testTool() {
  return {
    name: "find_candidate", description: "Look up a synthetic scene",
    properties: { cueId: { type: "string", description: "Cue ID", maxLength: 8 } },
    execute: jest.fn(() => ({ scene: "S1" }))
  } satisfies AgentTool;
}

describe("Terra Responses harness", () => {
  beforeEach(() => jest.replaceProperty(process, "env", {
    LLM_BASE_URL: "https://api.openai.com/v1", LLM_MODEL: "gpt-6.1-terra", LLM_API_KEY: "synthetic"
  }));
  afterEach(() => jest.restoreAllMocks());

  test("loads a shipped skill and returns the local tool result to Terra in the next turn", async () => {
    const { requests } = mockResponses(toolCall("call_1"), answer);
    const tool = testTool();
    const result = await runResponses({
      skill: "cue-sheet-match", input: { cues: [] }, tools: [tool], firstTool: tool.name, parse, schema: textSchema
    });
    expect(result).toMatchObject({ value: "found", run: { model: "gpt-6.1-terra", calls: ["find_candidate"] } });
    expect(tool.execute).toHaveBeenCalledWith({ cueId: "C1" }, expect.any(AbortSignal));
    expect(requests[0]).toMatchObject({ store: false, tool_choice: { type: "function", name: "find_candidate" } });
    expect(requests[0].instructions).toContain("find_scene_candidates");
    expect(requests[1].input).toContainEqual({ type: "function_call_output", call_id: "call_1", output: '{"scene":"S1"}' });
  });

  test("rejects extra arguments, skips duplicate work, and withdraws tools on the last turn", async () => {
    const { requests } = mockResponses(toolCall("call_1", '{"cueId":"C1","file":"another-show"}'), toolCall("call_2"), toolCall("call_3"), answer);
    const tool = testTool();
    await runResponses({ skill: "cue-sheet-match", input: {}, tools: [tool], parse, schema: textSchema });
    expect(tool.execute).toHaveBeenCalledTimes(1);
    expect(requests.at(-1)?.tools).toEqual([]);
    expect(requests.at(-1)?.input).toEqual(expect.arrayContaining([
      expect.objectContaining({ call_id: "call_1", output: '{"error":"invalid_arguments"}' }),
      expect.objectContaining({ call_id: "call_3", output: '{"error":"duplicate_call"}' })
    ]));
  });

  test("stops before executing a tool outside the run's allowed list", async () => {
    mockResponses(toolCall("call_1", "{}", "publish_production"));
    const tool = testTool();
    await expect(runResponses({ skill: "production-operations", input: {}, tools: [tool], parse, schema: textSchema })).rejects.toThrow("AI 확인을 마치지 못했어요");
    expect(tool.execute).not.toHaveBeenCalled();
  });
});
