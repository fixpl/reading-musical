<script lang="ts">
  import { afterNavigate, goto } from "$app/navigation";
  import { page } from "$app/state";
  import { ApiError, apiRequest } from "$lib/api/client";
  import AppIcon from "$lib/components/AppIcon.svelte";

  type Visibility = "DRAFT" | "PUBLISHED";
  type Phase = "PLANNING" | "READING" | "REHEARSAL" | "PERFORMANCE";
  type ProductionRole = "PRODUCER" | "DIRECTOR" | "MUSIC_DIRECTOR" | "STAGE_MANAGER" | "ACTOR" | "STAFF" | "GUEST";
  type PositionRequirement = {
    id?: string;
    role: ProductionRole;
    label: string;
    requiredCount: number;
  };
  type Production = {
    id: string;
    title: string;
    slug?: string | null;
    synopsis?: string | null;
    description?: string | null;
    venue?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    currentPhase: Phase;
    visibility: Visibility;
    archived: boolean;
    positionRequirements: PositionRequirement[];
  };
  type ReadinessCheck = {
    key: string;
    label: string;
    ready: boolean;
    detail: string;
    href: string;
    readyCount?: number;
    totalCount?: number;
    blockingCount?: number;
    warningCount?: number;
  };
  type ReadinessSummary = {
    readyCount: number;
    totalCount: number;
    blockingCount: number;
    warningCount: number;
  };
  type Readiness = {
    ready: boolean;
    summary?: ReadinessSummary;
    checks: ReadinessCheck[];
  };

  const productionId = $derived(page.params.pid);
  const roleOptions: Array<{ value: ProductionRole; label: string }> = [
    { value: "ACTOR", label: "배우" },
    { value: "STAFF", label: "스태프" },
    { value: "MUSIC_DIRECTOR", label: "음악감독" },
    { value: "STAGE_MANAGER", label: "무대감독" },
    { value: "DIRECTOR", label: "연출자" },
    { value: "PRODUCER", label: "기획자" },
    { value: "GUEST", label: "게스트" }
  ];
  const phaseOptions: Array<{ value: Phase; label: string }> = [
    { value: "PLANNING", label: "기획" },
    { value: "READING", label: "리딩" },
    { value: "REHEARSAL", label: "리허설" },
    { value: "PERFORMANCE", label: "공연" }
  ];

  let loading = $state(true);
  let saving = $state(false);
  let archiving = $state(false);
  let duplicating = $state(false);
  let errorMessage = $state("");
  let noticeMessage = $state("");
  let readiness = $state<Readiness | null>(null);

  let title = $state("");
  let slug = $state("");
  let synopsis = $state("");
  let description = $state("");
  let venue = $state("");
  let startDate = $state("");
  let endDate = $state("");
  let currentPhase = $state<Phase>("PLANNING");
  let visibility = $state<Visibility>("DRAFT");
  let positions = $state<PositionRequirement[]>([]);
  let duplicateTitle = $state("");
  let duplicateSlug = $state("");
  let confirmingArchive = $state(false);

  const canSave = $derived(title.trim().length > 0 && !saving && !loading);
  const canPublish = $derived(readiness?.ready === true);
  let loadedProductionId = "";

  afterNavigate(() => {
    const targetProductionId = productionId;
    if (!targetProductionId || loadedProductionId === targetProductionId) return;
    loadedProductionId = targetProductionId;
    void loadSettings(targetProductionId);
  });

  async function loadSettings(targetProductionId: string) {
    loading = true;
    errorMessage = "";
    try {
      const [production, readinessPayload] = await Promise.all([
        apiRequest<Production>(`/productions/${targetProductionId}`),
        apiRequest<Readiness>(`/productions/${targetProductionId}/readiness`)
      ]);
      if (targetProductionId !== productionId) return;
      fillForm(production);
      readiness = readinessPayload;
    } catch (error) {
      if (targetProductionId !== productionId) return;
      errorMessage = error instanceof Error ? error.message : "공연 설정을 불러오지 못했어요";
    } finally {
      if (targetProductionId === productionId) {
        loading = false;
      }
    }
  }

  async function saveSettings(event: SubmitEvent) {
    event.preventDefault();
    if (!canSave) return;
    saving = true;
    errorMessage = "";
    noticeMessage = "";
    const targetProductionId = productionId;
    try {
      const production = await apiRequest<Production>(`/productions/${targetProductionId}`, {
        method: "PATCH",
        body: JSON.stringify({
          title,
          slug: slug.trim() || null,
          synopsis: synopsis.trim() || null,
          description: description.trim() || null,
          venue: venue.trim() || null,
          startDate: startDate || null,
          endDate: endDate || null,
          currentPhase,
          visibility,
          positionRequirements: normalizePositions()
        })
      });
      fillForm(production);
      readiness = await apiRequest<Readiness>(`/productions/${targetProductionId}/readiness`);
      noticeMessage = "공연 설정을 저장했어요.";
    } catch (error) {
      if (error instanceof ApiError && error.details && typeof error.details === "object" && "readiness" in error.details) {
        readiness = (error.details as { readiness: Readiness }).readiness;
      }
      errorMessage = error instanceof Error ? error.message : "공연 설정을 저장하지 못했어요";
    } finally {
      saving = false;
    }
  }

  async function archiveProduction() {
    archiving = true;
    errorMessage = "";
    noticeMessage = "";
    const targetProductionId = productionId;
    try {
      await apiRequest<Production>(`/productions/${targetProductionId}/archive`, { method: "POST" });
      await goto("/productions");
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "공연을 보관하지 못했어요";
    } finally {
      archiving = false;
    }
  }

  function startArchiveConfirmation() {
    confirmingArchive = true;
    errorMessage = "";
    noticeMessage = "";
  }

  function cancelArchiveConfirmation() {
    confirmingArchive = false;
  }

  async function duplicateProduction(event: SubmitEvent) {
    event.preventDefault();
    if (!duplicateTitle.trim()) return;
    duplicating = true;
    errorMessage = "";
    noticeMessage = "";
    const targetProductionId = productionId;
    try {
      const production = await apiRequest<Production>(`/productions/${targetProductionId}/duplicate`, {
        method: "POST",
        body: JSON.stringify({
          title: duplicateTitle,
          slug: duplicateSlug.trim() || undefined
        })
      });
      await goto(`/p/${production.id}/settings`);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "공연을 복제하지 못했어요";
    } finally {
      duplicating = false;
    }
  }

  function fillForm(production: Production) {
    title = production.title;
    slug = production.slug ?? "";
    synopsis = production.synopsis ?? "";
    description = production.description ?? "";
    venue = production.venue ?? "";
    startDate = formatDateInput(production.startDate);
    endDate = formatDateInput(production.endDate);
    currentPhase = production.currentPhase;
    visibility = production.visibility;
    positions = production.positionRequirements.length
      ? production.positionRequirements.map((position) => ({ ...position }))
      : [{ role: "ACTOR", label: "배우", requiredCount: 1 }];
    duplicateTitle = `${production.title} 복제본`;
  }

  function addPosition() {
    positions = [...positions, { role: "ACTOR", label: "배우", requiredCount: 1 }];
  }

  function removePosition(index: number) {
    positions = positions.filter((_, itemIndex) => itemIndex !== index);
  }

  function normalizePositions() {
    return positions
      .map((position) => ({
        role: position.role,
        label: position.label.trim() || roleOptions.find((option) => option.value === position.role)?.label || position.role,
        requiredCount: Number(position.requiredCount) || 1
      }))
      .filter((position) => position.requiredCount > 0);
  }

  function formatDateInput(value?: string | null) {
    if (!value) return "";
    return value.slice(0, 10);
  }

  function readinessSummary(payload: Readiness) {
    return (
      payload.summary ?? {
        readyCount: payload.checks.filter((check) => check.ready).length,
        totalCount: payload.checks.length,
        blockingCount: payload.checks.filter((check) => !check.ready).length,
        warningCount: payload.checks.reduce((total, check) => total + (check.warningCount ?? 0), 0)
      }
    );
  }
</script>

<svelte:head>
  <title>{title || "공연 설정"} · 아트브릿지</title>
</svelte:head>

<main class="page">
  <div class="container">
    <div class="toolbar">
      <div>
        <p class="badge">SCR-07 공연 설정</p>
        <h1>{title || "공연 설정"}</h1>
        <p class="muted">공연 기본정보, 공개 준비 점검, 복제와 보관을 관리합니다.</p>
      </div>
      <div class="button-row">
        <a class="button" href={`/p/${productionId}`}>대시보드</a>
        <a class="button" href="/productions">내 공연</a>
      </div>
    </div>

    <section class="work-focus-strip" aria-label="공연 설정 운영 기준">
      <article class="work-focus-card primary">
        <span class="work-focus-icon"><AppIcon name="settings" /></span>
        <div>
          <strong>기본정보 유지</strong>
          <p>공연명, 장소, 기간, 공개 주소는 대시보드와 공유 링크의 기준 정보입니다.</p>
        </div>
      </article>
      <article class="work-focus-card info">
        <span class="work-focus-icon"><AppIcon name="check-square" /></span>
        <div>
          <strong>공개 준비 점검</strong>
          <p>대본, 멤버, 스태프 직무, 음악 큐, 일정, 체크리스트 상태를 공개 전에 확인합니다.</p>
        </div>
      </article>
      <article class="work-focus-card accent">
        <span class="work-focus-icon"><AppIcon name="shield" /></span>
        <div>
          <strong>복제와 보관</strong>
          <p>운영 이력과 감사 로그를 남기며 복제·보관 작업을 안전하게 처리합니다.</p>
        </div>
      </article>
    </section>

    {#if loading}
      <article class="card">공연 설정을 불러오고 있어요.</article>
    {:else if errorMessage && !title}
      <article class="card">
        <h2>설정을 불러오지 못했어요</h2>
        <p class="error">{errorMessage}</p>
        <a class="button" href={`/p/${productionId}`}>대시보드</a>
      </article>
    {:else}
      <div class="settings-layout">
        <form class="grid" onsubmit={saveSettings}>
          <section class="card">
            <h2>기본정보</h2>
            <label class="field" for="title">
              <span>공연 제목</span>
              <input id="title" bind:value={title} maxlength="120" required />
            </label>
            <label class="field" for="slug">
              <span>공개 주소 slug</span>
              <input id="slug" bind:value={slug} placeholder="선택 입력" />
            </label>
            <label class="field" for="synopsis">
              <span>시놉시스</span>
              <textarea id="synopsis" bind:value={synopsis}></textarea>
            </label>
            <label class="field" for="description">
              <span>운영 메모</span>
              <textarea id="description" bind:value={description}></textarea>
            </label>
          </section>

          <section class="card">
            <h2>기간과 장소</h2>
            <label class="field" for="venue">
              <span>장소</span>
              <input id="venue" bind:value={venue} />
            </label>
            <div class="inline-grid">
              <label class="field" for="startDate">
                <span>시작일</span>
                <input id="startDate" type="date" bind:value={startDate} />
              </label>
              <label class="field" for="endDate">
                <span>종료일</span>
                <input id="endDate" type="date" bind:value={endDate} />
              </label>
            </div>
          </section>

          <section class="card">
            <h2>공개 상태</h2>
            <div class="inline-grid">
              <label class="field" for="currentPhase">
                <span>현재 단계</span>
                <select id="currentPhase" bind:value={currentPhase}>
                  {#each phaseOptions as option (option.value)}
                    <option value={option.value}>{option.label}</option>
                  {/each}
                </select>
              </label>
              <label class="field" for="visibility">
                <span>공개 상태</span>
                <select id="visibility" bind:value={visibility}>
                  <option value="DRAFT">DRAFT</option>
                  <option value="PUBLISHED" disabled={!canPublish}>PUBLISHED</option>
                </select>
              </label>
            </div>
            {#if !canPublish}
              <p class="muted">PUBLISHED 전환은 공개 준비 점검을 모두 통과하면 활성화됩니다.</p>
            {/if}
          </section>

          <section class="card">
            <div class="section-heading">
              <div>
                <h2>필요 정원</h2>
                <p class="muted">역할별 매칭 기준입니다.</p>
              </div>
              <button class="button" type="button" onclick={addPosition}>행 추가</button>
            </div>
            <div class="position-list">
              {#each positions as position, index (position)}
                <div class="position-row">
                  <label class="field" for={`role-${index}`}>
                    <span>역할</span>
                    <select id={`role-${index}`} bind:value={position.role}>
                      {#each roleOptions as option (option.value)}
                        <option value={option.value}>{option.label}</option>
                      {/each}
                    </select>
                  </label>
                  <label class="field" for={`label-${index}`}>
                    <span>표시명</span>
                    <input id={`label-${index}`} bind:value={position.label} />
                  </label>
                  <label class="field" for={`count-${index}`}>
                    <span>인원</span>
                    <input id={`count-${index}`} type="number" min="1" bind:value={position.requiredCount} />
                  </label>
                  <button class="button" type="button" onclick={() => removePosition(index)} disabled={positions.length === 1}>삭제</button>
                </div>
              {/each}
            </div>
          </section>

          {#if errorMessage}
            <p class="error">{errorMessage}</p>
          {/if}
          {#if noticeMessage}
            <p class="success">{noticeMessage}</p>
          {/if}
          <div class="sticky-action">
            <button class="button primary" type="submit" disabled={!canSave}>{saving ? "저장 중" : "설정 저장"}</button>
          </div>
        </form>

        <aside class="grid">
          <section class="card">
            <h2>공개 준비 점검</h2>
            {#if readiness}
              {@const summary = readinessSummary(readiness)}
              <p class={readiness.ready ? "success" : "muted"}>
                {readiness.ready ? "공개 전환이 가능합니다." : "아직 공개 전환 전 확인할 항목이 있어요."}
              </p>
              <div class="readiness-summary" aria-label="공개 준비 점검 요약">
                <span class="badge" class:success={readiness.ready}>통과 {summary.readyCount}/{summary.totalCount}</span>
                {#if summary.blockingCount > 0}
                  <span class="badge danger">차단 {summary.blockingCount}</span>
                {/if}
                {#if summary.warningCount > 0}
                  <span class="badge warning">주의 {summary.warningCount}</span>
                {/if}
              </div>
              <div class="readiness-list">
                {#each readiness.checks as check (check.key)}
                  <a class="readiness-row" href={`/p/${productionId}/${check.href}`}>
                    <span class="status-dot" class:ready={check.ready}></span>
                    <span>
                      <strong>{check.label}</strong>
                      <small>{check.detail}</small>
                      {#if check.readyCount !== undefined && check.totalCount !== undefined}
                        <small class="readiness-count">
                          {check.readyCount}/{check.totalCount} 완료
                          {#if (check.blockingCount ?? 0) > 0}
                            · 차단 {check.blockingCount}
                          {/if}
                          {#if (check.warningCount ?? 0) > 0}
                            · 주의 {check.warningCount}
                          {/if}
                        </small>
                      {/if}
                    </span>
                  </a>
                {/each}
              </div>
            {:else}
              <p class="muted">점검 상태를 불러오지 못했어요.</p>
            {/if}
          </section>

          <section class="card">
            <h2>공연 복제</h2>
            <form class="grid" onsubmit={duplicateProduction}>
              <label class="field" for="duplicateTitle">
                <span>복제본 제목</span>
                <input id="duplicateTitle" bind:value={duplicateTitle} required />
              </label>
              <label class="field" for="duplicateSlug">
                <span>복제본 slug</span>
                <input id="duplicateSlug" bind:value={duplicateSlug} placeholder="선택 입력" />
              </label>
              <button class="button" type="submit" disabled={duplicating || !duplicateTitle.trim()}>
                {duplicating ? "복제 중" : "복제 만들기"}
              </button>
            </form>
          </section>

          <section class="card danger-zone">
            <h2>보관</h2>
            <p class="muted">보관하면 기본 공연 목록에서 숨겨지고 공개 상태는 DRAFT로 전환됩니다.</p>
            <button class="button" type="button" onclick={startArchiveConfirmation} disabled={archiving}>
              {archiving ? "보관 중" : "공연 보관"}
            </button>
            {#if confirmingArchive}
              <div class="warning-box">
                <strong>공연을 보관합니다</strong>
                <p class="muted">보관 후 기본 공연 목록에서 숨겨지고 공개 상태는 DRAFT로 바뀝니다. 감사 로그에는 공연 보관 기록이 남습니다.</p>
                <div class="button-row">
                  <button class="button danger" type="button" onclick={archiveProduction} disabled={archiving}>
                    {archiving ? "보관 중" : "공연 보관 실행"}
                  </button>
                  <button class="button" type="button" onclick={cancelArchiveConfirmation} disabled={archiving}>취소</button>
                </div>
              </div>
            {/if}
          </section>
        </aside>
      </div>
    {/if}
  </div>
</main>
