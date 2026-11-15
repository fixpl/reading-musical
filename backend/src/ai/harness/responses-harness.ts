import { createHash, randomUUID } from "node:crypto";
import { Logger, ServiceUnavailableException } from "@nestjs/common";
import OpenAI from "openai";
import type { FunctionTool, ResponseInput } from "openai/resources/responses/responses";
import { readLlmSettings } from "../ai-contract";
import { loadSkill, type Skill } from "./skill";

const logger = new Logger("ResponsesHarness");
type Settings = ReturnType<typeof readLlmSettings>;

type Property = { type: "string"; description: string; maxLength: number; enum?: readonly string[] };
export type AgentTool = {
  name: string;
  description: string;
  properties: Record<string, Property>;
  execute: (args: Record<string, string>, signal: AbortSignal) => Promise<unknown> | unknown;
};
export type AgentRun = { id: string; skill: Skill; calls: string[]; model: string };

function definition(tool: AgentTool): FunctionTool {
  return {
    type: "function", name: tool.name, description: tool.description, strict: true,
    parameters: {
      type: "object", properties: tool.properties,
      required: Object.keys(tool.properties), additionalProperties: false
    }
  };
}

function parseArgs(raw: string, tool: AgentTool): Record<string, string> | null {
  if (raw.length > 2_000) return null;
  let args: unknown;
  try { args = JSON.parse(raw); } catch { return null; }
  const properties = Object.entries(tool.properties);
  if (typeof args !== "object" || args === null || Array.isArray(args) ||
      Object.keys(args).length !== properties.length) return null;
  const values = args as Record<string, unknown>;
  for (const [key, property] of properties) {
    const value = values[key];
    if (!Object.hasOwn(values, key) || typeof value !== "string" || value.length > property.maxLength ||
        (property.enum && !property.enum.includes(value))) return null;
  }
  return values as Record<string, string>;
}

function terraSettings() {
  let settings: Settings;
  try { settings = readLlmSettings(process.env); }
  catch { throw new ServiceUnavailableException("서버의 Terra 연결 설정을 확인해 주세요."); }
  if (!settings.isOpenAiTerra) throw new ServiceUnavailableException("이 기능은 서버에 Terra를 연결하면 사용할 수 있어요.");
  return settings;
}

/** A request owns its context, tools, deadline and receipts. Results carry no authority to write. */
export async function runResponses<T>(options: {
  skill: Skill;
  input: unknown;
  tools: AgentTool[];
  firstTool?: string;
  schema: Record<string, unknown>;
  parse: (text: string) => T;
  signal?: AbortSignal;
}): Promise<{ value: T; run: AgentRun }> {
  const settings = terraSettings();
  const id = randomUUID();
  const calls: string[] = [];
  const receipts: Array<{ name: string; outcome: string; ms: number }> = [];
  const started = Date.now();
  const deadline = AbortSignal.timeout(Math.min(settings.timeout, 120_000));
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  const tools = new Map(options.tools.map(tool => [tool.name, tool]));
  const declared = options.tools.map(definition);
  const seen = new Set<string>();
  const callIds = new Set<string>();
  const input: ResponseInput = [{ role: "user", content: JSON.stringify(options.input) }];
  let exit = "failed";
  let sourceHash: string | undefined;
  let instructionHash: string | undefined;
  try {
    const skill = await loadSkill(options.skill);
    const instructions = `선택된 업무 스킬: ${options.skill}\n\n${skill.body}`;
    sourceHash = skill.sourceHash;
    instructionHash = createHash("sha256").update(instructions).digest("hex");
    const client = new OpenAI({ apiKey: settings.apiKey, baseURL: settings.baseURL, maxRetries: 0 });
    for (let turn = 0; turn <= 3; turn += 1) {
      signal.throwIfAborted();
      const finalTurn = turn === 3;
      const response = await client.responses.create({
        model: settings.model, instructions, input, store: false,
        reasoning: { effort: "low" }, include: ["reasoning.encrypted_content"],
        max_output_tokens: Math.min(settings.maxTokens, 6_000),
        tools: finalTurn ? [] : declared, parallel_tool_calls: false,
        ...(turn === 0 && options.firstTool ? { tool_choice: { type: "function" as const, name: options.firstTool } } : {}),
        text: { format: { type: "json_schema", name: "agent_result", strict: true, schema: options.schema } }
      }, { signal, timeout: Math.min(settings.timeout, 120_000) });
      signal.throwIfAborted();
      if (response.status !== "completed") { exit = "incomplete_response"; throw new Error(exit); }
      const requested = response.output.filter(item => item.type === "function_call");
      if (requested.length === 0) {
        exit = "invalid_final_output";
        const value = options.parse(response.output_text);
        exit = "completed";
        return { value, run: { id, skill: options.skill, calls, model: response.model } };
      }
      if (finalTurn || requested.length !== 1) { exit = "tool_limit"; throw new Error(exit); }
      const call = requested[0];
      const tool = tools.get(call.name);
      if (!tool || !call.call_id || callIds.has(call.call_id)) { exit = "invalid_tool_call"; throw new Error(exit); }
      callIds.add(call.call_id);
      for (const item of response.output) {
        if (item.type === "reasoning" || item.type === "function_call" || item.type === "message") input.push(item);
        else { exit = "unsupported_response_item"; throw new Error(exit); }
      }
      const args = parseArgs(call.arguments, tool);
      const fingerprint = args === null ? "" : JSON.stringify([tool.name, Object.entries(args).sort()]);
      const clock = Date.now();
      let outcome = "invalid_arguments";
      let output = JSON.stringify({ error: outcome });
      if (args && seen.has(fingerprint)) {
        outcome = "duplicate_call";
        output = JSON.stringify({ error: outcome });
      } else if (args) {
        seen.add(fingerprint);
        try {
          signal.throwIfAborted();
          const data = JSON.stringify(await tool.execute(args, signal)) ?? "null";
          outcome = data.length <= 18_000 ? "ok" : "result_limit";
          output = outcome === "ok" ? data : JSON.stringify({ error: outcome });
          if (outcome === "ok") calls.push(tool.name);
        } catch {
          signal.throwIfAborted();
          outcome = "tool_failed";
          output = JSON.stringify({ error: outcome });
        }
      }
      receipts.push({ name: tool.name, outcome, ms: Date.now() - clock });
      input.push({ type: "function_call_output", call_id: call.call_id, output });
    }
    throw new Error("turn limit");
  } catch (error) {
    if (options.signal?.aborted) { exit = "cancelled"; throw error; }
    if (deadline.aborted) { exit = "timeout"; throw new ServiceUnavailableException("AI 확인 시간이 길어졌어요. 잠시 후 다시 시도해 주세요."); }
    if (error instanceof ServiceUnavailableException) { exit = "skill_unavailable"; throw error; }
    if (error instanceof OpenAI.APIError) exit = `provider_${error.status ?? "connection"}`;
    throw new ServiceUnavailableException("AI 확인을 마치지 못했어요. 잠시 후 다시 시도해 주세요.");
  } finally {
    logger.log({ runId: id, model: settings.model, skill: options.skill, sourceHash, instructionHash, receipts, exit, ms: Date.now() - started });
  }
}
