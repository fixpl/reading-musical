import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ServiceUnavailableException } from "@nestjs/common";

const allowed = ["script-analysis", "cue-sheet-match", "production-operations"] as const;
export type Skill = typeof allowed[number];

export async function loadSkill(name: Skill) {
  try {
    if (!allowed.includes(name)) throw new Error("skill is not registered");
    const source = await readFile(join(__dirname, "skills", name, "SKILL.md"), "utf8");
    const header = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;
    if (!header.test(source)) throw new Error("skill metadata missing");
    const body = source.replace(header, "").trim();
    if (!body) throw new Error("skill is empty");
    return { body, sourceHash: createHash("sha256").update(source).digest("hex") };
  } catch {
    throw new ServiceUnavailableException("서버에서 AI 작업 지침을 읽지 못했어요. 관리자에게 알려 주세요.");
  }
}
