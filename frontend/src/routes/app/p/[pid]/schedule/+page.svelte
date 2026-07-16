<script lang="ts">
  import { page } from "$app/stores";
  import { toast } from "svelte-sonner";
  import * as Dialog from "$lib/components/ui/dialog";
  import * as Select from "$lib/components/ui/select";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import { ApiError, apiRequest } from "$lib/api/client";
  import { fetchCurrentUser, isAdminRole, type CurrentUser } from "$lib/api/auth";
  import { getMyProduction, isProductionStaff } from "$lib/api/productions";
  import { EVENT_TYPE_LABELS, formatDateTime } from "$lib/domain/labels";
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
    attendances: Attendance[];
  };

  const pid = $derived($page.params.pid ?? "");

  let me = $state<CurrentUser | null>(null);
  let events = $state<WorkspaceEvent[]>([]);
  let title = $state("일정");
  let loading = $state(true);
  let responding = $state<string | null>(null);
  let canManage = $state(false);
  let view = $state<"calendar" | "list">("calendar");

  // 일정 추가 (제작진)
  let addOpen = $state(false);
  let addTitle = $state("");
  let addType = $state("REHEARSAL");
  let addDate = $state("");
  let addStart = $state("19:00");
  let addEnd = $state("21:00");
  let addLocation = $state("");
  let addSaving = $state(false);

  type ConflictItem = {
    userName: string;
    type: "AVAILABILITY" | "EVENT";
    reason: string;
    startAt: string;
    endAt: string;
  };
  let conflicts = $state<ConflictItem[] | null>(null);
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

  function dayKey(date: Date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

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

  function acceptedCount(event: WorkspaceEvent) {
    return event.attendances.filter((attendance) => attendance.status === "ACCEPTED").length;
  }

  function attendanceGroups(event: WorkspaceEvent) {
    const groups: Record<string, string[]> = { ACCEPTED: [], DECLINED: [], INVITED: [] };
    for (const attendance of event.attendances) {
      const name = attendance.membership.user?.name;
      if (!name) continue;
      const key = attendance.status === "ACCEPTED" || attendance.status === "DECLINED" ? attendance.status : "INVITED";
      groups[key].push(name);
    }
    return groups;
  }

  function chipStyle(event: WorkspaceEvent) {
    const status = myAttendance(event)?.status;
    if (status === "ACCEPTED") return "bg-primary/15 text-primary";
    if (status === "DECLINED") return "bg-muted text-muted-foreground line-through";
    return "border-border text-muted-foreground border bg-transparent";
  }

  const sortedEvents = $derived(
    [...events].sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
  );
  const upcoming = $derived(sortedEvents.filter((event) => new Date(event.endAt).getTime() >= Date.now()));
  const past = $derived(sortedEvents.filter((event) => new Date(event.endAt).getTime() < Date.now()).reverse());

  const eventsByDay = $derived.by(() => {
    const map = new Map<string, WorkspaceEvent[]>();
    for (const event of sortedEvents) {
      const key = dayKey(new Date(event.startAt));
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(event);
    }
    return map;
  });

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
  }

  function goToday() {
    calYear = today.getFullYear();
    calMonth = today.getMonth();
    selectedKey = dayKey(today);
  }

  function openAdd(dateKey?: string) {
    clearConflicts();
    addTitle = "";
    addType = "REHEARSAL";
    addLocation = "";
    addDate = dateKey ?? selectedKey ?? "";
    addStart = "19:00";
    addEnd = "21:00";
    addOpen = true;
  }

  async function reloadEvents() {
    const schedule = await apiRequest<{ events: WorkspaceEvent[] }>(`/productions/${pid}/schedule`);
    events = schedule.events;
  }

  async function createEvent(event: SubmitEvent) {
    event.preventDefault();
    if (!addTitle.trim() || !addDate) return;
    addSaving = true;
    try {
      await apiRequest(`/productions/${pid}/events`, {
        method: "POST",
        body: JSON.stringify({
          title: addTitle.trim(),
          type: addType,
          startAt: new Date(`${addDate}T${addStart}:00`).toISOString(),
          endAt: new Date(`${addDate}T${addEnd}:00`).toISOString(),
          location: addLocation.trim() || undefined,
          overrideReason: conflicts && overrideReason.trim() ? overrideReason.trim() : undefined
        })
      });
      toast.success("일정을 등록했습니다. 참여자에게 알림이 갑니다.");
      addOpen = false;
      clearConflicts();
      await reloadEvents();
    } catch (error) {
      // 충돌(409): 안 되는 사람 명단을 보여주고, 사유를 받아 강행할 수 있게 한다.
      if (error instanceof ApiError && error.status === 409) {
        const details = error.details as { conflicts?: ConflictItem[]; canOverride?: boolean } | undefined;
        if (details?.conflicts?.length) {
          conflicts = details.conflicts;
          canOverride = details.canOverride !== false;
          addSaving = false;
          return;
        }
      }
      toast.error(error instanceof Error ? error.message : "일정을 등록하지 못했습니다");
    } finally {
      addSaving = false;
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || !deleteReason.trim()) return;
    deleting = true;
    try {
      await apiRequest(`/productions/${pid}/events/${deleteTarget.id}?force=true`, {
        method: "DELETE",
        body: JSON.stringify({ reason: deleteReason.trim() })
      });
      toast.success("일정을 취소했습니다. 참여자에게 알림이 갑니다.");
      deleteTarget = null;
      deleteReason = "";
      await reloadEvents();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "일정을 삭제하지 못했습니다");
    } finally {
      deleting = false;
    }
  }

  async function loadPage() {
    try {
      const [user, production, schedule] = await Promise.all([
        fetchCurrentUser(),
        getMyProduction(pid),
        apiRequest<{ events: WorkspaceEvent[] }>(`/productions/${pid}/schedule`)
      ]);
      me = user;
      if (production) title = production.title;
      canManage = isAdminRole(user?.platformRole) || isProductionStaff(production, user?.platformRole);
      events = schedule.events;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "일정을 불러오지 못했습니다");
    } finally {
      loading = false;
    }
  }

  // pid가 바뀌어도(같은 라우트에서 공연 전환·딥링크) 다시 불러온다 — onMount는 재실행되지 않음.
  $effect(() => {
    void pid;
    void loadPage();
  });

  async function respond(event: WorkspaceEvent, status: "ACCEPTED" | "DECLINED") {
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
      toast.error(error instanceof Error ? error.message : "응답하지 못했습니다");
    } finally {
      responding = null;
    }
  }
</script>

{#snippet respondButtons(event: WorkspaceEvent)}
  {@const mine = myAttendance(event)}
  {#if mine}
    <div class="mt-3 flex gap-2">
      {#if mine.status === "ACCEPTED"}
        <Badge variant="secondary" class="px-3 py-1.5">참석 예정</Badge>
        <Button variant="ghost" size="sm" disabled={responding === event.id} onclick={() => respond(event, "DECLINED")}>
          변경
        </Button>
      {:else if mine.status === "DECLINED"}
        <Badge variant="outline" class="px-3 py-1.5">불참</Badge>
        <Button variant="ghost" size="sm" disabled={responding === event.id} onclick={() => respond(event, "ACCEPTED")}>
          변경
        </Button>
      {:else}
        <Button size="sm" class="flex-1" disabled={responding === event.id} onclick={() => respond(event, "ACCEPTED")}>
          참석
        </Button>
        <Button
          size="sm"
          variant="outline"
          class="flex-1"
          disabled={responding === event.id}
          onclick={() => respond(event, "DECLINED")}
        >
          불참
        </Button>
      {/if}
    </div>
  {/if}
{/snippet}

{#snippet attendanceRoster(event: WorkspaceEvent)}
  <div class="mt-3 flex items-center gap-3">
    <button
      type="button"
      class="text-muted-foreground hover:text-foreground text-xs font-medium underline-offset-2 hover:underline"
      onclick={() => toggleExpanded(event.id)}
    >
      {expanded.has(event.id) ? "참석 현황 접기" : "참석 현황 보기"}
    </button>
    {#if canManage}
      <button
        type="button"
        class="text-muted-foreground hover:text-destructive ms-auto inline-flex items-center gap-1 text-xs"
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
        <span class="font-medium">미응답 {groups.INVITED.length}</span>
        <span class="text-muted-foreground"> — {groups.INVITED.join(", ") || "없음"}</span>
      </p>
    </div>
  {/if}
{/snippet}

<svelte:head>
  <title>일정 — {title}</title>
</svelte:head>

<div class="mx-auto w-full max-w-5xl">
  <div class="flex flex-wrap items-center gap-2 py-2">
    <Button href={`/app/p/${pid}`} variant="ghost" size="icon" class="-ms-2 size-8" aria-label="공연 홈으로">
      <ChevronLeftIcon />
    </Button>
    <div>
      <h1 class="text-xl font-bold tracking-tight">일정</h1>
      <p class="text-muted-foreground text-sm">{title}</p>
    </div>
    <div class="ms-auto flex items-center gap-2">
      <div class="bg-muted flex items-center rounded-lg p-0.5">
        <button
          type="button"
          class="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors {view === 'calendar' ? 'bg-background shadow-sm' : 'text-muted-foreground'}"
          onclick={() => (view = "calendar")}
        >
          <CalendarIcon class="size-3.5" />
          달력
        </button>
        <button
          type="button"
          class="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors {view === 'list' ? 'bg-background shadow-sm' : 'text-muted-foreground'}"
          onclick={() => (view = "list")}
        >
          <ListIcon class="size-3.5" />
          목록
        </button>
      </div>
      {#if canManage}
        <Button size="sm" class="h-8" onclick={() => openAdd()}>
          <PlusIcon />
          일정 추가
        </Button>
      {/if}
    </div>
  </div>

  {#if loading}
    <Skeleton class="mt-2 h-[480px] w-full rounded-2xl" />
  {:else if view === "calendar"}
    <div class="mt-2 grid gap-4 lg:grid-cols-[minmax(0,1fr)_330px]">
      <!-- 달력 -->
      <div class="bg-card rounded-2xl p-4 sm:p-5">
        <div class="flex flex-wrap items-center gap-2">
          <p class="text-lg font-bold">{calYear}년 {calMonth + 1}월</p>
          <div class="ms-auto flex items-center gap-1">
            <Button variant="outline" size="sm" class="h-7 px-2.5 text-xs" onclick={goToday}>오늘</Button>
            <Button variant="ghost" size="icon" class="size-7" onclick={() => moveMonth(-1)} aria-label="이전 달">
              <ChevronLeftIcon class="size-4" />
            </Button>
            <Button variant="ghost" size="icon" class="size-7" onclick={() => moveMonth(1)} aria-label="다음 달">
              <ChevronRightIcon class="size-4" />
            </Button>
          </div>
        </div>

        <div class="text-muted-foreground/70 mt-3 grid grid-cols-7 text-center text-[11px] font-semibold">
          {#each ["일", "월", "화", "수", "목", "금", "토"] as weekday, i (weekday)}
            <span class="py-1 {i === 0 ? 'text-red-400' : ''}">{weekday}</span>
          {/each}
        </div>
        <div class="border-border/60 grid grid-cols-7 overflow-hidden rounded-xl border">
          {#each calendarCells as cell (cell.key)}
            <button
              type="button"
              class="border-border/40 flex min-h-16 flex-col items-stretch gap-0.5 border-e border-b p-1 text-start transition-colors sm:min-h-20
                {cell.inMonth ? 'hover:bg-accent/50' : 'bg-muted/30 text-muted-foreground/50'}
                {selectedKey === cell.key ? 'bg-primary/5 ring-primary/40 ring-1 ring-inset' : ''}"
              onclick={() => (selectedKey = cell.key)}
            >
              <span
                class="flex size-5 items-center justify-center rounded-full text-[11px]
                  {cell.isToday ? 'bg-primary text-primary-foreground font-bold' : ''}"
              >
                {cell.day}
              </span>
              {#each cell.events.slice(0, 2) as event (event.id)}
                <span class="truncate rounded-sm px-1 text-[10px] font-medium {chipStyle(event)}">
                  {event.title}
                </span>
              {/each}
              {#if cell.events.length > 2}
                <span class="text-muted-foreground px-1 text-[9.5px]">+{cell.events.length - 2}</span>
              {/if}
            </button>
          {/each}
        </div>

        <div class="text-muted-foreground mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <span><span class="bg-primary/15 text-primary rounded-sm px-1.5 py-0.5 font-medium">일정</span> 참석</span>
          <span><span class="border-border rounded-sm border px-1.5 py-0.5">일정</span> 응답 대기</span>
          <span><span class="bg-muted text-muted-foreground rounded-sm px-1.5 py-0.5 line-through">일정</span> 불참</span>
        </div>
      </div>

      <!-- 선택한 날 -->
      <div class="bg-card h-fit rounded-2xl p-5">
        <p class="font-bold">
          {selectedDate.getMonth() + 1}월 {selectedDate.getDate()}일
          ({["일", "월", "화", "수", "목", "금", "토"][selectedDate.getDay()]})
        </p>

        {#if selectedEvents.length === 0}
          <p class="text-muted-foreground mt-3 text-sm">이 날은 일정이 없습니다.</p>
        {:else}
          <div class="mt-3 grid gap-2.5">
            {#each selectedEvents as event (event.id)}
              <div class="border-border/60 rounded-xl border px-3.5 py-3">
                <div class="flex items-center gap-2">
                  <Badge variant="outline" class="shrink-0 text-xs">
                    {EVENT_TYPE_LABELS[event.type] ?? event.type}
                  </Badge>
                  <span class="truncate text-sm font-semibold">{event.title}</span>
                </div>
                <p class="text-muted-foreground mt-1 text-xs">
                  {formatDateTime(event.startAt)}
                  {#if event.location}
                    · {event.location}
                  {/if}
                  · 참석 {acceptedCount(event)}명
                </p>
                {@render respondButtons(event)}
                {@render attendanceRoster(event)}
              </div>
            {/each}
          </div>
        {/if}

        {#if canManage}
          <Button variant="outline" size="sm" class="mt-4 w-full" onclick={() => openAdd(selectedKey)}>
            <PlusIcon />
            이 날 일정 추가
          </Button>
        {/if}
      </div>
    </div>
  {:else if events.length === 0}
    <div class="bg-card mt-4 rounded-2xl px-6 py-14 text-center">
      <p class="font-semibold">등록된 일정이 없습니다</p>
      <p class="text-muted-foreground mt-1 text-sm">리딩과 연습 일정이 잡히면 알림으로 알려드립니다.</p>
    </div>
  {:else}
    <!-- 목록 보기 -->
    {#if upcoming.length > 0}
      <div class="mt-4 grid gap-2">
        {#each upcoming as event (event.id)}
          <div class="bg-card rounded-2xl px-5 py-4">
            <div class="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{EVENT_TYPE_LABELS[event.type] ?? event.type}</Badge>
              <span class="font-semibold">{event.title}</span>
            </div>
            <p class="text-muted-foreground mt-1 text-sm">
              {formatDateTime(event.startAt)}
              {#if event.location}
                · {event.location}
              {/if}
              · 참석 {acceptedCount(event)}명
            </p>
            {@render respondButtons(event)}
            {@render attendanceRoster(event)}
          </div>
        {/each}
      </div>
    {/if}

    {#if past.length > 0}
      <p class="text-muted-foreground mt-8 mb-2 text-xs font-semibold tracking-wide uppercase">지난 일정</p>
      <div class="grid gap-2">
        {#each past as event (event.id)}
          <div class="bg-card/50 flex items-center gap-3 rounded-2xl px-5 py-3.5 opacity-70">
            <Badge variant="outline" class="shrink-0">{EVENT_TYPE_LABELS[event.type] ?? event.type}</Badge>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium">{event.title}</p>
              <p class="text-muted-foreground text-xs">{formatDateTime(event.startAt)}</p>
            </div>
            {#if canManage}
              <button
                type="button"
                class="text-muted-foreground hover:text-destructive shrink-0"
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
</div>

<!-- 일정 추가 (제작진) -->
<Dialog.Root bind:open={addOpen}>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>일정 추가</Dialog.Title>
      <Dialog.Description>등록하면 참여자 전원에게 출석 요청 알림이 갑니다.</Dialog.Description>
    </Dialog.Header>
    <form class="grid gap-4" onsubmit={createEvent}>
      <div class="grid gap-2">
        <Label for="evTitle">일정 이름 <span class="text-destructive">*</span></Label>
        <Input id="evTitle" bind:value={addTitle} required maxlength={120} placeholder="예: 1차 합본 리허설" />
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div class="grid gap-2">
          <Label>유형</Label>
          <Select.Root type="single" bind:value={addType}>
            <Select.Trigger class="w-full">{EVENT_TYPE_LABELS[addType] ?? addType}</Select.Trigger>
            <Select.Content>
              {#each Object.entries(EVENT_TYPE_LABELS) as [value, label] (value)}
                <Select.Item {value} {label} />
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
        <div class="grid gap-2">
          <Label for="evDate">날짜 <span class="text-destructive">*</span></Label>
          <Input id="evDate" type="date" bind:value={addDate} required oninput={() => clearConflicts()} />
        </div>
        <div class="grid gap-2">
          <Label for="evStart">시작</Label>
          <Input id="evStart" type="time" bind:value={addStart} oninput={() => clearConflicts()} />
        </div>
        <div class="grid gap-2">
          <Label for="evEnd">종료</Label>
          <Input id="evEnd" type="time" bind:value={addEnd} oninput={() => clearConflicts()} />
        </div>
      </div>
      <div class="grid gap-2">
        <Label for="evLocation">장소</Label>
        <Input id="evLocation" bind:value={addLocation} maxlength={120} placeholder="예: 합정 연습실 B 또는 Zoom" />
      </div>
      {#if conflicts}
        <div class="border-destructive/30 bg-destructive/5 grid gap-2 rounded-xl border px-4 py-3">
          <p class="text-destructive text-sm font-semibold">이 시간에 안 되는 사람이 있어요</p>
          <ul class="grid gap-1 text-sm">
            {#each conflicts as conflict, index (index)}
              <li>
                <span class="font-medium">{conflict.userName}</span>
                <span class="text-muted-foreground">
                  — {conflict.type === "AVAILABILITY" ? "개인 일정" : "다른 공연 일정"}{conflict.reason ? `: ${conflict.reason}` : ""}
                </span>
              </li>
            {/each}
          </ul>
          {#if canOverride}
            <p class="text-muted-foreground text-xs">시간을 바꾸는 것을 권해요. 그래도 등록하려면 사유를 적어 주세요.</p>
            <Input bind:value={overrideReason} maxlength={200} placeholder="강행 사유 (예: 전원 필수 리허설)" />
          {:else}
            <p class="text-muted-foreground text-xs">다른 시간으로 바꿔 주세요.</p>
          {/if}
        </div>
      {/if}
      <Dialog.Footer class="gap-2">
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
          <Button type="submit" variant="destructive" disabled={addSaving || !overrideReason.trim()}>
            {addSaving ? "등록 중..." : "그래도 등록"}
          </Button>
        {:else if conflicts}
          <Button type="submit" disabled>시간을 바꿔 주세요</Button>
        {:else}
          <Button type="submit" disabled={addSaving || !addTitle.trim() || !addDate}>
            {addSaving ? "등록 중..." : "등록"}
          </Button>
        {/if}
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

<!-- 일정 삭제 (제작진) -->
<Dialog.Root open={deleteTarget !== null} onOpenChange={(open) => !open && (deleteTarget = null)}>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>일정을 취소할까요?</Dialog.Title>
      <Dialog.Description>
        “{deleteTarget?.title}” 일정을 삭제하면 참여자에게 취소 알림이 가고, 출석 응답도 모두 사라집니다.
      </Dialog.Description>
    </Dialog.Header>
    <div class="grid gap-2">
      <Label for="deleteReason">취소 사유 <span class="text-destructive">*</span></Label>
      <Input id="deleteReason" bind:value={deleteReason} maxlength={200} placeholder="예: 장소 사정으로 일정 변경" />
    </div>
    <Dialog.Footer class="gap-2">
      <Button type="button" variant="ghost" onclick={() => (deleteTarget = null)} disabled={deleting}>취소</Button>
      <Button type="button" variant="destructive" disabled={deleting || !deleteReason.trim()} onclick={confirmDelete}>
        {deleting ? "삭제 중..." : "일정 삭제"}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
