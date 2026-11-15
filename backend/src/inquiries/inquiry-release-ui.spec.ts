import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const read = (path: string) => readFileSync(resolve(__dirname, "../../../frontend/src", path), "utf8");
describe("release inquiry UI safety contracts", () => {
  const lookup = read("routes/inquiries/lookup/+page.svelte");
  it("clears private session data after expiry and guards late responses", () => {
    expect(lookup).toContain("if (expired) { clearSession()");
    expect(lookup).toContain('accessToken = ""; inquiry = null; challengeId = ""; code = ""; message = ""; sessionExpiresAt = 0;');
    expect(lookup).toContain("!destroyed && value === sequence");
    expect(lookup).toContain("if (!isCurrent(current)) return;");
  });
  it("keeps a successful one-time-code verification usable if loading the detail fails", () => {
    expect(lookup).toContain('accessToken = result.accessToken; sessionExpiresAt = Date.parse(result.sessionExpiresAt); challengeId = ""; code = "";');
    expect(lookup).toContain("신청 내용 다시 불러오기");
    expect(lookup).toContain("error.status === 401 && accessToken) clearSession()");
  });
  it("preserves a challenge after a code typo without clearing a valid authenticated session on network failure", () => {
    const method = lookup.slice(lookup.indexOf("function handle(error:"), lookup.indexOf("async function send("));
    expect(method).toContain("error.status === 401 && accessToken");
    expect(method).not.toContain('challengeId = ""');
  });
  it("prevents changing the identifier while an authentication request is running", () => {
    expect(lookup).toContain('disabled={busy || Boolean(accessToken)} oninput={identityChanged}');
  });
  it("shows mail readiness only inside administrator inquiries", () => {
    expect(read("routes/admin/inquiries/+page.svelte")).toContain("<MailReadiness />");
    expect(read("lib/components/admin/MailReadiness.svelte")).toContain("/admin/mail/readiness");
    expect(lookup).not.toContain("/admin/mail/readiness");
  });
});
