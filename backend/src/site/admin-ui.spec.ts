import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { categoryDraft, questionDraft, applySavedCategory, applySavedQuestion, sortFaq, validOrder } from "../../../frontend/src/lib/domain/admin-faq";
import { ADMIN_SITE_LINKS, isAdminPath, settingsTab, settingsTabHref } from "../../../frontend/src/lib/domain/admin-navigation";
import { safeLoginReturn } from "../../../frontend/src/lib/domain/login-return";
import type { FaqCategory, FaqQuestion } from "../../../frontend/src/lib/api/site";

const question: FaqQuestion = { id: "question-a", categoryId: "category-a", title: "질문 제목", body: "답변 원문", order: 20, active: true, revision: 4 };
const categories: FaqCategory[] = [
  { id: "category-a", name: "가입", order: 10, active: true, revision: 2, questions: [question] },
  { id: "category-b", name: "연습", order: 20, active: false, revision: 3, questions: [] }
];

describe("FAQ editor data behavior", () => {
  it("loads an independent complete draft with the server revision", () => {
    const draft = questionDraft(question); expect(draft).toEqual(question);
    draft.title = "변경 중"; draft.active = false;
    expect(question.title).toBe("질문 제목"); expect(question.active).toBe(true); expect(draft.revision).toBe(4);
  });
  it("loads category settings without attaching the question list to the draft", () => {
    const draft = categoryDraft(categories[0]); expect(draft.name).toBe("가입"); expect(draft.revision).toBe(2);
    expect(draft).not.toHaveProperty("questions");
    draft.name = "다른 이름"; expect(categories[0].name).toBe("가입");
  });
  it("creates empty drafts with the selected category, not a previous edit id", () => {
    const draft = questionDraft(undefined, "category-b"); expect(draft).toEqual({ id: "", categoryId: "category-b", title: "", body: "", active: true, order: 10, revision: 1 });
    expect(categoryDraft().id).toBe("");
  });
  it("uses saved server values and revision in the list", () => {
    const saved = { ...question, title: "저장된 제목", body: "저장된 답변", revision: 5 };
    const result = applySavedQuestion(categories, saved);
    expect(result[0].questions).toEqual([saved]); expect(categories[0].questions[0]).toEqual(question);
  });
  it("moves a saved question between categories without leaving a duplicate", () => {
    const saved = { ...question, categoryId: "category-b", revision: 5 };
    const result = applySavedQuestion(categories, saved);
    expect(result[0].questions).toHaveLength(0); expect(result[1].questions).toEqual([saved]);
    expect(result.flatMap((item) => item.questions)).toHaveLength(1);
  });
  it("adds a created question once, including a repeated server response", () => {
    const saved = { ...question, id: "created", order: 5 };
    const first = applySavedQuestion(categories, saved);
    const second = applySavedQuestion(first, saved);
    expect(second[0].questions.map((item) => item.id)).toEqual(["created", "question-a"]);
  });
  it("preserves child questions when category metadata is saved", () => {
    const { questions: _questions, ...saved } = categories[0];
    const result = applySavedCategory(categories, { ...saved, name: "회원 안내", revision: 3, active: false });
    expect(result[0].questions).toEqual([question]); expect(result[0].active).toBe(false); expect(result[0].revision).toBe(3);
    expect(categories[0].active).toBe(true);
  });
  it("sorts on a new array without mutating current data", () => {
    const input = [categories[1], categories[0]]; const result = sortFaq(input);
    expect(result[0].id).toBe("category-a"); expect(input[0].id).toBe("category-b");
  });
  it.each([undefined, null, "10", -1, 1.5, 100001, NaN])("rejects invalid order %s", (value) => { expect(validOrder(value)).toBe(false); });
  it("accepts the supported order bounds", () => { expect(validOrder(0)).toBe(true); expect(validOrder(100000)).toBe(true); });
});

describe("admin navigation", () => {
  it("defines three distinct page links, not fake tabs", () => {
    expect(ADMIN_SITE_LINKS.map((item) => item.href)).toEqual(["/admin/settings", "/admin/faq", "/admin/support"]);
  });
  it("matches route segments without prefix collisions", () => {
    expect(isAdminPath("/admin/faq", "/admin/faq")).toBe(true);
    expect(isAdminPath("/admin/members/abc", "/admin/members")).toBe(true);
    expect(isAdminPath("/admin/settings-old", "/admin/settings")).toBe(false);
    expect(isAdminPath("/admin/faq", "/admin", true)).toBe(false);
  });
  it("resolves settings tabs from a reloadable URL", () => {
    expect(settingsTab("?tab=policy")).toBe("policy"); expect(settingsTab("")).toBe("site");
    expect(settingsTab("?tab=unexpected")).toBe("site");
    expect(settingsTab(settingsTabHref("?other=1", "policy").split("?")[1])).toBe("policy");
    expect(settingsTabHref("?other=1", "policy")).toBe("/admin/settings?other=1&tab=policy");
  });
  it("preserves admin destinations through login without allowing external redirects", () => {
    expect(safeLoginReturn("/admin/settings?tab=policy")).toBe("/admin/settings?tab=policy");
    expect(safeLoginReturn("/admin/faq")).toBe("/admin/faq");
    for (const value of ["https://evil.invalid/admin", "//evil.invalid", "/admin-evil", "/admin/%2f%2fevil.invalid", "/admin/../../login"]) expect(safeLoginReturn(value)).toBeNull();
  });
});

const read = (path: string) => readFileSync(resolve(__dirname, "../../../frontend/src", path), "utf8");
describe("admin component wiring contracts (not a browser or DB save test)", () => {
  const faq = read("routes/admin/faq/+page.svelte");
  const settings = read("routes/admin/settings/+page.svelte");
  it("opens a dialog from each edit action rather than only changing an off-screen form", () => {
    expect(faq).toContain("openQuestion(entry, event.currentTarget)");
    expect(faq).toContain("openCategory(item, event.currentTarget)");
    expect(faq).toContain("returnFocus = trigger; editorOpen = true");
    expect(faq).toContain('<Dialog.Root bind:open={() => editorOpen,');
    expect(faq).toContain('id="faq-editor-form"');
    expect(faq).toContain('onOpenAutoFocus='); expect(faq).toContain('onCloseAutoFocus=');
  });
  it("places the submit control inside the dialog form and keeps revision-guarded saves", () => {
    const formStart = faq.indexOf('<form id="faq-editor-form"'); const saveButton = faq.indexOf('id="faq-editor-save"');
    expect(saveButton).toBeGreaterThan(formStart); expect(saveButton).toBeLessThan(faq.indexOf('</form>', formStart));
    expect(faq).toContain('method: id ? "PATCH" : "POST"'); expect(faq).toContain('...(id ? { revision } : {})');
    expect(faq).toContain('categories = applySavedQuestion(categories, saved)');
    expect(faq).toContain('conflict = Boolean('); expect(faq).toContain('!await confirmation.ask(');
  });
  it("separates navigation links from real tab triggers on all site-management pages", () => {
    for (const source of [faq, settings, read("routes/admin/support/+page.svelte")]) expect(source).toContain('<AdminSiteNav />');
    const nav = read("lib/components/admin/AdminSiteNav.svelte");
    expect(nav).toContain('href={item.href}'); expect(nav).toContain('aria-current='); expect(nav).not.toContain('role="tab"');
    expect(settings).toContain('<Tabs.Root bind:value={() => tab, changeTab}>');
    expect(settings).toContain('<Tabs.Content value="site"'); expect(settings).toContain('<Tabs.Content value="policy"');
    expect(settings).not.toContain('<Button href="/admin/faq"');
  });
  it("tracks custom select and switch edits by their data, not only bubbling input events", () => {
    expect(faq).toContain('const dirty = $derived(editorOpen && baseline !== currentDraft)');
    expect(faq).toContain('bind:checked={question.active}');
    expect(settings).toContain('JSON.stringify(info) !== siteBaseline');
    expect(settings).toContain('JSON.stringify(draft) !== policyBaseline');
    expect(settings).not.toContain('oninput={() =>');
  });
  it("keeps policy input intact if a document fetch fails", () => {
    const start = settings.indexOf('async function loadPolicy'); const end = settings.indexOf('async function useHistory');
    const method = settings.slice(start, end);
    expect(method.indexOf('fillDraft(')).toBeGreaterThan(method.indexOf('await apiRequest'));
    expect(method).toContain('sequence !== policySequence'); expect(method).not.toContain('draft = {');
  });
  it("uses non-destructive close defaults and explicit labels", () => {
    // 확인 창 본체는 ui/confirm-dialog로 옮겼고 admin/ConfirmAction은 얇은 래퍼다.
    expect(read("lib/components/admin/ConfirmAction.svelte")).toContain('$lib/components/ui/confirm-dialog');
    const confirm = read("lib/components/ui/confirm-dialog/confirm-dialog.svelte");
    expect(confirm).toContain('AlertDialog.Title'); expect(confirm).toContain('AlertDialog.Description');
    expect(confirm).toContain('settle(false)'); expect(confirm).toContain('resolve?.({ confirmed: false })');
    expect(confirm).toContain('<AlertDialog.Cancel'); expect(confirm).toContain('<AlertDialog.Action');
    expect(settings).toContain('bind:value={() => kind,');
    expect(faq).not.toContain('onOpenChange={(value) =>');
    expect(faq).toContain('Label for="faq-edit-title"'); expect(faq).toContain('Label for="faq-edit-category"');
    expect(settings).toContain('Label for="policy-kind"');
  });
  it("closes mobile navigation after successful navigation and respects exact active paths", () => {
    const sidebar = read("lib/components/admin/admin-sidebar.svelte");
    expect(sidebar).toContain('afterNavigate(() => { sidebar.setOpenMobile(false); })');
    expect(sidebar).toContain('isAdminPath($page.url.pathname, item.url, item.exact)');
    expect(sidebar).toContain('aria-current={active ? "page" : undefined}');
  });
});
