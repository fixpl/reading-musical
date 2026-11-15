<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/stores";
  import { beforeNavigate } from "$app/navigation";
  import { inquiryLookup, InquiryLookupError, type ApplicantInquiry } from "$lib/api/inquiries";
  import { koreanDate } from "$lib/api/site";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Textarea } from "$lib/components/ui/textarea";
  import { Badge } from "$lib/components/ui/badge";
  let inquiryId = $state(""); let email = $state(""); let code = $state("");
  let challengeId = $state(""); let accessToken = $state("");
  let inquiry = $state<ApplicantInquiry | null>(null);
  let busy = $state(false); let feedback = $state(""); let message = $state("");
  let now = $state(0); let resendAt = $state(0); const resendSeconds = $derived(Math.max(0, Math.ceil((resendAt - now) / 1000)));
  let sessionExpiresAt = $state(0);
  let sequence = 0;
  let destroyed = false;
  const expired = $derived(sessionExpiresAt > 0 && now >= sessionExpiresAt);
  const isCurrent = (value: number) => !destroyed && value === sequence;
  function clearSession() { sequence += 1; busy = false; accessToken = ""; inquiry = null; challengeId = ""; code = ""; message = ""; sessionExpiresAt = 0; }
  function identityChanged() { if (!busy) clearSession(); }
  $effect(() => { if (expired) { clearSession(); feedback = "조회 가능한 시간이 지났어요. 이메일 인증을 다시 진행해 주세요."; } });
  beforeNavigate(({ cancel, willUnload }) => { if (message.trim() && (willUnload || !window.confirm("보내지 않은 내용이 있어요. 이동할까요?"))) cancel(); });
  onMount(() => {
    const suppliedId = $page.url.searchParams.get("id"); if (suppliedId && /^[a-f0-9-]{36}$/i.test(suppliedId)) inquiryId = suppliedId;
    now = Date.now(); const timer = setInterval(() => { now = Date.now(); }, 1000);
    return () => { destroyed = true; sequence += 1; clearInterval(timer); accessToken = ""; inquiry = null; message = ""; };
  });
  async function request(event: SubmitEvent) {
    event.preventDefault(); if (busy || resendSeconds || accessToken) return;
    const current = ++sequence; busy = true; feedback = "";
    try {
      const result = await inquiryLookup<{ challengeId: string; message: string; retryAfterSeconds: number }>("request", { inquiryId: inquiryId.trim(), email: email.trim() });
      if (!isCurrent(current)) return;
      challengeId = result.challengeId; code = ""; resendAt = Date.now() + result.retryAfterSeconds * 1000; feedback = result.message;
    } catch (error) { if (isCurrent(current)) feedback = error instanceof Error ? error.message : "인증번호 요청을 처리하지 못했어요."; }
    finally { if (isCurrent(current)) busy = false; }
  }
  async function verify(event: SubmitEvent) {
    event.preventDefault(); if (busy || !challengeId || accessToken) return;
    const current = ++sequence; busy = true; feedback = "";
    try {
      const result = await inquiryLookup<{ accessToken: string; sessionExpiresAt: string }>("verify", { challengeId, code: code.trim() });
      if (!isCurrent(current)) return;
      accessToken = result.accessToken; sessionExpiresAt = Date.parse(result.sessionExpiresAt); challengeId = ""; code = "";
      const detail = await inquiryLookup<ApplicantInquiry>("detail", { accessToken });
      if (isCurrent(current)) inquiry = detail;
    } catch (error) { if (isCurrent(current)) handle(error); }
    finally { if (isCurrent(current)) busy = false; }
  }
  async function refresh() {
    if (busy || !accessToken || expired) return;
    const current = ++sequence; busy = true; feedback = "";
    try { const detail = await inquiryLookup<ApplicantInquiry>("detail", { accessToken }); if (isCurrent(current)) inquiry = detail; }
    catch (error) { if (isCurrent(current)) handle(error); } finally { if (isCurrent(current)) busy = false; }
  }
  function handle(error: unknown) {
    feedback = error instanceof Error ? error.message : "요청을 처리하지 못했어요.";
    // A mistyped code may be retried within the server's attempt limit; only an expired issued session is cleared here.
    if (error instanceof InquiryLookupError && error.status === 401 && accessToken) clearSession();
  }
  async function send(event: SubmitEvent) {
    event.preventDefault(); if (busy || expired || !message.trim() || !accessToken) return;
    const current = ++sequence; busy = true; feedback = "";
    try {
      const detail = await inquiryLookup<ApplicantInquiry>("messages", { accessToken, body: message.trim() });
      if (!isCurrent(current)) return;
      inquiry = detail; message = ""; feedback = "운영팀에 내용을 전달했어요.";
    } catch (error) { if (isCurrent(current)) handle(error); } finally { if (isCurrent(current)) busy = false; }
  }
  async function close() {
    if (busy) return; const token = accessToken; clearSession();
    if (token) await inquiryLookup("logout", { accessToken: token }).catch(() => {});
  }
</script>
<svelte:head><title>공연 신청 확인</title><meta name="robots" content="noindex,nofollow" /><meta name="referrer" content="no-referrer" /></svelte:head>
<main class="mx-auto min-h-[65vh] w-full max-w-3xl px-5 py-12 [word-break:keep-all] [overflow-wrap:anywhere]">
  <nav class="flex gap-5 text-sm text-muted-foreground" aria-label="신청 메뉴"><a href="/">홈</a><a href="/inquiries/new">새 공연 신청</a></nav>
  <h1 class="mb-3 mt-6 text-3xl font-bold">공연 신청 확인</h1>
  {#if !inquiry}
    <p class="mb-7 text-sm leading-7 text-muted-foreground">회원 로그인은 필요하지 않아요. 접수번호와 신청 시 등록한 이메일로 본인의 신청을 확인해 주세요.</p>
    <form class="grid gap-4 rounded-xl border p-5" onsubmit={request}>
      <div class="grid gap-2"><Label for="inquiry-id">접수번호</Label><Input id="inquiry-id" bind:value={inquiryId} disabled={busy || Boolean(accessToken)} oninput={identityChanged} minlength={36} maxlength={36} required autocomplete="off" /></div>
      <div class="grid gap-2"><Label for="inquiry-email">등록 이메일</Label><Input id="inquiry-email" bind:value={email} disabled={busy || Boolean(accessToken)} oninput={identityChanged} type="email" maxlength={160} required autocomplete="email" /></div>
      <Button type="submit" disabled={busy || Boolean(accessToken) || resendSeconds > 0}>{resendSeconds ? `${resendSeconds}초 후 재요청` : challengeId ? "인증번호 다시 받기" : "인증번호 받기"}</Button>
    </form>
    {#if accessToken}<div class="mt-4 flex flex-wrap gap-3"><Button type="button" onclick={refresh} disabled={busy}>신청 내용 다시 불러오기</Button><Button type="button" variant="outline" onclick={close} disabled={busy}>조회 종료</Button></div>{/if}
    {#if challengeId}<form onsubmit={verify} class="mt-5 grid gap-4 rounded-xl border p-5"><div class="grid gap-2"><Label for="inquiry-code">이메일 인증번호</Label><Input id="inquiry-code" bind:value={code} disabled={busy} inputmode="numeric" autocomplete="one-time-code" minlength={6} maxlength={6} pattern={"[0-9]{6}"} required placeholder="6자리 숫자" /><p class="text-xs leading-6 text-muted-foreground">10분 안에 입력해 주세요. 최신 인증번호만 사용할 수 있어요.</p></div><Button type="submit" disabled={busy}>신청 확인</Button></form>{/if}
    <p class="mt-5 text-xs leading-6 text-muted-foreground">접수번호는 접수 완료 화면과 안내 이메일에서 확인할 수 있어요. 메일이 보이지 않으면 스팸함을 확인해 주세요. 조회 인증은 신청할 때 등록한 이메일로만 진행해요.</p>
  {:else}
    <header class="mb-5 flex flex-wrap items-center justify-between gap-3"><Badge variant="secondary">{inquiry.statusLabel}</Badge><div class="flex gap-2"><Button type="button" variant="outline" size="sm" onclick={refresh} disabled={busy || expired}>새로고침</Button><Button type="button" variant="ghost" size="sm" onclick={close} disabled={busy}>조회 종료</Button></div></header>
    {#if expired}<p role="alert" class="mb-5 rounded-lg border p-4 text-sm">조회 가능한 시간이 지났어요. <button type="button" class="underline" onclick={close}>이메일로 다시 확인</button></p>{/if}
    <section class="space-y-4 rounded-xl border p-5"><h2 class="text-lg font-semibold">{inquiry.orgName}</h2><p class="text-xs text-muted-foreground">접수번호 {inquiry.id} · {koreanDate(inquiry.createdAt)}</p><dl class="grid gap-3 text-sm sm:grid-cols-2">{#each [["담당자", inquiry.contactName], ["희망 시기", inquiry.preferredTiming || "미정"], ["관람 대상", inquiry.audience || "미정"], ["등록 이메일", inquiry.email]] as [name, value] (name)}<div><dt class="text-xs text-muted-foreground">{name}</dt><dd class="mt-1">{value}</dd></div>{/each}</dl><p class="whitespace-pre-wrap rounded-lg bg-muted/30 p-4 text-sm leading-7">{inquiry.message}</p><p class="text-xs leading-6 text-muted-foreground">공연 연결 여부와 최종 진행 확정은 달라요. 확정 일정과 조건은 운영팀의 안내를 확인해 주세요.</p></section>
    <section class="mt-6 space-y-4"><h2 class="text-lg font-semibold">운영팀과의 대화</h2>{#each inquiry.messages as item (item.id)}<article class="rounded-xl border p-4"><header class="flex justify-between gap-3 text-xs"><strong>{item.authorKind === "APPLICANT" ? "신청자" : "운영팀"}</strong><time class="text-muted-foreground">{koreanDate(item.createdAt)}</time></header><p class="mt-3 whitespace-pre-wrap text-sm leading-7">{item.body}</p></article>{:else}<p class="text-sm text-muted-foreground">아직 등록된 답변이 없어요.</p>{/each}</section>
    {#if inquiry.status !== "CLOSED"}<form onsubmit={send} class="mt-6 grid gap-3"><Label for="applicant-message">추가 문의·변경 요청</Label><Textarea id="applicant-message" bind:value={message} maxlength={5000} rows={5} required disabled={expired || busy} placeholder="추가 요청이나 변경하고 싶은 내용을 남겨 주세요." /><p class="text-xs text-muted-foreground">요청을 남겨도 확정된 공연 일정이 자동으로 바뀌지는 않아요.</p><Button type="submit" disabled={busy || expired || !message.trim()}>운영팀에 보내기</Button></form>{/if}
  {/if}
  {#if feedback}<p role="status" class="mt-5 rounded-lg bg-muted/30 p-4 text-sm leading-6">{feedback}</p>{/if}
</main>
