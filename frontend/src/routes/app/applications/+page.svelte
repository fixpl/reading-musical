<script lang="ts">
  import { untrack } from "svelte";
  import { page } from "$app/state";
  import { Button } from "$lib/components/ui/button";
  import { PageContainer } from "$lib/components/ui/page-container";
  import { PageHeader } from "$lib/components/ui/page-header";
  import { EmptyState } from "$lib/components/ui/empty-state";
  import { ErrorPanel } from "$lib/components/ui/error-panel";
  import { LoadingBlock } from "$lib/components/ui/loading-block";
  import WithdrawApplicationDialog from "$lib/components/recruitment/WithdrawApplicationDialog.svelte";
  import ApplicationRecord from "$lib/components/recruitment/ApplicationRecord.svelte";
  import { ApiError } from "$lib/api/client";
  import { listMyRecruitmentApplications, withdrawRecruitmentApplication, type RecruitmentApplication } from "$lib/api/recruitment";
  import { RECRUITMENT_ROLE_LABELS, RECRUITMENT_APPLICATION_LABELS, isPendingRecruitmentApplication, recruitmentDateTime, recruitmentApplicationGuidance, recruitmentTone } from "$lib/domain/recruitment";

  const LIMIT = 20;
  let applications = $state<RecruitmentApplication[]>([]);
  let total = $state(0);
  let resultOffset = $state(0);
  let hasMore = $state(false);
  let loading = $state(true);
  let loadError = $state("");
  let announcement = $state("");
  let selected = $state<RecruitmentApplication | null>(null);
  let withdrawing = $state(false);
  let withdrawError = $state("");
  let needsRefresh = $state(false);
  let request = 0;
  let controller: AbortController | null = null;
  const offset = $derived(Math.max(0, Math.min(100000, Number.parseInt(page.url.searchParams.get("offset") || "0", 10) || 0)));
  $effect(() => {
    const currentOffset = offset;
    untrack(() => { selected = null; withdrawing = false; void load(currentOffset); });
    return () => { request += 1; controller?.abort(); };
  });
  async function load(currentOffset = offset) {
    controller?.abort(); controller = new AbortController();
    const revision = ++request;
    loading = true; loadError = "";
    try {
      const result = await listMyRecruitmentApplications({ limit: LIMIT, offset: currentOffset }, controller.signal);
      if (revision !== request) return;
      applications = result.items; total = result.total; resultOffset = result.offset; hasMore = result.hasMore; needsRefresh = false;
    } catch { if (revision === request) loadError = "내 지원 현황을 불러오지 못했어요. 다시 확인해 주세요."; }
    finally { if (revision === request) loading = false; }
  }
  async function withdraw() {
    if (withdrawing || !selected || !isPendingRecruitmentApplication(selected.status)) return;
    withdrawing = true; withdrawError = ""; announcement = "";
    const actionRequest = request;
    const application = selected;
    try {
      const result = await withdrawRecruitmentApplication(application.id, application.revision);
      if (actionRequest !== request) return;
      applications = applications.map((item) => item.id === result.id ? result : item);
      selected = null; announcement = "지원을 취소했어요. 접수 중인 모집에는 다시 지원할 수 있어요.";
      needsRefresh = false;
    } catch (failure) {
      if (actionRequest !== request) return;
      withdrawError = failure instanceof ApiError && failure.status === 409 ? "지원 상태가 바뀌었어요. 돌아간 뒤 지원 현황을 다시 확인해 주세요." : failure instanceof Error ? failure.message : "지원 취소 결과를 확인하지 못했어요. 지원 현황을 다시 확인해 주세요.";
      needsRefresh = true;
    } finally { if (actionRequest === request) withdrawing = false; }
  }
  function listHref(nextOffset: number) { return `/app/applications${nextOffset > 0 ? `?offset=${nextOffset}` : ""}`; }
</script>

<svelte:head><title>내 지원 현황 — 아트브릿지</title></svelte:head>
<PageContainer class="min-w-0 max-w-4xl space-y-6">
  <PageHeader title="내 지원 현황" description="보낸 지원서와 공연팀의 안내를 확인해요. 참여가 확정되면 내 공연에서 준비를 시작할 수 있어요.">{#snippet actions()}<Button href="/app/opportunities" variant="outline" class="min-h-11">참여할 공연 찾기</Button>{/snippet}</PageHeader>
  {#if announcement}<p role="status" class="rounded-lg border border-primary/25 bg-primary/5 p-4 text-sm leading-7">{announcement}</p>{/if}
  {#if needsRefresh && !selected}<div class="rounded-xl border p-4"><p class="text-sm leading-7">지원 상태가 바뀌었을 수 있어요. 최신 현황을 확인해 주세요.</p><Button variant="outline" class="mt-3 min-h-11" onclick={() => load()}>지원 현황 다시 확인</Button></div>{/if}
  {#if loading}<LoadingBlock lines={7} class="rounded-xl border bg-card p-5" />
  {:else if loadError}<ErrorPanel message={loadError} onRetry={() => load()} class="[&_button]:min-h-11" />
  {:else if applications.length === 0}
    <EmptyState title={resultOffset > 0 ? "이 페이지에 지원 내역이 없어요" : "아직 보낸 지원서가 없어요"} description={resultOffset > 0 ? "최근 지원 현황에서 다시 확인해 주세요." : "모집 내용을 살펴보고 함께하고 싶은 공연에 지원해 보세요."}>{#snippet action()}<Button href={resultOffset > 0 ? "/app/applications" : "/app/opportunities"} class="min-h-11">{resultOffset > 0 ? "최근 지원 현황" : "참여할 공연 찾기"}</Button>{/snippet}</EmptyState>
  {:else}
    <p class="text-muted-foreground text-sm">지원 {total}건 · {resultOffset + 1}–{resultOffset + applications.length}번째</p>
    <div class="space-y-4">
      {#each applications as application (application.id)}
        <article class="min-w-0 rounded-xl border bg-card p-5">
          <div class="flex min-w-0 flex-wrap items-start justify-between gap-3"><div class="min-w-0 flex-1 basis-56"><p class="text-muted-foreground text-xs leading-6 break-words">{application.round.productionTitle}</p><h2 class="mt-1 text-lg font-semibold leading-7 break-words"><a href={`/app/opportunities/${application.roundId}`} class="hover:underline hover:underline-offset-4">{application.round.title}</a></h2><p class="mt-2 text-sm leading-7 break-words">{RECRUITMENT_ROLE_LABELS[application.position.role]} · {application.position.label}</p></div><span class={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium ${recruitmentTone(application.status)}`}>{RECRUITMENT_APPLICATION_LABELS[application.status]}</span></div>
          <p class="text-muted-foreground mt-3 text-sm leading-7">{recruitmentApplicationGuidance(application.status, application.membershipId)}</p>
          {#if application.reviewMessage}<p class="mt-3 whitespace-pre-wrap rounded-lg bg-muted/40 px-3 py-2 text-sm leading-7 break-words">{application.reviewMessage}</p>{/if}
          <p class="text-muted-foreground mt-3 text-xs leading-6">최근 변경 · {recruitmentDateTime(application.updatedAt)}</p>
          <div class="mt-4 flex flex-wrap gap-2">{#if application.status === "APPROVED" && application.membershipId}<Button href={`/app/p/${application.round.productionId}`} class="min-h-11">공연 열기</Button>{:else if application.status === "WITHDRAWN" && application.round.effectiveStatus === "OPEN"}<Button href={`/app/opportunities/${application.roundId}`} class="min-h-11">다시 지원하기</Button>{/if}<Button href={`/app/opportunities/${application.roundId}`} variant="outline" class="min-h-11">모집 내용 보기</Button>{#if isPendingRecruitmentApplication(application.status)}<Button variant="ghost" class="min-h-11" disabled={withdrawing || needsRefresh} onclick={() => { selected = application; withdrawError = ""; }}>지원 취소</Button>{/if}</div>
          <ApplicationRecord {application} />
        </article>
      {/each}
    </div>
    {#if resultOffset > 0 || hasMore}<nav class="flex flex-wrap items-center justify-center gap-3" aria-label="내 지원 현황 페이지"><Button href={listHref(Math.max(0, resultOffset - LIMIT))} variant="outline" class="min-h-11" disabled={resultOffset === 0}>이전</Button><span class="text-muted-foreground text-sm">{Math.floor(resultOffset / LIMIT) + 1}페이지</span><Button href={listHref(resultOffset + LIMIT)} variant="outline" class="min-h-11" disabled={!hasMore}>다음</Button></nav>{/if}
  {/if}
</PageContainer>
{#if selected}<WithdrawApplicationDialog title={selected.round.title} busy={withdrawing} error={withdrawError} onConfirm={() => void withdraw()} onCancel={() => selected = null} />{/if}
