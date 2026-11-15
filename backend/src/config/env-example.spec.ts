import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { validateEnvironment } from "./env.validation";

// .env.example / .env.production.example 이 실제 코드와 어긋나지 않게 지키는 검사.
//  1) 예시 파일의 모든 변수는 코드가 실제로 읽는다(쓰지 않는 변수가 쌓이지 않게)
//  2) env.validation.ts 가 다루는 모든 변수는 예시에 적혀 있다(빠진 변수가 없게)
//  3) 운영 예시의 자리표시자만 바꾸면 운영 검증을 통과한다(예시 자체가 맞는 모양인지)
const root = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

// 주석 처리된 "# KEY=value" 줄도 문서화된 변수로 본다.
function documentedKeys(text: string): Map<string, string> {
  const keys = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*#?\s*([A-Z][A-Z0-9_]{2,})\s*=\s*(.*)$/);
    if (match) keys.set(match[1], match[2].replace(/\s+#.*$/, "").replace(/^"|"$/g, ""));
  }
  return keys;
}
function activeValues(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]+)\s*=\s*(.*)$/);
    if (match) values[match[1]] = match[2].replace(/\s+#.*$/, "").replace(/^"|"$/g, "");
  }
  return values;
}
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { if (!["node_modules", "dist"].includes(name)) sourceFiles(path, out); }
    else if (/\.(ts|cjs|mjs|js)$/.test(name) && !/\.spec\.ts$/.test(name)) out.push(path);
  }
  return out;
}

const example = read(".env.example");
const production = read(".env.production.example");
// Public, supplemental deployment settings. This does not load or override runtime secrets.
const mailDeployment: Record<string, string> = JSON.parse(read("mail-deployment.example.json"));
const codeText = [
  ...sourceFiles(join(root, "src")), ...sourceFiles(join(root, "scripts")), join(root, "prisma/seed.ts"), join(root, "railpack.json"), join(root, "Dockerfile"), join(root, "package.json"), join(root, "../scripts/local-dev.mjs")
].map((path) => readFileSync(path, "utf8")).join("\n");

// 코드 밖(개발 실행기·플랫폼)에서 쓰는 변수는 이름만 따로 허용한다.
const EXTERNAL = new Set(["DEV_ALLOW_REMOTE_DB", "PROCESS_ROLE", "HOST", "ADMIN_EMAIL", "ADMIN_PASSWORD", "ADMIN_NAME"]);

describe(".env examples", () => {
  const docs = new Map([...documentedKeys(example), ...Object.entries(mailDeployment)]);
  const prod = documentedKeys(production);

  test("every documented variable is read by the code", () => {
    const stale = [...new Set([...docs.keys(), ...prod.keys()])].filter((key) => !EXTERNAL.has(key) && !new RegExp(`(?<![A-Z0-9_])${key}(?![A-Z0-9_])`).test(codeText));
    expect(stale).toEqual([]);
  });

  test("every variable handled by env.validation is documented in the environment examples",  () => {
    const validation = read("src/config/env.validation.ts");
    const handled = new Set<string>();
    for (const match of validation.matchAll(/(?:config|next)\.([A-Z][A-Z0-9_]+)|\["([A-Z][A-Z0-9_]+)"/g)) handled.add(match[1] ?? match[2]);
    for (const match of validation.matchAll(/"((?:RATE_LIMIT|AUTH|MAIL|JWT|R2|ASSET|ATTENDANCE|SIGNED|UPLOAD)_[A-Z0-9_]+)"/g)) handled.add(match[1]);
    handled.delete("NODE_ENV");
    const missing = [...handled].filter((key) => !docs.has(key) && !/^R2_(BUCKET_NAME|ENDPOINT_URL)$/.test(key));
    expect(missing).toEqual([]);
  });

  test("the supplemental mail deployment example is paused and contains no live credentials", () => {
    expect(Object.values(mailDeployment).every((value) => typeof value === "string")).toBe(true);
    expect(mailDeployment.MAIL_TRANSPORT).toBe("resend");
    expect(mailDeployment.MAIL_SENDING_ENABLED).toBe("false");
    expect(mailDeployment.RESEND_API_KEY).toBe("");
    expect(mailDeployment.RESEND_FROM_EMAIL).toBe("");
    const env = { ...activeValues(example), ...mailDeployment };
    expect(() => validateEnvironment(env)).not.toThrow();
    expect(() => validateEnvironment({ ...env, MAIL_SENDING_ENABLED: "true" })).toThrow("RESEND_API_KEY");
  });

  test("development example passes validation as written", () => {
    expect(() => validateEnvironment(activeValues(example))).not.toThrow();
  });

  test("production example passes validation once placeholders are replaced", () => {
    const values = activeValues(production);
    const filled = {
      ...values,
      DATABASE_URL: "postgresql://app:pw@db.internal:5432/musical?schema=public",
      JWT_ACCESS_SECRET: "a".repeat(40),
      JWT_REFRESH_SECRET: "b".repeat(40),
      JWT_PASSWORD_RESET_SECRET: "c".repeat(40),
      RESEND_API_KEY: "re_" + "x".repeat(30),
      R2_ACCESS_KEY_ID: "k".repeat(32),
      R2_SECRET_ACCESS_KEY: "s".repeat(40)
    };
    expect(() => validateEnvironment(filled)).not.toThrow();
    // 자리표시자를 그대로 두면 운영 시작이 막혀야 한다.
    expect(() => validateEnvironment(values)).toThrow();
  });
});
