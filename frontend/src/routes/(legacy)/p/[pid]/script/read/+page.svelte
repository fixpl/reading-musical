<script lang="ts">
  import { onMount, tick } from "svelte";
  import { page } from "$app/state";
  import { apiRequest } from "$lib/api/client";
  import AppIcon from "$lib/components/AppIcon.svelte";

  type SceneBlockType = "DIALOGUE" | "LYRIC" | "STAGE_DIRECTION" | "NOTE";
  type Annotation = {
    id: string;
    authorId: string;
    type: string;
    content: string;
    isShared: boolean;
    createdAt: string;
  };
  type MusicCue = { id: string; cueNumber: string; cueType: string; anchorStatus: string; order: number };
  type CharacterRef = { id: string; name: string };
  type Block = {
    id: string;
    order: number;
    type: SceneBlockType;
    characterId?: string | null;
    character?: CharacterRef | null;
    text: string;
    cueLabel?: string | null;
    annotations: Annotation[];
    musicCues: MusicCue[];
  };
  type Scene = { id: string; order: number; title: string; blocks: Block[] };
  type SceneWithAct = Scene & { actTitle: string };
  type Act = { id: string; order: number; title: string; scenes: Scene[] };
  type ScriptSummary = { id: string; title: string };
  type ScriptDetail = { id: string; title: string; acts: Act[] };
  type Dashboard = { production: { title: string }; myRoles: string[]; myCastRoles?: CharacterRef[] };
  type CurrentUser = { id: string; platformRole: string };
  type ScriptViewMode = "MINE" | "ALL";
  type NotificationItem = {
    id: string;
    type: string;
    title: string;
    body: string;
    href: string;
    createdAt: string;
    unread: boolean;
  };
  type NotificationResponse = {
    filteredUnreadCount: number;
    markedCount?: number;
    items: NotificationItem[];
  };

  const productionId = $derived(page.params.pid);
  const deepLinkedBlockId = $derived(page.url.searchParams.get("block") ?? "");
  const blockTypeLabel: Record<SceneBlockType, string> = {
    DIALOGUE: "대사",
    LYRIC: "가사",
    STAGE_DIRECTION: "지문",
    NOTE: "메모"
  };

  let productionTitle = $state("");
  let scripts = $state<ScriptSummary[]>([]);
  let selectedScriptId = $state("");
  let script = $state<ScriptDetail | null>(null);
  let selectedSceneId = $state("");
  let loading = $state(true);
  let errorMessage = $state("");
  let noticeMessage = $state("");
  let currentUserId = $state("");
  let myCastRoles = $state<CharacterRef[]>([]);
  let scriptViewMode = $state<ScriptViewMode>("MINE");
  let canManageSharedAnnotations = $state(false);
  let fontSize = $state(19);
  let darkMode = $state(false);
  let annotationBlockId = $state("");
  let annotationText = $state("");
  let annotationType = $state("NOTE");
  let annotationShared = $state(false);
  let editingAnnotationId = $state("");
  let editingAnnotationBlockId = $state("");
  let editAnnotationText = $state("");
  let editAnnotationType = $state("NOTE");
  let editAnnotationShared = $state(false);
  let pendingDeleteAnnotationId = $state("");
  let pendingDeleteAnnotationBlockId = $state("");
  let saving = $state(false);
  let changeNotifications = $state<NotificationItem[]>([]);
  let changeUnreadCount = $state(0);
  let loadingChanges = $state(false);
  let changeCheckSaving = $state(false);
  let changeErrorMessage = $state("");

  const allScenes = $derived(scenesWithAct(script));
  const myCharacterIds = $derived.by(() => new Set(myCastRoles.map((role) => role.id)));
  const myCharacterNames = $derived.by(() => new Set(myCastRoles.map((role) => normalizeLabel(role.name))));
  const myScenes = $derived(allScenes.filter((scene) => sceneHasMyBlocks(scene)));
  const visibleScenes = $derived.by(() => {
    if (scriptViewMode === "ALL" || myCastRoles.length === 0) return allScenes;
    return myScenes.length ? myScenes : allScenes;
  });
  const selectedScene = $derived(findSceneInList(visibleScenes, selectedSceneId) ?? visibleScenes[0] ?? null);
  const actorReaderSummary = $derived.by(() => {
    const ownBlockCount = allScenes.reduce(
      (total, scene) => total + scene.blocks.filter((block) => isMyBlock(block)).length,
      0
    );
    const ownLyricCount = allScenes.reduce(
      (total, scene) => total + scene.blocks.filter((block) => isMyBlock(block) && block.type === "LYRIC").length,
      0
    );
    return {
      sceneCount: myScenes.length,
      ownBlockCount,
      ownLyricCount
    };
  });
  const changeNotificationHref = $derived(`/notifications?${buildChangeNotificationParams().toString()}`);
  const selectedSceneStats = $derived.by(() => {
    const blocks = selectedScene?.blocks ?? [];
    const musicCueCount = blocks.reduce((total, block) => total + block.musicCues.length, 0);
    const annotationCount = blocks.reduce((total, block) => total + block.annotations.length, 0);
    const lyricCount = blocks.filter((block) => block.type === "LYRIC").length;
    return {
      blockCount: blocks.length,
      musicCueCount,
      annotationCount,
      lyricCount
    };
  });

  onMount(() => {
    void loadInitial();
  });

  function findSceneById(currentScript: ScriptDetail | null, sceneId: string) {
    for (const act of currentScript?.acts ?? []) {
      const scene = act.scenes.find((item) => item.id === sceneId);
      if (scene) return scene;
    }
    return null;
  }

  function scenesWithAct(currentScript: ScriptDetail | null): SceneWithAct[] {
    return currentScript?.acts.flatMap((act) => act.scenes.map((scene) => ({ ...scene, actTitle: act.title }))) ?? [];
  }

  function visibleScenesForMode(currentScript: ScriptDetail | null, mode: ScriptViewMode) {
    const scenes = scenesWithAct(currentScript);
    if (mode === "ALL" || myCastRoles.length === 0) return scenes;
    const mine = scenes.filter((scene) => sceneHasMyBlocks(scene));
    return mine.length ? mine : scenes;
  }

  function findSceneInList(scenes: SceneWithAct[], sceneId: string) {
    return scenes.find((scene) => scene.id === sceneId) ?? null;
  }

  function findSceneByBlock(currentScript: ScriptDetail | null, blockId: string) {
    for (const act of currentScript?.acts ?? []) {
      const scene = act.scenes.find((item) => item.blocks.some((block) => block.id === blockId));
      if (scene) return scene;
    }
    return null;
  }

  async function loadInitial() {
    loading = true;
    errorMessage = "";
    try {
      const [dashboard, me] = await Promise.all([
        apiRequest<Dashboard>(`/productions/${productionId}/dashboard`),
        apiRequest<CurrentUser>("/auth/me")
      ]);
      productionTitle = dashboard.production.title;
      currentUserId = me.id;
      myCastRoles = dashboard.myCastRoles ?? [];
      canManageSharedAnnotations =
        me.platformRole === "SUPER_ADMIN" || dashboard.myRoles.some((role) => role === "PRODUCER" || role === "DIRECTOR");
      await loadChangeDigest();
      scripts = await apiRequest<ScriptSummary[]>(`/productions/${productionId}/scripts`);
      if (scripts.length) {
        const requestedScriptId = page.url.searchParams.get("script");
        const initialScriptId = requestedScriptId && scripts.some((item) => item.id === requestedScriptId) ? requestedScriptId : scripts[0].id;
        await selectScript(initialScriptId, true);
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "대본을 불러오지 못했어요";
    } finally {
      loading = false;
    }
  }

  async function selectScript(scriptId: string, applyDeepLink = false) {
    selectedScriptId = scriptId;
    script = await apiRequest<ScriptDetail>(`/productions/${productionId}/scripts/${scriptId}`);
    if (applyDeepLink) {
      const requestedBlockId = page.url.searchParams.get("block");
      const requestedSceneId = page.url.searchParams.get("scene");
      const sceneFromBlock = requestedBlockId ? findSceneByBlock(script, requestedBlockId) : null;
      const sceneFromQuery = requestedSceneId ? findSceneById(script, requestedSceneId) : null;
      const targetScene = sceneFromBlock ?? sceneFromQuery;
      if (targetScene) {
        selectedSceneId = targetScene.id;
        if (scriptViewMode === "MINE" && !sceneHasMyBlocks(targetScene)) {
          scriptViewMode = "ALL";
        }
        if (!noticeMessage) noticeMessage = "대시보드에서 선택한 대본 위치를 열었어요.";
        if (requestedBlockId) void scrollToBlock(requestedBlockId);
        return;
      }
    }
    const nextScenes = visibleScenesForMode(script, scriptViewMode);
    selectedSceneId = nextScenes.some((scene) => scene.id === selectedSceneId) ? selectedSceneId : nextScenes[0]?.id || "";
  }

  function normalizeLabel(value: string | null | undefined) {
    return (value ?? "").trim().toLocaleLowerCase("ko-KR");
  }

  function isMyBlock(block: Block) {
    if (block.characterId && myCharacterIds.has(block.characterId)) return true;
    const label = normalizeLabel(block.character?.name ?? block.cueLabel);
    return Boolean(label && myCharacterNames.has(label));
  }

  function sceneHasMyBlocks(scene: Scene) {
    return scene.blocks.some((block) => isMyBlock(block));
  }

  function setViewMode(mode: ScriptViewMode) {
    scriptViewMode = mode;
    const nextScenes = visibleScenesForMode(script, mode);
    if (nextScenes.length && !nextScenes.some((scene) => scene.id === selectedSceneId)) {
      selectedSceneId = nextScenes[0].id;
    }
  }

  function selectScene(sceneId: string) {
    selectedSceneId = sceneId;
  }

  function ownBlockLabel(block: Block) {
    return block.type === "LYRIC" ? "내 가사" : "내 대사";
  }

  async function loadChangeDigest() {
    loadingChanges = true;
    changeErrorMessage = "";
    try {
      const params = buildChangeNotificationParams("5");
      const result = await apiRequest<NotificationResponse>(`/notifications?${params.toString()}`);
      changeNotifications = result.items;
      changeUnreadCount = result.filteredUnreadCount;
    } catch (error) {
      changeErrorMessage = error instanceof Error ? error.message : "변경 알림을 불러오지 못했어요";
    } finally {
      loadingChanges = false;
    }
  }

  async function confirmAllChanges() {
    changeCheckSaving = true;
    changeErrorMessage = "";
    noticeMessage = "";
    try {
      const params = buildChangeNotificationParams();
      const result = await apiRequest<NotificationResponse>(`/notifications/read-all?${params.toString()}`, { method: "PATCH" });
      changeNotifications = result.items;
      changeUnreadCount = result.filteredUnreadCount;
      noticeMessage = result.markedCount ? `미확인 변경 ${result.markedCount}건을 확인했어요.` : "확인할 변경이 없어요.";
      window.dispatchEvent(new CustomEvent("reading-musical:notifications-changed"));
    } catch (error) {
      changeErrorMessage = error instanceof Error ? error.message : "변경 확인을 완료하지 못했어요";
    } finally {
      changeCheckSaving = false;
    }
  }

  function buildChangeNotificationParams(take?: string) {
    const params = new URLSearchParams();
    params.set("productionId", productionId ?? "");
    params.set("status", "UNREAD");
    params.set("category", "CHANGE");
    if (take) params.set("take", take);
    return params;
  }

  async function scrollToBlock(blockId: string) {
    await tick();
    document.getElementById(`block-${blockId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function openAnnotationForm(blockId: string) {
    annotationBlockId = blockId;
    annotationText = "";
    annotationType = "NOTE";
    annotationShared = false;
    editingAnnotationId = "";
    editingAnnotationBlockId = "";
    cancelDeleteAnnotation();
  }

  function closeAnnotationForm() {
    annotationBlockId = "";
    annotationText = "";
    annotationType = "NOTE";
    annotationShared = false;
  }

  function canEditAnnotation(annotation: Annotation) {
    return annotation.authorId === currentUserId || (annotation.isShared && canManageSharedAnnotations);
  }

  function changeTypeLabel(type: string) {
    if (type.startsWith("schedule.")) return "일정";
    if (type.startsWith("script.")) return "대본";
    if (type.startsWith("music.")) return "음악";
    if (type.startsWith("checklist.")) return "체크";
    if (type.startsWith("READING_SESSION")) return "리딩";
    if (type.startsWith("production.")) return "공연";
    return "변경";
  }

  function formatChangeDate(value: string) {
    return new Intl.DateTimeFormat("ko-KR", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(value));
  }

  function startEditAnnotation(blockId: string, annotation: Annotation) {
    annotationBlockId = "";
    editingAnnotationBlockId = blockId;
    editingAnnotationId = annotation.id;
    editAnnotationText = annotation.content;
    editAnnotationType = annotation.type;
    editAnnotationShared = annotation.isShared;
    cancelDeleteAnnotation();
  }

  function closeEditAnnotation() {
    editingAnnotationBlockId = "";
    editingAnnotationId = "";
    editAnnotationText = "";
    editAnnotationType = "NOTE";
    editAnnotationShared = false;
  }

  function startDeleteAnnotation(blockId: string, annotationId: string) {
    annotationBlockId = "";
    if (editingAnnotationId === annotationId) closeEditAnnotation();
    pendingDeleteAnnotationBlockId = blockId;
    pendingDeleteAnnotationId = annotationId;
  }

  function cancelDeleteAnnotation() {
    pendingDeleteAnnotationBlockId = "";
    pendingDeleteAnnotationId = "";
  }

  async function createAnnotation(blockId: string) {
    if (!annotationText.trim()) return;
    saving = true;
    errorMessage = "";
    noticeMessage = "";
    try {
      await apiRequest(`/productions/${productionId}/blocks/${blockId}/annotations`, {
        method: "POST",
        body: JSON.stringify({
          type: annotationType,
          content: annotationText,
          isShared: canManageSharedAnnotations ? annotationShared : false
        })
      });
      closeAnnotationForm();
      noticeMessage = canManageSharedAnnotations && annotationShared ? "공유 주석을 저장했어요." : "개인 주석을 저장했어요.";
      await selectScript(selectedScriptId);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "주석을 저장하지 못했어요";
    } finally {
      saving = false;
    }
  }

  async function updateAnnotation(blockId: string, annotationId: string) {
    if (!editAnnotationText.trim()) return;
    saving = true;
    errorMessage = "";
    noticeMessage = "";
    try {
      await apiRequest(`/productions/${productionId}/blocks/${blockId}/annotations/${annotationId}`, {
        method: "PATCH",
        body: JSON.stringify({
          type: editAnnotationType,
          content: editAnnotationText,
          isShared: canManageSharedAnnotations ? editAnnotationShared : false
        })
      });
      closeEditAnnotation();
      noticeMessage = "주석을 수정했어요.";
      await selectScript(selectedScriptId);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "주석을 수정하지 못했어요";
    } finally {
      saving = false;
    }
  }

  async function deleteAnnotation(blockId: string, annotationId: string) {
    saving = true;
    errorMessage = "";
    noticeMessage = "";
    try {
      await apiRequest(`/productions/${productionId}/blocks/${blockId}/annotations/${annotationId}`, {
        method: "DELETE"
      });
      closeEditAnnotation();
      cancelDeleteAnnotation();
      noticeMessage = "주석을 삭제했어요.";
      await selectScript(selectedScriptId);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "주석을 삭제하지 못했어요";
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head>
  <title>{productionTitle ? `${productionTitle} · 대본 보기` : "대본 보기"} · 아트브릿지</title>
</svelte:head>

<main class="page reader-page" class:dark-reader={darkMode}>
  <div class="container">
    <div class="toolbar">
      <div>
        <p class="badge">SCR-10 대본 뷰어</p>
        <h1>{productionTitle || "대본 보기"}</h1>
        <p class="muted">내 장면, 대사, 가사, 큐 마커를 확인하고 개인 주석을 남깁니다.</p>
      </div>
      <div class="button-row">
        <a class="button" href={`/p/${productionId}`}>대시보드</a>
      </div>
    </div>

    {#if loading}
      <article class="card">낭독 화면을 불러오고 있어요.</article>
    {:else if errorMessage && !script}
      <article class="card">
        <h2>대본을 볼 수 없어요</h2>
        <p class="error">{errorMessage}</p>
      </article>
    {:else if scripts.length === 0}
      <article class="card">
        <h2>등록된 대본이 없어요</h2>
        <p class="muted">연출자 또는 기획자가 대본을 등록하면 이 화면에서 확인할 수 있어요.</p>
      </article>
    {:else}
      {#if noticeMessage}
        <p class="success">{noticeMessage}</p>
      {/if}
      {#if errorMessage}
        <p class="error">{errorMessage}</p>
      {/if}

      <section class="work-focus-strip" aria-label="대본 보기 역할별 작업">
        <article class="work-focus-card primary">
          <span class="work-focus-icon"><AppIcon name="book-open" /></span>
          <div>
            <strong>배우</strong>
            <p>내 장면 모드에서 대사·가사·큐 마커를 확인하고, 필요한 발음·연기 메모를 개인 주석으로 남깁니다.</p>
          </div>
        </article>
        <article class="work-focus-card cue">
          <span class="work-focus-icon"><AppIcon name="music" /></span>
          <div>
            <strong>음악·무대</strong>
            <p>음악 큐와 공유 주석이 어느 대본 블록에 걸려 있는지 확인해 리딩 진행 중 놓치는 신호를 줄입니다.</p>
          </div>
        </article>
        <article class="work-focus-card info">
          <span class="work-focus-icon"><AppIcon name="bell" /></span>
          <div>
            <strong>변경 확인</strong>
            <p>대본·큐·일정 변경 알림을 먼저 확인한 뒤 오늘 연습 기준으로 읽습니다.</p>
          </div>
        </article>
      </section>

      <section class="reader-controls" aria-label="대본 보기 설정">
        <div class="field">
          <label for="scriptSelect">대본</label>
          <select id="scriptSelect" bind:value={selectedScriptId} onchange={() => void selectScript(selectedScriptId)}>
            {#each scripts as item (item.id)}
              <option value={item.id}>{item.title}</option>
            {/each}
          </select>
        </div>
        <div class="field">
          <span class="field-label">보기 범위</span>
          <div class="segmented-control reader-mode-toggle" aria-label="대본 보기 범위">
            <button class:active={scriptViewMode === "MINE"} type="button" onclick={() => setViewMode("MINE")}>내 장면</button>
            <button class:active={scriptViewMode === "ALL"} type="button" onclick={() => setViewMode("ALL")}>전체</button>
          </div>
        </div>
        <div class="field">
          <label for="sceneSelect">장면</label>
          <select id="sceneSelect" value={selectedScene?.id ?? ""} onchange={(event) => selectScene((event.currentTarget as HTMLSelectElement).value)}>
            {#each visibleScenes as scene (scene.id)}
              <option value={scene.id}>{scene.actTitle} · {scene.title}</option>
            {/each}
          </select>
        </div>
        <div class="field">
          <label for="fontSize">글자 크기</label>
          <input id="fontSize" type="range" min="16" max="28" bind:value={fontSize} />
        </div>
        <label class="toggle">
          <input type="checkbox" bind:checked={darkMode} />
          다크모드
        </label>
      </section>

      <section class="change-confirm-panel" aria-labelledby="change-confirm-heading">
        <div>
          <p class="badge">변경 확인</p>
          <h2 id="change-confirm-heading">미확인 변경 {changeUnreadCount}건</h2>
          <p class="muted">새 대본 버전, 음악 큐, 일정, 체크리스트 변경을 읽고 최신 기준으로 연습합니다.</p>
        </div>
        <div class="change-digest-area">
          {#if loadingChanges}
            <p class="muted">변경 알림을 확인하고 있어요.</p>
          {:else if changeErrorMessage}
            <p class="error">{changeErrorMessage}</p>
          {:else if changeUnreadCount === 0}
            <p class="status-pill active">미확인 변경 0건</p>
            <p class="muted">현재 대본과 큐 기준을 모두 확인한 상태입니다.</p>
          {:else}
            <div class="change-digest-list">
              {#each changeNotifications as notification (notification.id)}
                <article class="change-digest-item">
                  <span class="status-pill warning">{changeTypeLabel(notification.type)}</span>
                  <div>
                    <strong>{notification.title}</strong>
                    <p>{notification.body}</p>
                    <small>{formatChangeDate(notification.createdAt)}</small>
                  </div>
                </article>
              {/each}
            </div>
          {/if}
          <div class="button-row">
            <button class="button" type="button" onclick={() => void loadChangeDigest()} disabled={loadingChanges || changeCheckSaving}>새로고침</button>
            <button
              class="button primary"
              type="button"
              onclick={() => void confirmAllChanges()}
              disabled={changeCheckSaving || changeUnreadCount === 0}
            >
              변경 모두 확인
            </button>
            <a class="button" href={changeNotificationHref}>
              알림 센터
            </a>
          </div>
        </div>
      </section>

      <section class="reader-summary" aria-labelledby="reader-summary-heading">
        <div>
          <p class="badge">배우 확인</p>
          <h2 id="reader-summary-heading">{scriptViewMode === "MINE" ? "내 장면 요약" : "선택 장면 요약"}</h2>
          <p class="muted">내 대사와 가사는 강조하고, 음악 큐와 공유 주석은 장면 맥락 안에서 확인합니다.</p>
        </div>
        <div class="reader-role-summary">
          {#if myCastRoles.length}
            <div class="role-badge-list" aria-label="내 배역">
              {#each myCastRoles as role (role.id)}
                <span class="status-pill active">{role.name}</span>
              {/each}
            </div>
            <p>
              내 장면 {actorReaderSummary.sceneCount}개, 내 대사/가사 {actorReaderSummary.ownBlockCount}개
              {#if actorReaderSummary.ownLyricCount > 0}
                중 가사 {actorReaderSummary.ownLyricCount}개
              {/if}
              를 기준으로 봅니다.
            </p>
            <p class="muted">내 장면 모드에서도 앞뒤 큐를 놓치지 않도록 선택 장면 전체 블록을 표시합니다.</p>
          {:else}
            <p class="muted">아직 배정된 배역이 없어 전체 대본을 보여줍니다. 캐스팅 배정 후 내 장면과 내 대사가 자동 강조됩니다.</p>
          {/if}
        </div>
        <dl class="summary-metrics">
          <div>
            <dt>블록</dt>
            <dd>{selectedSceneStats.blockCount}개</dd>
          </div>
          <div>
            <dt>음악 큐</dt>
            <dd>{selectedSceneStats.musicCueCount}개</dd>
          </div>
          <div>
            <dt>가사</dt>
            <dd>{selectedSceneStats.lyricCount}개</dd>
          </div>
          <div>
            <dt>주석</dt>
            <dd>{selectedSceneStats.annotationCount}개</dd>
          </div>
        </dl>
      </section>

      <section class="scene-jump-panel" aria-labelledby="scene-jump-heading">
        <div>
          <h2 id="scene-jump-heading">장면 바로가기</h2>
          <p class="muted">오늘 읽을 장면을 빠르게 이동합니다.</p>
        </div>
        <div class="scene-chip-list">
          {#each visibleScenes as scene (scene.id)}
            <button class:active={selectedScene?.id === scene.id} class="scene-chip" type="button" onclick={() => selectScene(scene.id)}>
              <span>{scene.actTitle}</span>
              <strong>{scene.title}</strong>
            </button>
          {:else}
            <p class="muted">이동할 장면이 없어요.</p>
          {/each}
        </div>
      </section>

      <article class="reader-surface" style={`--reader-font-size: ${fontSize}px`}>
        <header class="reader-heading">
          <h2>{selectedScene?.title ?? "장면 선택"}</h2>
          <p class="muted">음악 큐와 공유 주석은 블록 아래에 표시됩니다.</p>
        </header>

        {#if selectedScene}
            <div class="reader-blocks">
              {#each selectedScene.blocks as block (block.id)}
              <section id={`block-${block.id}`} class:targeted={deepLinkedBlockId === block.id} class:mine-block={isMyBlock(block)} class="reader-block">
                <div class="block-meta">
                  <span class="badge">{blockTypeLabel[block.type]}</span>
                  {#if isMyBlock(block) && (block.type === "DIALOGUE" || block.type === "LYRIC")}
                    <span class="badge own-badge">{ownBlockLabel(block)}</span>
                  {/if}
                  {#if block.character?.name}
                    <span class="badge">{block.character.name}</span>
                  {:else if block.cueLabel}
                    <span class="badge">{block.cueLabel}</span>
                  {/if}
                  {#each block.musicCues as cue (cue.id)}
                    <span class="badge">큐 {cue.cueNumber} · {cue.anchorStatus}</span>
                  {/each}
                </div>
                <p class:stage-direction={block.type === "STAGE_DIRECTION"} class:lyric={block.type === "LYRIC"}>{block.text}</p>

                {#if block.annotations.length}
                  <div class="annotation-list">
                    {#each block.annotations as annotation (annotation.id)}
                      <div class="annotation-item">
                        <div>
                          <p class="annotation-meta">
                            <strong>{annotation.isShared ? "공유" : "개인"} 주석</strong>
                            <span>{annotation.type}</span>
                          </p>
                          <p>{annotation.content}</p>
                        </div>
                        {#if canEditAnnotation(annotation)}
                          <div class="annotation-actions">
                            <button class="button" type="button" onclick={() => startEditAnnotation(block.id, annotation)}>수정</button>
	                            <button
	                              class="button danger"
	                              type="button"
	                              disabled={saving}
	                              onclick={() => startDeleteAnnotation(block.id, annotation.id)}
	                            >
	                              삭제
	                            </button>
	                          </div>
	                          {#if pendingDeleteAnnotationBlockId === block.id && pendingDeleteAnnotationId === annotation.id}
	                            <div class="warning-box">
	                              <strong>주석을 삭제합니다</strong>
	                              <p class="muted">삭제하면 이 주석은 대본 블록에서 사라집니다. 필요한 내용은 삭제 전에 확인해 주세요.</p>
	                              <div class="button-row">
	                                <button
	                                  class="button danger"
	                                  type="button"
	                                  disabled={saving}
	                                  onclick={() => void deleteAnnotation(block.id, annotation.id)}
	                                >
	                                  주석 삭제
	                                </button>
	                                <button class="button" type="button" disabled={saving} onclick={cancelDeleteAnnotation}>취소</button>
	                              </div>
	                            </div>
	                          {/if}
	                        {/if}
	                      </div>
                    {/each}
                  </div>
                {/if}

                {#if editingAnnotationBlockId === block.id}
                  <div class="annotation-form">
                    <div class="field">
                      <label for={`editAnnotationType-${block.id}`}>주석 유형</label>
                      <select id={`editAnnotationType-${block.id}`} bind:value={editAnnotationType}>
                        <option value="NOTE">메모</option>
                        <option value="PRONUNCIATION">발음</option>
                        <option value="ACTING">연기</option>
                        <option value="DIRECTION">디렉션</option>
                      </select>
                    </div>
                    {#if canManageSharedAnnotations}
                      <label class="toggle inline-toggle">
                        <input type="checkbox" bind:checked={editAnnotationShared} />
                        공유 주석으로 표시
                      </label>
                    {/if}
                    <div class="field">
                      <label for={`editAnnotation-${block.id}`}>주석 내용</label>
                      <textarea id={`editAnnotation-${block.id}`} rows="3" bind:value={editAnnotationText}></textarea>
                    </div>
                    <div class="button-row">
                      <button
                        class="button primary"
                        type="button"
                        disabled={saving || !editAnnotationText.trim()}
                        onclick={() => void updateAnnotation(block.id, editingAnnotationId)}
                      >
                        수정 저장
                      </button>
                      <button class="button" type="button" onclick={closeEditAnnotation}>취소</button>
                    </div>
                  </div>
                {:else if annotationBlockId === block.id}
                  <div class="annotation-form">
                    <div class="field">
                      <label for={`annotationType-${block.id}`}>주석 유형</label>
                      <select id={`annotationType-${block.id}`} bind:value={annotationType}>
                        <option value="NOTE">메모</option>
                        <option value="PRONUNCIATION">발음</option>
                        <option value="ACTING">연기</option>
                        <option value="DIRECTION">디렉션</option>
                      </select>
                    </div>
                    {#if canManageSharedAnnotations}
                      <label class="toggle inline-toggle">
                        <input type="checkbox" bind:checked={annotationShared} />
                        공유 주석으로 표시
                      </label>
                    {/if}
                    <div class="field">
                      <label for={`annotation-${block.id}`}>주석 내용</label>
                      <textarea id={`annotation-${block.id}`} rows="3" bind:value={annotationText}></textarea>
                    </div>
                    <div class="button-row">
                      <button class="button primary" type="button" disabled={saving || !annotationText.trim()} onclick={() => void createAnnotation(block.id)}>
                        저장
                      </button>
                      <button class="button" type="button" onclick={closeAnnotationForm}>취소</button>
                    </div>
                  </div>
                {:else}
                  <button class="button" type="button" onclick={() => openAnnotationForm(block.id)}>주석 추가</button>
                {/if}
              </section>
            {:else}
              <p class="muted">이 장면에는 아직 대본 블록이 없어요.</p>
            {/each}
          </div>
        {/if}
      </article>
    {/if}
  </div>
</main>
