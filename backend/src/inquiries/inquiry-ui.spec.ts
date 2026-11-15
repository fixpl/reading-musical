import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
const read = (path: string) => readFileSync(resolve(__dirname, "../../../frontend/src", path), "utf8");
describe("inquiry UI wiring (not a live mail or DB test)", () => {
  const lookup = read("routes/inquiries/lookup/+page.svelte");
  const detail = read("routes/admin/inquiries/[id]/+page.svelte");
  const production = read("routes/admin/productions/+page.svelte");
  it("keeps lookup credentials scoped and out of persistent browser storage", () => {
    // 네트워크 정책이 중앙 Client로 이동했으므로 실제 호출 경로의 두 모듈을 함께 검사한다.
    const client = ts.createSourceFile("client.ts", read("lib/api/client.ts"), ts.ScriptTarget.ES2022, true);
    const anonymousPost = client.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "anonymousJsonPost");
    if (!anonymousPost) throw new Error("익명 POST 경계 함수가 없다");
    const lookupApi = read("lib/api/inquiries.ts");
    expect(lookupApi).toContain("anonymousJsonPost(");
    const api = `${lookupApi}\n${anonymousPost.getText(client)}`;
    expect(api).toContain('credentials: "omit"'); expect(api).toContain('method: "POST"');
    expect(api).not.toContain("getAccessToken");
    for (const source of [api, lookup]) { expect(source).not.toMatch(/(?:localStorage|sessionStorage)\s*\.\s*(?:setItem|getItem|removeItem)\s*\(/); expect(source).not.toContain("?accessToken="); }
    expect(lookup).toContain('inquiryLookup<ApplicantInquiry>("detail", { accessToken })');
  });
  it("shows the receipt number with a direct path to applicant lookup", () => {
    const form = read("lib/components/landing/InquiryForm.svelte");
    expect(form).toContain('receipt = await apiRequest'); expect(form).toContain('/inquiries/lookup?id=${encodeURIComponent(receipt.id)}');
    expect(form).toContain('sourcePage: $page.url.pathname');
  });
  it("passes the six-digit verification pattern to Svelte as a single string", () => {
    expect(lookup).toMatch(/id="inquiry-code"[^>]*pattern=\{"\[0-9\]\{6\}"\}/);
  });
  it("separates applicant-visible replies from internal notes and includes revision checks", () => {
    expect(detail).toContain('value="conversation"'); expect(detail).toContain('value="internal"'); expect(detail).toContain('value="production"');
    expect(detail).toContain('신청자에게 공개할 답변'); expect(detail).toContain('신청자에게 비공개');
    expect(detail).toContain('revision: inquiry.revision'); expect(detail).toContain('/reply`');
  });
  it("provides both new and existing production connection paths", () => {
    expect(detail).toContain('existing ? "link" : "convert"');
    expect(detail).toContain('inquiry.production.deletedAt');
    expect(production).toContain('/admin/inquiries?productionId=${production.id}');
  });
  it("inspects related people and data before the existing reversible action", () => {
    expect(production).toContain('/deletion-impact`'); expect(production).toContain('participantsConfirmed');
    expect(production).toContain('impact.liveSessions > 0'); expect(production).toContain('inspectProduction(item, true)');
    expect(production).not.toContain('/purge`');
  });
});
