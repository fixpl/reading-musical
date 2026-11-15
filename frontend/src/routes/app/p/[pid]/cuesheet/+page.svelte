<script lang="ts">
    import { cuesheetCsv, downloadText } from "$lib/domain/cuesheet-export";
  import ImportDialog from "$lib/components/app/cuesheet-import-dialog.svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { onDestroy, tick, untrack } from "svelte";
  import { toast } from "svelte-sonner";
  import * as Dialog from "$lib/components/ui/dialog";
  import * as Select from "$lib/components/ui/select";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { ConfirmDialog, type ConfirmAsk } from "$lib/components/ui/confirm-dialog";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import { Textarea } from "$lib/components/ui/textarea";
  import { apiRequest, streamNdjson, uploadForm, uploadSignedObject, type StreamEvent } from "$lib/api/client";
  import { assertCurrentSession, captureSession, isCurrentSession, type ClientSession } from "$lib/api/session";
  import CueSheetSettingsDialog from "$lib/components/app/cue-sheet-settings-dialog.svelte";
  import CueStudio from "$lib/components/app/cue-studio.svelte";
  import { formatTime, mediaOwner, type CompositionBoard, type CompositionSection } from "$lib/domain/composition";
  import { cueSheetModel } from "$lib/domain/cue-sheet-model";
  import ChevronLeftIcon from "@lucide/svelte/icons/chevron-left";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import Settings2Icon from "@lucide/svelte/icons/settings-2";
  import BookOpenIcon from "@lucide/svelte/icons/book-open";
  import MonitorIcon from "@lucide/svelte/icons/monitor";

  let disposed = false;
  const viewSession = captureSession();
  onDestroy(() => { disposed = true; });

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
    updatedAt?: string;
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
    character?: { id: string; name: string } | null;
    durationSec: number | null;
    startMs?: number | null;
    asset?: CueAsset | null;
    fromComposition?: boolean;
    updatedAt?: string;
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
    characters?: CastingRole[];
  };


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

  let confirmation: { ask: ConfirmAsk };
  let board = $state<Board | null>(null);
  let title = $state("큐시트");
  let loading = $state(true);
  let loadError = $state("");
  let compositionSections = $state<CompositionSection[]>([]);
  let compositionRevision = $state<number | null>(null);
  // 기본은 타임라인(공연 기획의 핵심 화면). 좁은 화면은 표가 보기 편해 표로 시작하고, 고른 보기는 기억한다.
  let view = $state<"list" | "timeline">("list");
  const VIEW_KEY = "cuesheet-view";
  function initialView(): "list" | "timeline" {
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      if (saved === "list" || saved === "timeline") return saved;
    } catch { /* 저장소를 못 쓰는 환경에서는 기본값 */ }
    return window.innerWidth >= 1024 ? "timeline" : "list";
  }
  function chooseView(next: "list" | "timeline") {
    view = next;
    try { localStorage.setItem(VIEW_KEY, next); } catch { /* 무시 */ }
  }
  $effect(() => { view = initialView(); });
  let onlyMine = $state(false);
  let importOpen = $state(false);

  // 큐시트를 엑셀·한글 문서로 가져가 쓸 수 있게 CSV로 내려받는다(현재 보이는 모든 큐).
  // 현재 큐시트를 종이·PDF로 인쇄한다(표 보기 기준, 앱 메뉴는 빠진다).
  async function printSheet() {
    if (view !== "list") chooseView("list");
    await tick();
    window.print();
  }
  function exportCsv() {
    if (!board) return;
    const name = `${(title || "큐시트").replace(/[\\/:*?"<>|]/g, " ").trim()} 큐시트.csv`;
    downloadText(name, cuesheetCsv(model.cues, model.scenes, board.tracks));
    toast.success(`큐 ${model.cues.length}개를 ${name}로 내려받았어요.`);
  }

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
  const model = $derived(cueSheetModel(compositionSections, board?.scenes ?? [], board?.cues ?? [], board?.characters ?? castingRoles, board?.tracks ?? []));

  // 미디어(영상·음원) 라이브러리 + 배경 영상
  let mediaAssets = $state<MediaAsset[]>([]);
  let backgroundVideo = $state<{ url: string; mime: string } | null>(null);
  // 장·막 구성에서 장면에 연결한 반복 배경 영상 — 타임라인 스테이지에 깔린다.
  let sceneSectionIds = $state<Record<string, string>>({});
  let sceneVisuals = $state<Record<string, { url: string; kind: "VIDEO" | "IMAGE"; loop: boolean; sourceStartSec: number; label?: string }>>({});
  let signedMediaUrls = $state<Record<string, string>>({});
  // 자료별 서명 시각(ms) — 구성이 바뀌어도 오래된 서명은 다시 받는다. 화면에 쓰지 않아 반응형이 아니다.
  let signedAt: Record<string, number> = {};
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

  // 담당 큐를 강조할 때 앞뒤 흐름을 볼 수 있도록 다른 큐도 남겨 둔다.
  const mineCount = $derived(model.cues.filter((cue) => editableSet.has(cue.trackId)).length);

  const sceneGroups = $derived.by(() => {
    if (!board) return [];
    const groups = new Map<string, { label: string; cues: Cue[] }>();
    const orderedScenes = [...model.scenes];
    for (const scene of orderedScenes) {
      groups.set(scene.id, { label: `${scene.act.title} · ${scene.title}`, cues: [] });
    }
    groups.set("__none", { label: "장면 미지정", cues: [] });
    for (const cue of model.cues) {
      const key = cue.sceneId ?? "__none";
      (groups.get(key) ?? groups.get("__none"))!.cues.push(cue);
    }
    return [...groups.entries()].filter(([, group]) => group.cues.length > 0);
  });

  // 처음 불러오는 중(보여줄 큐시트가 아직 없음)일 때만 스켈레톤 — 수정 뒤 재조회는 화면을 유지한다.
  const initialLoading = $derived(loading && !board);

  // pid가 바뀌어도(공연 전환) 다시 불러온다 — onMount는 재실행되지 않음.
  // 이전 공연의 데이터가 남아 다른 공연 주소에서 편집되지 않도록 먼저 비운다.
  $effect(() => {
    void pid;
    untrack(() => {
      board = null;
      title = "큐시트";
      compositionSections = [];
      compositionRevision = null;
      castingRoles = [];
      mediaAssets = [];
      backgroundVideo = null;
      sceneSectionIds = {};
      sceneVisuals = {};
      signedMediaUrls = {};
      signedAt = {};
      loading = true;
      loadError = "";
      void load();
    });
  });

  // 배경 영상 구성(구간 구조·배경 자료)이 바뀔 때만 달라지는 값 — 큐만 고칠 때는 영상 주소를 다시 받지 않는다.
  const visualSignature = $derived(JSON.stringify(compositionSections.map(section => [
    section.id, section.parentId, section.sourceSceneId, section.backgroundMode,
    section.media.filter(media => media.slot === "BACKGROUND").map(media => [media.assetId, media.asset.kind, media.loop, media.sourceStartMs, media.label])
  ])));

  // 서명 주소는 10분 뒤 만료되므로 8분마다 다시 받는다(refresh). 구성이 바뀌었을 땐 아직 서명하지 않았거나 7분 넘은 자료만 받는다.
  async function loadSceneVisuals(id: string, refresh: boolean) {
    try {
      const sections = compositionSections;
      const cached = signedMediaUrls;
      const picks = sections.flatMap((section) => {
        const owner = mediaOwner(sections, section, "BACKGROUND");
        const media = owner?.media.find((item) => item.slot === "BACKGROUND");
        return media ? [{ sceneId: section.id, media }] : [];
      });
      sceneSectionIds = Object.fromEntries(sections.flatMap(section => [[section.id, section.id], ...(section.sourceSceneId ? [[section.sourceSceneId, section.id]] : [])]));
      const assets = [...new Set(sections.flatMap(section => section.media.filter(media => media.slot === "BACKGROUND").map(media => media.assetId)))];
      const now = Date.now();
      const nextSignedAt: Record<string, number> = {};
      const urls = await Promise.all(assets.map(assetId => refresh || !cached[assetId] || now - (signedAt[assetId] ?? 0) > 7 * 60_000
        ? apiRequest<{ url: string }>(`/assets/${assetId}/url`).then(result => { nextSignedAt[assetId] = now; return result.url; }).catch(() => cached[assetId] ?? null)
        : Promise.resolve(cached[assetId])));
      if (id !== pid) return;
      signedAt = Object.fromEntries(assets.flatMap(assetId => {
        const at = nextSignedAt[assetId] ?? signedAt[assetId];
        return at ? [[assetId, at]] : [];
      }));
      signedMediaUrls = Object.fromEntries(assets.flatMap((assetId, index) => urls[index] ? [[assetId, urls[index]!]] : []));
      sceneVisuals = Object.fromEntries(picks.flatMap(pick => signedMediaUrls[pick.media.assetId]
        ? [[pick.sceneId, { url: signedMediaUrls[pick.media.assetId], kind: pick.media.asset.kind === "IMAGE" ? "IMAGE" as const : "VIDEO" as const, loop: pick.media.loop, sourceStartSec: pick.media.sourceStartMs / 1000, label: pick.media.label || undefined }]] : []));
    } catch {
      if (id === pid) sceneVisuals = {};
    }
  }
  $effect(() => {
    const id = pid;
    void visualSignature;
    untrack(() => void loadSceneVisuals(id, false));
    const timer = setInterval(() => void loadSceneVisuals(id, true), 8 * 60_000);
    return () => clearInterval(timer);
  });

  async function load(id = pid, session: ClientSession = captureSession()) {
    if (disposed || id !== pid || !isCurrentSession(session)) return;
    loading = true;
    loadError = "";
    try {
      const [result, composition] = await Promise.all([
        apiRequest<Board>(`/productions/${id}/cue-sheet`, { session }),
        apiRequest<CompositionBoard>(`/productions/${id}/composition`, { session })
      ]);
      if (disposed || id !== pid || !isCurrentSession(session)) return;
      title = result.production.title;
      board = result;
      compositionSections = composition.sections;
      compositionRevision = composition.revision;
      const [roles, assets, signed] = await Promise.all([
        apiRequest<CastingRole[]>(`/productions/${id}/roles`, { session }).catch(() => []),
        apiRequest<MediaAsset[]>(`/assets?productionId=${id}`, { session }).catch(() => []),
        result.production.backgroundAsset ? apiRequest<{ url: string; mime: string }>(`/assets/${result.production.backgroundAsset.id}/url`, { session }).catch(() => null) : Promise.resolve(null)
      ]);
      if (disposed || id !== pid || !isCurrentSession(session)) return;
      castingRoles = roles;
      mediaAssets = assets;
      backgroundVideo = signed ? { url: signed.url, mime: signed.mime } : null;
    } catch (error) {
      if (!disposed && id === pid && isCurrentSession(session)) loadError = error instanceof Error ? error.message : "큐시트를 불러오지 못했어요";
    } finally {
      if (!disposed && id === pid && isCurrentSession(session)) loading = false;
    }
  }

  type AssetCreateResponse = {
    asset: { id: string };
    upload: { url: string; method?: string };
  };

  async function uploadMediaFile(file: File, purpose: "BACKGROUND_VIDEO" | "CUE_MEDIA", id: string, session: ClientSession) {
    assertCurrentSession(session);
    const created = await apiRequest<AssetCreateResponse>("/assets", {
      method: "POST",
      session,
      body: JSON.stringify({
        purpose,
        productionId: id,
        fileName: file.name,
        mimeType: file.type,
        size: file.size
      })
    });
    assertCurrentSession(session);
    await uploadSignedObject(created.upload, file, file.type, { session });
    assertCurrentSession(session);
    return created.asset;
  }

  async function onPickBackground(event: Event) {
    const session = captureSession(); const id = pid;
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file || disposed || !isCurrentSession(viewSession)) return;
    backgroundUploading = true;
    try {
      const asset = await uploadMediaFile(file, "BACKGROUND_VIDEO", id, session);
      assertCurrentSession(session);
      if (disposed || id !== pid) return;
      await apiRequest(`/productions/${id}/background-video`, {
        method: "PATCH",
        session,
        body: JSON.stringify({ assetId: asset.id })
      });
      if (disposed || id !== pid || !isCurrentSession(session)) return;
      toast.success("배경 영상을 등록했어요. 타임라인 재생이 영상에 맞춰져요.");
      await load(id, session);
    } catch (error) {
      if (disposed || id !== pid || !isCurrentSession(session)) return;
      toast.error(error instanceof Error ? error.message : "배경 영상을 올리지 못했어요");
    } finally {
      if (!disposed && id === pid && isCurrentSession(session)) backgroundUploading = false;
    }
  }

  async function clearBackground() {
    backgroundUploading = true;
    try {
      await apiRequest(`/productions/${pid}/background-video`, {
        method: "PATCH",
        body: JSON.stringify({ assetId: null })
      });
      toast.success("배경 영상을 해제했어요");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "해제하지 못했어요");
    } finally {
      backgroundUploading = false;
    }
  }

  async function onPickCueMedia(event: Event) {
    const session = captureSession(); const id = pid;
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file || disposed || !isCurrentSession(viewSession)) return;
    mediaUploading = true;
    try {
      const asset = await uploadMediaFile(file, "CUE_MEDIA", id, session);
      assertCurrentSession(session);
      if (disposed || id !== pid) return;
      const assets = await apiRequest<MediaAsset[]>(`/assets?productionId=${id}`, { session }).catch(() => mediaAssets);
      if (disposed || id !== pid || !isCurrentSession(session)) return;
      mediaAssets = assets;
      formAssetId = asset.id;
      toast.success("파일을 올렸어요. 이 큐에 연결돼요.");
    } catch (error) {
      if (disposed || id !== pid || !isCurrentSession(session)) return;
      toast.error(error instanceof Error ? error.message : "파일을 올리지 못했어요");
    } finally {
      if (!disposed && id === pid && isCurrentSession(session)) mediaUploading = false;
    }
  }

  // 타임라인 대본 레인에서 블록을 끌어 놓았을 때 — 시작/길이(ms)를 저장한다.
  async function studioMoveBlock(blockId: string, startMs: number | null, durationMs: number | null) {
    const block = board?.scenes.flatMap(scene => scene.blocks ?? []).find(block => block.id === blockId);
    if (!block) return;
    try {
      await apiRequest(`/productions/${pid}/blocks/${blockId}`, {
        method: "PATCH",
        body: JSON.stringify({ startMs, durationMs, expectedUpdatedAt: block.updatedAt })
      });
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "블록 배치를 저장하지 못했어요");
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
    formSceneId = compositionSections.find(section => section.id === sceneId)?.sourceSceneId ?? sceneId ?? "";
    if (sceneId && compositionSections.some(section => section.id === sceneId && !section.sourceSceneId)) {
      toast.info("이 구간의 글·행동은 장·막 구성에서 편집해 주세요. 새 큐에는 연결할 대본 장면을 선택해 주세요.");
      formSceneId = "";
    }
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
      // 대본 편집은 구성 화면의 "줄 편집"으로 합쳐졌다. 장면과 연결된 구간이 있으면 그 구간의 줄 편집을 연다.
      const sectionId = sceneSectionIds[sceneId];
      const section = compositionSections.find(section => section.id === sectionId);
      const tab = section?.sourceSceneId && section.sourceScriptId ? "lines" : "section";
      void goto(`/app/p/${pid}/composition${sectionId ? `?section=${sectionId}&tab=${tab}` : ""}`);
    } else {
      void goto(`/app/p/${pid}/script${sceneId ? `#scene-${sceneId}` : ""}`);
    }
  }

  function openEditCue(cue: Cue) {
    if (cue.fromComposition) { openScriptScene(cue.sceneId); return; }
    cue = board?.cues.find(item => item.id === (model.cueSources.get(cue.id)?.id ?? cue.id)) ?? cue;
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
          body: JSON.stringify({ ...body, cueNumber: formCueNumber.trim() || undefined, expectedUpdatedAt: editingCue.updatedAt })
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
      toast.error(error instanceof Error ? error.message : "저장하지 못했어요");
    } finally {
      cueSaving = false;
    }
  }

  async function deleteCue() {
    if (!editingCue) return;
    const cue = editingCue, productionId = pid;
    const answer = await confirmation.ask({ title: "큐 삭제", description: `${cue.cueNumber} 큐를 삭제할까요? 삭제한 큐는 이 화면에서 개별로 되돌릴 수 없어요.`, confirmLabel: "큐 삭제", destructive: true });
    if (!answer.confirmed || productionId !== pid) return;
    cueSaving = true;
    try {
      await apiRequest(`/productions/${pid}/cue-sheet/cues/${cue.id}`, { method: "DELETE" });
      cueOpen = false;
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "삭제하지 못했어요");
    } finally {
      cueSaving = false;
    }
  }

  // 타임라인 큐 상세에서 바로 삭제(소프트) — 되돌리기는 트랙 관리의 큐 전체 되돌리기.
  async function studioDeleteCue(cueId: string) {
    const productionId = pid;
    const answer = await confirmation.ask({ title: "큐 삭제", description: "이 큐를 삭제할까요? 삭제한 큐는 이 화면에서 개별로 되돌릴 수 없어요.", confirmLabel: "큐 삭제", destructive: true });
    if (!answer.confirmed || productionId !== pid) return;
    cueId = model.cueSources.get(cueId)?.id ?? cueId;
    try {
      await apiRequest(`/productions/${pid}/cue-sheet/cues/${cueId}`, { method: "DELETE" });
      toast.success("큐를 삭제했어요");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "삭제하지 못했어요");
    }
  }

  // 타임라인에서 클립 끝을 끌어 큐 길이(초)를 바꾼다.
  async function studioResizeCue(cueId: string, durationSec: number) {
    cueId = model.cueSources.get(cueId)?.id ?? cueId;
    try {
      await apiRequest(`/productions/${pid}/cue-sheet/cues/${cueId}`, {
        method: "PATCH",
        body: JSON.stringify({ durationSec, expectedUpdatedAt: board?.cues.find(cue => cue.id === cueId)?.updatedAt })
      });
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "길이를 바꾸지 못했어요");
    }
  }

  // 타임라인에서 시간 지정 클립을 끌어 시작 시각(ms)을 바꾼다.
  async function studioMoveCue(cueId: string, startMs: number) {
    try {
      const source = model.cueSources.get(cueId);
      const section = compositionSections.find(item => item.id === source?.sectionId);
      if (section && (startMs < section.timing.startMs || startMs >= section.timing.startMs + section.timing.durationMs)) {
        throw new Error("큐는 연결된 구간 안에서 이동해 주세요. 구간을 바꾸려면 큐 수정에서 장면을 선택해 주세요.");
      }
      startMs = Math.max(0, startMs - (source?.offsetMs ?? 0));
      cueId = source?.id ?? cueId;
      await apiRequest(`/productions/${pid}/cue-sheet/cues/${cueId}`, {
        method: "PATCH",
        body: JSON.stringify({ startMs, expectedUpdatedAt: board?.cues.find(cue => cue.id === cueId)?.updatedAt })
      });
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "시작 시각을 바꾸지 못했어요");
    }
  }

  // 타임라인에서 클립을 끌어 순서(시간 위치)를 바꾼다.
  async function studioReorderCue(cueId: string, sceneId: string | null, orderedTrackCueIds: string[]) {
    cueId = model.cueSources.get(cueId)?.id ?? cueId;
    sceneId = compositionSections.find(item => item.id === sceneId)?.sourceSceneId ?? sceneId;
    orderedTrackCueIds = [...new Set(orderedTrackCueIds.map(id => model.cueSources.get(id)?.id ?? id))];
    try {
      await apiRequest(`/productions/${pid}/cue-sheet/cues/${cueId}/reorder`, {
        method: "PATCH",
        body: JSON.stringify({ sceneId: sceneId ?? undefined, orderedTrackCueIds })
      });
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "순서를 바꾸지 못했어요");
    }
  }

  async function createDefaultTracks() {
    trackSaving = true;
    try {
      await apiRequest(`/productions/${pid}/cue-sheet/tracks/defaults`, { method: "POST" });
      toast.success("기본 트랙을 만들었어요");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "트랙을 만들지 못했어요");
    } finally {
      trackSaving = false;
    }
  }

  function onStudioEdit(cueId: string) {
    const displayed = model.cues.find(cue => cue.id === cueId);
    if (displayed?.fromComposition) { openScriptScene(displayed.sceneId); return; }
    cueId = model.cueSources.get(cueId)?.id ?? cueId;
    const cue = board?.cues.find((item) => item.id === cueId);
    if (cue && editableSet.has(cue.trackId)) {
      openEditCue(cue);
    }
  }
</script>

<svelte:head>
  <title>큐시트 — {title}</title>
</svelte:head>

<div class="mx-auto min-w-0 w-full {view === 'timeline' ? 'max-w-[1500px]' : 'max-w-5xl'}">
  <div class="flex min-w-0 flex-wrap items-start gap-3 py-2">
    <Button href={`/app/p/${pid}`} variant="ghost" size="icon" class="-ms-2 size-11" aria-label="공연 홈으로">
      <ChevronLeftIcon />
    </Button>
    <div class="min-w-0 flex-1">
      <h1 class="text-xl font-semibold tracking-tight sm:text-2xl">큐시트</h1>
      <p class="text-muted-foreground mt-1 text-sm leading-6">장면별 큐와 앞뒤 흐름을 확인해요. 담당 트랙의 큐를 눌러 수정할 수 있어요.</p>
    </div>
    <div class="flex w-full flex-wrap items-center gap-2 lg:ms-auto lg:w-auto">
      {#if board && board.tracks.length > 0}
        <div class="bg-muted flex rounded-lg p-0.5" role="group" aria-label="큐시트 보기 방식">
          <Button
            variant={view === "timeline" ? "secondary" : "ghost"}
            size="sm"
            class="min-h-11 px-3 whitespace-nowrap"
            aria-pressed={view === "timeline"}
            onclick={() => chooseView("timeline")}
          >
            타임라인
          </Button>
          <Button
            variant={view === "list" ? "secondary" : "ghost"}
            size="sm"
            class="min-h-11 px-3 whitespace-nowrap"
            aria-pressed={view === "list"}
            onclick={() => chooseView("list")}
          >
            목록
          </Button>
        </div>
      {/if}
      {#if canManage}
        <Button variant="outline" size="sm" class="h-8 whitespace-nowrap" href={`/app/p/${pid}/composition`}>
          <BookOpenIcon aria-hidden="true" />
          대본 등록
        </Button>
        {#if canManage}<Button variant="outline" size="sm" class="h-8 whitespace-nowrap" onclick={() => (importOpen = true)} title="엑셀·구글시트의 큐시트 표를 가져와요">엑셀에서 가져오기</Button>{/if}
        <Button variant="outline" size="sm" class="h-8 whitespace-nowrap" disabled={!board?.cues.length} onclick={printSheet} title="인쇄하거나 PDF로 저장해요">인쇄</Button>
        <Button variant="outline" size="sm" class="h-8 whitespace-nowrap" disabled={!board?.cues.length} onclick={exportCsv} title="엑셀·한글 문서에서 열 수 있는 표(CSV)로 내려받아요">
          엑셀로 내보내기
        </Button>
        <Button variant="outline" size="sm" class="h-8 whitespace-nowrap" onclick={() => (tracksOpen = true)}>
          <Settings2Icon />
          트랙
        </Button>
        <label
          class="border-input hover:bg-accent inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm font-medium whitespace-nowrap transition-colors {backgroundUploading
            ? 'pointer-events-none opacity-50'
            : ''}"
          title="공연 뒷배경으로 재생할 영상을 올려요 (MP4, 최대 500MB)"
        >
          <MonitorIcon class="size-4" />
          {backgroundUploading ? "업로드 중…" : board?.production.backgroundAsset ? "배경 영상 교체" : "배경 영상"}
          <input
            type="file"
            accept="video/mp4,.mp4"
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
        <Button size="touch" class="whitespace-nowrap" onclick={() => openCreateCue()}>
          <PlusIcon />
          큐 추가
        </Button>
      {/if}
    </div>
  </div>

  {#if board}
    <div class="text-muted-foreground flex flex-wrap items-center gap-2 text-xs" role="status">
      <span>{model.composed ? `연습과 같은 최신 공연 구성 · 버전 ${compositionRevision}` : "원본 대본 타임라인"} · 전체 {formatTime(model.totalMs)}</span>
      <Button variant="ghost" size="sm" class="min-h-11" disabled={loading} onclick={() => load()}>최신 내용 불러오기</Button>
      {#if canManage && model.composed}<a class="min-h-11 inline-flex items-center underline" href={`/app/p/${pid}/composition`}>구간 시간 편집</a>{/if}
    </div>
  {/if}
  {#if loadError}<p role="alert" class="text-destructive mt-3 text-sm">{loadError} {board ? "현재 표시된 내용은 이전 조회 결과예요." : ""}<Button variant="outline" class="ms-2 min-h-11" onclick={() => load()}>다시 불러오기</Button></p>{/if}
  {#if !initialLoading && model.unplacedCues.length}
    <details class="mt-3 rounded-xl border border-amber-400/40 bg-amber-400/5 p-3 text-sm">
      <summary class="min-h-11 cursor-pointer font-medium">현재 공연 구성에 배치되지 않은 큐 {model.unplacedCues.length}개</summary>
      <p class="text-muted-foreground mb-2">연결 장면이 없거나 구간 시간 밖에 있는 큐예요. 장면 연결·구간 길이를 확인해 주세요. 현재 타임라인과 내보내기에는 포함되지 않아요.</p>
      {#each model.unplacedCues as cue (cue.id)}<button type="button" class="block min-h-11 w-full rounded-lg px-2 text-start hover:bg-muted" disabled={!editableSet.has(cue.trackId)} onclick={() => openEditCue(cue)}>{trackName(cue.trackId)} · {cue.cueNumber} · {cue.content}</button>{/each}
    </details>
  {/if}

  {#if showMineToggle}
    <div class="mt-1 flex gap-1.5" role="group" aria-label="큐 범위">
      <Button
        variant={onlyMine ? "ghost" : "secondary"}
        size="sm"
        class="min-h-11 px-3"
        aria-pressed={!onlyMine}
        onclick={() => (onlyMine = false)}
      >
        전체
      </Button>
      <Button
        variant={onlyMine ? "secondary" : "ghost"}
        size="sm"
        class="min-h-11 px-3"
        aria-pressed={onlyMine}
        onclick={() => (onlyMine = true)}
      >
        내 큐 강조
      </Button>
    </div>
  {/if}

  {#if !initialLoading && castingRoles.length > 0}
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

  {#if initialLoading}
    <div class="mt-4 space-y-2">
      {#each Array(5) as _, i (i)}
        <Skeleton class="h-16 w-full rounded-2xl" />
      {/each}
    </div>
  {:else if !board && loadError}
    <p class="text-muted-foreground mt-4 text-sm">최신 공연 내용을 확인한 뒤 큐시트를 표시해요.</p>
  {:else if !board || board.tracks.length === 0}
    <div class="bg-card mt-4 rounded-2xl px-6 py-14 text-center">
      <p class="font-semibold">큐시트가 아직 준비되지 않았어요</p>
      <p class="text-muted-foreground mt-1 text-sm">
        제작진이 음향·조명 등 트랙과 담당자를 정하면 이곳에서 큐를 확인할 수 있어요.
      </p>
      {#if canManage}
        <div class="mt-5 flex flex-wrap justify-center gap-2">
          <Button size="sm" onclick={createDefaultTracks} disabled={trackSaving}>기본 트랙 만들기</Button>
          <Button size="sm" variant="outline" href={`/app/p/${pid}/composition`}>
            <BookOpenIcon aria-hidden="true" />
            대본으로 초안 만들기
          </Button>
          <Button size="sm" variant="outline" onclick={() => (tracksOpen = true)}>직접 구성</Button>
        </div>
      {/if}
    </div>
  {:else if view === "timeline"}
    <div class="border-primary/20 bg-primary/5 text-muted-foreground mt-4 flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs lg:hidden">
      <MonitorIcon class="size-4 shrink-0" />
      <span>모바일에서 큐를 빠르게 확인하려면 <span class="text-foreground font-medium">목록</span>으로 열어 보세요.</span>
    </div>
    <div class="mt-4 overflow-x-auto">
      <CueStudio
        scenes={model.scenes}
        tracks={board.tracks}
        cues={model.cues}
        totalMs={model.totalMs}
        editableTrackIds={board.viewer.editableTrackIds}
        background={backgroundVideo}
        {sceneVisuals}
        {compositionSections}
        {signedMediaUrls}
        canEditScript={canManage}
        onEditCue={onStudioEdit}
        onAddCue={canEditSomething ? (trackId, sceneId) => openCreateCue(trackId, sceneId ?? "") : undefined}
        onDeleteCue={canEditSomething ? studioDeleteCue : undefined}
        onResizeCue={canEditSomething ? studioResizeCue : undefined}
        onReorderCue={canEditSomething ? studioReorderCue : undefined}
        onMoveCue={canEditSomething ? studioMoveCue : undefined}
        onMoveBlock={canManage && !model.composed ? studioMoveBlock : undefined}
        onOpenScript={openScriptScene}
      />
    </div>
  {:else if model.cues.length === 0}
    <div class="bg-card mt-4 rounded-2xl px-6 py-14 text-center">
      <p class="font-semibold">아직 등록된 큐가 없어요</p>
      <p class="text-muted-foreground mt-1 text-sm">{canEditSomething ? "큐 추가 버튼으로 첫 큐를 등록해 보세요." : "담당자가 큐를 등록하면 이곳에서 확인할 수 있어요."}</p>
    </div>
  {:else if onlyMine && mineCount === 0}
    <div class="bg-card mt-4 rounded-2xl px-6 py-14 text-center">
      <p class="font-semibold">내 담당 큐가 없어요</p>
      <p class="text-muted-foreground mt-1 text-sm">{canEditSomething ? "담당 트랙에 큐를 추가해 보세요." : "담당 트랙 배정은 제작진에게 확인해 주세요."}</p>
    </div>
  {:else}
    <!-- 표 (데스크톱) — 인쇄할 때는 이 표만 나온다 -->
    <div class="print-area bg-card mt-4 hidden overflow-x-auto rounded-2xl border md:block">
      <p class="print-only mb-2 hidden px-1 text-sm font-semibold">{title} 큐시트 · {new Date().toLocaleDateString("ko-KR")} 출력</p>
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
                  <span class="text-muted-foreground mt-1 block whitespace-nowrap text-xs font-normal">{formatTime(cue.startMs ?? 0)}</span>
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
          {onlyMine ? "흐린 행은 내 큐가 아닌 구간(맥락용)이에요 · " : ""}내 트랙 행만 눌러서 수정할 수 있어요
        {:else}
          큐시트는 읽기 전용이에요.
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
                class="bg-card flex min-w-0 items-start gap-4 rounded-2xl px-5 py-4 text-start transition-opacity {mine
                  ? 'hover:bg-accent/60 cursor-pointer transition-colors'
                  : 'cursor-default'} {onlyMine && !mine ? 'opacity-40' : ''}"
                disabled={!mine}
                onclick={() => openEditCue(cue)}
              >
                <span class="w-10 shrink-0 pt-0.5 font-mono text-sm font-bold tabular-nums" style={`color: ${color};`}>
                  {cue.cueNumber}
                  <span class="text-muted-foreground mt-1 block whitespace-nowrap text-xs font-normal">{formatTime(cue.startMs ?? 0)}</span>
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
      <Dialog.Description>계기(트리거)와 실행할 내용을 짧고 분명하게 적어요.</Dialog.Description>
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
            title="영상(MP4) 또는 음원(mp3·wav·m4a·aac)을 올려요"
          >
            {mediaUploading ? "업로드 중…" : "파일 올리기"}
            <input
              type="file"
              accept="video/mp4,.mp4,audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/aac,audio/x-m4a"
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


{#key pid}
  <CueSheetSettingsDialog
    {pid}
    bind:open={tracksOpen}
    tracks={board?.tracks ?? []}
    cueCount={board?.cues.length ?? 0}
    {canManage}
    palette={PALETTE}
    onReloaded={load}
    askConfirmation={(options) => confirmation.ask(options)}
  />
{/key}

{#if importOpen}
  <ImportDialog {pid} onClose={() => (importOpen = false)} onDone={load} />
{/if}

<ConfirmDialog bind:this={confirmation} />

<style>
  @media print {
    :global(body *) { visibility: hidden !important; }
    :global(.print-area), :global(.print-area *) { visibility: visible !important; }
    :global(.print-area) { position: absolute; inset: 0 0 auto 0; display: block !important; border: 0 !important; overflow: visible !important; background: white !important; color: black !important; }
    :global(.print-area .print-only) { display: block !important; }
    :global(.print-area table) { min-width: 0 !important; font-size: 11px; }
    :global(.print-area tr) { break-inside: avoid; }
  }
</style>
