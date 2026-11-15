<script lang="ts">
  import { page } from "$app/stores";
  import { toast } from "svelte-sonner";
  import * as Dialog from "$lib/components/ui/dialog";
  import * as Select from "$lib/components/ui/select";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { PageContainer } from "$lib/components/ui/page-container";
  import { PageHeader } from "$lib/components/ui/page-header";
  import { EmptyState } from "$lib/components/ui/empty-state";
  import { LoadingBlock } from "$lib/components/ui/loading-block";
  import { ErrorPanel } from "$lib/components/ui/error-panel";
  import { ApiError, apiRequest } from "$lib/api/client";
  import { fetchCurrentUser, type CurrentUser } from "$lib/api/auth";
  import { getMyProduction } from "$lib/api/productions";
  import { getProductionAccess, EMPTY_PRODUCTION_ACCESS, type ProductionAccess } from "$lib/api/production-access";
  import { captureSession, isCurrentSession } from "$lib/api/session";
  import { EVENT_TYPE_LABELS } from "$lib/domain/labels";
  import { calendarDayKey as dayKey, groupCalendarDays } from "$lib/domain/schedule-calendar";
  import { groupScheduleConflicts, meetingHttpUrl, scheduleAttendanceSummary, type ScheduleConflict } from "$lib/domain/schedule-display";
  import ChevronLeftIcon from "@lucide/svelte/icons/chevron-left";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import CalendarIcon from "@lucide/svelte/icons/calendar";
  import ListIcon from "@lucide/svelte/icons/list";

  type Attendance = {
    id: string;
    status: string;
    membership: { id: string; user?: { id: string; name: string } | null };
  };
  type WorkspaceEvent = {
    id: string;
    type: string;
    title: string;
    startAt: string;
    endAt: string;
    location: string | null;
    meetingUrl: string | null;
    attendances: Attendance[];
    notificationWarning?: boolean;
  };

  const pid = $derived($page.params.pid ?? "");

  let me = $state<CurrentUser | null>(null);
  let events = $state<WorkspaceEvent[]>([]);
  const linkedEventId = $derived($page.url.searchParams.get("eventId"));
  const linkedEvent = $derived(linkedEventId ? events.find((event) => event.id === linkedEventId) : undefined);
  let title = $state("일정");
  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let retryKey = $state(0);
  let responding = $state<string | null>(null);
  let access = $state<ProductionAccess>(EMPTY_PRODUCTION_ACCESS);
  const canCreate = $derived(access.canCreateSchedule);
  const canEditEvent = (event: WorkspaceEvent) => access.canEditSchedule &&
    (access.scheduleEditScope === "ALL" || access.scheduleEditScope === event.type);
  let view = $state<"calendar" | "list">("list");
  let listPeriod = $state<"upcoming" | "today" | "week">("upcoming");
  const PERIODS = [{ value: "today", label: "오늘" }, { value: "week", label: "이번 주" }, { value: "upcoming", label: "전체 예정" }] as const;
  const dateLabel = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short" });

  // 일정 등록과 기존 일정 변경의 권한은 서로 다르다.
  let addOpen = $state(false);
  let editTarget = $state<WorkspaceEvent | null>(null);
  let addTitle = $state("");
  let addType = $state("REHEARSAL");
  let addDate = $state("");
  let addEndDate = $state("");
  let addStart = $state("19:00");
  let addEnd = $state("21:00");
  let addLocation = $state("");
  let addMeetingUrl = $state("");
  let addSaving = $state(false);
  let saveError = $state("");
  let viewRevision = 0;
  const startChanged = $derived(editTarget !== null &&
    (addDate !== dayKey(new Date(editTarget.startAt)) || addStart !== timeText(editTarget.startAt)));
  const endChanged = $derived(editTarget !== null &&
    (addEndDate !== dayKey(new Date(editTarget.endAt)) || addEnd !== timeText(editTarget.endAt)));
  const hasChanges = $derived(!editTarget || startChanged || endChanged || addType !== editTarget.type ||
    addTitle.trim() !== editTarget.title || addLocation.trim() !== (editTarget.location ?? "") ||
    addMeetingUrl.trim() !== (editTarget.meetingUrl ?? ""));

  let conflicts = $state<ScheduleConflict[] | null>(null);
  let overrideReason = $state("");
  let canOverride = $state(true);
  let expanded = $state<Set<string>>(new Set());

  // 삭제 (제작진)
  let deleteTarget = $state<WorkspaceEvent | null>(null);
  let deleteReason = $state("");
  let deleting = $state(false);

  // 달력
  const today = new Date();
  let calYear = $state(today.getFullYear());
  let calMonth = $state(today.getMonth());
  let selectedKey = $state(dayKey(today));
  $effect(() => {
    const key = $page.url.searchParams.get("date");
    if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return;
    const [year, month, day] = key.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    if (dayKey(date) !== key) return;
    calYear = year; calMonth = month - 1; selectedKey = key; view = "calendar";
  });

  function clearConflicts() {
    conflicts = null;
    overrideReason = "";
    canOverride = true;
  }

  function toggleExpanded(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expanded = next;
  }

  function myAttendance(event: WorkspaceEvent) {
    return event.attendances.find((attendance) => attendance.membership.user?.id === me?.id) ?? null;
  }

  function attendanceGroups(event: WorkspaceEvent) {
    const groups: Record<string, string[]> = { ACCEPTED: [], DECLINED: [], TENTATIVE: [], INVITED: [] };
    for (const attendance of event.attendances) {
      const name = attendance.membership.user?.name;
      if (!name) continue;
      const key = attendance.status in groups ? attendance.status : "INVITED";
      groups[key].push(name);
    }
    return groups;
  }

  function inListPeriod(startAt: string, endAt: string) {
    if (listPeriod === "upcoming") return true;
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (listPeriod === "week") start.setDate(start.getDate() - (start.getDay() + 6) % 7);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + (listPeriod === "week" ? 7 : 1));
    return Date.parse(startAt) < end.getTime() && Date.parse(endAt) > start.getTime();
  }

  function eventRangeText(event: { startAt: string; endAt: string }) {
    const start = new Date(event.startAt);
    const end = new Date(event.endAt);
    const endDate = dayKey(start) === dayKey(end) ? "" : `${dateLabel.format(end)} `;
    return `${dateLabel.format(start)} · ${timeText(event.startAt)} ~ ${endDate}${timeText(event.endAt)}`;
  }

  function chipStyle(event: WorkspaceEvent) {
    const status = myAttendance(event)?.status;
    if (status === "ACCEPTED") return "bg-primary/15 text-primary";
    if (status === "DECLINED") return "bg-muted text-muted-foreground line-through";
    if (status === "TENTATIVE") return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
    return "border-border text-muted-foreground border bg-transparent";
  }

  const sortedEvents = $derived(
    [...events].sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
  );
  const upcoming = $derived(sortedEvents.filter((event) => new Date(event.endAt).getTime() >= Date.now()));
  const past = $derived(sortedEvents.filter((event) => new Date(event.endAt).getTime() < Date.now()).reverse());
  const filteredUpcoming = $derived(upcoming.filter((event) => inListPeriod(event.startAt, event.endAt)));
  const filteredPast = $derived(past.filter((event) => inListPeriod(event.startAt, event.endAt)));

  const eventsByDay = $derived(groupCalendarDays(sortedEvents, (event) => event, calYear, calMonth));

  const calendarCells = $derived.by(() => {
    const first = new Date(calYear, calMonth, 1);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    const cells = [];
    for (let i = 0; i < 42; i += 1) {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      const key = dayKey(date);
      cells.push({
        key,
        day: date.getDate(),
        inMonth: date.getMonth() === calMonth,
        isToday: key === dayKey(today),
        events: eventsByDay.get(key) ?? []
      });
    }
    return cells;
  });

  const selectedDate = $derived.by(() => {
    const [year, month, day] = selectedKey.split("-").map(Number);
    return new Date(year, month - 1, day);
  });
  const selectedEvents = $derived(eventsByDay.get(selectedKey) ?? []);

  function moveMonth(delta: number) {
    const next = new Date(calYear, calMonth + delta, 1);
    calYear = next.getFullYear();
    calMonth = next.getMonth();
    selectedKey = dayKey(next);
  }

  const nextEvent = $derived(upcoming.find((event) => dayKey(new Date(event.startAt)) !== selectedKey) ?? null);

  function jumpTo(event: WorkspaceEvent) {
    const date = new Date(event.startAt);
    calYear = date.getFullYear();
    calMonth = date.getMonth();
    selectedKey = dayKey(date);
  }

  function goToday() {
    calYear = today.getFullYear();
    calMonth = today.getMonth();
    selectedKey = dayKey(today);
  }

  function openAdd(dateKey?: string) {
    if (!canCreate || addSaving) return;
    clearConflicts();
    editTarget = null;
    saveError = "";
    addTitle = "";
    addType = "REHEARSAL";
    addLocation = "";
    addMeetingUrl = "";
    addDate = dateKey ?? selectedKey ?? "";
    addEndDate = addDate;
    addStart = "19:00";
    addEnd = "21:00";
    addOpen = true;
  }

  function openEdit(event: WorkspaceEvent) {
    if (!canEditEvent(event) || addSaving) return;
    clearConflicts();
    saveError = "";
    editTarget = event;
    addTitle = event.title;
    addType = event.type;
    addLocation = event.location ?? "";
    addMeetingUrl = event.meetingUrl ?? "";
    addDate = dayKey(new Date(event.startAt));
    addEndDate = dayKey(new Date(event.endAt));
    addStart = timeText(event.startAt);
    addEnd = timeText(event.endAt);
    addOpen = true;
  }

  function changeStartDate(value: string) {
    if (!addEndDate || addEndDate === addDate || addEndDate < value) addEndDate = value;
    addDate = value;
    clearConflicts();
  }

  function duplicateEvent(event: WorkspaceEvent) {
    if (!canCreate || addSaving) return;
    openAdd();
    addTitle = event.title;
    addType = event.type;
    addLocation = event.location ?? "";
    addMeetingUrl = event.meetingUrl ?? "";
    addStart = timeText(event.startAt);
    addEnd = timeText(event.endAt);
    addDate = "";
    addEndDate = "";
  }

  function timeText(iso: string) {
    const date = new Date(iso);
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }

  async function reloadAfterSave() {
    try {
      await reloadEvents();
    } catch {
      loadError = "변경은 반영했지만 목록을 새로고침하지 못했어요. 다시 시도해 주세요.";
    }
  }

  async function reloadEvents() {
    const schedule = await apiRequest<{ events: WorkspaceEvent[] }>(`/productions/${pid}/schedule`);
    events = schedule.events;
  }

  async function saveEvent(event: SubmitEvent) {
    event.preventDefault();
    const original = editTarget;
    if (addSaving || !hasChanges || !addTitle.trim() || !addDate || (original ? !canEditEvent(original) : !canCreate)) return;
    if (conflicts && (!canOverride || !overrideReason.trim())) return;
    saveError = "";
    const startAt = original && !startChanged ? new Date(original.startAt) : new Date(`${addDate}T${addStart}`);
    const endAt = original && !endChanged ? new Date(original.endAt) : new Date(`${addEndDate || addDate}T${addEnd}`);
    if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime()) || endAt <= startAt) {
      saveError = "종료는 시작보다 늦어야 해요. 날짜와 시간을 확인해 주세요.";
      return;
    }
    if (addMeetingUrl.trim() && !meetingHttpUrl(addMeetingUrl)) {
      saveError = "회의 링크는 http 또는 https 주소로 입력해 주세요.";
      return;
    }
    const productionId = pid;
    const revision = viewRevision;
    const session = captureSession();
    const active = () => productionId === pid && revision === viewRevision && isCurrentSession(session);
    const path = `/productions/${productionId}/events`;
    addSaving = true;
    try {
      const saved = await apiRequest<WorkspaceEvent>(original ? `${path}/${original.id}` : path, {
        method: original ? "PATCH" : "POST",
        session,
        body: JSON.stringify({
          title: addTitle.trim() === original?.title ? undefined : addTitle.trim(),
          type: addType === original?.type ? undefined : addType,
          startAt: !original || startChanged ? startAt.toISOString() : undefined,
          endAt: !original || endChanged ? endAt.toISOString() : undefined,
          location: addLocation.trim() === (original?.location ?? "") ? undefined : addLocation.trim() || null,
          meetingUrl: addMeetingUrl.trim() === (original?.meetingUrl ?? "") ? undefined : addMeetingUrl.trim() || null,
          overrideReason: conflicts && overrideReason.trim() ? overrideReason.trim() : undefined
        })
      });
      if (!active()) return;
      events = original ? events.map((item) => item.id === saved.id ? saved : item) : [...events, saved];
      if (view === "calendar" && (!original || startChanged || endChanged)) jumpTo(saved);
      if (view === "list" && !inListPeriod(saved.startAt, saved.endAt)) listPeriod = "upcoming";
      if (saved.notificationWarning) toast.warning("일정은 저장했어요. 참여자 알림을 준비하는 중 문제가 생겼어요.");
      else toast.success(original ? "일정을 수정했어요." : "일정을 등록했어요.");
      addOpen = false;
      clearConflicts();
    } catch (error) {
      if (!active()) return;
      // 충돌(409): 안 되는 사람 명단을 보여주고, 사유를 받아 강행할 수 있게 한다.
      if (error instanceof ApiError && error.status === 409) {
        const details = error.details as { conflicts?: ScheduleConflict[]; canOverride?: boolean } | undefined;
        if (details?.conflicts?.length) {
          conflicts = details.conflicts;
          canOverride = details.canOverride !== false;
          return;
        }
      }
      saveError = error instanceof Error ? error.message : "일정을 저장하지 못했어요. 다시 시도해 주세요.";
    } finally {
      if (active()) addSaving = false;
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || !canEditEvent(deleteTarget) || !deleteReason.trim()) return;
    deleting = true;
    try {
      await apiRequest(`/productions/${pid}/events/${deleteTarget.id}?force=true`, {
        method: "DELETE",
        body: JSON.stringify({ reason: deleteReason.trim() })
      });
      toast.success("일정을 취소했어요. 참여자에게 알림이 가요.");
      deleteTarget = null;
      deleteReason = "";
      await reloadAfterSave();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "일정을 삭제하지 못했어요");
    } finally {
      deleting = false;
    }
  }

  async function loadPage(productionId: string, signal: AbortSignal) {
    try {
      const [user, production, schedule, capabilities] = await Promise.all([
        fetchCurrentUser(),
        getMyProduction(productionId),
        apiRequest<{ events: WorkspaceEvent[] }>(`/productions/${productionId}/schedule`, { signal }),
        getProductionAccess(productionId, signal)
      ]);
      if (signal.aborted || productionId !== pid) return;
      me = user;
      if (production) title = production.title;
      access = capabilities;
      events = schedule.events;
    } catch (error) {
      if (!signal.aborted && productionId === pid) loadError = error instanceof Error ? error.message : "일정을 불러오지 못했어요";
    } finally {
      if (!signal.aborted && productionId === pid) loading = false;
    }
  }

  // pid가 바뀌어도(같은 라우트에서 공연 전환·딥링크) 다시 불러온다 — onMount는 재실행되지 않음.
  $effect(() => {
    const productionId = pid;
    void retryKey;
    const controller = new AbortController();
    loading = true; loadError = null; events = []; access = EMPTY_PRODUCTION_ACCESS; expanded = new Set();
    addOpen = false; addSaving = false; editTarget = null; deleteTarget = null;
    void loadPage(productionId, controller.signal);
    return () => { viewRevision += 1; controller.abort(); };
  });

  let openedFromLink = "";
  $effect(() => {
    if ($page.url.searchParams.get("create") !== "1") { openedFromLink = ""; return; }
    if (loading || loadError || !canCreate || openedFromLink === pid) return;
    openedFromLink = pid;
    openAdd($page.url.searchParams.has("date") ? selectedKey : dayKey(new Date()));
  });

  async function respond(event: WorkspaceEvent, status: "ACCEPTED" | "DECLINED" | "TENTATIVE") {
    if (responding) return;
    responding = event.id;
    try {
      await apiRequest(`/productions/${pid}/events/${event.id}/attendance`, {
        method: "POST",
        body: JSON.stringify({ status })
      });
      events = events.map((item) =>
        item.id === event.id
          ? {
              ...item,
              attendances: item.attendances.map((attendance) =>
                attendance.membership.user?.id === me?.id ? { ...attendance, status } : attendance
              )
            }
          : item
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "응답하지 못했어요");
    } finally {
      responding = null;
    }
  }
</script>

{#snippet respondButtons(event: WorkspaceEvent)}
  {@const mine = myAttendance(event)}
  {#if mine}
    <div class="mt-3 space-y-2" role="group" aria-label={`${event.title} 참석 여부`}>
      <p class="text-sm" role="status">내 응답 <strong class="ms-1">{mine.status === "ACCEPTED" ? "참석 예정" : mine.status === "DECLINED" ? "불참" : mine.status === "TENTATIVE" ? "미정" : "미응답"}</strong></p>
      <div class="grid max-w-xs grid-cols-3 gap-2">
        <Button size="touch" aria-pressed={mine.status === "ACCEPTED"} variant={mine.status === "ACCEPTED" ? "secondary" : "outline"} disabled={responding !== null || mine.status === "ACCEPTED"} onclick={() => respond(event, "ACCEPTED")}>참석</Button>
        <Button size="touch" aria-pressed={mine.status === "DECLINED"} variant={mine.status === "DECLINED" ? "secondary" : "outline"} disabled={responding !== null || mine.status === "DECLINED"} onclick={() => respond(event, "DECLINED")}>불참</Button>
        <Button size="touch" aria-pressed={mine.status === "TENTATIVE"} variant={mine.status === "TENTATIVE" ? "secondary" : "outline"} disabled={responding !== null || mine.status === "TENTATIVE"} onclick={() => respond(event, "TENTATIVE")}>미정</Button>
      </div>
    </div>
  {/if}
{/snippet}

{#snippet eventDetails(event: WorkspaceEvent)}
  {@const meetingUrl = meetingHttpUrl(event.meetingUrl)}
  {#if meetingUrl}
    <a href={meetingUrl} target="_blank" rel="noopener noreferrer" class="text-primary mt-2 inline-flex min-h-11 items-center text-sm underline underline-offset-4">회의 링크 열기</a>
  {/if}
{/snippet}

{#snippet editScheduleButton(event: WorkspaceEvent)}
  {#if canEditEvent(event)}
    <Button variant="outline" size="sm" class="min-h-11" aria-label={`${event.title} 일정 수정`} onclick={() => openEdit(event)}>일정 수정</Button>
  {/if}
{/snippet}

{#snippet attendanceRoster(event: WorkspaceEvent)}
  <div class="mt-3 flex flex-wrap items-center gap-2">
    <button
      type="button"
      class="text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center text-sm font-medium underline-offset-2 hover:underline"
      onclick={() => toggleExpanded(event.id)}
    >
      {expanded.has(event.id) ? "참석 현황 접기" : "참석 현황 보기"}
    </button>
    {#if canCreate}
      <button type="button" class="text-muted-foreground hover:text-foreground ms-auto min-h-11 px-2 text-sm" onclick={() => duplicateEvent(event)}>복제</button>
    {/if}
    {@render editScheduleButton(event)}
    {#if canEditEvent(event)}
      <button
        type="button"
        class="text-muted-foreground hover:text-destructive inline-flex min-h-11 items-center gap-1 px-2 text-sm"
        onclick={() => {
          deleteTarget = event;
          deleteReason = "";
        }}
      >
        <Trash2Icon class="size-3.5" />
        삭제
      </button>
    {/if}
  </div>
  {#if expanded.has(event.id)}
    {@const groups = attendanceGroups(event)}
    <div class="bg-muted/50 mt-2 grid gap-1.5 rounded-xl px-4 py-3 text-sm">
      <p>
        <span class="font-medium text-emerald-600">참석 {groups.ACCEPTED.length}</span>
        <span class="text-muted-foreground"> — {groups.ACCEPTED.join(", ") || "아직 없어요"}</span>
      </p>
      <p>
        <span class="text-destructive font-medium">불참 {groups.DECLINED.length}</span>
        <span class="text-muted-foreground"> — {groups.DECLINED.join(", ") || "없음"}</span>
      </p>
      <p>
        <span class="font-medium">미정 {groups.TENTATIVE.length}</span>
        <span class="text-muted-foreground"> — {groups.TENTATIVE.join(", ") || "없음"}</span>
      </p>
      <p>
        <span class="font-medium">미응답 {groups.INVITED.length}</span>
        <span class="text-muted-foreground"> — {groups.INVITED.join(", ") || "없음"}</span>
      </p>
    </div>
  {/if}
{/snippet}

<svelte:head>
  <title>일정 — {title}</title>
</svelte:head>

<PageContainer class="min-w-0 space-y-4">
  <PageHeader title="공연 일정" description={`${title} · 리딩과 연습 시간, 장소를 확인해요.`}>
    {#snippet actions()}
      {#if linkedEventId}
        <Button href={`/app/p/${pid}/schedule`} variant="outline" size="touch">전체 일정 보기</Button>
      {:else}
        <div class="bg-muted flex items-center rounded-lg p-0.5" role="group" aria-label="일정 보기 방식">
          <button type="button" class="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium {view === 'list' ? 'bg-background shadow-sm' : 'text-muted-foreground'}" aria-pressed={view === "list"} onclick={() => view = "list"}><ListIcon class="size-4" />목록</button>
          <button type="button" class="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium {view === 'calendar' ? 'bg-background shadow-sm' : 'text-muted-foreground'}" aria-pressed={view === "calendar"} onclick={() => view = "calendar"}><CalendarIcon class="size-4" />달력</button>
        </div>
        {#if canCreate}<Button class="min-h-11" onclick={() => openAdd()}><PlusIcon />일정 추가</Button>{/if}
      {/if}
    {/snippet}
  </PageHeader>
  {#if !linkedEventId}
    <div class="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-3">
      <div class="flex flex-wrap gap-1" role="group" aria-label="일정 기간">{#each PERIODS as period (period.value)}<Button variant={view === "list" && listPeriod === period.value ? "secondary" : "ghost"} class="min-h-11" aria-pressed={view === "list" && listPeriod === period.value} onclick={() => { listPeriod = period.value; view = "list"; }}>{period.label}</Button>{/each}</div>
      <Button href={`/app/p/${pid}`} variant="ghost" class="min-h-11">공연 홈</Button>
    </div>
  {/if}

  {#if loading}
    <LoadingBlock lines={8} class="rounded-2xl border bg-card p-5" />
  {:else if loadError}
    <ErrorPanel class="[&_button]:min-h-11" title="일정을 불러오지 못했어요" message={loadError} onRetry={() => retryKey += 1} />
  {:else if linkedEventId}
    {#if linkedEvent}
      <section class="min-w-0 space-y-4 rounded-2xl border bg-card p-4 sm:p-5" aria-labelledby="linked-schedule-title">
        <div class="space-y-2">
          <Badge variant="outline">{EVENT_TYPE_LABELS[linkedEvent.type] ?? linkedEvent.type}</Badge>
          <h2 id="linked-schedule-title" class="text-xl font-semibold [overflow-wrap:anywhere]">{linkedEvent.title}</h2>
          <p class="text-sm leading-6">{eventRangeText(linkedEvent)}</p>
          <p class="text-muted-foreground text-sm [overflow-wrap:anywhere]">{linkedEvent.location || "장소는 아직 정해지지 않았어요."}</p>
          {@render eventDetails(linkedEvent)}
        </div>
        {#if myAttendance(linkedEvent)}
          <div class="border-t pt-1">{@render respondButtons(linkedEvent)}</div>
        {/if}
        {@render attendanceRoster(linkedEvent)}
      </section>
    {:else}
      <EmptyState title="이 일정을 찾을 수 없어요" description="공연 일정 목록에서 최신 일정을 확인해 주세요." />
    {/if}
  {:else if view === "calendar"}
    <div class="mt-2 grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
      <!-- 달력 -->
      <div class="bg-card min-w-0 rounded-2xl border p-3 sm:p-5">
        <div class="flex flex-wrap items-center gap-2">
          <p class="text-lg font-bold">{calYear}년 {calMonth + 1}월</p>
          <div class="ms-auto flex items-center gap-1">
            <Button variant="outline" size="sm" class="min-h-11 px-3 text-sm" onclick={goToday}>오늘</Button>
            <Button variant="ghost" size="icon" class="size-11" onclick={() => moveMonth(-1)} aria-label="이전 달">
              <ChevronLeftIcon class="size-4" />
            </Button>
            <Button variant="ghost" size="icon" class="size-11" onclick={() => moveMonth(1)} aria-label="다음 달">
              <ChevronRightIcon class="size-4" />
            </Button>
          </div>
        </div>

        <div class="text-muted-foreground/70 mt-3 grid grid-cols-7 text-center text-[11px] font-semibold">
          {#each ["일", "월", "화", "수", "목", "금", "토"] as weekday, i (weekday)}
            <span class="py-1 {i === 0 ? 'text-red-400' : ''}">{weekday}</span>
          {/each}
        </div>
        <div class="border-border/60 grid min-w-0 grid-cols-7 overflow-hidden rounded-xl border">
          {#each calendarCells as cell (cell.key)}
            <button
              type="button"
              class="border-border/40 flex min-h-14 min-w-0 overflow-hidden flex-col items-stretch gap-0.5 border-e border-b p-1 text-start transition-colors sm:min-h-20
                {cell.inMonth ? 'hover:bg-accent/50' : 'bg-muted/30 text-muted-foreground/50'}
                {selectedKey === cell.key ? 'bg-primary/5 ring-primary/40 ring-1 ring-inset' : ''}"
              aria-label={`${Number(cell.key.split("-")[1])}월 ${cell.day}일, 일정 ${cell.events.length}개`}
              aria-pressed={selectedKey === cell.key}
              onclick={() => (selectedKey = cell.key)}
            >
              <span
                class="flex size-5 items-center justify-center rounded-full text-[11px]
                  {cell.isToday ? 'bg-primary text-primary-foreground font-bold' : ''}"
              >
                {cell.day}
              </span>
              {#if cell.events.length}<span class="text-muted-foreground mt-1 text-[11px] sm:hidden">{cell.events.length}건</span>{/if}
              {#each cell.events.slice(0, 2) as event (event.id)}
                <span class="hidden min-w-0 truncate rounded-sm sm:block px-1 text-[10px] font-medium {chipStyle(event)}">
                  {event.title}
                </span>
              {/each}
              {#if cell.events.length > 2}
                <span class="text-muted-foreground hidden min-w-0 px-1 text-[10px] sm:block">+{cell.events.length - 2}</span>
              {/if}
            </button>
          {/each}
        </div>

        <div class="text-muted-foreground mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <span><span class="bg-primary/15 text-primary rounded-sm px-1.5 py-0.5 font-medium">일정</span> 참석</span>
          <span><span class="border-border rounded-sm border px-1.5 py-0.5">일정</span> 응답 대기</span>
          <span><span class="rounded-sm bg-amber-500/15 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">일정</span> 미정</span>
          <span><span class="bg-muted text-muted-foreground rounded-sm px-1.5 py-0.5 line-through">일정</span> 불참</span>
        </div>
      </div>

      <!-- 선택한 날 -->
      <div class="bg-card min-w-0 h-fit rounded-2xl border p-4 sm:p-5">
        <p class="text-muted-foreground text-xs font-medium">선택한 날짜</p>
        <h2 class="mt-1 font-bold" aria-live="polite">
          {selectedDate.getMonth() + 1}월 {selectedDate.getDate()}일
          ({["일", "월", "화", "수", "목", "금", "토"][selectedDate.getDay()]})
        </h2>

        {#if selectedEvents.length === 0}
          <p class="text-muted-foreground mt-3 text-sm">이 날은 일정이 없어요.</p>
          {#if nextEvent}
            <Button variant="outline" size="sm" class="mt-3 min-h-11 w-full justify-start" onclick={() => jumpTo(nextEvent)}>
              다음 일정 · {new Date(nextEvent.startAt).getMonth() + 1}월 {new Date(nextEvent.startAt).getDate()}일 {nextEvent.title}
            </Button>
          {/if}
        {:else}
          <div class="mt-3 grid gap-2.5">
            {#each selectedEvents as event (event.id)}
              <div class="border-border/60 min-w-0 rounded-xl border p-3">
                <div class="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" class="shrink-0 text-xs">
                    {EVENT_TYPE_LABELS[event.type] ?? event.type}
                  </Badge>
                  <span class="min-w-0 break-words text-sm font-semibold">{event.title}</span>
                  <Badge variant="secondary" class="whitespace-normal text-[10px]">{scheduleAttendanceSummary(event.attendances)}</Badge>
                </div>
                <p class="text-muted-foreground mt-1 text-xs">
                  {eventRangeText(event)}
                  {#if event.location}
                    · {event.location}
                  {/if}
                </p>
                {@render eventDetails(event)}
                {@render respondButtons(event)}
                {@render attendanceRoster(event)}
              </div>
            {/each}
          </div>
        {/if}

        {#if canCreate}
          <Button variant="outline" size="sm" class="mt-4 min-h-11 w-full" onclick={() => openAdd(selectedKey)}>
            <PlusIcon />
            이 날 일정 추가
          </Button>
        {/if}
      </div>
    </div>
  {:else if events.length === 0}
    <EmptyState title="아직 등록된 공연 일정이 없어요" description={canCreate ? "다음 리딩이나 연습 일정을 등록해 공연팀에 알려 주세요." : "공연팀이 새 일정을 등록하면 여기에서 확인해요."} />
  {:else}
    <!-- 목록 보기 -->
    {#if filteredUpcoming.length > 0}
      <div class="mt-4 grid gap-2">
        {#each filteredUpcoming as event (event.id)}
          <div class="bg-card min-w-0 rounded-2xl border p-4 sm:p-5">
            <div class="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{EVENT_TYPE_LABELS[event.type] ?? event.type}</Badge>
              <span class="font-semibold">{event.title}</span>
              <Badge variant="secondary" class="whitespace-normal text-[10px]">{scheduleAttendanceSummary(event.attendances)}</Badge>
            </div>
            <p class="text-muted-foreground mt-1 text-sm">
              {eventRangeText(event)}
              {#if event.location}
                · {event.location}
              {/if}
            </p>
            {@render eventDetails(event)}
            {@render respondButtons(event)}
            {@render attendanceRoster(event)}
          </div>
        {/each}
      </div>
    {:else}
      <EmptyState title={listPeriod === "today" ? "오늘은 예정된 공연 일정이 없어요" : listPeriod === "week" ? "이번 주에 예정된 공연 일정이 없어요" : "다가오는 공연 일정이 없어요"} description="다른 날짜를 확인하려면 달력을 열거나 전체 예정을 선택해 주세요." />
    {/if}

    {#if filteredPast.length > 0}
      <p class="text-muted-foreground mt-8 mb-2 text-xs font-semibold tracking-wide uppercase">지난 일정</p>
      <div class="grid gap-2">
        {#each filteredPast as event (event.id)}
          <div class="bg-card/50 flex min-w-0 flex-wrap items-center gap-3 rounded-2xl border p-4">
            <Badge variant="outline" class="shrink-0">{EVENT_TYPE_LABELS[event.type] ?? event.type}</Badge>
            <div class="min-w-0 flex-1">
              <p class="break-words text-sm font-medium">{event.title}</p>
              <Badge variant="secondary" class="whitespace-normal text-[10px]">{scheduleAttendanceSummary(event.attendances)}</Badge>
              {@render eventDetails(event)}
              <p class="text-muted-foreground text-xs">{eventRangeText(event)}</p>
            </div>
            {#if canCreate}
              <Button variant="ghost" size="sm" onclick={() => duplicateEvent(event)}>복제</Button>
            {/if}
            {@render editScheduleButton(event)}
            {#if canEditEvent(event)}
              <button
                type="button"
                class="text-muted-foreground hover:text-destructive inline-flex size-11 shrink-0 items-center justify-center"
                aria-label="일정 삭제"
                onclick={() => {
                  deleteTarget = event;
                  deleteReason = "";
                }}
              >
                <Trash2Icon class="size-4" />
              </button>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</PageContainer>

<Dialog.Root open={addOpen} onOpenChange={(open) => { if (!addSaving) addOpen = open; }}>
  <Dialog.Content class="flex max-h-[calc(100dvh-2rem)] min-h-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-md" showCloseButton={!addSaving} escapeKeydownBehavior={addSaving ? "ignore" : "close"} interactOutsideBehavior={addSaving ? "ignore" : "close"}>
    <Dialog.Header class="shrink-0 border-b px-4 py-4 pe-11 text-start sm:ps-5">
      <Dialog.Title>{editTarget ? "일정 수정" : "일정 추가"}</Dialog.Title>
      <Dialog.Description>{editTarget ? "저장하면 참석자에게 변경 알림을 보내요." : "공연팀과 리딩·연습 시간을 공유하고 참석 여부를 받아요."}</Dialog.Description>
    </Dialog.Header>
    <form class="flex min-h-0 min-w-0 flex-col" onsubmit={saveEvent} aria-busy={addSaving}>
      <div class="grid min-h-0 min-w-0 gap-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
        <fieldset disabled={addSaving} class="grid min-w-0 gap-4">
          <div class="grid gap-2">
            <Label for="evTitle">일정 이름 <span class="text-destructive">*</span></Label>
            <Input id="evTitle" class="min-h-11" bind:value={addTitle} required maxlength={120} placeholder="예: 1차 합본 리허설" />
          </div>
          <div class="grid min-w-0 gap-3 min-[360px]:grid-cols-2">
            <div class="col-span-full grid gap-2">
              <Label for="evType">일정 유형</Label>
              <Select.Root type="single" bind:value={addType} disabled={addSaving || (editTarget !== null && access.scheduleEditScope !== "ALL")} onValueChange={clearConflicts}>
                <Select.Trigger id="evType" class="min-h-11 w-full">{EVENT_TYPE_LABELS[addType] ?? addType}</Select.Trigger>
                <Select.Content>
                  {#each Object.entries(EVENT_TYPE_LABELS) as [value, label] (value)}
                    <Select.Item {value} {label} />
                  {/each}
                </Select.Content>
              </Select.Root>
            </div>
            <div class="grid gap-2">
              <Label for="evDate">시작일 <span class="text-destructive">*</span></Label>
              <Input id="evDate" type="date" class="min-h-11" value={addDate} required oninput={(event) => changeStartDate(event.currentTarget.value)} />
            </div>
            <div class="grid gap-2">
              <Label for="evEndDate">종료일 <span class="text-destructive">*</span></Label>
              <Input id="evEndDate" type="date" class="min-h-11" bind:value={addEndDate} min={addDate} required oninput={clearConflicts} />
            </div>
            <div class="grid gap-2">
              <Label for="evStart">시작 시간</Label>
              <Input id="evStart" type="time" class="min-h-11" bind:value={addStart} required oninput={clearConflicts} />
            </div>
            <div class="grid gap-2">
              <Label for="evEnd">종료 시간</Label>
              <Input id="evEnd" type="time" class="min-h-11" bind:value={addEnd} required oninput={clearConflicts} />
            </div>
          </div>
          <div class="grid gap-2">
            <Label for="evLocation">장소</Label>
            <Input id="evLocation" class="min-h-11" bind:value={addLocation} maxlength={120} placeholder="예: 합정 연습실 B 또는 Zoom" />
          </div>
          <div class="grid gap-2">
            <Label for="evMeetingUrl">회의 링크 (선택)</Label>
            <Input id="evMeetingUrl" type="url" class="min-h-11" bind:value={addMeetingUrl} maxlength={1000} placeholder="https://..." />
          </div>
        </fieldset>
        {#if startChanged || endChanged}
          <p class="text-muted-foreground rounded-lg bg-muted px-3 py-2 text-sm" role="status">시간을 바꾸면 참석·미정으로 답한 분에게 다시 응답을 요청해요.</p>
        {/if}
        {#if saveError}<p class="text-destructive text-sm" role="alert">{saveError}</p>{/if}
        {#if conflicts}
          <div class="border-destructive/30 bg-destructive/5 grid gap-2 rounded-xl border px-4 py-3">
            <p class="text-destructive text-sm font-semibold">이 시간에 안 되는 사람이 있어요</p>
            <ul class="grid gap-1 text-sm">
              {#each groupScheduleConflicts(conflicts) as conflict (conflict.key)}
                <li>
                  <span class="font-medium">{conflict.userName}</span>
                  <span class="text-muted-foreground"> — {conflict.labels.join(" · ")}</span>
                  {#each conflict.details as detail (detail)}
                    <span class="text-muted-foreground block text-xs">{detail}</span>
                  {/each}
                </li>
              {/each}
            </ul>
            {#if canOverride}
              <Label for="schedule-override-reason" class="text-sm">이 시간에 {editTarget ? "저장" : "등록"}하는 이유</Label>
              <Input id="schedule-override-reason" class="min-h-11" bind:value={overrideReason} disabled={addSaving} maxlength={200} placeholder="예: 전원 필수 리허설" />
            {:else}
              <p class="text-muted-foreground text-xs">다른 시간으로 바꿔 주세요.</p>
            {/if}
          </div>
        {/if}
      </div>
      <Dialog.Footer class="mx-0 mb-0 shrink-0 flex-row justify-end gap-2 border-t px-4 py-3 sm:px-5 [&_button]:min-h-11">
        <Button
          type="button"
          variant="ghost"
          onclick={() => {
            addOpen = false;
            clearConflicts();
          }}
          disabled={addSaving}
        >
          취소
        </Button>
        {#if conflicts && canOverride}
          <Button type="submit" variant="destructive" disabled={addSaving || !hasChanges || !overrideReason.trim()}>
            {addSaving ? "저장 중…" : editTarget ? "그래도 저장" : "그래도 등록"}
          </Button>
        {:else if conflicts}
          <Button type="submit" disabled>시간을 바꿔 주세요</Button>
        {:else}
          <Button type="submit" disabled={addSaving || !hasChanges || !addTitle.trim() || !addDate}>
            {addSaving ? "저장 중…" : editTarget ? "변경 저장" : "일정 등록"}
          </Button>
        {/if}
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

<!-- 일정 삭제 (제작진) -->
<Dialog.Root open={deleteTarget !== null} onOpenChange={(open) => !open && (deleteTarget = null)}>
  <Dialog.Content class="max-h-[90dvh] overflow-y-auto sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>일정을 취소할까요?</Dialog.Title>
      <Dialog.Description>
        “{deleteTarget?.title}” 일정을 삭제하면 참여자에게 취소 알림이 가고, 출석 응답도 모두 사라져요.
      </Dialog.Description>
    </Dialog.Header>
    <div class="grid gap-2">
      <Label for="deleteReason">취소 사유 <span class="text-destructive">*</span></Label>
      <Input id="deleteReason" bind:value={deleteReason} maxlength={200} placeholder="예: 장소 사정으로 일정 변경" />
    </div>
    <Dialog.Footer class="gap-2 [&_button]:min-h-11">
      <Button type="button" variant="ghost" onclick={() => (deleteTarget = null)} disabled={deleting}>취소</Button>
      <Button type="button" variant="destructive" disabled={deleting || !deleteReason.trim()} onclick={confirmDelete}>
        {deleting ? "삭제 중..." : "일정 삭제"}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
