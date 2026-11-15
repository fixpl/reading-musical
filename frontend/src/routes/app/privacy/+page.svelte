<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { invalidate } from "$app/navigation";
  import { apiRequest } from "$lib/api/client";
  import { POLICY_LABELS, policyHref, koreanDate, type LegalKind } from "$lib/api/site";
  import PolicyConsent from "$lib/components/site/PolicyConsent.svelte";
  import { Button } from "$lib/components/ui/button";
  import type { PageData } from "./$types";
  let { data }: { data: PageData } = $props();
  type ConsentState = { marketingPrivacy: boolean; marketing: boolean; revision: number; updatedAt: string | null; history: Array<{ id: string; kind: string; granted: boolean; source: string; createdAt: string; document: { id: string; title: string; kind: LegalKind; version: number } | null }> };
  let consentState = $state<ConsentState | null>(null);
  let marketingPrivacy = $state(false);
  let marketing = $state(false);
  let busy = $state(false);
  let feedback = $state("");
  const privacyPolicy = $derived(data.site?.policies.find((item) => item.kind === "MARKETING_PRIVACY"));
  const emailPolicy = $derived(data.site?.policies.find((item) => item.kind === "MARKETING_EMAIL"));
  let policyFingerprint = "";
  $effect(() => {
    const next = `${privacyPolicy?.id || ""}:${emailPolicy?.id || ""}`;
    if (policyFingerprint !== next) {
      policyFingerprint = next;
      const saved = untrack(() => consentState);
      marketingPrivacy = saved?.marketingPrivacy ?? false;
      marketing = saved?.marketing ?? false;
    }
  });
  $effect(() => { if (!marketingPrivacy) marketing = false; });
  onMount(() => { void load(); });
  function apply(result: ConsentState) { consentState = result; marketingPrivacy = result.marketingPrivacy; marketing = result.marketing; }
  async function load() {
    busy = true; feedback = "";
    try { apply(await apiRequest<ConsentState>("/site/consents")); }
    catch (error) { feedback = error instanceof Error ? error.message : "동의 정보를 불러오지 못했어요."; }
    finally { busy = false; }
  }
  async function save(event: SubmitEvent) {
    event.preventDefault(); if (!consentState || busy) return;
    busy = true; feedback = "";
    try {
      apply(await apiRequest<ConsentState>("/site/consents/marketing", { method: "PUT", body: JSON.stringify({ revision: consentState.revision, marketingPrivacy, marketing, marketingPrivacyDocumentId: privacyPolicy?.id, marketingEmailDocumentId: emailPolicy?.id }) }));
      feedback = "수신 동의 설정을 저장했어요. 서비스 알림 설정은 바꾸지 않았어요.";
    } catch (error) {
      feedback = error instanceof Error ? error.message : "동의 설정을 저장하지 못했어요.";
      if (error && typeof error === "object" && "code" in error && error.code === "POLICY_CHANGED") { marketingPrivacy = consentState.marketingPrivacy; marketing = consentState.marketing; await invalidate("site:public"); }
    } finally { busy = false; }
  }
  async function withdraw() {
    if (!consentState || busy) return;
    busy = true; feedback = "";
    try { apply(await apiRequest<ConsentState>("/site/consents/marketing", { method: "PUT", body: JSON.stringify({ revision: consentState.revision, marketingPrivacy: false, marketing: false }) })); feedback = "마케팅 목적 이용과 이메일 광고 수신 동의를 철회했어요."; }
    catch (error) { feedback = error instanceof Error ? error.message : "철회를 처리하지 못했어요."; }
    finally { busy = false; }
  }
</script>
<svelte:head><title>수신 동의 관리</title><meta name="robots" content="noindex,nofollow" /></svelte:head>
<div class="mx-auto w-full max-w-3xl space-y-6 py-4 [word-break:keep-all] [overflow-wrap:anywhere]">
  <header><h1 class="text-2xl font-bold">수신 동의 관리</h1><p class="mt-2 text-sm leading-7 text-muted-foreground">마케팅 수신은 선택 사항이에요. 동의하지 않아도 서비스를 이용할 수 있고, 공연 일정 같은 서비스 알림과는 별도로 관리해요.</p></header>
  {#if consentState}
    <form class="grid gap-4 rounded-xl border p-5" onsubmit={save}>
      <PolicyConsent doc={privacyPolicy} label="마케팅 목적 개인정보 이용에 동의해요." bind:checked={marketingPrivacy} disabled={busy} />
      <PolicyConsent doc={emailPolicy} label="이메일 광고성 정보 수신에 동의해요." bind:checked={marketing} disabled={busy || !marketingPrivacy} />
      <p class="text-xs leading-6 text-muted-foreground">현재 저장된 상태: 마케팅 목적 이용 {consentState.marketingPrivacy ? "동의" : "미동의"} · 이메일 광고 {consentState.marketing ? "수신 동의" : "수신 거부"}{#if consentState.updatedAt}<br />마지막 처리: {koreanDate(consentState.updatedAt)}{/if}</p>
      <div class="flex flex-wrap gap-3"><Button type="submit" disabled={busy}>설정 저장</Button><Button type="button" variant="outline" disabled={busy || (!consentState.marketingPrivacy && !consentState.marketing)} onclick={withdraw}>마케팅 동의 모두 철회</Button></div>
      <p class="text-xs leading-6 text-muted-foreground">새 약관을 불러오지 못해도 ‘모두 철회’로 기존 마케팅 동의를 해제할 수 있어요.</p>
    </form>
    <section class="rounded-xl border p-5"><h2 class="text-lg font-semibold">동의 처리 이력</h2><p class="mt-2 text-xs leading-6 text-muted-foreground">최근 동의 내역과 변경 일시를 확인할 수 있어요.</p><ol class="mt-4 divide-y">{#each consentState.history as event (event.id)}<li class="py-4 text-sm"><p class="font-medium">{event.kind === "AGE_14" ? "만 14세 이상 확인" : POLICY_LABELS[event.kind as LegalKind] || event.kind} · {event.granted ? "동의 / 확인" : "미동의 / 철회"}</p><p class="mt-1 text-xs text-muted-foreground">{koreanDate(event.createdAt)} · {event.source === "REGISTER" ? "회원가입" : "설정 변경"}</p>{#if event.document}<a href={policyHref(event.document)} target="_blank" rel="noopener noreferrer" class="mt-2 inline-block text-xs underline">당시 동의 내용 보기 (새 창)</a>{/if}</li>{:else}<li class="py-5 text-sm text-muted-foreground">저장된 동의 이력이 없어요.</li>{/each}</ol></section>
  {/if}
  {#if feedback}<p role="status" class="text-sm leading-6">{feedback}</p>{/if}
  <Button type="button" variant="ghost" disabled={busy} onclick={load}>저장된 설정 다시 불러오기</Button>
  <p class="text-sm"><a href="/support" class="underline underline-offset-4">그 밖의 개인정보 열람·정정·삭제 요청은 운영팀 문의를 이용해 주세요.</a></p>
</div>
