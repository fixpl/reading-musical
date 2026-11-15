<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/stores";
  import { ArrowRight, ChevronDown, Plus, RefreshCw } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { PageHeader } from "$lib/components/ui/page-header";
  import { EmptyState } from "$lib/components/ui/empty-state";
  import OperationsChart from "$lib/components/admin/operations-chart.svelte";
  import { apiRequest } from "$lib/api/client";
  import { peek, remember } from "$lib/api/swr";
  import { captureSession, isCurrentSession } from "$lib/api/session";
  import { setNewInquiryCount } from "$lib/stores/admin-badges";
  import { countProductionPhases, nextRehearsalTask, rehearsalPreparationSteps, readinessStepLink, readinessStepState, type ProductionReadiness, type OperationStep } from "$lib/domain/operations-dashboard";
  import { INQUIRY_STATUS_LABELS, PHASE_LABELS, formatDateTime, formatRelative } from "$lib/domain/labels";

  type Stats = { productions: number; thisMonthEvents: number };
  type Inquiry = { id: string; orgName: string; contactName: string; status: string; message: string; createdAt: string };
  type Dashboard = { stats: Stats; inquiries: Inquiry[]; newCount: number; readiness: ProductionReadiness[]; waiting: number };

  // 메뉴를 오가도 빈 화면이 번쩍이지 않게, 받아 둔 값을 먼저 보여 주고 뒤에서 새로 받는다.
  let data = $state<Dashboard | null>(peek<Dashboard>("admin:dashboard") ?? null);
  let error = $state("");
  let refreshing = $state(false);
  let disposed = false;
  onMount(() => {
    void load();
    return () => { disposed = true; };
  });

  async function load() {
    if (refreshing) return;
    const session = captureSession();
    const active = () => !disposed && isCurrentSession(session);
    refreshing = true;
    error = "";
    try {
      const [stats, inbox, ready, members] = await Promise.all([
        apiRequest<Stats>("/admin/stats"),
        apiRequest<{ items: Inquiry[]; counts: Partial<Record<string, number>> }>("/admin/inquiries?take=5"),
        apiRequest<{ items: ProductionReadiness[] }>("/admin/overview"),
        apiRequest<{ counts: { unassigned: number } }>("/admin/members/search?take=1&assigned=no&status=ACTIVE")
      ]);
      if (active()) {
        const newCount = inbox.counts.NEW ?? 0;
        data = remember("admin:dashboard", { stats, inquiries: inbox.items, newCount, readiness: ready.items, waiting: members.counts.unassigned }, session);
        setNewInquiryCount(newCount);
      }
    } catch (cause) {
      if (active()) error = cause instanceof Error ? cause.message : "운영 정보를 불러오지 못했어요";
    } finally {
      if (active()) refreshing = false;
    }
  }

  const today = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "long", timeZone: "Asia/Seoul" }).format(new Date());
  const phaseCounts = $derived(countProductionPhases(data?.readiness ?? []));
  const displayReadiness = $derived((data?.readiness ?? []).filter((show) => !show.archived).sort((a, b) => {
    const nextA = a.nextEventAt ? Date.parse(a.nextEventAt) : Infinity;
    const nextB = b.nextEventAt ? Date.parse(b.nextEventAt) : Infinity;
    return nextA === nextB
      ? Date.parse(b.lastActivityAt ?? "1970-01-01") - Date.parse(a.lastActivityAt ?? "1970-01-01")
      : nextA - nextB;
  }).slice(0, 5));
  const stepLabel = (step: OperationStep) => ({ members: "공연팀", script: "대본·장면", video: "영상·배경", cues: "큐시트", schedule: "다음 일정" } as Record<string, string>)[step.key] ?? step.label;
  const stepDetail = (step: OperationStep) => step.key === "schedule" && step.done ? formatDateTime(step.detail) : step.detail;
</script>

<svelte:head><title>운영 현황 — 아트브릿지</title></svelte:head>

<div class="mx-auto w-full min-w-0 max-w-7xl space-y-7 pb-6 sm:space-y-8">
  <PageHeader title="운영 현황" description={today}>
    {#snippet actions()}
      <Button variant="outline" class="min-h-11" onclick={load} disabled={refreshing} aria-label="운영 현황 새로고침"><RefreshCw class={["size-4", refreshing && "motion-safe:animate-spin"]} aria-hidden="true" /><span class="hidden sm:inline">새로고침</span></Button>
      <Button href="/admin/assistant" variant="outline" class="min-h-11">공연 도우미</Button>
      <Button href="/admin/productions?create=1" class="min-h-11"><Plus class="size-4" aria-hidden="true" />공연 등록</Button>
    {/snippet}
  </PageHeader>

  {#if error}
    <section role="alert" class="bg-card rounded-xl border p-5"><p class="text-sm">{error} {data ? "아래는 이전에 불러온 내용이에요." : ""}</p><Button variant="outline" class="mt-3 min-h-11" onclick={load}>다시 불러오기</Button></section>
  {/if}
  {#if !data && !error}
    <div role="status" aria-label="운영 현황을 불러오는 중" class="space-y-5"><div class="bg-muted/40 h-36 rounded-xl motion-safe:animate-pulse lg:h-20"></div><div class="bg-muted/40 h-72 rounded-xl motion-safe:animate-pulse"></div></div>
  {:else if data}
    <dl class="bg-card grid grid-cols-2 overflow-hidden rounded-xl border lg:grid-cols-4">
      {#each [
        { label: "배정 대기 회원", value: data.waiting, unit: "명", href: "/admin/members?view=unassigned", hot: data.waiting > 0 },
        { label: "새 공연 신청", value: data.newCount, unit: "건", href: data.newCount > 0 ? "/admin/inquiries?status=NEW" : "/admin/inquiries", hot: data.newCount > 0 },
        { label: "등록 공연", value: data.stats.productions, unit: "편", href: "/admin/productions", hot: false },
        { label: "이번 달 일정", value: data.stats.thisMonthEvents, unit: "건", hot: false }
      ] as item (item.label)}
        <div class={["relative min-w-0 border-e border-b p-3 nth-2:border-e-0 nth-3:border-b-0 last:border-0 sm:p-4 lg:border-b-0 lg:nth-2:border-e", item.href && "hover:bg-muted/30 transition-colors"]}>
          <dt class="text-muted-foreground text-xs sm:text-sm">
            {#if item.href}<a href={item.href} aria-label={`${item.label} ${item.value}${item.unit}`} class="focus-visible:after:ring-ring after:absolute after:inset-1 after:rounded-md focus-visible:after:ring-2">{item.label}</a>{:else}{item.label}{/if}
          </dt>
          <dd class="mt-1 flex items-baseline gap-1"><span class={["text-2xl font-semibold tabular-nums tracking-tight", item.hot && "text-primary"]}>{item.value.toLocaleString()}</span><span class="text-muted-foreground text-xs">{item.unit}</span></dd>
        </div>
      {/each}
    </dl>
    {#if $page.data.site?.ready.inquiry === false}
      <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl border px-4 py-2">
        <p class="text-sm">기관·단체의 새 공연 신청은 접수 준비 중이에요.</p>
        <Button href="/admin/inquiries" variant="ghost" class="min-h-11 px-2">접수 준비 확인 <ArrowRight class="size-4" aria-hidden="true" /></Button>
      </div>
    {/if}

    <section id="production-registration" aria-labelledby="prod-title" class="min-w-0 scroll-mt-24">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 id="prod-title" class="text-lg font-semibold">공연별 다음 할 일</h2>
        <Button variant="outline" href="/admin/productions" class="min-h-11">전체 공연 보기</Button>
      </div>
      {#if !displayReadiness.length}
        <EmptyState class="mt-4" title={data.readiness.length ? "준비 중인 공연이 없어요" : "아직 등록된 공연이 없어요"} description="공연 이름을 입력하고 대본부터 준비해 보세요.">
          {#snippet action()}<Button href="/admin/productions?create=1" class="min-h-11">공연 등록</Button>{/snippet}
        </EmptyState>
      {:else}
        <div class="bg-card mt-4 overflow-hidden rounded-xl border">
          <ul class="divide-y">
            {#each displayReadiness as show (show.id)}
              {@const task = nextRehearsalTask(show)}
              <li class="min-w-0 px-4 sm:px-5">
                <div class="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 pt-3">
                  <div class="min-w-0 flex-1 basis-full sm:basis-0">
                    <a href={`/app/p/${show.id}`} class="inline-flex min-h-9 items-center font-semibold underline-offset-4 hover:underline [overflow-wrap:anywhere]">{show.title}</a>
                    <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <Badge variant="outline">{PHASE_LABELS[show.currentPhase] ?? show.currentPhase}</Badge>
                      {#if show.nextEventAt}<span class="text-muted-foreground text-xs">다음 일정 {formatDateTime(show.nextEventAt)}</span>
                      {:else if show.venue}<span class="text-muted-foreground break-words text-xs">{show.venue}</span>{/if}
                    </div>
                  </div>
                  <Button href={task ? `${readinessStepLink(show.id, task.key)}${task.query ?? ""}` : `/app/p/${show.id}`} variant={task ? "secondary" : "outline"} class="min-h-11" aria-label={`${show.title} · ${task?.label ?? "공연 홈 열기"}`}>
                    {task?.label ?? "공연 홈 열기"}<ArrowRight class="size-4" aria-hidden="true" />
                  </Button>
                </div>
                <details class="group">
                  <summary class="text-muted-foreground hover:text-foreground inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-xs font-medium">
                    준비 내역<ChevronDown class="size-3.5 group-open:rotate-180" aria-hidden="true" />
                  </summary>
                  <div class="mb-4 grid grid-cols-2 gap-2 rounded-lg bg-muted/30 p-2 sm:grid-cols-3 xl:grid-cols-5">
                    {#each [...rehearsalPreparationSteps(show), ...(show.casting ? [{ key: "casting", label: "배역 배정", ...show.casting }] : [])] as step (step.key)}
                      {@const state = step.key === "video" && !step.done ? "선택" : step.key === "casting" && step.detail === "배역 없음" ? "배역 없음" : readinessStepState(step)}
                      <a href={readinessStepLink(show.id, step.key)} class="hover:bg-background flex min-h-11 min-w-0 flex-col gap-1 rounded-md px-2.5 py-2 text-xs">
                        <span class="font-medium">{stepLabel(step)} <span class="text-muted-foreground font-normal">· {state}</span></span>
                        {#if step.detail !== "—" && step.detail !== state}<span class="text-muted-foreground break-words leading-4">{stepDetail(step)}</span>{/if}
                      </a>
                    {/each}
                  </div>
                </details>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </section>

    <div class="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
    <section aria-labelledby="inq-title" class="min-w-0">
      <div class="flex flex-wrap items-center justify-between gap-2"><h2 id="inq-title" class="text-base font-semibold">최근 공연 문의</h2><Button variant="ghost" href="/admin/inquiries" class="min-h-11">문의 전체 보기</Button></div>
      <ul class="bg-card mt-3 divide-y overflow-hidden rounded-xl border">
        {#each data.inquiries as inquiry (inquiry.id)}
          <li><a href={`/admin/inquiries/${inquiry.id}`} class="hover:bg-muted/40 flex min-w-0 flex-wrap items-center gap-3 px-4 py-4 transition-colors">
            <Badge variant={inquiry.status === "NEW" ? "default" : "secondary"}>{INQUIRY_STATUS_LABELS[inquiry.status] ?? inquiry.status}</Badge>
            <div class="min-w-0 flex-1"><p class="break-words text-sm font-medium">{inquiry.orgName} · {inquiry.contactName}</p><p class="text-muted-foreground mt-1 line-clamp-1 break-words text-xs">{inquiry.message}</p></div>
            <span class="text-muted-foreground text-xs">{formatRelative(inquiry.createdAt)}</span><ArrowRight class="text-muted-foreground size-4" aria-hidden="true" />
          </a></li>
        {:else}<li class="text-muted-foreground px-4 py-8 text-center text-sm">아직 접수된 문의가 없어요.</li>{/each}
      </ul>
    </section>
    <section aria-labelledby="phase-title" class="min-w-0">
      <div class="flex min-h-11 items-center justify-between gap-3"><h2 id="phase-title" class="text-base font-semibold">공연 진행 단계</h2><span class="text-muted-foreground text-xs">전체 {data.readiness.length}편</span></div>
      <div class="bg-card mt-3 rounded-xl border px-4 py-5">
        {#if data.readiness.length}<OperationsChart items={phaseCounts} />{:else}<p class="text-muted-foreground text-sm">아직 집계할 공연이 없어요.</p>{/if}
      </div>
    </section>
    </div>
  {/if}
</div>
