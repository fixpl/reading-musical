<script lang="ts">
  import { untrack, onMount } from "svelte";
  import { page } from "$app/state";
  import { ArrowLeft } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button";
  import { Label } from "$lib/components/ui/label";
  import { Textarea } from "$lib/components/ui/textarea";
  import { PageContainer } from "$lib/components/ui/page-container";
  import { PageHeader } from "$lib/components/ui/page-header";
  import { ErrorPanel } from "$lib/components/ui/error-panel";
  import { LoadingBlock } from "$lib/components/ui/loading-block";
  import WithdrawApplicationDialog from "$lib/components/recruitment/WithdrawApplicationDialog.svelte";
  import ApplicationRecord from "$lib/components/recruitment/ApplicationRecord.svelte";
  import { ApiError } from "$lib/api/client";
  import { getRecruitmentOpportunity, submitRecruitmentApplication, withdrawRecruitmentApplication, type RecruitmentOpportunityDetail } from "$lib/api/recruitment";
  import { RECRUITMENT_ROLE_LABELS, RECRUITMENT_ROUND_LABELS, RECRUITMENT_APPLICATION_LABELS, isPendingRecruitmentApplication, recruitmentDateTime, recruitmentPeriod, recruitmentApplicationGuidance, recruitmentTone } from "$lib/domain/recruitment";

  let detail = $state<RecruitmentOpportunityDetail | null>(null);
  let loading = $state(true);
  let loadError = $state("");
  let notFound = $state(false);
  let positionId = $state("");
  let message = $state("");
  let availability = $state("");
  let saving = $state(false);
  let submitError = $state("");
  let successMessage = $state("");
  let needsRefresh = $state(false);
  let hasUnsentDraft = $state(false);
  let withdrawOpen = $state(false);
  let withdrawing = $state(false);
  let withdrawError = $state("");
  let now = $state(Date.now());
  let request = 0;
  let controller: AbortController | null = null;
  const id = $derived(page.params.id || "");
  const round = $derived(detail?.round ?? null);
  const application = $derived(detail?.myApplication ?? null);
  const accepting = $derived(Boolean(round && round.effectiveStatus === "OPEN" && (!round.deadlineAt || Date.parse(round.deadlineAt) > now)));
  const mayApply = $derived(accepting && (!application || application.status === "WITHDRAWN"));
  const eligiblePositions = $derived(round?.positions.filter((position) => detail?.eligiblePositionIds.includes(position.id)) ?? []);
  const selectedPosition = $derived(round?.positions.find((position) => position.id === positionId) ?? null);

  onMount(() => { const interval = setInterval(() => { now = Date.now(); }, 15000); return () => clearInterval(interval); });
  $effect(() => {
    const currentId = id;
    untrack(() => { void load(currentId, false); });
    return () => { request += 1; controller?.abort(); };
  });
  async function load(currentId = id, preserveInput = true, afterWithdrawal = false) {
    controller?.abort(); controller = new AbortController();
    const revision = ++request;
    loading = true; loadError = ""; notFound = false;
    if (!preserveInput) { detail = null; positionId = ""; message = ""; availability = ""; submitError = ""; successMessage = ""; needsRefresh = false; withdrawOpen = false; hasUnsentDraft = false; saving = false; withdrawing = false; }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(currentId)) { notFound = true; loading = false; return; }
    try {
      const result = await getRecruitmentOpportunity(currentId, controller.signal);
      if (revision !== request || currentId !== id) return;
      detail = result; now = Date.now(); needsRefresh = false;
      if (!preserveInput) { message = result.myApplication?.message || ""; availability = result.myApplication?.availability || ""; positionId = result.myApplication?.positionId || (result.eligiblePositionIds.length === 1 ? result.eligiblePositionIds[0] : ""); }
      if (preserveInput) submitError = "모집 상태를 다시 확인했어요. 입력한 내용은 남아 있어요.";
    } catch (failure) {
      if (revision !== request) return;
      if (failure instanceof ApiError && (failure.status === 404 || failure.status === 400)) notFound = true;
      else loadError = afterWithdrawal ? "지원은 취소됐지만 다시 지원할 수 있는지 확인하지 못했어요. 모집 상태를 다시 불러와 주세요." : failure instanceof Error ? failure.message : "모집 내용을 불러오지 못했어요. 다시 확인해 주세요.";
    } finally { if (revision === request) loading = false; }
  }
  async function apply(event: SubmitEvent) {
    event.preventDefault();
    if (saving || !detail || !mayApply || needsRefresh) return;
    submitError = ""; successMessage = "";
    if (!detail.eligiblePositionIds.includes(positionId)) { submitError = "지원할 자리를 선택해 주세요."; return; }
    if (!message.trim()) { submitError = "지원 내용을 입력해 주세요."; return; }
    saving = true;
    const currentId = id;
    const actionRequest = request;
    try {
      const result = await submitRecruitmentApplication(currentId, { positionId, message: message.trim(), availability: availability.trim(), expectedRevision: application?.status === "WITHDRAWN" ? application.revision : 0 });
      if (currentId !== id || actionRequest !== request) return;
      detail = { ...detail, round: result.round, myApplication: result };
      hasUnsentDraft = false;
    } catch (failure) {
      if (currentId !== id || actionRequest !== request) return;
      hasUnsentDraft = true;
      submitError = failure instanceof Error ? failure.message : "지원서 전송 결과를 확인하지 못했어요. 입력한 내용은 남아 있어요.";
      needsRefresh = !(failure instanceof ApiError && failure.status === 400);
    } finally { if (currentId === id && actionRequest === request) saving = false; }
  }
  async function withdraw() {
    if (withdrawing || !application || !isPendingRecruitmentApplication(application.status)) return;
    withdrawing = true; withdrawError = "";
    const currentId = id;
    const actionRequest = request;
    try {
      const result = await withdrawRecruitmentApplication(application.id, application.revision);
      if (currentId !== id || actionRequest !== request || !detail) return;
      detail = { ...detail, round: result.round, myApplication: result };
      withdrawOpen = false; successMessage = "지원을 취소했어요.";
      withdrawing = false;
      await load(currentId, true, true);
    } catch (failure) {
      if (currentId !== id || actionRequest !== request) return;
      withdrawError = failure instanceof ApiError && failure.status === 409 ? "지원 상태가 바뀌었어요. 돌아간 뒤 모집 상태를 다시 확인해 주세요." : failure instanceof Error ? failure.message : "지원을 취소하지 못했어요. 지원 상태를 다시 확인해 주세요.";
      needsRefresh = true;
    } finally { if (currentId === id && actionRequest === request) withdrawing = false; }
  }
</script>

<svelte:head><title>{round?.title || "모집 내용"} — 아트브릿지</title></svelte:head>
<PageContainer class="min-w-0 max-w-4xl space-y-6">
  <a href="/app/opportunities" class="text-muted-foreground inline-flex min-h-11 items-center gap-2 text-sm hover:text-foreground"><ArrowLeft class="size-4" aria-hidden="true" />참여할 공연 찾기</a>
  {#if successMessage}<p role="status" class="rounded-lg border border-primary/25 bg-primary/5 p-4 text-sm leading-7">{successMessage}</p>{/if}
  {#if loading}<LoadingBlock lines={8} class="rounded-xl border bg-card p-5" />
  {:else if notFound}<div class="rounded-xl border bg-card p-6"><h1 class="text-xl font-semibold">모집을 찾을 수 없어요</h1><p class="text-muted-foreground mt-3 text-sm leading-7">주소가 바뀌었거나 더 이상 확인할 수 없는 모집이에요.</p><Button href="/app/opportunities" variant="outline" class="mt-5 min-h-11">모집 중인 공연 보기</Button></div>
  {:else if loadError}<div class="space-y-3"><ErrorPanel message={loadError} /><div class="flex justify-center"><Button variant="outline" class="min-h-11" onclick={() => load()}>모집 상태 다시 확인</Button></div></div>
  {:else if round && detail}
    <header><p class="text-muted-foreground mb-2 text-sm break-words">{round.productionTitle}</p><PageHeader title={round.title} description={round.summary} /><span class={`mt-2 inline-flex rounded-full border px-3 py-1 text-xs font-medium ${recruitmentTone(accepting ? "OPEN" : round.effectiveStatus === "CANCELLED" ? "CANCELLED" : "CLOSED")}`}>{accepting ? "접수 중" : round.effectiveStatus === "CANCELLED" ? RECRUITMENT_ROUND_LABELS.CANCELLED : RECRUITMENT_ROUND_LABELS.CLOSED}</span></header>
    <dl class="grid gap-5 rounded-xl border bg-card p-5 sm:grid-cols-2"><div><dt class="text-muted-foreground text-xs">활동 지역</dt><dd class="mt-1 text-sm leading-7 break-words">{round.region || "미정"}</dd></div><div><dt class="text-muted-foreground text-xs">참여 기간</dt><dd class="mt-1 text-sm leading-7">{recruitmentPeriod(round.activityStartDate, round.activityEndDate)}</dd></div><div class="sm:col-span-2"><dt class="text-muted-foreground text-xs">접수 마감 · 한국 시간</dt><dd class="mt-1 text-sm leading-7">{recruitmentDateTime(round.deadlineAt)}</dd></div></dl>
    <section aria-labelledby="round-description" class="space-y-4"><h2 id="round-description" class="text-lg font-semibold">함께 준비할 공연</h2><p class="whitespace-pre-wrap text-sm leading-8 break-words">{round.description}</p></section>
    <section aria-labelledby="round-conditions" class="space-y-3"><h2 id="round-conditions" class="text-lg font-semibold">참여 조건</h2><p class="whitespace-pre-wrap text-sm leading-8 break-words">{round.conditions || "별도 조건은 공연팀에서 안내해요."}</p></section>
    <section aria-labelledby="round-positions" class="space-y-3"><h2 id="round-positions" class="text-lg font-semibold">모집하는 자리</h2><ul class="divide-y rounded-xl border bg-card px-5">{#each round.positions as position (position.id)}<li class="flex min-w-0 flex-wrap items-start justify-between gap-2 py-4"><div class="min-w-0"><p class="font-medium break-words">{RECRUITMENT_ROLE_LABELS[position.role]} · {position.label}</p><p class="text-muted-foreground mt-1 text-xs leading-6">{position.role === "ACTOR" ? "배우로 참여하며, 배역은 추후 안내돼요." : "스태프로 참여하며, 담당 직무는 추후 안내돼요."}</p></div><p class="text-muted-foreground shrink-0 text-xs leading-6">정원 {position.capacity}명 · 참여 확정 {position.approvedCount}명</p></li>{/each}</ul></section>
    {#if application}
      <section class="rounded-xl border bg-card p-5" aria-labelledby="my-application-status"><div class="flex flex-wrap items-center justify-between gap-3"><h2 id="my-application-status" class="text-lg font-semibold">내 지원 현황</h2><span class={`rounded-full border px-3 py-1 text-xs font-medium ${recruitmentTone(application.status)}`}>{RECRUITMENT_APPLICATION_LABELS[application.status]}</span></div><p class="mt-3 text-sm leading-7">{RECRUITMENT_ROLE_LABELS[application.position.role]} · {application.position.label}</p><p class="text-muted-foreground mt-1 text-sm leading-7">{recruitmentApplicationGuidance(application.status, application.membershipId)}</p><div class="mt-4 flex flex-wrap gap-2">{#if application.status === "APPROVED" && application.membershipId}<Button href={`/app/p/${round.productionId}`} class="min-h-11">공연 열기</Button>{/if}<Button href="/app/applications" variant="outline" class="min-h-11">내 지원 모두 보기</Button>{#if isPendingRecruitmentApplication(application.status)}<Button variant="ghost" class="min-h-11" disabled={saving || withdrawing} onclick={() => { withdrawError = ""; withdrawOpen = true; }}>지원 취소</Button>{/if}{#if needsRefresh}<Button variant="outline" class="min-h-11" onclick={() => load()}>모집 상태 다시 확인</Button>{/if}</div><ApplicationRecord {application} /></section>
    {/if}
    {#if hasUnsentDraft && (!mayApply || eligiblePositions.length === 0)}
      <details class="rounded-xl border bg-card p-5"><summary class="inline-flex min-h-11 cursor-pointer items-center text-sm font-medium">보내지 못한 입력 내용</summary><p class="text-muted-foreground mt-2 text-xs leading-6">최신 지원 상태와 별도로 이번 화면에 적은 내용을 남겨 두었어요. 필요한 내용은 복사해 주세요. 다른 페이지로 이동하면 이 입력 내용은 사라져요.</p><div class="mt-3 space-y-3"><div class="space-y-2"><Label for="unsent-message">지원 내용</Label><Textarea id="unsent-message" value={message} readonly class="min-h-24" /></div>{#if availability}<div class="space-y-2"><Label for="unsent-availability">참여 가능한 시간</Label><Textarea id="unsent-availability" value={availability} readonly /></div>{/if}</div></details>
    {/if}
    {#if mayApply && eligiblePositions.length > 0}
      <section class="rounded-xl border bg-card p-5 sm:p-6" aria-labelledby="application-form-title"><h2 id="application-form-title" class="text-lg font-semibold">{application?.status === "WITHDRAWN" ? "다시 지원하기" : "이 모집에 지원하기"}</h2><p class="text-muted-foreground mt-3 text-sm leading-7">지원 내용과 직접 적은 참여 가능 시간은 이 공연의 모집 관리자에게 전달돼요. 지원만으로 참여가 확정되거나 이름·사진이 관객에게 공개되지는 않아요.</p>
        <form class="mt-5 space-y-5" onsubmit={apply} aria-busy={saving}><fieldset class="space-y-5" disabled={saving}>
          <fieldset class="space-y-2"><legend class="mb-2 text-sm font-medium">지원할 자리 <span class="text-muted-foreground">필수 · 한 자리 선택</span></legend>{#each round.positions as position (position.id)}<label class={`flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border p-3 ${!detail.eligiblePositionIds.includes(position.id) ? "opacity-60" : positionId === position.id ? "border-primary bg-primary/5" : ""}`}><input type="radio" name="recruitment-position" value={position.id} bind:group={positionId} required disabled={!detail.eligiblePositionIds.includes(position.id)} class="mt-1 size-4 shrink-0 accent-primary" /><span class="min-w-0"><span class="block text-sm font-medium break-words">{RECRUITMENT_ROLE_LABELS[position.role]} · {position.label}</span>{#if !detail.eligiblePositionIds.includes(position.id)}<span class="text-muted-foreground mt-1 block text-xs leading-6">이미 이 역할로 참여 중이어서 지원할 수 없어요.</span>{/if}</span></label>{/each}</fieldset>
          {#if selectedPosition}<p class="text-muted-foreground text-xs leading-6">{selectedPosition.role === "ACTOR" ? "승인되면 배우로 공연팀에 연결돼요. 배역은 별도로 배정돼요." : "승인되면 스태프로 공연팀에 연결돼요. 담당 직무는 별도로 안내돼요."}</p>{/if}
          <div class="space-y-2"><Label for="application-message">지원 내용 <span class="text-muted-foreground">필수</span></Label><Textarea id="application-message" class="min-h-36" bind:value={message} maxlength={2000} required placeholder="참여하고 싶은 이유와 공연팀에 전할 경험을 적어 주세요." /><p class="text-muted-foreground text-right text-xs">{message.length}/2,000자</p></div>
          <div class="space-y-2"><Label for="application-availability">참여 가능한 시간 <span class="text-muted-foreground">선택</span></Label><Textarea id="application-availability" class="min-h-24" bind:value={availability} maxlength={1000} placeholder="예: 평일 저녁, 토요일 오후에 참여할 수 있어요." /><p class="text-muted-foreground text-xs leading-6">다른 공연이나 개인 일정은 가져오지 않아요. 이 모집에 필요한 시간만 직접 적어 주세요.</p></div>
          {#if submitError}<p role={needsRefresh ? "alert" : "status"} class="text-sm leading-7">{submitError}</p>{/if}
          <div class="flex flex-wrap justify-end gap-2">{#if needsRefresh}<Button type="button" variant="outline" class="min-h-11" onclick={() => load()}>모집 상태 다시 확인</Button>{/if}<Button type="submit" class="min-h-11" disabled={saving || needsRefresh || !positionId || !message.trim()}>{saving ? "보내는 중…" : "지원서 보내기"}</Button></div>
        </fieldset></form>
      </section>
    {:else if !application || application.status === "WITHDRAWN"}
      <div class="rounded-xl border bg-muted/30 p-5"><p class="text-sm leading-7">{accepting ? "이미 모집 분야의 역할로 공연에 참여 중이어서 지원할 자리가 없어요." : round.effectiveStatus === "CANCELLED" ? "이 모집은 취소됐어요. 다른 모집을 찾아보세요." : "접수가 마감되어 지금은 지원할 수 없어요."}</p><Button href="/app/opportunities" variant="outline" class="mt-3 min-h-11">다른 모집 보기</Button></div>
    {/if}
  {/if}
</PageContainer>
{#if withdrawOpen && application && round}<WithdrawApplicationDialog title={round.title} busy={withdrawing} error={withdrawError} onConfirm={() => void withdraw()} onCancel={() => withdrawOpen = false} />{/if}
