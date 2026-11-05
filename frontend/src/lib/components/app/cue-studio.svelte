<script lang="ts">
  import { onDestroy } from "svelte";
  import PlayIcon from "@lucide/svelte/icons/play";
  import PauseIcon from "@lucide/svelte/icons/pause";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import XIcon from "@lucide/svelte/icons/x";
  import MonitorPlayIcon from "@lucide/svelte/icons/monitor-play";
  import SkipBackIcon from "@lucide/svelte/icons/skip-back";
  import { findScriptAnchorIndex, formatMinutesAsClock } from "./cue-studio-text.util";

  type Track = {
    id: string;
    name: string;
    order: number;
    ownerMembership: { id: string; user: { id: string; name: string } } | null;
  };

  type Cue = {
    id: string;
    trackId: string;
    cueNumber: string;
    trigger: string | null;
    content: string;
    note: string | null;
    sceneId: string | null;
    character?: { id: string; name: string } | null;
    durationSec?: number | null;
    startMs?: number | null;
  };

  type ScriptBlock = {
    id: string;
    type: "DIALOGUE" | "LYRIC" | "STAGE_DIRECTION" | "NOTE" | string;
    text: string;
    order: number;
    startMs?: number | null;
    durationMs?: number | null;
    character: { id: string; name: string } | null;
  };
  type Scene = {
    id: string;
    title: string;
    order: number;
    summary?: string | null;
    act: { id: string; title: string; order: number };
    blocks?: ScriptBlock[];
  };

  type BackgroundVideo = {
    url: string;
    mime: string;
  };

  let {
    scenes,
    tracks,
    cues,
    editableTrackIds = [],
    background = null,
    canEditScript = false,
    onEditCue,
    onAddCue,
    onOpenScript,
    onDeleteCue,
    onResizeCue,
    onReorderCue,
    onMoveCue,
    onMoveBlock
  }: {
    scenes: Scene[];
    tracks: Track[];
    cues: Cue[];
    editableTrackIds?: string[];
    background?: BackgroundVideo | null;
    canEditScript?: boolean;
    onEditCue?: (cueId: string) => void;
    onAddCue?: (trackId: string, sceneId: string | null) => void;
    onOpenScript?: (sceneId: string | null) => void;
    onDeleteCue?: (cueId: string) => void;
    onResizeCue?: (cueId: string, durationSec: number) => void;
    onReorderCue?: (cueId: string, sceneId: string | null, orderedTrackCueIds: string[]) => void;
    onMoveCue?: (cueId: string, startMs: number) => void;
    onMoveBlock?: (blockId: string, startMs: number | null, durationMs: number | null) => void;
  } = $props();

  // 목업(큐시트 스튜디오)의 부서 팔레트 — 표준 트랙은 고정색, 나머지는 순환
  const COLOR_BY_NAME: Record<string, string> = {
    해설: "#7c3aed",
    배우: "#2563eb",
    음악: "#d97706",
    효과음: "#0d9488",
    영상: "#db2777",
    조명: "#65a30d"
  };
  const FALLBACK_COLORS = ["#7c3aed", "#2563eb", "#d97706", "#0d9488", "#db2777", "#65a30d", "#dc2626", "#0891b2"];

  const PXM = 48; // px per (가상)분 — 짧은 큐 번호도 겹치지 않게 충분한 가로 폭을 확보한다.
  const LABEL_W = 104;

  const trackColor = $derived.by(() => {
    const map = new Map<string, string>();
    tracks.forEach((track, index) => {
      map.set(track.id, COLOR_BY_NAME[track.name] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length]);
    });
    return map;
  });

  type Segment = {
    id: string;
    title: string;
    actId: string;
    actTitle: string;
    summary: string | null;
    start: number;
    dur: number;
    cues: Cue[];
    firstQ: string;
    blocks: ScriptBlock[];
  };

  // 큐마다 예상 길이(초)를 쓸 수 있다 — 미입력은 30초로 계산 (QLab식 duration).
  const DEFAULT_CUE_SEC = 30;
  // 아주 짧은 큐도 선택 영역과 번호가 겹치지 않도록 타임라인에서는 최소 한 칸을 확보한다.
  const MIN_CUE_SLOT_SEC = 30;
  // 드래그로 길이 조절 중인 큐는 미리보기 길이를 쓴다(놓을 때 저장).
  let resizePreview = $state<{ id: string; sec: number } | null>(null);
  const effSec = (cue: Cue) => (resizePreview?.id === cue.id ? resizePreview.sec : (cue.durationSec ?? DEFAULT_CUE_SEC));
  const layoutSec = (cue: Cue) => Math.max(MIN_CUE_SLOT_SEC, effSec(cue));

  // 장면 = 구간. 장면 길이는 부서(트랙)별 큐 길이 합 중 최댓값 — 트랙은 병렬로 진행되므로 가장 긴 트랙이 장면 길이를 정한다.
  const segments = $derived.by<Segment[]>(() => {
    const bySceneCues = new Map<string, Cue[]>();
    for (const cue of cues) {
      const key = cue.sceneId ?? "__none";
      if (!bySceneCues.has(key)) bySceneCues.set(key, []);
      bySceneCues.get(key)!.push(cue);
    }
    const list: Segment[] = [];
    let cursor = 0;
    const push = (
      id: string,
      title: string,
      actId: string,
      actTitle: string,
      summary: string | null,
      blocks: ScriptBlock[]
    ) => {
      const segCues = bySceneCues.get(id) ?? [];
      const perTrackSec = new Map<string, number>();
      for (const cue of segCues) {
        perTrackSec.set(cue.trackId, (perTrackSec.get(cue.trackId) ?? 0) + layoutSec(cue));
      }
      const sceneSec = Math.max(DEFAULT_CUE_SEC, ...perTrackSec.values());
      const dur = Math.max(0.5, sceneSec / 60);
      list.push({ id, title, actId, actTitle, summary, start: cursor, dur, cues: segCues, firstQ: segCues[0]?.cueNumber ?? "—", blocks });
      cursor += dur;
    };
    for (const scene of scenes) {
      push(scene.id, scene.title, scene.act.id, scene.act.title, scene.summary ?? null, scene.blocks ?? []);
    }
    if (bySceneCues.has("__none")) {
      push("__none", "장면 미지정", "__none", "", null, []);
    }
    return list;
  });

  const segmentsTotal = $derived(segments.reduce((sum, seg) => sum + seg.dur, 0));

  // ── 대본 블록 타임라인 — 블록마다 시작/길이(ms)를 명시하면 배경 영상 기준 그 시각에 놓인다.
  // 미지정 블록은 앞 블록 끝에 이어붙이는 자동 흐름 배치(점선으로 표시).
  const DEFAULT_BLOCK_MS = 8000;
  const BLOCK_COLORS: Record<string, string> = {
    DIALOGUE: "#2563eb",
    LYRIC: "#d97706",
    STAGE_DIRECTION: "#6b7280",
    NOTE: "#7c3aed"
  };

  type BlockClip = {
    block: ScriptBlock;
    sceneTitle: string;
    actTitle: string;
    startMs: number;
    durationMs: number;
    timed: boolean;
  };

  // 드래그·리사이즈 중인 블록은 미리보기 값을 쓴다(놓을 때 저장).
  let blockResizePreview = $state<{ id: string; ms: number } | null>(null);

  const blockClips = $derived.by<BlockClip[]>(() => {
    const list: BlockClip[] = [];
    let cursorMs = 0;
    for (const scene of scenes) {
      for (const block of scene.blocks ?? []) {
        const timed = block.startMs != null;
        const startMs = timed ? block.startMs! : cursorMs;
        const durationMs =
          blockResizePreview?.id === block.id ? blockResizePreview.ms : (block.durationMs ?? DEFAULT_BLOCK_MS);
        list.push({ block, sceneTitle: scene.title, actTitle: scene.act.title, startMs, durationMs, timed });
        cursorMs = Math.max(cursorMs, startMs + durationMs);
      }
    }
    return list;
  });

  const blockEndMin = $derived(blockClips.reduce((end, clip) => Math.max(end, (clip.startMs + clip.durationMs) / 60000), 0));

  // 시작 시각이 지정된 큐도 실제 시간 눈금에 놓이므로 전체 길이 계산에 포함한다.
  const cueEndMin = $derived(
    cues.reduce((end, cue) => (cue.startMs != null ? Math.max(end, (cue.startMs + effSec(cue) * 1000) / 60000) : end), 0)
  );

  // ── 배경 영상 — 연결되면 영상이 재생의 기준 시계가 된다(실시간 고정).
  let videoEl = $state<HTMLVideoElement | null>(null);
  let videoDurationSec = $state<number | null>(null);
  let videoMuted = $state(true);

  const total = $derived(
    Math.max(segmentsTotal, blockEndMin, cueEndMin, background && videoDurationSec ? videoDurationSec / 60 : 0)
  );

  const actBands = $derived.by(() => {
    const bands: Array<{ actId: string; title: string; start: number; end: number }> = [];
    for (const seg of segments) {
      const last = bands[bands.length - 1];
      if (last && last.actId === seg.actId) last.end = seg.start + seg.dur;
      else bands.push({ actId: seg.actId, title: seg.actTitle || seg.title, start: seg.start, end: seg.start + seg.dur });
    }
    return bands;
  });

  // ── 상태 ──
  let time = $state(0);
  let playing = $state(false);
  let speed = $state(20);
  let role = $state("all"); // "all" | trackId
  let selectedCueId = $state<string | null>(null);
  // 대본 레인에서 선택한 블록 — 인스펙터에서 시작/길이를 직접 고칠 수 있다.
  let selectedBlockId = $state<string | null>(null);
  let blockStartSec = $state("");
  let blockDurSec = $state("");
  let fullScriptSceneId = $state<string | null>(null);
  // 발표(진행) 모드 — PPT 슬라이드 쇼처럼 전체 화면으로 크게 보면서 재생만 한다.
  let presenting = $state(false);
  let scroller = $state<HTMLDivElement | null>(null);
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastWall = 0;

  // 트랙 담당자(비제작진)는 처음부터 자기 트랙 보기로 시작한다.
  $effect(() => {
    if (editableTrackIds.length === 1 && tracks.length > 1 && role === "all") {
      role = editableTrackIds[0];
    }
  });

  const currentSeg = $derived(segments.reduce((cur, seg) => (time >= seg.start ? seg : cur), segments[0]));
  const selectedCue = $derived(selectedCueId ? (cues.find((cue) => cue.id === selectedCueId) ?? null) : null);
  const selectedTrack = $derived(selectedCue ? (tracks.find((track) => track.id === selectedCue.trackId) ?? null) : null);
  const selectedBlockClip = $derived(
    selectedBlockId ? (blockClips.find((clip) => clip.block.id === selectedBlockId) ?? null) : null
  );
  const editableSet = $derived(new Set(editableTrackIds));

  // 배경 영상이 연결되면 영상 시간이 곧 타임라인 시간이라 배속은 실시간으로 고정한다.
  $effect(() => {
    if (background && speed !== 1) speed = 1;
  });

  // 선택한 블록의 현재 타이밍을 편집 폼에 채운다.
  $effect(() => {
    if (selectedBlockClip) {
      blockStartSec = String(Math.round(selectedBlockClip.startMs / 100) / 10);
      blockDurSec = String(Math.round(selectedBlockClip.durationMs / 100) / 10);
    }
  });

  const fmt = formatMinutesAsClock;

  function segCue(seg: Segment | undefined, trackName: string) {
    if (!seg) return null;
    const track = tracks.find((item) => item.name === trackName);
    if (!track) return null;
    const clips = clipsFor(track.id, seg);
    const playheadPx = time * PXM;
    return [...clips].reverse().find((clip) => clip.left <= playheadPx + 0.5)?.cue ?? clips[0]?.cue ?? null;
  }

  const stageNar = $derived(segCue(currentSeg, "해설"));
  const stageAct = $derived(segCue(currentSeg, "배우"));
  const stageSong = $derived(segCue(currentSeg, "음악"));
  const stageScriptExpanded = $derived(fullScriptSceneId === currentSeg?.id);

  const scriptAnchorIndex = findScriptAnchorIndex;

  const stageScriptBlocks = $derived.by(() => {
    const blocks = currentSeg?.blocks ?? [];
    if (stageScriptExpanded || blocks.length <= 5) return blocks;
    const cue = selectedCue?.sceneId === currentSeg?.id ? selectedCue : null;
    const anchor = scriptAnchorIndex(blocks, cue);
    const start = anchor < 0 ? 0 : Math.max(0, Math.min(blocks.length - 5, anchor - 2));
    return blocks.slice(start, start + 5);
  });

  const nextMine = $derived.by(() => {
    if (role === "all" || !currentSeg) return null;
    return segments.find((seg) => seg.start > currentSeg.start && seg.cues.some((cue) => cue.trackId === role)) ?? null;
  });

  function clipsFor(trackId: string, seg: Segment, characterId?: string | null) {
    const list = seg.cues.filter((cue) => cue.trackId === trackId);
    if (list.length === 0) return [];
    // 먼저 트랙 전체 순서로 위치를 계산한 뒤 인물별로 거른다.
    // 그래야 인물 레인을 펼쳐도 각 큐가 장면 시작점으로 몰리지 않고 원래 순서를 유지한다.
    // 시작 시각(startMs)이 지정된 큐는 대본 블록과 같은 실제 시간 눈금에 놓고,
    // 미지정 큐는 앞 큐 끝에 이어붙인다(점선으로 표시).
    let cursorMin = 0;
    const clips = list.map((cue) => {
      const timed = cue.startMs != null && Number.isFinite(cue.startMs);
      const leftMin = timed ? cue.startMs! / 60000 : seg.start + cursorMin;
      const clip = {
        cue,
        timed,
        left: leftMin * PXM,
        width: Math.max(21, (effSec(cue) / 60) * PXM - 3)
      };
      cursorMin = Math.max(cursorMin, leftMin + layoutSec(cue) / 60 - seg.start);
      return clip;
    });
    return characterId === undefined
      ? clips
      : clips.filter((clip) => (clip.cue.character?.id ?? null) === characterId);
  }

  // 인물 서브레인 — 배우처럼 여러 사람이 동시에 움직이는 트랙을 인물별 줄로 펼친다.
  let expandedTracks = $state<Set<string>>(new Set());

  function toggleTrackExpand(trackId: string) {
    const next = new Set(expandedTracks);
    if (next.has(trackId)) next.delete(trackId);
    else next.add(trackId);
    expandedTracks = next;
  }

  function charactersOf(trackId: string) {
    const seen = new Map<string, string>();
    let untagged = false;
    for (const cue of cues) {
      if (cue.trackId !== trackId) continue;
      if (cue.character) seen.set(cue.character.id, cue.character.name);
      else untagged = true;
    }
    const list = [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "ko"));
    return { list, untagged };
  }

  // ── 재생 — 탭이 가려져도 진행되도록 rAF 대신 interval 시계를 쓴다 ──
  // 배경 영상이 있으면 영상이 기준 시계: 재생/정지·시킹을 영상과 맞추고 시간은 영상에서 읽는다.
  function setPlaying(next: boolean) {
    playing = next;
    if (next) {
      if (time >= total) time = 0;
      if (background && videoEl) {
        videoEl.currentTime = Math.min(time * 60, Math.max(0, (videoDurationSec ?? time * 60) - 0.05));
        videoEl.playbackRate = 1;
        void videoEl.play().catch(() => {
          setPlaying(false);
        });
        timer = setInterval(() => {
          if (!videoEl) return;
          time = videoEl.currentTime / 60;
          if (videoEl.ended || time >= total) {
            time = Math.min(time, total);
            setPlaying(false);
            return;
          }
          scrollToPlayhead();
        }, 100);
        return;
      }
      lastWall = Date.now();
      timer = setInterval(() => {
        const now = Date.now();
        time += ((now - lastWall) / 1000 / 60) * speed;
        lastWall = now;
        if (time >= total) {
          time = total;
          setPlaying(false);
          return;
        }
        scrollToPlayhead();
      }, 100);
    } else {
      videoEl?.pause();
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }
  }

  function scrollToPlayhead() {
    if (!scroller) return;
    const x = LABEL_W + time * PXM;
    const vis = scroller.scrollLeft;
    const w = scroller.clientWidth;
    if (x < vis + LABEL_W + 40 || x > vis + w - 80) {
      scroller.scrollLeft = x - w * 0.35;
    }
  }

  // ── 시킹(눈금·막 밴드 드래그) ──
  let scrubbing = false;
  function seekFromEvent(event: PointerEvent, target: HTMLElement) {
    const inner = target.closest("[data-tl-inner]") as HTMLElement | null;
    if (!inner) return;
    const rect = inner.getBoundingClientRect();
    const x = event.clientX - rect.left - LABEL_W;
    time = Math.min(total, Math.max(0, x / PXM));
    if (background && videoEl) {
      videoEl.currentTime = time * 60;
    }
    selectedCueId = null;
    selectedBlockId = null;
  }
  function scrubDown(event: PointerEvent) {
    scrubbing = true;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    seekFromEvent(event, event.currentTarget as HTMLElement);
  }
  function scrubMove(event: PointerEvent) {
    if (scrubbing) seekFromEvent(event, event.currentTarget as HTMLElement);
  }
  function scrubUp() {
    scrubbing = false;
  }

  function jumpToSeg(seg: Segment) {
    time = seg.start + 0.001;
    selectedCueId = null;
    setPlaying(false);
    scrollToPlayhead();
  }

  function pickCue(cue: Cue, seg: Segment) {
    selectedCueId = cue.id;
    selectedBlockId = null;
    const clip = clipsFor(cue.trackId, seg).find((item) => item.cue.id === cue.id);
    time = clip ? clip.left / PXM + 0.001 : seg.start + 0.001;
    setPlaying(false);
    scrollToPlayhead();
  }

  // ── 대본 블록 선택·드래그·리사이즈 — 영상 편집기처럼 블록을 끌어 배치를 바꾼다 ──
  function pickBlock(clip: BlockClip) {
    selectedBlockId = clip.block.id;
    selectedCueId = null;
    time = clip.startMs / 60000 + 0.001;
    if (background && videoEl) {
      videoEl.currentTime = time * 60;
    }
    setPlaying(false);
    scrollToPlayhead();
  }

  const canEditBlocks = $derived(canEditScript && !!onMoveBlock);

  let blockDrag = $state<{ blockId: string; startX: number; dx: number; leftMs: number; moved: boolean } | null>(null);

  function blockDragStart(event: PointerEvent, clip: BlockClip) {
    if (!canEditBlocks) return;
    blockDrag = { blockId: clip.block.id, startX: event.clientX, dx: 0, leftMs: clip.startMs, moved: false };
    try {
      (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    } catch {
      /* capture 불가 환경 무시 */
    }
  }
  function blockDragMove(event: PointerEvent) {
    if (!blockDrag) return;
    const dx = event.clientX - blockDrag.startX;
    blockDrag = { ...blockDrag, dx, moved: blockDrag.moved || Math.abs(dx) > 3 };
  }
  function blockDragEnd(event: PointerEvent, clip: BlockClip) {
    if (!blockDrag) return;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    const d = blockDrag;
    blockDrag = null;
    if (!d.moved) {
      pickBlock(clip); // 거의 안 움직였으면 클릭(선택)
      return;
    }
    const startMs = Math.max(0, Math.round((d.leftMs + (d.dx * 60000) / PXM) / 500) * 500); // 0.5초 스냅
    onMoveBlock?.(d.blockId, startMs, clip.durationMs);
  }

  let blockResizing: { blockId: string; startX: number; startMs: number } | null = null;

  function blockResizeStart(event: PointerEvent, clip: BlockClip) {
    if (!canEditBlocks) return;
    event.stopPropagation();
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    blockResizing = { blockId: clip.block.id, startX: event.clientX, startMs: clip.durationMs };
    blockResizePreview = { id: clip.block.id, ms: clip.durationMs };
  }
  function blockResizeMove(event: PointerEvent) {
    if (!blockResizing) return;
    const dMs = ((event.clientX - blockResizing.startX) * 60000) / PXM;
    const ms = Math.round(Math.min(3600_000, Math.max(1000, blockResizing.startMs + dMs)) / 500) * 500;
    blockResizePreview = { id: blockResizing.blockId, ms };
  }
  function blockResizeEnd(event: PointerEvent, clip: BlockClip) {
    if (!blockResizing) return;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    const ms = blockResizePreview?.ms ?? null;
    const changed = ms != null && ms !== blockResizing.startMs;
    const blockId = blockResizing.blockId;
    blockResizing = null;
    blockResizePreview = null;
    if (changed && ms != null) {
      // 시작이 자동(미지정)이면 현재 보이는 시작을 명시값으로 함께 고정한다.
      const startMs = clip.block.startMs ?? clip.startMs;
      onMoveBlock?.(blockId, startMs, ms);
    }
  }

  function saveBlockTiming() {
    if (!selectedBlockClip) return;
    const start = Number.parseFloat(blockStartSec);
    const dur = Number.parseFloat(blockDurSec);
    if (!Number.isFinite(start) || start < 0) return;
    const startMs = Math.round(start * 1000);
    const durationMs = Number.isFinite(dur) && dur >= 1 ? Math.round(dur * 1000) : selectedBlockClip.durationMs;
    onMoveBlock?.(selectedBlockClip.block.id, startMs, durationMs);
  }

  function clearBlockTiming() {
    if (!selectedBlockClip) return;
    onMoveBlock?.(selectedBlockClip.block.id, null, null);
  }

  // 영상 편집기처럼 — 빈 레인을 누르면 그 위치의 장면·트랙에 새 큐를 만든다.
  function laneClick(event: MouseEvent, trackId: string) {
    if (!onAddCue || !editableSet.has(trackId)) return;
    if ((event.target as HTMLElement).closest("button")) return;
    const body = event.currentTarget as HTMLElement;
    const x = event.clientX - body.getBoundingClientRect().left;
    const t = Math.min(total, Math.max(0, x / PXM));
    const seg = segments.reduce((cur, item) => (t >= item.start ? item : cur), segments[0]);
    onAddCue(trackId, seg && seg.id !== "__none" ? seg.id : null);
  }

  // 클립 오른쪽 끝을 잡고 끌어 큐 길이(durationSec)를 바꾼다 — 영상 편집 타임라인처럼.
  let resizing: { cueId: string; startX: number; startSec: number } | null = null;

  function resizeStart(event: PointerEvent, cue: Cue) {
    if (!onResizeCue) return;
    event.stopPropagation();
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    resizing = { cueId: cue.id, startX: event.clientX, startSec: effSec(cue) };
    resizePreview = { id: cue.id, sec: resizing.startSec };
  }
  function resizeMove(event: PointerEvent) {
    if (!resizing) return;
    const dSec = ((event.clientX - resizing.startX) * 60) / PXM; // px → 초
    const sec = Math.round(Math.min(3600, Math.max(5, resizing.startSec + dSec)) / 5) * 5; // 5초 단위 스냅
    resizePreview = { id: resizing.cueId, sec };
  }
  function resizeEnd(event: PointerEvent) {
    if (!resizing) return;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    const cueId = resizing.cueId;
    const sec = resizePreview?.sec ?? null;
    const changed = sec != null && sec !== resizing.startSec;
    resizing = null;
    resizePreview = null;
    if (changed && sec != null) onResizeCue?.(cueId, sec);
  }

  // 클립을 끌어 위치를 바꾼다 — 시간 지정 큐는 시작 시각(startMs)을, 미지정 큐는 순서를 바꾼다.
  let clipDrag = $state<{ cueId: string; trackId: string; startX: number; dx: number; left: number; width: number; moved: boolean } | null>(null);

  function clipDragStart(event: PointerEvent, cue: Cue, left: number, width: number) {
    if (!editableSet.has(cue.trackId)) return;
    if (cue.startMs != null ? !onMoveCue : !onReorderCue) return;
    clipDrag = { cueId: cue.id, trackId: cue.trackId, startX: event.clientX, dx: 0, left, width, moved: false };
    try {
      (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    } catch {
      /* 일부 환경/합성 이벤트에서 capture 불가 — 무시 */
    }
  }
  function clipDragMove(event: PointerEvent) {
    if (!clipDrag) return;
    const dx = event.clientX - clipDrag.startX;
    clipDrag = { ...clipDrag, dx, moved: clipDrag.moved || Math.abs(dx) > 3 };
  }
  function clipDragEnd(event: PointerEvent, cue: Cue, seg: Segment) {
    if (!clipDrag) return;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    const d = clipDrag;
    clipDrag = null;
    if (!d.moved) {
      pickCue(cue, seg); // 거의 안 움직였으면 클릭(선택)으로 처리
      return;
    }
    // 시간 지정 큐는 놓은 위치가 곧 시작 시각 — 5초 단위로 맞춰 저장한다.
    if (cue.startMs != null && onMoveCue) {
      const minutes = Math.max(0, (d.left + d.dx) / PXM);
      const startMs = Math.round((minutes * 60) / 5) * 5 * 1000;
      onMoveCue(cue.id, startMs);
      return;
    }
    // 이 트랙의 모든 클립 위치를 모아, 끈 클립은 새 위치로 두고 왼쪽 기준으로 다시 정렬 → 새 순서.
    const positions: { cueId: string; left: number }[] = [];
    for (const s of segments) {
      for (const clip of clipsFor(d.trackId, s)) {
        positions.push({ cueId: clip.cue.id, left: clip.cue.id === d.cueId ? d.left + d.dx : clip.left });
      }
    }
    const center = (d.left + d.dx + d.width / 2) / PXM;
    const segAt = segments.reduce((cur, item) => (center >= item.start ? item : cur), segments[0]);
    const newSceneId = segAt && segAt.id !== "__none" ? segAt.id : null;
    positions.sort((a, b) => a.left - b.left);
    onReorderCue?.(d.cueId, newSceneId, positions.map((p) => p.cueId));
  }

  function onKeydown(event: KeyboardEvent) {
    // 스페이스 = 재생/멈춤 토글. 입력 요소에서만 무시.
    const tag = (event.target as HTMLElement).tagName;
    if (event.code === "Space" && !/^(input|textarea|select)$/i.test(tag) && !(event.target as HTMLElement).isContentEditable) {
      event.preventDefault();
      // 포커스된 버튼(큐 클립·재생 버튼)이 스페이스로 네이티브 재활성화돼 토글이 상쇄되는 것을 막는다.
      (document.activeElement as HTMLElement | null)?.blur?.();
      setPlaying(!playing);
    }
    if (event.key === "Escape" && presenting) {
      stopPresenting();
    }
    if (presenting && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
      event.preventDefault();
      const index = segments.findIndex((seg) => seg.id === currentSeg?.id);
      const next = segments[index + (event.key === "ArrowRight" ? 1 : -1)];
      if (next) jumpToSeg(next);
    }
  }

  function startPresenting() {
    presenting = true;
    selectedCueId = null;
    document.documentElement.requestFullscreen?.().catch(() => {});
  }

  function stopPresenting() {
    presenting = false;
    setPlaying(false);
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }
  }

  function onFullscreenChange() {
    // 브라우저 ESC로 전체 화면이 풀리면 발표 모드도 함께 닫는다.
    if (!document.fullscreenElement && presenting) {
      presenting = false;
      setPlaying(false);
    }
  }

  onDestroy(() => {
    if (timer) clearInterval(timer);
    videoEl?.pause();
  });

  const ticks = $derived.by(() => {
    const list: number[] = [];
    for (let m = 0; m <= Math.floor(total); m += 2) list.push(m);
    return list;
  });
</script>

<svelte:window onkeydown={onKeydown} onfullscreenchange={onFullscreenChange} />

{#if segments.length === 0}
  <div class="bg-card rounded-2xl px-6 py-14 text-center">
    <p class="font-semibold">타임라인에 표시할 큐가 없습니다</p>
    <p class="text-muted-foreground mt-1 text-sm">큐를 등록하면 장면 순서대로 배치됩니다.</p>
  </div>
{:else}
  <div class="grid gap-2.5">
    <!-- 보기(역할) 스위치 -->
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-muted-foreground text-xs font-medium">트랙 강조</span>
      <button
        type="button"
        class="border-input hover:bg-accent order-last ms-auto inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors"
        onclick={startPresenting}
      >
        <MonitorPlayIcon class="size-3.5" />
        진행 시작
      </button>
      <div class="bg-muted flex flex-wrap rounded-lg p-0.5">
        <button
          type="button"
          class="rounded-md px-2.5 py-1 text-xs font-medium transition-colors {role === 'all'
            ? 'bg-background shadow-sm'
            : 'text-muted-foreground hover:text-foreground'}"
          aria-pressed={role === "all"}
          onclick={() => (role = "all")}
        >
          전체 트랙
        </button>
        {#each tracks as track (track.id)}
          <button
            type="button"
            class="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors {role === track.id
              ? 'bg-background shadow-sm'
              : 'text-muted-foreground hover:text-foreground'}"
            aria-pressed={role === track.id}
            onclick={() => (role = track.id)}
          >
            <span class="size-1.5 rounded-full" style={`background:${trackColor.get(track.id)};`}></span>
            {track.name}
          </button>
        {/each}
      </div>
    </div>

    <!-- 3단: 구간 목록 · 스테이지 · 인스펙터 -->
    <div class="grid gap-2.5 lg:grid-cols-[220px_minmax(0,1fr)_288px]">
      <!-- 구간 목록 -->
      <section class="bg-card hidden flex-col overflow-hidden rounded-xl border lg:flex">
        <div class="text-muted-foreground border-b px-3 py-2 text-[11px] font-bold tracking-wider uppercase">
          구간 · 큐 목록
        </div>
        <div class="max-h-[430px] overflow-y-auto p-1.5">
          {#each actBands as band (band.actId)}
            {#if band.title}
              <p class="text-muted-foreground/70 px-2 pt-2 pb-0.5 text-[11px] font-bold">{band.title}</p>
            {/if}
            {#each segments.filter((seg) => seg.actId === band.actId) as seg (seg.id)}
              <button
                type="button"
                class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-xs transition-colors
                  {currentSeg?.id === seg.id ? 'bg-primary/15 text-primary font-semibold' : 'hover:bg-accent/60'}"
                onclick={() => jumpToSeg(seg)}
              >
                <span class="text-muted-foreground/60 w-9 shrink-0 font-mono text-[11px]">{fmt(seg.start)}</span>
                <span class="text-muted-foreground w-8 shrink-0 font-mono text-[11px] font-semibold">{seg.firstQ}</span>
                <span class="truncate">{seg.title}</span>
              </button>
            {/each}
          {/each}
        </div>
      </section>

      <!-- 스테이지 -->
      <section class="bg-card overflow-hidden rounded-xl border p-2.5">
        <div
          class="relative flex min-h-[340px] flex-col justify-center gap-3 overflow-hidden rounded-lg px-7 pt-6 pb-14 text-zinc-50"
          style="background:#101013;"
        >
          <div
            class="pointer-events-none absolute inset-0"
            style="background:radial-gradient(ellipse 75% 60% at 50% 8%, rgba(251,191,36,.14), transparent 65%);"
          ></div>
          {#if background}
            <!-- 뒷배경 영상 — 스테이지 뒤에 깔리며 타임라인 재생의 기준 시계가 된다 -->
            <video
              bind:this={videoEl}
              class="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-50"
              src={background.url}
              muted={videoMuted}
              playsinline
              preload="auto"
              onloadedmetadata={() =>
                (videoDurationSec = videoEl && Number.isFinite(videoEl.duration) ? videoEl.duration : null)}
              onended={() => setPlaying(false)}
            ></video>
            <button
              type="button"
              class="absolute top-3 right-3 z-10 rounded-md bg-black/55 px-2.5 py-1 text-[11px] font-semibold text-zinc-100 transition-colors hover:bg-black/75"
              onclick={() => (videoMuted = !videoMuted)}
            >
              {videoMuted ? "🔇 배경 영상" : "🔊 배경 영상"}
            </button>
          {/if}
          <p class="text-primary relative text-[11.5px] font-bold tracking-[0.14em] uppercase">
            {currentSeg?.actTitle || "큐시트"}
          </p>
          <h2 class="relative m-0 text-2xl font-bold tracking-tight text-balance sm:text-3xl">
            {currentSeg?.title ?? "—"}
          </h2>
          {#if stageSong}
            <span
              class="relative inline-flex items-center gap-2 self-start rounded-full border px-3 py-1 text-[13px]"
              style="color:#ffe9b3;background:rgba(251,191,36,.12);border-color:rgba(251,191,36,.3);"
            >
              ♪ {stageSong.content}
            </span>
          {/if}
          {#if stageNar}
            <p class="relative m-0 max-w-[62ch] text-[15px]">
              <span class="me-1.5 align-[1px] text-[11px] font-bold tracking-widest" style="color:#a78bfa;">해설</span>
              {stageNar.content}
            </p>
          {/if}
          {#if stageAct}
            <p class="relative m-0 max-w-[62ch] text-[13px] text-zinc-400">
              <span class="me-1.5 text-[11px] font-bold tracking-widest" style="color:#60a5fa;">동선</span>
              {stageAct.content}
            </p>
          {/if}
          {#if currentSeg?.summary}
            <p class="relative m-0 text-xs text-zinc-400 italic">{currentSeg.summary}</p>
          {/if}
          {#if currentSeg && currentSeg.blocks.length > 0}
            <div class="relative mt-1 rounded-lg border border-white/10 bg-black/25 px-3.5 py-2.5">
              <div class="flex items-center gap-2">
                <p class="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">
                  {selectedCue?.sceneId === currentSeg.id ? "선택한 큐 주변 대본" : "이 장면 대본 미리보기"}
                </p>
                {#if currentSeg.blocks.length > 5}
                  <button
                    type="button"
                    class="ms-auto text-[11px] font-semibold text-zinc-400 underline underline-offset-4 hover:text-zinc-100"
                    onclick={() => (fullScriptSceneId = stageScriptExpanded ? null : currentSeg.id)}
                  >
                    {stageScriptExpanded ? "접기" : `전체 ${currentSeg.blocks.length}줄 보기`}
                  </button>
                {/if}
              </div>
              <div class="mt-1.5 grid {stageScriptExpanded ? 'max-h-[240px] overflow-y-auto pe-1' : ''} gap-1">
                {#each stageScriptBlocks as block (block.id)}
                  {#if block.type === "STAGE_DIRECTION" || block.type === "NOTE"}
                    <p class="m-0 line-clamp-2 text-[12.5px] text-zinc-500 italic">{block.text}</p>
                  {:else}
                    <p class="m-0 line-clamp-2 text-[13px] leading-relaxed text-zinc-200">
                      {#if block.character}<span class="me-1.5 font-bold text-amber-300">{block.character.name}</span>{/if}
                      {block.text}
                    </p>
                  {/if}
                {/each}
              </div>
            </div>
          {/if}
          <div
            class="absolute inset-x-0 bottom-0 flex items-center gap-3 px-4 py-2.5 text-xs text-zinc-400"
            style="background:linear-gradient(transparent, rgba(0,0,0,.45));"
          >
            <span class="bg-primary rounded-md px-2 py-0.5 text-xs font-bold text-zinc-950">{currentSeg?.firstQ ?? "—"}</span>
            <span class="font-mono tabular-nums">{fmt(time)} / {fmt(total)}</span>
            {#if nextMine}
              <span class="ms-auto">다음 내 큐 · {nextMine.firstQ} {fmt(nextMine.start)}</span>
            {/if}
          </div>
        </div>
      </section>

      <!-- 인스펙터 -->
      <section class="bg-card flex flex-col overflow-hidden rounded-xl border">
        <div class="text-muted-foreground flex items-center border-b px-3 py-2 text-[11px] font-bold tracking-wider uppercase">
          {selectedBlockClip ? "대본 블록" : selectedCue ? "큐 상세" : role === "all" ? "현재 장면 — 트랙별 큐" : "현재 장면 — 내 큐 우선"}
          {#if selectedCue || selectedBlockClip}
            <button
              type="button"
              class="text-muted-foreground hover:text-foreground ms-auto rounded p-0.5"
              onclick={() => {
                selectedCueId = null;
                selectedBlockId = null;
              }}
              aria-label="닫기"
            >
              <XIcon class="size-3.5" />
            </button>
          {/if}
        </div>
        <div class="max-h-[430px] overflow-y-auto">
          {#if selectedBlockClip}
            {@const bColor = BLOCK_COLORS[selectedBlockClip.block.type] ?? "#0891b2"}
            <div class="flex flex-col gap-3 p-3.5">
              <div class="flex items-center gap-2">
                <span
                  class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold"
                  style={`background:color-mix(in srgb, ${bColor} 16%, transparent);color:${bColor};`}
                >
                  <span class="size-2 rounded-[3px]" style={`background:${bColor};`}></span>
                  {selectedBlockClip.block.type === "DIALOGUE"
                    ? "대사"
                    : selectedBlockClip.block.type === "LYRIC"
                      ? "가사"
                      : selectedBlockClip.block.type === "STAGE_DIRECTION"
                        ? "지문"
                        : "메모"}
                </span>
                <span class="text-muted-foreground text-xs">
                  {selectedBlockClip.actTitle} · {selectedBlockClip.sceneTitle}
                </span>
              </div>
              <div>
                <p class="text-muted-foreground/70 text-[11px] font-bold tracking-wider uppercase">내용</p>
                <p class="mt-0.5 text-[13.5px] leading-relaxed">
                  {#if selectedBlockClip.block.character}
                    <span class="me-1 font-bold" style={`color:${bColor};`}>{selectedBlockClip.block.character.name}</span>
                  {/if}
                  {selectedBlockClip.block.text}
                </p>
              </div>
              <div>
                <p class="text-muted-foreground/70 text-[11px] font-bold tracking-wider uppercase">타임라인 배치</p>
                {#if canEditBlocks}
                  <div class="mt-1.5 grid grid-cols-2 gap-2">
                    <label class="grid gap-1 text-xs">
                      <span class="text-muted-foreground">시작 (초)</span>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        class="border-input bg-background rounded-md border px-2 py-1.5 font-mono text-[13px]"
                        bind:value={blockStartSec}
                      />
                    </label>
                    <label class="grid gap-1 text-xs">
                      <span class="text-muted-foreground">길이 (초)</span>
                      <input
                        type="number"
                        min="1"
                        step="0.5"
                        class="border-input bg-background rounded-md border px-2 py-1.5 font-mono text-[13px]"
                        bind:value={blockDurSec}
                      />
                    </label>
                  </div>
                  <div class="mt-2 flex gap-2">
                    <button
                      type="button"
                      class="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex flex-1 items-center justify-center rounded-lg px-3 py-2 text-sm font-semibold transition-colors"
                      onclick={saveBlockTiming}
                    >
                      저장
                    </button>
                    {#if selectedBlockClip.timed}
                      <button
                        type="button"
                        class="border-input hover:bg-accent inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm font-semibold transition-colors"
                        title="명시한 시간을 지우고 자동 흐름 배치로 되돌립니다"
                        onclick={clearBlockTiming}
                      >
                        자동 배치로
                      </button>
                    {/if}
                  </div>
                {:else}
                  <p class="text-muted-foreground mt-0.5 font-mono text-[13px]">
                    {fmt(selectedBlockClip.startMs / 60000)} · {fmt(selectedBlockClip.durationMs / 60000)}
                    {selectedBlockClip.timed ? "" : " (자동 배치)"}
                  </p>
                {/if}
              </div>
            </div>
          {:else if selectedCue && selectedTrack}
            {@const color = trackColor.get(selectedTrack.id)}
            <div class="flex flex-col gap-3 p-3.5">
              <div class="flex items-center gap-2">
                <span
                  class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold"
                  style={`background:color-mix(in srgb, ${color} 16%, transparent);color:${color};`}
                >
                  <span class="size-2 rounded-[3px]" style={`background:${color};`}></span>
                  {selectedTrack.name}
                </span>
                <span class="bg-primary rounded-md px-2 py-0.5 font-mono text-xs font-bold text-zinc-950">
                  {selectedCue.cueNumber}
                </span>
              </div>
              <div>
                <p class="text-muted-foreground/70 text-[11px] font-bold tracking-wider uppercase">내용</p>
                <p class="mt-0.5 text-[15px] font-bold">{selectedCue.content}</p>
              </div>
              {#if selectedCue.trigger}
                <div>
                  <p class="text-muted-foreground/70 text-[11px] font-bold tracking-wider uppercase">계기 (트리거)</p>
                  <p class="mt-0.5 text-[13px]">{selectedCue.trigger}</p>
                </div>
              {/if}
              {#if selectedCue.character || selectedCue.durationSec}
                <div class="flex gap-6">
                  {#if selectedCue.character}
                    <div>
                      <p class="text-muted-foreground/70 text-[11px] font-bold tracking-wider uppercase">인물</p>
                      <p class="mt-0.5 text-[13px] font-semibold">{selectedCue.character.name}</p>
                    </div>
                  {/if}
                  {#if selectedCue.durationSec}
                    <div>
                      <p class="text-muted-foreground/70 text-[11px] font-bold tracking-wider uppercase">예상 길이</p>
                      <p class="mt-0.5 font-mono text-[13px]">{fmt(selectedCue.durationSec / 60)}</p>
                    </div>
                  {/if}
                </div>
              {/if}
              <div>
                <p class="text-muted-foreground/70 text-[11px] font-bold tracking-wider uppercase">구간</p>
                <p class="mt-0.5 text-[13px]">
                  {currentSeg?.actTitle ? `${currentSeg.actTitle} · ` : ""}{currentSeg?.title ?? "장면 미지정"}
                </p>
                {#if onOpenScript && selectedCue.sceneId}
                  <button
                    type="button"
                    class="text-muted-foreground hover:text-foreground mt-1 text-xs underline underline-offset-4"
                    onclick={() => onOpenScript?.(selectedCue.sceneId)}
                  >
                    이 장면 대본 열기
                  </button>
                {/if}
              </div>
              {#if selectedCue.note}
                <div>
                  <p class="text-muted-foreground/70 text-[11px] font-bold tracking-wider uppercase">메모</p>
                  <p class="mt-0.5 text-[13px]">{selectedCue.note}</p>
                </div>
              {/if}
              <div>
                <p class="text-muted-foreground/70 text-[11px] font-bold tracking-wider uppercase">담당</p>
                <p class="text-muted-foreground mt-0.5 text-[13px]">
                  {selectedTrack.ownerMembership?.user.name ?? "담당자 미지정 — 제작진이 관리"}
                </p>
              </div>
              <!-- 같은 장면에 속한 다른 트랙·인물 큐 -->
              {#if currentSeg && currentSeg.cues.filter((c) => c.id !== selectedCue.id).length > 0}
                <div>
                  <p class="text-muted-foreground/70 text-[11px] font-bold tracking-wider uppercase">이 장면의 다른 큐</p>
                  <div class="mt-1 grid gap-1">
                    {#each currentSeg.cues.filter((c) => c.id !== selectedCue.id) as other (other.id)}
                      {@const oColor = trackColor.get(other.trackId)}
                      {@const oTrack = tracks.find((t) => t.id === other.trackId)}
                      <button
                        type="button"
                        class="hover:bg-accent/50 grid grid-cols-[10px_44px_1fr] items-start gap-1.5 rounded-md px-1 py-1 text-start text-[12.5px] transition-colors"
                        onclick={() => (selectedCueId = other.id)}
                      >
                        <span class="mt-1 size-2 rounded-[3px]" style={`background:${oColor};`}></span>
                        <span class="text-muted-foreground pt-px text-[10.5px] font-bold">{oTrack?.name}</span>
                        <span class="truncate">
                          {#if other.character}<span class="font-semibold" style={`color:${oColor};`}>{other.character.name} </span>{/if}{other.content}
                        </span>
                      </button>
                    {/each}
                  </div>
                </div>
              {/if}
              {#if editableSet.has(selectedCue.trackId) && (onEditCue || onDeleteCue)}
                <div class="flex gap-2">
                  {#if onEditCue}
                    <button
                      type="button"
                      class="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors"
                      onclick={() => onEditCue?.(selectedCue.id)}
                    >
                      <PencilIcon class="size-3.5" />
                      수정
                    </button>
                  {/if}
                  {#if onDeleteCue}
                    <button
                      type="button"
                      class="text-destructive border-destructive/40 hover:bg-destructive/10 inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors"
                      onclick={() => { const id = selectedCue.id; selectedCueId = null; onDeleteCue?.(id); }}
                    >
                      <Trash2Icon class="size-3.5" />
                      삭제
                    </button>
                  {/if}
                </div>
              {/if}
            </div>
          {:else}
            <div class="flex flex-col gap-1 p-2">
              {#each [...tracks].sort((a, b) => (role === b.id ? 1 : 0) - (role === a.id ? 1 : 0)) as track (track.id)}
                {@const color = trackColor.get(track.id)}
                {@const trackCues = currentSeg?.cues.filter((cue) => cue.trackId === track.id) ?? []}
                {@const mine = role !== "all" && role === track.id}
                <div
                  class="grid grid-cols-[14px_46px_1fr] items-start gap-2 rounded-lg border px-2.5 py-2
                    {mine ? 'border-primary/40 bg-primary/10' : 'border-transparent'}"
                >
                  <span class="mt-1.5 size-2 rounded-[3px]" style={`background:${color};`}></span>
                  <span class="text-muted-foreground pt-px text-xs font-bold {mine ? 'text-primary' : ''}">{track.name}</span>
                  {#if trackCues.length === 0}
                    <span class="text-muted-foreground/50 text-xs">대기</span>
                  {:else}
                    <span class="grid gap-1 text-[12.5px]">
                      {#each trackCues as cue (cue.id)}
                        <button type="button" class="hover:text-primary text-start transition-colors" onclick={() => (selectedCueId = cue.id)}>
                          <span class="font-mono text-[10.5px] font-bold" style={`color:${color};`}>{cue.cueNumber}</span>
                          {cue.content}
                        </button>
                      {/each}
                    </span>
                  {/if}
                </div>
              {/each}
              {#if nextMine}
                {@const mineCue = nextMine.cues.find((cue) => cue.trackId === role)}
                <div class="text-muted-foreground m-1.5 rounded-lg border border-dashed px-3 py-2 text-xs">
                  다음 내 큐 — <b class="text-foreground">{mineCue?.cueNumber} · {fmt(nextMine.start)}</b>
                  {#if mineCue}<br />{mineCue.content}{/if}
                </div>
              {/if}
            </div>
          {/if}
        </div>
      </section>
    </div>

    <!-- 타임라인 -->
    <div class="bg-card overflow-hidden rounded-xl border">
      <div class="flex flex-wrap items-center gap-2.5 border-b px-3 py-2">
        <button
          type="button"
          class="bg-primary inline-flex size-8 items-center justify-center rounded-full text-zinc-950 transition-[filter] hover:brightness-105"
          onclick={() => setPlaying(!playing)}
          aria-label="재생/일시정지"
        >
          {#if playing}
            <PauseIcon class="size-4" />
          {:else}
            <PlayIcon class="size-4" />
          {/if}
        </button>
        <span class="font-mono text-[13px] tabular-nums">
          {fmt(time)} <span class="text-muted-foreground/60">/ {fmt(total)}</span>
        </span>
        <div class="bg-muted flex rounded-lg p-0.5" title={background ? "배경 영상 연동 중에는 실시간만 지원합니다" : undefined}>
          {#each [1, 20, 60] as s (s)}
            <button
              type="button"
              class="rounded-md px-2 py-0.5 text-[11.5px] font-medium {speed === s
                ? 'bg-background shadow-sm'
                : 'text-muted-foreground hover:text-foreground'} {background && s !== 1 ? 'cursor-not-allowed opacity-35' : ''}"
              disabled={!!background && s !== 1}
              onclick={() => (speed = s)}
            >
              {s === 1 ? "실시간" : `×${s}`}
            </button>
          {/each}
        </div>
        <span class="text-muted-foreground/60 ms-auto hidden text-[11.5px] xl:block">
          눈금 드래그로 이동 · 스페이스로 재생 · 큐 블록 클릭으로 상세{background ? " · 배경 영상 연동 중" : ""}
        </span>
      </div>

      <div class="overflow-x-auto overscroll-x-contain" bind:this={scroller}>
        <div class="relative min-w-max pb-2.5" data-tl-inner>
          <!-- 눈금 -->
          <div class="grid" style={`grid-template-columns:${LABEL_W}px 1fr;`}>
            <div class="bg-card text-muted-foreground/70 sticky left-0 z-10 flex items-center border-e px-2.5 text-[11px] font-semibold">
              분 (예상)
            </div>
            <div
              class="relative h-[22px] cursor-col-resize"
              style={`width:${total * PXM}px;`}
              role="slider"
              aria-label="재생 위치"
              aria-valuemin={0}
              aria-valuemax={Math.round(total * 60)}
              aria-valuenow={Math.round(time * 60)}
              tabindex="-1"
              onpointerdown={scrubDown}
              onpointermove={scrubMove}
              onpointerup={scrubUp}
            >
              {#each ticks as m (m)}
                <div
                  class="border-border text-muted-foreground/60 absolute inset-y-0 border-s ps-1 pt-0.5 font-mono text-[10px]"
                  style={`left:${m * PXM}px;`}
                >
                  {fmt(m)}
                </div>
              {/each}
            </div>
          </div>

          <!-- 막 밴드 -->
          <div class="grid border-t" style={`grid-template-columns:${LABEL_W}px 1fr;`}>
            <div class="bg-card text-muted-foreground sticky left-0 z-10 flex items-center border-e px-2.5 text-[11.5px] font-bold">
              막 · 장
            </div>
            <div
              class="relative h-[30px] cursor-col-resize"
              style={`width:${total * PXM}px;`}
              role="slider"
              aria-label="재생 위치 (막 밴드)"
              aria-valuemin={0}
              aria-valuemax={Math.round(total * 60)}
              aria-valuenow={Math.round(time * 60)}
              tabindex="-1"
              onpointerdown={scrubDown}
              onpointermove={scrubMove}
              onpointerup={scrubUp}
            >
              {#each actBands as band (band.actId)}
                {@const on = currentSeg?.actId === band.actId}
                <div
                  class="absolute inset-y-[3px] flex items-center overflow-hidden rounded-md border px-2 text-[11px] font-bold whitespace-nowrap
                    {on ? 'border-primary/40 bg-primary/15 text-primary' : 'bg-muted/60 text-muted-foreground'}"
                  style={`left:${band.start * PXM}px;width:${(band.end - band.start) * PXM - 3}px;`}
                >
                  {band.title}
                </div>
              {/each}
            </div>
          </div>

          <!-- 대본 블록 레인 — 대본이 타임라인에서 언제 보이는지. 끌어서 옮기고 끝을 끌어 길이 조절 -->
          {#if blockClips.length > 0}
            <div class="grid border-t" style={`grid-template-columns:${LABEL_W}px 1fr;`}>
              <div class="bg-card text-muted-foreground sticky left-0 z-10 flex items-center border-e px-2.5 text-[11.5px] font-bold">
                대본
              </div>
              <div class="relative h-[32px]" style={`width:${total * PXM}px;`}>
                {#each blockClips as clip (clip.block.id)}
                  {@const color = BLOCK_COLORS[clip.block.type] ?? "#0891b2"}
                  {@const selected = selectedBlockId === clip.block.id}
                  {@const dragging = blockDrag?.blockId === clip.block.id}
                  {@const onAir = time * 60000 >= clip.startMs && time * 60000 < clip.startMs + clip.durationMs}
                  <button
                    type="button"
                    class="absolute inset-y-[3px] flex items-center gap-1 overflow-hidden rounded-md border px-1.5 text-[10.5px] whitespace-nowrap
                      {canEditBlocks ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}
                      {selected ? 'outline-2 outline-offset-1' : ''}
                      {clip.timed ? '' : 'border-dashed opacity-75'}"
                    style={`left:${(clip.startMs / 60000) * PXM}px;width:${Math.max(18, (clip.durationMs / 60000) * PXM - 2)}px;
                      ${canEditBlocks ? "touch-action:none;" : ""}
                      transform:translateX(${dragging ? blockDrag!.dx : 0}px);${dragging ? "z-index:30;opacity:.85;" : ""}
                      border-color:color-mix(in srgb, ${color} ${onAir || selected ? "100" : "55"}%, transparent);
                      background:color-mix(in srgb, ${color} ${onAir ? "34" : "14"}%, var(--card));
                      ${selected ? `outline-color:${color};` : ""}`}
                    title={`${clip.actTitle} · ${clip.sceneTitle} — ${clip.block.text.slice(0, 60)}${clip.timed ? "" : " (자동 배치)"}`}
                    onclick={canEditBlocks ? undefined : () => pickBlock(clip)}
                    onpointerdown={canEditBlocks ? (e) => blockDragStart(e, clip) : undefined}
                    onpointermove={canEditBlocks ? blockDragMove : undefined}
                    onpointerup={canEditBlocks ? (e) => blockDragEnd(e, clip) : undefined}
                  >
                    {#if clip.block.character}
                      <span class="shrink-0 text-[10px] font-bold" style={`color:${color};`}>{clip.block.character.name}</span>
                    {/if}
                    <span class="text-muted-foreground truncate">{clip.block.text}</span>
                    {#if canEditBlocks}
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <span
                        class="absolute inset-y-0 right-0 z-10 w-2 cursor-ew-resize rounded-e-md hover:bg-white/25"
                        style="touch-action:none;"
                        title="끌어서 길이 조절"
                        onpointerdown={(e) => blockResizeStart(e, clip)}
                        onpointermove={blockResizeMove}
                        onpointerup={(e) => blockResizeEnd(e, clip)}
                      ></span>
                    {/if}
                  </button>
                {/each}
              </div>
            </div>
          {/if}

          <!-- 트랙 레인 -->
          {#each tracks as track (track.id)}
            {@const color = trackColor.get(track.id)}
            {@const dim = role !== "all" && role !== track.id}
            {@const canAdd = !!onAddCue && editableSet.has(track.id)}
            {@const chars = charactersOf(track.id)}
            {@const expandable = chars.list.length > 0}
            {@const isExpanded = expandable && expandedTracks.has(track.id)}
            {@const subLanes = isExpanded
              ? [...chars.list.map((c) => ({ key: c.id, name: c.name, characterId: c.id as string | null })), ...(chars.untagged ? [{ key: "__untagged", name: "미지정", characterId: null as string | null }] : [])]
              : []}
            <div class="grid border-t {dim ? 'opacity-30' : ''} transition-opacity" style={`grid-template-columns:${LABEL_W}px 1fr;`}>
              <div class="bg-card sticky left-0 z-10 flex flex-col justify-center border-e px-2.5">
                <span class="flex items-center gap-1">
                  <span class="size-2 shrink-0 rounded-[3px]" style={`background:${color};`}></span>
                  <span class="text-muted-foreground truncate text-[11.5px] font-bold">{track.name}</span>
                  {#if expandable}
                    <button
                      type="button"
                      class="text-muted-foreground/70 hover:text-foreground ms-auto inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[9.5px] font-semibold leading-none"
                      title={isExpanded ? "인물별 레인 접기" : "인물별 레인 펼치기"}
                      aria-label={isExpanded ? "인물별 레인 접기" : `인물 ${chars.list.length}명 레인 펼치기`}
                      aria-expanded={isExpanded}
                      onclick={() => toggleTrackExpand(track.id)}
                    >
                      <span aria-hidden="true">{isExpanded ? "▾" : "▸"}</span>
                      인물 {chars.list.length}
                    </button>
                  {/if}
                </span>
                {#if track.ownerMembership}
                  <span class="text-muted-foreground/60 truncate ps-3.5 text-[9.5px] leading-tight">
                    {track.ownerMembership.user.name}
                  </span>
                {/if}
              </div>
              <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
              <div
                class="relative {isExpanded ? 'h-[18px]' : 'h-[34px]'} {canAdd ? 'hover:bg-accent/25 cursor-copy transition-colors' : ''}"
                style={`width:${total * PXM}px;`}
                role={canAdd ? "button" : undefined}
                tabindex={canAdd ? -1 : undefined}
                aria-label={canAdd ? `${track.name} 트랙 빈 곳을 누르면 큐 추가` : undefined}
                title={canAdd ? "빈 곳을 누르면 이 위치에 큐를 추가합니다" : undefined}
                onclick={canAdd ? (event) => laneClick(event, track.id) : undefined}
                onkeydown={canAdd ? () => {} : undefined}
              >
                {#if !isExpanded}
                  {#each segments as seg (seg.id)}
                    {#each clipsFor(track.id, seg) as clip (clip.cue.id)}
                      {@const active = currentSeg?.id === seg.id}
                      {@const selected = selectedCueId === clip.cue.id}
                      {@const dragging = clipDrag?.cueId === clip.cue.id}
                      <button
                        type="button"
                        class="absolute inset-y-1 flex items-center gap-1 overflow-hidden rounded-md border px-1.5 text-[11px] whitespace-nowrap
                          {canAdd && (onReorderCue || onMoveCue) ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}
                          {selected ? 'outline-2 outline-offset-1' : ''}"
                        style={`left:${clip.left}px;width:${clip.width}px;--clip:${color};
                          ${canAdd && (onReorderCue || onMoveCue) ? "touch-action:none;" : ""}
                          border-style:${clip.timed ? "solid" : "dashed"};
                          transform:translateX(${dragging ? clipDrag!.dx : 0}px);${dragging ? "z-index:30;opacity:.85;" : ""}
                          border-color:color-mix(in srgb, ${color} ${active || selected ? "100" : "55"}%, transparent);
                          background:color-mix(in srgb, ${color} ${active ? "30" : "14"}%, var(--card));
                          ${selected ? `outline-color:${color};` : ""}`}
                        title={`${clip.cue.cueNumber} · ${track.name}${clip.cue.character ? ` · ${clip.cue.character.name}` : ""} — ${clip.cue.content}${clip.timed ? ` (${fmt(clip.left / PXM)} 시작)` : ""}`}
                        onclick={canAdd && (onReorderCue || onMoveCue) ? undefined : () => pickCue(clip.cue, seg)}
                        onpointerdown={canAdd && (onReorderCue || onMoveCue) ? (e) => clipDragStart(e, clip.cue, clip.left, clip.width) : undefined}
                        onpointermove={canAdd && (onReorderCue || onMoveCue) ? clipDragMove : undefined}
                        onpointerup={canAdd && (onReorderCue || onMoveCue) ? (e) => clipDragEnd(e, clip.cue, seg) : undefined}
                      >
                        <span class="shrink-0 font-mono text-[10.5px] font-bold" style={`color:${color};`}>{clip.cue.cueNumber}</span>
                        {#if clip.cue.character}
                          <span class="shrink-0 text-[10px] font-semibold" style={`color:${color};`}>{clip.cue.character.name}</span>
                        {/if}
                        <span class="text-muted-foreground truncate">{clip.cue.content}</span>
                        {#if canAdd && onResizeCue}
                          <!-- svelte-ignore a11y_no_static_element_interactions -->
                          <span
                            class="absolute inset-y-0 right-0 z-10 w-2 cursor-ew-resize rounded-e-md hover:bg-white/25"
                            style="touch-action:none;"
                            title="끌어서 길이 조절"
                            onpointerdown={(e) => resizeStart(e, clip.cue)}
                            onpointermove={resizeMove}
                            onpointerup={resizeEnd}
                          ></span>
                        {/if}
                      </button>
                    {/each}
                  {/each}
                {/if}
              </div>
            </div>
            {#if isExpanded}
              {#each subLanes as lane (lane.key)}
                <div class="grid {dim ? 'opacity-30' : ''} transition-opacity" style={`grid-template-columns:${LABEL_W}px 1fr;`}>
                  <div class="bg-card sticky left-0 z-10 flex items-center border-e ps-5 pe-2.5">
                    <span class="text-muted-foreground/80 truncate text-[10.5px] font-semibold">{lane.name}</span>
                  </div>
                  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
                  <div
                    class="relative h-[28px] {canAdd ? 'hover:bg-accent/25 cursor-copy transition-colors' : ''}"
                    style={`width:${total * PXM}px;`}
                    role={canAdd ? "button" : undefined}
                    tabindex={canAdd ? -1 : undefined}
                    onclick={canAdd ? (event) => laneClick(event, track.id) : undefined}
                    onkeydown={canAdd ? () => {} : undefined}
                  >
                    {#each segments as seg (seg.id)}
                      {#each clipsFor(track.id, seg, lane.characterId) as clip (clip.cue.id)}
                        {@const active = currentSeg?.id === seg.id}
                        {@const selected = selectedCueId === clip.cue.id}
                        <button
                          type="button"
                          class="absolute inset-y-[3px] flex cursor-pointer items-center gap-1 overflow-hidden rounded-md border px-1.5 text-[10.5px] whitespace-nowrap
                            {selected ? 'outline-2 outline-offset-1' : ''}"
                          style={`left:${clip.left}px;width:${clip.width}px;
                            border-style:${clip.timed ? "solid" : "dashed"};
                            border-color:color-mix(in srgb, ${color} ${active || selected ? "100" : "55"}%, transparent);
                            background:color-mix(in srgb, ${color} ${active ? "30" : "12"}%, var(--card));
                            ${selected ? `outline-color:${color};` : ""}`}
                          title={`${clip.cue.cueNumber} · ${lane.name} — ${clip.cue.content}`}
                          onclick={() => pickCue(clip.cue, seg)}
                        >
                          <span class="shrink-0 font-mono text-[10px] font-bold" style={`color:${color};`}>{clip.cue.cueNumber}</span>
                          <span class="text-muted-foreground truncate">{clip.cue.content}</span>
                        </button>
                      {/each}
                    {/each}
                  </div>
                </div>
              {/each}
            {/if}
          {/each}

          <!-- 플레이헤드 -->
          <div
            class="border-primary pointer-events-none absolute top-0 bottom-0 z-20 w-0 border-s-2"
            style={`left:${LABEL_W + time * PXM}px;`}
          >
            <div
              class="absolute top-0 -left-[6px] border-[5px] border-transparent"
              style="border-top:7px solid var(--primary);"
            ></div>
          </div>
        </div>
      </div>
    </div>

    <p class="text-muted-foreground/60 text-center text-[11.5px]">
      실선 큐는 지정된 시각에, 점선 큐는 순서에 맞춰 자동으로 놓입니다 · 큐를 끌어 옮기고 오른쪽 끝을 끌어 길이를 조절합니다{onAddCue
        ? " · 빈 레인을 누르면 큐를 추가합니다"
        : ""}{canEditBlocks ? " · 대본 블록도 같은 방식으로 옮깁니다" : ""}
    </p>
  </div>

  <!-- 발표(진행) 모드 — 전체 화면, 재생 전용 -->
  {#if presenting}
    <div
      class="fixed inset-0 z-50 flex flex-col gap-4 overflow-y-auto p-5 text-zinc-50 sm:p-8"
      style="background:#0a0a0c;"
      role="dialog"
      aria-label="진행 모드"
    >
      <div
        class="pointer-events-none absolute inset-0"
        style="background:radial-gradient(ellipse 70% 50% at 50% 0%, rgba(251,191,36,.12), transparent 60%);"
      ></div>

      <!-- 상단 바 -->
      <div class="relative flex flex-wrap items-center gap-3">
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-800"
          onclick={stopPresenting}
        >
          <XIcon class="size-4" />
          종료
          <kbd class="rounded bg-zinc-800 px-1.5 text-[10px] text-zinc-400">ESC</kbd>
        </button>
        <span class="ms-auto font-mono text-lg tabular-nums">
          {fmt(time)} <span class="text-zinc-500">/ {fmt(total)}</span>
        </span>
        <div class="flex rounded-lg bg-zinc-800/80 p-0.5">
          {#each [1, 20, 60] as s (s)}
            <button
              type="button"
              class="rounded-md px-2.5 py-1 text-xs font-medium {speed === s
                ? 'bg-zinc-100 text-zinc-900'
                : 'text-zinc-400 hover:text-zinc-100'}"
              onclick={() => (speed = s)}
            >
              {s === 1 ? "실시간" : `×${s}`}
            </button>
          {/each}
        </div>
        <button
          type="button"
          class="inline-flex size-11 items-center justify-center rounded-full bg-amber-400 text-zinc-950 transition-[filter] hover:brightness-105"
          onclick={() => setPlaying(!playing)}
          aria-label="재생/일시정지"
        >
          {#if playing}
            <PauseIcon class="size-5" />
          {:else}
            <PlayIcon class="size-5" />
          {/if}
        </button>
      </div>

      <!-- 본문: 스테이지 + 부서별 액션 -->
      <div class="relative grid min-h-0 flex-1 items-center gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div class="flex min-w-0 flex-col gap-4 py-4">
          <p class="text-sm font-bold tracking-[0.16em] text-amber-400 uppercase">
            {currentSeg?.actTitle || "진행"}
          </p>
          <h2 class="m-0 text-4xl leading-tight font-bold tracking-tight text-balance sm:text-6xl">
            {currentSeg?.title ?? "—"}
          </h2>
          {#if stageSong}
            <span
              class="inline-flex items-center gap-2 self-start rounded-full border px-4 py-1.5 text-base"
              style="color:#ffe9b3;background:rgba(251,191,36,.12);border-color:rgba(251,191,36,.3);"
            >
              ♪ {stageSong.content}
            </span>
          {/if}
          {#if stageNar}
            <p class="m-0 max-w-[56ch] text-lg leading-relaxed sm:text-2xl">
              <span class="me-2 align-[2px] text-xs font-bold tracking-widest" style="color:#a78bfa;">해설</span>
              {stageNar.content}
            </p>
          {/if}
          {#if stageAct}
            <p class="m-0 max-w-[56ch] text-base text-zinc-400 sm:text-lg">
              <span class="me-2 text-xs font-bold tracking-widest" style="color:#60a5fa;">동선</span>
              {stageAct.content}
            </p>
          {/if}
          {#if currentSeg?.summary}
            <p class="m-0 text-sm text-zinc-500 italic">{currentSeg.summary}</p>
          {/if}
          <span class="mt-2 inline-flex items-center gap-3 text-zinc-400">
            <span class="rounded-md bg-amber-400 px-2.5 py-1 font-mono text-sm font-bold text-zinc-950">
              {currentSeg?.firstQ ?? "—"}
            </span>
            {#if nextMine}
              <span class="text-sm">다음 내 큐 · {nextMine.firstQ} {fmt(nextMine.start)}</span>
            {/if}
          </span>
        </div>

        <div class="w-full self-center rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <p class="mb-3 text-[11px] font-bold tracking-wider text-zinc-500 uppercase">현재 위치 — 트랙별 큐</p>
          <div class="grid gap-2.5">
            {#each tracks as track (track.id)}
              {@const color = trackColor.get(track.id)}
              {@const activeCue = segCue(currentSeg, track.name)}
              {@const trackCues = activeCue ? [activeCue] : []}
              <div class="grid grid-cols-[14px_52px_1fr] items-start gap-2">
                <span class="mt-1.5 size-2.5 rounded-[3px]" style={`background:${color};`}></span>
                <span class="pt-0.5 text-sm font-bold text-zinc-400">{track.name}</span>
                {#if trackCues.length === 0}
                  <span class="pt-0.5 text-sm text-zinc-600">대기</span>
                {:else}
                  <span class="grid gap-1 text-[15px] leading-snug">
                    {#each trackCues as cue (cue.id)}
                      <span>
                        <span class="font-mono text-xs font-bold" style={`color:${color};`}>{cue.cueNumber}</span>
                        {cue.content}
                      </span>
                    {/each}
                  </span>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      </div>

      <!-- 장면 스트립 + 진행 바 -->
      <div class="relative grid gap-2.5">
        <div class="flex gap-1.5 overflow-x-auto pb-1">
          {#each segments as seg (seg.id)}
            {@const on = currentSeg?.id === seg.id}
            <button
              type="button"
              class="shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors
                {on ? 'bg-amber-400 text-zinc-950' : 'bg-zinc-800/80 text-zinc-400 hover:text-zinc-100'}"
              onclick={() => jumpToSeg(seg)}
            >
              <span class="font-mono">{seg.firstQ}</span>
              {seg.title}
            </button>
          {/each}
        </div>
        <div class="h-1 overflow-hidden rounded-full bg-zinc-800">
          <div class="h-full rounded-full bg-amber-400" style={`width:${total ? (time / total) * 100 : 0}%;`}></div>
        </div>
        <p class="text-center text-xs text-zinc-600">← → 장면 이동 · 스페이스 재생 · ESC 종료</p>
      </div>
    </div>
  {/if}
{/if}
