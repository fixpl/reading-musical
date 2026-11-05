<script lang="ts">
    import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { toast } from "svelte-sonner";
  import * as Dialog from "$lib/components/ui/dialog";
  import * as Select from "$lib/components/ui/select";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import { Textarea } from "$lib/components/ui/textarea";
  import { apiRequest, uploadSignedObject } from "$lib/api/client";
  import AiCueDraftDialog from "$lib/components/app/ai-cue-draft-dialog.svelte";
  import CueSheetSettingsDialog from "$lib/components/app/cue-sheet-settings-dialog.svelte";
  import CueStudio from "$lib/components/app/cue-studio.svelte";
  import ChevronLeftIcon from "@lucide/svelte/icons/chevron-left";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import Settings2Icon from "@lucide/svelte/icons/settings-2";
  import SparklesIcon from "@lucide/svelte/icons/sparkles";
  import MonitorIcon from "@lucide/svelte/icons/monitor";

  type Track = {
    id: string;
    name: string;
    order: number;
    ownerMembership: { id: string; user: { id: string; name: string } } | null;
  };

  type MediaAsset = {
    id: string;
    kind: string;
    mime: string;
    sizeBytes: number;
    storageKey: string;
    createdAt: string;
  };

  type CueAsset = { id: string; kind: string; mime: string; storageKey: string };

  type ScriptBlock = {
    id: string;
    type: string;
    text: string;
    order: number;
    startMs?: number | null;
    durationMs?: number | null;
    character: { id: string; name: string } | null;
  };

  type Cue = {
    id: string;
    trackId: string;
    cueNumber: string;
    trigger: string | null;
    content: string;
    note: string | null;
    sceneId: string | null;
    scene: { id: string; title: string; order: number; act: { id: string; title: string; order: number } } | null;
    character: { id: string; name: string } | null;
    durationSec: number | null;
    startMs?: number | null;
    asset?: CueAsset | null;
    author: { id: string; name: string };
  };

  type CastingRole = { id: string; name: string };

  type Scene = {
    id: string;
    title: string;
    order: number;
    summary?: string | null;
    act: { id: string; title: string; order: number };
    blocks?: ScriptBlock[];
  };

  type Board = {
    production: {
      id: string;
      title: string;
      backgroundAssetId?: string | null;
      backgroundAsset?: (CueAsset & { sizeBytes: number }) | null;
    };
    tracks: Track[];
    cues: Cue[];
    scenes: Scene[];
    viewer: { canManageTracks: boolean; editableTrackIds: string[] };
  };

  const pid = $derived($page.params.pid ?? "");

  const PALETTE = [
    "var(--chart-1)",
    "var(--chart-2)",
    "var(--chart-3)",
    "var(--chart-4)",
    "var(--chart-5)",
    "oklch(0.606 0.25 292.717)",
    "oklch(0.645 0.246 16.439)",
    "oklch(0.6 0.118 184.704)"
  ];

  let board = $state<Board | null>(null);
  let title = $state("큐시트");
  let loading = $state(true);
  let view = $state<"list" | "timeline">("list");
  let onlyMine = $state(false);

  // 큐 작성·수정 다이얼로그
  let cueOpen = $state(false);
  let editingCue = $state<Cue | null>(null);
  let formTrackId = $state("");
  let formSceneId = $state("");
  let formCueNumber = $state("");
  let formTrigger = $state("");
  let formContent = $state("");
  let formNote = $state("");
  let formCharacterId = $state("");
  let formDurationSec = $state(""); // 문자열로 두고 저장 시 정수 변환
  let formAssetId = $state("");
  let cueSaving = $state(false);
  let castingRoles = $state<CastingRole[]>([]);

  // 미디어(영상·음원) 라이브러리 + 배경 영상
  let mediaAssets = $state<MediaAsset[]>([]);
  let backgroundVideo = $state<{ url: string; mime: string } | null>(null);
  let mediaUploading = $state(false);
  let backgroundUploading = $state(false);

  // storageKey = "prefix/productionId/uuid-파일명" — 화면에는 파일명만 보여준다.
  function mediaName(asset: { storageKey: string }) {
    const base = asset.storageKey.split("/").pop() ?? asset.storageKey;
    return base.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/, "");
  }

  const DURATION_PRESETS = [
    { label: "15초", value: 15 },
    { label: "30초", value: 30 },
    { label: "1분", value: 60 },
    { label: "3분", value: 180 }
  ];
  const isActorTrack = $derived((board?.tracks.find((track) => track.id === formTrackId)?.name ?? "") === "배우");

  function fmtDuration(sec: number) {
    if (sec < 60) return `${sec}초`;
    const m = Math.floor(sec / 60);
    const r = sec % 60;
    return r ? `${m}분 ${r}초` : `${m}분`;
  }

  // AI 초안 다이얼로그 — 상태/로직은 ai-cue-draft-dialog.svelte가 소유한다.
  let aiOpen = $state(false);

  // 트랙 관리 다이얼로그
  let tracksOpen = $state(false);
  let trackSaving = $state(false);

  const trackColor = $derived.by(() => {
    const map = new Map<string, string>();
    board?.tracks.forEach((track, index) => map.set(track.id, PALETTE[index % PALETTE.length]));
    return map;
  });

  const editableSet = $derived(new Set(board?.viewer.editableTrackIds ?? []));
  const canEditSomething = $derived((board?.viewer.editableTrackIds.length ?? 0) > 0);
  const canManage = $derived(board?.viewer.canManageTracks ?? false);
  const showMineToggle = $derived(canEditSomething && !canManage);

  // "내 큐만"은 숨기지 않고 맥락 행을 흐리게 남긴다 — 목업 ②의 표 방식.
  const mineCount = $derived(board ? board.cues.filter((cue) => editableSet.has(cue.trackId)).length : 0);

  const sceneGroups = $derived.by(() => {
    if (!board) return [];
    const groups = new Map<string, { label: string; cues: Cue[] }>();
    const orderedScenes = [...board.scenes];
    for (const scene of orderedScenes) {
      groups.set(scene.id, { label: `${scene.act.title} · ${scene.title}`, cues: [] });
    }
    groups.set("__none", { label: "장면 미지정", cues: [] });
    for (const cue of board.cues) {
      const key = cue.sceneId ?? "__none";
      (groups.get(key) ?? groups.get("__none"))!.cues.push(cue);
    }
    return [...groups.entries()].filter(([, group]) => group.cues.length > 0);
  });

  // pid가 바뀌어도(공연 전환) 다시 불러온다 — onMount는 재실행되지 않음.
  $effect(() => {
    void pid;
    void load();
  });

  async function load() {
    loading = true;
    try {
      const result = await apiRequest<Board>(`/productions/${pid}/cue-sheet`);
      title = result.production.title;
      board = result;
      castingRoles = await apiRequest<CastingRole[]>(`/productions/${pid}/roles`).catch(() => []);
      mediaAssets = await apiRequest<MediaAsset[]>(`/assets?productionId=${pid}`).catch(() => []);
      if (result.production.backgroundAsset) {
        const signed = await apiRequest<{ url: string; mime: string }>(
          `/assets/${result.production.backgroundAsset.id}/url`
        ).catch(() => null);
        backgroundVideo = signed ? { url: signed.url, mime: signed.mime } : null;
      } else {
        backgroundVideo = null;
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "큐시트를 불러오지 못했습니다");
    } finally {
      loading = false;
    }
  }

  type AssetCreateResponse = {
    asset: { id: string };
    upload: { url: string; method?: string };
  };

  async function uploadMediaFile(file: File, purpose: "BACKGROUND_VIDEO" | "CUE_MEDIA") {
    const created = await apiRequest<AssetCreateResponse>("/assets", {
      method: "POST",
      body: JSON.stringify({
        purpose,
        productionId: pid,
        fileName: file.name,
        mimeType: file.type,
        size: file.size
      })
    });
    await uploadSignedObject(created.upload, file, file.type);
    return created.asset;
  }

  async function onPickBackground(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    backgroundUploading = true;
    try {
      const asset = await uploadMediaFile(file, "BACKGROUND_VIDEO");
      await apiRequest(`/productions/${pid}/background-video`, {
        method: "PATCH",
        body: JSON.stringify({ assetId: asset.id })
      });
      toast.success("배경 영상을 등록했습니다. 타임라인 재생이 영상에 맞춰집니다.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "배경 영상을 올리지 못했습니다");
    } finally {
      backgroundUploading = false;
    }
  }

  async function clearBackground() {
    backgroundUploading = true;
    try {
      await apiRequest(`/productions/${pid}/background-video`, {
        method: "PATCH",
        body: JSON.stringify({ assetId: null })
      });
      toast.success("배경 영상을 해제했습니다");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "해제하지 못했습니다");
    } finally {
      backgroundUploading = false;
    }
  }

  async function onPickCueMedia(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    mediaUploading = true;
    try {
      const asset = await uploadMediaFile(file, "CUE_MEDIA");
      mediaAssets = await apiRequest<MediaAsset[]>(`/assets?productionId=${pid}`).catch(() => mediaAssets);
      formAssetId = asset.id;
      toast.success("파일을 올렸습니다. 이 큐에 연결됩니다.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "파일을 올리지 못했습니다");
    } finally {
      mediaUploading = false;
    }
  }

  // 타임라인 대본 레인에서 블록을 끌어 놓았을 때 — 시작/길이(ms)를 저장한다.
  async function studioMoveBlock(blockId: string, startMs: number | null, durationMs: number | null) {
    try {
      await apiRequest(`/productions/${pid}/blocks/${blockId}`, {
        method: "PATCH",
        body: JSON.stringify({ startMs, durationMs })
      });
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "블록 배치를 저장하지 못했습니다");
    }
  }

  function trackName(trackId: string) {
    return board?.tracks.find((track) => track.id === trackId)?.name ?? "";
  }

  function sceneName(sceneId: string) {
    const scene = board?.scenes.find((item) => item.id === sceneId);
    return scene ? `${scene.act.title} · ${scene.title}` : "장면 미지정";
  }

  function openCreateCue(trackId?: string, sceneId?: string) {
    editingCue = null;
    const editable = board?.tracks.filter((track) => editableSet.has(track.id)) ?? [];
    formTrackId = trackId && editableSet.has(trackId) ? trackId : (editable[0]?.id ?? "");
    formSceneId = sceneId ?? "";
    formCueNumber = "";
    formTrigger = "";
    formContent = "";
    formNote = "";
    formCharacterId = "";
    formDurationSec = "";
    formAssetId = "";
    cueOpen = true;
  }

  function openScriptScene(sceneId: string | null) {
    if (canManage && sceneId) {
      void goto(`/app/p/${pid}/manage/script?scene=${sceneId}`);
    } else {
      void goto(`/app/p/${pid}/script${sceneId ? `#scene-${sceneId}` : ""}`);
    }
  }

  function openEditCue(cue: Cue) {
    if (!editableSet.has(cue.trackId)) return;
    editingCue = cue;
    formTrackId = cue.trackId;
    formSceneId = cue.sceneId ?? "";
    formCueNumber = cue.cueNumber;
    formTrigger = cue.trigger ?? "";
    formContent = cue.content;
    formNote = cue.note ?? "";
    formCharacterId = cue.character?.id ?? "";
    formDurationSec = cue.durationSec ? String(cue.durationSec) : "";
    formAssetId = cue.asset?.id ?? "";
    cueOpen = true;
  }

  async function saveCue(event: SubmitEvent) {
    event.preventDefault();
    if (!formTrackId || !formContent.trim()) return;
    cueSaving = true;
    try {
      const parsedDuration = Number.parseInt(formDurationSec, 10);
      const body = {
        cueNumber: formCueNumber.trim() || undefined,
        trigger: formTrigger.trim() || undefined,
        content: formContent.trim(),
        note: formNote.trim() || undefined,
        sceneId: formSceneId || null,
        characterId: isActorTrack && formCharacterId ? formCharacterId : null,
        durationSec: Number.isFinite(parsedDuration) && parsedDuration > 0 ? Math.min(3600, parsedDuration) : null,
        assetId: formAssetId || null
      };
      if (editingCue) {
        await apiRequest(`/productions/${pid}/cue-sheet/cues/${editingCue.id}`, {
          method: "PATCH",
          body: JSON.stringify({ ...body, cueNumber: formCueNumber.trim() || undefined })
        });
      } else {
        await apiRequest(`/productions/${pid}/cue-sheet/tracks/${formTrackId}/cues`, {
          method: "POST",
          body: JSON.stringify(body)
        });
      }
      cueOpen = false;
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "저장하지 못했습니다");
    } finally {
      cueSaving = false;
    }
  }

  async function deleteCue() {
    if (!editingCue) return;
    cueSaving = true;
    try {
      await apiRequest(`/productions/${pid}/cue-sheet/cues/${editingCue.id}`, { method: "DELETE" });
      cueOpen = false;
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "삭제하지 못했습니다");
    } finally {
      cueSaving = false;
    }
  }

  // 타임라인 큐 상세에서 바로 삭제(소프트) — 되돌리기는 트랙 관리의 큐 전체 되돌리기.
  async function studioDeleteCue(cueId: string) {
    try {
      await apiRequest(`/productions/${pid}/cue-sheet/cues/${cueId}`, { method: "DELETE" });
      toast.success("큐를 삭제했습니다");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "삭제하지 못했습니다");
    }
  }

  // 타임라인에서 클립 끝을 끌어 큐 길이(초)를 바꾼다.
  async function studioResizeCue(cueId: string, durationSec: number) {
    try {
      await apiRequest(`/productions/${pid}/cue-sheet/cues/${cueId}`, {
        method: "PATCH",
        body: JSON.stringify({ durationSec })
      });
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "길이를 바꾸지 못했습니다");
    }
  }

  // 타임라인에서 시간 지정 클립을 끌어 시작 시각(ms)을 바꾼다.
  async function studioMoveCue(cueId: string, startMs: number) {
    try {
      await apiRequest(`/productions/${pid}/cue-sheet/cues/${cueId}`, {
        method: "PATCH",
        body: JSON.stringify({ startMs })
      });
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "시작 시각을 바꾸지 못했습니다");
    }
  }

  // 타임라인에서 클립을 끌어 순서(시간 위치)를 바꾼다.
  async function studioReorderCue(cueId: string, sceneId: string | null, orderedTrackCueIds: string[]) {
    try {
      await apiRequest(`/productions/${pid}/cue-sheet/cues/${cueId}/reorder`, {
        method: "PATCH",
        body: JSON.stringify({ sceneId: sceneId ?? undefined, orderedTrackCueIds })
      });
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "순서를 바꾸지 못했습니다");
    }
  }

  async function createDefaultTracks() {
    trackSaving = true;
    try {
      await apiRequest(`/productions/${pid}/cue-sheet/tracks/defaults`, { method: "POST" });
      toast.success("기본 트랙을 만들었습니다");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "트랙을 만들지 못했습니다");
    } finally {
      trackSaving = false;
    }
  }

  function onStudioEdit(cueId: string) {
    const cue = board?.cues.find((item) => item.id === cueId);
    if (cue && editableSet.has(cue.trackId)) {
      openEditCue(cue);
    }
  }
</script>

<svelte:head>
  <title>큐시트 — {title}</title>
</svelte:head>

<div class="mx-auto w-full {view === 'timeline' ? 'max-w-[1500px]' : 'max-w-xl'}">
  <div class="flex flex-wrap items-center gap-1 py-2">
    <Button href={`/app/p/${pid}`} variant="ghost" size="icon" class="-ms-2 size-8" aria-label="공연 홈으로">
      <ChevronLeftIcon />
    </Button>
    <div>
      <h1 class="text-xl font-bold tracking-tight">큐시트</h1>
      <p class="text-muted-foreground text-sm">{title}</p>
    </div>
    <div class="ms-auto flex flex-wrap items-center gap-1.5">
      {#if board && board.tracks.length > 0}
        <div class="bg-muted flex rounded-lg p-0.5">
          <Button
            variant={view === "list" ? "secondary" : "ghost"}
            size="sm"
            class="h-7 px-3 text-xs whitespace-nowrap"
            onclick={() => (view = "list")}
          >
            표
          </Button>
          <Button
            variant={view === "timeline" ? "secondary" : "ghost"}
            size="sm"
            class="h-7 px-3 text-xs whitespace-nowrap"
            onclick={() => (view = "timeline")}
          >
            타임라인
          </Button>
        </div>
      {/if}
      {#if canManage}
        <Button variant="outline" size="sm" class="h-8 whitespace-nowrap" onclick={() => (aiOpen = true)}>
          <SparklesIcon />
          AI 초안
        </Button>
        <Button variant="outline" size="sm" class="h-8 whitespace-nowrap" onclick={() => (tracksOpen = true)}>
          <Settings2Icon />
          트랙
        </Button>
        <label
          class="border-input hover:bg-accent inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm font-medium whitespace-nowrap transition-colors {backgroundUploading
            ? 'pointer-events-none opacity-50'
            : ''}"
          title="공연 뒷배경으로 재생할 영상을 올립니다 (mp4·webm·mov, 최대 500MB)"
        >
          <MonitorIcon class="size-4" />
          {backgroundUploading ? "업로드 중…" : board?.production.backgroundAsset ? "배경 영상 교체" : "배경 영상"}
          <input
            type="file"
            accept="video/mp4,video/webm,video/quicktime"
            class="hidden"
            onchange={onPickBackground}
            disabled={backgroundUploading}
          />
        </label>
        {#if board?.production.backgroundAsset}
          <Button
            variant="ghost"
            size="sm"
            class="h-8 whitespace-nowrap"
            onclick={clearBackground}
            disabled={backgroundUploading}
          >
            해제
          </Button>
        {/if}
      {/if}
      {#if canEditSomething && (board?.tracks.length ?? 0) > 0}
        <Button size="sm" class="h-8 whitespace-nowrap" onclick={() => openCreateCue()}>
          <PlusIcon />
          큐 추가
        </Button>
      {/if}
    </div>
  </div>

  {#if showMineToggle}
    <div class="mt-1 flex gap-1.5">
      <Button
        variant={onlyMine ? "ghost" : "secondary"}
        size="sm"
        class="h-7 px-3 text-xs"
        onclick={() => (onlyMine = false)}
      >
        전체
      </Button>
      <Button
        variant={onlyMine ? "secondary" : "ghost"}
        size="sm"
        class="h-7 px-3 text-xs"
        onclick={() => (onlyMine = true)}
      >
        내 큐만
      </Button>
    </div>
  {/if}

  {#if !loading && castingRoles.length > 0}
    <div class="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
      <span class="font-semibold">출연 {castingRoles.length}</span>
      <span class="text-muted-foreground/50">·</span>
      {#each castingRoles as role (role.id)}
        <span class="bg-muted rounded-md px-1.5 py-0.5">{role.name}</span>
      {/each}
      {#if canManage}
        <a href={`/app/p/${pid}/manage/casting`} class="hover:text-foreground ms-1 underline underline-offset-2">캐스팅</a>
      {/if}
    </div>
  {/if}

  {#if loading}
    <div class="mt-4 space-y-2">
      {#each Array(5) as _, i (i)}
        <Skeleton class="h-16 w-full rounded-2xl" />
      {/each}
    </div>
  {:else if !board || board.tracks.length === 0}
    <div class="bg-card mt-4 rounded-2xl px-6 py-14 text-center">
      <p class="font-semibold">큐시트가 아직 준비되지 않았습니다</p>
      <p class="text-muted-foreground mt-1 text-sm">
        트랙(해설·배우·음악·효과음·영상·조명)을 만들고 각 담당자가 자기 큐를 작성합니다.
      </p>
      {#if canManage}
        <div class="mt-5 flex flex-wrap justify-center gap-2">
          <Button size="sm" onclick={createDefaultTracks} disabled={trackSaving}>기본 트랙 만들기</Button>
          <Button size="sm" variant="outline" onclick={() => (aiOpen = true)}>
            <SparklesIcon />
            대본으로 초안 만들기
          </Button>
          <Button size="sm" variant="outline" onclick={() => (tracksOpen = true)}>직접 구성</Button>
        </div>
      {/if}
    </div>
  {:else if view === "timeline"}
    <div class="border-primary/20 bg-primary/5 text-muted-foreground mt-4 flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs lg:hidden">
      <MonitorIcon class="size-4 shrink-0" />
      <span>타임라인은 화면이 넓은 PC에서 보기 편해요. 모바일에서는 <span class="text-foreground font-medium">표</span> 보기를 추천해요.</span>
    </div>
    <div class="mt-4 overflow-x-auto">
      <CueStudio
        scenes={board.scenes}
        tracks={board.tracks}
        cues={board.cues}
        editableTrackIds={board.viewer.editableTrackIds}
        background={backgroundVideo}
        canEditScript={canManage}
        onEditCue={onStudioEdit}
        onAddCue={canEditSomething ? (trackId, sceneId) => openCreateCue(trackId, sceneId ?? "") : undefined}
        onDeleteCue={canEditSomething ? studioDeleteCue : undefined}
        onResizeCue={canEditSomething ? studioResizeCue : undefined}
        onReorderCue={canEditSomething ? studioReorderCue : undefined}
        onMoveCue={canEditSomething ? studioMoveCue : undefined}
        onMoveBlock={canManage ? studioMoveBlock : undefined}
        onOpenScript={openScriptScene}
      />
    </div>
  {:else if board.cues.length === 0}
    <div class="bg-card mt-4 rounded-2xl px-6 py-14 text-center">
      <p class="font-semibold">아직 등록된 큐가 없습니다</p>
      <p class="text-muted-foreground mt-1 text-sm">큐 추가 버튼으로 첫 큐를 등록해 보세요.</p>
    </div>
  {:else if onlyMine && mineCount === 0}
    <div class="bg-card mt-4 rounded-2xl px-6 py-14 text-center">
      <p class="font-semibold">내 담당 큐가 없습니다</p>
      <p class="text-muted-foreground mt-1 text-sm">담당 트랙에 큐를 추가해 보세요.</p>
    </div>
  {:else}
    <!-- 표 (데스크톱) -->
    <div class="bg-card mt-4 hidden overflow-x-auto rounded-2xl border md:block">
      <table class="w-full min-w-[720px] text-sm">
        <thead>
          <tr class="text-muted-foreground/80 border-b text-start text-[11px] font-bold tracking-wider uppercase">
            <th class="px-4 py-2.5 text-start">큐</th>
            <th class="px-3 py-2.5 text-start">트랙</th>
            <th class="px-3 py-2.5 text-start">내용</th>
            <th class="px-3 py-2.5 text-start">계기 (트리거)</th>
            <th class="px-3 py-2.5 text-start">메모</th>
          </tr>
        </thead>
        <tbody>
          {#each sceneGroups as [sceneId, group] (sceneId)}
            <tr class="bg-muted/50">
              <td colspan="5" class="text-muted-foreground px-4 py-1.5 text-[11px] font-bold tracking-wide uppercase">
                {group.label}
              </td>
            </tr>
            {#each group.cues as cue (cue.id)}
              {@const color = trackColor.get(cue.trackId) ?? PALETTE[0]}
              {@const mine = editableSet.has(cue.trackId)}
              <tr
                class="border-border/50 border-b transition-opacity last:border-0
                  {mine ? 'bg-primary/[0.04] hover:bg-accent/60 cursor-pointer' : ''}
                  {onlyMine && !mine ? 'opacity-35' : ''}"
                onclick={() => mine && openEditCue(cue)}
              >
                <td class="px-4 py-2.5 font-mono text-[13px] font-bold whitespace-nowrap tabular-nums" style={`color:${color};`}>
                  {cue.cueNumber}
                </td>
                <td class="px-3 py-2.5 whitespace-nowrap">
                  <span class="me-1.5 inline-block size-1.5 rounded-full align-[1px]" style={`background:${color};`}></span>
                  <span class="text-muted-foreground text-xs font-semibold">{trackName(cue.trackId)}</span>
                </td>
                <td class="px-3 py-2.5 font-medium {mine ? '' : 'text-foreground/85'}">
                  {#if cue.character}
                    <span class="bg-primary/10 text-primary me-1.5 rounded px-1.5 py-0.5 text-xs font-semibold">{cue.character.name}</span>
                  {/if}
                  {cue.content}
                  {#if cue.durationSec}
                    <span class="text-muted-foreground ms-1.5 font-mono text-xs">{fmtDuration(cue.durationSec)}</span>
                  {/if}
                </td>
                <td class="text-muted-foreground px-3 py-2.5">{cue.trigger ?? "—"}</td>
                <td class="text-muted-foreground px-3 py-2.5">{cue.note ?? "—"}</td>
              </tr>
            {/each}
          {/each}
        </tbody>
      </table>
      <p class="text-muted-foreground/60 border-t px-4 py-2 text-[11.5px]">
        {#if canEditSomething}
          {onlyMine ? "흐린 행은 내 큐가 아닌 구간(맥락용)입니다 · " : ""}내 트랙 행만 눌러서 수정할 수 있습니다
        {:else}
          큐시트는 읽기 전용입니다.
        {/if}
      </p>
    </div>

    <!-- 카드 (모바일) -->
    <div class="mt-4 grid gap-4 md:hidden">
      {#each sceneGroups as [sceneId, group] (sceneId)}
        <section>
          <p class="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase">{group.label}</p>
          <div class="grid gap-2">
            {#each group.cues as cue (cue.id)}
              {@const color = trackColor.get(cue.trackId) ?? PALETTE[0]}
              {@const mine = editableSet.has(cue.trackId)}
              <button
                type="button"
                class="bg-card flex items-start gap-4 rounded-2xl px-5 py-4 text-start transition-opacity {mine
                  ? 'hover:bg-accent/60 cursor-pointer transition-colors'
                  : 'cursor-default'} {onlyMine && !mine ? 'opacity-40' : ''}"
                onclick={() => openEditCue(cue)}
              >
                <span class="w-10 shrink-0 pt-0.5 font-mono text-sm font-bold tabular-nums" style={`color: ${color};`}>
                  {cue.cueNumber}
                </span>
                <span class="min-w-0 flex-1">
                  <span class="flex flex-wrap items-center gap-2">
                    <span class="font-semibold">
                      {#if cue.character}<span class="text-primary me-1">[{cue.character.name}]</span>{/if}{cue.content}
                    </span>
                    {#if cue.durationSec}
                      <span class="text-muted-foreground ms-1 font-mono text-xs">{fmtDuration(cue.durationSec)}</span>
                    {/if}
                    <Badge variant="outline" class="gap-1 text-xs">
                      <span class="size-1.5 rounded-full" style={`background: ${color};`}></span>
                      {trackName(cue.trackId)}
                    </Badge>
                  </span>
                  {#if cue.trigger}
                    <span class="text-muted-foreground mt-0.5 block text-sm">계기 · {cue.trigger}</span>
                  {/if}
                  {#if cue.note}
                    <span class="text-muted-foreground mt-0.5 block text-sm">{cue.note}</span>
                  {/if}
                </span>
              </button>
            {/each}
          </div>
        </section>
      {/each}
    </div>
  {/if}
</div>

<!-- 큐 작성·수정 -->
<Dialog.Root bind:open={cueOpen}>
  <Dialog.Content class="max-h-[85dvh] overflow-y-auto sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>{editingCue ? "큐 수정" : "큐 추가"}</Dialog.Title>
      <Dialog.Description>계기(트리거)와 실행할 내용을 짧고 분명하게 적습니다.</Dialog.Description>
    </Dialog.Header>
    <form class="grid gap-4" onsubmit={saveCue}>
      <div class="grid gap-2">
        <Label>트랙</Label>
        <Select.Root type="single" bind:value={formTrackId} disabled={editingCue !== null}>
          <Select.Trigger class="w-full">{trackName(formTrackId) || "트랙 선택"}</Select.Trigger>
          <Select.Content>
            {#each (board?.tracks ?? []).filter((track) => editableSet.has(track.id)) as track (track.id)}
              <Select.Item value={track.id} label={track.name} />
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
      <div class="grid gap-2">
        <Label>장면</Label>
        <Select.Root type="single" bind:value={formSceneId}>
          <Select.Trigger class="w-full">
            {formSceneId ? sceneName(formSceneId) : "장면 미지정"}
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="" label="장면 미지정" />
            {#each board?.scenes ?? [] as scene (scene.id)}
              <Select.Item value={scene.id} label={`${scene.act.title} · ${scene.title}`} />
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
      <div class="grid grid-cols-3 gap-3">
        <div class="grid gap-2">
          <Label for="cueNumber">큐 번호</Label>
          <Input id="cueNumber" bind:value={formCueNumber} maxlength={20} placeholder="자동" />
        </div>
        <div class="col-span-2 grid gap-2">
          <Label for="trigger">계기 (트리거)</Label>
          <Input id="trigger" bind:value={formTrigger} maxlength={200} placeholder="예: 해설 첫 멘트 직후" />
        </div>
      </div>
      <div class="grid gap-2">
        <Label for="content">내용 <span class="text-destructive">*</span></Label>
        <Input id="content" bind:value={formContent} required maxlength={500} placeholder="예: 무대 웜 톤 오픈" />
      </div>
      {#if isActorTrack}
        <div class="grid gap-2">
          <Label>인물 <span class="text-muted-foreground font-normal">(누가 하는 행동인지 — 인물별 보기에 쓰여요)</span></Label>
          <Select.Root type="single" bind:value={formCharacterId}>
            <Select.Trigger class="w-full">
              {formCharacterId
                ? (castingRoles.find((role) => role.id === formCharacterId)?.name ?? "인물")
                : "인물 미지정"}
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="" label="인물 미지정" />
              {#each castingRoles as role (role.id)}
                <Select.Item value={role.id} label={role.name} />
              {/each}
            </Select.Content>
          </Select.Root>
          {#if castingRoles.length === 0}
            <p class="text-muted-foreground text-xs">아직 배역이 없어요. 캐스팅에서 배역을 만들면 여기서 고를 수 있어요.</p>
          {/if}
        </div>
      {/if}
      <div class="grid gap-2">
        <Label for="durationSec">
          예상 길이 <span class="text-muted-foreground font-normal">(초 — 타임라인 폭·상영시간 계산에 쓰여요)</span>
        </Label>
        <div class="flex flex-wrap items-center gap-1.5">
          <Input
            id="durationSec"
            type="number"
            min="1"
            max="3600"
            bind:value={formDurationSec}
            class="w-24"
            placeholder="초"
          />
          {#each DURATION_PRESETS as preset (preset.value)}
            <button
              type="button"
              class="rounded-full border px-2.5 py-1 text-xs font-medium transition-colors
                {formDurationSec === String(preset.value)
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border/70 text-muted-foreground hover:bg-accent/60'}"
              onclick={() => (formDurationSec = String(preset.value))}
            >
              {preset.label}
            </button>
          {/each}
          {#if formDurationSec}
            <button
              type="button"
              class="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline"
              onclick={() => (formDurationSec = "")}
            >
              지우기
            </button>
          {/if}
        </div>
      </div>
      <div class="grid gap-2">
        <Label>
          미디어 첨부 <span class="text-muted-foreground font-normal">(영상·음원 파일 — 영상/음악 트랙 큐에 연결)</span>
        </Label>
        <div class="flex items-center gap-2">
          <Select.Root type="single" bind:value={formAssetId}>
            <Select.Trigger class="w-full">
              {formAssetId
                ? (() => {
                    const found = mediaAssets.find((asset) => asset.id === formAssetId);
                    return found ? `${found.kind === "VIDEO" ? "🎬" : "🎵"} ${mediaName(found)}` : "첨부 파일";
                  })()
                : "첨부 없음"}
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="" label="첨부 없음" />
              {#each mediaAssets as asset (asset.id)}
                <Select.Item
                  value={asset.id}
                  label={`${asset.kind === "VIDEO" ? "🎬" : "🎵"} ${mediaName(asset)}`}
                />
              {/each}
            </Select.Content>
          </Select.Root>
          <label
            class="border-input hover:bg-accent inline-flex h-9 shrink-0 cursor-pointer items-center rounded-md border px-3 text-xs font-medium whitespace-nowrap transition-colors {mediaUploading
              ? 'pointer-events-none opacity-50'
              : ''}"
            title="영상(mp4·webm·mov) 또는 음원(mp3·wav·m4a·aac)을 올립니다"
          >
            {mediaUploading ? "업로드 중…" : "파일 올리기"}
            <input
              type="file"
              accept="video/mp4,video/webm,video/quicktime,audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/aac,audio/x-m4a"
              class="hidden"
              onchange={onPickCueMedia}
              disabled={mediaUploading}
            />
          </label>
        </div>
        {#if mediaAssets.length === 0}
          <p class="text-muted-foreground text-xs">아직 올라온 영상·음원이 없어요. 파일 올리기로 추가하면 여기서 고를 수 있어요.</p>
        {/if}
      </div>
      <div class="grid gap-2">
        <Label for="note">메모</Label>
        <Textarea id="note" bind:value={formNote} rows={2} maxlength={200} />
      </div>
      <Dialog.Footer class="gap-2 {editingCue ? 'sm:justify-between' : ''}">
        {#if editingCue}
          <Button type="button" variant="ghost" class="text-destructive" onclick={deleteCue} disabled={cueSaving}>
            삭제
          </Button>
        {/if}
        <div class="flex gap-2">
          <Button type="button" variant="ghost" onclick={() => (cueOpen = false)}>취소</Button>
          <Button type="submit" disabled={cueSaving || !formTrackId || !formContent.trim()}>
            {cueSaving ? "저장 중..." : "저장"}
          </Button>
        </div>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

<AiCueDraftDialog {pid} bind:open={aiOpen} onApplied={load} />

<CueSheetSettingsDialog
  {pid}
  bind:open={tracksOpen}
  tracks={board?.tracks ?? []}
  cueCount={board?.cues.length ?? 0}
  {canManage}
  palette={PALETTE}
  onReloaded={load}
/>

