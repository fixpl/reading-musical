<script lang="ts">
  import { onMount } from "svelte";
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
  import { listMyProductions, type MyProduction } from "$lib/api/productions";
  import { EVENT_TYPE_LABELS, formatDateTime } from "$lib/domain/labels";
  import { groupCalendarDays } from "$lib/domain/schedule-calendar";
  import { groupScheduleConflicts, meetingHttpUrl, scheduleAttendanceSummary, type ScheduleConflict } from "$lib/domain/schedule-display";
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
      meetingUrl: string | null;
      attendances: { id: string; status: string }[];
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
  let loadError = $state<string | null>(null);
  let responding = $state<string | null>(null);

  // 달력 ↔ 목록 보기 + 일정 클릭 시 상세
  let view = $state<"calendar" | "list">("list");
  let listPeriod = $state<"upcoming" | "today" | "week">("upcoming");
  const PERIODS = [{ value: "today", label: "오늘" }, { value: "week", label: "이번 주" }, { value: "upcoming", label: "전체 예정" }] as const;
  let detailEvent = $state<MyAttendance | null>(null);

  // 스케줄 등록 — 나만 보는 개인 일정(기간 지원) 또는 공연과 공유되는 일정.
  let addOpen = $state(false);
  let editingBlock = $state<Availability | null>(null);
  let myProductions = $state<MyProduction[]>([]);
  let productionsError = $state("");
  let productionFilter = $state("");
  const filteredAttendances = $derived(attendances.filter((attendance) => !productionFilter || attendance.event.production.id === productionFilter));
  let shareTarget = $state(""); // "" = 개인 일정, 그 외 = 공연 id
  let personalTitle = $state("");
  let evTitle = $state("");
  let evType = $state("REHEARSAL");
  let evLocation = $state("");
  let evMeetingUrl = $state("");
  let downloadingIcs = $state(false);
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

  async function load(refresh = false) {
    loading = true;
    loadError = null;
    try {
      let productionsFailed = false;
      const [scheduleResult, availabilityResult, productionsResult] = await Promise.all([
        apiRequest<{ attendances: MyAttendance[] }>("/schedule/me"),
        apiRequest<Availability[]>("/availabilities"),
        listMyProductions().catch(() => {
          productionsFailed = true;
          return [] as MyProduction[];
        })
      ]);
      productionsError = productionsFailed ? "공연 목록을 불러오지 못했어요. 공연별로 찾거나 공유 일정을 등록하려면 다시 시도해 주세요." : "";
      myProductions = productionsResult;
      attendances = scheduleResult.attendances.sort(
        (a, b) => new Date(a.event.startAt).getTime() - new Date(b.event.startAt).getTime()
      );
      availabilities = availabilityResult;
    } catch (error) {
      loadError = refresh ? "변경은 반영했지만 목록을 새로고침하지 못했어요. 다시 시도해 주세요." : "일정을 불러오지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.";
    } finally {
      loading = false;
    }
  }

  const eventsByDay = $derived(
    groupCalendarDays(filteredAttendances, (attendance) => attendance.event, calYear, calMonth)
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
    const upcoming = filteredAttendances.filter((a) => new Date(a.event.endAt).getTime() > startOfToday && inListPeriod(a.event.startAt, a.event.endAt));
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

  function inListPeriod(startAt: string, endAt: string) {
    if (listPeriod === "upcoming") return true;
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (listPeriod === "week") start.setDate(start.getDate() - (start.getDay() + 6) % 7);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + (listPeriod === "week" ? 7 : 1));
    return Date.parse(startAt) < end.getTime() && Date.parse(endAt) > start.getTime();
  }

  function eventRangeText(event: { startAt: string; endAt: string }) {
    return `${formatDateTime(event.startAt)} ~ ${dayKey(new Date(event.startAt)) === dayKey(new Date(event.endAt)) ? timeText(event.endAt) : formatDateTime(event.endAt)}`;
  }

  function chipStyle(status: MyAttendance["status"]) {
    if (status === "ACCEPTED") return "bg-primary/15 text-primary";
    if (status === "DECLINED") return "bg-muted text-muted-foreground line-through";
    if (status === "TENTATIVE") return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
    return "border-border text-muted-foreground border bg-transparent";
  }

  async function respond(attendance: MyAttendance, status: "ACCEPTED" | "DECLINED" | "TENTATIVE") {
    responding = attendance.id;
    try {
      await apiRequest(`/productions/${attendance.event.production.id}/events/${attendance.event.id}/attendance`, {
        method: "POST",
        body: JSON.stringify({ status })
      });
      attendances = attendances.map((item) => item.id === attendance.id ? {
        ...item,
        status,
        event: {
          ...item.event,
          attendances: item.event.attendances.map((entry) => entry.id === attendance.id ? { ...entry, status } : entry)
        }
      } : item);
      if (detailEvent?.id === attendance.id) detailEvent = attendances.find((item) => item.id === attendance.id) ?? null;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "응답하지 못했어요");
    } finally {
      responding = null;
    }
  }

  let conflicts = $state<ScheduleConflict[] | null>(null);
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
    evMeetingUrl = "";
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

  function duplicateEvent(attendance: MyAttendance) {
    const event = attendance.event;
    openAdd();
    shareTarget = event.production.id;
    evTitle = event.title;
    evType = event.type;
    evLocation = event.location ?? "";
    evMeetingUrl = event.meetingUrl ?? "";
    formStart = timeText(event.startAt);
    formEnd = timeText(event.endAt);
    formStartDate = "";
    formEndDate = "";
    detailEvent = null;
  }

  function duplicateBlock(block: Availability) {
    openEditBlock(block);
    editingBlock = null;
    formStartDate = "";
    formEndDate = "";
  }

  async function downloadIcs() {
    downloadingIcs = true;
    try {
      const ics = await apiRequest<string>("/schedule/me/ics");
      const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "artbridge-schedule.ics";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "캘린더 파일을 받지 못했어요");
    } finally {
      downloadingIcs = false;
    }
  }

  async function saveBlock(event: SubmitEvent) {
    event.preventDefault();
    if (!formStartDate) return;

    // 공연과 공유 — 공연 일정으로 등록되어 멤버 전원 달력에 뜨고 출석 응답을 받는다.
    if (shareTarget) {
      if (!evTitle.trim()) {
        toast.error("일정 이름을 적어 주세요.");
        return;
      }
      if (evMeetingUrl.trim() && !meetingHttpUrl(evMeetingUrl)) {
        toast.error("회의 링크는 http 또는 https 주소로 입력해 주세요.");
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
            meetingUrl: evMeetingUrl.trim() || undefined,
            overrideReason: conflicts && overrideReason.trim() ? overrideReason.trim() : undefined
          })
        });
        toast.success("공연 일정으로 등록했어요. 멤버 전원에게 공유해요.");
        addOpen = false;
        clearConflicts();
        await load(true);
      } catch (error) {
        // 충돌(409): 안 되는 멤버 명단을 보여주고, 사유를 받아 강행할 수 있게 한다.
        if (error instanceof ApiError && error.status === 409) {
          const details = error.details as { conflicts?: ScheduleConflict[]; canOverride?: boolean } | undefined;
          if (details?.conflicts?.length) {
            conflicts = details.conflicts;
            canOverride = details.canOverride === true;
            formSaving = false;
            return;
          }
        }
        toast.error(error instanceof Error ? error.message : "등록하지 못했어요");
      } finally {
        formSaving = false;
      }
      return;
    }

    if (!personalTitle.trim()) {
      toast.error("개인 일정 이름을 적어 주세요.");
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
      toast.success(editingBlock ? "개인 일정을 수정했어요." : "개인 일정을 등록했어요. 공연 배정 시 충돌 여부에 반영해요.");
      addOpen = false;
      await load(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "등록하지 못했어요");
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
    if (!window.confirm("이 개인 일정을 삭제할까요?")) return;
    try {
      await apiRequest(`/availabilities/${block.id}`, { method: "DELETE" });
      availabilities = availabilities.filter((item) => item.id !== block.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "삭제하지 못했어요");
    }
  }

  const timeText = (iso: string) =>
    new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
</script>

{#snippet attendanceButtons(attendance: MyAttendance)}
  <div class="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label={`${attendance.event.title} 참석 여부`}>
    <Badge variant="outline">{attendance.status === "ACCEPTED" ? "참석 예정" : attendance.status === "DECLINED" ? "불참" : attendance.status === "TENTATIVE" ? "미정" : "미응답"}</Badge>
    <Button size="sm" class="min-h-11 min-w-16" aria-pressed={attendance.status === "ACCEPTED"} variant={attendance.status === "ACCEPTED" ? "secondary" : "outline"} disabled={responding === attendance.id || attendance.status === "ACCEPTED"} onclick={() => respond(attendance, "ACCEPTED")}>참석</Button>
    <Button size="sm" class="min-h-11 min-w-16" aria-pressed={attendance.status === "DECLINED"} variant={attendance.status === "DECLINED" ? "secondary" : "outline"} disabled={responding === attendance.id || attendance.status === "DECLINED"} onclick={() => respond(attendance, "DECLINED")}>불참</Button>
    <Button size="sm" class="min-h-11 min-w-16" aria-pressed={attendance.status === "TENTATIVE"} variant={attendance.status === "TENTATIVE" ? "secondary" : "outline"} disabled={responding === attendance.id || attendance.status === "TENTATIVE"} onclick={() => respond(attendance, "TENTATIVE")}>미정</Button>
  </div>
{/snippet}

<svelte:head>
  <title>내 일정 — 아트브릿지</title>
</svelte:head>

<PageContainer class="min-w-0 space-y-4">
  <PageHeader title="내 일정" description="참여하는 공연 일정과 나만 보는 개인 일정을 확인해요.">
    {#snippet actions()}
      <div class="bg-muted flex rounded-lg p-0.5" role="group" aria-label="일정 보기 방식">
        <button type="button" class="min-h-11 rounded-md px-3 text-sm font-medium {view === 'list' ? 'bg-background shadow-sm' : 'text-muted-foreground'}" aria-pressed={view === "list"} onclick={() => view = "list"}>목록</button>
        <button type="button" class="min-h-11 rounded-md px-3 text-sm font-medium {view === 'calendar' ? 'bg-background shadow-sm' : 'text-muted-foreground'}" aria-pressed={view === "calendar"} onclick={() => view = "calendar"}>달력</button>
      </div>
      <Button variant="outline" class="min-h-11" disabled={downloadingIcs} onclick={downloadIcs}>{downloadingIcs ? "받는 중…" : "캘린더에 추가"}</Button>
      <Button class="min-h-11" onclick={() => openAdd()}><PlusIcon />일정 추가</Button>
    {/snippet}
  </PageHeader>
  <div class="flex min-w-0 flex-wrap items-end justify-between gap-3 rounded-xl border bg-card p-3">
    <div class="flex flex-wrap gap-1" role="group" aria-label="일정 기간">
      {#each PERIODS as period (period.value)}<Button variant={view === "list" && listPeriod === period.value ? "secondary" : "ghost"} class="min-h-11" aria-pressed={view === "list" && listPeriod === period.value} onclick={() => { listPeriod = period.value; view = "list"; }}>{period.label}</Button>{/each}
    </div>
    <label class="grid min-w-0 flex-1 basis-40 gap-1 text-xs sm:max-w-60">공연별로 보기<select class="bg-background min-h-11 min-w-0 w-full rounded-lg border px-3 text-sm" bind:value={productionFilter}><option value="">모든 공연</option>{#each myProductions as production (production.id)}<option value={production.id}>{production.title}</option>{/each}</select></label>
  </div>
  {#if productionsError}<ErrorPanel class="[&_button]:min-h-11" message={productionsError} onRetry={() => load()} />{/if}

  {#if loading}
    <LoadingBlock lines={8} class="rounded-2xl border bg-card p-5" />
  {:else if loadError}
    <ErrorPanel class="mt-2 [&_button]:min-h-11" title="일정을 불러오지 못했어요" message={loadError} onRetry={() => load()} />
  {:else}
    {#if view === "calendar"}
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
              aria-label={`${Number(cell.key.split("-")[1])}월 ${cell.day}일, 일정 ${cell.events.length + cell.blocks.length}개`}
              aria-pressed={selectedKey === cell.key}
              onclick={() => (selectedKey = cell.key)}
            >
              <span
                class="flex size-5 items-center justify-center rounded-full text-[11px]
                  {cell.isToday ? 'bg-primary text-primary-foreground font-bold' : ''}"
              >
                {cell.day}
              </span>
              <span class="text-muted-foreground mt-1 text-[11px] sm:hidden">{cell.events.length ? `공연 ${cell.events.length}` : ""}</span>
              {#if cell.blocks.length}<span class="text-amber-700 text-[11px] dark:text-amber-300 sm:hidden">개인 {cell.blocks.length}</span>{/if}
              {#each cell.blocks.slice(0, 1) as block (block.id)}
                <span class="hidden min-w-0 truncate rounded-sm sm:block bg-red-500/15 px-1 text-[9.5px] font-semibold text-red-500">{blockTitle(block)}</span>
              {/each}
              {#each cell.events.slice(0, 2) as attendance (attendance.id)}
                <span class="hidden min-w-0 truncate rounded-sm sm:block px-1 text-[10px] font-medium {chipStyle(attendance.status)}">
                  {attendance.event.title}
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
          <span><span class="rounded-sm bg-red-500/15 px-1.5 py-0.5 font-semibold text-red-500">개인</span> 나만 보는 일정 · 배정 충돌에 반영</span>
        </div>
      </div>

      <!-- 선택한 날 -->
      <div class="bg-card min-w-0 h-fit rounded-2xl border p-4 sm:p-5">
        <p class="text-muted-foreground text-xs font-medium">선택한 날짜</p>
        <h2 class="mt-1 font-bold" aria-live="polite">
          {selectedDate.getMonth() + 1}월 {selectedDate.getDate()}일
          ({["일", "월", "화", "수", "목", "금", "토"][selectedDate.getDay()]})
        </h2>

        {#if selectedEvents.length === 0 && selectedBlocks.length === 0}
          <p class="text-muted-foreground mt-3 text-sm">이 날은 일정이 없어요.</p>
        {/if}

        {#if selectedEvents.length > 0}
          <div class="mt-3 grid gap-2.5">
            {#each selectedEvents as attendance (attendance.id)}
              <div class="border-border/60 rounded-xl border px-3.5 py-3">
                <div class="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" class="shrink-0 text-xs">
                    {EVENT_TYPE_LABELS[attendance.event.type] ?? attendance.event.type}
                  </Badge>
                  <span class="min-w-0 break-words text-sm font-semibold">{attendance.event.title}</span>
                  <Badge variant="secondary" class="whitespace-normal text-[10px]">{scheduleAttendanceSummary(attendance.event.attendances)}</Badge>
                </div>
                <p class="text-muted-foreground mt-1 text-xs">
                  {eventRangeText(attendance.event)}
                  {#if attendance.event.location}
                    · {attendance.event.location}
                  {/if}
                  <br />
                  {attendance.event.production.title}
                </p>
                {#if meetingHttpUrl(attendance.event.meetingUrl)}
                  <a href={meetingHttpUrl(attendance.event.meetingUrl) ?? undefined} target="_blank" rel="noopener noreferrer" class="text-primary mt-2 inline-flex min-h-11 items-center text-sm underline">회의 링크 열기</a>
                {/if}
                {@render attendanceButtons(attendance)}
                <Button variant="ghost" size="sm" class="mt-2 min-h-11" onclick={() => duplicateEvent(attendance)}>복제</Button>
              </div>
            {/each}
          </div>
        {/if}

        {#if selectedBlocks.length > 0}
          <p class="text-muted-foreground mt-4 mb-1.5 text-xs font-semibold tracking-wide uppercase">개인 일정</p>
          <div class="grid gap-1.5">
            {#each selectedBlocks as block (block.id)}
              <div class="flex min-w-0 flex-wrap items-center gap-2 rounded-lg bg-muted px-3 py-2">
                <span class="min-w-0 flex-1 basis-40 text-sm">
                  <span class="block font-semibold text-red-500">{blockTitle(block)}</span>
                  <span class="text-muted-foreground">{timeText(block.startAt)}–{timeText(block.endAt)}</span>
                  {#if block.reason && block.title}
                    <span class="text-muted-foreground ms-1.5">{block.reason}</span>
                  {/if}
                </span>
                <button type="button" class="text-muted-foreground hover:text-foreground inline-flex min-h-11 shrink-0 items-center px-2 text-sm" onclick={() => duplicateBlock(block)}>복제</button>
                <button type="button" class="text-muted-foreground hover:text-foreground inline-flex min-h-11 shrink-0 items-center px-2 text-sm" onclick={() => openEditBlock(block)}>수정</button>
                <button type="button" class="text-muted-foreground hover:text-destructive inline-flex min-h-11 shrink-0 items-center px-2 text-sm" onclick={() => removeBlock(block)}>삭제</button>
              </div>
            {/each}
          </div>
        {/if}

        <Button variant="outline" size="sm" class="mt-4 min-h-11 w-full" onclick={() => openAdd(selectedKey)}>
          <PlusIcon />
          선택한 날에 일정 추가
        </Button>

        <!-- 등록한 불가 일정 전체 목록 -->
        <div class="border-border/60 mt-5 border-t pt-4">
          <p class="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase">
            내 개인 일정 {myBlocks.length}
          </p>
          {#if myBlocks.length === 0}
            <p class="text-muted-foreground text-sm">아직 등록한 개인 일정이 없어요.</p>
          {:else}
            <div class="grid gap-1.5">
              {#each myBlocks as block (block.id)}
                <div class="flex min-w-0 flex-wrap items-start gap-2 rounded-lg bg-muted px-3 py-2">
                  <span class="min-w-0 flex-1 basis-40 text-sm">
                    <span class="block font-semibold text-red-500">{blockTitle(block)}</span>
                    <span class="text-muted-foreground">{blockRangeText(block)}</span>
                    {#if block.reason && block.title}
                      <span class="text-muted-foreground block">{block.reason}</span>
                    {/if}
                  </span>
                  <button type="button" class="text-muted-foreground hover:text-foreground inline-flex min-h-11 shrink-0 items-center px-2 text-sm" onclick={() => duplicateBlock(block)}>복제</button>
                  <button type="button" class="text-muted-foreground hover:text-foreground inline-flex min-h-11 shrink-0 items-center px-2 text-sm" onclick={() => openEditBlock(block)}>수정</button>
                  <button type="button" class="text-muted-foreground hover:text-destructive inline-flex min-h-11 shrink-0 items-center px-2 text-sm" onclick={() => removeBlock(block)}>삭제</button>
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
          <EmptyState title={listPeriod === "today" ? "오늘은 예정된 공연 일정이 없어요" : listPeriod === "week" ? "이번 주에 예정된 공연 일정이 없어요" : "다가오는 공연 일정이 없어요"} description={productionFilter ? "다른 공연의 일정도 확인하려면 공연별 보기를 바꿔 주세요." : "공연팀이 나를 일정에 배정하면 여기에 보여요."} />
        {:else}
          {#each listGroups as group (group.key)}
            <div class="bg-card min-w-0 rounded-2xl border p-3 sm:p-5">
              <p class="text-muted-foreground mb-2.5 text-xs font-semibold tracking-wide">
                {group.date.getMonth() + 1}월 {group.date.getDate()}일 ({WEEKDAYS[group.date.getDay()]})
              </p>
              <div class="grid gap-2">
                {#each group.events as attendance (attendance.id)}
                  <article class="min-w-0 rounded-xl border p-3">
                    <button type="button" class="hover:bg-accent/50 flex min-h-11 min-w-0 w-full items-start gap-3 rounded-lg p-1 text-start" onclick={() => detailEvent = attendance}>
                      <span class="w-12 shrink-0 pt-0.5 text-sm font-semibold tabular-nums">{timeText(attendance.event.startAt)}<span class="text-muted-foreground mt-1 block text-xs font-normal">{timeText(attendance.event.endAt)}</span></span>
                      <span class="min-w-0 flex-1"><span class="text-muted-foreground block break-words text-xs">{attendance.event.production.title}</span><span class="mt-1 block break-words text-sm font-semibold">{attendance.event.title}</span><span class="text-muted-foreground mt-1 block break-words text-xs leading-5">{EVENT_TYPE_LABELS[attendance.event.type] ?? attendance.event.type} · {attendance.event.location || "장소 미정"}</span></span>
                    </button>
                    {@render attendanceButtons(attendance)}
                    <div class="mt-2 flex flex-wrap items-center justify-between gap-2 border-t pt-2"><Button variant="ghost" class="min-h-11" onclick={() => detailEvent = attendance}>일정 자세히 보기</Button><Button variant="ghost" class="min-h-11" onclick={() => duplicateEvent(attendance)}>복제</Button></div>
                  </article>
                {/each}
              </div>
            </div>
          {/each}
        {/if}
      </div>
      <section class="bg-card mt-4 rounded-2xl border p-4 sm:p-5">
        <h2 class="font-semibold">다가오는 개인 일정</h2>
        <p class="text-muted-foreground mt-1 text-xs">상세 내용은 본인만 볼 수 있고 공연 일정 배정 시 시간 충돌에 반영해요.</p>
        {#each myBlocks.filter((block) => new Date(block.endAt).getTime() > Date.now() && inListPeriod(block.startAt, block.endAt)) as block (block.id)}
          <div class="mt-3 flex flex-wrap items-center gap-2 border-t pt-3"><div class="min-w-0 flex-1"><p class="break-words text-sm font-medium">{blockTitle(block)}</p><p class="text-muted-foreground mt-1 text-xs">{blockRangeText(block)}</p></div><Button variant="ghost" class="min-h-11" onclick={() => duplicateBlock(block)}>복제</Button><Button variant="outline" class="min-h-11" onclick={() => openEditBlock(block)}>수정</Button></div>
        {:else}<p class="text-muted-foreground mt-3 text-sm">선택한 기간에 예정된 개인 일정이 없어요.</p>{/each}
      </section>
    {/if}
  {/if}
</PageContainer>

<!-- 일정 상세 -->
<Dialog.Root open={detailEvent !== null} onOpenChange={(open) => !open && (detailEvent = null)}>
  <Dialog.Content class="max-h-[90dvh] overflow-y-auto sm:max-w-md">
    {#if detailEvent}
      <Dialog.Header>
        <div class="flex min-w-0 flex-wrap items-center gap-2">
          <Badge variant="outline">{EVENT_TYPE_LABELS[detailEvent.event.type] ?? detailEvent.event.type}</Badge>
          <Dialog.Title class="min-w-0 break-words text-base">{detailEvent.event.title}</Dialog.Title>
        </div>
        <Badge variant="secondary" class="whitespace-normal text-xs">{scheduleAttendanceSummary(detailEvent.event.attendances)}</Badge>
      </Dialog.Header>
      <div class="grid gap-3 text-sm">
        <div class="bg-muted/50 grid gap-1 rounded-xl px-4 py-3">
          <p class="font-semibold">{formatDateTime(detailEvent.event.startAt)} – {dayKey(new Date(detailEvent.event.startAt)) === dayKey(new Date(detailEvent.event.endAt)) ? timeText(detailEvent.event.endAt) : formatDateTime(detailEvent.event.endAt)}</p>
          <p class="text-muted-foreground">{detailEvent.event.production.title}</p>
          {#if detailEvent.event.location}
            <p class="text-muted-foreground">장소 · {detailEvent.event.location}</p>
          {/if}
        </div>
        {#if meetingHttpUrl(detailEvent.event.meetingUrl)}
          <a href={meetingHttpUrl(detailEvent.event.meetingUrl) ?? undefined} target="_blank" rel="noopener noreferrer" class="text-primary underline underline-offset-4">회의 링크 열기</a>
        {/if}
        <div class="grid gap-2">
          <p class="text-muted-foreground text-xs font-semibold tracking-wide uppercase">내 참석</p>
          {@render attendanceButtons(detailEvent)}
          <Button variant="outline" size="sm" onclick={() => duplicateEvent(detailEvent!)}>복제</Button>
        </div>
      </div>
    {/if}
  </Dialog.Content>
</Dialog.Root>

<!-- 스케줄 등록 -->
<Dialog.Root bind:open={addOpen}>
  <Dialog.Content class="max-h-[90dvh] overflow-y-auto sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>{editingBlock ? "개인 일정 수정" : "일정 추가"}</Dialog.Title>
      <Dialog.Description>
        {shareTarget
          ? "선택한 공연팀과 공유하고 참석 여부를 확인해요."
          : "나만 보는 개인 일정이에요. 내용은 공개하지 않고, 제작진에게는 시간 충돌 여부만 알려줘요."}
      </Dialog.Description>
    </Dialog.Header>
    <form class="grid gap-4" onsubmit={saveBlock}>
      {#if !editingBlock}
        <div class="grid gap-2">
          <Label for="shareTarget">공유 범위</Label>
          <Select.Root
            type="single"
            bind:value={shareTarget}
            onValueChange={() => clearConflicts()}
          >
            <Select.Trigger id="shareTarget" class="w-full">
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
        <div class="grid min-w-0 gap-3 sm:grid-cols-2">
          <div class="grid gap-2">
            <Label for="evType">유형</Label>
            <Select.Root type="single" bind:value={evType}>
              <Select.Trigger id="evType" class="w-full">{EVENT_TYPE_LABELS[evType] ?? evType}</Select.Trigger>
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
        <div class="grid gap-2">
          <Label for="evMeetingUrl">회의 링크 (선택)</Label>
          <Input id="evMeetingUrl" type="url" bind:value={evMeetingUrl} maxlength={1000} placeholder="https://..." />
        </div>
      {:else}
        <div class="grid gap-2">
          <Label for="personalTitle">일정 이름 <span class="text-destructive">*</span></Label>
          <Input id="personalTitle" bind:value={personalTitle} required maxlength={120} placeholder="예: 회사 근무, 병원 예약, 다른 공연 연습" />
        </div>
        <div class="grid min-w-0 gap-3 sm:grid-cols-2">
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
          <div class="grid min-w-0 gap-3 sm:grid-cols-2">
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
            <p class="text-muted-foreground text-xs">시간을 바꾸는 것을 권해요. 그래도 등록하려면 사유를 적어 주세요.</p>
            <Input bind:value={overrideReason} maxlength={200} placeholder="강행 사유 (예: 전원 필수 리허설)" />
          {:else}
            <p class="text-muted-foreground text-xs">다른 시간으로 바꿔 주세요. 꼭 이 시간이어야 하면 제작진에게 요청해 주세요.</p>
          {/if}
        </div>
      {/if}

      <Dialog.Footer class="gap-2 [&_button]:min-h-11">
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
