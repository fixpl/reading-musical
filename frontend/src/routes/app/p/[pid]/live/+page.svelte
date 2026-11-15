<script lang="ts">
  import { tick, untrack } from "svelte";
  import { page } from "$app/stores";
  import { toast } from "svelte-sonner";
  import { Button } from "$lib/components/ui/button";
  import { apiRequest, uploadSignedObject } from "$lib/api/client";
  import { buildPerformanceTimeline, formatTimelineTime, parseTimelineTime, type TimelineAsset, type TimelineCue, type TimelineItem, type TimelineScene } from "$lib/domain/performance-timeline";
  import { syncMedia } from "$lib/actions/sync-media";
  import { activeSection, assetName, mediaAt, sourceTimeSeconds, SLOT_LABELS, type CompositionBoard, type CompositionSection } from "$lib/domain/composition";
  import { buildCompositionRehearsal, isMyRehearsalItem, isPseudoSpeaker } from "$lib/domain/rehearsal-timeline";
  import RehearsalRecord from "$lib/components/app/rehearsal-record.svelte";
  import RehearsalMemos from "$lib/components/app/rehearsal-memos.svelte";
  import TimelineExportDialog from "$lib/components/app/timeline-export-dialog.svelte";
  import type { CommunityPost } from "$lib/api/community";

  type Board = { production: { id: string; title: string; backgroundAsset?: TimelineAsset | null }; tracks: Array<{ id: string; name: string }>; scenes: TimelineScene[]; cues: TimelineCue[]; characters?: Array<{ id: string; name: string }>; viewer: { canManageTracks: boolean; editableTrackIds: string[]; myCharacterIds: string[]; myTrackIds?: string[] } };
  type Signed = { url: string; expiresAt?: string };
  // 연습 화면은 초 단위로만 보여 준다(제작 메모 줄의 1ms가 합쳐져 ".001"이 보이지 않게).
  const clock = (ms: number) => formatTimelineTime(Math.floor(ms / 1000) * 1000);
  const pid = $derived($page.params.pid ?? "");
  let board = $state<Board | null>(null);
  let loading = $state(true);
  let error = $state("");
  let selectedScript = $state("");
  let selectedScene = $state("");
  let selectedCharacter = $state("");
  let onlyMine = $state(false);
  let selectedTrack = $state("");
  let compositionError = $state("");
  let personalDirty = $state(false);
  let memoDirty = $state(false);
  const recordDirty = $derived(personalDirty || memoDirty);
  let memos = $state<CommunityPost[]>([]);
  let memoComposer = $state<{ start: () => Promise<void> } | undefined>();
  // 대본 패널: 현재 위치를 따라 자동 스크롤. 사용자가 직접 스크롤하면 멈춘다.
  let follow = $state(true);
  // 제작진 메모(※) 표시 여부 — 지문과 달리 공연에 보이지 않는 안내라 끌 수 있다.
  let showNotes = $state(true);
  let panelEl = $state<HTMLElement | undefined>(undefined);
  let deepLinkError = $state("");
  let appliedDeepLink = "";
  let nowMs = $state(0);
  let playing = $state(false);
  let speed = $state(1);
  let repeat = $state(false);
  let sound = $state(false);
  let clockRevision = $state(0);
  let signed = $state<Record<string, Signed>>({});
  let mediaError = $state("");
  let mediaEnabled = $state(true);
  const signing = new Map<string, Promise<void>>();
  let stage = $state<HTMLDivElement | undefined>(undefined);
  let manualFullscreen = $state(false);
  let editing = $state<TimelineItem | null>(null);
  let startInput = $state("");
  let durationInput = $state("");
  let assetInput = $state("");
  let library = $state<TimelineAsset[]>([]);
  let saving = $state(false);
  let uploading = $state(false);
  // 장·막 구성(장면별 악보·반주)을 연습 화면에 함께 보여준다 — 없어도 연습 진행에는 지장 없음.
  let compositionSections = $state<CompositionSection[]>([]);
  let exporting = $state(false);
  let showVideo = $state(false);

  const scripts = $derived([
    ...(compositionSections.length ? [{ id: "composition", title: "공연 구성 시간" }] : []),
    ...new Map((board?.scenes ?? []).map((scene) => {
      const id = scene.act.scriptId ?? "legacy";
      return [id, { id, title: `원문 시간 · ${scene.act.script?.title ?? "대본"}` }] as const;
    })).values()
  ]);
  const fromComposition = $derived(selectedScript === "composition");
  const compositionTimeline = $derived(buildCompositionRehearsal(compositionSections, board?.scenes ?? [], board?.cues ?? [], board?.characters ?? [], board?.tracks ?? []));
  const scenes = $derived(fromComposition ? compositionTimeline.scenes : (board?.scenes ?? []).filter((scene) => (scene.act.scriptId ?? "legacy") === selectedScript));
  const sceneIds = $derived(new Set(scenes.map((scene) => scene.id)));
  const cues = $derived((board?.cues ?? []).filter((cue) => cue.sceneId === null || sceneIds.has(cue.sceneId)));
  const timeline = $derived(fromComposition ? compositionTimeline : buildPerformanceTimeline(scenes, cues));
  const lines = $derived(timeline.items.filter((item) => item.kind === "line"));
  // 공동 화자("엄마·아빠")와 "모두"는 고를 수 있는 배역이 아니므로 목록에서 뺀다.
  const characters = $derived([...new Map(lines.flatMap((item) => item.block?.character && !isPseudoSpeaker(item.block.character) ? [[item.block.character.id, item.block.character] as const] : [])).values()]);
  const activeLines = $derived(lines.filter((item) => item.startMs <= nowMs && nowMs < item.startMs + item.durationMs));
  const captions = $derived(activeLines.filter((item) => item.block?.type === "DIALOGUE" || item.block?.type === "LYRIC"));
  const nextLine = $derived(lines.find((item) => item.startMs > nowMs && (item.block?.type === "DIALOGUE" || item.block?.type === "LYRIC")));
  const activeCues = $derived(timeline.items.filter((item) => item.kind === "cue" && item.startMs <= nowMs && nowMs < item.startMs + item.durationMs));
  const audioCues = $derived(activeCues.filter((item) => item.cue?.asset?.kind === "AUDIO"));
  const myCharacterIds = $derived(selectedCharacter ? [selectedCharacter] : board?.viewer.myCharacterIds ?? []);
  const myTrackIds = $derived(selectedTrack ? [selectedTrack] : board?.viewer.myTrackIds ?? []);
  const myItems = $derived(timeline.items.filter((item) => isMyRehearsalItem(item, myCharacterIds, myTrackIds)));
  const nextMyItem = $derived(myItems.find((item) => item.startMs > nowMs + 10));
  const selectedSection = $derived(fromComposition ? compositionSections.find((section) => section.id === selectedScene) : null);
  const sceneItemsForFilter = $derived(timeline.items.filter((item) => !selectedScene || item.sceneId === selectedScene || (selectedSection && compositionSections.some((section) => section.id === item.sceneId && section.parentId === selectedSection.id))));
  const filteredItems = $derived(sceneItemsForFilter.filter((item) => !onlyMine || isMyRehearsalItem(item, myCharacterIds, myTrackIds)));
  const loopRange = $derived(selectedSection ? { start: selectedSection.timing.startMs, end: selectedSection.timing.startMs + selectedSection.timing.durationMs } : { start: selectedScene && sceneItemsForFilter.length ? Math.min(...sceneItemsForFilter.map((item) => item.startMs)) : 0, end: selectedScene && sceneItemsForFilter.length ? Math.max(...sceneItemsForFilter.map((item) => item.startMs + item.durationMs)) : timeline.totalMs });
  // 지금 위치(방금 시작된 마지막 항목) — 대본 패널이 이 줄을 따라간다.
  const currentRowId = $derived.by(() => {
    let found: string | null = null;
    for (const item of filteredItems) { if (item.startMs <= nowMs + 1) found = item.id; else break; }
    return found;
  });
  const rowTime = (item: TimelineItem) => !fromComposition && (item.block?.startMs != null || item.cue?.startMs != null)
    ? formatTimelineTime(item.startMs)
    : clock(item.startMs);
  const positionTime = $derived(!fromComposition && !playing ? formatTimelineTime(nowMs) : clock(nowMs));
  const visibleItems = $derived(showNotes ? filteredItems : filteredItems.filter((item) => item.block?.type !== "NOTE"));
  const noteCount = $derived(filteredItems.filter((item) => item.block?.type === "NOTE").length);
  const hasMine = $derived(myCharacterIds.length + myTrackIds.length > 0);
  const myFilterLabel = $derived(myCharacterIds.length && myTrackIds.length ? "내 배역·담당 큐" : myTrackIds.length ? "담당 큐" : "내 대사");
  const nextMyLabel = $derived(nextMyItem?.kind === "cue" ? "다음 담당 큐" : "다음 내 대사");
  $effect(() => {
    const id = currentRowId;
    const panel = panelEl;
    if (!id || !panel || !follow) return;
    const row = panel.querySelector<HTMLElement>(`[data-row="${CSS.escape(id)}"]`);
    if (!row) return;
    panel.scrollTo({ top: Math.max(0, row.offsetTop - panel.clientHeight * 0.3), behavior: untrack(() => playing) ? "smooth" : "auto" });
  });
  const estimatedCount = $derived(filteredItems.filter((item) => item.estimated).length);
  const canEdit = (item: TimelineItem) => !fromComposition && (item.kind === "line" ? Boolean(board?.viewer.canManageTracks) : Boolean(board?.viewer.editableTrackIds.includes(item.cue?.trackId ?? "")));

  // 지금 재생 중인 장면이 장·막 구성에서 가져온 구간이면, 그 구간에 연결된 배경·악보·반주를 함께 보여준다.
  const activeSceneId = $derived(timeline.items.find((item) => item.startMs <= nowMs && nowMs < item.startMs + item.durationMs)?.sceneId ?? null);
  const sceneItems = $derived(activeSceneId ? timeline.items.filter((item) => item.sceneId === activeSceneId) : []);
  const sceneStartMs = $derived(sceneItems.length ? Math.min(...sceneItems.map((item) => item.startMs)) : 0);
  const sceneSection = $derived(fromComposition ? activeSection(compositionSections, nowMs) : activeSceneId ? compositionSections.find((section) => section.sourceSceneId === activeSceneId) ?? null : null);
  const memoUnitKey = $derived(fromComposition && sceneSection ? `section:${sceneSection.id}` : !fromComposition && activeSceneId ? `scene:${activeSceneId}` : "overview");
  const memoUnitTitle = $derived(fromComposition ? sceneSection?.title ?? "전체 공연" : scenes.find((scene) => scene.id === activeSceneId)?.title ?? "전체 공연");
  const mediaTimelineMs = $derived(fromComposition ? nowMs : (sceneSection?.timing.startMs ?? 0) + Math.max(0, nowMs - sceneStartMs));
  const backgroundClip = $derived(mediaAt(compositionSections, sceneSection, "BACKGROUND", mediaTimelineMs));
  const scoreClip = $derived(mediaAt(compositionSections, sceneSection, "SCORE", mediaTimelineMs));
  const musicClip = $derived(mediaAt(compositionSections, sceneSection, "MUSIC", mediaTimelineMs));
  const musicTime = $derived(musicClip ? sourceTimeSeconds(musicClip, mediaTimelineMs, Infinity) : 0);
  const exportSource = $derived({ sections: compositionSections, items: timeline.items, scenes, fromComposition, totalMs: timeline.totalMs, defaultBackground: board?.production.backgroundAsset ?? null });
  const SCORE_IMAGE_MIME = ["image/png", "image/jpeg", "image/webp"];

  // 배경은 장·막 구성이 우선, 없으면 기존 큐 배경·공연 기본 배경 순으로 대체한다.
  const visualCue = $derived(activeCues.filter((item) => ["IMAGE", "VIDEO"].includes(item.cue?.asset?.kind ?? "")).at(-1));
  const visual = $derived(backgroundClip?.media.asset ?? visualCue?.cue?.asset ?? board?.production.backgroundAsset ?? null);
  const visualTime = $derived(
    backgroundClip
      ? sourceTimeSeconds(backgroundClip, mediaTimelineMs, Infinity)
      : Math.max(0, nowMs - (visualCue?.startMs ?? 0)) / 1000
  );

  $effect(() => {
    const id = pid;
    const controller = new AbortController();
    board = null; loading = true; error = ""; playing = false; nowMs = 0; editing = null;
    selectedScript = ""; selectedScene = ""; selectedCharacter = "";
    memos = []; appliedDeepLink = ""; appliedSection = ""; deepLinkError = "";
    repeat = false; signed = {}; library = []; mediaError = ""; mediaEnabled = true; compositionSections = []; compositionError = ""; onlyMine = false; selectedTrack = "";
    void load(id, controller.signal);
    return () => controller.abort();
  });

  $effect(() => {
    if (!board || loading) return;
    const query = $page.url.search;
    if (query === appliedDeepLink) return;
    appliedDeepLink = query; deepLinkError = "";
    const source = $page.url.searchParams.get("source");
    const at = $page.url.searchParams.get("at");
    if (!source) return;
    if (!scripts.some((script) => script.id === source)) { deepLinkError = "링크에 지정된 대본을 현재 공연에서 찾을 수 없어요."; return; }
    const time = at === null ? 0 : Number(at);
    if (!Number.isFinite(time) || time < 0 || time > 86400000) { deepLinkError = "메모에 저장된 연습 시점이 올바르지 않아요."; return; }
    selectedScript = source; selectedScene = ""; playing = false;
    if (time > timeline.totalMs) deepLinkError = "현재 대본이 메모를 작성할 때보다 짧아졌어요. 가장 가까운 시점으로 이동했어요.";
    seek(time);
  });

  // 구성 화면의 "연습 화면에서 미리보기"로 들어오면 그 구간부터 보여 준다(?section=구간ID).
  let appliedSection = "";
  $effect(() => {
    if (!board || loading) return;
    const id = $page.url.searchParams.get("section");
    if ($page.url.searchParams.has("source") || !id || id === appliedSection) return;
    appliedSection = id;
    const section = compositionSections.find((candidate) => candidate.id === id);
    if (!section) return;
    selectedScript = "composition";
    selectedScene = id;
    playing = false;
    seek(section.timing.startMs);
  });

  async function load(id: string, signal?: AbortSignal) {
    try {
      const [result, composition] = await Promise.all([
        apiRequest<Board>(`/productions/${id}/cue-sheet`, { signal }),
        apiRequest<CompositionBoard>(`/productions/${id}/composition`, { signal }).catch((cause: unknown) => {
          if (!signal?.aborted && id === pid) compositionError = cause instanceof Error ? cause.message : "장·막 구성을 읽지 못했어요.";
          return null;
        })
      ]);
      if (signal?.aborted || id !== pid) return;
      board = result;
      compositionSections = composition?.sections ?? [];
      selectedScript = compositionSections.length ? "composition" : result.scenes[0]?.act.scriptId ?? "legacy";
      // 내가 캐스팅된 배역이 있으면 자동으로 강조 선택 — 매번 직접 고를 필요가 없도록.
      selectedCharacter = result.viewer.myCharacterIds[0] ?? "";
      // 배우·스태프는 처음부터 내 파트만 보이게 하고, 운영자는 전체를 본다.
      onlyMine = !result.viewer.canManageTracks && result.viewer.myCharacterIds.length + (result.viewer.myTrackIds?.length ?? 0) > 0;
    } catch (cause) {
      if (!signal?.aborted && id === pid) error = cause instanceof Error ? cause.message : "연습 자료를 불러오지 못했어요";
    } finally {
      if (!signal?.aborted && id === pid) loading = false;
    }
  }

  function keyboard(event: KeyboardEvent) {
    if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, button, a, [contenteditable=true]")) return;
    if (event.code === "Space") { event.preventDefault(); togglePlay(); }
    else if (event.key === "ArrowRight") { event.preventDefault(); step(1); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); step(-1); }
  }

  // Only the browser's monotonic clock drives personal rehearsal. No shared
  // reading-session or websocket state is updated by these controls.
  $effect(() => {
    if (!playing) return;
    void clockRevision;
    const rate = speed;
    const looping = repeat;
    const bounds = loopRange;
    const total = timeline.totalMs;
    const initial = untrack(() => nowMs);
    const began = performance.now();
    let frame = 0;
    let lastPaint = 0;
    const tick = (timestamp: number) => {
      const next = initial + (timestamp - began) * rate;
      const end = looping ? bounds.end : total;
      if (next >= end) {
        nowMs = looping ? bounds.start : end;
        if (looping && end > bounds.start) clockRevision += 1;
        else playing = false;
        return;
      }
      if (timestamp - lastPaint >= 80) { nowMs = next; lastPaint = timestamp; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  });

  $effect(() => {
    if (!mediaEnabled) return;
    const assetIds = [visual?.id, ...audioCues.map((item) => item.cue?.asset?.id), scoreClip?.media.assetId, musicClip?.media.assetId].filter(
      (id): id is string => Boolean(id)
    );
    for (const id of assetIds) void ensureSigned(id);
    // 서명 URL 만료 1분 전에 다시 서명한다(오래 켜 둔 진행 화면에서 미디어 오류 방지).
    const timer = setInterval(() => { for (const id of assetIds) void ensureSigned(id); }, 20_000);
    return () => clearInterval(timer);
  });

  async function ensureSigned(assetId: string) {
    const existing = untrack(() => signed[assetId]);
    if (existing && (!existing.expiresAt || Date.parse(existing.expiresAt) > Date.now() + 60_000)) return;
    if (signing.has(assetId)) return signing.get(assetId);
    const productionId = pid;
    const promise = apiRequest<Signed>(`/assets/${assetId}/url`).then((result) => {
      if (productionId === pid) signed = { ...signed, [assetId]: result };
    }).catch((cause) => {
      if (productionId === pid) { playing = false; mediaError = cause instanceof Error ? cause.message : "미디어 주소를 불러오지 못했어요"; }
    }).finally(() => signing.delete(assetId));
    signing.set(assetId, promise);
    await promise;
  }

  function onMediaError(message: string) {
    playing = false;
    mediaError = message;
  }

  function seek(value: number) {
    nowMs = Math.max(0, Math.min(timeline.totalMs, value));
    clockRevision += 1;
  }
  function changeScript(select: HTMLSelectElement) {
    if (recordDirty && !window.confirm("저장하지 않은 개인 메모나 완료 표시가 있어요. 변경을 버리고 연습 기준을 바꿀까요?")) {
      select.value = selectedScript;
      return;
    }
    selectedScript = select.value;
    selectedScene = "";
    selectedCharacter = board?.viewer.myCharacterIds[0] ?? "";
    playing = false;
    seek(0);
    editing = null;
  }
  function togglePlay() {
    if (!timeline.totalMs) return;
    if (repeat && (nowMs < loopRange.start || nowMs >= loopRange.end)) seek(loopRange.start);
    else if (nowMs >= timeline.totalMs) seek(0);
    mediaError = "";
    playing = !playing;
  }
  function step(direction: -1 | 1) {
    const spoken = lines.filter((item) => item.block?.type === "DIALOGUE" || item.block?.type === "LYRIC");
    const candidates = spoken.length ? spoken : timeline.items;
    const target = direction === 1 ? candidates.find((item) => item.startMs > nowMs + 10) : [...candidates].reverse().find((item) => item.startMs < nowMs - 10);
    seek(target?.startMs ?? (direction === 1 ? timeline.totalMs : 0));
  }
  // iOS Safari는 일반 요소에 표준 Fullscreen API를 지원하지 않는다.
  // 지원 브라우저는 네이티브 전체화면을, 그렇지 않으면 고정 레이아웃 폴백을 쓴다.
  async function project() {
    if (!stage) return;
    showVideo = true;
    await tick();
    if (document.fullscreenEnabled && typeof stage.requestFullscreen === "function") {
      try { await stage.requestFullscreen(); return; }
      catch { /* 폴백으로 진행 */ }
    }
    manualFullscreen = true;
  }
  function exitProjection() {
    manualFullscreen = false;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }
  $effect(() => {
    if (!manualFullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeydown = (event: KeyboardEvent) => { if (event.key === "Escape") exitProjection(); };
    window.addEventListener("keydown", onKeydown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeydown);
    };
  });
  async function openEditor(item: TimelineItem) {
    if (!canEdit(item)) return;
    playing = false;
    editing = item;
    const originalStart = item.block?.startMs ?? item.cue?.startMs;
    startInput = originalStart == null ? "" : formatTimelineTime(originalStart);
    const duration = item.block ? item.block.durationMs == null ? null : item.block.durationMs / 1000 : item.cue?.durationSec;
    durationInput = duration == null ? "" : String(duration);
    assetInput = item.cue?.asset?.id ?? "";
    if (item.kind === "cue") {
      const productionId = pid;
      library = [];
      try {
        const assets = await apiRequest<TimelineAsset[]>(`/assets?productionId=${productionId}`);
        if (productionId === pid && editing?.id === item.id) library = assets;
      } catch (cause) {
        if (productionId === pid && editing?.id === item.id) toast.error(cause instanceof Error ? cause.message : "미디어 목록을 읽지 못했어요");
      }
    }
  }
  async function saveTiming(event: SubmitEvent) {
    event.preventDefault();
    if (!editing || !board || !canEdit(editing)) return;
    const item = editing;
    const productionId = pid;
    try {
      const startMs = parseTimelineTime(startInput);
      const seconds = durationInput.trim() ? Number(durationInput) : null;
      if (seconds !== null && (!Number.isFinite(seconds) || seconds <= 0 || seconds > (item.kind === "cue" ? 3600 : 86400) || (item.kind === "cue" && !Number.isInteger(seconds)))) throw new Error("길이는 0보다 커야 하며, 큐는 정수 초(최대 3600초)로 입력해 주세요");
      if (startMs !== null && seconds !== null && startMs + seconds * 1000 > 86_400_000) throw new Error("종료 시각은 공연 시작 후 24시간 이내로 입력해 주세요");
      saving = true;
      if (item.kind === "line") {
        const durationMs = seconds === null ? null : Math.round(seconds * 1000);
        if (durationMs !== null && durationMs < 1) throw new Error("대사 길이는 최소 0.001초로 입력해 주세요");
        const updated = await apiRequest<{ updatedAt: string }>(`/productions/${productionId}/blocks/${item.id}`, { method: "PATCH", body: JSON.stringify({ startMs, durationMs, expectedUpdatedAt: item.block?.updatedAt }) });
        if (productionId !== pid || !board) return;
        board = { ...board, scenes: board.scenes.map((scene) => ({ ...scene, blocks: scene.blocks?.map((block) => block.id === item.id ? { ...block, startMs, durationMs, updatedAt: updated.updatedAt } : block) })) };
      } else {
        const updated = await apiRequest<TimelineCue>(`/productions/${productionId}/cue-sheet/cues/${item.id}`, { method: "PATCH", body: JSON.stringify({ startMs, durationSec: seconds, assetId: assetInput || null, expectedUpdatedAt: item.cue?.updatedAt }) });
        if (productionId !== pid || !board) return;
        board = { ...board, cues: board.cues.map((cue) => cue.id === item.id ? updated : cue) };
      }
      editing = null;
      toast.success("시간표를 저장했어요");
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "저장하지 못했어요"); }
    finally { saving = false; }
  }
  async function upload(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file || !board?.viewer.canManageTracks) return;
    if (file.size > 500 * 1024 * 1024) { toast.error("500MB 이하 파일을 선택해 주세요"); return; }
    const productionId = pid;
    const editorId = editing?.id;
    uploading = true;
    try {
      const created = await apiRequest<{ asset: TimelineAsset; upload: { url: string; method?: string } }>("/assets", { method: "POST", body: JSON.stringify({ purpose: "CUE_MEDIA", productionId, fileName: file.name, mimeType: file.type, size: file.size }) });
      await uploadSignedObject(created.upload, file, file.type);
      if (productionId !== pid || editing?.id !== editorId) return;
      library = [created.asset, ...library];
      assetInput = created.asset.id;
      toast.success("업로드했어요. 시간표 저장을 누르면 이 큐에 연결돼요.");
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "업로드하지 못했어요"); }
    finally { uploading = false; }
  }
</script>

<svelte:window onkeydown={keyboard} />
<svelte:document onvisibilitychange={() => { if (document.hidden) playing = false; }} />
<svelte:head><title>개인 연습 · 시간표 — {board?.production.title ?? "공연"}</title></svelte:head>

<div class="mx-auto w-full min-w-0 max-w-6xl space-y-5">
  <header class="flex flex-wrap items-start justify-between gap-3">
    <div><h1 class="text-2xl font-bold">개인 연습</h1><p class="text-muted-foreground mt-1 text-sm">내 속도로 연습해요. 다른 사람의 진행에는 영향을 주지 않아요.</p></div>
    <div class="flex flex-wrap gap-2">{#if board?.viewer.canManageTracks}<Button href={`/app/p/${pid}/composition`} variant="outline" class="min-h-11">대본 구성</Button><Button href={`/app/p/${pid}/cuesheet`} variant="outline" class="min-h-11">큐시트 편집</Button>{:else}<Button href={`/app/p/${pid}/board`} variant="outline" class="min-h-11">팀 대화</Button>{/if}</div>
  </header>
  {#if loading}<p class="bg-card rounded-2xl border p-8" role="status">연습 자료를 불러오고 있어요…</p>
  {:else if error}<section class="bg-card rounded-2xl border p-6" role="alert"><p>{error}</p><Button class="mt-4" onclick={() => { loading = true; error = ""; void load(pid); }}>다시 불러오기</Button></section>
  {:else if board}
    {#if deepLinkError}<p role="alert" class="text-destructive rounded-xl border p-3 text-sm">{deepLinkError}</p>{/if}
    {#if compositionError}<p role="alert" class="text-destructive rounded-xl border p-3 text-sm">장·막 구성을 불러오지 못했어요. {compositionError} 최신 대본을 확인하려면 다시 불러와 주세요.</p>{/if}
    <div class="bg-card rounded-2xl border px-4 sm:px-5">
      {#if scripts.length}
        <div class="grid items-center gap-2.5 border-b py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:gap-5">
          <label class="grid min-w-0 gap-1.5 text-sm font-medium">연습 기준
            <select class="bg-background min-h-11 w-full rounded-lg border px-3" value={selectedScript} onchange={(event) => changeScript(event.currentTarget)}>
              {#each scripts as script (script.id)}<option value={script.id}>{script.title}</option>{/each}
            </select>
          </label>
          <p class="text-muted-foreground text-sm leading-6">{fromComposition
            ? scripts.length > 1 ? "장면 배치에 맞춰 재생해요. 대본에 입력한 시간은 ‘원문 시간’에서 확인할 수 있어요." : "장면 배치에 맞춰 재생해요."
            : "대본과 큐시트에 입력한 시점에 맞춰 재생해요. 시간이 없는 줄은 자동으로 배치해요."}</p>
        </div>
      {/if}
      <details class="py-1">
        <summary class="min-h-11 cursor-pointer py-3 text-sm font-semibold">배역 · 장면 · 담당 큐 <span class="text-muted-foreground font-normal">· {characters.find((character) => character.id === selectedCharacter)?.name ?? (myTrackIds.length ? '담당 큐' : '전체 보기')}</span></summary>
        <div class="grid gap-3 sm:grid-cols-3">
          <label class="grid gap-1 text-sm font-medium">장면 · 반복 구간<select class="bg-background min-h-11 w-full rounded-lg border px-3" value={selectedScene} onchange={(event) => { selectedScene = event.currentTarget.value; playing = false; seek(fromComposition ? compositionSections.find((section) => section.id === selectedScene)?.timing.startMs ?? 0 : timeline.items.find((item) => !selectedScene || item.sceneId === selectedScene)?.startMs ?? 0); }}><option value="">전체 공연</option>{#each scenes as scene (scene.id)}<option value={scene.id}>{scene.act.title} · {scene.title}</option>{/each}</select></label>
          <label class="grid gap-1 text-sm font-medium">내 배역 강조<select class="bg-background min-h-11 w-full rounded-lg border px-3" bind:value={selectedCharacter}><option value="">모든 배역</option>{#each characters as character (character.id)}<option value={character.id}>{character.name}</option>{/each}</select></label>
          <label class="grid gap-1 text-sm font-medium">담당 큐 트랙<select class="bg-background min-h-11 w-full rounded-lg border px-3" bind:value={selectedTrack}><option value="">내 배정 트랙</option>{#each board.tracks as track (track.id)}<option value={track.id}>{track.name}</option>{/each}</select></label>
        </div>
        <p class="text-muted-foreground pb-3 pt-2 text-xs">Space 키로 재생하거나 멈춰요. 방향키로 이전·다음 대사에 이동해요.</p>
      </details>
    </div>
    {#if timeline.items.length === 0}<section class="bg-card rounded-2xl border p-8 text-center"><h2 class="font-semibold">등록된 대본이나 큐가 없어요</h2><p class="text-muted-foreground mt-2 text-sm">운영자가 대본과 큐를 등록하면 이 화면에서 연습할 수 있어요.</p></section>
    {:else}
      <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(360px,1fr)]">
        <section class="min-w-0 space-y-3 lg:sticky lg:top-3">
          <div class="bg-card space-y-3 rounded-2xl border p-3" aria-label="개인 연습 재생">
            <div class="flex items-center gap-3"><output class="shrink-0 font-mono text-sm tabular-nums" aria-label="현재 위치와 전체 길이">{positionTime} / {fromComposition ? clock(timeline.totalMs) : formatTimelineTime(timeline.totalMs)}</output><input class="accent-primary h-8 min-w-0 flex-1" type="range" min="0" max={timeline.totalMs} step="100" value={nowMs} oninput={(event) => seek(Number(event.currentTarget.value))} aria-label="연습 위치 이동" aria-valuetext={positionTime} /></div>
            <div class="grid grid-cols-3 gap-2"><Button variant="outline" class="min-h-11" onclick={() => step(-1)}>이전 대사</Button><Button class="min-h-11" aria-pressed={playing} onclick={togglePlay}>{playing ? "일시정지" : "연습 재생"}</Button><Button variant="outline" class="min-h-11" onclick={() => step(1)}>다음 대사</Button></div>
            <div class="flex flex-wrap items-center gap-2">
              {#if hasMine}<Button variant="outline" class="min-h-11 flex-1" disabled={!nextMyItem} onclick={() => { if (nextMyItem) { follow = true; seek(nextMyItem.startMs); } }}>{nextMyLabel}</Button>{/if}
              <label class="flex min-h-11 items-center gap-2 px-1 text-sm"><input class="accent-primary size-4" type="checkbox" bind:checked={sound} />소리 켜기</label>
              <Button variant="ghost" class="min-h-11 lg:hidden" aria-expanded={showVideo} aria-controls="rehearsal-stage" onclick={() => showVideo = !showVideo}>{showVideo ? "영상 접기" : "영상 펼치기"}</Button>
            </div>
            <details class="border-t pt-1">
              <summary class="text-muted-foreground min-h-11 cursor-pointer py-3 text-xs font-medium">반복·배속 · 메모 · 영상 저장</summary>
              <div class="mt-2 space-y-3">
                <div class="flex flex-wrap items-center justify-between gap-3 text-sm"><label class="flex min-h-11 items-center gap-2"><input class="accent-primary size-4" type="checkbox" bind:checked={repeat} />선택 구간 반복</label><label class="flex items-center gap-2">재생 속도<select class="bg-background min-h-11 rounded-lg border px-3" bind:value={speed}>{#each [0.5, 0.75, 1, 1.25, 1.5] as rate (rate)}<option value={rate}>{rate}×</option>{/each}</select></label></div>
                <div class="grid grid-cols-2 gap-2"><Button variant="outline" class="min-h-11" onclick={() => memoComposer?.start()}>이 시점에 메모</Button><Button variant="outline" class="min-h-11" onclick={project}>영상 전체화면</Button></div>
                <Button variant="outline" class="min-h-11 w-full" disabled={!timeline.totalMs} onclick={() => { playing = false; exporting = true; }}>MP4로 저장</Button>
              </div>
            </details>
          </div>
          <div class={[!showVideo && !manualFullscreen && "max-lg:hidden"]}>
            <div
              bind:this={stage}
              id="rehearsal-stage"
              class="stage-screen relative flex aspect-video w-full flex-col justify-end overflow-hidden rounded-2xl bg-black p-4 text-white sm:p-6"
              class:manual-fullscreen={manualFullscreen}
            >
              {#if manualFullscreen}
                <Button
                  variant="outline"
                  class="absolute end-4 top-4 z-20 min-h-11 border-white/30 bg-black/60 text-white hover:bg-black/80"
                  onclick={exitProjection}
                >
                  닫기
                </Button>
              {/if}
              {#if mediaEnabled && visual && signed[visual.id]}
                {#key `${visual.id}:${signed[visual.id].url}`}
                  {#if visual.kind === "IMAGE"}<img src={signed[visual.id].url} alt="공연 배경" class="absolute inset-0 h-full w-full object-contain" />
                  {:else}<video src={signed[visual.id].url} playsinline preload="auto" class="absolute inset-0 h-full w-full object-contain" use:syncMedia={{ time: visualTime, play: playing, rate: speed, muted: !sound, volume: backgroundClip?.media.volume, loop: backgroundClip?.media.loop, sourceStart: (backgroundClip?.media.sourceStartMs ?? 0) / 1000, onError: onMediaError }}><track kind="captions" /></video>{/if}
                {/key}
              {/if}
              <div class="stage-context absolute start-3 top-3 z-10 rounded-lg bg-black/65 px-3 py-2 text-xs">{memoUnitTitle} · {clock(nowMs)}</div>
              <div class="relative z-10 max-h-full space-y-2 overflow-y-auto text-center">
                {#each captions as item (item.id)}<p class="rounded-xl bg-black/85 px-3 py-2 text-lg leading-relaxed sm:text-2xl" class:highlighted={isMyRehearsalItem(item, myCharacterIds, myTrackIds)}><span class="mb-1 block text-xs font-bold sm:text-base">{item.block?.character?.name ?? "해설"}</span>{item.block?.text}</p>{/each}
                {#if !captions.length && (activeCues.length || activeLines.length)}<p class="stage-context rounded-xl bg-black/85 px-3 py-2 text-sm leading-relaxed"><span class="mb-1 block text-xs text-white/70">{activeCues.length ? '현재 행동 큐' : '무대 지문'}</span>{activeCues[0]?.cue?.content ?? activeLines[0]?.block?.text}</p>{/if}
              </div>
            </div>
          </div>
          {#each mediaEnabled ? audioCues : [] as item (item.id)}{#if item.cue?.asset && signed[item.cue.asset.id]}<audio src={signed[item.cue.asset.id].url} preload="auto" use:syncMedia={{ time: (nowMs - item.startMs) / 1000, play: playing, rate: speed, muted: !sound, onError: onMediaError }}></audio>{/if}{/each}
          {#if mediaEnabled && musicClip && signed[musicClip.media.assetId]}
            {#key musicClip.media.id}
              <audio src={signed[musicClip.media.assetId].url} preload="auto" use:syncMedia={{ time: musicTime, play: playing, rate: speed, muted: !sound, volume: musicClip.media.volume, loop: musicClip.media.loop, sourceStart: musicClip.media.sourceStartMs / 1000, onError: onMediaError }}></audio>
            {/key}
          {/if}
          {#if mediaError}<div role="alert" class="text-destructive space-y-2 rounded-xl border p-3 text-sm"><p>{mediaError}</p><Button variant="outline" onclick={() => { mediaEnabled = false; mediaError = ""; }}>미디어 없이 대본 연습</Button></div>{/if}
          {#if !mediaEnabled}<Button variant="outline" onclick={() => { mediaEnabled = true; mediaError = ""; }}>미디어 다시 사용</Button>{/if}
        </section>
        <section class="bg-card relative flex min-w-0 flex-col overflow-hidden rounded-2xl border max-lg:h-[62dvh] lg:h-[calc(100dvh-6rem)]" aria-label="대본 · 큐 진행">
          <header class="space-y-2 border-b p-3">
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="text-sm font-bold">{onlyMine ? myFilterLabel : "대본 · 큐"}</h2><span class="text-muted-foreground text-xs">{filteredItems.length}개</span>
              <div class="bg-muted ms-auto inline-flex rounded-lg p-0.5" role="group" aria-label="표시 범위">
                <button type="button" class={["min-h-11 rounded-md px-3 text-sm", !onlyMine ? "bg-background font-semibold shadow-sm" : "text-muted-foreground"]} aria-pressed={!onlyMine} onclick={() => onlyMine = false}>전체</button>
                <button type="button" class={["min-h-11 rounded-md px-3 text-sm", onlyMine ? "bg-background font-semibold shadow-sm" : "text-muted-foreground"]} aria-pressed={onlyMine} disabled={!hasMine} onclick={() => onlyMine = true}>{myFilterLabel}</button>
              </div>
            </div>
            {#if noteCount}
              <label class="text-muted-foreground flex items-center gap-2 text-xs"><input type="checkbox" bind:checked={showNotes} /><span aria-hidden="true">📝</span> 제작 메모 보기 ({noteCount})</label>
            {/if}
            {#if hasMine}
              <div class="bg-primary/5 flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-xs">
                <span class="font-semibold">{myFilterLabel}</span><span class="text-muted-foreground min-w-0 truncate">{#if nextMyItem}다음 {rowTime(nextMyItem)} · 약 {Math.max(0, Math.ceil((nextMyItem.startMs - nowMs) / 1000))}초 뒤{:else}이후 담당 구간 없음{/if}</span>
              </div>
            {:else}
              <p class="text-muted-foreground text-xs">위의 ‘배역 · 장면 · 담당 큐’에서 내 배역이나 큐 트랙을 선택해 주세요.</p>
            {/if}
            {#if onlyMine && !filteredItems.length}<p class="text-muted-foreground text-sm">이 구간에는 내 항목이 없어요. 전체 항목을 보거나 배역·트랙을 바꿔 주세요.</p>{/if}
          </header>
          <div bind:this={panelEl} class="relative min-h-0 flex-1 overflow-y-auto" role="list" aria-label="대본과 큐 목록" onwheel={() => follow = false} ontouchmove={() => follow = false}>
            {#each visibleItems as item, index (item.id)}
              {#if index === 0 || visibleItems[index - 1].sceneTitle !== item.sceneTitle}
                <h3 class="bg-muted/90 text-muted-foreground sticky top-0 z-10 border-b px-3 py-1.5 text-xs font-semibold backdrop-blur">{item.sceneTitle}</h3>
              {/if}
              {@const mine = isMyRehearsalItem(item, myCharacterIds, myTrackIds)}
              {@const active = item.startMs <= nowMs && nowMs < item.startMs + item.durationMs}
              <article role="listitem" data-row={item.id} class={["grid min-w-0 gap-2 border-b border-s-4 px-3 py-2", fromComposition ? "grid-cols-[3.75rem_minmax(0,1fr)_auto]" : timeline.totalMs >= 3_600_000 ? "grid-cols-[7rem_minmax(0,1fr)_auto]" : "grid-cols-[5rem_minmax(0,1fr)_auto]", active ? "border-s-primary bg-primary/15" : mine ? "border-s-amber-400" : "border-s-transparent", hasMine && !mine && !active && "opacity-60", item.kind === "cue" && !active && "bg-muted/40", item.block?.type === "NOTE" && !active && "bg-amber-500/8"]}>
                <button type="button" class="text-primary min-h-9 text-start font-mono text-sm" onclick={() => { follow = true; seek(item.startMs); }} aria-label={`${rowTime(item)} 시점으로 이동`}>{rowTime(item)}</button>
                <!-- 줄(대사·큐)을 누르면 그 시점으로 이동한다. 글자를 드래그해 복사하는 중이면 이동하지 않는다. -->
                <div
                  class="hover:bg-muted/40 -m-1 min-w-0 cursor-pointer rounded-md p-1"
                  role="button"
                  tabindex="0"
                  onclick={() => { if (window.getSelection()?.toString()) return; follow = true; seek(item.startMs); }}
                  onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); follow = true; seek(item.startMs); } }}
                >
                  <p class="text-muted-foreground flex flex-wrap items-center gap-x-2 text-[13px]">
                    {#if item.kind === "cue"}<span class="text-foreground font-semibold">{board.tracks.find((track) => track.id === item.cue?.trackId)?.name ?? "큐"} · {item.cue?.cueNumber}</span>{#if item.cue?.trigger}<span>계기: {item.cue.trigger}</span>{/if}{#if item.cue?.asset}<span>{item.cue.asset.kind === "IMAGE" ? "배경" : item.cue.asset.kind === "VIDEO" ? "영상" : "음원"} 연결</span>{/if}
                    {:else if item.block?.type === "NOTE"}<span class="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300"><span aria-hidden="true">📝</span> 제작 메모</span>
                    {:else if item.block?.type === "STAGE_DIRECTION"}<span class="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[11px] font-semibold"><span aria-hidden="true">🎭</span> 지문</span>
                    {:else}<span class="text-foreground font-semibold">{item.block?.character?.name ?? "해설"}</span>{#if item.block?.type === "LYRIC"}<span>♪ 가사</span>{/if}{/if}
                    {#if mine}<span class="text-primary font-semibold">{item.kind === "cue" ? "담당 큐" : "내 대사"}</span>{/if}
                  </p>
                  <p class={["mt-0.5 whitespace-pre-wrap break-words text-base leading-relaxed", item.block?.type === "STAGE_DIRECTION" && "text-muted-foreground italic", item.block?.type === "NOTE" && "text-muted-foreground text-sm"]}>{item.block?.text ?? item.cue?.content}</p>
                  <span class="sr-only">{rowTime(item)} 시점으로 이동</span>
                </div>
                {#if canEdit(item)}<Button variant="outline" class="min-h-9 self-start" onclick={() => openEditor(item)}>시간</Button>{/if}
              </article>
            {/each}
          </div>
          {#if !follow}<button type="button" class="bg-primary text-primary-foreground absolute bottom-3 start-1/2 z-20 min-h-10 -translate-x-1/2 rounded-full px-4 text-sm font-semibold shadow-lg" onclick={() => follow = true}>현재 위치로 따라가기</button>{/if}
        </section>
      </div>
      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {#if sceneSection}
            <section class="bg-card rounded-2xl border p-4">
              <h2 class="text-sm font-bold">{SLOT_LABELS.SCORE}</h2>
              {#if mediaEnabled && scoreClip && signed[scoreClip.media.assetId]}
                {#key scoreClip.media.id}
                  {#if SCORE_IMAGE_MIME.includes(scoreClip.media.asset.mime)}
                    <img
                      src={signed[scoreClip.media.assetId].url}
                      alt="악보 {scoreClip.media.page}쪽"
                      class="mt-2 max-h-[60vh] w-full rounded-lg border object-contain"
                    />
                  {:else}
                    <iframe
                      title="악보 PDF"
                      src={`${signed[scoreClip.media.assetId].url}#page=${scoreClip.media.page}`}
                      class="mt-2 h-[60vh] w-full rounded-lg border"
                    ></iframe>
                  {/if}
                {/key}
                <p class="text-muted-foreground mt-1 text-xs">{assetName(scoreClip.media.asset)} · {scoreClip.media.page}쪽</p>
              {:else}
                <p class="text-muted-foreground mt-2 text-sm">이 장면에는 연결된 악보가 없어요.</p>
              {/if}
            </section>
          {/if}
          <section class="bg-card rounded-2xl border p-4"><h2 class="text-sm font-bold">현재 스태프·배우 행동 큐</h2>{#if activeCues.length === 0}<p class="text-muted-foreground mt-2 text-sm">지금 실행할 큐가 없어요.</p>{/if}{#each activeCues as item (item.id)}<div class={["mt-3 rounded-lg border-t p-2", isMyRehearsalItem(item, myCharacterIds, myTrackIds) && "bg-primary/10"]}><p class="text-primary text-xs font-semibold">{board.tracks.find((track) => track.id === item.cue?.trackId)?.name} · {item.cue?.cueNumber}{isMyRehearsalItem(item, myCharacterIds, myTrackIds) ? " · 내 담당" : ""}</p><p class="mt-1 whitespace-pre-wrap text-sm">{item.cue?.content}</p>{#if item.cue?.trigger}<p class="text-muted-foreground mt-1 text-xs">계기: {item.cue.trigger}</p>{/if}</div>{/each}</section>
          {#if activeLines.some((item) => item.block?.type === "STAGE_DIRECTION")}<section class="bg-card rounded-2xl border p-4"><h2 class="text-sm font-bold">현재 무대 지문</h2>{#each activeLines.filter((item) => item.block?.type === "STAGE_DIRECTION") as item (item.id)}<p class="mt-2 text-sm">{item.block?.text}</p>{/each}</section>{/if}
      </div>
      <RehearsalMemos bind:this={memoComposer} {pid} source={selectedScript} positionMs={nowMs} unitKey={memoUnitKey} unitTitle={memoUnitTitle} onseek={(time) => { playing = false; seek(time); }} onanchor={() => playing = false} onitems={(items) => memos = items} ondirty={(dirty) => memoDirty = dirty} canModerate={board.viewer.canManageTracks} highlightId={$page.url.searchParams.get('memo') ?? ''} />
      <details class="bg-card rounded-2xl border p-4"><summary class="min-h-11 cursor-pointer text-sm font-semibold">내 연습 기록 · 완료 표시 · 이어서 연습</summary><div class="mt-3"><RehearsalRecord {pid} source={selectedScript} positionMs={nowMs} unitKey={selectedScene ? `${fromComposition ? "section" : "scene"}:${selectedScene}` : "overview"} unitTitle={scenes.find((scene) => scene.id === selectedScene)?.title ?? "전체 공연"} onresume={(time) => { playing = false; seek(time); selectedScene = fromComposition ? activeSection(compositionSections, nowMs)?.id ?? "" : timeline.items.find((item) => item.sceneId && item.startMs <= nowMs && nowMs < item.startMs + item.durationMs)?.sceneId ?? ""; }} ondirty={(dirty) => personalDirty = dirty} /></div></details>
      <p class="text-muted-foreground text-sm">공연 전체 흐름을 트랙별로 보려면 <a class="text-primary underline underline-offset-2" href={`/app/p/${pid}/cuesheet`}>큐시트 타임라인</a>에서 확인해 주세요.</p>
    {/if}
    {#if exporting}<TimelineExportDialog source={exportSource} {nowMs} productionTitle={board.production.title} onClose={() => exporting = false} />{/if}
    {#if editing}
      <section class="bg-card fixed inset-x-3 bottom-20 z-40 mx-auto max-h-[78dvh] max-w-lg overflow-y-auto rounded-2xl border p-5 shadow-xl" aria-label="시간표 편집">
        <div class="flex items-center justify-between gap-2"><h2 class="font-bold">{editing.kind === "line" ? "대사" : "큐"} 시간 수정</h2><Button variant="ghost" disabled={saving || uploading} onclick={() => editing = null}>닫기</Button></div>
        <p class="text-muted-foreground mt-2 line-clamp-3 text-sm">{editing.block?.text ?? editing.cue?.content}</p>
        <form class="mt-4 grid gap-4" onsubmit={saveTiming}>
          <label class="grid gap-1 text-sm">시작 시각 · 공연 시작 기준<input class="bg-background min-h-11 rounded-lg border px-3" type="text" inputmode="decimal" placeholder="예: 01:23.500 또는 83.5초 → 83.5" bind:value={startInput} /><span class="text-muted-foreground text-xs">분:초 또는 숫자(초). 비워 두면 자동으로 배치해요.</span></label>
          <label class="grid gap-1 text-sm">길이(초)<input class="bg-background min-h-11 rounded-lg border px-3" type="text" inputmode="decimal" placeholder="빈 값은 자동 길이" bind:value={durationInput} /></label>
          {#if editing.kind === "cue"}<label class="grid gap-1 text-sm">배경 이미지 · 영상 · 음원<select class="bg-background min-h-11 min-w-0 rounded-lg border px-3" bind:value={assetInput}><option value="">연결 없음</option>{#each library as asset (asset.id)}<option value={asset.id}>{asset.kind} · {asset.storageKey.split("/").at(-1)}</option>{/each}</select></label>{#if board.viewer.canManageTracks}<label class="grid gap-1 text-sm">새 미디어 업로드<input class="min-h-11 max-w-full text-sm" type="file" accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime,audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/aac,audio/x-m4a" onchange={upload} disabled={uploading || saving} /><span class="text-muted-foreground text-xs">{uploading ? "업로드 중…" : "PNG·JPG·WebP / MP4·WebM / 음원. 업로드한 뒤 시간표를 저장해야 해요."}</span></label>{/if}{/if}
          <div class="flex gap-2"><Button type="button" variant="outline" class="min-h-11" onclick={() => { startInput = ""; durationInput = ""; }}>자동 배치로</Button><Button type="submit" class="min-h-11 flex-1" disabled={saving || uploading}>{saving ? "저장 중…" : "시간표 저장"}</Button></div>
        </form>
      </section>
    {/if}
  {/if}
</div>

<style>
  .stage-screen:fullscreen, .stage-screen.manual-fullscreen { width: 100vw; height: 100dvh; aspect-ratio: auto; border-radius: 0; padding: 5vh 5vw; }
  .stage-screen:fullscreen p, .stage-screen.manual-fullscreen p { font-size: clamp(24px, 3.4vw, 72px); }
  .stage-screen:fullscreen p span, .stage-screen.manual-fullscreen p span { font-size: clamp(18px, 1.6vw, 36px); }
  .stage-screen.manual-fullscreen { position: fixed; inset: 0; z-index: 50; }
  .stage-screen:fullscreen .stage-context, .stage-screen.manual-fullscreen .stage-context { display: none; }
  .highlighted { outline: 2px solid currentColor; outline-offset: 2px; }
</style>
