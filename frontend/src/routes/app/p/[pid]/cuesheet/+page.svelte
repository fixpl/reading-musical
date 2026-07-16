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
  import { apiRequest, streamNdjson, uploadForm, type StreamEvent } from "$lib/api/client";
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
    author: { id: string; name: string };
  };

  type CastingRole = { id: string; name: string };

  type Scene = {
    id: string;
    title: string;
    order: number;
    summary?: string | null;
    act: { id: string; title: string; order: number };
  };

  type Board = {
    production: { id: string; title: string };
    tracks: Track[];
    cues: Cue[];
    scenes: Scene[];
    viewer: { canManageTracks: boolean; editableTrackIds: string[] };
  };

  type Person = { id: string; user: { name: string } };

  type DraftCue = { track: string; content: string; trigger: string | null; note: string | null; character?: string | null; seconds?: number | null };
  type DraftLine = { kind: string; speaker: string | null; text: string };
  type DraftScene = { title: string; summary: string | null; lines: DraftLine[]; cues: DraftCue[] };
  type DraftAct = { title: string; scenes: DraftScene[] };
  type AiDraft = { acts: DraftAct[] };
  type AiStats = { acts: number; scenes: number; cues: number; lines: number; cuesByTrack: Record<string, number> };

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
  let cueSaving = $state(false);
  let castingRoles = $state<CastingRole[]>([]);

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

  // AI 초안 다이얼로그
  let aiOpen = $state(false);
  let aiStep = $state<"input" | "preview">("input");
  let aiText = $state("");
  let aiScriptTitle = $state("");
  let aiBusy = $state(false);
  let aiUploading = $state(false);
  let aiDraft = $state<AiDraft | null>(null);
  let aiStats = $state<AiStats | null>(null);
  let aiProgress = $state<{ done: number; total: number } | null>(null);
  // 적용 대상: "new"(새 대본) 또는 기존 스크립트 id
  let aiTarget = $state("new");
  let aiScripts = $state<Array<{ id: string; title: string }>>([]);

  // 트랙 관리 다이얼로그
  let tracksOpen = $state(false);
  let people = $state<Person[]>([]);
  let newTrackName = $state("");
  let newTrackOwner = $state("");
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
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "큐시트를 불러오지 못했습니다");
    } finally {
      loading = false;
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
        durationSec: Number.isFinite(parsedDuration) && parsedDuration > 0 ? Math.min(3600, parsedDuration) : null
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

  async function importMusic() {
    trackSaving = true;
    try {
      const result = await apiRequest<{ imported: number }>(`/productions/${pid}/cue-sheet/tracks/import-music`, {
        method: "POST"
      });
      toast.success(
        result.imported > 0 ? `음악 큐 ${result.imported}개를 가져왔습니다` : "가져올 새 음악 큐가 없습니다"
      );
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "가져오지 못했습니다");
    } finally {
      trackSaving = false;
    }
  }

  async function openTracks() {
    tracksOpen = true;
    if (people.length === 0) {
      try {
        const result = await apiRequest<{ people: Person[] }>(`/productions/${pid}/people`);
        people = result.people;
      } catch {
        // 담당자 선택은 선택 사항이므로 실패해도 다이얼로그는 연다.
      }
    }
  }

  async function addTrack(event: SubmitEvent) {
    event.preventDefault();
    if (!newTrackName.trim()) return;
    trackSaving = true;
    try {
      await apiRequest(`/productions/${pid}/cue-sheet/tracks`, {
        method: "POST",
        body: JSON.stringify({
          name: newTrackName.trim(),
          ownerMembershipId: newTrackOwner || undefined
        })
      });
      newTrackName = "";
      newTrackOwner = "";
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "트랙을 추가하지 못했습니다");
    } finally {
      trackSaving = false;
    }
  }

  async function setTrackOwner(track: Track, membershipId: string) {
    try {
      await apiRequest(`/productions/${pid}/cue-sheet/tracks/${track.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ownerMembershipId: membershipId || null })
      });
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "담당자를 바꾸지 못했습니다");
    }
  }

  // 트랙 삭제는 그 트랙의 큐가 함께 지워지므로 두 번 눌러 확정한다.
  let confirmingTrackId = $state<string | null>(null);
  let trackConfirmTimer: ReturnType<typeof setTimeout> | undefined;
  let confirmingReset = $state(false);
  let resetConfirmTimer: ReturnType<typeof setTimeout> | undefined;
  let resetting = $state(false);

  function requestRemoveTrack(track: Track) {
    if (confirmingTrackId === track.id) {
      confirmingTrackId = null;
      clearTimeout(trackConfirmTimer);
      void removeTrack(track);
      return;
    }
    confirmingTrackId = track.id;
    clearTimeout(trackConfirmTimer);
    trackConfirmTimer = setTimeout(() => (confirmingTrackId = null), 3000);
  }

  async function removeTrack(track: Track) {
    try {
      await apiRequest(`/productions/${pid}/cue-sheet/tracks/${track.id}`, { method: "DELETE" });
      toast.success(`${track.name} 트랙을 삭제했습니다`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "삭제하지 못했습니다");
    }
  }

  function requestResetCues() {
    if (confirmingReset) {
      confirmingReset = false;
      clearTimeout(resetConfirmTimer);
      void resetCues();
      return;
    }
    confirmingReset = true;
    clearTimeout(resetConfirmTimer);
    resetConfirmTimer = setTimeout(() => (confirmingReset = false), 3000);
  }

  async function resetCues() {
    resetting = true;
    try {
      const result = await apiRequest<{ removedCues: number }>(`/productions/${pid}/cue-sheet/reset`, {
        method: "POST"
      });
      await load();
      // 소프트 삭제라 데이터는 남아 있다 — 바로 되돌리기 제공.
      toast.success(`큐 ${result.removedCues}개를 비웠습니다. 데이터는 보관돼요.`, {
        action: { label: "되돌리기", onClick: () => void restoreCues() }
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "큐시트를 초기화하지 못했습니다");
    } finally {
      resetting = false;
    }
  }

  async function restoreCues() {
    try {
      const result = await apiRequest<{ restoredCues: number }>(`/productions/${pid}/cue-sheet/restore`, {
        method: "POST"
      });
      await load();
      toast.success(`큐 ${result.restoredCues}개를 되돌렸습니다`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "되돌리지 못했습니다");
    }
  }

  let generatingActor = $state(false);
  async function generateActorCues() {
    generatingActor = true;
    try {
      const result = await apiRequest<{ created: number }>(
        `/productions/${pid}/cue-sheet/actor-cues-from-script`,
        { method: "POST" }
      );
      await load();
      if (result.created > 0) {
        toast.success(`대본 지문에서 배우 큐 ${result.created}개를 만들었습니다`);
      } else {
        toast.info("대본에 배우 큐로 만들 지문이 없습니다");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "배우 큐를 만들지 못했습니다");
    } finally {
      generatingActor = false;
    }
  }

  let autotagging = $state(false);
  async function autotagActors() {
    autotagging = true;
    try {
      const result = await apiRequest<{ tagged: number; total: number }>(
        `/productions/${pid}/cue-sheet/autotag-actors`,
        { method: "POST" }
      );
      await load();
      toast.success(`배우 큐 ${result.tagged}개를 인물별로 정리했습니다`, {
        description: result.total > result.tagged ? `${result.total - result.tagged}개는 인물이 특정되지 않아 미지정으로 남았어요.` : undefined
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "자동 태깅에 실패했습니다");
    } finally {
      autotagging = false;
    }
  }

  async function openAi() {
    aiStep = "input";
    aiDraft = null;
    aiStats = null;
    aiProgress = null;
    aiTarget = "new";
    aiOpen = true;
    try {
      aiScripts = await apiRequest<Array<{ id: string; title: string }>>(`/productions/${pid}/scripts`);
    } catch {
      aiScripts = [];
    }
  }

  async function onAiFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    aiUploading = true;
    try {
      const form = new FormData();
      form.append("file", file);
      const result = await uploadForm<{ text: string; filename: string; chars: number }>(
        `/productions/${pid}/ai/extract`,
        form
      );
      aiText = result.text;
      if (!aiScriptTitle.trim()) {
        aiScriptTitle = file.name.replace(/\.[^.]+$/, "");
      }
      toast.success(`파일에서 ${result.chars.toLocaleString()}자를 불러왔어요.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "파일을 읽지 못했습니다");
    } finally {
      aiUploading = false;
    }
  }

  async function generateAi() {
    if (aiText.trim().length < 80) {
      toast.error("대본 내용을 80자 이상 붙여넣어 주세요");
      return;
    }
    aiBusy = true;
    aiProgress = null;
    let done = false;
    // 긴 대본은 조각으로 나눠 처리하므로 넉넉히 기다린다. 그래도 안 끝나면 중단.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180_000);
    try {
      await streamNdjson(
        `/productions/${pid}/ai/cue-draft/stream`,
        { text: aiText },
        (event: StreamEvent) => {
          if (event.type === "progress") {
            aiProgress = { done: Number(event.done) || 0, total: Number(event.total) || 1 };
          } else if (event.type === "result") {
            aiDraft = event.draft as AiDraft;
            aiStats = event.stats as AiStats;
            aiStep = "preview";
            done = true;
            if (typeof event.truncatedChunks === "number" && event.truncatedChunks > 0) {
              toast.warning("대본이 매우 길어 앞부분만 처리했어요. 나머지는 이어서 한 번 더 만들어 주세요.");
            } else if (typeof event.failedChunks === "number" && event.failedChunks > 0) {
              toast.warning(`일부 구간(${event.failedChunks}조각)을 읽지 못했어요. 결과를 확인해 주세요.`);
            }
          } else if (event.type === "error") {
            throw new Error(typeof event.message === "string" ? event.message : "초안을 만들지 못했습니다");
          }
        },
        { signal: controller.signal }
      );
      if (!done) {
        toast.error("초안을 만들지 못했습니다. 다시 시도해 주세요.");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        toast.error("시간이 오래 걸려 멈췄어요. 대본을 막 단위로 나눠 다시 시도해 주세요.");
      } else {
        toast.error(error instanceof Error ? error.message : "초안을 만들지 못했습니다");
      }
    } finally {
      clearTimeout(timer);
      aiBusy = false;
      aiProgress = null;
    }
  }

  async function applyAi() {
    if (!aiDraft) return;
    aiBusy = true;
    try {
      const result = await apiRequest<{ scenes: number; cues: number; blocks: number; appended: boolean }>(
        `/productions/${pid}/ai/cue-draft/apply`,
        {
          method: "POST",
          body: JSON.stringify({
            scriptTitle: aiTarget === "new" ? aiScriptTitle.trim() || undefined : undefined,
            targetScriptId: aiTarget === "new" ? undefined : aiTarget,
            draft: aiDraft
          })
        }
      );
      toast.success(
        `${result.appended ? "기존 대본에 이어서 " : ""}장면 ${result.scenes}개 · 대사 ${result.blocks}줄 · 큐 ${result.cues}개를 등록했습니다`
      );
      aiOpen = false;
      aiText = "";
      aiScriptTitle = "";
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "적용하지 못했습니다");
    } finally {
      aiBusy = false;
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
    <div class="ms-auto flex items-center gap-1.5">
      {#if board && board.tracks.length > 0}
        <div class="bg-muted flex rounded-lg p-0.5">
          <Button
            variant={view === "list" ? "secondary" : "ghost"}
            size="sm"
            class="h-7 px-3 text-xs"
            onclick={() => (view = "list")}
          >
            표
          </Button>
          <Button
            variant={view === "timeline" ? "secondary" : "ghost"}
            size="sm"
            class="h-7 px-3 text-xs"
            onclick={() => (view = "timeline")}
          >
            타임라인
          </Button>
        </div>
      {/if}
      {#if canManage}
        <Button variant="outline" size="sm" class="h-8" onclick={openAi}>
          <SparklesIcon />
          AI 초안
        </Button>
        <Button variant="outline" size="sm" class="h-8" onclick={openTracks}>
          <Settings2Icon />
          트랙
        </Button>
      {/if}
      {#if canEditSomething && (board?.tracks.length ?? 0) > 0}
        <Button size="sm" class="h-8" onclick={() => openCreateCue()}>
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
          <Button size="sm" variant="outline" onclick={openAi}>
            <SparklesIcon />
            대본으로 초안 만들기
          </Button>
          <Button size="sm" variant="outline" onclick={openTracks}>직접 구성</Button>
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
        onEditCue={onStudioEdit}
        onAddCue={canEditSomething ? (trackId, sceneId) => openCreateCue(trackId, sceneId ?? "") : undefined}
        onDeleteCue={canEditSomething ? studioDeleteCue : undefined}
        onResizeCue={canEditSomething ? studioResizeCue : undefined}
        onReorderCue={canEditSomething ? studioReorderCue : undefined}
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

<!-- AI 초안 -->
<Dialog.Root bind:open={aiOpen}>
  <Dialog.Content class="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title>AI 큐시트 초안</Dialog.Title>
      <Dialog.Description>
        {aiStep === "input"
          ? "대본을 붙여넣으면 장면 구조·대사 본문·배역·부서별 큐까지 한 번에 준비해 드립니다. 등록 전에 확인합니다."
          : "초안을 확인하고 적용하세요. 적용하면 대본과 큐시트에 함께 등록되고, 이후 자유롭게 고칠 수 있습니다."}
      </Dialog.Description>
    </Dialog.Header>

    {#if aiStep === "input"}
      <div class="grid gap-4">
        <div class="grid gap-2">
          <Label for="aiTitle">대본 제목</Label>
          <Input id="aiTitle" bind:value={aiScriptTitle} maxlength={120} placeholder="예: 통합 리허설 대본" />
        </div>
        <div class="grid gap-2">
          <div class="flex items-center justify-between">
            <Label for="aiText">대본 내용</Label>
            <label class="text-primary cursor-pointer text-xs font-medium hover:underline">
              {aiUploading ? "불러오는 중..." : "파일 불러오기 (txt·docx·pdf)"}
              <input
                type="file"
                accept=".txt,.md,.docx,.pdf,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                class="hidden"
                disabled={aiUploading}
                onchange={onAiFile}
              />
            </label>
          </div>
          <Textarea
            id="aiText"
            bind:value={aiText}
            class="h-64 resize-none overflow-y-auto font-mono text-xs leading-relaxed"
            placeholder="대본 전체를 붙여넣어 주세요. 한글 파일이나 워드 문서는 내용을 복사해서 붙여넣으면 됩니다. 길어도 괜찮아요 — 긴 대본은 자동으로 나눠서 처리합니다."
          />
          <p class="text-muted-foreground text-xs">
            {aiText.trim().length.toLocaleString()}자
            {#if aiText.trim().length > 4500}
              · 약 {Math.ceil(aiText.trim().length / 4500)}조각으로 나눠 처리해요
            {/if}
          </p>
        </div>
        {#if aiBusy}
          <div class="bg-muted/60 grid gap-2 rounded-xl px-4 py-3">
            <div class="flex items-center gap-3">
              <span class="border-primary/30 border-t-primary size-4 shrink-0 animate-spin rounded-full border-2"></span>
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium">대본을 읽고 장면·대사·큐로 정리하고 있어요</p>
                <p class="text-muted-foreground mt-0.5 text-xs">
                  {#if aiProgress && aiProgress.total > 1}
                    {aiProgress.done}/{aiProgress.total} 조각 처리했어요
                  {:else}
                    잠시만요, 대본을 읽고 있어요…
                  {/if}
                </p>
              </div>
              {#if aiProgress && aiProgress.total > 1}
                <span class="text-primary text-sm font-semibold tabular-nums">
                  {Math.round((aiProgress.done / aiProgress.total) * 100)}%
                </span>
              {/if}
            </div>
            {#if aiProgress && aiProgress.total > 1}
              <div class="bg-border h-1.5 overflow-hidden rounded-full">
                <div
                  class="bg-primary h-full rounded-full transition-all duration-300"
                  style={`width: ${Math.round((aiProgress.done / aiProgress.total) * 100)}%`}
                ></div>
              </div>
            {/if}
          </div>
        {/if}
        <Dialog.Footer class="gap-2">
          <Button type="button" variant="ghost" onclick={() => (aiOpen = false)} disabled={aiBusy}>취소</Button>
          <Button type="button" onclick={generateAi} disabled={aiBusy || aiText.trim().length < 80}>
            {aiBusy ? "분석 중..." : "초안 만들기"}
          </Button>
        </Dialog.Footer>
      </div>
    {:else if aiDraft}
      <div class="grid gap-4">
        {#if aiStats}
          <div class="flex flex-wrap gap-1.5">
            <Badge variant="secondary">막 {aiStats.acts}</Badge>
            <Badge variant="secondary">장면 {aiStats.scenes}</Badge>
            <Badge variant="secondary">대사 {aiStats.lines}줄</Badge>
            <Badge variant="secondary">큐 {aiStats.cues}</Badge>
            {#each Object.entries(aiStats.cuesByTrack) as [track, count] (track)}
              <Badge variant="outline">{track} {count}</Badge>
            {/each}
          </div>
        {/if}
        <div class="border-border/60 grid max-h-80 gap-4 overflow-y-auto rounded-xl border p-4">
          {#each aiDraft.acts as act, actIndex (actIndex)}
            <div class="grid gap-3">
              <p class="text-muted-foreground text-xs font-bold tracking-wide uppercase">{act.title}</p>
              {#each act.scenes as scene, sceneIndex (sceneIndex)}
                <div>
                  <p class="text-sm font-semibold">
                    {scene.title}
                    {#if scene.lines?.length}
                      <span class="text-muted-foreground ms-1 text-xs font-normal">대사 {scene.lines.length}줄</span>
                    {/if}
                  </p>
                  {#if scene.summary}
                    <p class="text-muted-foreground mt-0.5 text-xs">{scene.summary}</p>
                  {/if}
                  {#if scene.cues.length > 0}
                    <ul class="mt-1.5 grid gap-1">
                      {#each scene.cues as cue, cueIndex (cueIndex)}
                        <li class="flex items-start gap-2 text-xs">
                          <Badge variant="outline" class="shrink-0 px-1.5 py-0 text-[11px]">{cue.track}</Badge>
                          <span class="min-w-0">
                            <span class="font-medium">
                              {#if cue.character}<span class="text-primary">[{cue.character}]</span> {/if}{cue.content}
                            </span>
                            {#if cue.seconds}
                              <span class="text-muted-foreground font-mono"> {cue.seconds}초</span>
                            {/if}
                            {#if cue.trigger}
                              <span class="text-muted-foreground"> — {cue.trigger}</span>
                            {/if}
                          </span>
                        </li>
                      {/each}
                    </ul>
                  {/if}
                </div>
              {/each}
            </div>
          {/each}
        </div>

        <div class="grid gap-2">
          <Label>어디에 등록할까요?</Label>
          <label class="border-border/60 has-[:checked]:border-primary has-[:checked]:bg-primary/5 flex cursor-pointer items-start gap-2.5 rounded-xl border px-3.5 py-2.5">
            <input type="radio" name="aiTarget" value="new" bind:group={aiTarget} class="accent-primary mt-0.5 size-4" />
            <span class="min-w-0">
              <span class="block text-sm font-medium">새 대본으로 등록</span>
              <span class="text-muted-foreground block text-xs">새 대본과 큐시트를 만들어요.</span>
            </span>
          </label>
          {#if aiTarget === "new"}
            <Input bind:value={aiScriptTitle} maxlength={120} placeholder="새 대본 제목 (예: 통합 리허설 대본)" class="ms-6" />
          {/if}
          {#each aiScripts as script (script.id)}
            <label class="border-border/60 has-[:checked]:border-primary has-[:checked]:bg-primary/5 flex cursor-pointer items-start gap-2.5 rounded-xl border px-3.5 py-2.5">
              <input type="radio" name="aiTarget" value={script.id} bind:group={aiTarget} class="accent-primary mt-0.5 size-4" />
              <span class="min-w-0">
                <span class="block text-sm font-medium">기존 대본에 이어붙이기</span>
                <span class="text-muted-foreground block truncate text-xs">{script.title} — 이 대본 뒤에 장면·큐를 추가</span>
              </span>
            </label>
          {/each}
        </div>

        <Dialog.Footer class="gap-2 sm:justify-between">
          <Button type="button" variant="ghost" onclick={() => (aiStep = "input")} disabled={aiBusy}>
            다시 만들기
          </Button>
          <div class="flex gap-2">
            <Button type="button" variant="ghost" onclick={() => (aiOpen = false)} disabled={aiBusy}>취소</Button>
            <Button type="button" onclick={applyAi} disabled={aiBusy}>
              {aiBusy ? "적용 중..." : "큐시트에 적용"}
            </Button>
          </div>
        </Dialog.Footer>
      </div>
    {/if}
  </Dialog.Content>
</Dialog.Root>

<!-- 트랙 관리 -->
<Dialog.Root bind:open={tracksOpen}>
  <Dialog.Content class="max-h-[85dvh] overflow-y-auto sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>트랙 관리</Dialog.Title>
      <Dialog.Description>
        트랙은 부서나 사람 단위입니다. 담당자를 지정하면 그 사람이 직접 큐를 작성합니다.
      </Dialog.Description>
    </Dialog.Header>

    <div class="grid gap-2">
      {#each board?.tracks ?? [] as track, index (track.id)}
        <div class="border-border/60 flex items-center gap-3 rounded-xl border px-3 py-2.5">
          <span class="size-2.5 shrink-0 rounded-full" style={`background: ${PALETTE[index % PALETTE.length]};`}></span>
          <span class="min-w-0 flex-1 truncate text-sm font-medium">{track.name}</span>
          <select
            class="border-input bg-background h-8 max-w-36 rounded-md border px-2 text-xs"
            value={track.ownerMembership?.id ?? ""}
            onchange={(event) => setTrackOwner(track, event.currentTarget.value)}
          >
            <option value="">담당자 없음</option>
            {#each people as person (person.id)}
              <option value={person.id}>{person.user.name}</option>
            {/each}
          </select>
          <Button
            variant="ghost"
            size="sm"
            class={`h-7 px-2 text-xs ${confirmingTrackId === track.id ? "text-destructive font-semibold" : "text-muted-foreground"}`}
            onclick={() => requestRemoveTrack(track)}
          >
            {confirmingTrackId === track.id ? "한 번 더 누르면 삭제돼요" : "삭제"}
          </Button>
        </div>
      {/each}
    </div>

    <form class="border-border/60 grid gap-3 rounded-xl border border-dashed p-3" onsubmit={addTrack}>
      <div class="grid grid-cols-2 gap-2">
        <Input bind:value={newTrackName} maxlength={40} placeholder="새 트랙 이름" />
        <select
          class="border-input bg-background h-9 rounded-md border px-2 text-sm"
          bind:value={newTrackOwner}
          onchange={(event) => {
            const person = people.find((item) => item.id === event.currentTarget.value);
            if (person && !newTrackName.trim()) newTrackName = person.user.name;
          }}
        >
          <option value="">담당자 없음</option>
          {#each people as person (person.id)}
            <option value={person.id}>{person.user.name}</option>
          {/each}
        </select>
      </div>
      <p class="text-muted-foreground/70 text-xs">
        담당자를 고르면 그 사람 이름의 전용 트랙(타임라인 레인)이 생기고, 본인이 직접 큐를 씁니다.
      </p>
      <div class="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onclick={importMusic}
          disabled={trackSaving}
        >
          음악 큐 가져오기
        </Button>
        <Button type="submit" size="sm" disabled={trackSaving || !newTrackName.trim()}>트랙 추가</Button>
      </div>
    </form>

    {#if canManage && (board?.cues.length ?? 0) > 0}
      <div class="border-border/60 grid gap-2 rounded-xl border border-dashed p-3">
        <div>
          <p class="text-sm font-semibold">배우 큐 정리</p>
          <p class="text-muted-foreground text-xs">대본 지문(무대 동작)으로 배우 큐를 만들고, 배우 큐를 내용 속 배역 이름으로 자동 태깅해 인물별 줄(▸)로 갈라 봅니다.</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            class="h-8 px-2.5 text-xs"
            onclick={generateActorCues}
            disabled={generatingActor}
          >
            {generatingActor ? "만드는 중..." : "대본 지문에서 배우 큐 만들기"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            class="h-8 px-2.5 text-xs"
            onclick={autotagActors}
            disabled={autotagging}
          >
            {autotagging ? "정리 중..." : "인물 자동 태깅"}
          </Button>
        </div>
      </div>

      <div class="border-destructive/20 grid gap-2 rounded-xl border border-dashed p-3">
        <div>
          <p class="text-sm font-semibold">큐시트 초기화</p>
          <p class="text-muted-foreground text-xs">잘못 등록한 큐를 한 번에 비웁니다. 트랙·담당자는 그대로 남고, 데이터는 보관돼 바로 되돌릴 수 있어요.</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          class={`h-8 justify-self-start px-2.5 text-xs ${confirmingReset ? "text-destructive font-semibold" : "text-muted-foreground"}`}
          onclick={requestResetCues}
          disabled={resetting}
        >
          {confirmingReset ? `한 번 더 누르면 큐 ${board?.cues.length ?? 0}개가 지워져요` : "큐 전체 지우기"}
        </Button>
      </div>
    {/if}
  </Dialog.Content>
</Dialog.Root>
