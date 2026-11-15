<script lang="ts">
  import { page } from "$app/stores";
  import { beforeNavigate, goto } from "$app/navigation";
  import { onDestroy, tick, untrack } from "svelte";
  import { Plus, Users, ArrowUpRight, RefreshCw, CalendarDays, MapPin } from "@lucide/svelte";
  import { toast } from "svelte-sonner";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { PageHeader } from "$lib/components/ui/page-header";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import { ErrorPanel } from "$lib/components/ui/error-panel";
  import { EmptyState } from "$lib/components/ui/empty-state";
  import { ConfirmDialog, type ConfirmAsk } from "$lib/components/ui/confirm-dialog";
  import { ApiError } from "$lib/api/client";
  import {
    getRecruitmentAccess, listRecruitmentRounds, createRecruitmentRound, updateRecruitmentRound,
    publishRecruitmentRound, closeRecruitmentRound, cancelRecruitmentRound,
    listRoundApplications, reviewRecruitmentApplication,
    type RecruitmentRound, type RecruitmentRoundDocument, type RecruitmentApplication, type RecruitmentReviewStatus
  } from "$lib/api/recruitment";
  import {
    RECRUITMENT_ROLE_LABELS, RECRUITMENT_ROUND_LABELS,
    recruitmentDateTime, recruitmentPeriod, recruitmentTone, isPendingRecruitmentApplication
  } from "$lib/domain/recruitment";
  import ManagerRoundForm from "$lib/components/recruitment/manager-round-form.svelte";
  import ManagerApplicationCard from "$lib/components/recruitment/manager-application-card.svelte";

  const pid = $derived($page.params.pid ?? "");
  const ROUND_LIMIT = 10;
  const APPLICATION_LIMIT = 20;
  let loading = $state(true);
  let forbidden = $state(false);
  let loadError = $state("");
  let rounds = $state<RecruitmentRound[]>([]);
  let roundsTotal = $state(0);
  let roundsOffset = $state(0);
  let roundsHasMore = $state(false);
  let roundsLoading = $state(false);
  let roundsError = $state("");
  let selected = $state<RecruitmentRound | null>(null);
  let creating = $state(false);
  let formDocument = $state<RecruitmentRoundDocument>(newDocument());
  let formDirty = $state(false);
  let formError = $state("");
  let draftStale = $state(false);
  let busy = $state("");
  let actionError = $state("");
  let actionMessage = $state("");
  let applications = $state<RecruitmentApplication[]>([]);
  let applicationsTotal = $state(0);
  let applicationsOffset = $state(0);
  let applicationsHasMore = $state(false);
  let applicationsLoading = $state(false);
  let applicationsError = $state("");
  let reviewsStale = $state(false);
  let reviewNotes = $state<Record<string, string>>({});
  let confirmation: { ask: ConfirmAsk };
  let generation = 0;
  let roundsRequest = 0;
  let applicationsRequest = 0;
  let disposed = false;
  let leaving = false;
  let askingLeave = false;
  let resumedPopstate: { href: string; delta: number } | null = null;
  const hasReviewNotes = $derived(Object.values(reviewNotes).some((note) => note.trim()));
  const dirty = $derived(formDirty || hasReviewNotes);
  const productionTitle = $derived(selected?.productionTitle ?? rounds[0]?.productionTitle ?? "");

  function newDocument(): RecruitmentRoundDocument {
    return { title: "", summary: "", description: "", region: "", activityStartDate: null,
      activityEndDate: null, conditions: "", deadlineAt: null, positions: [{ role: "ACTOR", label: "배우", capacity: 1 }] };
  }
  function documentFor(round: RecruitmentRound): RecruitmentRoundDocument {
    return { title: round.title, summary: round.summary, description: round.description, region: round.region,
      activityStartDate: round.activityStartDate, activityEndDate: round.activityEndDate,
      conditions: round.conditions, deadlineAt: round.deadlineAt,
      positions: round.positions.map(({ role, label, capacity }) => ({ role, label, capacity })) };
  }
  function current(id: string, version: number) { return !disposed && id === pid && version === generation; }
  onDestroy(() => { disposed = true; generation += 1; roundsRequest += 1; applicationsRequest += 1; });
  $effect(() => { const id = pid; untrack(() => { void initialize(id); }); });

  beforeNavigate((navigation) => {
    if (resumedPopstate && navigation.type === "popstate" && navigation.delta === resumedPopstate.delta && navigation.to?.url.href === resumedPopstate.href) { resumedPopstate = null; return; }
    if (leaving || (!dirty && !busy)) return;
    if (!navigation.willUnload && navigation.from?.url.pathname === navigation.to?.url.pathname && navigation.from?.url.search === navigation.to?.url.search) return;
    navigation.cancel();
    if (navigation.willUnload) return;
    if (busy) { toast.info("저장하고 있어요. 잠시 기다린 뒤 이동해 주세요."); return; }
    if (!navigation.to?.url || askingLeave) return;
    void confirmLeave(navigation.to.url, navigation.type === "popstate" ? navigation.delta : undefined);
  });
  async function confirmLeave(target: URL, delta?: number) {
    askingLeave = true;
    try {
      const answer = await confirmation.ask({ title: "작성 중인 내용을 남기고 이동할까요?", description: "저장하지 않은 모집 초안과 지원자에게 보내지 않은 말은 사라져요.", confirmLabel: "저장하지 않고 이동" });
      if (!answer.confirmed) return;
      if (delta !== undefined) { resumedPopstate = { href: target.href, delta }; history.go(delta); return; }
      leaving = true; await goto(target);
    } catch { actionError = "화면을 열지 못했어요. 입력한 내용은 그대로예요."; }
    finally { leaving = false; askingLeave = false; }
  }
  async function discardForSelection() {
    if (busy) return false;
    if (!dirty) return true;
    const answer = await confirmation.ask({ title: "다른 모집을 열까요?", description: "저장하지 않은 모집 초안과 지원자에게 보내지 않은 말은 사라져요.", confirmLabel: "저장하지 않고 열기" });
    return answer.confirmed;
  }

  async function initialize(id: string) {
    const version = ++generation;
    roundsRequest += 1; applicationsRequest += 1;
    loading = true; forbidden = false; loadError = ""; rounds = []; roundsTotal = 0;
    roundsOffset = 0; roundsHasMore = false; roundsError = ""; roundsLoading = false;
    selected = null; creating = false; formDirty = false; formDocument = newDocument(); formError = "";
    draftStale = false; busy = ""; actionError = ""; actionMessage = ""; reviewNotes = {};
    clearApplications();
    try {
      const access = await getRecruitmentAccess(id);
      if (!current(id, version)) return;
      if (!access.canManageRecruitment) { forbidden = true; return; }
      await fetchRounds(0, true, id, version);
    } catch (error) {
      if (!current(id, version)) return;
      if (error instanceof ApiError && error.status === 403) forbidden = true;
      else loadError = error instanceof Error ? error.message : "모집 관리를 불러오지 못했어요.";
    } finally { if (current(id, version)) loading = false; }
  }
  function clearApplications() {
    applicationsRequest += 1;
    applications = []; applicationsTotal = 0; applicationsOffset = 0; applicationsHasMore = false;
    applicationsLoading = false; applicationsError = ""; reviewsStale = false;
  }
  function showRound(round: RecruitmentRound | null) {
    selected = round; creating = false; formDirty = false; draftStale = false; formError = "";
    actionError = ""; actionMessage = ""; reviewNotes = {}; formDocument = round ? documentFor(round) : newDocument();
    clearApplications();
    if (round && round.status !== "DRAFT") void fetchApplications(0, round.id);
  }
  async function revealSelection(id: string, version: number, selection: string) {
    await tick();
    // 좁은 화면에서 직접 선택했을 때만 아래에 펼쳐진 내용을 보여 준다.
    if (!current(id, version) || (creating ? "new" : selected?.id) !== selection || window.matchMedia("(min-width: 1024px)").matches) return;
    const heading = document.getElementById(creating || selected?.status === "DRAFT" ? "draft-heading" : "selected-round-heading");
    if (!heading?.isConnected) return;
    heading.focus({ preventScroll: true });
    heading.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }
  async function chooseRound(round: RecruitmentRound) {
    const id = pid, version = generation;
    if (selected?.id === round.id && !creating) { void revealSelection(id, version, round.id); return; }
    if (!(await discardForSelection()) || !current(id, version)) return;
    showRound(round);
    void revealSelection(id, version, round.id);
  }
  async function startNew() {
    const id = pid, version = generation;
    if (!(await discardForSelection()) || !current(id, version)) return;
    showRound(null); creating = true;
    void revealSelection(id, version, "new");
  }
  async function fetchRounds(offset: number, selectFirst = false, id = pid, version = generation) {
    const request = ++roundsRequest;
    roundsLoading = true; roundsError = "";
    try {
      const result = await listRecruitmentRounds(id, { limit: ROUND_LIMIT, offset });
      if (!current(id, version) || request !== roundsRequest) return;
      rounds = result.items; roundsTotal = result.total; roundsOffset = result.offset; roundsHasMore = result.hasMore;
      if (selectFirst) showRound(result.items[0] ?? null);
    } catch (error) {
      if (!current(id, version) || request !== roundsRequest) return;
      roundsError = error instanceof Error ? error.message : "모집 목록을 불러오지 못했어요.";
    } finally { if (current(id, version) && request === roundsRequest) roundsLoading = false; }
  }
  async function changeRoundPage(offset: number) {
    if (roundsLoading || busy) return;
    const id = pid, version = generation;
    if (!(await discardForSelection()) || !current(id, version)) return;
    await fetchRounds(offset, true, id, version);
  }
  async function fetchApplications(offset: number, rid = selected?.id) {
    if (!rid) return;
    const id = pid, version = generation, request = ++applicationsRequest;
    applicationsLoading = true; applicationsError = "";
    try {
      const result = await listRoundApplications(id, rid, { limit: APPLICATION_LIMIT, offset });
      if (!current(id, version) || request !== applicationsRequest || selected?.id !== rid) return;
      applications = result.items; applicationsTotal = result.total; applicationsOffset = result.offset; applicationsHasMore = result.hasMore;
    } catch (error) {
      if (current(id, version) && request === applicationsRequest && selected?.id === rid) applicationsError = error instanceof Error ? error.message : "지원 목록을 불러오지 못했어요.";
    } finally { if (current(id, version) && request === applicationsRequest && selected?.id === rid) applicationsLoading = false; }
  }
  async function changeApplicationPage(offset: number) {
    if (busy || applicationsLoading || !selected) return;
    const id = pid, version = generation, rid = selected.id;
    if (hasReviewNotes) {
      const answer = await confirmation.ask({ title: "다른 지원 목록을 볼까요?", description: "아직 지원자에게 보내지 않은 말은 이 화면에 남아 있어요. 현재 페이지로 돌아오면 이어서 쓸 수 있어요.", confirmLabel: "다른 페이지 보기" });
      if (!answer.confirmed || !current(id, version) || selected?.id !== rid) return;
    }
    await fetchApplications(offset, rid);
  }
  function applyRound(round: RecruitmentRound) {
    rounds = rounds.map((item) => item.id === round.id ? round : item);
    if (selected?.id === round.id || creating) selected = round;
  }
  async function saveDocument(document: RecruitmentRoundDocument) {
    if (busy || draftStale || (!creating && selected?.status !== "DRAFT")) return;
    const id = pid, version = generation, round = selected;
    busy = "save"; formError = ""; actionError = ""; actionMessage = "";
    try {
      const result = creating ? await createRecruitmentRound(id, document) : await updateRecruitmentRound(id, round!.id, round!.revision, document);
      if (!current(id, version)) return;
      const wasCreating = creating;
      if (wasCreating) roundsTotal += 1;
      applyRound(result); selected = result; creating = false; formDocument = documentFor(result); formDirty = false;
      actionMessage = "모집 초안을 저장했어요. 내용을 확인한 뒤 게시하면 회원들이 지원할 수 있어요.";
      toast.success("모집 초안을 저장했어요");
      if (wasCreating) void fetchRounds(0, false, id, version);
    } catch (error) {
      if (!current(id, version)) return;
      if (error instanceof ApiError && error.status === 409) { draftStale = true; formError = "다른 창에서 이 모집이 바뀌었어요. 입력한 내용은 남아 있어요. 최신 초안을 확인한 뒤 다시 작성해 주세요."; }
      else formError = error instanceof Error ? error.message : "초안을 저장하지 못했어요. 입력한 내용은 그대로예요.";
    } finally { if (current(id, version)) busy = ""; }
  }
  async function refreshSelected() {
    if (!selected || busy) return;
    const id = pid, version = generation, rid = selected.id;
    if (formDirty) {
      const answer = await confirmation.ask({ title: "최신 초안을 불러올까요?", description: "이 화면에서 아직 저장하지 않은 모집 내용은 최신 초안으로 바뀌어요.", confirmLabel: "최신 초안 불러오기" });
      if (!answer.confirmed || !current(id, version) || selected?.id !== rid) return;
    }
    busy = "refresh"; actionError = "";
    try {
      const result = await listRecruitmentRounds(id, { limit: ROUND_LIMIT, offset: roundsOffset });
      if (!current(id, version) || selected?.id !== rid) return;
      let latest = result.items.find((round) => round.id === rid);
      if (!latest && roundsOffset !== 0) {
        const first = await listRecruitmentRounds(id, { limit: ROUND_LIMIT, offset: 0 });
        if (!current(id, version) || selected?.id !== rid) return;
        latest = first.items.find((round) => round.id === rid);
      }
      if (!latest) throw new Error("현재 목록에서 이 모집을 찾지 못했어요. 목록을 새로 불러오고 모집을 다시 선택해 주세요. 입력한 내용은 남아 있어요.");
      rounds = result.items; roundsTotal = result.total; roundsOffset = result.offset; roundsHasMore = result.hasMore;
      selected = latest; formDocument = documentFor(latest); formDirty = false; formError = ""; draftStale = false; reviewsStale = false;
      actionMessage = "최신 모집 상태를 확인했어요.";
      if (latest.status !== "DRAFT") await fetchApplications(applicationsOffset, rid);
    } catch (error) { if (current(id, version) && selected?.id === rid) actionError = error instanceof Error ? error.message : "최신 상태를 불러오지 못했어요. 입력한 내용은 그대로예요."; }
    finally { if (current(id, version)) busy = ""; }
  }
  async function changeRoundStatus(action: "publish" | "close" | "cancel") {
    if (!selected || busy || draftStale) return;
    const id = pid, version = generation, round = selected;
    if (action === "publish" && formDirty) { formError = "수정한 초안을 먼저 저장한 뒤 게시해 주세요."; return; }
    const options = action === "publish"
      ? { title: "이 모집을 게시할까요?", description: "게시하면 회원들이 지원할 수 있어요. 게시한 뒤에는 내용·자리·정원·마감일을 바꿀 수 없으니 조건이 달라지면 새 모집을 작성해 주세요.", confirmLabel: "모집 게시" }
      : action === "close"
        ? { title: "지원 접수를 마감할까요?", description: "새 지원과 재지원을 받지 않아요. 이미 접수한 지원서는 계속 검토하고 승인할 수 있어요.", confirmLabel: "접수 마감" }
        : { title: "이 모집을 취소할까요?", description: "검토가 끝나지 않은 지원은 모집 취소로 종료돼요. 이미 참여가 확정된 공연 멤버는 유지돼요. 저장하지 않은 초안 수정은 남지 않아요.", confirmLabel: "모집 취소", destructive: true };
    const answer = await confirmation.ask(options);
    if (!answer.confirmed || !current(id, version) || selected?.id !== round.id || busy) return;
    busy = action; actionError = ""; actionMessage = "";
    try {
      const result = action === "publish" ? await publishRecruitmentRound(id, round.id, round.revision)
        : action === "close" ? await closeRecruitmentRound(id, round.id, round.revision)
        : await cancelRecruitmentRound(id, round.id, round.revision);
      if (!current(id, version) || selected?.id !== round.id) return;
      applyRound(result); formDocument = documentFor(result); formDirty = false; formError = "";
      actionMessage = action === "publish" ? "모집을 게시했어요. 회원들이 ‘참여할 공연 찾기’에서 지원할 수 있어요." : action === "close" ? "접수를 마감했어요. 기존 지원은 계속 검토할 수 있어요." : "모집을 취소했어요. 이미 확정한 멤버는 그대로예요.";
      toast.success(action === "publish" ? "모집을 게시했어요" : action === "close" ? "접수를 마감했어요" : "모집을 취소했어요");
      if (result.status !== "DRAFT") await fetchApplications(0, result.id);
    } catch (error) {
      if (!current(id, version) || selected?.id !== round.id) return;
      if (error instanceof ApiError && error.status === 409) { draftStale = true; actionError = "다른 창에서 모집 상태가 바뀌었어요. 최신 상태를 확인한 뒤 다시 진행해 주세요."; }
      else actionError = error instanceof Error ? error.message : "모집 상태를 바꾸지 못했어요.";
      toast.error(actionError);
    } finally { if (current(id, version)) busy = ""; }
  }
  async function review(application: RecruitmentApplication, status: RecruitmentReviewStatus) {
    if (!selected || busy || reviewsStale || selected.status === "CANCELLED" || !isPendingRecruitmentApplication(application.status)) return;
    const id = pid, version = generation, rid = selected.id;
    const role = RECRUITMENT_ROLE_LABELS[application.position.role];
    const reviewMessage = (reviewNotes[application.id] ?? "").trim();
    const description = status === "APPROVED"
      ? `${application.applicantName}님을 ${role}로 공연팀에 연결해요. 기존 역할과 소속은 유지하고, 배역이나 담당 직무는 따로 지정해요.`
      : status === "NOT_SELECTED" ? `${application.applicantName}님에게 이번 모집 미선정을 안내해요. 이 회차에 다시 지원할 수는 없어요.`
      : status === "ON_HOLD" ? "추가 검토 중으로 안내해요. 아직 공연 참여가 확정되는 것은 아니에요." : "지원서를 검토 중이라고 안내해요. 아직 공연 참여가 확정되는 것은 아니에요.";
    const answer = await confirmation.ask({ title: status === "APPROVED" ? "공연 참여를 승인할까요?" : status === "NOT_SELECTED" ? "미선정으로 안내할까요?" : status === "ON_HOLD" ? "추가 검토로 바꿀까요?" : "검토 중으로 바꿀까요?", description: `${description}${reviewMessage ? " 입력한 말도 지원자에게 전달돼요." : ""}`, confirmLabel: status === "APPROVED" ? "참여 승인" : status === "NOT_SELECTED" ? "미선정 안내" : "상태 변경", destructive: status === "NOT_SELECTED" });
    if (!answer.confirmed || !current(id, version) || selected?.id !== rid || busy) return;
    busy = `review:${application.id}`; actionError = ""; actionMessage = "";
    try {
      const result = await reviewRecruitmentApplication(id, rid, application.id, { status, expectedRevision: application.revision, reviewMessage });
      if (!current(id, version) || selected?.id !== rid) return;
      applications = applications.map((item) => item.id === result.id ? result : item);
      reviewNotes = { ...reviewNotes, [result.id]: "" }; applyRound(result.round);
      actionMessage = status === "APPROVED" ? `${result.applicantName}님을 ${role}로 공연팀에 추가했어요. ${result.position.role === "ACTOR" ? "배역을 배정해 주세요." : "담당 직무를 지정해 주세요."}` : "지원 상태를 바꿨어요. 지원자에게 알림으로 안내했어요.";
      toast.success(status === "APPROVED" ? "공연 참여를 승인했어요" : "지원 상태를 바꿨어요");
    } catch (error) {
      if (!current(id, version) || selected?.id !== rid) return;
      if (error instanceof ApiError && error.status === 409) { reviewsStale = true; actionError = "지원 상태나 남은 정원이 바뀌었어요. 입력한 말은 남아 있어요. 최신 모집·지원 상태를 확인해 주세요."; }
      else actionError = error instanceof Error ? error.message : "지원 상태를 바꾸지 못했어요. 입력한 말은 그대로예요.";
      toast.error(actionError);
    } finally { if (current(id, version)) busy = ""; }
  }
</script>

<svelte:head><title>모집 관리 — 아트브릿지</title></svelte:head>

<div class="mx-auto w-full max-w-6xl">
  <PageHeader title="모집 관리" description={productionTitle || "배우와 스태프를 모집하고 지원서를 검토해요."}>
    {#snippet actions()}
      <Button href={`/app/p/${pid}/manage/members`} variant="outline" size="touch"><Users class="size-4" />공연 멤버</Button>
      {#if !loading && !forbidden && !loadError}<Button size="touch" disabled={Boolean(busy) || roundsLoading} onclick={startNew}><Plus class="size-4" />새 모집 작성</Button>{/if}
    {/snippet}
  </PageHeader>
  {#if loading}
    <Skeleton class="mt-4 h-80 w-full rounded-xl" />
  {:else if forbidden}
    <div class="mt-4 rounded-xl border bg-card p-6"><h2 class="font-semibold">모집을 관리할 권한이 없어요</h2><p class="text-muted-foreground mt-2 text-sm leading-6">모집은 이 공연의 기획 담당자나 관리자가 작성하고 검토해요.</p><Button href={`/app/p/${pid}`} size="touch" variant="outline" class="mt-4">공연 홈으로</Button></div>
  {:else if loadError}
    <ErrorPanel class="mt-4" title="모집 관리를 불러오지 못했어요" message={loadError} onRetry={() => initialize(pid)} />
  {:else}
    <div class="mt-4 rounded-xl border border-amber-200 bg-amber-50/60 p-4 text-sm leading-6 dark:border-amber-900 dark:bg-amber-950/25">
      <p class="font-medium">지원 승인까지 마치면 공연팀에 연결돼요.</p>
      <p class="text-muted-foreground mt-1">모집을 게시해도 내부 자료가 열리지는 않아요. 승인한 뒤 배우·스태프로 참여하며, 배역·담당 직무·출연진 공개는 각각 따로 정해요.</p>
    </div>
    <div class="mt-6 grid items-start gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside class="min-w-0 rounded-xl border bg-card p-4" aria-labelledby="rounds-heading">
        <div class="mb-3 flex items-center justify-between gap-2"><h2 id="rounds-heading" class="font-semibold">모집 회차 <span class="text-muted-foreground ml-1 text-sm font-normal">{roundsTotal}개</span></h2><Button size="icon-touch" variant="ghost" aria-label="모집 목록 새로 확인" disabled={Boolean(busy) || roundsLoading} onclick={() => fetchRounds(roundsOffset)}><RefreshCw class="size-4" /></Button></div>
        {#if roundsError}<div role="alert" class="mb-3 text-sm leading-6 text-destructive">{roundsError}<Button class="mt-2" size="touch" variant="outline" disabled={roundsLoading} onclick={() => fetchRounds(roundsOffset)}>다시 불러오기</Button></div>{/if}
        {#if roundsLoading}<p role="status" class="text-muted-foreground mb-3 text-sm">모집 목록을 확인하고 있어요…</p>{/if}
        {#if rounds.length === 0 && !roundsLoading && !roundsError}<p class="text-muted-foreground py-6 text-sm leading-6">등록한 모집이 없어요.<br />새 모집에서 필요한 자리를 적어 주세요.</p>{/if}
        <div class="grid gap-2">
          {#each rounds as round (round.id)}
            <button type="button" aria-pressed={!creating && selected?.id === round.id} disabled={Boolean(busy) || roundsLoading} onclick={() => chooseRound(round)} class="focus-visible:ring-ring min-h-20 min-w-0 rounded-xl border p-3 text-left transition-colors outline-none focus-visible:ring-2 disabled:opacity-50 {selected?.id === round.id && !creating ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}">
              <span class="mb-2 inline-flex rounded-full border px-2 py-0.5 text-xs {recruitmentTone(round.effectiveStatus)}">{RECRUITMENT_ROUND_LABELS[round.effectiveStatus]}</span>
              <span class="block break-words text-sm font-medium leading-6">{round.title}</span>
              <span class="text-muted-foreground mt-1 block text-xs">{round.positions.length}개 자리 · {round.positions.reduce((count, position) => count + position.approvedCount, 0)}명 확정</span>
            </button>
          {/each}
        </div>
        {#if roundsTotal > ROUND_LIMIT}<nav class="mt-4 flex items-center justify-between gap-2" aria-label="모집 회차 페이지"><Button size="touch" variant="outline" disabled={roundsOffset === 0 || roundsLoading || Boolean(busy)} onclick={() => changeRoundPage(Math.max(0, roundsOffset - ROUND_LIMIT))}>이전</Button><span class="text-muted-foreground text-xs">{Math.floor(roundsOffset / ROUND_LIMIT) + 1} / {Math.ceil(roundsTotal / ROUND_LIMIT)}</span><Button size="touch" variant="outline" disabled={!roundsHasMore || roundsLoading || Boolean(busy)} onclick={() => changeRoundPage(roundsOffset + ROUND_LIMIT)}>다음</Button></nav>{/if}
      </aside>
      <section class="min-w-0 space-y-5" aria-label="선택한 모집 관리">
        {#if actionError}<div role="alert" class="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm leading-6 text-destructive">{actionError}</div>{/if}
        {#if actionMessage}<p role="status" class="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 text-sm leading-6 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">{actionMessage}</p>{/if}
        {#if creating || selected?.status === "DRAFT"}
          <section class="rounded-xl border bg-card p-4 sm:p-5" aria-labelledby="draft-heading">
            <div class="mb-5 flex flex-wrap items-center justify-between gap-3"><div><h2 id="draft-heading" tabindex="-1" class="scroll-mt-20 text-lg font-semibold outline-none">{creating ? "새 모집 작성" : "모집 초안"}</h2><p class="text-muted-foreground mt-1 text-sm leading-6">공연에 필요한 자리와 참여 조건을 정리해요. 게시 전까지는 회원에게 보이지 않아요.</p></div><Badge variant="outline">모집 준비</Badge></div>
            <ManagerRoundForm document={formDocument} busy={Boolean(busy)} error={formError} onsubmit={saveDocument} ondirty={(value) => { formDirty = value; }} />
            {#if draftStale}<div class="mt-4 rounded-xl border border-amber-300 p-4 text-sm leading-6 dark:border-amber-800"><p>최신 초안을 불러오기 전까지 저장·게시를 멈춰 주세요. 현재 입력은 남아 있으니 필요한 내용을 먼저 확인해 주세요.</p><Button class="mt-3" size="touch" variant="outline" disabled={Boolean(busy)} onclick={refreshSelected}>최신 초안 불러오기</Button></div>{/if}
            {#if selected && !creating}<div class="mt-6 flex flex-wrap items-center justify-between gap-3 border-t pt-4"><p class="text-muted-foreground max-w-sm text-xs leading-5">게시한 뒤에는 모집 조건을 고칠 수 없어요. 초안을 확인한 뒤 게시해 주세요.</p><div class="flex flex-wrap gap-2"><Button size="touch" variant="outline" disabled={Boolean(busy) || draftStale} onclick={() => changeRoundStatus("cancel")}>모집 취소</Button><Button size="touch" disabled={Boolean(busy) || formDirty || draftStale} onclick={() => changeRoundStatus("publish")}>{busy === "publish" ? "게시 중…" : "모집 게시"}</Button></div></div>{/if}
          </section>
        {:else if selected}
          <section class="rounded-xl border bg-card p-4 sm:p-5" aria-labelledby="selected-round-heading">
            <div class="flex flex-wrap items-start justify-between gap-3"><div class="min-w-0"><span class="mb-3 inline-flex rounded-full border px-2 py-1 text-xs {recruitmentTone(selected.effectiveStatus)}">{RECRUITMENT_ROUND_LABELS[selected.effectiveStatus]}</span><h2 id="selected-round-heading" tabindex="-1" class="scroll-mt-20 break-words text-xl font-semibold leading-8 outline-none">{selected.title}</h2>{#if selected.summary}<p class="text-muted-foreground mt-2 break-words text-sm leading-6">{selected.summary}</p>{/if}</div><Button href={`/app/opportunities/${selected.id}`} size="touch" variant="outline">회원 화면<ArrowUpRight class="size-4" /></Button></div>
            <dl class="mt-5 grid gap-4 rounded-xl bg-muted/40 p-4 text-sm sm:grid-cols-2"><div><dt class="text-muted-foreground flex items-center gap-1.5"><MapPin class="size-4" />활동 지역</dt><dd class="mt-1 break-words">{selected.region || "미정"}</dd></div><div><dt class="text-muted-foreground flex items-center gap-1.5"><CalendarDays class="size-4" />참여 기간</dt><dd class="mt-1">{recruitmentPeriod(selected.activityStartDate, selected.activityEndDate)}</dd></div><div class="sm:col-span-2"><dt class="text-muted-foreground">접수 마감</dt><dd class="mt-1">{selected.deadlineAt ? `${recruitmentDateTime(selected.deadlineAt)} (한국 시간)` : "별도 마감 전까지 접수"}</dd></div></dl>
            <div class="mt-4 grid gap-2" aria-label="모집 자리별 정원">{#each selected.positions as position (position.id)}<div class="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-3 text-sm"><div class="min-w-0"><span class="text-muted-foreground mr-2 text-xs">{RECRUITMENT_ROLE_LABELS[position.role]}</span><span class="break-words font-medium">{position.label}</span></div><span class="shrink-0 font-medium {position.approvedCount >= position.capacity ? 'text-primary' : ''}">{position.approvedCount} / {position.capacity}명 확정</span></div>{/each}</div>
            {#if selected.description}<div class="mt-5"><h3 class="text-sm font-semibold">모집 내용</h3><p class="mt-2 whitespace-pre-wrap break-words text-sm leading-7">{selected.description}</p></div>{/if}
            {#if selected.conditions}<div class="mt-4"><h3 class="text-sm font-semibold">참여 조건</h3><p class="mt-2 whitespace-pre-wrap break-words text-sm leading-7">{selected.conditions}</p></div>{/if}
            <p class="text-muted-foreground mt-5 text-xs leading-5">게시한 모집의 조건은 고정돼요. 내용·자리·정원·마감일을 바꾸려면 새 회차를 작성해 주세요.</p>
            {#if selected.status !== "CANCELLED"}<div class="mt-4 flex flex-wrap justify-end gap-2 border-t pt-4">{#if selected.status === "OPEN"}<Button variant="outline" size="touch" disabled={Boolean(busy) || draftStale} onclick={() => changeRoundStatus("close")}>접수 마감</Button>{/if}<Button variant="destructive" size="touch" disabled={Boolean(busy) || draftStale} onclick={() => changeRoundStatus("cancel")}>모집 취소</Button></div>{:else}<p class="text-muted-foreground mt-4 rounded-lg bg-muted/50 p-3 text-sm leading-6">취소한 모집은 다시 열 수 없어요. 이미 참여가 확정된 멤버는 공연팀에 남아 있어요.</p>{/if}
          </section>
        {:else}
          <EmptyState title="첫 모집을 작성해 보세요" description="배우와 스태프 자리를 등록하고, 지원서를 받아 공연팀을 구성할 수 있어요.">{#snippet action()}<Button size="touch" onclick={startNew}><Plus class="size-4" />새 모집 작성</Button>{/snippet}</EmptyState>
        {/if}
        {#if (draftStale || reviewsStale) && selected?.status !== "DRAFT"}<div class="rounded-xl border border-amber-300 p-4 text-sm leading-6 dark:border-amber-800"><p>다른 창에서 바뀐 모집·지원 상태를 먼저 확인해 주세요. 보내지 않은 말은 유지돼요.</p><Button size="touch" variant="outline" class="mt-3" disabled={Boolean(busy)} onclick={refreshSelected}>최신 모집·지원 상태 확인</Button></div>{/if}
        {#if selected && !creating && selected.status !== "DRAFT"}
          <section class="rounded-xl border bg-card p-4 sm:p-5" aria-labelledby="applications-heading">
            <div class="flex flex-wrap items-center justify-between gap-3"><h2 id="applications-heading" class="text-lg font-semibold">접수한 지원 <span class="text-muted-foreground ml-1 text-sm font-normal">{applicationsTotal}건</span></h2><Button size="touch" variant="outline" disabled={Boolean(busy) || applicationsLoading} onclick={refreshSelected}><RefreshCw class="size-4" />최신 상태 확인</Button></div>
            <p class="text-muted-foreground mt-2 text-sm leading-6">지원 내용과 참여 가능 시간을 확인하고 결과를 정해 주세요. 지원자에게 전할 말은 상태 변경과 함께 전달돼요.</p>
            {#if applicationsLoading}<p role="status" class="text-muted-foreground mt-4 text-sm">지원 목록을 불러오고 있어요…</p>{/if}
            {#if applicationsError}<ErrorPanel class="mt-4" title="지원 목록을 불러오지 못했어요" message={applicationsError} onRetry={() => fetchApplications(applicationsOffset)} />{:else if applications.length === 0 && !applicationsLoading}<EmptyState class="mt-4" title="아직 접수한 지원이 없어요" description={selected.status === "OPEN" && selected.effectiveStatus === "OPEN" ? "회원들이 모집을 보고 지원하면 이곳에서 확인할 수 있어요." : "이 모집에 접수된 지원서가 없어요."} />{/if}
            <div class="mt-4 grid gap-4">
              {#each applications as application (application.id)}
                <ManagerApplicationCard
                  {application} {pid} roundStatus={selected.status}
                  full={(selected.positions.find((position) => position.id === application.positionId)?.approvedCount ?? application.position.approvedCount) >= application.position.capacity}
                  {busy} {reviewsStale} {applicationsLoading} note={reviewNotes[application.id] ?? ""}
                  onNoteChange={(value) => { reviewNotes = { ...reviewNotes, [application.id]: value }; }}
                  onReview={(status) => { void review(application, status); }}
                />
              {/each}
            </div>
            {#if applicationsTotal > APPLICATION_LIMIT}<nav aria-label="지원 목록 페이지" class="mt-5 flex items-center justify-between gap-3"><Button size="touch" variant="outline" disabled={applicationsOffset === 0 || applicationsLoading || Boolean(busy)} onclick={() => changeApplicationPage(Math.max(0, applicationsOffset - APPLICATION_LIMIT))}>이전</Button><span class="text-muted-foreground text-xs">{Math.floor(applicationsOffset / APPLICATION_LIMIT) + 1} / {Math.ceil(applicationsTotal / APPLICATION_LIMIT)}</span><Button size="touch" variant="outline" disabled={!applicationsHasMore || applicationsLoading || Boolean(busy)} onclick={() => changeApplicationPage(applicationsOffset + APPLICATION_LIMIT)}>다음</Button></nav>{/if}
          </section>
        {/if}
      </section>
    </div>
  {/if}
</div>
<ConfirmDialog bind:this={confirmation} />
