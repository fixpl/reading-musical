<script lang="ts">
  import { onMount } from "svelte";
  import { invalidate } from "$app/navigation";
  import { apiRequest, getAccessToken } from "$lib/api/client";
  import type { CurrentUser } from "$lib/api/auth";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Textarea } from "$lib/components/ui/textarea";
  import PolicyConsent from "$lib/components/site/PolicyConsent.svelte";
  import { SUPPORT_CATEGORIES, SUPPORT_STATUSES, koreanDate, type SupportTicket } from "$lib/api/site";
  import type { PageData } from "./$types";
  let { data }: { data: PageData } = $props();
  let member = $state<CurrentUser | null>(null);
  let checking = $state(true);
  let authError = $state("");
  let contactName = $state("");
  let email = $state("");
  let category = $state("GENERAL");
  let subject = $state("");
  let message = $state("");
  let privacyConsent = $state(false);
  let age14 = $state(false);
  let website = $state("");
  let submitting = $state(false);
  let feedback = $state("");
  let receipt = $state<{ id: string; guestKey: string | null; expiresAt: string } | null>(null);
  let ticketId = $state("");
  let key = $state("");
  let looking = $state(false);
  let lookupError = $state("");
  let found = $state<SupportTicket | null>(null);
  let myTickets = $state<SupportTicket[]>([]);
  let myPage = $state(1);
  let myTotal = $state(0);
  let historyError = $state("");
  let historyLoading = $state(false);
  const policy = $derived(data.site?.policies.find((item) => item.kind === "INQUIRY_PRIVACY"));
  let consentPolicyId = "";
  $effect(() => { const next = policy?.id || ""; if (next !== consentPolicyId) { consentPolicyId = next; privacyConsent = false; } });

  onMount(() => { void identify(); });
  async function identify() {
    checking = true; authError = "";
    try {
      if (getAccessToken()) {
        member = await apiRequest<CurrentUser>("/auth/me");
        contactName = member.name; email = member.email;
        await loadMine(1);
      }
    } catch { authError = "로그인 상태를 확인하지 못했어요. 다시 로그인하거나 연결 상태를 확인해 주세요."; }
    finally { checking = false; }
  }
  async function loadMine(target: number) {
    historyLoading = true; historyError = "";
    try {
      const result = await apiRequest<{ items: SupportTicket[]; total: number; page: number }>(`/site/support/mine?page=${target}`);
      myTickets = result.items; myTotal = result.total; myPage = result.page;
    } catch (error) { historyError = error instanceof Error ? error.message : "문의 내역을 불러오지 못했어요."; }
    finally { historyLoading = false; }
  }
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (submitting || checking || authError) return;
    if (!data.site?.ready.inquiry || !policy || !privacyConsent || !age14) { feedback = "필수 동의와 안내 내용을 확인해 주세요."; return; }
    submitting = true; feedback = "";
    try {
      receipt = await apiRequest(member ? "/site/support/member" : "/site/support", { method: "POST", body: JSON.stringify({ contactName, email, category, subject, message, privacyConsent, privacyDocumentId: policy.id, age14, website }) });
      subject = message = ""; privacyConsent = age14 = false;
      feedback = "문의를 접수했어요. 운영팀의 답변은 이 고객센터에서 확인할 수 있어요.";
      if (receipt?.guestKey) { ticketId = receipt.id; key = receipt.guestKey; }
      if (member) await loadMine(1);
    } catch (error) {
      feedback = error instanceof Error ? error.message : "문의를 접수하지 못했어요.";
      if (error && typeof error === "object" && "code" in error && error.code === "POLICY_CHANGED") { privacyConsent = false; await invalidate("site:public"); }
    } finally { submitting = false; }
  }
  async function lookup(event: SubmitEvent) {
    event.preventDefault(); if (looking) return;
    looking = true; lookupError = ""; found = null;
    try { found = await apiRequest<SupportTicket>("/site/support/lookup", { method: "POST", body: JSON.stringify({ ticketId: ticketId.trim(), key: key.trim() }) }); }
    catch (error) { lookupError = error instanceof Error ? error.message : "문의를 조회하지 못했어요."; }
    finally { looking = false; }
  }
  async function copyReceipt() {
    if (!receipt?.guestKey) return;
    try { await navigator.clipboard.writeText(`접수번호: ${receipt.id}\n비회원 조회 키: ${receipt.guestKey}`); feedback = "접수번호와 조회 키를 복사했어요. 다른 사람에게 공유하지 마세요."; }
    catch { feedback = "자동으로 복사하지 못했어요. 접수번호와 조회 키를 직접 선택해 보관해 주세요."; }
  }
</script>
<svelte:head><title>운영팀 문의 — {data.site?.info.siteName || "아트브릿지"}</title><meta name="robots" content="noindex,nofollow" /></svelte:head>
<main class="mx-auto max-w-5xl px-5 py-10 sm:py-16 [word-break:keep-all] [overflow-wrap:anywhere]">
  <nav class="flex gap-5 text-sm text-muted-foreground" aria-label="고객센터 탐색"><a href="/">홈</a><a href="/faq">자주 묻는 질문</a></nav>
  <h1 class="mt-7 text-3xl font-bold tracking-tight">운영팀에 문의하기</h1>
  <p class="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">회원과 비회원 모두 문의할 수 있어요. 문의 내용과 답변은 본인과 운영자만 확인하며, 주민등록번호·비밀번호 등 민감한 정보는 입력하지 마세요.</p>
  {#if data.site?.info.supportHours}<p class="mt-2 text-sm">운영시간: {data.site.info.supportHours}</p>{/if}
  {#if receipt}
    <section class="mt-7 grid gap-3 rounded-xl border bg-primary/5 p-5" aria-label="문의 접수 결과">
      <h2 class="font-semibold">문의를 접수했어요</h2><p class="text-sm">접수번호: <code class="select-all break-all">{receipt.id}</code></p>
      {#if receipt.guestKey}<p class="text-sm font-semibold">비회원 조회 키를 꼭 보관해 주세요. 이메일이나 이름만으로는 문의를 열 수 없어요.</p><code class="select-all break-all rounded-lg border bg-background p-3 text-xs">{receipt.guestKey}</code><Button type="button" variant="outline" onclick={copyReceipt}>접수번호와 조회 키 복사</Button>{/if}
      <p class="text-xs text-muted-foreground">조회 가능 기한: {koreanDate(receipt.expiresAt)}</p>
    </section>
  {/if}
  <div class="mt-8 grid items-start gap-8 lg:grid-cols-2">
    <section class="rounded-xl border p-5 sm:p-6" aria-labelledby="support-form-title">
      <h2 id="support-form-title" class="mb-5 text-lg font-semibold">새 문의 작성</h2>
      {#if authError}<p role="alert" class="mb-4 text-sm leading-6">{authError} <a href="/login" class="underline">로그인</a> <button type="button" class="ml-2 underline" onclick={identify}>다시 확인</button></p>{/if}
      <form onsubmit={submit} class="grid gap-4" aria-busy={submitting}>
        <fieldset disabled={checking || submitting || Boolean(authError)} class="grid gap-4">
          <label class="grid gap-2 text-sm">이름<Input bind:value={contactName} required maxlength={60} autocomplete="name" readonly={Boolean(member)} /></label>
          <label class="grid gap-2 text-sm">이메일<Input type="email" bind:value={email} required maxlength={160} autocomplete="email" readonly={Boolean(member)} /></label>
          {#if member}<p class="text-xs text-muted-foreground">현재 로그인한 회원 정보로 문의를 접수해요.</p>{:else}<p class="text-xs text-muted-foreground">비회원으로 문의해요. 접수한 뒤 발급되는 조회 키로 답변을 확인할 수 있어요.</p>{/if}
          <label class="grid gap-2 text-sm">문의 유형<select bind:value={category} class="min-h-11 rounded-lg border bg-background px-3">{#each Object.entries(SUPPORT_CATEGORIES) as [value, label] (value)}<option {value}>{label}</option>{/each}</select></label>
          <label class="grid gap-2 text-sm">제목<Input bind:value={subject} required maxlength={150} /></label>
          <label class="grid gap-2 text-sm">내용<Textarea bind:value={message} required maxlength={5000} rows={7} placeholder="궁금한 점이나 발생한 문제를 알려 주세요." /><span class="text-right text-xs text-muted-foreground">{message.length.toLocaleString()} / 5,000</span></label>
          <div hidden aria-hidden="true"><label>웹사이트<input bind:value={website} tabindex="-1" autocomplete="off" /></label></div>
          <label class="flex gap-3 text-sm"><input type="checkbox" bind:checked={age14} required class="size-4" /><span>[필수] 만 14세 이상임을 확인해요.</span></label>
          <PolicyConsent doc={policy} label="문의 개인정보 수집·이용에 동의해요." bind:checked={privacyConsent} required />
          {#if data.site}<p class="text-xs leading-6 text-muted-foreground">운영 문의의 시스템 보관기간은 접수일부터 {data.site.info.supportRetentionDays}일이며, 보관기간이 지나면 조회할 수 없어요.</p>{/if}
          <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" class="text-sm font-semibold underline">개인정보 처리방침 (새 창)</a>
          {#if !data.site?.ready.inquiry}<p role="status" class="text-sm leading-6">문의 안내를 준비 중이거나 불러오지 못했어요. <button type="button" class="underline" onclick={() => invalidate("site:public")}>다시 확인</button></p>{/if}
          <Button type="submit" disabled={!data.site?.ready.inquiry}>{submitting ? "접수 중…" : "문의 접수"}</Button>
        </fieldset>
        <p role="status" class="text-sm leading-6">{feedback}</p>
      </form>
    </section>
    <div class="grid gap-6">
      {#if member}
        <section class="rounded-xl border p-5 sm:p-6" aria-labelledby="my-support-title">
          <h2 id="my-support-title" class="text-lg font-semibold">내 문의 <span class="text-sm text-muted-foreground">{myTotal}</span></h2>
          {#if historyError}<p role="alert" class="mt-3 text-sm">{historyError} <button type="button" class="underline" onclick={() => loadMine(myPage)}>다시 불러오기</button></p>{/if}
          <div class="mt-4 divide-y">{#each myTickets as ticket (ticket.id)}<details class="py-4"><summary class="cursor-pointer text-sm font-semibold">{ticket.subject} <span class="ml-2 text-xs text-muted-foreground">{SUPPORT_STATUSES[ticket.status] || ticket.status}</span></summary><p class="mt-3 text-xs text-muted-foreground">{koreanDate(ticket.createdAt)}</p><p class="mt-3 whitespace-pre-wrap text-sm leading-7">{ticket.message}</p><div class="mt-4 rounded-lg bg-muted/40 p-4"><h3 class="text-sm font-semibold">운영팀 답변</h3><p class="mt-2 whitespace-pre-wrap text-sm leading-7">{ticket.answer || "아직 등록된 답변이 없어요."}</p></div></details>{:else}<p class="py-6 text-sm text-muted-foreground">{historyLoading ? "문의 내역을 불러오고 있어요." : "접수한 문의가 없어요."}</p>{/each}</div>
          <div class="mt-4 flex items-center justify-between gap-3"><Button type="button" variant="outline" disabled={myPage <= 1 || historyLoading} onclick={() => loadMine(myPage - 1)}>이전</Button><span class="text-xs">{myPage} / {Math.max(1, Math.ceil(myTotal / 20))}</span><Button type="button" variant="outline" disabled={myPage * 20 >= myTotal || historyLoading} onclick={() => loadMine(myPage + 1)}>다음</Button></div>
        </section>
      {/if}
      <section class="rounded-xl border p-5 sm:p-6" aria-labelledby="lookup-title">
        <h2 id="lookup-title" class="text-lg font-semibold">비회원 문의 조회</h2><p class="mt-2 text-xs leading-6 text-muted-foreground">접수번호와 조회 키를 함께 입력해 주세요. 조회 키는 URL에 넣거나 다른 사람에게 공유하지 마세요.</p>
        <form class="mt-5 grid gap-4" onsubmit={lookup}>
          <label class="grid gap-2 text-sm">접수번호<Input bind:value={ticketId} required maxlength={36} autocomplete="off" /></label>
          <label class="grid gap-2 text-sm">비회원 조회 키<Input type="password" bind:value={key} required minlength={64} maxlength={64} autocomplete="off" /></label>
          <Button type="submit" variant="outline" disabled={looking}>{looking ? "조회 중…" : "문의 및 답변 조회"}</Button>
          {#if lookupError}<p role="alert" class="text-sm text-destructive">{lookupError}</p>{/if}
        </form>
        {#if found}<article class="mt-6 border-t pt-5"><h3 class="font-semibold">{found.subject}</h3><p class="mt-2 text-xs text-muted-foreground">{SUPPORT_STATUSES[found.status]} · {koreanDate(found.createdAt)}</p><p class="mt-4 whitespace-pre-wrap text-sm leading-7">{found.message}</p><div class="mt-5 rounded-lg bg-muted/40 p-4"><h4 class="text-sm font-semibold">운영팀 답변</h4><p class="mt-2 whitespace-pre-wrap text-sm leading-7">{found.answer || "아직 등록된 답변이 없어요."}</p></div></article>{/if}
      </section>
    </div>
  </div>
</main>
