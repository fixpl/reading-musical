<script lang="ts">
  import { onMount } from "svelte";
  import { toast } from "svelte-sonner";
  import * as Dialog from "$lib/components/ui/dialog";
  import * as Select from "$lib/components/ui/select";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import { ApiError, apiRequest } from "$lib/api/client";
  import { listMyProductions, type MyProduction } from "$lib/api/productions";
  import { EVENT_TYPE_LABELS, formatDateTime } from "$lib/domain/labels";
  import { groupCalendarDays } from "$lib/domain/schedule-calendar";
  import ChevronLeftIcon from "@lucide/svelte/icons/chevron-left";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import PlusIcon from "@lucide/svelte/icons/plus";

  type MyAttendance = {
    id: string;
    status: "INVITED" | "ACCEPTED" | "DECLINED" | "TENTATIVE";
    event: {
      id: string;
      type: string;
      title: string;
      startAt: string;
      endAt: string;
      location: string | null;
      production: { id: string; title: string };
    };
  };

  type Availability = {
    id: string;
    title: string | null;
    startAt: string;
    endAt: string;
    isAvailable: boolean;
    reason: string | null;
  };

  let attendances = $state<MyAttendance[]>([]);
  let availabilities = $state<Availability[]>([]);
  let loading = $state(true);
  let responding = $state<string | null>(null);

  // 달력 ↔ 목록 보기 + 일정 클릭 시 상세
  let view = $state<"calendar" | "list">("list");
  let detailEvent = $state<MyAttendance | null>(null);

  // 스케줄 등록 — 나만 보는 개인 일정(기간 지원) 또는 공연과 공유되는 일정.
  let addOpen = $state(false);
  let editingBlock = $state<Availability | null>(null);
  let myProductions = $state<MyProduction[]>([]);
  let shareTarget = $state(""); // "" = 개인 일정, 그 외 = 공연 id
  let personalTitle = $state("");
  let evTitle = $state("");
  let evType = $state("REHEARSAL");
  let evLocation = $state("");
  let formStartDate = $state("");
  let formEndDate = $state("");
  let formAllDay = $state(true);
  let formStart = $state("09:00");
  let formEnd = $state("18:00");
  let formReason = $state("");
  let formSaving = $state(false);

  const today = new Date();
  let calYear = $state(today.getFullYear());
  let calMonth = $state(today.getMonth());
  let selectedKey = $state(dayKey(today));

  function dayKey(date: Date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  onMount(load);

  async function load() {
    loading = true;
    try {
      const [scheduleResult, availabilityResult, productionsResult] = await Promise.all([
        apiRequest<{ attendances: MyAttendance[] }>("/schedule/me"),
        apiRequest<Availability[]>("/availabilities"),
        listMyProductions().catch(() => [] as MyProduction[])
      ]);
      myProductions = productionsResult;
      attendances = scheduleResult.attendances.sort(
        (a, b) => new Date(a.event.startAt).getTime() - new Date(b.event.startAt).getTime()
      );
      availabilities = availabilityResult;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "일정을 불러오지 못했습니다");
    } finally {
      loading = false;
    }
  }

  const eventsByDay = $derived(
    groupCalendarDays(attendances, (attendance) => attendance.event, calYear, calMonth)
  );

  const blocksByDay = $derived(
    groupCalendarDays(availabilities, (block) => block, calYear, calMonth)
  );

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
        events: eventsByDay.get(key) ?? [],
        blocks: (blocksByDay.get(key) ?? []).filter((block) => !block.isAvailable)
      });
    }
    return cells;
  });

  const selectedDate = $derived.by(() => {
    const [year, month, day] = selectedKey.split("-").map(Number);
    return new Date(year, month - 1, day);
  });
  const selectedEvents = $derived(eventsByDay.get(selectedKey) ?? []);
  const selectedBlocks = $derived(blocksByDay.get(selectedKey) ?? []);

  // 목록 보기 — 다가오는 일정을 날짜별로 묶는다(오늘 0시 이후).
  const listGroups = $derived.by(() => {
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const upcoming = attendances.filter((a) => new Date(a.event.endAt).getTime() > startOfToday);
    const groups: Array<{ key: string; date: Date; events: MyAttendance[] }> = [];
    for (const attendance of upcoming) {
      // An ongoing multi-day rehearsal belongs under today, not a past date.
      const key = dayKey(new Date(Math.max(Date.parse(attendance.event.startAt), startOfToday)));
      let group = groups.find((g) => g.key === key);
      if (!group) {
        const [y, m, d] = key.split("-").map(Number);
        group = { key, date: new Date(y, m - 1, d), events: [] };
        groups.push(group);
      }
      group.events.push(attendance);
    }
    return groups;
  });

  const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

  async function respondFromDetail(status: "ACCEPTED" | "DECLINED") {
    if (!detailEvent) return;
    const target = detailEvent;
    await respond(target, status);
    // 응답 후 최신 상태를 다이얼로그에 반영
    detailEvent = attendances.find((a) => a.id === target.id) ?? null;
  }

  function moveMonth(delta: number) {
    const next = new Date(calYear, calMonth + delta, 1);
    calYear = next.getFullYear();
    calMonth = next.getMonth();
    selectedKey = dayKey(next);
  }

  function goToday() {
    calYear = today.getFullYear();
    calMonth = today.getMonth();
    selectedKey = dayKey(today);
  }

  function chipStyle(status: MyAttendance["status"]) {
    if (status === "ACCEPTED") return "bg-primary/15 text-primary";
    if (status === "DECLINED") return "bg-muted text-muted-foreground line-through";
    return "border-border text-muted-foreground border bg-transparent";
  }

  async function respond(attendance: MyAttendance, status: "ACCEPTED" | "DECLINED") {
    responding = attendance.id;
    try {
      await apiRequest(`/productions/${attendance.event.production.id}/events/${attendance.event.id}/attendance`, {
        method: "POST",
        body: JSON.stringify({ status })
      });
      attendances = attendances.map((item) => (item.id === attendance.id ? { ...item, status } : item));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "응답하지 못했습니다");
    } finally {
      responding = null;
    }
  }

  type ConflictItem = {
    userName: string;
    type: "AVAILABILITY" | "EVENT";
    reason: string;
    startAt: string;
    endAt: string;
  };
  let conflicts = $state<ConflictItem[] | null>(null);
  let overrideReason = $state("");
  // 강행(충돌 무시 배정)은 제작진·운영자만 — 서버가 409 payload에 canOverride로 알려준다.
  let canOverride = $state(false);

  function clearConflicts() {
    conflicts = null;
    overrideReason = "";
    canOverride = false;
  }

  function openAdd(dateKey?: string) {
    editingBlock = null;
    shareTarget = "";
    personalTitle = "";
    evTitle = "";
    evType = "REHEARSAL";
    evLocation = "";
    formStartDate = dateKey ?? selectedKey;
    formEndDate = formStartDate;
    formAllDay = true;
    formStart = "09:00";
    formEnd = "18:00";
    formReason = "";
    clearConflicts();
    addOpen = true;
  }

  function openEditBlock(block: Availability) {
    editingBlock = block;
    shareTarget = "";
    personalTitle = block.title ?? "";
    formReason = block.reason ?? "";
    const start = new Date(block.startAt);
    const end = new Date(block.endAt);
    formStartDate = dayKey(start);
    formEndDate = dayKey(end);
    formStart = timeText(block.startAt);
    formEnd = timeText(block.endAt);
    formAllDay =
      start.getHours() === 0 && start.getMinutes() === 0 && end.getHours() === 23 && end.getMinutes() === 59;
    clearConflicts();
    addOpen = true;
  }

  async function saveBlock(event: SubmitEvent) {
    event.preventDefault();
    if (!formStartDate) return;

    // 공연과 공유 — 공연 일정으로 등록되어 멤버 전원 달력에 뜨고 출석 응답을 받는다.
    if (shareTarget) {
      if (!evTitle.trim()) {
        toast.error("일정 이름을 적어주세요.");
        return;
      }
      const evStartAt = new Date(`${formStartDate}T${formStart}:00`);
      const evEndAt = new Date(`${formEndDate || formStartDate}T${formEnd}:00`);
      if (!Number.isFinite(evStartAt.getTime()) || !Number.isFinite(evEndAt.getTime()) || evEndAt.getTime() <= evStartAt.getTime()) {
        toast.error("종료가 시작보다 빨라요. 시간을 확인해 주세요.");
        return;
      }
      formSaving = true;
      try {
        await apiRequest(`/productions/${shareTarget}/events`, {
          method: "POST",
          body: JSON.stringify({
            title: evTitle.trim(),
            type: evType,
            startAt: evStartAt.toISOString(),
            endAt: evEndAt.toISOString(),
            location: evLocation.trim() || undefined,
            overrideReason: conflicts && overrideReason.trim() ? overrideReason.trim() : undefined
          })
        });
        toast.success("공연 일정으로 등록했습니다. 멤버 전원에게 공유됩니다.");
        addOpen = false;
        clearConflicts();
        await load();
      } catch (error) {
        // 충돌(409): 안 되는 멤버 명단을 보여주고, 사유를 받아 강행할 수 있게 한다.
        if (error instanceof ApiError && error.status === 409) {
          const details = error.details as { conflicts?: ConflictItem[]; canOverride?: boolean } | undefined;
          if (details?.conflicts?.length) {
            conflicts = details.conflicts;
            canOverride = details.canOverride === true;
            formSaving = false;
            return;
          }
        }
        toast.error(error instanceof Error ? error.message : "등록하지 못했습니다");
      } finally {
        formSaving = false;
      }
      return;
    }

    if (!personalTitle.trim()) {
      toast.error("개인 일정 이름을 적어주세요.");
      return;
    }
    const endDate = formEndDate || formStartDate;
    const startAt = new Date(`${formStartDate}T${formAllDay ? "00:00" : formStart}:00`);
    const endAt = new Date(`${endDate}T${formAllDay ? "23:59" : formEnd}:00`);
    if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime()) || endAt.getTime() <= startAt.getTime()) {
      toast.error("종료가 시작보다 빨라요. 날짜와 시간을 확인해 주세요.");
      return;
    }
    formSaving = true;
    try {
      await apiRequest(editingBlock ? `/availabilities/${editingBlock.id}` : "/availabilities", {
        method: editingBlock ? "PATCH" : "POST",
        body: JSON.stringify({
          title: personalTitle.trim(),
          startAt: startAt.toISOString(),
          endAt: endAt.toISOString(),
          isAvailable: false,
          reason: formReason.trim() || undefined
        })
      });
      toast.success(editingBlock ? "개인 일정을 수정했습니다." : "개인 일정을 등록했습니다. 공연 배정 시 충돌 여부에 반영됩니다.");
      addOpen = false;
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "등록하지 못했습니다");
    } finally {
      formSaving = false;
    }
  }

  const myBlocks = $derived(
    [...availabilities]
      .filter((block) => !block.isAvailable)
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
  );

  function blockRangeText(block: Availability) {
    const start = new Date(block.startAt);
    const end = new Date(block.endAt);
    const dateText = (date: Date) => `${date.getMonth() + 1}/${date.getDate()}`;
    const sameDay = dayKey(start) === dayKey(end);
    const allDay =
      start.getHours() === 0 && start.getMinutes() === 0 && end.getHours() === 23 && end.getMinutes() === 59;
    if (sameDay) {
      return allDay
        ? `${dateText(start)} 하루 종일`
        : `${dateText(start)} ${timeText(block.startAt)}–${timeText(block.endAt)}`;
    }
    return allDay
      ? `${dateText(start)} ~ ${dateText(end)}`
      : `${dateText(start)} ${timeText(block.startAt)} ~ ${dateText(end)} ${timeText(block.endAt)}`;
  }

  function blockTitle(block: Availability) {
    return block.title?.trim() || block.reason?.trim() || "개인 일정";
  }

  async function removeBlock(block: Availability) {
    try {
      await apiRequest(`/availabilities/${block.id}`, { method: "DELETE" });
      availabilities = availabilities.filter((item) => item.id !== block.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "삭제하지 못했습니다");
    }
  }

  const timeText = (iso: string) =>
    new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
</script>

<svelte:head>
  <title>내 일정 — 아트브릿지</title>
</svelte:head>

<div class="mx-auto w-full max-w-5xl">
  <div class="flex flex-wrap items-center gap-2 py-2">
    <div>
      <h1 class="text-xl font-bold tracking-tight">내 일정</h1>
      <p class="text-muted-foreground text-sm">공연 일정과 개인 일정을 한곳에서 관리하고, 공연 배정 전 시간 충돌을 확인합니다.</p>
    </div>
    <div class="flex w-full flex-wrap items-center gap-2 sm:ms-auto sm:w-auto">
      <div class="bg-muted flex rounded-lg p-0.5">
        <button
          type="button"
          class="min-h-11 rounded-md px-3 py-2 text-sm font-medium transition-colors {view === 'calendar'
            ? 'bg-background shadow-sm'
            : 'text-muted-foreground hover:text-foreground'}"
          onclick={() => (view = "calendar")}
        >
          달력
        </button>
        <button
          type="button"
          class="min-h-11 rounded-md px-3 py-2 text-sm font-medium transition-colors {view === 'list'
            ? 'bg-background shadow-sm'
            : 'text-muted-foreground hover:text-foreground'}"
          onclick={() => (view = "list")}
        >
          목록
        </button>
      </div>
      <Button size="sm" class="min-h-11" onclick={() => openAdd()}>
        <PlusIcon />
        스케줄 등록
      </Button>
    </div>
  </div>

  {#if loading}
    <Skeleton class="mt-2 h-[480px] w-full rounded-2xl" />
  {:else}
    {#if view === "calendar"}
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
              {#each cell.blocks.slice(0, 1) as block (block.id)}
                <span class="truncate rounded-sm bg-red-500/15 px-1 text-[9.5px] font-semibold text-red-500">{blockTitle(block)}</span>
              {/each}
              {#each cell.events.slice(0, 2) as attendance (attendance.id)}
                <span class="truncate rounded-sm px-1 text-[10px] font-medium {chipStyle(attendance.status)}">
                  {attendance.event.title}
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
          <span><span class="rounded-sm bg-red-500/15 px-1.5 py-0.5 font-semibold text-red-500">개인</span> 나만 보는 일정 · 배정 충돌에 반영</span>
        </div>
      </div>

      <!-- 선택한 날 -->
      <div class="bg-card h-fit rounded-2xl p-5">
        <p class="font-bold">
          {selectedDate.getMonth() + 1}월 {selectedDate.getDate()}일
          ({["일", "월", "화", "수", "목", "금", "토"][selectedDate.getDay()]})
        </p>

        {#if selectedEvents.length === 0 && selectedBlocks.length === 0}
          <p class="text-muted-foreground mt-3 text-sm">이 날은 일정이 없습니다.</p>
        {/if}

        {#if selectedEvents.length > 0}
          <div class="mt-3 grid gap-2.5">
            {#each selectedEvents as attendance (attendance.id)}
              <div class="border-border/60 rounded-xl border px-3.5 py-3">
                <div class="flex items-center gap-2">
                  <Badge variant="outline" class="shrink-0 text-xs">
                    {EVENT_TYPE_LABELS[attendance.event.type] ?? attendance.event.type}
                  </Badge>
                  <span class="truncate text-sm font-semibold">{attendance.event.title}</span>
                </div>
                <p class="text-muted-foreground mt-1 text-xs">
                  {formatDateTime(attendance.event.startAt)}
                  {#if attendance.event.location}
                    · {attendance.event.location}
                  {/if}
                  <br />
                  {attendance.event.production.title}
                </p>
                <div class="mt-2.5 flex gap-1.5">
                  {#if attendance.status === "ACCEPTED"}
                    <Badge variant="secondary">참석 예정</Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      class="h-7 px-2 text-xs"
                      disabled={responding === attendance.id}
                      onclick={() => respond(attendance, "DECLINED")}
                    >
                      변경
                    </Button>
                  {:else if attendance.status === "DECLINED"}
                    <Badge variant="outline">불참</Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      class="h-7 px-2 text-xs"
                      disabled={responding === attendance.id}
                      onclick={() => respond(attendance, "ACCEPTED")}
                    >
                      변경
                    </Button>
                  {:else}
                    <Button
                      size="sm"
                      class="h-8 flex-1"
                      disabled={responding === attendance.id}
                      onclick={() => respond(attendance, "ACCEPTED")}
                    >
                      참석
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      class="h-8 flex-1"
                      disabled={responding === attendance.id}
                      onclick={() => respond(attendance, "DECLINED")}
                    >
                      불참
                    </Button>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}

        {#if selectedBlocks.length > 0}
          <p class="text-muted-foreground mt-4 mb-1.5 text-xs font-semibold tracking-wide uppercase">개인 일정</p>
          <div class="grid gap-1.5">
            {#each selectedBlocks as block (block.id)}
              <div class="flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2">
                <span class="min-w-0 flex-1 text-xs">
                  <span class="block font-semibold text-red-500">{blockTitle(block)}</span>
                  <span class="text-muted-foreground">{timeText(block.startAt)}–{timeText(block.endAt)}</span>
                  {#if block.reason && block.title}
                    <span class="text-muted-foreground ms-1.5">{block.reason}</span>
                  {/if}
                </span>
                <button type="button" class="text-muted-foreground hover:text-foreground shrink-0 text-xs" onclick={() => openEditBlock(block)}>수정</button>
                <button type="button" class="text-muted-foreground hover:text-destructive shrink-0 text-xs" onclick={() => removeBlock(block)}>삭제</button>
              </div>
            {/each}
          </div>
        {/if}

        <Button variant="outline" size="sm" class="mt-4 w-full" onclick={() => openAdd(selectedKey)}>
          <PlusIcon />
          이 날 스케줄 등록
        </Button>

        <!-- 등록한 불가 일정 전체 목록 -->
        <div class="border-border/60 mt-5 border-t pt-4">
          <p class="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase">
            내 개인 일정 {myBlocks.length}
          </p>
          {#if myBlocks.length === 0}
            <p class="text-muted-foreground text-sm">아직 등록한 개인 일정이 없습니다.</p>
          {:else}
            <div class="grid gap-1.5">
              {#each myBlocks as block (block.id)}
                <div class="flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2">
                  <span class="min-w-0 flex-1 text-xs">
                    <span class="block font-semibold text-red-500">{blockTitle(block)}</span>
                    <span class="text-muted-foreground">{blockRangeText(block)}</span>
                    {#if block.reason && block.title}
                      <span class="text-muted-foreground block">{block.reason}</span>
                    {/if}
                  </span>
                  <button type="button" class="text-muted-foreground hover:text-foreground shrink-0 text-xs" onclick={() => openEditBlock(block)}>수정</button>
                  <button type="button" class="text-muted-foreground hover:text-destructive shrink-0 text-xs" onclick={() => removeBlock(block)}>삭제</button>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </div>
    </div>
    {:else}
      <!-- 목록 보기 -->
      <div class="mt-2 grid gap-3">
        {#if listGroups.length === 0}
          <div class="bg-card rounded-2xl px-6 py-14 text-center">
            <p class="text-muted-foreground text-sm">다가오는 일정이 없습니다.</p>
          </div>
        {:else}
          {#each listGroups as group (group.key)}
            <div class="bg-card rounded-2xl p-4 sm:p-5">
              <p class="text-muted-foreground mb-2.5 text-xs font-semibold tracking-wide">
                {group.date.getMonth() + 1}월 {group.date.getDate()}일 ({WEEKDAYS[group.date.getDay()]})
              </p>
              <div class="grid gap-2">
                {#each group.events as attendance (attendance.id)}
                  <button
                    type="button"
                    class="hover:bg-accent/50 -mx-2 flex items-center gap-3 rounded-xl px-2 py-2 text-start transition-colors"
                    onclick={() => (detailEvent = attendance)}
                  >
                    <span class="w-12 shrink-0 text-sm font-semibold tabular-nums">{timeText(attendance.event.startAt)}</span>
                    <span class="min-w-0 flex-1">
                      <span class="flex items-center gap-1.5">
                        <Badge variant="outline" class="shrink-0 text-[10.5px]">
                          {EVENT_TYPE_LABELS[attendance.event.type] ?? attendance.event.type}
                        </Badge>
                        <span class="truncate text-sm font-semibold">{attendance.event.title}</span>
                      </span>
                      <span class="text-muted-foreground mt-0.5 block truncate text-xs">
                        {attendance.event.production.title}{attendance.event.location ? ` · ${attendance.event.location}` : ""}
                      </span>
                    </span>
                    <span class="shrink-0 rounded-sm px-1.5 py-0.5 text-[10.5px] font-medium {chipStyle(attendance.status)}">
                      {attendance.status === "ACCEPTED" ? "참석" : attendance.status === "DECLINED" ? "불참" : "응답"}
                    </span>
                  </button>
                {/each}
              </div>
            </div>
          {/each}
        {/if}
      </div>
      <section class="bg-card mt-4 rounded-2xl border p-4 sm:p-5">
        <h2 class="font-semibold">다가오는 개인 일정</h2>
        <p class="text-muted-foreground mt-1 text-xs">상세 내용은 본인만 볼 수 있으며 공연 일정 배정 시 시간 충돌에 반영됩니다.</p>
        {#each myBlocks.filter((block) => new Date(block.endAt).getTime() > Date.now()) as block (block.id)}
          <div class="mt-3 flex flex-wrap items-center gap-2 border-t pt-3"><div class="min-w-0 flex-1"><p class="break-words text-sm font-medium">{blockTitle(block)}</p><p class="text-muted-foreground mt-1 text-xs">{blockRangeText(block)}</p></div><Button variant="outline" class="min-h-11" onclick={() => openEditBlock(block)}>수정</Button></div>
        {:else}<p class="text-muted-foreground mt-3 text-sm">등록한 개인 일정이 없습니다.</p>{/each}
      </section>
    {/if}
  {/if}
</div>

<!-- 일정 상세 -->
<Dialog.Root open={detailEvent !== null} onOpenChange={(open) => !open && (detailEvent = null)}>
  <Dialog.Content class="max-h-[90dvh] overflow-y-auto sm:max-w-md">
    {#if detailEvent}
      <Dialog.Header>
        <div class="flex items-center gap-2">
          <Badge variant="outline">{EVENT_TYPE_LABELS[detailEvent.event.type] ?? detailEvent.event.type}</Badge>
          <Dialog.Title class="text-base">{detailEvent.event.title}</Dialog.Title>
        </div>
      </Dialog.Header>
      <div class="grid gap-3 text-sm">
        <div class="bg-muted/50 grid gap-1 rounded-xl px-4 py-3">
          <p class="font-semibold">{formatDateTime(detailEvent.event.startAt)} – {dayKey(new Date(detailEvent.event.startAt)) === dayKey(new Date(detailEvent.event.endAt)) ? timeText(detailEvent.event.endAt) : formatDateTime(detailEvent.event.endAt)}</p>
          <p class="text-muted-foreground">{detailEvent.event.production.title}</p>
          {#if detailEvent.event.location}
            <p class="text-muted-foreground">장소 · {detailEvent.event.location}</p>
          {/if}
        </div>
        <div class="grid gap-2">
          <p class="text-muted-foreground text-xs font-semibold tracking-wide uppercase">내 참석</p>
          {#if detailEvent.status === "ACCEPTED"}
            <div class="flex items-center gap-2">
              <Badge variant="secondary">참석 예정</Badge>
              <Button variant="outline" size="sm" class="h-8" disabled={responding === detailEvent.id} onclick={() => respondFromDetail("DECLINED")}>
                불참으로 변경
              </Button>
            </div>
          {:else if detailEvent.status === "DECLINED"}
            <div class="flex items-center gap-2">
              <Badge variant="outline">불참</Badge>
              <Button variant="outline" size="sm" class="h-8" disabled={responding === detailEvent.id} onclick={() => respondFromDetail("ACCEPTED")}>
                참석으로 변경
              </Button>
            </div>
          {:else}
            <div class="flex gap-2">
              <Button size="sm" class="h-9 flex-1" disabled={responding === detailEvent.id} onclick={() => respondFromDetail("ACCEPTED")}>참석</Button>
              <Button variant="outline" size="sm" class="h-9 flex-1" disabled={responding === detailEvent.id} onclick={() => respondFromDetail("DECLINED")}>불참</Button>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </Dialog.Content>
</Dialog.Root>

<!-- 스케줄 등록 -->
<Dialog.Root bind:open={addOpen}>
  <Dialog.Content class="max-h-[90dvh] overflow-y-auto sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>{editingBlock ? "개인 일정 수정" : "스케줄 등록"}</Dialog.Title>
      <Dialog.Description>
        {shareTarget
          ? "공연 일정으로 등록됩니다 — 멤버 전원 달력에 뜨고 출석 응답을 받습니다."
          : "나만 보는 개인 일정입니다. 내용은 공개하지 않고, 제작진에게는 시간 충돌 여부만 알려줍니다."}
      </Dialog.Description>
    </Dialog.Header>
    <form class="grid gap-4" onsubmit={saveBlock}>
      {#if !editingBlock}
        <div class="grid gap-2">
          <Label>공유 범위</Label>
          <Select.Root
            type="single"
            bind:value={shareTarget}
            onValueChange={() => clearConflicts()}
          >
            <Select.Trigger class="w-full">
              {shareTarget
                ? `${myProductions.find((item) => item.id === shareTarget)?.title ?? "공연"}과 공유`
                : "개인 일정 (나만 보기)"}
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="" label="개인 일정 (나만 보기)" />
              {#each myProductions as production (production.id)}
                <Select.Item value={production.id} label={`${production.title}과 공유`} />
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
      {/if}

      {#if shareTarget}
        <div class="grid gap-2">
          <Label for="evTitle">일정 이름 <span class="text-destructive">*</span></Label>
          <Input id="evTitle" bind:value={evTitle} required maxlength={120} placeholder="예: 자율 연습 — 넘버4 맞추기" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div class="grid gap-2">
            <Label>유형</Label>
            <Select.Root type="single" bind:value={evType}>
              <Select.Trigger class="w-full">{EVENT_TYPE_LABELS[evType] ?? evType}</Select.Trigger>
              <Select.Content>
                {#each Object.entries(EVENT_TYPE_LABELS) as [value, label] (value)}
                  <Select.Item {value} {label} />
                {/each}
              </Select.Content>
            </Select.Root>
          </div>
          <div class="grid gap-2">
            <Label for="evDate">시작일</Label>
            <Input id="evDate" type="date" bind:value={formStartDate} required oninput={(event) => { const value = event.currentTarget.value; if (!formEndDate || formEndDate < value) formEndDate = value; clearConflicts(); }} />
          </div>
          <div class="grid gap-2">
            <Label for="evEndDate">종료일</Label>
            <Input id="evEndDate" type="date" bind:value={formEndDate} min={formStartDate} required oninput={() => clearConflicts()} />
          </div>
          <div class="grid gap-2">
            <Label for="evStart">시작</Label>
            <Input id="evStart" type="time" bind:value={formStart} required oninput={() => clearConflicts()} />
          </div>
          <div class="grid gap-2">
            <Label for="evEnd">종료</Label>
            <Input id="evEnd" type="time" bind:value={formEnd} required oninput={() => clearConflicts()} />
          </div>
        </div>
        <div class="grid gap-2">
          <Label for="evLocation">장소 (선택)</Label>
          <Input id="evLocation" bind:value={evLocation} maxlength={120} placeholder="예: 합정 연습실 B" />
        </div>
      {:else}
        <div class="grid gap-2">
          <Label for="personalTitle">일정 이름 <span class="text-destructive">*</span></Label>
          <Input id="personalTitle" bind:value={personalTitle} required maxlength={120} placeholder="예: 회사 근무, 병원 예약, 다른 공연 연습" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div class="grid gap-2">
            <Label for="blockStartDate">시작일</Label>
            <Input id="blockStartDate" type="date" bind:value={formStartDate} required />
          </div>
          <div class="grid gap-2">
            <Label for="blockEndDate">종료일</Label>
            <Input id="blockEndDate" type="date" bind:value={formEndDate} min={formStartDate} />
          </div>
        </div>
        <label class="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" bind:checked={formAllDay} class="accent-primary size-4" />
          하루 종일
        </label>
        {#if !formAllDay}
          <div class="grid grid-cols-2 gap-3">
            <div class="grid gap-2">
              <Label for="blockStart">시작 시간</Label>
              <Input id="blockStart" type="time" bind:value={formStart} />
            </div>
            <div class="grid gap-2">
              <Label for="blockEnd">종료 시간</Label>
              <Input id="blockEnd" type="time" bind:value={formEnd} />
            </div>
          </div>
        {/if}
        <div class="grid gap-2">
          <Label for="blockReason">메모 (선택)</Label>
          <Input id="blockReason" bind:value={formReason} maxlength={120} placeholder="본인 확인용 메모 — 제작진에게 공개되지 않아요" />
        </div>
      {/if}

      {#if shareTarget && conflicts}
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
            <p class="text-muted-foreground text-xs">다른 시간으로 바꿔 주세요. 꼭 이 시간이어야 하면 제작진에게 요청해 주세요.</p>
          {/if}
        </div>
      {/if}

      <Dialog.Footer class="gap-2">
        <Button type="button" variant="ghost" onclick={() => (addOpen = false)} disabled={formSaving}>취소</Button>
        {#if shareTarget && conflicts && canOverride}
          <Button type="submit" variant="destructive" disabled={formSaving || !overrideReason.trim()}>
            {formSaving ? "등록 중..." : "그래도 등록"}
          </Button>
        {:else if shareTarget && conflicts}
          <Button type="submit" disabled>시간을 바꿔 주세요</Button>
        {:else}
          <Button type="submit" disabled={formSaving || !formStartDate || (!shareTarget && !personalTitle.trim())}>
            {formSaving ? "저장 중..." : editingBlock ? "수정 저장" : "등록"}
          </Button>
        {/if}
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
