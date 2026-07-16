<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { fileSha256Checksum } from "$lib/api/checksum";
  import { ApiError, apiRequest, uploadSignedObject, type SignedObjectRequest } from "$lib/api/client";
  import AppIcon from "$lib/components/AppIcon.svelte";

  type SceneBlockType = "DIALOGUE" | "LYRIC" | "STAGE_DIRECTION" | "NOTE";
  type Annotation = { id: string; type: string; content: string; isShared: boolean };
  type MusicCue = { id: string; cueNumber: string; cueType: string; anchorStatus: string; order: number };
  type Block = {
    id: string;
    order: number;
    type: SceneBlockType;
    text: string;
    cueLabel?: string | null;
    characterId?: string | null;
    annotations: Annotation[];
    musicCues: MusicCue[];
  };
  type Scene = { id: string; order: number; title: string; summary?: string | null; blocks: Block[] };
  type Act = { id: string; order: number; title: string; scenes: Scene[] };
  type ScriptMode = "write" | "import" | "version";
  type ScriptSummary = {
    id: string;
    title: string;
    acts: Array<{ id: string; title: string; scenes: Array<{ id: string; title: string; blocks: Array<{ id: string }> }> }>;
  };
  type ScriptDetail = { id: string; title: string; acts: Act[]; versions: Array<{ id: string; label: string; createdAt: string }> };
  type Dashboard = { production: { title: string }; myRoles: string[] };
  type RestoreResult = {
    restoredLabel: string;
    backupVersionId?: string | null;
    removed?: { acts: number; scenes: number; blocks: number };
    brokenAnchors?: { total: number };
  };
  type ImportPreview = {
    importId: string;
    status: string;
    detectedActs: number;
    detectedScenes: number;
    blocks: Array<{
      tempId: string;
      type: SceneBlockType;
      speakerName?: string;
      text: string;
      confidence?: number;
      actTitle?: string;
      sceneTitle?: string;
    }>;
    warnings: Array<{ code: string; message: string }>;
  };
  type ReviewedImportBlock = {
    tempId: string;
    type: SceneBlockType;
    speakerName: string;
    text: string;
    actTitle: string;
    sceneTitle: string;
  };
  type AssetCreateResponse = {
    asset: { id: string };
    upload: SignedObjectRequest;
  };

  const blockTypes: Array<{ value: SceneBlockType; label: string }> = [
    { value: "DIALOGUE", label: "대사" },
    { value: "LYRIC", label: "가사" },
    { value: "STAGE_DIRECTION", label: "지문" },
    { value: "NOTE", label: "메모" }
  ];
  const scriptModes: Array<{ value: ScriptMode; label: string; description: string; icon: "book-open" | "file-edit" | "list" }> = [
    { value: "write", label: "직접 작성", description: "장면을 고르고 블록 추가", icon: "book-open" },
    { value: "import", label: "파일/붙여넣기", description: "가져온 대본을 검수 후 반영", icon: "file-edit" },
    { value: "version", label: "버전 관리", description: "저장본을 만들고 복원", icon: "list" }
  ];

  const productionId = $derived(page.params.pid);
  const scriptImportAcceptTypes = [
    "text/plain",
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".txt",
    ".pdf",
    ".docx"
  ].join(",");

  let productionTitle = $state("");
  let roles = $state<string[]>([]);
  let scripts = $state<ScriptSummary[]>([]);
  let selectedScript = $state<ScriptDetail | null>(null);
  let selectedScriptId = $state("");
  let selectedActId = $state("");
  let selectedSceneId = $state("");
  let loading = $state(true);
  let saving = $state(false);
  let errorMessage = $state("");
  let noticeMessage = $state("");

  let newScriptTitle = $state("리딩 대본");
  let newActTitle = $state("");
  let newSceneTitle = $state("");
  let blockType = $state<SceneBlockType>("DIALOGUE");
  let blockCueLabel = $state("");
  let blockText = $state("");
  let editingBlockId = $state("");
  let editType = $state<SceneBlockType>("DIALOGUE");
  let editCueLabel = $state("");
  let editText = $state("");
  let pendingDeleteBlockId = $state("");
  let pendingDeleteMessage = $state("");
  let versionLabel = $state("");
  let pendingRestoreVersionId = $state("");
  let restoreImpactMessage = $state("");
  let forceRestoreVersionId = $state("");
  let rawImportText = $state("");
  let scriptImportFiles = $state<FileList | undefined>();
  let scriptImportInputKey = $state(0);
  let importPreview = $state<ImportPreview | null>(null);
  let reviewedImportBlocks = $state<ReviewedImportBlock[]>([]);
  let scriptMode = $state<ScriptMode>("write");
  let blockFormOpen = $state(false);
  let structureFormOpen = $state(false);

  const canEdit = $derived(roles.length === 0 || roles.includes("PRODUCER") || roles.includes("DIRECTOR"));
  const selectedAct = $derived(findAct(selectedScript, selectedActId));
  const selectedScene = $derived(findScene(selectedScript, selectedSceneId));

  onMount(() => {
    void loadInitial();
  });

  function findAct(script: ScriptDetail | null, actId: string) {
    return script?.acts.find((act) => act.id === actId) ?? script?.acts[0] ?? null;
  }

  function findScene(script: ScriptDetail | null, sceneId: string) {
    for (const act of script?.acts ?? []) {
      const scene = act.scenes.find((item) => item.id === sceneId);
      if (scene) {
        return scene;
      }
    }
    return script?.acts[0]?.scenes[0] ?? null;
  }

  async function loadInitial() {
    loading = true;
    errorMessage = "";
    try {
      const dashboard = await apiRequest<Dashboard>(`/productions/${productionId}/dashboard`);
      productionTitle = dashboard.production.title;
      roles = dashboard.myRoles;
      await loadScripts();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "대본 화면을 불러오지 못했어요";
    } finally {
      loading = false;
    }
  }

  async function loadScripts() {
    scripts = await apiRequest<ScriptSummary[]>(`/productions/${productionId}/scripts`);
    if (!scripts.length) {
      selectedScript = null;
      selectedScriptId = "";
      selectedActId = "";
      selectedSceneId = "";
      return;
    }
    const nextScriptId = selectedScriptId || scripts[0].id;
    await selectScript(nextScriptId);
  }

  async function selectScript(scriptId: string) {
    selectedScriptId = scriptId;
    selectedScript = await apiRequest<ScriptDetail>(`/productions/${productionId}/scripts/${scriptId}`);
    selectedActId = selectedActId || selectedScript.acts[0]?.id || "";
    selectedSceneId = selectedSceneId || selectedScript.acts[0]?.scenes[0]?.id || "";
  }

  function selectScene(actId: string, sceneId: string) {
    selectedActId = actId;
    selectedSceneId = sceneId;
    pendingDeleteBlockId = "";
    pendingDeleteMessage = "";
    blockFormOpen = false;
  }

  function startRestoreVersion(versionId: string) {
    pendingRestoreVersionId = versionId;
    restoreImpactMessage = "";
    forceRestoreVersionId = "";
  }

  async function createScript(event: SubmitEvent) {
    event.preventDefault();
    await mutate(async () => {
      const script = await apiRequest<ScriptDetail>(`/productions/${productionId}/scripts`, {
        method: "POST",
        body: JSON.stringify({ title: newScriptTitle })
      });
      selectedScriptId = script.id;
      selectedActId = script.acts[0]?.id || "";
      selectedSceneId = script.acts[0]?.scenes[0]?.id || "";
      noticeMessage = "대본을 만들었어요.";
      await loadScripts();
    });
  }

  async function createAct(event: SubmitEvent) {
    event.preventDefault();
    if (!selectedScriptId || !newActTitle.trim()) return;
    await mutate(async () => {
      const act = await apiRequest<Act>(`/productions/${productionId}/scripts/${selectedScriptId}/acts`, {
        method: "POST",
        body: JSON.stringify({ title: newActTitle, initialSceneTitle: "1장" })
      });
      newActTitle = "";
      selectedActId = act.id;
      selectedSceneId = act.scenes[0]?.id || "";
      structureFormOpen = false;
      await selectScript(selectedScriptId);
    });
  }

  async function createScene(event: SubmitEvent) {
    event.preventDefault();
    if (!selectedAct?.id || !newSceneTitle.trim()) return;
    await mutate(async () => {
      const scene = await apiRequest<Scene>(`/productions/${productionId}/acts/${selectedAct.id}/scenes`, {
        method: "POST",
        body: JSON.stringify({ title: newSceneTitle })
      });
      newSceneTitle = "";
      selectedSceneId = scene.id;
      structureFormOpen = false;
      await selectScript(selectedScriptId);
    });
  }

  async function createBlock(event: SubmitEvent) {
    event.preventDefault();
    if (!selectedSceneId || !blockText.trim()) return;
    await mutate(async () => {
      await apiRequest<Block>(`/productions/${productionId}/scenes/${selectedSceneId}/blocks`, {
        method: "POST",
        body: JSON.stringify({
          type: blockType,
          text: blockText,
          cueLabel: blockCueLabel || null
        })
      });
      blockText = "";
      blockCueLabel = "";
      blockFormOpen = false;
      await selectScript(selectedScriptId);
    });
  }

  function startEdit(block: Block) {
    editingBlockId = block.id;
    editType = block.type;
    editCueLabel = block.cueLabel ?? "";
    editText = block.text;
  }

  async function saveBlock(blockId: string) {
    await mutate(async () => {
      await apiRequest<Block>(`/productions/${productionId}/blocks/${blockId}`, {
        method: "PATCH",
        body: JSON.stringify({ type: editType, text: editText, cueLabel: editCueLabel || null })
      });
      editingBlockId = "";
      await selectScript(selectedScriptId);
    });
  }

  async function deleteBlock(blockId: string, force = false) {
    await mutate(async () => {
      try {
        await apiRequest<{ deletedId: string }>(`/productions/${productionId}/blocks/${blockId}${force ? "?force=true" : ""}`, {
          method: "DELETE"
        });
        pendingDeleteBlockId = "";
        pendingDeleteMessage = "";
        await selectScript(selectedScriptId);
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          pendingDeleteBlockId = blockId;
          pendingDeleteMessage = error.message;
          return;
        }
        throw error;
      }
    });
  }

  async function saveVersion(event: SubmitEvent) {
    event.preventDefault();
    if (!selectedScriptId || !versionLabel.trim()) return;
    await mutate(async () => {
      await apiRequest(`/productions/${productionId}/scripts/${selectedScriptId}/versions`, {
        method: "POST",
        body: JSON.stringify({ label: versionLabel })
      });
      noticeMessage = "현재 대본 버전을 저장했어요.";
      versionLabel = "";
      await selectScript(selectedScriptId);
    });
  }

  async function restoreVersion(versionId: string, force = false) {
    if (!selectedScriptId) return;
    saving = true;
    errorMessage = "";
    noticeMessage = "";
    restoreImpactMessage = "";
    try {
      const result = await apiRequest<RestoreResult>(`/productions/${productionId}/scripts/${selectedScriptId}/versions/${versionId}/restore`, {
        method: "POST",
        body: JSON.stringify({
          createBackupVersion: true,
          backupLabel: `복원 전 백업 - ${new Date().toLocaleString()}`,
          force
        })
      });
      pendingRestoreVersionId = "";
      forceRestoreVersionId = "";
      noticeMessage = `"${result.restoredLabel}" 버전으로 복원했어요. 삭제된 블록 ${result.removed?.blocks ?? 0}개, 끊긴 anchor ${result.brokenAnchors?.total ?? 0}개`;
      await selectScript(selectedScriptId);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        restoreImpactMessage = error.message;
        forceRestoreVersionId = canForceRestore(error.details) ? versionId : "";
        return;
      }
      errorMessage = error instanceof Error ? error.message : "대본 버전을 복원하지 못했어요";
    } finally {
      saving = false;
    }
  }

  function canForceRestore(details: unknown) {
    return typeof details === "object" && details !== null && "canForce" in details && (details as { canForce?: unknown }).canForce === true;
  }

  async function createImport(event: SubmitEvent) {
    event.preventDefault();
    if (!selectedScriptId || !rawImportText.trim()) return;
    await mutate(async () => {
      const preview = await apiRequest<ImportPreview>(`/productions/${productionId}/scripts/${selectedScriptId}/imports`, {
        method: "POST",
        body: JSON.stringify({ rawText: rawImportText, sourceType: "PASTE", parseMode: "BLOCK_DRAFT" })
      });
      setImportPreview(preview);
      noticeMessage = "가져오기 draft를 만들었어요. 검수 후 반영해 주세요.";
    });
  }

  async function createFileImport(event: SubmitEvent) {
    event.preventDefault();
    if (!selectedScriptId || !selectedScriptImportFile()) return;
    await mutate(async () => {
      const file = selectedScriptImportFile();
      if (!file) return;
      const mimeType = resolveScriptImportMimeType(file);
      const checksum = await fileSha256Checksum(file);
      const asset = await apiRequest<AssetCreateResponse>("/assets", {
        method: "POST",
        body: JSON.stringify({
          purpose: "SCRIPT_IMPORT",
          productionId,
          fileName: file.name,
          mimeType,
          size: file.size,
          checksum
        })
      });
      await uploadSignedObject(asset.upload, file, mimeType);
      const preview = await apiRequest<ImportPreview>(`/productions/${productionId}/scripts/${selectedScriptId}/imports`, {
        method: "POST",
        body: JSON.stringify({ assetId: asset.asset.id, parseMode: "BLOCK_DRAFT" })
      });
      setImportPreview(preview);
      noticeMessage = "파일 가져오기 draft를 만들었어요. 검수 후 반영해 주세요.";
    });
  }

  async function applyImport() {
    if (!selectedScriptId || !importPreview) return;
    const preview = importPreview;
    const reviewedBlocks = reviewedBlocksForApply();
    if (!reviewedBlocks.length) {
      errorMessage = "반영할 검수 블록이 없어요.";
      return;
    }
    await mutate(async () => {
      await apiRequest(`/productions/${productionId}/scripts/${selectedScriptId}/imports/${preview.importId}/apply`, {
        method: "POST",
        body: JSON.stringify({ mode: "APPEND", reviewedBlocks, createVersion: true, versionName: "import 반영본" })
      });
      rawImportText = "";
      clearScriptImportFiles();
      clearImportDraft();
      noticeMessage = "가져온 대본을 실제 대본에 반영했어요.";
      await selectScript(selectedScriptId);
    });
  }

  function setImportPreview(preview: ImportPreview) {
    importPreview = preview;
    scriptMode = "import";
    reviewedImportBlocks = preview.blocks.map((block) => ({
      tempId: block.tempId,
      type: block.type,
      speakerName: block.speakerName ?? "",
      text: block.text,
      actTitle: block.actTitle ?? "가져온 대본",
      sceneTitle: block.sceneTitle ?? "검수 반영"
    }));
  }

  function updateReviewedImportBlock(index: number, patch: Partial<ReviewedImportBlock>) {
    reviewedImportBlocks = reviewedImportBlocks.map((block, blockIndex) => (blockIndex === index ? { ...block, ...patch } : block));
  }

  function reviewedBlocksForApply() {
    return reviewedImportBlocks
      .map((block) => ({
        tempId: block.tempId,
        type: block.type,
        speakerName: block.speakerName.trim() || undefined,
        text: block.text.trim(),
        actTitle: block.actTitle.trim() || undefined,
        sceneTitle: block.sceneTitle.trim() || undefined
      }))
      .filter((block) => block.text.length > 0);
  }

  function clearImportDraft() {
    importPreview = null;
    reviewedImportBlocks = [];
  }

  function selectedScriptImportFile() {
    return scriptImportFiles?.[0] ?? null;
  }

  function selectedScriptImportSummary() {
    const file = selectedScriptImportFile();
    return file ? `${file.name} (${formatBytes(file.size)})` : "선택된 파일 없음";
  }

  function clearScriptImportFiles() {
    scriptImportFiles = typeof DataTransfer === "undefined" ? undefined : new DataTransfer().files;
    scriptImportInputKey += 1;
  }

  function resolveScriptImportMimeType(file: File) {
    if (file.type && file.type !== "application/octet-stream") return file.type;
    const extension = file.name.toLowerCase().split(".").pop() ?? "";
    const mimeByExtension: Record<string, string> = {
      txt: "text/plain",
      pdf: "application/pdf",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    };
    return mimeByExtension[extension] ?? "text/plain";
  }

  function formatBytes(value: number) {
    if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)}MB`;
    if (value >= 1024) return `${Math.ceil(value / 1024)}KB`;
    return `${value}B`;
  }

  async function mutate(work: () => Promise<void>) {
    saving = true;
    errorMessage = "";
    noticeMessage = "";
    try {
      await work();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "저장하지 못했어요";
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head>
  <title>{productionTitle || "대본 관리"} · 아트브릿지</title>
</svelte:head>

<main class="page">
  <div class="container">
    <div class="toolbar">
      <div>
        <p class="badge">대본 작업</p>
        <h1>{productionTitle || "대본 관리"}</h1>
        <p class="muted">장면을 고르고 대사·가사·지문을 한 줄씩 추가합니다. 파일 가져오기와 버전 관리는 필요할 때만 엽니다.</p>
      </div>
      <div class="button-row">
        <a class="button" href={`/p/${productionId}`}>대시보드</a>
        <a class="button" href={`/p/${productionId}/script/read`}>낭독 보기</a>
      </div>
    </div>

    {#if loading}
      <article class="card">대본 화면을 불러오고 있어요.</article>
    {:else if errorMessage && !selectedScript}
      <article class="card">
        <h2>대본을 불러오지 못했어요</h2>
        <p class="error">{errorMessage}</p>
      </article>
    {:else if !canEdit}
      <article class="card">
        <h2>편집 권한이 없어요</h2>
        <p class="muted">배우와 스태프는 대본을 읽고 본인 주석을 남길 수 있어요.</p>
        <a class="button primary" href={`/p/${productionId}/script/read`}>낭독 보기</a>
      </article>
    {:else}
      {#if noticeMessage}
        <p class="success">{noticeMessage}</p>
      {/if}
      {#if errorMessage}
        <p class="error">{errorMessage}</p>
      {/if}

      <section class="script-task-switcher" aria-label="대본 작업 선택">
        {#each scriptModes as mode (mode.value)}
          <button
            class:active={scriptMode === mode.value}
            class="script-task-card"
            type="button"
            onclick={() => (scriptMode = mode.value)}
          >
            <span class="script-task-icon"><AppIcon name={mode.icon} /></span>
            <span>
              <strong>{mode.label}</strong>
              <small>{mode.description}</small>
            </span>
          </button>
        {/each}
      </section>

      <div class={`workbench script-workbench ${scriptMode === "write" ? "write-mode" : "support-mode"}`}>
        <aside class="panel">
          <div class="panel-title compact-title">
            <div>
              <h2>대본 구조</h2>
              <p class="muted">막과 장을 선택하세요.</p>
            </div>
            {#if selectedScript}
              <button class="button compact" type="button" onclick={() => (structureFormOpen = !structureFormOpen)}>
                {structureFormOpen ? "닫기" : "막·장 추가"}
              </button>
            {/if}
          </div>
          {#if scripts.length === 0}
            <form class="stack" onsubmit={createScript}>
              <div class="field">
                <label for="newScriptTitle">대본 제목</label>
                <input id="newScriptTitle" bind:value={newScriptTitle} required />
              </div>
              <button class="button primary" type="submit" disabled={saving}>대본 만들기</button>
            </form>
          {:else}
            <div class="field">
              <label for="scriptSelect">대본 선택</label>
              <select id="scriptSelect" bind:value={selectedScriptId} onchange={() => void selectScript(selectedScriptId)}>
                {#each scripts as script (script.id)}
                  <option value={script.id}>{script.title}</option>
                {/each}
              </select>
            </div>

            {#if selectedScript}
              <nav class="tree" aria-label="막과 장">
                {#each selectedScript.acts as act (act.id)}
                  <section>
                    <button class="tree-act" class:active={selectedActId === act.id} type="button" onclick={() => (selectedActId = act.id)}>
                      {act.title}
                    </button>
                    {#each act.scenes as scene (scene.id)}
                      <button
                        class="tree-scene"
                        class:active={selectedSceneId === scene.id}
                        type="button"
                        onclick={() => selectScene(act.id, scene.id)}
                      >
                        <span>{scene.title}</span>
                        <small>{scene.blocks.length}개</small>
                      </button>
                    {/each}
                  </section>
                {/each}
              </nav>

              {#if structureFormOpen}
                <div class="structure-actions">
                  <form class="stack compact" onsubmit={createAct}>
                    <div class="field">
                      <label for="newActTitle">막 추가</label>
                      <input id="newActTitle" bind:value={newActTitle} placeholder="예: 2막" />
                    </div>
                    <button class="button" type="submit" disabled={saving || !newActTitle.trim()}>추가</button>
                  </form>

                  <form class="stack compact" onsubmit={createScene}>
                    <div class="field">
                      <label for="newSceneTitle">선택한 막에 장 추가</label>
                      <input id="newSceneTitle" bind:value={newSceneTitle} placeholder="예: 3장 광장" />
                    </div>
                    <button class="button" type="submit" disabled={saving || !selectedAct || !newSceneTitle.trim()}>추가</button>
                  </form>
                </div>
              {/if}
            {/if}
          {/if}
        </aside>

        <section class="panel editor-panel">
          <div class="panel-title">
            <div>
              <h2>{selectedScene?.title ?? "장 선택"}</h2>
              <p class="muted">{selectedAct?.title ?? "막을 선택해 주세요"}</p>
            </div>
            <div class="editor-actions">
              <span class="badge">{selectedScene?.blocks.length ?? 0}개 블록</span>
              {#if selectedScene}
                <button class="button compact primary" type="button" onclick={() => (blockFormOpen = !blockFormOpen)}>
                  {blockFormOpen ? "입력 닫기" : "블록 추가"}
                </button>
              {/if}
            </div>
          </div>

          {#if !selectedScene}
            <p class="muted">대본을 만들거나 장을 선택하면 블록을 입력할 수 있어요.</p>
          {:else}
            <div class="block-list">
              {#each selectedScene.blocks as block (block.id)}
                <article class="block-row">
                  <div class="block-meta">
                    <span class="badge">{blockTypes.find((type) => type.value === block.type)?.label ?? block.type}</span>
                    {#if block.cueLabel}
                      <span class="badge">{block.cueLabel}</span>
                    {/if}
                    {#if block.annotations.length}
                      <span class="badge">주석 {block.annotations.length}</span>
                    {/if}
                    {#if block.musicCues.length}
                      <span class="badge">큐 {block.musicCues.length}</span>
                    {/if}
                  </div>

                  {#if editingBlockId === block.id}
                    <div class="grid two">
                      <div class="field">
                        <label for={`editType-${block.id}`}>타입</label>
                        <select id={`editType-${block.id}`} bind:value={editType}>
                          {#each blockTypes as type (type.value)}
                            <option value={type.value}>{type.label}</option>
                          {/each}
                        </select>
                      </div>
                      <div class="field">
                        <label for={`editCue-${block.id}`}>화자/라벨</label>
                        <input id={`editCue-${block.id}`} bind:value={editCueLabel} />
                      </div>
                    </div>
                    <div class="field">
                      <label for={`editText-${block.id}`}>본문</label>
                      <textarea id={`editText-${block.id}`} rows="5" bind:value={editText}></textarea>
                    </div>
                    <div class="button-row">
                      <button class="button primary" type="button" onclick={() => void saveBlock(block.id)} disabled={saving}>저장</button>
                      <button class="button" type="button" onclick={() => (editingBlockId = "")}>취소</button>
                    </div>
                  {:else}
                    <p class="script-text">{block.text}</p>
                    <div class="button-row">
                      <button class="button" type="button" onclick={() => startEdit(block)}>수정</button>
                      <button class="button danger" type="button" onclick={() => void deleteBlock(block.id)}>삭제</button>
                    </div>
                    {#if pendingDeleteBlockId === block.id}
                      <div class="warning-box">
                        <p>{pendingDeleteMessage}</p>
                        <button class="button danger" type="button" onclick={() => void deleteBlock(block.id, true)}>영향 확인 후 삭제</button>
                      </div>
                    {/if}
                  {/if}
                </article>
              {:else}
                <article class="empty-state script-empty-state">
                  <h3>아직 블록이 없어요.</h3>
                  <p class="muted">첫 대사나 지문을 추가하면 이 장의 리딩 흐름이 만들어집니다.</p>
                  <button class="button primary" type="button" onclick={() => (blockFormOpen = true)}>첫 블록 추가</button>
                </article>
              {/each}
            </div>

            {#if blockFormOpen}
              <form class="block-form block-compose-card" onsubmit={createBlock}>
                <div class="panel-title compact-title">
                  <div>
                    <h3>블록 추가</h3>
                    <p class="muted">대사, 가사, 지문, 메모 중 하나로 저장됩니다.</p>
                  </div>
                  <button class="button compact" type="button" onclick={() => (blockFormOpen = false)}>닫기</button>
                </div>
                <div class="grid two">
                  <div class="field">
                    <label for="blockType">블록 타입</label>
                    <select id="blockType" bind:value={blockType}>
                      {#each blockTypes as type (type.value)}
                        <option value={type.value}>{type.label}</option>
                      {/each}
                    </select>
                  </div>
                  <div class="field">
                    <label for="blockCueLabel">화자/큐 라벨</label>
                    <input id="blockCueLabel" bind:value={blockCueLabel} placeholder="예: 민준, M1" />
                  </div>
                </div>
                <div class="field">
                  <label for="blockText">본문</label>
                  <textarea id="blockText" rows="6" bind:value={blockText} placeholder="대사, 가사, 지문, 메모를 입력하세요."></textarea>
                </div>
                <button class="button primary" type="submit" disabled={saving || !blockText.trim()}>블록 추가</button>
              </form>
            {/if}
          {/if}
        </section>

        {#if scriptMode === "import"}
          <aside class="panel script-side-tools">
            <h2>파일/붙여넣기</h2>
            <p class="muted">가져온 내용은 바로 반영하지 않고 검수 draft로 먼저 만듭니다.</p>
            <form class="stack import-box" onsubmit={createImport}>
              <div class="field">
                <label for="rawImportText">대본 붙여넣기</label>
                <textarea
                  id="rawImportText"
                  rows="9"
                  bind:value={rawImportText}
                  placeholder="# 1막&#10;## 1장&#10;민준: 여기서 시작하자.&#10;[무대 중앙으로 이동]"
                ></textarea>
              </div>
              <button class="button" type="submit" disabled={saving || !selectedScriptId || !rawImportText.trim()}>DRAFT 만들기</button>
            </form>

            <form class="stack import-box" onsubmit={createFileImport}>
              <div class="field">
                <label for="scriptImportFile">대본 파일</label>
                {#key scriptImportInputKey}
                  <input
                    id="scriptImportFile"
                    type="file"
                    accept={scriptImportAcceptTypes}
                    bind:files={scriptImportFiles}
                    disabled={saving || !selectedScriptId}
                  />
                {/key}
                <p class="muted">{selectedScriptImportSummary()}</p>
                <p class="muted">txt, docx, pdf 파일을 업로드하면 원본 Asset을 보관하고 검수 draft를 만듭니다.</p>
              </div>
              <button class="button" type="submit" disabled={saving || !selectedScriptId || !selectedScriptImportFile()}>파일 DRAFT 만들기</button>
            </form>

            {#if importPreview}
              <section class="preview-box">
                <h3>검수 draft</h3>
                <p class="muted">막 {importPreview.detectedActs}개 · 장 {importPreview.detectedScenes}개 · 블록 {importPreview.blocks.length}개</p>
                {#each importPreview.warnings as warning (warning.code + warning.message)}
                  <p class="error">{warning.message}</p>
                {/each}
                <div class="preview-list">
                  {#each reviewedImportBlocks as block, index (block.tempId)}
                    <article class="stack compact">
                      <p class="muted">{block.actTitle} · {block.sceneTitle}</p>
                      <div class="grid two">
                        <div class="field">
                          <label for={`reviewType-${block.tempId}`}>검수 블록 {index + 1} 타입</label>
                          <select
                            id={`reviewType-${block.tempId}`}
                            value={block.type}
                            onchange={(event) => updateReviewedImportBlock(index, { type: event.currentTarget.value as SceneBlockType })}
                          >
                            {#each blockTypes as type (type.value)}
                              <option value={type.value}>{type.label}</option>
                            {/each}
                          </select>
                        </div>
                        <div class="field">
                          <label for={`reviewSpeaker-${block.tempId}`}>화자/배역</label>
                          <input
                            id={`reviewSpeaker-${block.tempId}`}
                            value={block.speakerName}
                            placeholder="예: 민준"
                            oninput={(event) => updateReviewedImportBlock(index, { speakerName: event.currentTarget.value })}
                          />
                        </div>
                      </div>
                      <div class="field">
                        <label for={`reviewText-${block.tempId}`}>본문</label>
                        <textarea
                          id={`reviewText-${block.tempId}`}
                          rows="4"
                          value={block.text}
                          oninput={(event) => updateReviewedImportBlock(index, { text: event.currentTarget.value })}
                        ></textarea>
                      </div>
                    </article>
                  {:else}
                    <p class="muted">검수할 블록이 없어요. 원문을 보완한 뒤 다시 DRAFT를 만드세요.</p>
                  {/each}
                </div>
                <div class="button-row">
                  <button class="button primary" type="button" onclick={applyImport} disabled={saving || reviewedBlocksForApply().length === 0}>대본에 반영</button>
                  <button class="button" type="button" onclick={clearImportDraft} disabled={saving}>draft 취소</button>
                </div>
              </section>
            {/if}
          </aside>
        {:else if scriptMode === "version"}
          <aside class="panel script-side-tools">
            <h2>버전 관리</h2>
            <p class="muted">리딩 전 확정본이나 가져오기 전 백업을 저장해 두세요.</p>
            <form class="stack" onsubmit={saveVersion}>
              <div class="field">
                <label for="versionLabel">버전 라벨</label>
                <input id="versionLabel" bind:value={versionLabel} placeholder="예: 1차 리딩본" />
              </div>
              <button class="button" type="submit" disabled={saving || !selectedScriptId || !versionLabel.trim()}>버전 저장</button>
            </form>

            {#if selectedScript?.versions.length}
              <div class="version-list">
                {#each selectedScript.versions.slice(0, 4) as version (version.id)}
                  <article class="version-row">
                    <div>
                      <strong>{version.label}</strong><br /><span class="muted">{new Date(version.createdAt).toLocaleString()}</span>
                    </div>
                    <div class="button-row">
                      <button class="button" type="button" onclick={() => startRestoreVersion(version.id)} disabled={saving}>복원</button>
                    </div>
                    {#if pendingRestoreVersionId === version.id}
                      <div class="warning-box">
                        <p>현재 대본을 백업 버전으로 저장한 뒤 이 버전의 막/장/블록 구조로 복원합니다.</p>
                        {#if restoreImpactMessage}
                          <p class="error">{restoreImpactMessage}</p>
                        {/if}
                        <div class="button-row">
                          <button class="button danger" type="button" onclick={() => void restoreVersion(version.id)} disabled={saving}>복원 실행</button>
                          {#if forceRestoreVersionId === version.id}
                            <button class="button danger" type="button" onclick={() => void restoreVersion(version.id, true)} disabled={saving}>
                              영향 확인 후 강제 복원
                            </button>
                          {/if}
                          <button class="button" type="button" onclick={() => (pendingRestoreVersionId = "")}>취소</button>
                        </div>
                      </div>
                    {/if}
                  </article>
                {/each}
              </div>
            {/if}
          </aside>
        {/if}
      </div>
    {/if}
  </div>
</main>
