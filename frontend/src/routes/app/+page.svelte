<script lang="ts">
  import { onMount } from "svelte";
  import { toast } from "svelte-sonner";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { PageContainer } from "$lib/components/ui/page-container";
  import { PageHeader } from "$lib/components/ui/page-header";
  import { EmptyState } from "$lib/components/ui/empty-state";
  import { ErrorPanel } from "$lib/components/ui/error-panel";
  import { LoadingBlock } from "$lib/components/ui/loading-block";
  import { apiRequest } from "$lib/api/client";
  import { fetchCurrentUser, type CurrentUser } from "$lib/api/auth";
  import { EVENT_TYPE_LABELS, PHASE_LABELS, PRODUCTION_ROLE_LABELS, formatDate, formatDateTime, formatRelative } from "$lib/domain/labels";

  type MyProduction = {
    id: string; title: string; venue: string | null; startDate: string | null; currentPhase: string; visibility: string;
    myMembership?: { id: string; primaryRole: string; roles: string[] };
  };
  type AttendanceStatus = "ACCEPTED" | "DECLINED" | "TENTATIVE";
  type MyAttendance = {
    id: string; status: "INVITED" | AttendanceStatus;
    event: { id: string; type: string; title: string; startAt: string; endAt: string; location: string | null; production: { id: string; title: string } };
  };
  type NotificationItem = { id: string; title?: string; body?: string; href?: string | null; readAt?: string | null; createdAt: string };

  let user = $state<CurrentUser | null>(null);
  let productions = $state<MyProduction[]>([]);
  let attendances = $state<MyAttendance[]>([]);
  let notifications = $state<NotificationItem[]>([]);
  let loading = $state(true);
  let errors = $state({ productions: "", schedule: "", notifications: "" });
  let responding = $state<string | null>(null);
  let loadRevision = 0;
  const RESPONSES: Array<{ status: AttendanceStatus; label: string }> = [
    { status: "ACCEPTED", label: "참석" }, { status: "DECLINED", label: "불참" }, { status: "TENTATIVE", label: "미정" }
  ];
  const upcoming = $derived(attendances.filter((attendance) => Date.parse(attendance.event.endAt) >= Date.now()).sort((a, b) => Date.parse(a.event.startAt) - Date.parse(b.event.startAt)));
  const nextAttendance = $derived(upcoming[0] ?? null);
  const unanswered = $derived(upcoming.filter((attendance) => attendance.status === "INVITED"));
  const otherRequests = $derived(unanswered.filter((attendance) => attendance.id !== nextAttendance?.id));

  onMount(() => { void loadPage(); return () => { loadRevision += 1; }; });

  async function loadPage() {
    const revision = ++loadRevision;
    loading = true;
    const [me, productionResult, scheduleResult, notificationResult] = await Promise.allSettled([
      fetchCurrentUser(), apiRequest<MyProduction[]>("/productions"),
      apiRequest<{ attendances: MyAttendance[] }>("/schedule/me"), apiRequest<{ items: NotificationItem[] }>("/notifications?take=5")
    ]);
    if (revision !== loadRevision) return;
    if (me.status === "fulfilled") user = me.value;
    // 영역별 실패를 구분해 한 요청이 실패해도 다른 공연·일정은 계속 확인할 수 있게 해요.
    productions = productionResult.status === "fulfilled" ? productionResult.value : [];
    attendances = scheduleResult.status === "fulfilled" ? scheduleResult.value.attendances : [];
    notifications = notificationResult.status === "fulfilled" ? notificationResult.value.items : [];
    errors = {
      productions: productionResult.status === "rejected" ? "참여 중인 공연을 불러오지 못했어요." : "",
      schedule: scheduleResult.status === "rejected" ? "내 일정을 불러오지 못했어요. 참석 요청은 다시 불러온 뒤 확인해 주세요." : "",
      notifications: notificationResult.status === "rejected" ? "최근 알림을 불러오지 못했어요." : ""
    };
    loading = false;
  }

  async function respond(attendance: MyAttendance, status: AttendanceStatus) {
    if (responding || attendance.status === status) return;
    responding = attendance.id;
    try {
      await apiRequest(`/productions/${attendance.event.production.id}/events/${attendance.event.id}/attendance`, { method: "POST", body: JSON.stringify({ status }) });
      attendances = attendances.map((item) => item.id === attendance.id ? { ...item, status } : item);
      toast.success("참석 응답을 저장했어요.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "참석 여부를 저장하지 못했어요."); }
    finally { responding = null; }
  }

  function productionRoles(production: MyProduction) {
    return [...new Set([production.myMembership?.primaryRole, ...(production.myMembership?.roles ?? [])].filter((role): role is string => Boolean(role)))];
  }
  function roleLabel(production: MyProduction) {
    return productionRoles(production).map((role) => PRODUCTION_ROLE_LABELS[role] ?? role).join(" · ");
  }
  function showsCues(production: MyProduction) {
    return productionRoles(production).some((role) => ["STAFF", "PRODUCER", "DIRECTOR", "MUSIC_DIRECTOR", "STAGE_MANAGER"].includes(role)) || user?.platformRole === "SUPER_ADMIN";
  }
  function attendanceLabel(status: MyAttendance["status"]) {
    return status === "INVITED" ? "미응답" : RESPONSES.find((response) => response.status === status)?.label ?? status;
  }
  function scheduleLink(attendance: MyAttendance) {
    return `/app/p/${attendance.event.production.id}/schedule?eventId=${attendance.event.id}`;
  }
</script>

{#snippet responseButtons(attendance: MyAttendance)}
  <div class="flex min-w-0 flex-wrap items-center gap-2" role="group" aria-label={`${attendance.event.title} 참석 여부`}>
    {#each RESPONSES as response (response.status)}
      <Button size="sm" variant={attendance.status === response.status ? "secondary" : "outline"} class="min-h-11 min-w-16" aria-pressed={attendance.status === response.status} disabled={responding !== null || attendance.status === response.status} onclick={() => respond(attendance, response.status)}>{response.label}</Button>
    {/each}
  </div>
{/snippet}

<PageContainer class="min-w-0 space-y-7">
  <PageHeader title="내 공연" description={user?.name ? `${user.name}님, 다음 일정과 참여 중인 공연이에요.` : "다음 일정과 참여 중인 공연이에요."} />
  {#if loading}
    <LoadingBlock lines={7} class="rounded-2xl border bg-card p-6" />
  {:else}
    <section class="min-w-0 space-y-3" aria-labelledby="my-next-schedule">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 id="my-next-schedule" class="text-lg font-semibold">다음 내 일정</h2>
        <Button href="/app/schedule" variant="ghost" class="min-h-11">내 일정 모두 보기</Button>
      </div>
      {#if errors.schedule}
        <ErrorPanel class="[&_button]:min-h-11" title="일정을 확인하지 못했어요" message={errors.schedule} onRetry={() => void loadPage()} />
      {:else if nextAttendance}
        <article class="min-w-0 space-y-4 rounded-2xl border border-primary/25 bg-card p-5 sm:p-6">
          <div class="flex min-w-0 flex-wrap items-start justify-between gap-3">
            <div class="min-w-0 flex-1 basis-48">
              <p class="text-muted-foreground text-sm">{nextAttendance.event.production.title} · {EVENT_TYPE_LABELS[nextAttendance.event.type] ?? nextAttendance.event.type}</p>
              <h3 class="mt-1 break-words text-xl font-semibold">{nextAttendance.event.title}</h3>
              <p class="mt-2 text-sm leading-6">{formatDateTime(nextAttendance.event.startAt)} ~ {formatDateTime(nextAttendance.event.endAt)}</p>
              <p class="text-muted-foreground text-sm">{nextAttendance.event.location || "장소는 아직 정해지지 않았어요."}</p>
            </div>
            <Badge variant={nextAttendance.status === "INVITED" ? "outline" : "secondary"} class="shrink-0">{attendanceLabel(nextAttendance.status)}</Badge>
          </div>
          <div class="flex min-w-0 flex-wrap items-center justify-between gap-3 border-t pt-4">
            {@render responseButtons(nextAttendance)}
            <Button href={scheduleLink(nextAttendance)} class="min-h-11">일정 확인</Button>
          </div>
        </article>
        {#if otherRequests.length}
          <div class="min-w-0 rounded-2xl border bg-card p-4 sm:p-5">
            <h3 class="font-semibold">참석 여부를 알려 주세요 <span class="text-primary ms-1">{otherRequests.length}건</span></h3>
            <ul class="mt-2 divide-y">
              {#each otherRequests.slice(0, 4) as attendance (attendance.id)}
                <li class="flex min-w-0 flex-wrap items-center justify-between gap-3 py-3">
                  <a href={scheduleLink(attendance)} class="min-h-11 min-w-0 flex-1 basis-48 py-1">
                    <p class="break-words text-sm font-medium">{attendance.event.title}</p>
                    <p class="text-muted-foreground mt-1 text-xs leading-5">{formatDateTime(attendance.event.startAt)} · {attendance.event.production.title}</p>
                  </a>
                  {@render responseButtons(attendance)}
                </li>
              {/each}
            </ul>
            {#if otherRequests.length > 4}<Button href="/app/schedule" variant="ghost" class="min-h-11 w-full">남은 참석 요청 {otherRequests.length - 4}건 보기</Button>{/if}
          </div>
        {/if}
      {:else}
        <EmptyState title="예정된 내 일정이 없어요" description="공연팀이 연습 일정을 등록하고 나를 배정하면 여기에 보여요.">
          {#snippet action()}<Button href="/app/schedule" variant="outline" class="min-h-11">내 일정 열기</Button>{/snippet}
        </EmptyState>
      {/if}
    </section>

    <section class="min-w-0 space-y-3" aria-labelledby="my-productions">
      <div><h2 id="my-productions" class="text-lg font-semibold">참여 중인 공연</h2><p class="text-muted-foreground mt-1 text-sm">공연별 일정과 맡은 역할을 확인해요.</p></div>
      {#if errors.productions}
        <ErrorPanel class="[&_button]:min-h-11" message={errors.productions} onRetry={() => void loadPage()} />
      {:else if !productions.length}
        <EmptyState title="아직 참여 중인 공연이 없어요" description="모집 중인 공연에 지원하거나 받은 초대 링크를 확인해 주세요.">
          {#snippet action()}<Button href="/app/opportunities" class="min-h-11">참여할 공연 찾기</Button>{/snippet}
        </EmptyState>
      {:else}
        <div class="grid min-w-0 gap-4 md:grid-cols-2">
          {#each productions as production (production.id)}
            <article class="flex min-w-0 flex-col rounded-2xl border bg-card p-5">
              <div class="flex min-w-0 items-start justify-between gap-3">
                <a href={`/app/p/${production.id}`} class="inline-flex min-h-11 min-w-0 flex-1 items-center py-1 text-lg font-semibold [overflow-wrap:anywhere] hover:underline">{production.title}</a>
                <Badge variant="secondary" class="shrink-0">{PHASE_LABELS[production.currentPhase] ?? production.currentPhase}</Badge>
              </div>
              {#if roleLabel(production)}<p class="mt-2 text-sm">내 역할 · {roleLabel(production)}</p>{/if}
              <p class="text-muted-foreground mt-1 text-xs leading-5">{production.venue || "장소 미정"}{#if production.startDate} · {formatDate(production.startDate)}{/if}</p>
              <nav aria-label={`${production.title} 바로가기`} class="mt-4 grid grid-cols-2 gap-2 border-t pt-3">
                <Button href={`/app/p/${production.id}/${showsCues(production) ? "cuesheet" : "script"}`} variant="outline" size="touch">{showsCues(production) ? "큐시트 보기" : "대본 읽기"}</Button>
                <Button href={`/app/p/${production.id}/schedule`} variant="outline" size="touch">공연 일정</Button>
                <Button href={`/app/p/${production.id}/live`} variant="ghost" size="touch">개인 연습</Button>
                {#if showsCues(production)}
                  <Button href={`/app/p/${production.id}/script`} variant="ghost" size="touch">대본 읽기</Button>
                {:else}
                  <Button href={`/app/p/${production.id}`} variant="ghost" size="touch">공연 홈</Button>
                {/if}
              </nav>
            </article>
          {/each}
        </div>
      {/if}
    </section>

    <nav aria-label="공연 지원" class="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-5">
      <div><h2 class="font-semibold">다음 공연을 찾고 있나요?</h2><p class="text-muted-foreground mt-1 text-sm">배우·스태프 모집을 확인하고 지원할 수 있어요.</p></div>
      <div class="flex flex-wrap gap-2"><Button href="/app/opportunities" variant="outline" class="min-h-11">참여할 공연 찾기</Button><Button href="/app/applications" variant="ghost" class="min-h-11">내 지원 현황</Button></div>
    </nav>

    <section class="space-y-3" aria-labelledby="recent-notifications">
      <div class="flex flex-wrap items-center justify-between gap-2"><h2 id="recent-notifications" class="text-lg font-semibold">최근 알림</h2><Button href="/app/notifications" variant="ghost" class="min-h-11">알림 모두 보기</Button></div>
      {#if errors.notifications}
        <ErrorPanel class="[&_button]:min-h-11" message={errors.notifications} onRetry={() => void loadPage()} />
      {:else if !notifications.length}
        <EmptyState title="아직 받은 알림이 없어요" description="일정 변경이나 공연팀의 새 소식이 오면 여기에서 확인해요." />
      {:else}
        <ul class="divide-y rounded-2xl border bg-card">
          {#each notifications as notification (notification.id)}
            <li><a href={notification.href ?? "/app/notifications"} class="hover:bg-muted/40 block min-h-11 px-5 py-4">
              <p class="flex items-start gap-2 text-sm {notification.readAt ? 'text-muted-foreground' : 'font-medium'}">{#if !notification.readAt}<span class="bg-primary mt-1.5 size-1.5 shrink-0 rounded-full" aria-label="읽지 않음"></span>{/if}<span class="min-w-0 break-words">{notification.title ?? "공연 알림"}</span></p>
              {#if notification.body}<p class="text-muted-foreground mt-1 line-clamp-2 text-sm leading-6">{notification.body}</p>{/if}
              <p class="text-muted-foreground mt-1 text-xs">{formatRelative(notification.createdAt)}</p>
            </a></li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</PageContainer>
