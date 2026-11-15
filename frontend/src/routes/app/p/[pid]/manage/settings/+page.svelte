<script lang="ts">
  import { page } from "$app/stores";
  import { afterNavigate } from "$app/navigation";
  import { onDestroy, tick, untrack } from "svelte";
  import { toast } from "svelte-sonner";
  import * as Card from "$lib/components/ui/card";
  import * as Select from "$lib/components/ui/select";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import { ErrorPanel } from "$lib/components/ui/error-panel";
  import { PageHeader } from "$lib/components/ui/page-header";
  import { apiRequest } from "$lib/api/client";
  import { getProductionAccess } from "$lib/api/production-access";
  import { PHASE_LABELS } from "$lib/domain/labels";
  import ShowcaseEditor from "$lib/components/showcase/showcase-editor.svelte";

  type Production = {
    id: string;
    title: string;
    venue: string | null;
    synopsis: string | null;
    startDate: string | null;
    endDate: string | null;
    currentPhase: string;
    visibility: string;
  };

  const pid = $derived($page.params.pid ?? "");

  let production = $state<Production | null>(null);
  let loading = $state(true);
  let saving = $state(false);
  // 공연 설정과 큐 편집은 별개 권한이다. 설정은 해당 공연의 서버 capability를 따른다.
  let canManage = $state(false);
  let canManageRecruitment = $state(false);

  let title = $state("");
  let venue = $state("");
  let synopsis = $state("");
  let startDate = $state("");
  let endDate = $state("");
  let currentPhase = $state("PLANNING");

  let loadError = $state(false);
  let loadVersion = 0;
  let disposed = false;
  let pendingShowcaseReady: { id: string; href: string } | null = null;
  onDestroy(() => { disposed = true; loadVersion += 1; });

  async function scrollToShowcase(id: string, href: string) {
    await tick();
    // 정보를 기다리는 동안 다른 화면이나 위치로 이동했다면 스크롤하지 않는다.
    if (disposed || loading || id !== pid || $page.url.href !== href || $page.url.hash !== "#showcase") return;
    document.getElementById("showcase")?.scrollIntoView({ block: "start", behavior: "instant" });
  }

  function onShowcaseReady(id: string) {
    const pending = pendingShowcaseReady;
    if (!pending || pending.id !== id) return;
    pendingShowcaseReady = null;
    void scrollToShowcase(id, pending.href);
  }

  afterNavigate(() => {
    if (!loading) void scrollToShowcase(pid, $page.url.href);
  });
  // 공연이 바뀌면 이전 공연의 값이 남지 않도록 pid마다 다시 불러온다.
  $effect(() => {
    const id = pid;
    production = null;
    canManage = false;
    canManageRecruitment = false;
    loadError = false;
    title = "";
    venue = "";
    synopsis = "";
    startDate = "";
    endDate = "";
    currentPhase = "PLANNING";
    untrack(() => { void load(id); });
  });

  async function load(id: string, showLoading = true) {
    const version = ++loadVersion;
    const pathname = $page.url.pathname;
    if (showLoading) { loading = true; pendingShowcaseReady = null; }
    loadError = false;
    try {
      const access = await getProductionAccess(id);
      if (disposed || version !== loadVersion || id !== pid) return;
      canManage = access.canEditProduction;
      canManageRecruitment = access.canManageRecruitment;
      if (!canManage) return;
      const prod = await apiRequest<Production>(`/productions/${id}`);
      if (disposed || version !== loadVersion || id !== pid) return;
      production = prod;
      title = prod.title;
      venue = prod.venue ?? "";
      synopsis = prod.synopsis ?? "";
      startDate = prod.startDate ? prod.startDate.slice(0, 10) : "";
      endDate = prod.endDate ? prod.endDate.slice(0, 10) : "";
      currentPhase = prod.currentPhase;
    } catch (error) {
      if (disposed || version !== loadVersion || id !== pid) return;
      // 기본 정보 저장 뒤 조회가 실패해도 작성 중인 홍보 초안을 지우지 않는다.
      if (showLoading) loadError = true;
      toast.error(error instanceof Error ? error.message : "공연 정보를 불러오지 못했어요");
    } finally {
      if (!disposed && version === loadVersion && id === pid) {
        loading = false;
        // 목록의 홍보 편집 링크로 들어오면 비동기로 생성된 섹션까지 이동한다.
        // 기본 정보 저장 후 재조회에는 적용하지 않아 작성 중인 화면을 유지한다.
        if (showLoading && pathname === $page.url.pathname) {
          const href = $page.url.href;
          // 홍보 폼 조회까지 끝난 뒤 한 번 더 맞춰 짧은 로딩 화면의 스크롤 한계를 피한다.
          pendingShowcaseReady = $page.url.hash === "#showcase" ? { id, href } : null;
          void scrollToShowcase(id, href);
        }
      }
    }
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (!canManage || saving) return;
    saving = true;
    try {
      await apiRequest(`/productions/${pid}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: title.trim(),
          venue: venue.trim() || null,
          synopsis: synopsis.trim() || null,
          startDate: startDate ? new Date(startDate).toISOString() : null,
          endDate: endDate ? new Date(endDate).toISOString() : null,
          currentPhase
        })
      });
      toast.success("공연 정보를 저장했어요");
      await load(pid, false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "저장하지 못했어요");
    } finally {
      saving = false;
    }
  }

  async function setVisibility(next: "PUBLISHED" | "DRAFT") {
    if (!canManage || saving) return;
    saving = true;
    try {
      await apiRequest(`/productions/${pid}`, {
        method: "PATCH",
        body: JSON.stringify({ visibility: next })
      });
      toast.success(next === "PUBLISHED" ? "운영 상태를 운영 중으로 바꿨어요." : "운영 상태를 준비 중으로 바꿨어요.");
      await load(pid, false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "변경하지 못했어요");
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head>
  <title>공연 설정 — 아트브릿지</title>
</svelte:head>

<div class="mx-auto w-full max-w-3xl">
  <PageHeader title="공연 설정" description={production?.title ?? "운영 정보와 관객용 공연 소개를 관리해요."} />

  {#if loading}
    <Skeleton class="mt-2 h-96 w-full rounded-2xl" />
  {:else if loadError}
    <ErrorPanel class="mt-2" title="공연 정보를 불러오지 못했어요" message="잠시 후 다시 시도해 주세요." onRetry={() => load(pid)} />
  {:else if !canManage}
    <ErrorPanel class="mt-2" title="이 화면을 관리할 권한이 없어요" message="공연 설정은 이 공연의 기획 담당자나 관리자가 편집해요." />
  {:else if production}
    <nav aria-label="공연 준비" class="mb-4 flex flex-wrap gap-2">
      <Button href={`/app/p/${pid}/manage/members`} variant="outline" size="touch">멤버 추가</Button>
      {#if canManageRecruitment}<Button href={`/app/p/${pid}/manage/recruitment`} variant="outline" size="touch">배우·스태프 모집</Button>{/if}
      <Button href={`/app/p/${pid}/manage/casting`} variant="outline" size="touch">배역 배정</Button>
      <Button href={`/app/p/${pid}/schedule`} variant="outline" size="touch">일정 등록</Button>
    </nav>
    <Card.Root class="mt-2">
      <Card.Header><Card.Title class="text-base">공연 기본 정보</Card.Title><Card.Description>공연팀이 사용하는 운영 정보예요. 관객용 소개는 아래에서 따로 작성해요.</Card.Description></Card.Header>
      <Card.Content>
        <form class="grid gap-4" onsubmit={save}>
          <div class="grid gap-2">
            <Label for="title">공연 이름</Label>
            <Input id="title" bind:value={title} required maxlength={120} class="min-h-11" />
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            <div class="grid gap-2">
              <Label for="venue">장소</Label>
              <Input id="venue" bind:value={venue} maxlength={120} placeholder="미정이면 비워 두세요" class="min-h-11" />
            </div>
            <div class="grid gap-2">
              <Label for="production-phase">진행 단계</Label>
              <Select.Root type="single" bind:value={currentPhase}>
                <Select.Trigger id="production-phase" class="min-h-11 w-full">{PHASE_LABELS[currentPhase] ?? currentPhase}</Select.Trigger>
                <Select.Content>
                  {#each Object.entries(PHASE_LABELS) as [value, label] (value)}
                    <Select.Item {value} {label} />
                  {/each}
                </Select.Content>
              </Select.Root>
            </div>
            <div class="grid gap-2">
              <Label for="startDate">공연 시작일</Label>
              <Input id="startDate" type="date" bind:value={startDate} aria-describedby="production-date-help" class="min-h-11" />
            </div>
            <div class="grid gap-2">
              <Label for="endDate">공연 종료일</Label>
              <Input id="endDate" type="date" bind:value={endDate} aria-describedby="production-date-help" class="min-h-11" />
            </div>
          </div>
          <p id="production-date-help" class="text-muted-foreground -mt-1 text-xs">공연 날짜가 미정이면 날짜 입력을 비워 주세요.</p>
          <div class="grid gap-2">
            <Label for="synopsis">한 줄 소개</Label>
            <Input id="synopsis" bind:value={synopsis} maxlength={200} placeholder="공연을 한 문장으로" class="min-h-11" />
          </div>
          <div class="flex justify-end">
            <Button type="submit" size="touch" disabled={saving || !title.trim()}>
              {saving ? "저장 중..." : "공연 정보 저장"}
            </Button>
          </div>
        </form>
      </Card.Content>
    </Card.Root>

    <Card.Root class="mt-4">
      <Card.Content class="flex flex-wrap items-center gap-3">
        <div class="min-w-0 flex-1">
          <p class="flex items-center gap-2 font-semibold">
            공연 운영 상태
            <Badge variant={production.visibility === "PUBLISHED" ? "default" : "outline"}>
              {production.visibility === "PUBLISHED" ? "운영 중" : "준비 중"}
            </Badge>
          </p>
          <p class="text-muted-foreground mt-0.5 text-sm">
            팀 안에서 사용하는 상태예요. 배정된 참여자는 준비 중에도 공연에 들어올 수 있고, 관객용 소개의 게시 여부와는 별개예요.
          </p>
        </div>
        {#if production.visibility === "PUBLISHED"}
          <Button variant="outline" size="touch" disabled={saving} onclick={() => setVisibility("DRAFT")}>준비 중으로 변경</Button>
        {:else}
          <Button size="touch" disabled={saving} onclick={() => setVisibility("PUBLISHED")}>운영 중으로 변경</Button>
        {/if}
      </Card.Content>
    </Card.Root>

    <ShowcaseEditor productionId={pid} onReady={onShowcaseReady} />
  {/if}
</div>
