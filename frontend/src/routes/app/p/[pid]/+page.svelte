<script lang="ts">
  import { page } from "$app/stores";
  import { toast } from "svelte-sonner";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { PageContainer } from "$lib/components/ui/page-container";
  import { PageHeader } from "$lib/components/ui/page-header";
  import { EmptyState } from "$lib/components/ui/empty-state";
  import { ErrorPanel } from "$lib/components/ui/error-panel";
  import { LoadingBlock } from "$lib/components/ui/loading-block";
  import { apiRequest } from "$lib/api/client";
  import { fetchCurrentUser } from "$lib/api/auth";
  import { getProductionAccess, type ProductionAccess } from "$lib/api/production-access";
  import { getMyProduction, isProductionStaff, type MyProduction } from "$lib/api/productions";
  import { hasScriptMaterial, type CompositionBoard } from "$lib/domain/composition";
  import { nextScriptTask } from "$lib/domain/operations-dashboard";
  import { groupCalendarDays } from "$lib/domain/schedule-calendar";
  import { formatTimelineTime } from "$lib/domain/performance-timeline";
  import {
    EVENT_TYPE_LABELS,
    PHASE_LABELS,
    PRODUCTION_ROLE_LABELS,
    formatDate,
    formatDateTime,
    formatRelative
  } from "$lib/domain/labels";
  import ChevronLeftIcon from "@lucide/svelte/icons/chevron-left";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";

  type AttendanceStatus = "ACCEPTED" | "DECLINED" | "TENTATIVE";
  const RESPONSES: Array<{ status: AttendanceStatus; label: string }> = [
    { status: "ACCEPTED", label: "참석" }, { status: "DECLINED", label: "불참" }, { status: "TENTATIVE", label: "미정" }
  ];
  type WorkspaceEvent = {
    id: string;
    type: string;
    title: string;
    startAt: string;
    endAt: string;
    location: string | null;
    attendances: Array<{ id: string; status: string; membership: { id: string; user?: { id: string } | null } }>;
  };

  type Post = {
    id: string;
    category: "NOTICE" | "QUESTION" | "MATERIAL";
    title: string;
    pinned: boolean;
    createdAt: string;
    author: { id: string; name: string };
    _count: { comments: number };
  };

  type Person = {
    id: string;
    primaryRole: string;
    user: { id: string; name: string; status?: string };
    castAssignments?: Array<{ role: { id: string } }>;
  };

  type ProductionDetail = {
    id: string;
    title: string;
    venue: string | null;
    synopsis: string | null;
    startDate: string | null;
    endDate: string | null;
  };

  const CATEGORY_LABELS: Record<string, string> = { NOTICE: "공지", QUESTION: "대화", MATERIAL: "자료" };

  const pid = $derived($page.params.pid ?? "");

  let production = $state<MyProduction | null>(null);
  let detail = $state<ProductionDetail | null>(null);
  let events = $state<WorkspaceEvent[]>([]);
  let posts = $state<Post[]>([]);
  let people = $state<Person[]>([]);
  let nextEvent = $state<WorkspaceEvent | null>(null);
  let myAttendanceStatus = $state<string | null>(null);
  let loading = $state(true);
  let responding = $state(false);
  let canManage = $state(false);
  let access = $state<ProductionAccess | null>(null);
  let scriptPreparation = $state<{ canEdit: boolean; hasMaterial: boolean; hasRegisteredScript: boolean; hasLinkedScene: boolean } | null>(null);
  let roleIds = $state<string[] | null>(null);
  let loadError = $state("");
  let sectionErrors = $state({ detail: "", schedule: "", board: "", people: "", records: "" });
  let resume = $state<{ source: string; positionMs: number; completedKeys: string[]; updatedAt: string } | null>(null);
  const resumeLink = $derived(resume ? `/app/p/${pid}/live?${new URLSearchParams({ source: resume.source, at: String(resume.positionMs) })}` : `/app/p/${pid}/live`);
  const compositionLink = $derived(`/app/p/${pid}/composition`);
  const membersLink = $derived(`/app/p/${pid}/${access?.canManageMembers ? "manage/members" : "people"}`);
  const castingLink = $derived(`/app/p/${pid}/manage/casting`);
  const assignedRoles = $derived(new Set(people.filter((person) => person.user.status === "ACTIVE")
    .flatMap((person) => (person.castAssignments ?? []).map((assignment) => assignment.role.id))));
  const unassignedRoles = $derived(roleIds?.filter((id) => !assignedRoles.has(id)).length ?? 0);
  const canPlanSchedule = $derived(access?.canCreateSchedule && access.scheduleEditScope === "ALL");
  const nextTask = $derived.by(() => {
    const scriptTask = scriptPreparation?.canEdit && nextScriptTask(scriptPreparation);
    if (scriptTask) return { label: scriptTask.label, href: `${compositionLink}${scriptTask.query ?? ""}` };
    if (!sectionErrors.people && people.length < 2 && access?.canManageMembers) {
      return { label: "공연팀 추가하기", href: membersLink };
    }
    if (!sectionErrors.people && access?.canEditCasting && unassignedRoles) {
      return { label: "배역 배정하기", href: castingLink };
    }
    if (!sectionErrors.schedule && !nextEvent && canPlanSchedule) {
      return { label: "다음 일정 잡기", href: `/app/p/${pid}/schedule?create=1` };
    }
    return { label: resume ? "이어서 연습" : "연습 화면 열기", href: resumeLink };
  });

  let loadRevision = 0;
  async function loadPage() {
    const revision = ++loadRevision;
    const productionId = pid;
    loading = true; loadError = ""; responding = false;
    production = null; detail = null; events = []; posts = []; people = []; nextEvent = null; myAttendanceStatus = null;
    canManage = false; resume = null; access = null; scriptPreparation = null; roleIds = null;
    sectionErrors = { detail: "", schedule: "", board: "", people: "", records: "" };
    try {
      const [me, found] = await Promise.all([fetchCurrentUser(), getMyProduction(productionId)]);
      if (revision !== loadRevision || productionId !== pid) return;
      production = found;
      if (!found) return;
      canManage = isProductionStaff(found, me?.platformRole);
      const [detailResult, schedule, board, peopleResult, records, accessResult, composition, roles] = await Promise.allSettled([
        apiRequest<ProductionDetail>(`/productions/${productionId}`),
        apiRequest<{ events: WorkspaceEvent[] }>(`/productions/${productionId}/schedule`),
        apiRequest<{ items: Post[] }>(`/productions/${productionId}/board?visibility=TEAM&limit=4`),
        apiRequest<{ people: Person[] }>(`/productions/${productionId}/people`),
        apiRequest<Array<{ source: string; positionMs: number; completedKeys: string[]; updatedAt: string }>>(`/productions/${productionId}/rehearsal/me`),
        canManage ? getProductionAccess(productionId) : null,
        canManage ? apiRequest<CompositionBoard>(`/productions/${productionId}/composition`) : null,
        canManage ? apiRequest<Array<{ id: string }>>(`/productions/${productionId}/roles`) : null
      ]);
      if (revision !== loadRevision || productionId !== pid) return;
      // 목록이 비어 있는 경우와 조회 실패를 구분해 다음 연습을 잘못 판단하지 않게 해요.
      sectionErrors = {
        detail: detailResult.status === "rejected" ? "공연의 장소와 기간을 불러오지 못했어요." : "",
        schedule: schedule.status === "rejected" ? "다음 일정을 불러오지 못했어요." : "",
        board: board.status === "rejected" ? "공연팀의 최근 소식을 불러오지 못했어요." : "",
        people: peopleResult.status === "rejected" ? "공연팀 목록을 불러오지 못했어요." : "",
        records: records.status === "rejected" ? "저장한 연습 위치를 불러오지 못했어요. 이어서 연습하려면 다시 시도해 주세요." : ""
      };
      if (detailResult.status === "fulfilled") detail = detailResult.value;
      if (board.status === "fulfilled") posts = board.value.items.slice(0, 4);
      if (peopleResult.status === "fulfilled") people = peopleResult.value.people;
      if (accessResult.status === "fulfilled") access = accessResult.value;
      if (roles.status === "fulfilled" && roles.value) roleIds = roles.value.map((role) => role.id);
      if (composition.status === "fulfilled" && composition.value) {
        scriptPreparation = {
          canEdit: composition.value.canEdit,
          hasMaterial: composition.value.sections.some(hasScriptMaterial),
          hasRegisteredScript: composition.value.scripts.length > 0,
          hasLinkedScene: composition.value.sections.some((section) => section.sourceSceneId)
        };
      }
      if (records.status === "fulfilled") resume = [...records.value].filter((row) => row.positionMs > 0).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] ?? null;
      if (schedule.status === "fulfilled") {
        events = schedule.value.events;
        const upcoming = [...events]
          .filter((event) => new Date(event.endAt).getTime() >= Date.now())
          .filter((event) => canManage || event.attendances.some((attendance) => attendance.membership.user?.id === me?.id))
          .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
        nextEvent = upcoming[0] ?? null;
        if (nextEvent && me) myAttendanceStatus = nextEvent.attendances.find((attendance) => attendance.membership.user?.id === me.id)?.status ?? null;
      }
    } catch {
      if (revision === loadRevision && productionId === pid) loadError = "공연 정보를 불러오지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.";
    } finally {
      if (revision === loadRevision && productionId === pid) loading = false;
    }
  }

  $effect(() => {
    void pid;
    void loadPage();
    return () => { loadRevision += 1; };
  });

  async function respond(status: AttendanceStatus) {
    if (!nextEvent || responding || myAttendanceStatus === status) return;
    const productionId = pid, eventId = nextEvent.id;
    responding = true;
    try {
      await apiRequest(`/productions/${productionId}/events/${eventId}/attendance`, { method: "POST", body: JSON.stringify({ status }) });
      if (productionId !== pid || nextEvent?.id !== eventId) return;
      myAttendanceStatus = status;
      toast.success(`${RESPONSES.find((response) => response.status === status)?.label}으로 응답했어요.`);
    } catch (error) {
      if (productionId === pid) toast.error(error instanceof Error ? error.message : "참석 여부를 저장하지 못했어요.");
    } finally { if (productionId === pid) responding = false; }
  }

  // ── 미니 달력 ──
  const today = new Date();
  let calYear = $state(today.getFullYear());
  let calMonth = $state(today.getMonth()); // 0-11

  const dayKey = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

  const eventDays = $derived.by(() => {
    return new Map([...groupCalendarDays(events, (event) => event, calYear, calMonth)].map(([key, rows]) => [key, rows.length]));
  });

  const calendarCells = $derived.by(() => {
    const first = new Date(calYear, calMonth, 1);
    const cells: Array<{ key: string; day: number; inMonth: boolean; isToday: boolean; eventCount: number }> = [];
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    for (let i = 0; i < 42; i += 1) {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      const key = dayKey(date);
      cells.push({
        key,
        day: date.getDate(),
        inMonth: date.getMonth() === calMonth,
        isToday: key === dayKey(today),
        eventCount: eventDays.get(key) ?? 0
      });
    }
    return cells;
  });

  function moveMonth(delta: number) {
    const next = new Date(calYear, calMonth + delta, 1);
    calYear = next.getFullYear();
    calMonth = next.getMonth();
  }

  const monthEventCount = $derived(
    events.filter((event) => {
      return Date.parse(event.startAt) < new Date(calYear, calMonth + 1, 1).getTime() && Date.parse(event.endAt) > new Date(calYear, calMonth, 1).getTime();
    }).length
  );

  const myRoles = $derived([...new Set([production?.myMembership?.primaryRole, ...(production?.myMembership?.roles ?? [])].filter((role): role is string => Boolean(role)))]);
  const myRole = $derived(myRoles.map((role) => PRODUCTION_ROLE_LABELS[role] ?? role).join(" · "));
  const isStaff = $derived(myRoles.includes("STAFF"));
  const attendanceLabel = $derived(myAttendanceStatus === "INVITED" ? "미응답" : RESPONSES.find((response) => response.status === myAttendanceStatus)?.label ?? "");
  const nextEventLink = $derived(nextEvent ? `/app/p/${pid}/schedule?eventId=${nextEvent.id}` : `/app/p/${pid}/schedule`);

  const periodText = $derived.by(() => {
    if (!detail?.startDate) return null;
    const start = formatDate(detail.startDate);
    return detail.endDate && detail.endDate !== detail.startDate ? `${start} ~ ${formatDate(detail.endDate)}` : start;
  });
</script>

<svelte:head><title>{production?.title ?? "공연"} — 아트브릿지</title></svelte:head>

<PageContainer class="min-w-0 space-y-5">
  {#if loading}
    <LoadingBlock lines={8} class="rounded-2xl border bg-card p-6" />
  {:else if loadError}
    <ErrorPanel class="[&_button]:min-h-11" title="공연을 확인하지 못했어요" message={loadError} onRetry={() => void loadPage()} />
  {:else if !production}
    <EmptyState title="참여 중인 공연을 찾지 못했어요" description="공연팀에 배정 상태를 확인하거나 내 공연 목록에서 다시 선택해 주세요.">
      {#snippet action()}<Button href="/app" variant="outline" class="min-h-11">내 공연으로</Button>{/snippet}
    </EmptyState>
  {:else}
    <PageHeader title={production.title} description={[myRole ? `내 역할 · ${myRole}` : null, detail?.venue, periodText].filter(Boolean).join(" · ")}>
      {#snippet actions()}
        {#if canManage}
          <Button href={resumeLink} variant="outline" class="min-h-11">개인 연습</Button>
          <Button href={`/app/p/${pid}/cuesheet`} variant="outline" class="min-h-11">큐시트 보기</Button>
        {:else if isStaff}
          <Button href={`/app/p/${pid}/cuesheet`} class="min-h-11">큐시트 보기</Button>
          <Button href={resumeLink} variant="outline" class="min-h-11">{resume ? "이어서 연습" : "개인 연습"}</Button>
          <Button href={`/app/p/${pid}/script`} variant="outline" class="min-h-11">대본 읽기</Button>
        {:else}
          <Button href={resumeLink} class="min-h-11">{resume ? `이어서 연습 · ${formatTimelineTime(resume.positionMs)}` : "개인 연습 시작"}</Button>
          <Button href={`/app/p/${pid}/script`} variant="outline" class="min-h-11">대본 읽기</Button>
        {/if}
      {/snippet}
    </PageHeader>
    <div class="flex flex-wrap items-center gap-2"><Badge variant="secondary">{PHASE_LABELS[production.currentPhase] ?? production.currentPhase}</Badge>{#if !canManage}<span class="text-muted-foreground text-sm">{isStaff ? "큐시트에서 담당 트랙과 다음 큐를 확인해요." : "대본을 읽고, 맡은 파트를 반복해서 연습해요."}</span>{/if}</div>
    {#if detail?.synopsis}<p class="text-muted-foreground max-w-3xl text-sm leading-6">{detail.synopsis}</p>{/if}
    {#if sectionErrors.detail}<ErrorPanel class="[&_button]:min-h-11" message={sectionErrors.detail} onRetry={() => void loadPage()} />{/if}
    {#if sectionErrors.records}<ErrorPanel class="[&_button]:min-h-11" message={sectionErrors.records} onRetry={() => void loadPage()} />{/if}

    {#if canManage}
      <section aria-labelledby="rehearsal-prep" class="min-w-0 overflow-hidden rounded-2xl border bg-card">
        <div class="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/35 px-4 py-3 sm:px-5">
          <h2 id="rehearsal-prep" class="text-lg font-semibold">다음 연습 준비</h2>
          <Button href={nextTask.href} class="min-h-11">{nextTask.label}</Button>
        </div>
        <dl class="grid grid-cols-2 gap-x-5 gap-y-1 px-4 py-2 sm:px-5 {access?.canEditCasting ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}">
          <div class="min-w-0"><dt class="text-muted-foreground pt-2 text-xs">대본·장면</dt><dd><a href={compositionLink} class="inline-flex min-h-11 items-center text-sm font-medium underline-offset-4 hover:underline">{!scriptPreparation ? "등록 상태 확인" : scriptPreparation.hasMaterial ? "등록한 장면 보기" : scriptPreparation.hasLinkedScene ? "장면 내용 없음" : scriptPreparation.hasRegisteredScript ? "대본 등록됨 · 장면 구성 전" : "등록 전"}</a></dd></div>
          <div class="min-w-0"><dt class="text-muted-foreground pt-2 text-xs">공연팀</dt><dd><a href={membersLink} class="inline-flex min-h-11 items-center text-sm font-medium underline-offset-4 hover:underline">{sectionErrors.people ? "공연팀 확인" : people.length ? `${people.length}명 참여 중` : "아직 배정된 멤버 없음"}</a></dd></div>
          {#if access?.canEditCasting}<div class="min-w-0"><dt class="text-muted-foreground pt-2 text-xs">배역</dt><dd><a href={castingLink} class="inline-flex min-h-11 items-center text-sm font-medium underline-offset-4 hover:underline">{!roleIds || sectionErrors.people ? "배역 확인" : roleIds.length ? `${roleIds.length - unassignedRoles}/${roleIds.length}개 배정` : "등록된 배역 없음"}</a></dd></div>{/if}
          <div class="min-w-0"><dt class="text-muted-foreground pt-2 text-xs">다음 일정</dt><dd><a href={nextEventLink} class="inline-flex min-h-11 items-center text-sm font-medium underline-offset-4 hover:underline">{sectionErrors.schedule ? "일정 확인" : nextEvent ? formatDateTime(nextEvent.startAt) : "예정된 일정 없음"}</a></dd></div>
        </dl>
      </section>
    {/if}

    <div class="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div class="min-w-0 space-y-5">
        <section class="min-w-0" aria-labelledby="next-production-event">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 id="next-production-event" class="text-lg font-semibold">{canManage ? "다음 공연 일정" : "다음 내 일정"}</h2><Button href={`/app/p/${pid}/schedule`} variant="ghost" class="min-h-11">일정 모두 보기</Button></div>
          {#if sectionErrors.schedule}
            <ErrorPanel class="[&_button]:min-h-11" message={sectionErrors.schedule} onRetry={() => void loadPage()} />
          {:else if nextEvent}
            <article class="min-w-0 space-y-4 rounded-2xl border border-primary/25 bg-card p-5 sm:p-6">
              <div class="flex flex-wrap items-center gap-2"><Badge variant="outline">{EVENT_TYPE_LABELS[nextEvent.type] ?? nextEvent.type}</Badge>{#if Date.parse(nextEvent.startAt) <= Date.now()}<Badge variant="secondary">진행 중</Badge>{/if}</div>
              <div><h3 class="break-words text-xl font-semibold">{nextEvent.title}</h3><p class="mt-2 text-sm leading-6">{formatDateTime(nextEvent.startAt)} ~ {formatDateTime(nextEvent.endAt)}</p><p class="text-muted-foreground text-sm">{nextEvent.location || "장소는 아직 정해지지 않았어요."}</p></div>
              {#if myAttendanceStatus}
                <div class="space-y-2 border-t pt-4"><p class="text-sm">내 응답 <span class="ms-1 font-semibold">{attendanceLabel}</span>{#if myAttendanceStatus === "INVITED"}<span class="text-muted-foreground ms-2">참석 여부를 알려 주세요.</span>{/if}</p>
                  <div class="flex flex-wrap gap-2" role="group" aria-label={`${nextEvent.title} 참석 여부`}>
                    {#each RESPONSES as response (response.status)}<Button variant={myAttendanceStatus === response.status ? "secondary" : "outline"} class="min-h-11 min-w-16" aria-pressed={myAttendanceStatus === response.status} disabled={responding || myAttendanceStatus === response.status} onclick={() => respond(response.status)}>{response.label}</Button>{/each}
                  </div>
                </div>
              {/if}
              <div class="flex flex-wrap gap-2 border-t pt-3"><Button href={nextEventLink} variant="outline" class="min-h-11">일정 자세히 보기</Button><Button href={`/app/p/${pid}/board?channel=REHEARSAL`} variant="ghost" class="min-h-11">준비 사항 나누기</Button></div>
            </article>
          {:else}
            <EmptyState title="예정된 일정이 없어요" description={canPlanSchedule ? "다음 리딩이나 연습 일정을 등록해 공연팀에 알려 주세요." : "새 일정이 잡히면 여기에서 확인할 수 있어요."}>
              {#snippet action()}<Button href={`/app/p/${pid}/schedule${canPlanSchedule ? "?create=1" : ""}`} variant="outline" class="min-h-11">{canPlanSchedule ? "일정 추가" : "공연 일정 열기"}</Button>{/snippet}
            </EmptyState>
          {/if}
        </section>

        <section aria-labelledby="production-news">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 id="production-news" class="text-lg font-semibold">공연팀의 새 소식</h2><Button href={`/app/p/${pid}/board`} variant="ghost" class="min-h-11">팀 게시판</Button></div>
          {#if sectionErrors.board}
            <ErrorPanel class="[&_button]:min-h-11" message={sectionErrors.board} onRetry={() => void loadPage()} />
          {:else if !posts.length}
            <EmptyState title="아직 올라온 소식이 없어요" description="일정과 준비 사항, 연습 중 나온 의견을 팀 게시판에 남겨요.">
              {#snippet action()}<Button href={`/app/p/${pid}/board`} variant="outline" class="min-h-11">팀 게시판 열기</Button>{/snippet}
            </EmptyState>
          {:else}
            <ul class="divide-y rounded-2xl border bg-card">
              {#each posts as post (post.id)}<li><a href={`/app/p/${pid}/board/${post.id}`} class="hover:bg-accent/40 flex min-h-11 items-start gap-3 p-4 sm:p-5"><Badge variant={post.category === "NOTICE" ? "secondary" : "outline"} class="mt-0.5 shrink-0">{CATEGORY_LABELS[post.category]}</Badge><div class="min-w-0"><p class="break-words text-sm font-medium">{post.title}</p><p class="text-muted-foreground mt-1 text-xs">{post.author.name} · {formatRelative(post.createdAt)}{#if post._count.comments > 0} · 답글 {post._count.comments}{/if}</p></div></a></li>{/each}
            </ul>
          {/if}
        </section>
      </div>

      <aside class="min-w-0 space-y-5" aria-label="공연 일정과 공연팀">
        {#if !sectionErrors.schedule}
          <section class="rounded-2xl border bg-card p-4" aria-label="월별 공연 일정">
            <div class="flex items-center justify-between"><h2 class="font-semibold">{calYear}년 {calMonth + 1}월</h2><div class="flex items-center"><Button variant="ghost" size="icon" class="size-11" onclick={() => moveMonth(-1)} aria-label="이전 달"><ChevronLeftIcon class="size-4" /></Button><Button variant="ghost" size="icon" class="size-11" onclick={() => moveMonth(1)} aria-label="다음 달"><ChevronRightIcon class="size-4" /></Button></div></div>
            <div class="text-muted-foreground mt-2 grid grid-cols-7 text-center text-xs">{#each ["일", "월", "화", "수", "목", "금", "토"] as weekday (weekday)}<span class="py-2">{weekday}</span>{/each}</div>
            <div class="grid grid-cols-7">{#each calendarCells as cell (cell.key)}<a href={`/app/p/${pid}/schedule?date=${cell.key}`} aria-label={`${cell.key}${cell.isToday ? ' 오늘' : ''} · 일정 ${cell.eventCount}개`} class="flex min-h-11 flex-col items-center justify-center gap-1 rounded-lg text-xs hover:bg-accent {cell.inMonth ? '' : 'text-muted-foreground'} {cell.isToday ? 'bg-primary/10 text-primary font-bold' : ''}">{cell.day}<span class="size-1 rounded-full {cell.eventCount ? 'bg-primary' : ''}"></span></a>{/each}</div>
            <Button href={`/app/p/${pid}/schedule`} variant="ghost" class="mt-2 min-h-11 w-full text-sm">이번 달 일정 {monthEventCount}개 보기</Button>
          </section>
        {/if}
        <section class="rounded-2xl border bg-card p-5" aria-labelledby="production-people"><div class="flex items-center justify-between gap-2"><h2 id="production-people" class="font-semibold">공연팀{#if !sectionErrors.people} {people.length}명{/if}</h2><Button href={`/app/p/${pid}/people`} variant="ghost" class="min-h-11">모두 보기</Button></div>
          {#if sectionErrors.people}<ErrorPanel class="[&_button]:min-h-11" message={sectionErrors.people} onRetry={() => void loadPage()} />
          {:else if !people.length}<p class="text-muted-foreground mt-3 text-sm">아직 배정된 공연팀이 없어요.</p>
          {:else}<ul class="mt-2 space-y-3">{#each people.slice(0, 6) as person (person.id)}<li class="flex items-center gap-3"><span class="bg-muted text-foreground flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold" aria-hidden="true">{person.user.name.slice(0, 2)}</span><span class="min-w-0 flex-1 break-words text-sm font-medium">{person.user.name}</span><Badge variant="outline" class="shrink-0 text-xs">{PRODUCTION_ROLE_LABELS[person.primaryRole] ?? person.primaryRole}</Badge></li>{/each}</ul>{/if}
        </section>
        {#if canManage || isStaff}<Button href={`/app/p/${pid}/checklist`} variant="outline" class="min-h-11 w-full">준비 체크리스트</Button>{/if}
      </aside>
    </div>

    {#if canManage}
      <details class="rounded-2xl border bg-card px-5 py-3"><summary class="flex min-h-11 cursor-pointer items-center font-semibold">공연 준비 도구</summary><nav aria-label="공연 준비 도구" class="grid grid-cols-2 gap-2 border-t pt-4 sm:grid-cols-3"><Button href={compositionLink} variant="outline" class="min-h-11">대본·자료 준비</Button><Button href={`${compositionLink}?tab=videos`} variant="outline" class="min-h-11">영상 연결</Button>{#if access?.canManageMembers}<Button href={membersLink} variant="outline" class="min-h-11">멤버 관리·초대</Button>{/if}</nav></details>
    {/if}
  {/if}
</PageContainer>
