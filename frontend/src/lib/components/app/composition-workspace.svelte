<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { beforeNavigate } from "$app/navigation";
  import { toast } from "svelte-sonner";
  import { apiRequest, ApiError } from "$lib/api/client";
  import { captureSession, isCurrentSession, type ClientSession } from "$lib/api/session";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import { PageHeader } from "$lib/components/ui/page-header";
  import { EmptyState } from "$lib/components/ui/empty-state";
  import SectionList from "./composition-section-list.svelte";
  import SectionForm from "./composition-section-form.svelte";
  import MediaLinks from "./composition-media-links.svelte";
  import ImportForm from "./composition-import-form.svelte";
  import ScriptRegister from "./script-register.svelte";
  import VideoBatch from "./composition-video-batch.svelte";
  import MediaBoard from "./composition-media-board.svelte";
  import SceneMedia from "./composition-scene-media.svelte";
  import SceneLineEditor from "./scene-line-editor.svelte";
  import Attachments from "./composition-attachments.svelte";
  import { formatTime, hasScriptMaterial, sectionOrder, type CompositionBoard, type ImportPreview } from "$lib/domain/composition";
  let { pid }: { pid: string } = $props();
  type Tab = "register" | "videos" | "lines" | "section" | "media" | "attachments" | "import";
  let board = $state<CompositionBoard | null>(null);
  let selectedId = $state("");
  let tab = $state<Tab>("section");
  let importMode = $state<"text" | "script">("text");
  let showMore = $state(false);
  // "AI 없이 직접 만들기"로 들어와 아직 아무것도 쓰지 않은 첫 장 하나뿐인 상태 — AI 등록으로 되돌아갈 수 있게 안내한다.
  const blankStart = $derived(Boolean(board?.canEdit) && board?.sections.length === 1 && !board.sections[0].scriptText.trim() && !board.sections[0].lyrics.trim() && !board.sections[0].media.length && !board.sections[0].sourceSceneId);
  // 구성이 아직 없는 처음 화면은 대본 등록만 보여 준다(구간 선택·탭은 구성이 생긴 뒤에).
  const firstRun = $derived(Boolean(board?.canEdit) && (board?.sections.length ?? 0) === 0 && tab === "register");
  let loading = $state(true);
  let busy = $state(false);
  let saving = $state(false);
  let transferring = $state(false);
  let attachmentDirty = $state(false);
  let stale = $state(false);
  let error = $state("");
  let sectionDirty = $state(false), mediaDirty = $state(false), importDirty = $state(false), registerDirty = $state(false), videoDirty = $state(false), lineDirty = $state(false), lineSaving = $state(false);
  let resetKey = $state(0);
  let disposed = false;
  const viewSession = captureSession();
  const unsaved = $derived(sectionDirty || mediaDirty || importDirty || attachmentDirty || registerDirty || videoDirty || lineDirty);
  const locked = $derived(busy || transferring || loading || stale || lineSaving);
  const selected = $derived(board?.sections.find((s) => s.id === selectedId));
  const chapterCount = $derived(board?.sections.filter((s) => s.kind === "CHAPTER" || s.kind === "ACT").length ?? 0);
  const sceneCount = $derived(board?.sections.filter((s) => s.kind === "SCENE").length ?? 0);
  const otherCount = $derived((board?.sections.length ?? 0) - chapterCount - sceneCount);
  const base = $derived(`/productions/${pid}/composition`);

  function clearDraftFlags() { sectionDirty = false; mediaDirty = false; importDirty = false; attachmentDirty = false; registerDirty = false; videoDirty = false; lineDirty = false; resetKey += 1; }
  function canLeaveDraft() {
    if (busy || transferring || lineSaving) return false;
    if (unsaved && !window.confirm("저장하지 않은 내용이 있어요. 변경 내용을 버리고 이동할까요?")) return false;
    clearDraftFlags(); return true;
  }
  beforeNavigate((navigation) => {
    if (saving || transferring || lineSaving) { navigation.cancel(); toast.info("파일을 올리거나 저장하는 중이에요. 잠시 기다려 주세요."); return; }
    if (unsaved && !window.confirm("저장하지 않은 입력을 남기고 이동할까요?")) navigation.cancel();
  });
  onMount(() => {
    void reload(false);
    const unload = (event: BeforeUnloadEvent) => { if (unsaved || saving || transferring || lineSaving) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  });
  onDestroy(() => { disposed = true; });

  async function fetchBoard(preferred?: string, session: ClientSession = viewSession, id = pid) {
    if (disposed || !isCurrentSession(viewSession) || !isCurrentSession(session) || id !== pid) return;
    const result = await apiRequest<CompositionBoard>(`/productions/${id}/composition`, { session });
    if (disposed || id !== pid || !isCurrentSession(session)) return;
    const firstLoad = !board;
    board = result;
    // 큐시트 등에서 ?section=구간ID&tab=lines 로 들어오면 그 구간의 그 탭을 연다.
    const params = firstLoad && typeof location !== "undefined" ? new URL(location.href).searchParams : null;
    const linked = params?.get("section");
    const wanted = preferred ?? (linked && result.sections.some((s) => s.id === linked) ? linked : selectedId);
    const ordered = sectionOrder(result.sections);
    const firstScene = ordered.find(hasScriptMaterial) ?? ordered.find((section) => section.sourceSceneId || section.kind === "SCENE");
    selectedId = ordered.find((section) => section.id === wanted)?.id ?? firstScene?.id ?? ordered[0]?.id ?? "";
    const requestedTab = params?.get("tab");
    if (requestedTab === "videos" && ordered.length) tab = "videos";
    else if (result.canEdit && requestedTab === "import" && result.scripts.length) { importMode = "script"; tab = "import"; }
    else if (result.canEdit && (requestedTab === "register" || firstLoad && !ordered.length)) tab = "register";
    else if (result.canEdit && requestedTab === "lines") tab = "lines";
    stale = false;
  }
  async function reload(confirmDraft = true) {
    if (busy || transferring || (confirmDraft && !canLeaveDraft())) return;
    loading = !board; busy = true; error = "";
    try { await fetchBoard(); clearDraftFlags(); }
    catch (failure) { if (!disposed) { stale = true; error = failure instanceof Error ? failure.message : "대본과 자료를 불러오지 못했어요."; } }
    finally { if (!disposed) { loading = false; busy = false; } }
  }
  function choose(id: string) { if (id === selectedId || !canLeaveDraft()) return; selectedId = id; }
  function changeTab(next: Tab) { if (next === tab || !canLeaveDraft()) return; tab = next; }

  async function mutate(path: string, fields: object = {}, method = "POST", preferred?: string, draft?: Tab, session: ClientSession = viewSession): Promise<boolean> {
    const id = pid; const requestBase = base;
    if (disposed || !isCurrentSession(viewSession) || !isCurrentSession(session)) return false;
    if (busy || !board?.canEdit || stale) {
      if (stale) toast.error("입력 내용을 보존한 뒤 최신 구성을 불러와 주세요.");
      return false;
    }
    if (unsaved && draft !== tab && !canLeaveDraft()) return false;
    // 확인창이 열린 동안 계정이나 공연이 바뀐 경우 이전 입력을 새 계정으로 보내지 않는다.
    if (disposed || id !== pid || !isCurrentSession(viewSession) || !isCurrentSession(session)) return false;
    busy = true; saving = true; error = "";
    try {
      const result = await apiRequest<{ id?: string; ids?: string[]; revision: number }>(`${requestBase}${path}`, { method, session, body: JSON.stringify({ ...fields, expectedRevision: board.revision }) });
      if (disposed || id !== pid || !isCurrentSession(session)) return false;
      clearDraftFlags();
      try { await fetchBoard(preferred ?? result.ids?.[0] ?? result.id, session, id); }
      catch { if (!disposed && id === pid && isCurrentSession(session)) { stale = true; error = "저장은 마쳤지만 최신 내용을 불러오지 못했어요. 입력을 보관한 뒤 새로고침해 주세요."; } }
      if (disposed || id !== pid || !isCurrentSession(session)) return false;
      toast.success("저장했어요."); return true;
    } catch (failure) {
      if (!disposed && id === pid && isCurrentSession(session)) {
        error = failure instanceof Error ? failure.message : "저장하지 못했어요.";
        if (failure instanceof ApiError && failure.status === 409) { stale = true; error += " 입력 내용은 그대로 있어요. 내용을 복사한 뒤 최신 구성을 불러와 주세요."; }
        toast.error(error);
      }
      return false;
    } finally { if (!disposed && id === pid && isCurrentSession(session)) {
      busy = false; saving = false;
      // 저장 후 첨부 화면이 재생성돼도 부모의 전송 잠금을 해제한다.
      if (draft === 'attachments') transferring = false;
    } }
  }
  async function create(parentId: string | null) {
    const count = board?.sections.filter((s) => s.parentId === parentId).length ?? 0;
    if (await mutate("/sections", { parentId, kind: parentId ? "ACT" : "CHAPTER", title: `${count + 1}${parentId ? '막' : '장'}` })) tab = "section";
  }
  // 연결된 자료를 해제한다(확인은 자료 창에서 이미 받았다).
  async function unlinkMedia(sectionId: string, mediaId: string) {
    await mutate(`/sections/${sectionId}/media/${mediaId}`, {}, 'DELETE', selectedId);
  }
  function openMediaSettings(sectionId: string) {
    if (!canLeaveDraft()) return;
    selectedId = sectionId; tab = 'media';
  }
  async function archive(id: string) {
    const title = board?.sections.find((s) => s.id === id)?.title ?? "구간";
    if (window.confirm(`“${title}”와 하위 구간을 보관할까요? 원본은 남고 아래 보관함에서 복원할 수 있어요.`)) await mutate(`/sections/${id}/archive`);
  }
  // 비어 있는 첫 장을 보관하고 대본 등록(AI) 첫 화면으로 돌아간다.
  async function backToRegister() {
    const blank = board?.sections[0];
    if (!blank || !blankStart || !canLeaveDraft()) return;
    if (await mutate(`/sections/${blank.id}/archive`)) tab = 'register';
  }
  async function reorder(parentId: string | null, sectionIds: string[]) {
    if (!window.confirm("구간 순서를 바꿀까요? 각 구간의 시작 시간은 새 순서에 맞춰 바뀌고 자료의 상대 시간은 유지돼요.")) return;
    await mutate("/reorder", { parentId, sectionIds }, "POST", selectedId);
  }
  // 대본(큐시트)과 이 구간의 글을 한 방향으로 맞춘다.
  async function syncFrom(direction: 'PULL' | 'PUSH') {
    if (!selected) return;
    const message = direction === 'PULL'
      ? `“${selected.title}”의 내용을 원본 대본(큐시트)으로 바꿀까요? 이 구간에서 따로 고친 내용은 사라져요.`
      : `원본 대본(큐시트)을 “${selected.title}”의 내용으로 바꿀까요? 그대로인 줄은 시간·주석이 유지되고, 지워진 줄의 주석·음악 큐는 연결이 끊겨요.`;
    if (window.confirm(message)) await mutate(`/sections/${selected.id}/sync`, { direction }, 'POST', selected.id);
  }
  async function preview(source: { rawText?: string; scriptId?: string }): Promise<ImportPreview> {
    if (disposed || !isCurrentSession(viewSession)) throw new DOMException("로그인 계정이 변경됐어요. 현재 계정에서 다시 열어 주세요.", "AbortError");
    return apiRequest<ImportPreview>(`${base}/imports/preview`, { method: "POST", session: viewSession, body: JSON.stringify(source) });
  }
</script>

<style>
  @media (pointer: coarse) {
    .composition-workspace :global([data-slot="button"]) { min-height: 2.75rem; }
    .composition-workspace :global(input:not([type="checkbox"]):not([type="range"])),
    .composition-workspace :global(select) { min-height: 2.75rem; font-size: 1rem; }
    .composition-workspace :global(textarea) { font-size: 1rem; }
  }
</style>

<svelte:head><title>대본·자료 준비 — {board?.production.title ?? '공연'} · 아트브릿지</title></svelte:head>
<div class="composition-workspace mx-auto w-full min-w-0 max-w-7xl space-y-4">
  <PageHeader title="대본·자료 준비" description={board?.production.title ? `${board.production.title} · 대본을 장면으로 나누고 필요한 자료를 연결해요.` : "대본을 장면으로 나누고 필요한 자료를 연결해요."}>
    {#snippet actions()}<Button href={`/app/p/${pid}`} variant="ghost" size="sm">공연 홈</Button><Button href={`/app/p/${pid}/cuesheet`} variant="outline" size="sm">큐시트</Button><Button variant="outline" size="sm" disabled={busy || transferring} onclick={() => reload()}>새로고침</Button>{/snippet}
  </PageHeader>
  {#if error}<div role="alert" class="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm leading-relaxed text-destructive">{error}</div>{/if}
  {#if loading}<div class="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]"><Skeleton class="h-80 rounded-2xl" /><Skeleton class="h-[32rem] rounded-2xl" /></div>
  {:else if board}
    {#if board.canEdit}
      <nav class="rounded-2xl border bg-card p-4" aria-label="공연 준비 순서">
        <p class="text-sm font-semibold">공연 준비 순서</p>
        <ol class="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <li><Button href={`/app/p/${pid}/manage/settings`} variant="ghost" size="sm" class="min-h-11 w-full justify-start">1. 기본정보</Button></li>
          <li><Button variant={tab !== 'videos' && tab !== 'media' && tab !== 'attachments' ? 'secondary' : 'ghost'} aria-current={tab !== 'videos' && tab !== 'media' && tab !== 'attachments' ? 'step' : undefined} size="sm" class="min-h-11 w-full justify-start" disabled={busy || transferring} onclick={() => changeTab(board!.sections.length ? 'section' : 'register')}>2. 대본·장면</Button></li>
          <li><Button variant={tab === 'videos' || tab === 'media' || tab === 'attachments' ? 'secondary' : 'ghost'} aria-current={tab === 'videos' || tab === 'media' || tab === 'attachments' ? 'step' : undefined} size="sm" class="min-h-11 w-full justify-start" disabled={busy || transferring || !board.sections.length} onclick={() => changeTab('videos')}>3. 자료 연결 <span class="text-muted-foreground text-xs">선택</span></Button></li>
          <li><Button href={`/app/p/${pid}/manage/members`} variant="ghost" size="sm" class="min-h-11 w-full justify-start">4. 멤버·배역</Button></li>
          <li><Button href={`/app/p/${pid}/schedule`} variant="ghost" size="sm" class="min-h-11 w-full justify-start">5. 일정</Button></li>
          <li><Button href={`/app/p/${pid}/live`} variant="ghost" size="sm" class="min-h-11 w-full justify-start">6. 연습</Button></li>
        </ol>
      </nav>
    {:else}<Badge variant="secondary">열람 전용</Badge>{/if}
    {#if board.sections.length}<div class="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border bg-card p-3 text-sm">{#if chapterCount}<span>장·막 <strong>{chapterCount}개</strong></span>{/if}{#if sceneCount}<span>장면 <strong>{sceneCount}개</strong></span>{/if}{#if otherCount}<span>기타 구간 <strong>{otherCount}개</strong></span>{/if}<span>예상 시간 <strong class="font-mono tabular-nums">{formatTime(board.durationMs)}</strong></span>{#if unsaved}<span class="ml-auto text-primary">저장하지 않은 변경</span>{/if}</div>{/if}
    <div class={["grid min-w-0 items-start gap-4", board.sections.length > 0 && "lg:grid-cols-[280px_minmax(0,1fr)]"]}>
      {#if board.sections.length}
      <!-- 좁은 화면: 긴 목록 대신 구간 선택 상자를 위에 둔다(편집 영역이 바로 보이도록). -->
      <div class="rounded-2xl border bg-card p-3 lg:hidden">
        <label class="grid gap-1 text-xs font-medium text-muted-foreground">고칠 장면 고르기
          <select class="bg-background h-12 w-full rounded-lg border px-3 text-base text-foreground" value={selectedId} disabled={locked} onchange={(event) => choose(event.currentTarget.value)}>
            {#each sectionOrder(board.sections) as section (section.id)}<option value={section.id}>{section.parentId ? '↳ ' : ''}{section.title} · {formatTime(section.timing.startMs)}</option>{/each}
          </select>
        </label>
        {#if board.canEdit}<div class="mt-2 flex flex-wrap gap-2"><Button size="sm" variant="outline" class="min-h-10" disabled={locked} onclick={() => void create(null)}>막·장 추가</Button><Button size="sm" variant="outline" class="min-h-10" disabled={locked || !selected || !!selected.parentId} onclick={() => void create(selectedId)}>이 막에 장면 추가</Button></div>{/if}
      </div>
      <div class="hidden lg:block">
              <SectionList sections={board.sections} {selectedId} canEdit={board.canEdit} busy={locked} onSelect={choose} onCreate={(parentId) => void create(parentId)} onReorder={(parentId, ids) => void reorder(parentId, ids)} onDuplicate={(id) => void mutate(`/sections/${id}/duplicate`)} onArchive={(id) => void archive(id)} />
      </div>
      {/if}
      <div class="min-w-0 overflow-hidden rounded-2xl border bg-card">
        {#if !firstRun}
        <nav class="flex flex-wrap gap-1 border-b p-2" aria-label="구성 작업 선택">
          {#each [...(board.canEdit ? [{ id: 'register', label: '대본 등록' }] : []), { id: 'videos', label: '자료 연결' }, { id: 'section', label: '대본 편집' }, ...(board.canEdit ? [{ id: 'lines', label: '줄별 편집' }] : [])] as item (item.id)}<Button variant={tab === item.id ? 'default' : 'ghost'} size="sm" aria-pressed={tab === item.id} disabled={busy || transferring} onclick={() => changeTab(item.id as Tab)}>{item.label}</Button>{/each}
          <Button variant={['media', 'attachments', 'import'].includes(tab) ? 'default' : 'ghost'} size="sm" aria-expanded={showMore || ['media', 'attachments', 'import'].includes(tab)} onclick={() => (showMore = !showMore)}>더 보기 {showMore || ['media', 'attachments', 'import'].includes(tab) ? '▴' : '▾'}</Button>
          <Button href={`/app/p/${pid}/live${selectedId ? `?section=${selectedId}` : ''}`} variant="outline" size="sm" class="ms-auto">구성 시간으로 미리보기</Button>
        </nav>
        {#if showMore || ['media', 'attachments', 'import'].includes(tab)}
        <nav class="bg-muted/30 flex flex-wrap gap-1 border-b p-2" aria-label="더 보기">
          {#each [{ id: 'media', label: '자료 설정 (길이·음량·악보)' }, { id: 'attachments', label: '참고 파일 첨부' }, ...(board.canEdit ? [{ id: 'import', label: '대본 직접 나누기' }] : [])] as item (item.id)}<Button variant={tab === item.id ? 'default' : 'ghost'} size="sm" aria-pressed={tab === item.id} disabled={busy || transferring} onclick={() => changeTab(item.id as Tab)}>{item.label}</Button>{/each}
        </nav>
        {/if}
        {/if}
        <div class="p-4 sm:p-6">
          {#if tab === 'register' && board.canEdit}
            <!-- 등록 마법사는 저장 뒤 화면이 새로고침되어도 '완료' 안내가 남도록 키 블록 밖에 둔다. -->
            <ScriptRegister {pid} {busy} hasSections={board.sections.length > 0} bind:dirty={registerDirty} onPreview={preview} onCompose={(draft) => mutate('/imports/apply', { sections: draft.sections }, 'POST', undefined, 'register')} onManual={() => { if (canLeaveDraft()) { tab = 'section'; if (!board?.sections.length) void create(null); } }} onVideos={() => { if (canLeaveDraft()) tab = 'videos'; }} />
            {#if firstRun && board.scripts.length}<p class="mt-5 rounded-xl border border-dashed p-3 text-sm leading-relaxed">이미 등록된 대본이 {board.scripts.length}개 있어요. <button type="button" class="text-primary font-semibold underline underline-offset-4" onclick={() => { importMode = 'script'; changeTab('import'); }}>등록된 대본으로 장면 나누기</button></p>{/if}
          {:else if tab === 'lines' && board.canEdit}
            {#if selected?.sourceSceneId && selected.sourceScriptId}
              <div class="mb-4"><p class="text-xs text-muted-foreground">{selected.parentId ? `${board.sections.find((s) => s.id === selected.parentId)?.title ?? ''} / ` : ''}선택한 구간</p></div>
              <SceneLineEditor {pid} scriptId={selected.sourceScriptId} sceneId={selected.sourceSceneId} sceneTitle={selected.title} canEdit={board.canEdit} onChanged={() => fetchBoard(selected!.id)} onDirty={(dirty) => lineDirty = dirty} onWorking={(working) => lineSaving = working} />
            {:else}
              <EmptyState title="이 장면은 대본 편집에서 수정해 주세요" description="원본 대본의 줄이 연결된 장면만 줄별로 편집할 수 있어요. 다른 장면을 고르거나 대본 편집으로 이동해 주세요.">{#snippet action()}<Button variant="outline" onclick={() => changeTab('section')}>대본 편집으로 이동</Button>{/snippet}</EmptyState>
            {/if}
          {:else if tab === 'videos'}
            <div class="space-y-8">
              <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/40 p-4"><p class="text-sm leading-6">영상·음악·악보는 필요한 장면에만 연결해요. 자료 없이 다음 단계를 준비해도 돼요.</p>{#if board.canEdit}<Button href={`/app/p/${pid}/manage/members`} variant="outline" size="sm">다음: 멤버·배역 준비</Button>{/if}</div>
              <MediaBoard {pid} sections={board.sections} canEdit={board.canEdit} onChanged={() => fetchBoard(selectedId)} onUnlink={unlinkMedia} onSettings={openMediaSettings} />
              {#if board.canEdit}<div class="border-t pt-6"><VideoBatch {pid} sections={board.sections} {busy} bind:dirty={videoDirty} onDone={(session) => fetchBoard(undefined, session)} /></div>{/if}
            </div>
          {:else}
          {#key `${selectedId}-${board.revision}-${resetKey}-${tab}`}
            {#if blankStart && tab === 'section'}<div class="mb-4 space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm leading-relaxed"><p><strong>첫 장면에 대본을 작성해 주세요.</strong> 파일이나 글이 있다면 AI로 장면·배역·큐 초안을 만들고 검토한 뒤 반영할 수 있어요.</p><Button size="sm" disabled={locked} onclick={() => void backToRegister()}>대본으로 초안 만들기</Button></div>{/if}
            {#if tab === 'import' && board.canEdit}<ImportForm scripts={board.scripts} {busy} initialMode={importMode} bind:dirty={importDirty} onPreview={preview} onApply={async (draft) => { const done = await mutate('/imports/apply', { sections: draft.sections, sourceAssetId: draft.sourceAssetId }, 'POST', undefined, 'import'); if (done) tab = 'section'; return done; }} />
            {:else if selected}
              <div class="mb-5"><p class="text-xs text-muted-foreground">{selected.parentId ? `${board.sections.find((s) => s.id === selected.parentId)?.title ?? ''} / ` : ''}선택한 구간</p><h2 class="mt-1 break-words text-lg font-semibold">{selected.title}</h2>{#if selected.syncState === 'SYNCED'}<p class="mt-1 text-xs text-emerald-700 dark:text-emerald-400">큐시트·대본과 같은 내용이에요. 어느 화면에서 편집해도 서로 함께 반영돼요.</p>
                {:else if selected.syncState === 'DIVERGED'}<div class="mt-2 space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-relaxed"><p><strong>원본 대본(큐시트)과 내용이 달라요.</strong> 유지할 내용을 선택해 주세요. 내용을 맞추기 전에는 서로 자동 반영되지 않아요.</p><div class="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={locked || !board.canEdit} onclick={() => void syncFrom('PULL')}>원본 대본의 내용 사용</Button><Button size="sm" variant="outline" disabled={locked || !board.canEdit} onclick={() => void syncFrom('PUSH')}>이 내용으로 원본 대본 변경</Button></div></div>
                {:else if selected.sourceScriptId}<p class="mt-1 text-xs text-muted-foreground">기존 대본에서 가져온 사본이에요. <a href={`/app/p/${pid}/script`} class="underline">기존 대본 보기</a></p>{/if}</div>
              {#if tab === 'section'}<SceneMedia {pid} sections={board.sections} section={selected} canEdit={board.canEdit} onChanged={() => fetchBoard(selected!.id)} onUnlink={unlinkMedia} onSettings={openMediaSettings} onManage={() => changeTab('videos')} />
              <SectionForm section={selected} sections={board.sections} canEdit={board.canEdit} {busy} bind:dirty={sectionDirty} onSave={(fields) => mutate(`/sections/${selected!.id}`, fields, 'PATCH', selected!.id, 'section')} />
              {:else if tab === 'attachments'}<Attachments {pid} section={selected} sections={board.sections} {busy} {stale} canEdit={board.canEdit} bind:dirty={attachmentDirty} bind:transferring onAttach={(assetIds, session) => mutate(`/sections/${selected!.id}/attachments`, { assetIds }, 'POST', selected!.id, 'attachments', session)} onUnlink={(id) => { if (window.confirm('이 구간에서 참고 첨부를 해제할까요? 원본과 다른 구간의 첨부는 그대로 유지돼요.')) void mutate(`/sections/${selected!.id}/media/${id}`, {}, 'DELETE', selected!.id); }} />
              {:else}<MediaLinks {pid} section={selected} {busy} canEdit={board.canEdit} bind:dirty={mediaDirty} onSave={(id, fields) => mutate(`/sections/${selected!.id}/media${id ? `/${id}` : ''}`, fields, id ? 'PATCH' : 'POST', selected!.id, 'media')} onUnlink={(id) => { if (window.confirm('이 구간에서 자료 연결을 해제할까요? 원본 파일은 그대로 남아 있어요.')) void mutate(`/sections/${selected!.id}/media/${id}`, {}, 'DELETE', selected!.id); }} />{/if}
            {:else}<EmptyState title="아직 등록된 장면이 없어요" description={board.canEdit ? "대본을 등록하거나 첫 장면을 직접 만들어 시작해 보세요." : "제작진이 대본을 준비하면 여기에서 확인할 수 있어요."}>{#snippet action()}{#if board?.canEdit}<Button disabled={locked} onclick={() => changeTab('register')}>대본 등록하기</Button>{/if}{/snippet}</EmptyState>{/if}
          {/key}
          {/if}
        </div>
      </div>
    </div>
    {#if board.canEdit && board.archived.length}<details class="rounded-xl border bg-card p-4"><summary class="cursor-pointer text-sm font-medium">보관함 · {board.archived.length}개 구간</summary><p class="mt-2 text-xs text-muted-foreground">상위 구간을 복원하면 함께 보관했던 하위 구간도 복원돼요.</p><div class="mt-3 space-y-2">{#each board.archived.filter((s) => !s.parentId || !board!.archived.some((p) => p.id === s.parentId)) as item (item.id)}<div class="flex items-center justify-between gap-3 rounded-lg bg-muted/30 p-3"><span class="min-w-0 break-words text-sm">{item.title}</span><Button size="sm" variant="outline" disabled={locked} onclick={() => void mutate(`/sections/${item.id}/restore`)}>복원</Button></div>{/each}</div></details>{/if}
    <p class="text-xs leading-relaxed text-muted-foreground">저장한 대본과 자료는 <a class="underline" href={`/app/p/${pid}/live`}>연습 화면</a>에서 확인할 수 있어요. 대본 원본과 큐시트는 보존하고, 연결된 큐는 각 장면의 시작 시간에 맞춰 재생해요.</p>
  {:else}<EmptyState title="대본과 자료를 불러오지 못했어요" description="잠시 후 다시 시도해 주세요. 계속 열리지 않으면 공연 관리자에게 문의해 주세요.">{#snippet action()}<Button variant="outline" disabled={busy} onclick={() => reload(false)}>다시 불러오기</Button>{/snippet}</EmptyState>{/if}
</div>
