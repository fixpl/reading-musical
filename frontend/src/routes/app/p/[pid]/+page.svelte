<script lang="ts">
    import { page } from "$app/stores";
  import { toast } from "svelte-sonner";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import { apiRequest } from "$lib/api/client";
  import { fetchCurrentUser } from "$lib/api/auth";
  import { getMyProduction, type MyProduction } from "$lib/api/productions";
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
    user: { id: string; name: string };
  };

  type ProductionDetail = {
    id: string;
    title: string;
    venue: string | null;
    synopsis: string | null;
    startDate: string | null;
    endDate: string | null;
  };

  const CATEGORY_LABELS: Record<string, string> = { NOTICE: "공지", QUESTION: "질문", MATERIAL: "자료" };

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

  async function loadPage() {
    try {
      const [me, found] = await Promise.all([fetchCurrentUser(), getMyProduction(pid)]);
      production = found;

      const [detailResult, schedule, board, peopleResult] = await Promise.allSettled([
        apiRequest<ProductionDetail>(`/productions/${pid}`),
        apiRequest<{ events: WorkspaceEvent[] }>(`/productions/${pid}/schedule`),
        apiRequest<{ items: Post[] }>(`/productions/${pid}/board`),
        apiRequest<{ people: Person[] }>(`/productions/${pid}/people`)
      ]);
      if (detailResult.status === "fulfilled") detail = detailResult.value;
      if (board.status === "fulfilled") posts = board.value.items.slice(0, 4);
      if (peopleResult.status === "fulfilled") people = peopleResult.value.people;
      if (schedule.status === "fulfilled") {
        events = schedule.value.events;
        const upcoming = [...events]
          .filter((event) => new Date(event.endAt).getTime() >= Date.now())
          .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
        nextEvent = upcoming[0] ?? null;
        if (nextEvent && me) {
          const mine = nextEvent.attendances.find((attendance) => attendance.membership.user?.id === me.id);
          myAttendanceStatus = mine?.status ?? null;
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "공연 정보를 불러오지 못했습니다");
    } finally {
      loading = false;
    }
  }

  // pid가 바뀌어도(같은 라우트에서 공연 전환·딥링크) 다시 불러온다 — onMount는 재실행되지 않음.
  $effect(() => {
    void pid;
    void loadPage();
  });

  async function respond(status: "ACCEPTED" | "DECLINED") {
    if (!nextEvent) return;
    responding = true;
    try {
      await apiRequest(`/productions/${pid}/events/${nextEvent.id}/attendance`, {
        method: "POST",
        body: JSON.stringify({ status })
      });
      myAttendanceStatus = status;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "응답하지 못했습니다");
    } finally {
      responding = false;
    }
  }

  // ── 미니 달력 ──
  const today = new Date();
  let calYear = $state(today.getFullYear());
  let calMonth = $state(today.getMonth()); // 0-11

  const dayKey = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

  const eventDays = $derived.by(() => {
    const map = new Map<string, number>();
    for (const event of events) {
      const key = dayKey(new Date(event.startAt));
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
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
      const date = new Date(event.startAt);
      return date.getFullYear() === calYear && date.getMonth() === calMonth;
    }).length
  );

  const myRole = $derived.by(() => {
    const role = production?.myMembership?.primaryRole;
    return role ? (PRODUCTION_ROLE_LABELS[role] ?? role) : null;
  });

  const periodText = $derived.by(() => {
    if (!detail?.startDate) return null;
    const start = formatDate(detail.startDate);
    return detail.endDate && detail.endDate !== detail.startDate ? `${start} ~ ${formatDate(detail.endDate)}` : start;
  });
</script>

<svelte:head>
  <title>{production?.title ?? "공연"} — 아트브릿지</title>
</svelte:head>

{#if loading}
  <div class="mx-auto w-full max-w-5xl space-y-4">
    <Skeleton class="h-9 w-2/3" />
    <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Skeleton class="h-96 w-full rounded-2xl" />
      <Skeleton class="h-96 w-full rounded-2xl" />
    </div>
  </div>
{:else if !production}
  <div class="mx-auto w-full max-w-xl py-16 text-center">
    <p class="text-lg font-semibold">공연을 찾을 수 없습니다</p>
    <p class="text-muted-foreground mt-1 text-sm">배정이 해제됐거나 아직 공개되지 않은 공연입니다.</p>
    <Button href="/app" variant="outline" class="mt-6">홈으로</Button>
  </div>
{:else}
  <div class="mx-auto w-full max-w-5xl">
    <div class="py-2">
      <div class="flex flex-wrap items-center gap-2">
        <h1 class="text-2xl font-bold tracking-tight">{production.title}</h1>
        <Badge variant="secondary">{PHASE_LABELS[production.currentPhase] ?? production.currentPhase}</Badge>
      </div>
      <p class="text-muted-foreground mt-1 text-sm">
        {#if myRole}내 역할 · {myRole}{/if}
        {#if detail?.venue}
          · {detail.venue}
        {/if}
        {#if periodText}
          · {periodText}
        {/if}
      </p>
      {#if detail?.synopsis}
        <p class="text-muted-foreground mt-1 text-sm">{detail.synopsis}</p>
      {/if}
    </div>

    <div class="mt-2 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <!-- 왼쪽: 다음 일정 + 공지·소통 -->
      <div class="grid content-start gap-4">
        {#if nextEvent}
          <div class="bg-card rounded-2xl p-5">
            <p class="text-primary text-xs font-semibold">다음 일정</p>
            <p class="mt-1.5 text-lg font-semibold">{nextEvent.title}</p>
            <p class="text-muted-foreground mt-0.5 text-sm">
              {formatDateTime(nextEvent.startAt)}
              {#if nextEvent.location}
                · {nextEvent.location}
              {/if}
              · {EVENT_TYPE_LABELS[nextEvent.type] ?? nextEvent.type}
            </p>
            <div class="mt-4 flex gap-2">
              {#if myAttendanceStatus === "ACCEPTED"}
                <Badge variant="secondary" class="px-3 py-1.5">참석 예정</Badge>
                <Button variant="ghost" size="sm" disabled={responding} onclick={() => respond("DECLINED")}>변경</Button>
              {:else if myAttendanceStatus === "DECLINED"}
                <Badge variant="outline" class="px-3 py-1.5">불참</Badge>
                <Button variant="ghost" size="sm" disabled={responding} onclick={() => respond("ACCEPTED")}>변경</Button>
              {:else if myAttendanceStatus}
                <Button class="flex-1" disabled={responding} onclick={() => respond("ACCEPTED")}>참석</Button>
                <Button variant="outline" class="flex-1" disabled={responding} onclick={() => respond("DECLINED")}>
                  불참
                </Button>
              {/if}
            </div>
          </div>
        {/if}

        <div class="bg-card rounded-2xl p-5">
          <div class="flex items-center justify-between">
            <p class="font-semibold">공지 · 소통</p>
            <a href={`/app/p/${pid}/board`} class="text-muted-foreground hover:text-foreground text-xs">전체 보기</a>
          </div>
          {#if posts.length === 0}
            <p class="text-muted-foreground mt-3 text-sm">아직 글이 없습니다. 공지나 질문을 올려보세요.</p>
          {:else}
            <div class="mt-2 grid">
              {#each posts as post (post.id)}
                <a
                  href={`/app/p/${pid}/board/${post.id}`}
                  class="border-border/50 hover:bg-accent/50 -mx-2 flex items-center gap-2.5 rounded-lg border-b px-2 py-2.5 transition-colors last:border-0"
                >
                  <Badge variant={post.category === "NOTICE" ? "default" : "outline"} class="shrink-0 text-xs">
                    {CATEGORY_LABELS[post.category]}
                  </Badge>
                  <span class="min-w-0 flex-1 truncate text-sm font-medium">{post.title}</span>
                  <span class="text-muted-foreground shrink-0 text-xs">
                    {#if post._count.comments > 0}
                      답변 {post._count.comments} ·
                    {/if}
                    {formatRelative(post.createdAt)}
                  </span>
                </a>
              {/each}
            </div>
          {/if}
        </div>
      </div>

      <!-- 오른쪽: 달력 + 참여자 -->
      <div class="grid content-start gap-4">
        <div class="bg-card rounded-2xl p-5">
          <div class="flex items-center justify-between">
            <p class="font-semibold">{calYear}년 {calMonth + 1}월</p>
            <div class="flex items-center gap-1">
              <Button variant="ghost" size="icon" class="size-7" onclick={() => moveMonth(-1)} aria-label="이전 달">
                <ChevronLeftIcon class="size-4" />
              </Button>
              <Button variant="ghost" size="icon" class="size-7" onclick={() => moveMonth(1)} aria-label="다음 달">
                <ChevronRightIcon class="size-4" />
              </Button>
            </div>
          </div>
          <div class="text-muted-foreground/70 mt-3 grid grid-cols-7 text-center text-[11px] font-semibold">
            {#each ["일", "월", "화", "수", "목", "금", "토"] as weekday (weekday)}
              <span class="py-1">{weekday}</span>
            {/each}
          </div>
          <div class="grid grid-cols-7">
            {#each calendarCells as cell (cell.key)}
              <a
                href={cell.eventCount > 0 ? `/app/p/${pid}/schedule` : undefined}
                class="flex aspect-square flex-col items-center justify-center gap-0.5 rounded-lg text-xs
                  {cell.inMonth ? '' : 'text-muted-foreground/40'}
                  {cell.isToday ? 'bg-primary/10 text-primary font-bold' : ''}
                  {cell.eventCount > 0 ? 'hover:bg-accent cursor-pointer font-semibold' : ''}"
              >
                {cell.day}
                {#if cell.eventCount > 0}
                  <span class="bg-primary size-1 rounded-full"></span>
                {:else}
                  <span class="size-1"></span>
                {/if}
              </a>
            {/each}
          </div>
          <a
            href={`/app/p/${pid}/schedule`}
            class="text-muted-foreground hover:text-foreground mt-2 block text-center text-xs underline-offset-4 hover:underline"
          >
            이번 달 일정 {monthEventCount}개 · 전체 보기
          </a>
        </div>

        <div class="bg-card rounded-2xl p-5">
          <div class="flex items-center justify-between">
            <p class="font-semibold">참여자 {people.length}명</p>
            <a href={`/app/p/${pid}/people`} class="text-muted-foreground hover:text-foreground text-xs">전체 보기</a>
          </div>
          {#if people.length === 0}
            <p class="text-muted-foreground mt-3 text-sm">아직 배정된 참여자가 없습니다.</p>
          {:else}
            <div class="mt-3 grid gap-2">
              {#each people.slice(0, 6) as person (person.id)}
                <div class="flex items-center gap-2.5">
                  <span
                    class="bg-primary/15 text-primary flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                  >
                    {person.user.name.slice(0, 2)}
                  </span>
                  <span class="min-w-0 flex-1 truncate text-sm font-medium">{person.user.name}</span>
                  <Badge variant="outline" class="shrink-0 text-xs">
                    {PRODUCTION_ROLE_LABELS[person.primaryRole] ?? person.primaryRole}
                  </Badge>
                </div>
              {/each}
              {#if people.length > 6}
                <a href={`/app/p/${pid}/people`} class="text-muted-foreground text-xs hover:underline">
                  외 {people.length - 6}명 더 보기
                </a>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}
