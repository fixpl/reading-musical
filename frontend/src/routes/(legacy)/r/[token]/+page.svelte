<script lang="ts">
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import { ApiError, apiRequest, getWsBaseUrl } from "$lib/api/client";

  type RunSheetStatus = "DRAFT" | "LOCKED" | "COMPLETED";
  type RunSheetItemType = "SCENE" | "CUE" | "STAGE_NOTE" | "CHECK" | "BREAK" | "ANNOUNCEMENT";

  type SceneBlock = {
    id: string;
    order: number;
    type: "DIALOGUE" | "LYRIC" | "STAGE_DIRECTION" | "NOTE";
    character?: { id: string; name: string } | null;
    cueLabel?: string | null;
    text: string;
  };
  type Scene = {
    id: string;
    title: string;
    order: number;
    act: { id: string; title: string; order: number };
    blocks?: SceneBlock[];
  };
  type MusicCue = {
    id: string;
    cueNumber: string;
    cueType: string;
    order: number;
    trackStartMs?: number | null;
    trackEndMs?: number | null;
    fadeInMs?: number | null;
    fadeOutMs?: number | null;
    volumeDb?: number | null;
    fireMode?: string | null;
    note?: string | null;
    track: { id: string; title: string; durationMs?: number | null; assetId?: string | null };
    scene?: Scene | null;
    anchorBlock?: SceneBlock | null;
  };
  type StageNote = {
    id: string;
    note?: string | null;
    sceneId: string;
    scene?: Scene | null;
    stagePlan?: { id: string; name: string } | null;
  };
  type ChecklistItem = {
    id: string;
    label: string;
    status: string;
    description?: string | null;
  };
  type ScheduleEvent = {
    id: string;
    type: string;
    title: string;
    startAt: string;
    endAt: string;
    location?: string | null;
    meetingUrl?: string | null;
    scenes: Array<{ id: string; sceneId: string; scene: Scene }>;
    musicCues: Array<{ id: string; cueId: string; cue: MusicCue }>;
    attendances: [];
    runSheets?: Array<{ id: string; title: string; version: number; status: RunSheetStatus }>;
    checklistItems?: Array<{ id: string; label: string; status: string }>;
  };
  type RunSheetItem = {
    id: string;
    order: number;
    itemType: RunSheetItemType;
    title: string;
    sceneId?: string | null;
    cueId?: string | null;
    stageSceneNoteId?: string | null;
    checklistItemId?: string | null;
    estimatedDurationMin?: number | null;
    note?: string | null;
    completedAt?: string | null;
    scene?: Scene | null;
    cue?: MusicCue | null;
    stageSceneNote?: StageNote | null;
    checklistItem?: ChecklistItem | null;
  };
  type RunSheet = {
    id: string;
    productionId: string;
    eventId: string;
    title: string;
    version: number;
    status: RunSheetStatus;
    lockedAt?: string | null;
    completedAt?: string | null;
    event: ScheduleEvent;
    items: RunSheetItem[];
  };
  type CueFireLog = {
    id: string;
    cueId: string;
    firedById: string;
    firedAt: string;
    payload?: Record<string, unknown> | null;
    cue: MusicCue;
  };
  type ReadingSession = {
    id: string;
    productionId: string;
    eventId?: string | null;
    runSheetId?: string | null;
    startedAt?: string | null;
    endedAt?: string | null;
    currentSceneId?: string | null;
    currentBlockId?: string | null;
    progressNote?: string | null;
    event?: ScheduleEvent | null;
    runSheet?: RunSheet | null;
    cueFireLogs: CueFireLog[];
  };
  type GuestReadingAccess = {
    id: string;
    label?: string | null;
    expiresAt: string;
    revokedAt?: string | null;
    lastViewedAt?: string | null;
    active: boolean;
  };
  type GuestReadingWorkspace = {
    guestAccess: GuestReadingAccess;
    production: { id: string; title: string; currentPhase: string; visibility: string };
    event: ScheduleEvent;
    myRoles: ["GUEST"];
    isGuestToken: true;
    permissions: {
      canStart: false;
      canEnd: false;
      canSyncPage: false;
      canFireCue: false;
      canCompleteRunSheetItems: false;
      participantAutoplay: false;
    };
    activeSession: ReadingSession | null;
    endedSessions: ReadingSession[];
    runSheets: RunSheet[];
    preferredRunSheet: RunSheet | null;
    scenes: Scene[];
    cueFireLogs: CueFireLog[];
    fallbackWarning?: string | null;
    liveContract: { room: string; transport: string; events: string[]; participantAutoplay: false };
  };
  type ReadingRealtimeEvent = {
    type?: string;
    eventId?: string | null;
    participantAutoplay?: false;
  };
  type ReadingSocketAck = {
    ok?: boolean;
    message?: string;
    room?: string;
    mode?: "member" | "guest";
  };
  type ReadingSocket = {
    on: (event: string, handler: (...args: any[]) => void) => ReadingSocket;
    emit: (event: string, payload?: unknown, ack?: (response?: ReadingSocketAck) => void) => ReadingSocket;
    disconnect: () => void;
  };
  type SocketModule = {
    io: (url: string, options: Record<string, unknown>) => ReadingSocket;
  };
  type RealtimeStatus = "idle" | "connected" | "fallback" | "error";

  const token = $derived(page.params.token ?? "");

  let workspace = $state<GuestReadingWorkspace | null>(null);
  let loading = $state(true);
  let errorMessage = $state("");
  let selectedItemId = $state("");
  let followCurrent = $state(true);
  let realtimeStatus = $state<RealtimeStatus>("idle");
  let realtimeMessage = $state("실시간 연결 준비");
  let realtimeSocket: ReadingSocket | null = null;
  let realtimeSocketKey = "";
  let realtimeReloading = false;

  const activeSession = $derived(workspace?.activeSession ?? null);
  const selectedRunSheet = $derived(
    activeSession?.runSheet ??
      workspace?.preferredRunSheet ??
      workspace?.runSheets.find((sheet) => sheet.status === "LOCKED") ??
      workspace?.runSheets[0] ??
      null
  );
  const selectedItem = $derived(selectedRunSheet?.items.find((item) => item.id === selectedItemId) ?? null);
  const currentScene = $derived(resolveCurrentScene());
  const currentBlock = $derived(resolveCurrentBlock());
  const sessionLogs = $derived(activeSession?.cueFireLogs ?? workspace?.cueFireLogs ?? []);
  const itemDonePercent = $derived(
    selectedRunSheet?.items.length ? Math.round((selectedRunSheet.items.filter((item) => item.completedAt).length / selectedRunSheet.items.length) * 100) : 0
  );
  const currentRunSheetItem = $derived(resolveCurrentRunSheetItem());
  const nextRunSheetItem = $derived(resolveNextRunSheetItem());
  const remainingItemCount = $derived(selectedRunSheet?.items.filter((item) => !item.completedAt).length ?? 0);

  onMount(() => {
    void loadWorkspace();
    void connectReadingSocket();
    const timer = window.setInterval(() => {
      if (workspace?.activeSession && !workspace.activeSession.endedAt) {
        void loadWorkspace(true);
      }
    }, 15000);
    return () => {
      window.clearInterval(timer);
      disconnectReadingSocket();
    };
  });

  async function connectReadingSocket() {
    if (typeof window === "undefined" || !token) return;
    const socketKey = token;
    if (realtimeSocket && realtimeSocketKey === socketKey) return;
    disconnectReadingSocket();

    try {
      realtimeStatus = "idle";
      realtimeMessage = "게스트 리딩 실시간 연결 중";
      const { io } = (await import("socket.io-client")) as SocketModule;
      const socket = io(getWsBaseUrl(), {
        auth: { guestReadingToken: token },
        transports: ["websocket"],
        withCredentials: true
      });
      realtimeSocket = socket;
      realtimeSocketKey = socketKey;

      socket.on("reading-session.connected", (payload: { room?: string }) => {
        realtimeStatus = "connected";
        realtimeMessage = `실시간 연결됨 · ${payload?.room ?? "reading-session"}`;
      });
      socket.on("connect_error", (error: Error) => {
        realtimeStatus = "fallback";
        realtimeMessage = `실시간 연결 실패, REST 갱신 유지 · ${error.message}`;
      });
      socket.on("notification.error", (payload: { message?: string }) => {
        realtimeStatus = "error";
        realtimeMessage = payload?.message || "게스트 리딩 실시간 연결을 확인하지 못했어요.";
      });
      socket.on("disconnect", () => {
        if (realtimeStatus === "connected") {
          realtimeStatus = "fallback";
          realtimeMessage = "실시간 연결 해제, REST 갱신 유지";
        }
      });
      socket.on("reading-session.event", handleRealtimeReadingEvent);
    } catch (error) {
      realtimeStatus = "fallback";
      realtimeMessage = error instanceof Error ? `실시간 모듈 로드 실패 · ${error.message}` : "실시간 모듈 로드 실패";
    }
  }

  function disconnectReadingSocket() {
    realtimeSocket?.disconnect();
    realtimeSocket = null;
    realtimeSocketKey = "";
  }

  function handleRealtimeReadingEvent(event: ReadingRealtimeEvent) {
    if (event.eventId && workspace?.event.id && event.eventId !== workspace.event.id) return;
    if (realtimeReloading) return;
    realtimeReloading = true;
    void loadWorkspace(true).finally(() => {
      realtimeReloading = false;
    });
  }

  async function loadWorkspace(silent = false) {
    if (!silent) {
      loading = true;
      errorMessage = "";
    }
    try {
      const next = await apiRequest<GuestReadingWorkspace>(`/guest-reading/${encodeURIComponent(token)}`);
      workspace = next;
      alignSelectedItem(next);
    } catch (error) {
      if (error instanceof ApiError && error.status === 410) {
        errorMessage = error.message || "게스트 리딩 링크가 만료되었거나 회수됐어요.";
      } else {
        errorMessage = error instanceof ApiError || error instanceof Error ? error.message : "게스트 리딩 정보를 불러오지 못했어요";
      }
      if (!silent) workspace = null;
    } finally {
      loading = false;
    }
  }

  function alignSelectedItem(next: GuestReadingWorkspace) {
    const sheet = next.activeSession?.runSheet ?? next.preferredRunSheet ?? next.runSheets.find((candidate) => candidate.status === "LOCKED") ?? next.runSheets[0];
    if (!sheet?.items.length) {
      selectedItemId = "";
      return;
    }
    if (selectedItemId && sheet.items.some((item) => item.id === selectedItemId) && !followCurrent) return;
    const currentSceneId = next.activeSession?.currentSceneId;
    const currentBlockId = next.activeSession?.currentBlockId;
    const matched =
      sheet.items.find((item) => item.cue?.anchorBlock?.id === currentBlockId) ??
      sheet.items.find((item) => item.sceneId === currentSceneId || item.cue?.scene?.id === currentSceneId || item.stageSceneNote?.sceneId === currentSceneId) ??
      sheet.items.find((item) => !item.completedAt) ??
      sheet.items[0];
    selectedItemId = matched.id;
  }

  function selectItem(item: RunSheetItem) {
    selectedItemId = item.id;
    followCurrent = false;
  }

  function resolveCurrentScene() {
    if (!workspace) return null;
    const sceneId = selectedItem?.sceneId ?? selectedItem?.cue?.scene?.id ?? selectedItem?.stageSceneNote?.sceneId ?? activeSession?.currentSceneId ?? null;
    return workspace.scenes.find((scene) => scene.id === sceneId) ?? selectedItem?.scene ?? selectedItem?.cue?.scene ?? null;
  }

  function resolveCurrentBlock() {
    const blockId = selectedItem?.cue?.anchorBlock?.id ?? activeSession?.currentBlockId ?? null;
    return currentScene?.blocks?.find((block) => block.id === blockId) ?? selectedItem?.cue?.anchorBlock ?? null;
  }

  function resolveCurrentRunSheetItem() {
    if (!selectedRunSheet) return null;
    if (!activeSession) return selectedItem ?? selectedRunSheet.items.find((item) => !item.completedAt) ?? selectedRunSheet.items[0] ?? null;
    const currentBlockId = activeSession.currentBlockId ?? null;
    const currentSceneId = activeSession.currentSceneId ?? null;
    return (
      selectedRunSheet.items.find((item) => item.cue?.anchorBlock?.id === currentBlockId) ??
      selectedRunSheet.items.find(
        (item) => item.sceneId === currentSceneId || item.cue?.scene?.id === currentSceneId || item.stageSceneNote?.sceneId === currentSceneId
      ) ??
      selectedItem ??
      selectedRunSheet.items.find((item) => !item.completedAt) ??
      selectedRunSheet.items[0] ??
      null
    );
  }

  function resolveNextRunSheetItem() {
    if (!selectedRunSheet || !currentRunSheetItem) return null;
    const currentIndex = selectedRunSheet.items.findIndex((item) => item.id === currentRunSheetItem.id);
    if (currentIndex < 0) return null;
    return selectedRunSheet.items.slice(currentIndex + 1).find((item) => !item.completedAt) ?? selectedRunSheet.items[currentIndex + 1] ?? null;
  }

  function itemMetaLine(item?: RunSheetItem | null) {
    if (!item) return "선택된 항목 없음";
    return [
      typeLabel(item.itemType),
      item.estimatedDurationMin ? `${item.estimatedDurationMin}분` : "",
      item.cue ? `${item.cue.cueNumber} · ${item.cue.track.title}` : "",
      item.completedAt ? "완료" : "대기"
    ]
      .filter(Boolean)
      .join(" · ");
  }

  function typeLabel(value: string) {
    return (
      {
        READING: "리딩",
        MUSIC_PRACTICE: "음악연습",
        REHEARSAL: "리허설",
        ENSEMBLE: "앙상블",
        PERFORMANCE: "공연",
        SCENE: "장면",
        CUE: "음악 큐",
        STAGE_NOTE: "무대 메모",
        CHECK: "체크",
        BREAK: "휴식",
        ANNOUNCEMENT: "공지",
        DIALOGUE: "대사",
        LYRIC: "가사",
        STAGE_DIRECTION: "지시문",
        NOTE: "메모"
      }[value] ?? value
    );
  }

  function formatDateTime(value?: string | null) {
    return value ? new Date(value).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" }) : "-";
  }

  function formatTime(value?: string | null) {
    return value ? new Date(value).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "-";
  }
</script>

<main class="page">
  <div class="container">
    {#if loading}
      <article class="card">게스트 리딩 관람 화면을 불러오고 있어요.</article>
    {:else if errorMessage && !workspace}
      <article class="card">
        <h1>게스트 리딩에 접근할 수 없어요</h1>
        <p class="error">{errorMessage}</p>
        <a class="button" href="/">처음으로 이동</a>
      </article>
    {:else if workspace}
      <div class="toolbar">
        <div>
          <p class="badge">게스트 리딩 관람 · 읽기 전용</p>
          <h1>{workspace.event.title}</h1>
          <p class="muted">{workspace.production.title} · {formatDateTime(workspace.event.startAt)} - {formatDateTime(workspace.event.endAt)}</p>
        </div>
        <div class="button-row">
          <button class="button" type="button" onclick={() => loadWorkspace()} disabled={loading}>새로고침</button>
        </div>
      </div>

      {#if errorMessage}
        <p class="error">{errorMessage}</p>
      {/if}

      <section class="reading-status-band" aria-label="게스트 리딩 상태">
        <article>
          <span class="badge">{typeLabel(workspace.event.type)}</span>
          <h2>{activeSession ? "진행 중" : "대기"}</h2>
          <p>{activeSession ? `시작 ${formatDateTime(activeSession.startedAt)}` : "세션 시작 전"}</p>
        </article>
        <article>
          <span class="badge">진행표</span>
          <h2>{selectedRunSheet ? `${selectedRunSheet.version}판` : "없음"}</h2>
          <p>{selectedRunSheet ? `${selectedRunSheet.title} · 완료 ${itemDonePercent}%` : "장면·큐 기준 관람"}</p>
        </article>
        <article>
          <span class="badge">권한</span>
          <h2>읽기 전용</h2>
          <p>대본·진행표·큐 로그 조회만 가능</p>
        </article>
        <article>
          <span class="badge">재생 정책</span>
          <h2>수동 확인</h2>
          <p>참여자 자동재생 금지 · {workspace.liveContract.transport}</p>
          <p class="muted">{realtimeMessage}</p>
        </article>
      </section>

      {#if workspace.fallbackWarning}
        <article class="warning-box">{workspace.fallbackWarning}</article>
      {/if}

      <section class="live-focus-strip guest-focus" aria-label="게스트 현재 진행 요약">
        <article>
          <span class="badge">현재 항목</span>
          {#if currentRunSheetItem}
            <h2>{currentRunSheetItem.order}. {currentRunSheetItem.title}</h2>
            <p class="muted">{itemMetaLine(currentRunSheetItem)}</p>
          {:else}
            <h2>대기</h2>
            <p class="muted">진행 중인 항목이 아직 없어요.</p>
          {/if}
        </article>
        <article>
          <span class="badge">다음 항목</span>
          {#if nextRunSheetItem}
            <h2>{nextRunSheetItem.order}. {nextRunSheetItem.title}</h2>
            <p class="muted">{itemMetaLine(nextRunSheetItem)}</p>
          {:else}
            <h2>마지막 항목</h2>
            <p class="muted">다음 항목이 없어요.</p>
          {/if}
        </article>
        <article>
          <span class="badge">남은 항목</span>
          <h2>{remainingItemCount}건</h2>
          <p class="muted">{selectedRunSheet ? `전체 ${selectedRunSheet.items.length}개 중 미완료` : "진행표 없음"}</p>
        </article>
        <article>
          <span class="badge">조작 권한</span>
          <h2>없음</h2>
          <p class="muted">페이지 동기화, Cue 발동, 완료 처리는 내부 진행자만 가능합니다.</p>
        </article>
      </section>

      <section class="reading-layout">
        <aside class="panel reading-side">
          <div class="panel-title">
            <div>
              <h2>관람 정보</h2>
              <p class="muted">{workspace.guestAccess.label || "게스트 링크"}</p>
            </div>
          </div>
          <div class="stack">
            <p><strong>만료</strong><br />{formatDateTime(workspace.guestAccess.expiresAt)}</p>
            {#if workspace.event.location}
              <p><strong>장소</strong><br />{workspace.event.location}</p>
            {/if}
            {#if workspace.event.meetingUrl}
              <a class="button primary" href={workspace.event.meetingUrl} target="_blank" rel="noreferrer">회의 링크 열기</a>
            {/if}
            <label class="toggle">
              <input type="checkbox" bind:checked={followCurrent} />
              현재 진행 따라가기
            </label>
          </div>

          <div class="stack compact">
            <h3>연결 장면</h3>
            <div class="my-run-items">
              {#each workspace.event.scenes as item (item.id)}
                <button type="button" onclick={() => (followCurrent = false)}>
                  <span>{item.scene.act.title}</span>
                  <strong>{item.scene.title}</strong>
                  <small>대본 블록 {item.scene.blocks?.length ?? 0}개</small>
                </button>
              {:else}
                <p class="muted">연결된 장면이 없어요.</p>
              {/each}
            </div>
          </div>
        </aside>

        <section class="panel reading-main">
          <div class="panel-title">
            <div>
              <h2>진행표</h2>
              <p class="muted">{selectedRunSheet ? `${selectedRunSheet.title} · ${selectedRunSheet.status}` : "연결된 LOCKED 진행표 없음"}</p>
            </div>
          </div>

          {#if selectedRunSheet}
            <div class="progress-bar" aria-label="진행표 완료율">
              <span style={`width: ${itemDonePercent}%`}></span>
            </div>
            <div class="reading-items">
              {#each selectedRunSheet.items as item (item.id)}
                <article
                  class:active={selectedItemId === item.id}
                  class:current={currentRunSheetItem?.id === item.id}
                  class:done={Boolean(item.completedAt)}
                  class="reading-item"
                >
                  <button class="reading-item-main" type="button" onclick={() => selectItem(item)}>
                    <span class="reading-item-badges">
                      <span class="badge">{item.order}. {typeLabel(item.itemType)}</span>
                      {#if currentRunSheetItem?.id === item.id}
                        <span class="badge current-badge">현재</span>
                      {/if}
                    </span>
                    <strong>{item.title}</strong>
                    <small>{itemMetaLine(item)}</small>
                  </button>
                  <span class={`status-pill ${item.completedAt ? "done" : "waiting"}`}>{item.completedAt ? "완료" : "대기"}</span>
                </article>
              {/each}
            </div>
          {:else}
            <div class="empty-state">
              <h3>장면·음악 큐 기준 관람</h3>
              <p class="muted">확정 진행표가 없어서 일정에 연결된 장면과 음악 큐를 표시합니다.</p>
              <div class="grid two">
                <article>
                  <h4>장면</h4>
                  {#each workspace.event.scenes as item (item.id)}
                    <p>{item.scene.act.title} / {item.scene.title}</p>
                  {:else}
                    <p class="muted">연결된 장면이 없어요.</p>
                  {/each}
                </article>
                <article>
                  <h4>음악 큐</h4>
                  {#each workspace.event.musicCues as item (item.id)}
                    <p>{item.cue.cueNumber} · {item.cue.track.title}</p>
                  {:else}
                    <p class="muted">연결된 큐가 없어요.</p>
                  {/each}
                </article>
              </div>
            </div>
          {/if}
        </section>

        <aside class="panel detail-panel">
          <div class="panel-title">
            <div>
              <h2>현재 위치</h2>
              <p class="muted">{currentScene ? `${currentScene.act.title} / ${currentScene.title}` : "장면 미선택"}</p>
            </div>
          </div>

          {#if currentScene}
            <article class="reading-script">
              <h3>{currentScene.title}</h3>
              {#if currentBlock}
                <div class={`reader-block ${currentBlock.type.toLowerCase()}`}>
                  <span class="badge">{typeLabel(currentBlock.type)} {currentBlock.character?.name ?? ""}</span>
                  <p>{currentBlock.text}</p>
                </div>
              {:else}
                <div class="reader-blocks compact-reader">
                  {#each currentScene.blocks ?? [] as block (block.id)}
                    <div class={`reader-block ${block.type.toLowerCase()}`}>
                      <span class="badge">{typeLabel(block.type)} {block.character?.name ?? ""}</span>
                      <p>{block.text}</p>
                    </div>
                  {:else}
                    <p class="muted">장면 블록이 없어요.</p>
                  {/each}
                </div>
              {/if}
            </article>
          {:else}
            <article class="empty-state">선택된 장면이 없어요.</article>
          {/if}

          <div class="stack compact">
            <h3>Cue-fire 로그</h3>
            <div class="cue-log">
              {#each sessionLogs as log (log.id)}
                <article>
                  <strong>{log.cue.cueNumber} · {log.cue.track.title}</strong>
                  <p class="muted">{formatTime(log.firedAt)} · {typeLabel(log.cue.cueType)}</p>
                </article>
              {:else}
                <p class="muted">발동 로그가 없어요.</p>
              {/each}
            </div>
          </div>
        </aside>
      </section>
    {/if}
  </div>
</main>
