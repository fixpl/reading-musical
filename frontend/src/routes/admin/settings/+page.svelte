<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { page } from "$app/stores";
  import { beforeNavigate, goto, invalidate } from "$app/navigation";
  import { toast } from "svelte-sonner";
  import { settingsTab, settingsTabHref } from "$lib/domain/admin-navigation";
  import { apiRequest } from "$lib/api/client";
  import { POLICY_LABELS, koreanDate, type LegalDocument, type LegalKind, type PolicySummary, type SiteInfo, type PublicSite } from "$lib/api/site";
  import AdminSiteNav from "$lib/components/admin/AdminSiteNav.svelte";
  import ConfirmAction from "$lib/components/admin/ConfirmAction.svelte";
  import FieldHelp from "$lib/components/site/FieldHelp.svelte";
  import * as Tabs from "$lib/components/ui/tabs";
  import * as Card from "$lib/components/ui/card";
  import * as Select from "$lib/components/ui/select";
  import * as Dialog from "$lib/components/ui/dialog";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Textarea } from "$lib/components/ui/textarea";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import { PageHeader } from "$lib/components/ui/page-header";
  import { ErrorPanel } from "$lib/components/ui/error-panel";

  const tab = $derived(settingsTab($page.url.search));
  let info = $state<SiteInfo | null>(null);
  let revision = $state(0);
  let siteBaseline = $state("");
  let policyBaseline = $state("");
  let loading = $state(true);
  let policyLoading = $state(false);
  let policyLoaded = $state(false);
  let saving = $state(false);
  let feedback = $state("");
  let policyFeedback = $state("");
  let publicState = $state<PublicSite | null>(null);
  let statusError = $state("");
  let kind = $state<LegalKind>("TERMS");
  let expectedVersion = $state(0);
  let history = $state<PolicySummary[]>([]);
  let policySequence = 0;
  let settingsSequence = 0;
  const kstInput = (value = new Date().toISOString()) => new Date(new Date(value).getTime() + 9 * 3600000).toISOString().slice(0, 16);
  const blankDraft = () => ({ title: "", body: "", purpose: "", items: "", retention: "", refusal: "", effectiveLocal: kstInput() });
  let draft = $state(blankDraft());
  let review = $state(false);
  const siteDirty = $derived(info !== null && JSON.stringify(info) !== siteBaseline);
  const policyDirty = $derived(policyLoaded && JSON.stringify(draft) !== policyBaseline);
  const consentDocument = $derived(!["TERMS", "PRIVACY_POLICY"].includes(kind));
  let confirmation: { ask: (message: string, heading?: string, acceptLabel?: string) => Promise<boolean> };

  type TextKey = keyof Omit<SiteInfo, "copyrightStartYear" | "supportRetentionDays">;
  const groups: Array<{ title: string; fields: Array<{ key: TextKey; label: string; max: number; wide?: boolean }> }> = [
    { title: "기본 정보", fields: [
      { key: "siteName", label: "사이트명", max: 100 }, { key: "copyrightHolder", label: "저작권 표시 명칭", max: 150 },
      { key: "siteDescription", label: "사이트 설명", max: 500, wide: true }
    ] },
    { title: "사업자 정보", fields: [
      { key: "companyName", label: "상호 / 법인명", max: 150 }, { key: "representative", label: "대표자", max: 100 },
      { key: "businessNumber", label: "사업자등록번호", max: 30 }, { key: "onlineSalesNumber", label: "통신판매업 신고번호", max: 100 },
      { key: "address", label: "사업장 주소", max: 500, wide: true }
    ] },
    { title: "문의 연락처", fields: [
      { key: "supportEmail", label: "고객센터 이메일", max: 254 }, { key: "supportPhone", label: "고객센터 전화번호", max: 40 },
      { key: "supportHours", label: "운영시간 / 휴무 안내", max: 300, wide: true },
      { key: "privacyOfficer", label: "개인정보 보호책임자", max: 100 }, { key: "privacyEmail", label: "개인정보 문의 이메일", max: 254 }
    ] }
  ];
  const disclosureFields = [{ key: "purpose", label: "수집·이용 목적" }, { key: "items", label: "개인정보 항목" }, { key: "retention", label: "보유·이용 기간" }, { key: "refusal", label: "동의 거부권 및 거부에 따른 영향" }] as const;

  beforeNavigate(({ cancel, to, willUnload }) => {
    if (saving) { cancel(); return; }
    // Both panels remain mounted: switching them never discards either form.
    if (!willUnload && to?.url.pathname === $page.url.pathname) return;
    if ((siteDirty || policyDirty) && (willUnload || !window.confirm("저장하지 않은 내용이 있어요. 이동할까요?"))) cancel();
  });
  onMount(() => {
    const requested = $page.url.searchParams.get("kind");
    void loadSettings();
    void loadPolicy(requested && Object.hasOwn(POLICY_LABELS, requested) ? requested as LegalKind : "TERMS");
    void loadStatus();
  });
  onDestroy(() => { policySequence += 1; settingsSequence += 1; });
  async function changeTab(value: string) {
    if (saving || value === tab) return;
    try { await goto(settingsTabHref($page.url.search, value), { noScroll: true, keepFocus: true }); }
    catch { toast.error("메뉴를 전환하지 못했어요. 다시 시도해 주세요."); }
  }
  async function loadStatus() {
    statusError = "";
    try { publicState = await apiRequest<PublicSite>("/site/public"); }
    catch { statusError = "공개 상태를 확인하지 못했어요."; }
  }
  async function loadSettings() {
    const sequence = ++settingsSequence;
    loading = true; feedback = "";
    try {
      const result = await apiRequest<{ info: SiteInfo; revision: number }>("/admin/site/settings");
      if (sequence !== settingsSequence) return;
      info = result.info; revision = result.revision; siteBaseline = JSON.stringify(result.info);
    } catch (error) { if (sequence === settingsSequence) feedback = error instanceof Error ? error.message : "설정을 불러오지 못했어요."; }
    finally { if (sequence === settingsSequence) loading = false; }
  }
  async function reloadSettings() {
    if (saving || loading) return;
    if (siteDirty && !await confirmation.ask("입력한 내용을 저장된 값으로 바꿀까요?", "사이트 정보 다시 불러오기", "불러오기")) return;
    await loadSettings();
  }
  async function saveSettings(event: SubmitEvent) {
    event.preventDefault(); if (!info || saving || loading || !siteDirty) return;
    saving = true; feedback = "";
    try {
      const result = await apiRequest<{ info: SiteInfo; revision: number }>("/admin/site/settings", { method: "PUT", body: JSON.stringify({ info, revision }) });
      info = result.info; revision = result.revision; siteBaseline = JSON.stringify(result.info);
      feedback = "사이트 정보를 저장했어요."; toast.success(feedback);
      void invalidate("site:public").catch(() => {});
    } catch (error) { feedback = error instanceof Error ? error.message : "저장하지 못했어요. 입력한 내용은 그대로 있어요."; }
    finally { saving = false; }
  }
  function fillDraft(document: LegalDocument | null, selected: LegalKind) {
    draft = document ? { title: document.title, body: document.body, purpose: document.purpose, items: document.items, retention: document.retention, refusal: document.refusal, effectiveLocal: document.publishedAt ? kstInput() : kstInput(document.effectiveAt) } : { ...blankDraft(), title: POLICY_LABELS[selected] };
    policyBaseline = JSON.stringify(draft); review = false;
  }
  async function loadPolicy(selected: LegalKind) {
    if (saving || policyLoading) return;
    if (policyDirty && !await confirmation.ask("저장하지 않은 내용을 버리고 문서를 불러올까요?", "문서 변경", "불러오기")) return;
    const sequence = ++policySequence;
    policyLoading = true; policyFeedback = "";
    try {
      const result = await apiRequest<{ latest: LegalDocument | null; history: PolicySummary[] }>(`/admin/site/policies?kind=${selected}`);
      if (sequence !== policySequence) return;
      kind = selected; expectedVersion = result.latest?.version ?? 0; history = result.history;
      fillDraft(result.latest, selected); policyLoaded = true;
    } catch (error) { if (sequence === policySequence) policyFeedback = error instanceof Error ? error.message : "문서를 불러오지 못했어요. 입력한 내용은 그대로 있어요."; }
    finally { if (sequence === policySequence) policyLoading = false; }
  }
  async function useHistory(id: string) {
    if (saving || policyLoading) return;
    if (policyDirty && !await confirmation.ask("현재 입력한 내용을 이전 문서 내용으로 바꿀까요?", "이전 내용 가져오기", "가져오기")) return;
    const sequence = ++policySequence;
    policyLoading = true; policyFeedback = "";
    try {
      const document = await apiRequest<LegalDocument>(`/admin/site/policies/${id}`);
      if (sequence !== policySequence || document.kind !== kind) return;
      const previousBaseline = policyBaseline;
      fillDraft(document, kind); policyBaseline = previousBaseline;
      policyFeedback = "이전 내용을 가져왔어요. 저장하기 전까지 기존 문서는 바뀌지 않아요.";
    } catch (error) { if (sequence === policySequence) policyFeedback = error instanceof Error ? error.message : "이전 내용을 불러오지 못했어요."; }
    finally { if (sequence === policySequence) policyLoading = false; }
  }
  async function savePolicy(event: SubmitEvent) {
    event.preventDefault(); if (saving || policyLoading || !policyLoaded) return;
    const publish = (event.submitter as HTMLButtonElement | null)?.value === "publish";
    if (!draft.title.trim()) { policyFeedback = "문서 제목을 입력해 주세요."; return; }
    if (publish && (!draft.body.trim() || (consentDocument && disclosureFields.some((field) => !draft[field.key].trim())))) {
      policyFeedback = "본문과 개인정보 안내 항목을 모두 입력해 주세요."; return;
    }
    const date = new Date(`${draft.effectiveLocal}:00+09:00`);
    if (!Number.isFinite(date.getTime())) { policyFeedback = "올바른 시행 시각을 입력해 주세요."; return; }
    if (publish && !await confirmation.ask("설정한 시행 시각부터 이용자에게 공개돼요. 내용을 확인하고 공개할까요?", "약관 공개", "공개")) return;
    saving = true; policyFeedback = "";
    try {
      const document = await apiRequest<LegalDocument>("/admin/site/policies", { method: "POST", body: JSON.stringify({ kind, expectedVersion, title: draft.title, body: draft.body, purpose: draft.purpose, items: draft.items, retention: draft.retention, refusal: draft.refusal, effectiveAt: date.toISOString(), publish }) });
      expectedVersion = document.version;
      history = [document, ...history].slice(0, 100);
      fillDraft(document, kind);
      policyFeedback = publish ? "약관을 공개했어요. 설정한 시행 시각부터 적용돼요." : "초안을 저장했어요.";
      toast.success(policyFeedback);
      void Promise.all([invalidate("site:public"), invalidate("site:policies")]).catch(() => {});
      void loadStatus();
    } catch (error) { policyFeedback = error instanceof Error ? error.message : "문서를 저장하지 못했어요. 입력한 내용은 그대로 있어요."; }
    finally { saving = false; }
  }
</script>

<ConfirmAction bind:this={confirmation} />
<div class="mx-auto w-full max-w-6xl space-y-6 [word-break:keep-all] [overflow-wrap:anywhere]">
  <PageHeader title="사이트·약관 설정" description="사이트에 표시할 기본정보를 관리해요. 약관은 초안을 저장하고 내용을 확인한 뒤 공개해 주세요." />
  <AdminSiteNav />
  <Tabs.Root bind:value={() => tab, changeTab}>
    <Tabs.List aria-label="사이트 설정 항목" class="h-auto flex-wrap">
      <Tabs.Trigger id="site-info-tab" class="min-h-11" value="site" disabled={saving}>사이트 정보{#if siteDirty}<span class="size-1.5 rounded-full bg-primary" aria-label="저장하지 않은 변경 있음"></span>{/if}</Tabs.Trigger>
      <Tabs.Trigger id="site-policy-tab" class="min-h-11" value="policy" disabled={saving}>약관 설정{#if policyDirty}<span class="size-1.5 rounded-full bg-primary" aria-label="저장하지 않은 변경 있음"></span>{/if}</Tabs.Trigger>
    </Tabs.List>
    <Tabs.Content value="site" hidden={tab !== "site"}>
      {#if info}
        <form id="site-info-form" onsubmit={saveSettings} class="space-y-5" aria-busy={saving || loading}>
          <p class="text-muted-foreground text-sm leading-6">사이트 이름과 운영 설정은 필수예요. 나머지 정보는 확인된 내용부터 입력해 주세요.</p>
          <fieldset disabled={saving || loading} class="space-y-5">
            {#each groups as group (group.title)}<Card.Root><Card.Header><Card.Title>{group.title}</Card.Title></Card.Header><Card.Content class="grid gap-5 sm:grid-cols-2">
              {#each group.fields as field (field.key)}<div class={`grid gap-2 ${field.wide ? "sm:col-span-2" : ""}`}><Label for={`site-${field.key}`}>{field.label}{#if field.key === "siteName"}<span class="text-destructive"> *</span>{/if}</Label><Input id={`site-${field.key}`} bind:value={info[field.key]} maxlength={field.max} required={field.key === "siteName"} type={field.key === "supportEmail" || field.key === "privacyEmail" ? "email" : "text"} class="min-h-11" /></div>{/each}
            </Card.Content></Card.Root>{/each}
            <Card.Root><Card.Header><Card.Title>운영 설정</Card.Title></Card.Header><Card.Content class="grid gap-5 sm:grid-cols-2">
              <div class="grid gap-2"><Label for="site-copyright-year">저작권 시작 연도</Label><Input id="site-copyright-year" type="number" bind:value={info.copyrightStartYear} min={1900} max={2100} step={1} required class="min-h-11" /></div>
              <div class="grid gap-2"><div class="flex items-center gap-1"><Label for="site-support-retention">운영 문의 보관기간 (일)</Label><FieldHelp id="support-retention-help" title="문의 보관기간" text="변경한 기간은 새로 접수된 문의부터 적용돼요. 개인정보 안내의 보유기간과 맞추고, 기간이 지난 문의가 삭제되도록 운영 작업을 확인해 주세요." /></div><Input id="site-support-retention" type="number" bind:value={info.supportRetentionDays} min={1} max={3650} step={1} required class="min-h-11" /></div>
            </Card.Content></Card.Root>
          </fieldset>
          {#if feedback}<p role="status" class="rounded-lg border p-3 text-sm leading-6">{feedback}</p>{/if}
          <div class="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background/95 p-4 backdrop-blur-sm"><p class="text-xs text-muted-foreground">{siteDirty ? "저장하지 않은 변경사항이 있어요." : "저장된 내용이에요."}</p><div class="flex gap-2"><Button type="button" variant="outline" disabled={saving || loading} onclick={reloadSettings}>다시 불러오기</Button><Button id="site-info-save" type="submit" disabled={saving || loading || !siteDirty}>{saving ? "저장 중…" : "사이트 정보 저장"}</Button></div></div>
        </form>
      {:else if loading}<div aria-label="사이트 정보 불러오는 중" class="space-y-3"><Skeleton class="h-32 w-full" /><Skeleton class="h-40 w-full" /></div>
      {:else}<ErrorPanel title="사이트 정보를 불러오지 못했어요" message={feedback || "잠시 후 다시 시도해 주세요."} onRetry={loadSettings} />{/if}
    </Tabs.Content>
    <Tabs.Content value="policy" hidden={tab !== "policy"}>
      <div class="space-y-5">
        {#if publicState}<div class="flex flex-wrap items-center gap-3 rounded-lg bg-muted/30 px-4 py-3 text-sm" aria-label="약관 공개 상태"><span>회원가입</span><Badge variant={publicState.ready.signup ? "secondary" : "outline"}>{publicState.ready.signup ? "공개 완료" : "필수 문서 미공개"}</Badge><span class="sm:ml-3">운영 문의</span><Badge variant={publicState.ready.inquiry ? "secondary" : "outline"}>{publicState.ready.inquiry ? "공개 완료" : "필수 문서 미공개"}</Badge><FieldHelp id="policy-readiness-help" title="필수 문서 안내" text="회원가입에는 이용약관·개인정보 처리방침·가입 개인정보 수집 동의가 필요해요. 문의에는 개인정보 처리방침과 문의 수집 동의가 필요해요. 공개 시각이 지나야 적용돼요." /></div>{/if}
        {#if statusError}<p role="status" class="text-xs text-muted-foreground">{statusError} <button type="button" class="underline" onclick={loadStatus}>다시 확인</button></p>{/if}
        <Card.Root><Card.Header><Card.Title>약관 내용</Card.Title></Card.Header><Card.Content class="space-y-5">
          <div class="grid gap-2"><Label for="policy-kind">문서 종류</Label><Select.Root type="single" bind:value={() => kind, (value) => { if (value in POLICY_LABELS) void loadPolicy(value as LegalKind); }} disabled={saving || policyLoading}><Select.Trigger id="policy-kind" class="min-h-11 w-full">{POLICY_LABELS[kind]}</Select.Trigger><Select.Content>{#each Object.entries(POLICY_LABELS) as [value, label] (value)}<Select.Item {value} {label} />{/each}</Select.Content></Select.Root></div>
          {#if policyLoading}<p role="status" class="text-sm text-muted-foreground">문서를 불러오는 중이에요.</p>{/if}
          {#if !policyLoaded && !policyLoading}<ErrorPanel title="약관 문서를 불러오지 못했어요" message={policyFeedback || "잠시 후 다시 시도해 주세요."} onRetry={() => loadPolicy(kind)} />{/if}
          {#if policyLoaded}<form id="policy-editor-form" class="space-y-5" onsubmit={savePolicy} aria-busy={saving || policyLoading}>
            <fieldset disabled={saving || policyLoading || !policyLoaded} class="grid gap-5">
              <div class="grid gap-2"><Label for="policy-title">문서 제목</Label><Input id="policy-title" bind:value={draft.title} maxlength={200} required class="min-h-11" /></div>
              <div class="grid gap-2"><Label for="policy-effective-at">시행 시각 (한국 시간)</Label><Input id="policy-effective-at" type="datetime-local" bind:value={draft.effectiveLocal} required class="min-h-11 w-full sm:w-fit" /></div>
              {#if consentDocument}<div class="grid gap-5 sm:grid-cols-2">{#each disclosureFields as field (field.key)}<div class="grid gap-2"><Label for={`policy-${field.key}`}>{field.label}</Label><Textarea id={`policy-${field.key}`} bind:value={draft[field.key]} rows={4} maxlength={4000} class="leading-7" /></div>{/each}</div>{/if}
              <div class="grid gap-2"><Label for="policy-body">본문</Label><Textarea id="policy-body" bind:value={draft.body} rows={15} maxlength={100000} class="leading-8" /><p class="text-right text-xs text-muted-foreground">{draft.body.length.toLocaleString()} / 100,000</p></div>
            </fieldset>
            {#if policyFeedback}<p role="status" class="rounded-lg border p-3 text-sm leading-6">{policyFeedback}</p>{/if}
            <div class="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background/95 p-4 backdrop-blur-sm"><Button type="button" variant="ghost" disabled={!policyLoaded} onclick={() => review = true}>미리보기</Button><div class="flex gap-2"><Button id="policy-save-draft" type="submit" name="action" value="draft" variant="outline" disabled={saving || policyLoading || !policyLoaded || !policyDirty}>초안 저장</Button><Button id="policy-publish" type="submit" name="action" value="publish" disabled={saving || policyLoading || !policyLoaded}>공개</Button></div></div>
          </form>{/if}
        </Card.Content></Card.Root>
        {#if policyLoaded}<details class="rounded-xl border p-5"><summary class="min-h-11 cursor-pointer text-sm font-semibold">저장 이력</summary><div class="mt-3 divide-y">{#each history as item (item.id)}<div class="flex flex-wrap items-center justify-between gap-3 py-3"><div class="flex flex-wrap items-center gap-2"><Badge variant="outline">{item.publishedAt ? "공개" : "초안"}</Badge><span class="text-xs text-muted-foreground">시행 {koreanDate(item.effectiveAt)}</span></div><Button type="button" size="sm" variant="outline" disabled={saving || policyLoading} onclick={() => useHistory(item.id)}>내용 가져오기</Button></div>{:else}<p class="py-3 text-sm text-muted-foreground">아직 저장된 문서가 없어요.</p>{/each}</div></details>{/if}
      </div>
    </Tabs.Content>
  </Tabs.Root>
</div>
<Dialog.Root bind:open={review}><Dialog.Content class="flex max-h-[85dvh] flex-col sm:max-w-3xl"><Dialog.Header><Dialog.Title>{draft.title || "약관 미리보기"}</Dialog.Title><Dialog.Description>현재 편집 중인 내용이에요.</Dialog.Description></Dialog.Header><div class="min-h-0 overflow-y-auto pr-2 [word-break:keep-all] [overflow-wrap:anywhere]">{#if consentDocument}<dl class="mb-5 grid gap-3 rounded-lg bg-muted/30 p-4 text-sm leading-7">{#each disclosureFields as field (field.key)}<div><dt class="font-medium">{field.label}</dt><dd class="whitespace-pre-wrap text-muted-foreground">{draft[field.key] || "—"}</dd></div>{/each}</dl>{/if}<article class="whitespace-pre-wrap text-sm leading-8">{draft.body || "아직 입력한 본문이 없어요."}</article></div><Dialog.Footer><Button type="button" variant="outline" onclick={() => review = false}>닫기</Button></Dialog.Footer></Dialog.Content></Dialog.Root>
