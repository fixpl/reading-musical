import { BadRequestException } from "@nestjs/common";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertPublishable, LEGAL_KINDS } from "./site-policy";

const migration = readFileSync(resolve(__dirname, "../../prisma/migrations/20261012000000_site_initial_policies/migration.sql"), "utf8");
const consent = { kind: "SIGNUP_PRIVACY", body: "검토한 안내", purpose: "회원 식별", items: "이메일", retention: "목적 달성 시까지", refusal: "동의를 거부할 수 있습니다." };

describe("initial site policy data", () => {
  it("provides one template for every currently supported document kind", () => {
    const rows = [...migration.matchAll(/\('7be11a9d-[^']+', '([^']+)'/g)].map((match) => match[1]);
    expect(rows.sort()).toEqual([...LEGAL_KINDS].sort());
    expect(new Set(rows).size).toBe(rows.length);
  });
  it("keeps operator settings and existing documents instead of overwriting them", () => {
    expect(migration).toContain('ON CONFLICT ("key") DO NOTHING');
    expect(migration).toContain('WHERE NOT EXISTS (SELECT 1 FROM "legal_documents" existing WHERE existing.kind = t.kind)');
    expect(migration).not.toMatch(/UPDATE\s+"?(?:users|consent_events|legal_documents|system_settings)"?\s/i);
  });
  it("creates only drafts, inside an atomic migration", () => {
    expect(migration).toContain("CURRENT_TIMESTAMP, NULL, 'system:site-bootstrap'");
    expect(migration).toContain("BEGIN;");
    expect(migration.trim().endsWith("COMMIT;")).toBe(true);
  });
  it("does not publish a starter document with its review marker intact", () => {
    expect(() => assertPublishable({ ...consent, body: "[검토용 기본안]\n안내 내용" })).toThrow(BadRequestException);
  });
  it("does not publish unresolved operator details in a disclosure field", () => {
    expect(() => assertPublishable({ ...consent, retention: "[운영자 확인: 보관기간]" })).toThrow(BadRequestException);
    expect(() => assertPublishable({ ...consent, body: "운영자: {{company}}" })).toThrow(BadRequestException);
  });
  it("allows complete reviewed documents without requiring a specific template", () => {
    expect(() => assertPublishable(consent)).not.toThrow();
  });
});

describe("compact consent UI contracts", () => {
  const component = readFileSync(resolve(__dirname, "../../../frontend/src/lib/components/site/PolicyConsent.svelte"), "utf8");
  const viewer = readFileSync(resolve(__dirname, "../../../frontend/src/lib/components/site/PolicyViewer.svelte"), "utf8");
  const signup = readFileSync(resolve(__dirname, "../../../frontend/src/routes/register/+page.svelte"), "utf8");
  it("keeps each consent a compact row rather than an initially expanded document", () => {
    expect(component).toContain("data-consent-row");
    expect(component).toContain("<PolicyViewer {doc}");
    expect(component).not.toContain("<details");
    expect(component).not.toContain("open={required}");
    expect(signup).toContain("let requiredOpen = $state(false)");
    expect(signup).toContain("let optionalOpen = $state(false)");
    expect(signup).toContain('aria-controls="required-agreement-details"');
    expect(signup).toContain('aria-controls="optional-agreement-details"');
    expect(signup).toContain("{#if requiredOpen}");
    expect(signup).toContain("{#if optionalOpen}");
  });
  it("uses an accessible modal and loads the exact document revision", () => {
    expect(viewer).toContain("<Dialog.Root bind:open>");
    expect(viewer).toContain("<Dialog.Title");
    expect(viewer).toContain("<Dialog.Description");
    expect(viewer).toContain("id=${encodeURIComponent(selected.id)}");
    expect(viewer).toContain("result.document.id !== selected.id");
  });
  it("required all-selection never includes optional marketing consent", () => {
    const action = signup.slice(signup.indexOf("function setRequired"), signup.indexOf('let policyFingerprint'));
    expect(action).toContain("terms = privacy = age14");
    expect(action).not.toContain("marketing =");
    expect(action).not.toContain("optionalProfile =");
    expect(signup).toContain("indeterminate={requiredCount > 0 && requiredCount < 3}");
  });
  it("aligns optional contact and profile controls without a stretching inline explanation", () => {
    const fields = signup.slice(signup.indexOf('data-registration-profile-fields'), signup.indexOf('<Label for="password">'));
    expect(fields.match(/class="flex h-7 items-center gap-1"/g)).toHaveLength(3);
    expect(fields).toContain('<Label for="profile-type">');
    expect(fields).toContain('id="phone" class="h-10 w-full"');
    expect(fields).toContain('class="h-10 w-full data-[size=default]:h-10"');
    expect(fields).toContain('aria-describedby="phone-help-description"');
    expect(fields).toContain('aria-describedby="profile-type-help-description"');
    expect(fields).not.toContain('<p class=');
  });
  it("keeps the consent group free of horizontal separator lines", () => {
    const area = signup.slice(signup.lastIndexOf('<fieldset'), signup.lastIndexOf('</fieldset>'));
    expect(area).toContain('border-0');
    expect(area).not.toMatch(/border-t|border-b|divide-y|<hr/);
    expect(area).toContain('aria-expanded={requiredOpen}');
    expect(area).toContain('aria-expanded={optionalOpen}');
  });
  it("offers keyboard and touch help without submitting the registration form", () => {
    const help = readFileSync(resolve(__dirname, "../../../frontend/src/lib/components/site/FieldHelp.svelte"), "utf8");
    expect(help).toContain('<Popover.Trigger');
    expect(help).toContain('type="button"');
    expect(help).toContain('aria-label={`${title} 도움말`}');
    expect(help).toContain('id={`${id}-description`}');
    expect(help).toContain('<Popover.Content');
    expect(help).toContain('<Popover.Close');
    expect(help).toContain('sideOffset={6}');
    expect(help).toContain('collisionPadding={12}');
    expect(help).toContain('trapFocus={false}');
    expect(help).toContain('preventScroll={false}');
    expect(help).not.toContain('Dialog');
    expect(help).not.toContain('Overlay');
    expect(help).not.toContain('type="submit"');
  });
  it("uses one server-provided registration catalog for input readiness and submitted versions", () => {
    expect(signup).not.toContain('registrationMode');
    expect(signup).toContain('site?.registration?.policies');
    expect(signup).toContain('site?.registration?.ready.signup');
    expect(signup).not.toContain('mode: registrationMode');
    expect(signup).toContain('disabled={submitting || !contactReady}');
    expect(component).toContain('!doc.publishedAt');
  });
  it("never renders implementation notes or internal policy revision labels to members", () => {
    const legalPage = readFileSync(resolve(__dirname, "../../../frontend/src/routes/legal/[kind]/+page.svelte"), "utf8");
    const historyPage = readFileSync(resolve(__dirname, "../../../frontend/src/routes/app/privacy/+page.svelte"), "utf8");
    const forgotPage = readFileSync(resolve(__dirname, "../../../frontend/src/routes/forgot/+page.svelte"), "utf8");
    for (const source of [signup, viewer, legalPage, historyPage, forgotPage]) {
      expect(source).not.toMatch(/개발용|테스트 정보|기본안|정식 공개 전|운영자 확인|v\{[^}]*version|버전 \{/);
    }
    expect(viewer).not.toContain('doc.version');
    expect(legalPage).not.toContain('doc.version');
    expect(historyPage).not.toContain('v{event.document.version}');
    expect(forgotPage).not.toContain('devResetUrl');
  });
  it("does not make viewing or closing a document imply consent", () => {
    expect(viewer).not.toContain("bind:checked");
    expect(viewer).not.toMatch(/checked\s*=\s*true/);
    expect(component).toContain("checked = $bindable(false)");
    expect(signup).not.toContain("agreements: { terms: true");
  });
});
