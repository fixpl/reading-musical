<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { beforeNavigate } from "$app/navigation";
  import { toast } from "svelte-sonner";
  import { apiRequest, ApiError } from "$lib/api/client";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import SectionList from "./composition-section-list.svelte";
  import SectionForm from "./composition-section-form.svelte";
  import MediaLinks from "./composition-media-links.svelte";
  import ImportForm from "./composition-import-form.svelte";
  import Reading from "./composition-reading.svelte";
  import Attachments from "./composition-attachments.svelte";
  import { formatTime, sectionOrder, type CompositionBoard, type ImportPreview } from "$lib/domain/composition";
  let { pid }: { pid: string } = $props();
  type Tab = "section" | "media" | "attachments" | "reading" | "import";
  let board = $state<CompositionBoard | null>(null);
  let selectedId = $state("");
  let tab = $state<Tab>("section");
  let loading = $state(true);
  let busy = $state(false);
  let saving = $state(false);
  let transferring = $state(false);
  let attachmentDirty = $state(false);
  let stale = $state(false);
  let error = $state("");
  let sectionDirty = $state(false), mediaDirty = $state(false), importDirty = $state(false);
  let resetKey = $state(0);
  let disposed = false;
  const unsaved = $derived(sectionDirty || mediaDirty || importDirty || attachmentDirty);
  const locked = $derived(busy || transferring || loading || stale);
  const selected = $derived(board?.sections.find((s) => s.id === selectedId));
  const rootCount = $derived(board?.sections.filter((s) => !s.parentId).length ?? 0);
  const base = $derived(`/productions/${pid}/composition`);

  function clearDraftFlags() { sectionDirty = false; mediaDirty = false; importDirty = false; attachmentDirty = false; resetKey += 1; }
  function canLeaveDraft() {
    if (busy || transferring) return false;
    if (unsaved && !window.confirm("저장하지 않은 입력이 있습니다. 필요한 내용을 복사했거나 입력을 버려도 괜찮으면 계속하세요.")) return false;
    clearDraftFlags(); return true;
  }
  beforeNavigate((navigation) => {
    if (saving || transferring) { navigation.cancel(); toast.info("파일 업로드 또는 저장 요청을 처리 중입니다."); return; }
    if (unsaved && !window.confirm("저장하지 않은 입력을 남기고 이동할까요?")) navigation.cancel();
  });
  onMount(() => {
    void reload(false);
    const unload = (event: BeforeUnloadEvent) => { if (unsaved || saving || transferring) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  });
  onDestroy(() => { disposed = true; });

  async function fetchBoard(preferred?: string) {
    const result = await apiRequest<CompositionBoard>(base);
    if (disposed) return;
    const firstLoad = !board;
    board = result;
    const wanted = preferred ?? selectedId;
    selectedId = result.sections.some((s) => s.id === wanted) ? wanted : sectionOrder(result.sections)[0]?.id ?? "";
    if (firstLoad && !result.canEdit) tab = "reading";
    stale = false;
  }
  async function reload(confirmDraft = true) {
    if (busy || transferring || (confirmDraft && !canLeaveDraft())) return;
    loading = !board; busy = true; error = "";
    try { await fetchBoard(); clearDraftFlags(); }
    catch (failure) { if (!disposed) { stale = true; error = failure instanceof Error ? failure.message : "구성을 불러오지 못했습니다."; } }
    finally { if (!disposed) { loading = false; busy = false; } }
  }
  function choose(id: string) { if (id === selectedId || !canLeaveDraft()) return; selectedId = id; }
  function changeTab(next: Tab) { if (next === tab || !canLeaveDraft()) return; tab = next; }

  async function mutate(path: string, fields: object = {}, method = "POST", preferred?: string, draft?: Tab): Promise<boolean> {
    if (busy || !board?.canEdit || stale) {
      if (stale) toast.error("입력 내용을 보존한 뒤 최신 구성을 불러와 주세요.");
      return false;
    }
    if (unsaved && draft !== tab && !canLeaveDraft()) return false;
    busy = true; saving = true; error = "";
    try {
      const result = await apiRequest<{ id?: string; ids?: string[]; revision: number }>(`${base}${path}`, { method, body: JSON.stringify({ ...fields, expectedRevision: board.revision }) });
      if (disposed) return true;
      clearDraftFlags();
      try { await fetchBoard(preferred ?? result.ids?.[0] ?? result.id); }
      catch { stale = true; error = "서버 저장은 완료했지만 최신 화면을 읽지 못했습니다. 같은 변경을 반복하지 말고 새로고침하세요."; }
      toast.success("저장했습니다."); return true;
    } catch (failure) {
      if (!disposed) {
        error = failure instanceof Error ? failure.message : "저장하지 못했습니다.";
        if (failure instanceof ApiError && failure.status === 409) { stale = true; error += " 입력 내용은 유지했습니다. 내용을 복사한 뒤 최신 구성을 불러오세요."; }
        toast.error(error);
      }
      return false;
    } finally { if (!disposed) { busy = false; saving = false; } }
  }
  async function create(parentId: string | null) {
    const count = board?.sections.filter((s) => s.parentId === parentId).length ?? 0;
    if (await mutate("/sections", { parentId, kind: parentId ? "ACT" : "CHAPTER", title: `${count + 1}${parentId ? '막' : '장'}` })) tab = "section";
  }
  async function archive(id: string) {
    const title = board?.sections.find((s) => s.id === id)?.title ?? "구간";
    if (window.confirm(`“${title}”와 하위 구간을 보관할까요? 원본은 남고 아래 보관함에서 복원할 수 있습니다.`)) await mutate(`/sections/${id}/archive`);
  }
  async function reorder(parentId: string | null, sectionIds: string[]) {
    if (!window.confirm("같은 단계의 구간을 새 순서대로 자동 연결합니다. 지정했던 시작 위치는 자동으로 바뀌며 자료의 상대 시간은 유지됩니다. 이동할까요?")) return;
    await mutate("/reorder", { parentId, sectionIds }, "POST", selectedId);
  }
  async function preview(source: { rawText?: string; scriptId?: string }): Promise<ImportPreview> {
    return apiRequest<ImportPreview>(`${base}/imports/preview`, { method: "POST", body: JSON.stringify(source) });
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

<svelte:head><title>장·막 구성 — {board?.production.title ?? '공연'} · 아트브릿지</title></svelte:head>
<div class="composition-workspace mx-auto w-full min-w-0 max-w-7xl space-y-4">
  <header class="flex flex-wrap items-start justify-between gap-3">
    <div><div class="flex flex-wrap items-center gap-2"><h1 class="text-2xl font-bold tracking-tight">장·막 구성</h1>{#if board}<Badge variant="secondary">{board.canEdit ? '제작 편집' : '열람 전용'}</Badge>{/if}</div><p class="mt-1 text-sm leading-relaxed text-muted-foreground">구간을 만들고, 대본·가사·자료를 연결해 공연 순서를 정리하세요.</p></div>
    <div class="flex flex-wrap gap-2"><Button href={`/app/p/${pid}`} variant="ghost" size="sm">공연 홈</Button><Button href={`/app/p/${pid}/cuesheet`} variant="outline" size="sm">기존 큐시트</Button><Button variant="outline" size="sm" disabled={busy || transferring} onclick={() => reload()}>새로고침</Button></div>
  </header>
  {#if error}<div role="alert" class="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm leading-relaxed text-destructive">{error}</div>{/if}
  {#if loading}<div class="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]"><Skeleton class="h-80 rounded-2xl" /><Skeleton class="h-[32rem] rounded-2xl" /></div>
  {:else if board}
    <div class="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border bg-card p-3 text-sm"><span>상위 구간 <strong>{rootCount}개</strong></span><span>전체 구성 <strong>{board.sections.length}개</strong></span><span>예상 시간 <strong class="font-mono tabular-nums">{formatTime(board.durationMs)}</strong></span>{#if unsaved}<span class="ml-auto text-primary">저장하지 않은 변경</span>{:else}<span class="ml-auto text-xs text-muted-foreground">저장 버전 {board.revision}</span>{/if}</div>
    <div class="grid min-w-0 items-start gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <SectionList sections={board.sections} {selectedId} canEdit={board.canEdit} busy={locked} onSelect={choose} onCreate={(parentId) => void create(parentId)} onReorder={(parentId, ids) => void reorder(parentId, ids)} onDuplicate={(id) => void mutate(`/sections/${id}/duplicate`)} onArchive={(id) => void archive(id)} />
      <div class="min-w-0 overflow-hidden rounded-2xl border bg-card">
        <nav class="flex flex-wrap gap-1 border-b p-2" aria-label="구성 작업 선택">
          {#each [{ id: 'section', label: '구간 편집' }, { id: 'media', label: '재생 자료' }, { id: 'attachments', label: '참고 첨부' }, { id: 'reading', label: '대본 미리보기' }, ...(board.canEdit ? [{ id: 'import', label: '전체 가져오기' }] : [])] as item (item.id)}<Button variant={tab === item.id ? 'default' : 'ghost'} size="sm" aria-pressed={tab === item.id} disabled={busy || transferring} onclick={() => changeTab(item.id as Tab)}>{item.label}</Button>{/each}
        </nav>
        <div class="p-4 sm:p-6">
          {#key `${selectedId}-${board.revision}-${resetKey}-${tab}`}
            {#if tab === 'import' && board.canEdit}<ImportForm scripts={board.scripts} {busy} bind:dirty={importDirty} onPreview={preview} onApply={async (draft) => { const done = await mutate('/imports/apply', { sections: draft.sections, sourceAssetId: draft.sourceAssetId }, 'POST', undefined, 'import'); if (done) tab = 'section'; return done; }} />
            {:else if tab === 'reading'}<Reading {pid} sections={board.sections} durationMs={board.durationMs} {selectedId} />
            {:else if selected}
              <div class="mb-5"><p class="text-xs text-muted-foreground">{selected.parentId ? `${board.sections.find((s) => s.id === selected.parentId)?.title ?? ''} / ` : ''}선택한 구간</p><h2 class="mt-1 break-words text-lg font-semibold">{selected.title}</h2>{#if selected.sourceScriptId}<p class="mt-1 text-xs text-muted-foreground">기존 대본에서 가져온 사본입니다. <a href={`/app/p/${pid}/script`} class="underline">기존 대본 보기</a></p>{/if}</div>
              {#if tab === 'section'}<SectionForm section={selected} sections={board.sections} canEdit={board.canEdit} {busy} bind:dirty={sectionDirty} onSave={(fields) => mutate(`/sections/${selected!.id}`, fields, 'PATCH', selected!.id, 'section')} />
              {:else if tab === 'attachments'}<Attachments {pid} section={selected} sections={board.sections} {busy} {stale} canEdit={board.canEdit} bind:dirty={attachmentDirty} bind:transferring onAttach={(assetIds) => mutate(`/sections/${selected!.id}/attachments`, { assetIds }, 'POST', selected!.id, 'attachments')} onUnlink={(id) => { if (window.confirm('이 구간에서 참고 첨부를 해제할까요? 원본과 다른 구간의 첨부는 유지됩니다.')) void mutate(`/sections/${selected!.id}/media/${id}`, {}, 'DELETE', selected!.id); }} />
              {:else}<MediaLinks {pid} section={selected} {busy} canEdit={board.canEdit} bind:dirty={mediaDirty} onSave={(id, fields) => mutate(`/sections/${selected!.id}/media${id ? `/${id}` : ''}`, fields, id ? 'PATCH' : 'POST', selected!.id, 'media')} onUnlink={(id) => { if (window.confirm('이 구간에서 자료 연결을 해제할까요? 원본 파일은 유지됩니다.')) void mutate(`/sections/${selected!.id}/media/${id}`, {}, 'DELETE', selected!.id); }} />{/if}
            {:else}<div class="py-14 text-center"><h2 class="text-lg font-semibold">아직 구성된 구간이 없습니다</h2><p class="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">‘장 추가’로 첫 구간을 만들거나 ‘전체 가져오기’에서 기존 대본을 나누어 시작하세요.</p></div>{/if}
          {/key}
        </div>
      </div>
    </div>
    {#if board.canEdit && board.archived.length}<details class="rounded-xl border bg-card p-4"><summary class="cursor-pointer text-sm font-medium">보관함 · {board.archived.length}개 구간</summary><p class="mt-2 text-xs text-muted-foreground">상위 구간을 복원하면 함께 보관했던 하위 구간도 복원됩니다.</p><div class="mt-3 space-y-2">{#each board.archived.filter((s) => !s.parentId || !board!.archived.some((p) => p.id === s.parentId)) as item (item.id)}<div class="flex items-center justify-between gap-3 rounded-lg bg-muted/30 p-3"><span class="min-w-0 break-words text-sm">{item.title}</span><Button size="sm" variant="outline" disabled={locked} onclick={() => void mutate(`/sections/${item.id}/restore`)}>복원</Button></div>{/each}</div></details>{/if}
    <p class="text-xs leading-relaxed text-muted-foreground">기존 대본·큐시트·일정은 보존됩니다. 새 장·막 구성과 기존 큐시트의 편집 내용은 자동 동기화되지 않습니다.</p>
  {:else}<div class="rounded-2xl border p-8 text-center"><p class="text-sm text-muted-foreground">공연 접근 권한과 장·막 구성 DB 업데이트 상태를 확인하세요.</p><Button class="mt-4" variant="outline" disabled={busy} onclick={() => reload(false)}>다시 불러오기</Button></div>{/if}
</div>
