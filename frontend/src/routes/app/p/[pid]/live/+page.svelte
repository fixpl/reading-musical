<script lang="ts">
  import { untrack } from "svelte";
  import { page } from "$app/stores";
  import { toast } from "svelte-sonner";
  import { Button } from "$lib/components/ui/button";
  import { apiRequest, uploadSignedObject } from "$lib/api/client";
  import { buildPerformanceTimeline, formatTimelineTime as clock, parseTimelineTime, type TimelineAsset, type TimelineCue, type TimelineItem, type TimelineScene } from "$lib/domain/performance-timeline";
  import { syncMedia } from "$lib/actions/sync-media";
  import { assetName, mediaAt, SLOT_LABELS, type CompositionSection } from "$lib/domain/composition";

  type Board = { production: { id: string; title: string; backgroundAsset?: TimelineAsset | null }; tracks: Array<{ id: string; name: string }>; scenes: TimelineScene[]; cues: TimelineCue[]; viewer: { canManageTracks: boolean; editableTrackIds: string[]; myCharacterIds: string[] } };
  type Signed = { url: string; expiresAt?: string };
  const pid = $derived($page.params.pid ?? "");
  let board = $state<Board | null>(null);
  let loading = $state(true);
  let error = $state("");
  let selectedScript = $state("");
  let selectedScene = $state("");
  let selectedCharacter = $state("");
  let nowMs = $state(0);
  let playing = $state(false);
  let speed = $state(1);
  let repeat = $state(false);
  let sound = $state(false);
  let clockRevision = $state(0);
  let rowLimit = $state(100);
  let signed = $state<Record<string, Signed>>({});
  let mediaError = $state("");
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

  const scripts = $derived([...new Map((board?.scenes ?? []).map((scene) => [scene.act.scriptId ?? "legacy", { id: scene.act.scriptId ?? "legacy", title: scene.act.script?.title ?? "대본" }])).values()]);
  const scenes = $derived((board?.scenes ?? []).filter((scene) => (scene.act.scriptId ?? "legacy") === selectedScript));
  const sceneIds = $derived(new Set(scenes.map((scene) => scene.id)));
  const cues = $derived((board?.cues ?? []).filter((cue) => cue.sceneId === null || sceneIds.has(cue.sceneId)));
  const timeline = $derived(buildPerformanceTimeline(scenes, cues));
  const lines = $derived(timeline.items.filter((item) => item.kind === "line"));
  const characters = $derived([...new Map(lines.flatMap((item) => item.block?.character ? [[item.block.character.id, item.block.character] as const] : [])).values()]);
  const activeLines = $derived(lines.filter((item) => item.startMs <= nowMs && nowMs < item.startMs + item.durationMs));
  const captions = $derived(activeLines.filter((item) => item.block?.type === "DIALOGUE" || item.block?.type === "LYRIC"));
  const nextLine = $derived(lines.find((item) => item.startMs > nowMs && (item.block?.type === "DIALOGUE" || item.block?.type === "LYRIC")));
  const activeCues = $derived(timeline.items.filter((item) => item.kind === "cue" && item.startMs <= nowMs && nowMs < item.startMs + item.durationMs));
  const audioCues = $derived(activeCues.filter((item) => item.cue?.asset?.kind === "AUDIO"));
  const filteredItems = $derived(timeline.items.filter((item) => !selectedScene || item.sceneId === selectedScene));
  const loopRange = $derived({ start: selectedScene && filteredItems.length ? Math.min(...filteredItems.map((item) => item.startMs)) : 0, end: selectedScene && filteredItems.length ? Math.max(...filteredItems.map((item) => item.startMs + item.durationMs)) : timeline.totalMs });
  const estimatedCount = $derived(timeline.items.filter((item) => item.estimated).length);
  const canEdit = (item: TimelineItem) => item.kind === "line" ? Boolean(board?.viewer.canManageTracks) : Boolean(board?.viewer.editableTrackIds.includes(item.cue?.trackId ?? ""));

  // 지금 재생 중인 장면이 장·막 구성에서 가져온 구간이면, 그 구간에 연결된 배경·악보·반주를 함께 보여준다.
  const activeSceneId = $derived(timeline.items.find((item) => item.startMs <= nowMs && nowMs < item.startMs + item.durationMs)?.sceneId ?? null);
  const sceneItems = $derived(activeSceneId ? timeline.items.filter((item) => item.sceneId === activeSceneId) : []);
  const sceneStartMs = $derived(sceneItems.length ? Math.min(...sceneItems.map((item) => item.startMs)) : 0);
  const sceneSection = $derived(activeSceneId ? compositionSections.find((section) => section.sourceSceneId === activeSceneId) ?? null : null);
  const backgroundClip = $derived(sceneSection ? mediaAt(compositionSections, sceneSection, "BACKGROUND", sceneSection.timing.startMs) : null);
  const scoreClip = $derived(sceneSection ? mediaAt(compositionSections, sceneSection, "SCORE", sceneSection.timing.startMs) : null);
  const musicClip = $derived(sceneSection ? mediaAt(compositionSections, sceneSection, "MUSIC", sceneSection.timing.startMs) : null);
  const musicTime = $derived(musicClip ? musicClip.media.sourceStartMs / 1000 + Math.max(0, nowMs - sceneStartMs) / 1000 : 0);
  const SCORE_IMAGE_MIME = ["image/png", "image/jpeg", "image/webp"];

  // 배경은 장·막 구성이 우선, 없으면 기존 큐 배경·공연 기본 배경 순으로 대체한다.
  const visualCue = $derived(activeCues.filter((item) => ["IMAGE", "VIDEO"].includes(item.cue?.asset?.kind ?? "")).at(-1));
  const visual = $derived(backgroundClip?.media.asset ?? visualCue?.cue?.asset ?? board?.production.backgroundAsset ?? null);
  const visualTime = $derived(
    backgroundClip
      ? backgroundClip.media.sourceStartMs / 1000 + Math.max(0, nowMs - sceneStartMs) / 1000
      : Math.max(0, nowMs - (visualCue?.startMs ?? 0)) / 1000
  );

  $effect(() => {
    const id = pid;
    const controller = new AbortController();
    board = null; loading = true; error = ""; playing = false; nowMs = 0; editing = null;
    selectedScript = ""; selectedScene = ""; selectedCharacter = "";
    rowLimit = 100; repeat = false; signed = {}; library = []; mediaError = ""; compositionSections = [];
    void load(id, controller.signal);
    return () => controller.abort();
  });

  async function load(id: string, signal?: AbortSignal) {
    try {
      const result = await apiRequest<Board>(`/productions/${id}/cue-sheet`, { signal });
      if (signal?.aborted || id !== pid) return;
      board = result;
      selectedScript = result.scenes[0]?.act.scriptId ?? "legacy";
      // 내가 캐스팅된 배역이 있으면 자동으로 강조 선택 — 매번 직접 고를 필요가 없도록.
      selectedCharacter = result.viewer.myCharacterIds[0] ?? "";
    } catch (cause) {
      if (!signal?.aborted && id === pid) error = cause instanceof Error ? cause.message : "연습 자료를 불러오지 못했습니다";
    } finally {
      if (!signal?.aborted && id === pid) loading = false;
    }
    // 장·막 구성은 선택적 보강 자료라 실패해도 연습 화면 자체는 그대로 쓸 수 있어야 한다.
    try {
      const composition = await apiRequest<{ sections: CompositionSection[] }>(`/productions/${id}/composition`, { signal });
      if (!signal?.aborted && id === pid) compositionSections = composition.sections;
    } catch {
      /* 장·막 구성 미사용 공연이거나 일시 오류 — 조용히 무시 */
    }
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
    const assetIds = [visual?.id, ...audioCues.map((item) => item.cue?.asset?.id), scoreClip?.media.assetId, musicClip?.media.assetId].filter(
      (id): id is string => Boolean(id)
    );
    for (const id of assetIds) void ensureSigned(id);
  });

  async function ensureSigned(assetId: string) {
    const existing = untrack(() => signed[assetId]);
    if (existing && (!existing.expiresAt || Date.parse(existing.expiresAt) > Date.now() + 30_000)) return;
    if (signing.has(assetId)) return signing.get(assetId);
    const productionId = pid;
    const promise = apiRequest<Signed>(`/assets/${assetId}/url`).then((result) => {
      if (productionId === pid) signed = { ...signed, [assetId]: result };
    }).catch((cause) => {
      if (productionId === pid) { playing = false; mediaError = cause instanceof Error ? cause.message : "미디어 주소를 불러오지 못했습니다"; }
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
    startInput = originalStart == null ? "" : clock(originalStart);
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
        if (productionId === pid && editing?.id === item.id) toast.error(cause instanceof Error ? cause.message : "미디어 목록을 읽지 못했습니다");
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
      if (startMs !== null && seconds !== null && startMs + seconds * 1000 > 86_400_000) throw new Error("종료 시각은 공연 시작 후 24시간 이내여야 합니다");
      saving = true;
      if (item.kind === "line") {
        const durationMs = seconds === null ? null : Math.round(seconds * 1000);
        if (durationMs !== null && durationMs < 1) throw new Error("대사 길이는 최소 0.001초로 입력해 주세요");
        await apiRequest(`/productions/${productionId}/blocks/${item.id}`, { method: "PATCH", body: JSON.stringify({ startMs, durationMs }) });
        if (productionId !== pid || !board) return;
        board = { ...board, scenes: board.scenes.map((scene) => ({ ...scene, blocks: scene.blocks?.map((block) => block.id === item.id ? { ...block, startMs, durationMs } : block) })) };
      } else {
        const updated = await apiRequest<TimelineCue>(`/productions/${productionId}/cue-sheet/cues/${item.id}`, { method: "PATCH", body: JSON.stringify({ startMs, durationSec: seconds, assetId: assetInput || null }) });
        if (productionId !== pid || !board) return;
        board = { ...board, cues: board.cues.map((cue) => cue.id === item.id ? updated : cue) };
      }
      editing = null;
      toast.success("시간표를 저장했습니다");
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "저장하지 못했습니다"); }
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
      toast.success("업로드했습니다. 시간표 저장을 누르면 이 큐에 연결됩니다.");
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "업로드하지 못했습니다"); }
    finally { uploading = false; }
  }
</script>

<svelte:head><title>개인 연습 · 시간표 — {board?.production.title ?? "공연"}</title></svelte:head>

<div class="mx-auto w-full min-w-0 max-w-6xl space-y-5">
  <header class="flex flex-wrap items-start justify-between gap-3">
    <div><p class="text-primary text-xs font-semibold">공연 워크스페이스</p><h1 class="mt-1 text-2xl font-bold">개인 연습 · 시간표</h1><p class="text-muted-foreground mt-1 text-sm">{board?.production.title ?? "대본과 큐 불러오기"}</p></div>
    <div class="flex flex-wrap gap-2"><Button href={`/app/p/${pid}`} variant="outline">공연 홈</Button><Button href={`/app/p/${pid}/cuesheet`} variant="outline">대본 등록 · 큐 편집</Button></div>
  </header>
  {#if loading}<p class="bg-card rounded-2xl border p-8" role="status">연습 자료를 불러오고 있습니다…</p>
  {:else if error}<section class="bg-card rounded-2xl border p-6" role="alert"><p>{error}</p><Button class="mt-4" onclick={() => { loading = true; error = ""; void load(pid); }}>다시 불러오기</Button></section>
  {:else if board}
    <p class="bg-primary/5 text-muted-foreground rounded-xl border p-3 text-sm">내 기기에서만 재생되는 개인 연습 화면입니다.</p>
    <div class="grid gap-3 sm:grid-cols-3">
      <label class="grid gap-1 text-sm font-medium">연습할 대본<select class="bg-background min-h-11 w-full rounded-lg border px-3" value={selectedScript} onchange={(event) => { selectedScript = event.currentTarget.value; selectedScene = ""; selectedCharacter = ""; rowLimit = 100; playing = false; seek(0); editing = null; }}><option value="" disabled>대본 선택</option>{#each scripts as script (script.id)}<option value={script.id}>{script.title}</option>{/each}</select></label>
      <label class="grid gap-1 text-sm font-medium">장면 · 반복 구간<select class="bg-background min-h-11 w-full rounded-lg border px-3" value={selectedScene} onchange={(event) => { selectedScene = event.currentTarget.value; rowLimit = 100; playing = false; const first = timeline.items.find((item) => !selectedScene || item.sceneId === selectedScene); seek(first?.startMs ?? 0); }}><option value="">전체 공연</option>{#each scenes as scene (scene.id)}<option value={scene.id}>{scene.act.title} · {scene.title}</option>{/each}</select></label>
      <label class="grid gap-1 text-sm font-medium">내 배역 강조<select class="bg-background min-h-11 w-full rounded-lg border px-3" bind:value={selectedCharacter}><option value="">모든 배역</option>{#each characters as character (character.id)}<option value={character.id}>{character.name}</option>{/each}</select></label>
    </div>
    {#if timeline.items.length === 0}<section class="bg-card rounded-2xl border p-8 text-center"><h2 class="font-semibold">등록된 대본이나 큐가 없습니다</h2><p class="text-muted-foreground mt-2 text-sm">운영자가 대본과 큐를 등록하면 이 화면에서 연습할 수 있습니다.</p></section>
    {:else}
      <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(260px,1fr)]">
        <section class="min-w-0 space-y-3">
          <div
            bind:this={stage}
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
            {#if visual && signed[visual.id]}
              {#key `${visual.id}:${signed[visual.id].url}`}
                {#if visual.kind === "IMAGE"}<img src={signed[visual.id].url} alt="공연 배경" class="absolute inset-0 h-full w-full object-contain" />
                {:else}<video src={signed[visual.id].url} playsinline preload="auto" class="absolute inset-0 h-full w-full object-contain" use:syncMedia={{ time: visualTime, play: playing, rate: speed, muted: !sound, onError: onMediaError }}><track kind="captions" /></video>{/if}
              {/key}
            {/if}
            <div class="relative z-10 max-h-full space-y-2 overflow-y-auto text-center">
              {#each captions as item (item.id)}<p class="rounded-xl bg-black/85 px-3 py-2 text-lg leading-relaxed sm:text-2xl" class:highlighted={Boolean(selectedCharacter && item.block?.character?.id === selectedCharacter)}><span class="mb-1 block text-xs font-bold sm:text-base">{item.block?.character?.name ?? "해설"}</span>{item.block?.text}</p>{/each}
            </div>
          </div>
          {#each audioCues as item (item.id)}{#if item.cue?.asset && signed[item.cue.asset.id]}<audio src={signed[item.cue.asset.id].url} preload="auto" use:syncMedia={{ time: (nowMs - item.startMs) / 1000, play: playing, rate: speed, muted: !sound, onError: onMediaError }}></audio>{/if}{/each}
          {#if musicClip && signed[musicClip.media.assetId]}
            {#key musicClip.media.id}
              <audio src={signed[musicClip.media.assetId].url} preload="auto" use:syncMedia={{ time: musicTime, play: playing, rate: speed, muted: !sound, onError: onMediaError }}></audio>
            {/key}
          {/if}
          <div class="bg-card space-y-3 rounded-2xl border p-4">
            <div class="flex items-center justify-between gap-3"><output class="font-mono text-sm tabular-nums">{clock(nowMs)} / {clock(timeline.totalMs)}</output><span class="text-muted-foreground text-xs">{playing ? "개인 연습 중" : "일시정지"}</span></div>
            <input class="accent-primary h-8 w-full" type="range" min="0" max={timeline.totalMs} step="100" value={nowMs} oninput={(event) => seek(Number(event.currentTarget.value))} aria-label="공연 시간 이동" />
            <div class="grid grid-cols-3 gap-2"><Button variant="outline" class="min-h-11" onclick={() => step(-1)}>이전 대사</Button><Button class="min-h-11" onclick={togglePlay}>{playing ? "일시정지" : "연습 재생"}</Button><Button variant="outline" class="min-h-11" onclick={() => step(1)}>다음 대사</Button></div>
            <div class="flex flex-wrap items-center gap-3 text-sm"><label class="flex min-h-11 items-center gap-2"><input type="checkbox" bind:checked={repeat} />선택 구간 반복</label><label class="flex min-h-11 items-center gap-2"><input type="checkbox" bind:checked={sound} />미디어 소리</label><label class="ms-auto flex items-center gap-2">속도<select class="bg-background min-h-11 rounded-lg border px-2" bind:value={speed}>{#each [0.5, 0.75, 1, 1.25, 1.5] as rate (rate)}<option value={rate}>{rate}×</option>{/each}</select></label></div>
            <Button variant="outline" class="min-h-11 w-full" onclick={project}>배경 · 대사만 전체화면으로 보기</Button>
            <p class="text-muted-foreground text-xs">전체화면에는 배경과 대사·가사만 표시됩니다.</p>
          </div>
          {#if mediaError}<p role="alert" class="text-destructive rounded-xl border p-3 text-sm">{mediaError}</p>{/if}
        </section>
        <aside class="space-y-3">
          <section class="bg-card rounded-2xl border p-4"><h2 class="text-sm font-bold">다음 대사</h2>{#if nextLine}<p class="text-primary mt-2 text-xs">{clock(nextLine.startMs)} · {nextLine.block?.character?.name ?? "해설"}</p><p class="mt-2 whitespace-pre-wrap text-base leading-relaxed">{nextLine.block?.text}</p>{:else}<p class="text-muted-foreground mt-2 text-sm">다음 대사가 없습니다.</p>{/if}</section>
          {#if sceneSection}
            <section class="bg-card rounded-2xl border p-4">
              <h2 class="text-sm font-bold">{SLOT_LABELS.SCORE}</h2>
              {#if scoreClip && signed[scoreClip.media.assetId]}
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
                <p class="text-muted-foreground mt-2 text-sm">이 장면에 지정된 악보가 없습니다.</p>
              {/if}
            </section>
          {/if}
          <section class="bg-card rounded-2xl border p-4"><h2 class="text-sm font-bold">현재 스태프 · 배우 행동 큐</h2>{#if activeCues.length === 0}<p class="text-muted-foreground mt-2 text-sm">현재 실행할 큐가 없습니다.</p>{/if}{#each activeCues as item (item.id)}<div class="mt-3 border-t pt-3"><p class="text-primary text-xs font-semibold">{board.tracks.find((track) => track.id === item.cue?.trackId)?.name} · {item.cue?.cueNumber}</p><p class="mt-1 whitespace-pre-wrap text-sm">{item.cue?.content}</p>{#if item.cue?.trigger}<p class="text-muted-foreground mt-1 text-xs">계기: {item.cue.trigger}</p>{/if}</div>{/each}</section>
          {#if activeLines.some((item) => item.block?.type === "STAGE_DIRECTION")}<section class="bg-card rounded-2xl border p-4"><h2 class="text-sm font-bold">현재 무대 지문</h2>{#each activeLines.filter((item) => item.block?.type === "STAGE_DIRECTION") as item (item.id)}<p class="mt-2 text-sm">{item.block?.text}</p>{/each}</section>{/if}
        </aside>
      </div>
      <section class="bg-card overflow-hidden rounded-2xl border">
        <header class="flex flex-wrap items-center justify-between gap-2 border-b p-4"><h2 class="font-bold">대사 · 큐 시간표</h2><span class="text-muted-foreground text-xs">{filteredItems.length}개 항목 · 자동/추정 {estimatedCount}개</span><p class="text-muted-foreground w-full text-xs">시간이 지정되지 않은 항목은 자동으로 배치됩니다. 시간 수정으로 시작·길이를 지정할 수 있습니다.</p></header>
        <div class="divide-y">{#each filteredItems.slice(0, rowLimit) as item (item.id)}<article class="grid min-w-0 gap-2 p-4 sm:grid-cols-[105px_minmax(0,1fr)_auto]" class:bg-muted={item.startMs <= nowMs && nowMs < item.startMs + item.durationMs}><button class="text-primary min-h-11 text-start font-mono text-sm" onclick={() => seek(item.startMs)} aria-label={`${clock(item.startMs)} 시점으로 이동`}>{clock(item.startMs)}</button><div class="min-w-0"><p class="text-muted-foreground text-xs">{item.sceneTitle} · {item.kind === "cue" ? `${item.cue?.cueNumber} · ${board.tracks.find((track) => track.id === item.cue?.trackId)?.name ?? "큐"}` : item.block?.character?.name ?? "지문/메모"}{item.estimated ? " · 자동/추정" : " · 시간 지정"}</p><p class="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">{item.block?.text ?? item.cue?.content}</p><p class="text-muted-foreground mt-1 text-xs">길이 {item.durationMs / 1000}초{item.cue?.asset ? ` · ${item.cue.asset.kind === "IMAGE" ? "배경 이미지" : item.cue.asset.kind === "VIDEO" ? "영상" : "음원"} 연결됨` : ""}</p></div>{#if canEdit(item)}<Button variant="outline" class="min-h-11 self-start" onclick={() => openEditor(item)}>시간 수정</Button>{/if}</article>{/each}</div>
        {#if filteredItems.length > rowLimit}<div class="border-t p-3"><Button variant="outline" class="min-h-11 w-full" onclick={() => rowLimit += 100}>다음 100개 보기</Button></div>{/if}
      </section>
    {/if}
    {#if editing}
      <section class="bg-card fixed inset-x-3 bottom-20 z-40 mx-auto max-h-[78dvh] max-w-lg overflow-y-auto rounded-2xl border p-5 shadow-xl" aria-label="시간표 편집">
        <div class="flex items-center justify-between gap-2"><h2 class="font-bold">{editing.kind === "line" ? "대사" : "큐"} 시간 수정</h2><Button variant="ghost" disabled={saving || uploading} onclick={() => editing = null}>닫기</Button></div>
        <p class="text-muted-foreground mt-2 line-clamp-3 text-sm">{editing.block?.text ?? editing.cue?.content}</p>
        <form class="mt-4 grid gap-4" onsubmit={saveTiming}>
          <label class="grid gap-1 text-sm">시작 시각 · 공연 시작 기준<input class="bg-background min-h-11 rounded-lg border px-3" type="text" inputmode="decimal" placeholder="예: 01:23.500 또는 83.5초 → 83.5" bind:value={startInput} /><span class="text-muted-foreground text-xs">분:초 또는 숫자(초). 빈 값은 자동 배치입니다.</span></label>
          <label class="grid gap-1 text-sm">길이(초)<input class="bg-background min-h-11 rounded-lg border px-3" type="text" inputmode="decimal" placeholder="빈 값은 자동 길이" bind:value={durationInput} /></label>
          {#if editing.kind === "cue"}<label class="grid gap-1 text-sm">배경 이미지 · 영상 · 음원<select class="bg-background min-h-11 min-w-0 rounded-lg border px-3" bind:value={assetInput}><option value="">연결 없음</option>{#each library as asset (asset.id)}<option value={asset.id}>{asset.kind} · {asset.storageKey.split("/").at(-1)}</option>{/each}</select></label>{#if board.viewer.canManageTracks}<label class="grid gap-1 text-sm">새 미디어 업로드<input class="min-h-11 max-w-full text-sm" type="file" accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime,audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/aac,audio/x-m4a" onchange={upload} disabled={uploading || saving} /><span class="text-muted-foreground text-xs">{uploading ? "업로드 중…" : "PNG·JPG·WebP / MP4·WebM / 음원. 업로드 후 시간표 저장이 필요합니다."}</span></label>{/if}{/if}
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
  .highlighted { outline: 2px solid currentColor; outline-offset: 2px; }
</style>
