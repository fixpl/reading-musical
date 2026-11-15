<script lang="ts">
  import { untrack } from "svelte";
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { ArrowRight, Search, MapPin, CalendarDays } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { PageContainer } from "$lib/components/ui/page-container";
  import { PageHeader } from "$lib/components/ui/page-header";
  import { EmptyState } from "$lib/components/ui/empty-state";
  import { ErrorPanel } from "$lib/components/ui/error-panel";
  import { LoadingBlock } from "$lib/components/ui/loading-block";
  import { listRecruitmentOpportunities, type RecruitmentRound, type RecruitmentRole } from "$lib/api/recruitment";
  import { RECRUITMENT_ROLE_LABELS, recruitmentDateTime, recruitmentPeriod } from "$lib/domain/recruitment";

  const LIMIT = 20;
  let rounds = $state<RecruitmentRound[]>([]);
  let loading = $state(true);
  let loadError = $state("");
  let total = $state(0);
  let resultOffset = $state(0);
  let hasMore = $state(false);
  let request = 0;
  let controller: AbortController | null = null;
  const activeSearch = $derived((page.url.searchParams.get("q") || "").slice(0, 120));
  const activeRole: RecruitmentRole | "" = $derived(page.url.searchParams.get("role") === "ACTOR" || page.url.searchParams.get("role") === "STAFF" ? page.url.searchParams.get("role") as RecruitmentRole : "");
  const activeOffset = $derived(Math.max(0, Math.min(100000, Number.parseInt(page.url.searchParams.get("offset") || "0", 10) || 0)));
  let search = $derived(activeSearch);
  let role: RecruitmentRole | "" = $derived(activeRole);

  // 검색과 페이지 번호는 주소에 남겨 상세 화면에서 돌아와도 같은 목록을 연다.
  $effect(() => {
    const filters: { q: string; role: RecruitmentRole | ""; offset: number } = { q: activeSearch, role: activeRole, offset: activeOffset };
    untrack(() => { void load(filters); });
    return () => { request += 1; controller?.abort(); };
  });
  async function load(filters: { q: string; role: RecruitmentRole | ""; offset: number } = { q: activeSearch, role: activeRole, offset: activeOffset }) {
    controller?.abort();
    controller = new AbortController();
    const current = ++request;
    loading = true;
    loadError = "";
    try {
      const result = await listRecruitmentOpportunities({ ...filters, limit: LIMIT }, controller.signal);
      if (current !== request) return;
      rounds = result.items; total = result.total; resultOffset = result.offset; hasMore = result.hasMore;
    } catch {
      if (current === request) loadError = "모집 중인 공연을 불러오지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.";
    } finally { if (current === request) loading = false; }
  }
  function listHref(offset: number, q = activeSearch, selectedRole = activeRole) {
    const query = new URLSearchParams();
    if (q.trim()) query.set("q", q.trim());
    if (selectedRole) query.set("role", selectedRole);
    if (offset > 0) query.set("offset", String(offset));
    return `/app/opportunities${query.size ? `?${query}` : ""}`;
  }
  function submitSearch(event: SubmitEvent) {
    event.preventDefault();
    const href = listHref(0, search, role);
    if (href === `${page.url.pathname}${page.url.search}`) void load({ q: search.trim(), role, offset: 0 });
    else void goto(href);
  }
</script>

<svelte:head><title>참여할 공연 찾기 — 아트브릿지</title></svelte:head>
<PageContainer class="min-w-0 space-y-6">
  <PageHeader title="참여할 공연 찾기" description="모집 내용을 살펴보고 배우나 스태프로 지원해요. 참여는 공연팀의 확인을 거쳐 확정돼요.">
    {#snippet actions()}<Button href="/app/applications" variant="outline" class="min-h-11">내 지원 현황</Button>{/snippet}
  </PageHeader>
  <form class="grid min-w-0 items-end gap-3 rounded-xl border bg-card p-4 sm:grid-cols-[minmax(0,1fr)_10rem_auto]" onsubmit={submitSearch}>
    <div class="min-w-0 space-y-2"><Label for="opportunity-search">공연·모집 이름</Label><Input id="opportunity-search" class="min-h-11" maxlength={120} placeholder="찾고 싶은 공연이나 모집 이름" bind:value={search} /></div>
    <div class="space-y-2"><Label for="opportunity-role">참여 분야</Label><select id="opportunity-role" class="border-input bg-background focus-visible:outline-ring min-h-11 w-full rounded-lg border px-3 text-sm focus-visible:outline-2" bind:value={role}><option value="">전체</option><option value="ACTOR">배우</option><option value="STAFF">스태프</option></select></div>
    <Button type="submit" class="min-h-11"><Search class="size-4" aria-hidden="true" />검색</Button>
  </form>
  <p class="text-muted-foreground text-xs leading-6">가입할 때 고른 활동 분야와 달라도 모집 조건을 확인하고 지원할 수 있어요.</p>
  <div aria-live="polite" aria-busy={loading}>
    {#if loading}<LoadingBlock lines={6} class="rounded-xl border bg-card p-5" />
    {:else if loadError}<ErrorPanel message={loadError} onRetry={() => load()} class="[&_button]:min-h-11" />
    {:else if rounds.length === 0}
      <EmptyState title={activeOffset > 0 ? "이 페이지에 모집이 없어요" : activeSearch || activeRole ? "조건에 맞는 모집이 없어요" : "지금 접수 중인 모집이 없어요"} description={activeOffset > 0 ? "첫 페이지에서 모집을 다시 확인해 주세요." : activeSearch || activeRole ? "검색어나 참여 분야를 바꿔 다시 찾아보세요." : "새 모집이 시작되면 이곳에서 확인할 수 있어요. 이미 보낸 지원서는 내 지원 현황에서 확인해 주세요."}>
        {#snippet action()}<Button href={activeOffset > 0 ? listHref(0) : activeSearch || activeRole ? "/app/opportunities" : "/app/applications"} variant="outline" class="min-h-11">{activeOffset > 0 ? "첫 페이지로" : activeSearch || activeRole ? "전체 모집 보기" : "내 지원 현황"}</Button>{/snippet}
      </EmptyState>
    {:else}
      <p class="text-muted-foreground mb-4 text-sm">모집 {total}건 · {resultOffset + 1}–{resultOffset + rounds.length}번째</p>
      <div class="grid min-w-0 gap-4 lg:grid-cols-2">
        {#each rounds as round (round.id)}
          <article class="flex min-w-0 flex-col rounded-xl border bg-card p-5">
            <p class="text-muted-foreground text-xs leading-6 break-words">{round.productionTitle}</p>
            <h2 class="mt-1 text-lg font-semibold leading-7 break-words"><a href={`/app/opportunities/${round.id}`} class="hover:underline hover:underline-offset-4">{round.title}</a></h2>
            <p class="text-muted-foreground mt-3 line-clamp-3 text-sm leading-7 break-words">{round.summary}</p>
            <dl class="mt-4 grid gap-2 text-sm"><div class="flex gap-2"><dt class="sr-only">활동 지역</dt><MapPin class="text-muted-foreground mt-1 size-4 shrink-0" aria-hidden="true" /><dd class="break-words">{round.region || "활동 지역 미정"}</dd></div><div class="flex gap-2"><dt class="sr-only">참여 기간</dt><CalendarDays class="text-muted-foreground mt-1 size-4 shrink-0" aria-hidden="true" /><dd>{recruitmentPeriod(round.activityStartDate, round.activityEndDate)}</dd></div></dl>
            <ul class="mt-4 grid gap-2 rounded-lg bg-muted/40 p-3 text-xs leading-6">{#each round.positions.slice(0, 3) as position (position.id)}<li class="flex min-w-0 justify-between gap-3"><span class="min-w-0 break-words">{RECRUITMENT_ROLE_LABELS[position.role]} · {position.label}</span><span class="shrink-0">정원 {position.capacity}명 · 확정 {position.approvedCount}명</span></li>{/each}{#if round.positions.length > 3}<li class="text-muted-foreground">그 외 {round.positions.length - 3}자리 · 자세한 내용에서 확인</li>{/if}</ul>
            <div class="mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-4"><p class="text-muted-foreground text-xs leading-6">접수 마감 · {recruitmentDateTime(round.deadlineAt)}</p><Button href={`/app/opportunities/${round.id}`} variant="outline" class="min-h-11">모집 내용 보기<ArrowRight class="size-4" aria-hidden="true" /></Button></div>
          </article>
        {/each}
      </div>
      {#if resultOffset > 0 || hasMore}<nav class="mt-6 flex flex-wrap items-center justify-center gap-3" aria-label="모집 목록 페이지"><Button href={listHref(Math.max(0, resultOffset - LIMIT))} variant="outline" class="min-h-11" disabled={resultOffset === 0}>이전</Button><span class="text-muted-foreground text-sm">{Math.floor(resultOffset / LIMIT) + 1}페이지</span><Button href={listHref(resultOffset + LIMIT)} variant="outline" class="min-h-11" disabled={!hasMore}>다음</Button></nav>{/if}
    {/if}
  </div>
</PageContainer>
