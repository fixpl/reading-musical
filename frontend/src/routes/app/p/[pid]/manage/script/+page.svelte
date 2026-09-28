<script lang="ts">
  import { onMount } from "svelte";
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
  import PlusIcon from "@lucide/svelte/icons/plus";
  import SparklesIcon from "@lucide/svelte/icons/sparkles";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import RotateCcwIcon from "@lucide/svelte/icons/rotate-ccw";

  type Block = {
    id: string;
    order: number;
    type: "DIALOGUE" | "LYRIC" | "STAGE_DIRECTION" | "NOTE";
    text: string;
    cueLabel: string | null;
    character: { id: string; name: string } | null;
  };

  type Scene = { id: string; order: number; title: string; summary: string | null; blocks: Block[] };
  type Act = { id: string; order: number; title: string; scenes: Scene[] };
  type ScriptDetail = { id: string; title: string; acts: Act[] };
  type ScriptSummary = { id: string; title: string };
  type CastRole = { id: string; name: string };

  const pid = $derived($page.params.pid ?? "");

  const BLOCK_TYPES = [
    { value: "DIALOGUE", label: "대사" },
    { value: "LYRIC", label: "가사" },
    { value: "STAGE_DIRECTION", label: "지문" },
    { value: "NOTE", label: "메모" }
  ];
  const typeLabel = (value: string) => BLOCK_TYPES.find((item) => item.value === value)?.label ?? value;

  let scripts = $state<ScriptSummary[]>([]);
  let script = $state<ScriptDetail | null>(null);
  let castRoles = $state<CastRole[]>([]);
  let selectedSceneId = $state("");
  let loading = $state(true);
  let saving = $state(false);
  // 대본 편집은 제작진(canManageTracks)만 — 큐시트가 이미 쓰는 것과 같은 신호를 재사용한다.
  let canManage = $state(false);

  const selectedScene = $derived.by(() => {
    if (!script) return null;
    for (const act of script.acts) {
      const found = act.scenes.find((scene) => scene.id === selectedSceneId);
      if (found) return found;
    }
    return script.acts[0]?.scenes[0] ?? null;
  });

  // 빠른 추가 폼
  let addType = $state("DIALOGUE");
  let addCharacterId = $state("");
  let addText = $state("");
  let addCueLabel = $state("");

  // 블록 수정 다이얼로그
  let editBlock = $state<Block | null>(null);
  let editType = $state("DIALOGUE");
  let editCharacterId = $state("");
  let editText = $state("");
  let editCueLabel = $state("");

  // 구조 추가
  let newActTitle = $state("");
  let sceneTitleFor = $state<string | null>(null);
  let newSceneTitle = $state("");

  // 대본 삭제(소프트) — 실데이터는 남고 복구 가능
  type DeletedScript = { id: string; title: string; deletedAt: string };
  let showDelete = $state(false);
  let deleting = $state(false);
  let showTrash = $state(false);
  let trash = $state<DeletedScript[]>([]);
  let trashLoading = $state(false);
  let restoringId = $state<string | null>(null);

  onMount(load);

  async function load(keepScene = false) {
    loading = true;
    try {
      const [scriptList, roleList, board] = await Promise.all([
        apiRequest<ScriptSummary[]>(`/productions/${pid}/scripts`),
        apiRequest<CastRole[]>(`/productions/${pid}/roles`),
        apiRequest<{ viewer: { canManageTracks: boolean } }>(`/productions/${pid}/cue-sheet`).catch(() => ({ viewer: { canManageTracks: false } }))
      ]);
      canManage = board.viewer.canManageTracks;
      scripts = scriptList;
      castRoles = roleList;
      const currentId = script?.id;
      const targetId =
        currentId && scriptList.some((item) => item.id === currentId)
          ? currentId
          : scriptList[scriptList.length - 1]?.id;
      if (targetId) {
        const detail = await apiRequest<ScriptDetail>(`/productions/${pid}/scripts/${targetId}`);
        script = detail;
        // 큐시트에서 "이 장면 대본 열기"로 들어온 경우 해당 장면을 바로 연다.
        const requested = $page.url.searchParams.get("scene");
        const allScenes = detail.acts.flatMap((act) => act.scenes);
        if (requested && allScenes.some((scene) => scene.id === requested)) {
          selectedSceneId = requested;
        } else if (!keepScene || !selectedSceneId) {
          selectedSceneId = detail.acts[0]?.scenes[0]?.id ?? "";
        }
      } else {
        script = null;
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "대본을 불러오지 못했습니다");
    } finally {
      loading = false;
    }
  }

  async function openScript(scriptId: string) {
    loading = true;
    try {
      script = await apiRequest<ScriptDetail>(`/productions/${pid}/scripts/${scriptId}`);
      selectedSceneId = script.acts[0]?.scenes[0]?.id ?? "";
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "대본을 불러오지 못했습니다");
    } finally {
      loading = false;
    }
  }

  async function createScript() {
    saving = true;
    try {
      const created = await apiRequest<{ id: string }>(`/productions/${pid}/scripts`, {
        method: "POST",
        body: JSON.stringify({ title: "새 대본" })
      });
      await load();
      await openScript(created.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "대본을 만들지 못했습니다");
    } finally {
      saving = false;
    }
  }

  // 파일/붙여넣기 불러오기 — 바로 반영하지 않고 검수 draft를 거친다.
  type ImportPreview = {
    importId: string;
    status: string;
    detectedActs: number;
    detectedScenes: number;
    blocks: Array<{
      tempId: string;
      type: Block["type"];
      speakerName?: string;
      text: string;
      actTitle?: string;
      sceneTitle?: string;
    }>;
    warnings: Array<{ code: string; message: string }>;
  };
  type ReviewedImportBlock = {
    tempId: string;
    type: Block["type"];
    speakerName: string;
    text: string;
    actTitle: string;
    sceneTitle: string;
  };
  let importOpen = $state(false);
  let importText = $state("");
  let importBusy = $state(false);
  let importPreview = $state<ImportPreview | null>(null);
  let reviewedBlocks = $state<ReviewedImportBlock[]>([]);

  function openImport() {
    importText = "";
    importPreview = null;
    reviewedBlocks = [];
    importOpen = true;
  }

  function setImportPreview(preview: ImportPreview) {
    importPreview = preview;
    reviewedBlocks = preview.blocks.map((block) => ({
      tempId: block.tempId,
      type: block.type,
      speakerName: block.speakerName ?? "",
      text: block.text,
      actTitle: block.actTitle ?? "가져온 대본",
      sceneTitle: block.sceneTitle ?? "검수 반영"
    }));
  }

  async function createImportFromPaste() {
    if (!script || importText.trim().length < 2) return;
    importBusy = true;
    try {
      const preview = await apiRequest<ImportPreview>(`/productions/${pid}/scripts/${script.id}/imports`, {
        method: "POST",
        body: JSON.stringify({ rawText: importText, sourceType: "PASTE", parseMode: "BLOCK_DRAFT" })
      });
      setImportPreview(preview);
      toast.success("검수할 초안을 만들었습니다. 확인 후 반영해 주세요.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "불러오지 못했습니다");
    } finally {
      importBusy = false;
    }
  }

  async function onImportFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file || !script) return;
    importBusy = true;
    try {
      const created = await apiRequest<{ asset: { id: string }; upload: { url: string; method?: string } }>("/assets", {
        method: "POST",
        body: JSON.stringify({
          purpose: "SCRIPT_IMPORT",
          productionId: pid,
          fileName: file.name,
          mimeType: file.type || "text/plain",
          size: file.size
        })
      });
      await uploadSignedObject(created.upload, file, file.type || "text/plain");
      const preview = await apiRequest<ImportPreview>(`/productions/${pid}/scripts/${script.id}/imports`, {
        method: "POST",
        body: JSON.stringify({ assetId: created.asset.id, parseMode: "BLOCK_DRAFT" })
      });
      setImportPreview(preview);
      toast.success("파일에서 검수할 초안을 만들었습니다. 확인 후 반영해 주세요.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "파일을 읽지 못했습니다");
    } finally {
      importBusy = false;
    }
  }

  async function applyImport() {
    if (!script || !importPreview) return;
    const blocks = reviewedBlocks
      .map((block) => ({
        tempId: block.tempId,
        type: block.type,
        speakerName: block.speakerName.trim() || undefined,
        text: block.text.trim(),
        actTitle: block.actTitle.trim() || undefined,
        sceneTitle: block.sceneTitle.trim() || undefined
      }))
      .filter((block) => block.text.length > 0);
    if (blocks.length === 0) {
      toast.error("반영할 블록이 없습니다");
      return;
    }
    importBusy = true;
    try {
      await apiRequest(`/productions/${pid}/scripts/${script.id}/imports/${importPreview.importId}/apply`, {
        method: "POST",
        body: JSON.stringify({ mode: "APPEND", reviewedBlocks: blocks, createVersion: true, versionName: "import 반영본" })
      });
      toast.success(`가져온 대본 ${blocks.length}블록을 반영했습니다`);
      importOpen = false;
      importPreview = null;
      reviewedBlocks = [];
      importText = "";
      await load(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "반영하지 못했습니다");
    } finally {
      importBusy = false;
    }
  }

  async function addAct(event: SubmitEvent) {
    event.preventDefault();
    if (!script || !newActTitle.trim()) return;
    saving = true;
    try {
      await apiRequest(`/productions/${pid}/scripts/${script.id}/acts`, {
        method: "POST",
        body: JSON.stringify({ title: newActTitle.trim() })
      });
      newActTitle = "";
      await load(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "막을 추가하지 못했습니다");
    } finally {
      saving = false;
    }
  }

  async function addScene(actId: string) {
    if (!newSceneTitle.trim()) return;
    saving = true;
    try {
      const created = await apiRequest<{ id: string }>(`/productions/${pid}/acts/${actId}/scenes`, {
        method: "POST",
        body: JSON.stringify({ title: newSceneTitle.trim() })
      });
      newSceneTitle = "";
      sceneTitleFor = null;
      await load(true);
      selectedSceneId = created.id;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "장을 추가하지 못했습니다");
    } finally {
      saving = false;
    }
  }

  const needsCharacter = (type: string) => type === "DIALOGUE" || type === "LYRIC";

  async function addBlock(event: SubmitEvent) {
    event.preventDefault();
    if (!selectedScene || !addText.trim()) return;
    saving = true;
    try {
      await apiRequest(`/productions/${pid}/scenes/${selectedScene.id}/blocks`, {
        method: "POST",
        body: JSON.stringify({
          type: addType,
          text: addText.trim(),
          characterId: needsCharacter(addType) && addCharacterId ? addCharacterId : null,
          cueLabel: addCueLabel.trim() || null
        })
      });
      addText = "";
      addCueLabel = "";
      await load(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "추가하지 못했습니다");
    } finally {
      saving = false;
    }
  }

  function openEdit(block: Block) {
    editBlock = block;
    editType = block.type;
    editCharacterId = block.character?.id ?? "";
    editText = block.text;
    editCueLabel = block.cueLabel ?? "";
  }

  async function saveBlock(event: SubmitEvent) {
    event.preventDefault();
    if (!editBlock || !editText.trim()) return;
    saving = true;
    try {
      await apiRequest(`/productions/${pid}/blocks/${editBlock.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          type: editType,
          text: editText.trim(),
          characterId: needsCharacter(editType) && editCharacterId ? editCharacterId : null,
          cueLabel: editCueLabel.trim() || null
        })
      });
      editBlock = null;
      await load(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "저장하지 못했습니다");
    } finally {
      saving = false;
    }
  }

  async function deleteBlock() {
    if (!editBlock) return;
    saving = true;
    try {
      await apiRequest(`/productions/${pid}/blocks/${editBlock.id}`, { method: "DELETE" });
      editBlock = null;
      await load(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "삭제하지 못했습니다");
    } finally {
      saving = false;
    }
  }

  const characterName = (id: string) => castRoles.find((role) => role.id === id)?.name ?? "화자 선택";

  function openDeleteScript() {
    showDelete = true;
  }

  async function confirmDeleteScript() {
    if (!script) return;
    deleting = true;
    try {
      await apiRequest(`/productions/${pid}/scripts/${script.id}`, { method: "DELETE" });
      toast.success("대본을 삭제했습니다. 삭제된 대본에서 복구할 수 있어요.");
      showDelete = false;
      script = null;
      selectedSceneId = "";
      await load();
      if (showTrash) await loadTrash();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "대본을 삭제하지 못했습니다");
    } finally {
      deleting = false;
    }
  }

  async function loadTrash() {
    trashLoading = true;
    try {
      trash = await apiRequest<DeletedScript[]>(`/productions/${pid}/scripts-deleted`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "삭제된 대본을 불러오지 못했습니다");
      trash = [];
    } finally {
      trashLoading = false;
    }
  }

  async function toggleTrash() {
    showTrash = !showTrash;
    if (showTrash) await loadTrash();
  }

  async function restoreScript(deleted: DeletedScript) {
    restoringId = deleted.id;
    try {
      await apiRequest(`/productions/${pid}/scripts/${deleted.id}/restore`, { method: "POST" });
      toast.success(`"${deleted.title}" 대본을 복구했습니다.`);
      await Promise.all([load(), loadTrash()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "대본을 복구하지 못했습니다");
    } finally {
      restoringId = null;
    }
  }
</script>

<svelte:head>
  <title>대본 편집 — 아트브릿지</title>
</svelte:head>

<div class="mx-auto w-full max-w-5xl">
  <div class="flex flex-wrap items-center gap-2 py-2">
    <div>
      <h1 class="text-xl font-bold tracking-tight">대본 편집</h1>
      <p class="text-muted-foreground text-sm">장면을 고르고 대사·가사·지문을 한 줄씩 씁니다.</p>
    </div>
    {#if canManage}
    <div class="ms-auto flex items-center gap-1.5">
      {#if scripts.length > 1}
        <div class="bg-muted flex flex-wrap rounded-lg p-0.5">
          {#each scripts as item (item.id)}
            <button
              type="button"
              class="max-w-40 truncate rounded-md px-2.5 py-1 text-xs font-medium transition-colors {script?.id === item.id
                ? 'bg-background shadow-sm'
                : 'text-muted-foreground hover:text-foreground'}"
              onclick={() => openScript(item.id)}
            >
              {item.title}
            </button>
          {/each}
        </div>
      {/if}
      <Button variant="outline" size="sm" class="h-8" href={`/app/p/${pid}/cuesheet`}>
        <SparklesIcon />
        AI 초안
      </Button>
      {#if script}
        <Button variant="outline" size="sm" class="h-8" onclick={openImport} disabled={saving}>
          불러오기
        </Button>
      {/if}
      <Button variant="outline" size="sm" class="h-8" onclick={createScript} disabled={saving}>
        <PlusIcon />
        새 대본
      </Button>
      {#if script}
        <Button
          variant="ghost"
          size="sm"
          class="text-muted-foreground hover:text-destructive h-8"
          onclick={openDeleteScript}
          disabled={saving}
        >
          <Trash2Icon />
          삭제
        </Button>
      {/if}
      <Button variant={showTrash ? "secondary" : "ghost"} size="sm" class="h-8" onclick={toggleTrash}>
        삭제된 대본
      </Button>
    </div>
    {/if}
  </div>

  {#if showTrash}
    <div class="border-border/60 bg-card mt-2 rounded-2xl border border-dashed p-4">
      <p class="text-sm font-semibold">삭제된 대본</p>
      <p class="text-muted-foreground mb-2.5 text-xs">삭제해도 데이터는 남아 있어요. 복구하면 목록으로 되돌아옵니다.</p>
      {#if trashLoading}
        <Skeleton class="h-12 w-full rounded-xl" />
      {:else if trash.length === 0}
        <p class="text-muted-foreground py-2 text-center text-sm">삭제된 대본이 없습니다.</p>
      {:else}
        <div class="grid gap-2">
          {#each trash as item (item.id)}
            <div class="border-border/60 flex items-center gap-3 rounded-xl border px-3 py-2.5">
              <span class="min-w-0 flex-1 truncate text-sm font-medium">{item.title}</span>
              <Button
                variant="outline"
                size="sm"
                class="h-8"
                onclick={() => restoreScript(item)}
                disabled={restoringId === item.id}
              >
                <RotateCcwIcon />
                복구
              </Button>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  {#if loading}
    <Skeleton class="mt-2 h-96 w-full rounded-2xl" />
  {:else if !canManage}
    <section class="bg-card mt-2 rounded-2xl border p-8 text-center" role="alert">
      <h2 class="font-semibold">이 화면을 관리할 권한이 없어요</h2>
      <p class="text-muted-foreground mt-2 text-sm">대본 편집은 제작진만 할 수 있습니다. 대본 열람은 "대본" 메뉴를 이용하세요.</p>
    </section>
  {:else if !script}
    <div class="bg-card mt-2 rounded-2xl px-6 py-14 text-center">
      <p class="font-semibold">아직 대본이 없습니다</p>
      <p class="text-muted-foreground mt-1 text-sm">
        "새 대본"으로 직접 쓰거나, 큐시트의 "AI 초안"에 대본을 붙여넣어 구조를 만들 수 있습니다.
      </p>
    </div>
  {:else}
    <div class="mt-2 grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
      <!-- 장면 목록 -->
      <nav class="bg-card sticky top-4 hidden max-h-[calc(100dvh-8rem)] flex-col gap-0.5 self-start overflow-y-auto rounded-xl border p-1.5 lg:flex">
        {#each script.acts as act (act.id)}
          <div class="flex items-center px-2 pt-2 pb-0.5">
            <p class="text-muted-foreground/70 text-[11px] font-bold">{act.title}</p>
            <button
              type="button"
              class="text-muted-foreground/60 hover:text-foreground ms-auto text-[11px]"
              onclick={() => {
                sceneTitleFor = sceneTitleFor === act.id ? null : act.id;
                newSceneTitle = "";
              }}
            >
              + 장
            </button>
          </div>
          {#each act.scenes as scene (scene.id)}
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-xs transition-colors
                {selectedScene?.id === scene.id ? 'bg-primary/15 text-primary font-semibold' : 'hover:bg-accent/60'}"
              onclick={() => (selectedSceneId = scene.id)}
            >
              <span class="truncate">{scene.title}</span>
              <span class="text-muted-foreground/60 ms-auto shrink-0 text-[11px]">{scene.blocks.length}</span>
            </button>
          {/each}
          {#if sceneTitleFor === act.id}
            <form
              class="flex gap-1 px-1 py-1"
              onsubmit={(event) => {
                event.preventDefault();
                addScene(act.id);
              }}
            >
              <Input bind:value={newSceneTitle} placeholder="장 제목" class="h-7 text-xs" maxlength={120} />
              <Button type="submit" size="sm" class="h-7 px-2 text-xs" disabled={saving || !newSceneTitle.trim()}>
                추가
              </Button>
            </form>
          {/if}
        {/each}
        <form class="mt-1 flex gap-1 border-t px-1 pt-2" onsubmit={addAct}>
          <Input bind:value={newActTitle} placeholder="새 막 (예: 2막)" class="h-7 text-xs" maxlength={120} />
          <Button type="submit" size="sm" variant="outline" class="h-7 px-2 text-xs" disabled={saving || !newActTitle.trim()}>
            막 추가
          </Button>
        </form>
      </nav>

      <!-- 장면 편집 -->
      {#if selectedScene}
        <div class="bg-card rounded-2xl p-5 sm:p-6">
          <header class="border-border/60 border-b pb-3">
            <h2 class="text-lg font-bold tracking-tight">{selectedScene.title}</h2>
            {#if selectedScene.summary}
              <p class="text-muted-foreground mt-0.5 text-sm">{selectedScene.summary}</p>
            {/if}
          </header>

          <div class="grid gap-2 pt-4">
            {#each selectedScene.blocks as block (block.id)}
              <button
                type="button"
                class="hover:bg-accent/50 -mx-2 grid gap-0.5 rounded-xl px-2 py-2 text-start transition-colors sm:grid-cols-[100px_minmax(0,1fr)] sm:gap-3"
                onclick={() => openEdit(block)}
              >
                <span class="flex items-start gap-1.5 pt-px">
                  <Badge
                    variant={block.type === "DIALOGUE" || block.type === "LYRIC" ? "secondary" : "outline"}
                    class="px-1.5 py-0 text-[10.5px]"
                  >
                    {typeLabel(block.type)}
                  </Badge>
                  {#if block.cueLabel}
                    <Badge variant="outline" class="px-1.5 py-0 font-mono text-[10.5px]">{block.cueLabel}</Badge>
                  {/if}
                </span>
                <span class="min-w-0">
                  {#if block.character}
                    <span class="text-primary me-1.5 text-sm font-bold">{block.character.name}</span>
                  {/if}
                  <span
                    class="text-[15px] leading-relaxed whitespace-pre-wrap {block.type === 'STAGE_DIRECTION' || block.type === 'NOTE'
                      ? 'text-muted-foreground italic'
                      : ''}"
                  >
                    {block.text}
                  </span>
                </span>
              </button>
            {/each}
            {#if selectedScene.blocks.length === 0}
              <p class="text-muted-foreground/60 py-6 text-center text-sm">
                아직 내용이 없습니다. 아래에서 첫 줄을 추가해 보세요.
              </p>
            {/if}
          </div>

          <!-- 빠른 추가 -->
          <form class="border-border/60 mt-4 grid gap-3 rounded-xl border border-dashed p-3" onsubmit={addBlock}>
            <div class="flex flex-wrap gap-2">
              <Select.Root type="single" bind:value={addType}>
                <Select.Trigger class="h-9 w-28">{typeLabel(addType)}</Select.Trigger>
                <Select.Content>
                  {#each BLOCK_TYPES as item (item.value)}
                    <Select.Item value={item.value} label={item.label} />
                  {/each}
                </Select.Content>
              </Select.Root>
              {#if needsCharacter(addType)}
                <Select.Root type="single" bind:value={addCharacterId}>
                  <Select.Trigger class="h-9 w-36">
                    {addCharacterId ? characterName(addCharacterId) : "화자 (선택)"}
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Item value="" label="화자 없음" />
                    {#each castRoles as role (role.id)}
                      <Select.Item value={role.id} label={role.name} />
                    {/each}
                  </Select.Content>
                </Select.Root>
              {/if}
              <Input bind:value={addCueLabel} maxlength={20} placeholder="큐 라벨 (예: Q3)" class="h-9 w-32" />
            </div>
            <Textarea
              bind:value={addText}
              rows={2}
              maxlength={2000}
              placeholder={addType === "DIALOGUE" ? "대사를 입력하세요" : addType === "LYRIC" ? "가사를 입력하세요" : "내용을 입력하세요"}
            />
            <div class="flex justify-end">
              <Button type="submit" size="sm" disabled={saving || !addText.trim()}>
                <PlusIcon />
                추가
              </Button>
            </div>
          </form>
        </div>
      {/if}
    </div>
  {/if}
</div>

<!-- 블록 수정 -->
<Dialog.Root open={editBlock !== null} onOpenChange={(open) => !open && (editBlock = null)}>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>내용 수정</Dialog.Title>
    </Dialog.Header>
    <form class="grid gap-4" onsubmit={saveBlock}>
      <div class="flex flex-wrap gap-2">
        <Select.Root type="single" bind:value={editType}>
          <Select.Trigger class="h-9 w-28">{typeLabel(editType)}</Select.Trigger>
          <Select.Content>
            {#each BLOCK_TYPES as item (item.value)}
              <Select.Item value={item.value} label={item.label} />
            {/each}
          </Select.Content>
        </Select.Root>
        {#if needsCharacter(editType)}
          <Select.Root type="single" bind:value={editCharacterId}>
            <Select.Trigger class="h-9 w-36">
              {editCharacterId ? characterName(editCharacterId) : "화자 (선택)"}
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="" label="화자 없음" />
              {#each castRoles as role (role.id)}
                <Select.Item value={role.id} label={role.name} />
              {/each}
            </Select.Content>
          </Select.Root>
        {/if}
        <Input bind:value={editCueLabel} maxlength={20} placeholder="큐 라벨" class="h-9 w-28" />
      </div>
      <div class="grid gap-2">
        <Label for="editText">내용</Label>
        <Textarea id="editText" bind:value={editText} rows={4} maxlength={2000} required />
      </div>
      <Dialog.Footer class="gap-2 sm:justify-between">
        <Button type="button" variant="ghost" class="text-destructive" onclick={deleteBlock} disabled={saving}>
          삭제
        </Button>
        <div class="flex gap-2">
          <Button type="button" variant="ghost" onclick={() => (editBlock = null)}>취소</Button>
          <Button type="submit" disabled={saving || !editText.trim()}>저장</Button>
        </div>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

<!-- 대본 삭제 -->
<Dialog.Root open={showDelete} onOpenChange={(open) => !open && (showDelete = false)}>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>대본 삭제</Dialog.Title>
      <Dialog.Description>
        {#if script}<span class="text-foreground font-semibold">「{script.title}」</span>{/if} 대본을 삭제할까요?
      </Dialog.Description>
    </Dialog.Header>

    <div class="bg-muted/50 text-muted-foreground rounded-xl px-4 py-3 text-sm">
      대본 목록과 큐시트에서 사라지지만, <span class="text-foreground font-medium">데이터는 지워지지 않고 보관</span>됩니다.
      "삭제된 대본"에서 언제든 복구할 수 있어요.
    </div>

    <Dialog.Footer class="gap-2">
      <Button type="button" variant="ghost" onclick={() => (showDelete = false)} disabled={deleting}>취소</Button>
      <Button type="button" variant="destructive" onclick={confirmDeleteScript} disabled={deleting}>삭제</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<!-- 대본 불러오기 (파일/붙여넣기 → 검수 → 반영) -->
<Dialog.Root bind:open={importOpen}>
  <Dialog.Content class="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
    <Dialog.Header>
      <Dialog.Title>대본 불러오기</Dialog.Title>
      <Dialog.Description>
        {importPreview
          ? "가져온 내용을 검수하고 현재 대본 뒤에 이어 붙입니다. 반영 전 현재 대본은 버전으로 백업됩니다."
          : "txt·docx·pdf 파일을 올리거나, 대본 텍스트를 붙여넣으세요. 바로 반영하지 않고 검수 단계를 거칩니다."}
      </Dialog.Description>
    </Dialog.Header>

    {#if !importPreview}
      <div class="grid gap-4">
        <div class="grid gap-2">
          <div class="flex items-center justify-between">
            <Label for="importText">대본 내용 붙여넣기</Label>
            <label class="text-primary cursor-pointer text-xs font-medium hover:underline {importBusy ? 'pointer-events-none opacity-50' : ''}">
              {importBusy ? "읽는 중..." : "파일 선택 (txt·docx·pdf)"}
              <input
                type="file"
                accept=".txt,.pdf,.docx,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                class="hidden"
                disabled={importBusy}
                onchange={onImportFile}
              />
            </label>
          </div>
          <Textarea
            id="importText"
            bind:value={importText}
            class="h-56 resize-none overflow-y-auto font-mono text-xs leading-relaxed"
            placeholder={"예시)\n1막\n1장. 만남\n지문: 묵직한 정적.\n민준: 오랜만이야."}
          />
        </div>
        <Dialog.Footer class="gap-2">
          <Button type="button" variant="ghost" onclick={() => (importOpen = false)} disabled={importBusy}>취소</Button>
          <Button type="button" onclick={createImportFromPaste} disabled={importBusy || importText.trim().length < 2}>
            {importBusy ? "만드는 중..." : "검수 초안 만들기"}
          </Button>
        </Dialog.Footer>
      </div>
    {:else}
      <div class="grid gap-3">
        <div class="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span>막 {importPreview.detectedActs} · 장 {importPreview.detectedScenes} · 블록 {reviewedBlocks.length}</span>
          {#each importPreview.warnings as warning, index (index)}
            <span class="text-amber-600">{warning.message}</span>
          {/each}
        </div>
        <div class="grid max-h-[46dvh] gap-1.5 overflow-y-auto pe-1">
          {#each reviewedBlocks as block, index (block.tempId)}
            <div class="border-border/60 grid grid-cols-[88px_minmax(0,1fr)] items-start gap-2 rounded-lg border p-2">
              <Select.Root
                type="single"
                value={block.type}
                onValueChange={(value) =>
                  (reviewedBlocks = reviewedBlocks.map((item, i) =>
                    i === index ? { ...item, type: value as ReviewedImportBlock["type"] } : item
                  ))}
              >
                <Select.Trigger class="h-8 w-full text-xs">{typeLabel(block.type)}</Select.Trigger>
                <Select.Content>
                  {#each BLOCK_TYPES as item (item.value)}
                    <Select.Item value={item.value} label={item.label} />
                  {/each}
                </Select.Content>
              </Select.Root>
              <div class="grid gap-1">
                <Textarea
                  value={block.text}
                  rows={2}
                  class="text-xs"
                  oninput={(event) =>
                    (reviewedBlocks = reviewedBlocks.map((item, i) =>
                      i === index ? { ...item, text: (event.currentTarget as HTMLTextAreaElement).value } : item
                    ))}
                />
                <div class="text-muted-foreground flex flex-wrap gap-x-2 text-[11px]">
                  {#if block.speakerName}<span>화자 · {block.speakerName}</span>{/if}
                  <span>{block.actTitle} · {block.sceneTitle}</span>
                </div>
              </div>
            </div>
          {/each}
        </div>
        <Dialog.Footer class="gap-2">
          <Button type="button" variant="ghost" onclick={() => (importPreview = null)} disabled={importBusy}>다시 불러오기</Button>
          <Button type="button" onclick={applyImport} disabled={importBusy || reviewedBlocks.length === 0}>
            {importBusy ? "반영 중..." : `대본에 반영 (${reviewedBlocks.length})`}
          </Button>
        </Dialog.Footer>
      </div>
    {/if}
  </Dialog.Content>
</Dialog.Root>
