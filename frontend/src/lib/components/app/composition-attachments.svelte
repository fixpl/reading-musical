<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { apiRequest } from "$lib/api/client";
  import { reserveReferenceUpload, transferReferenceFile, type ReferenceUploadTicket } from "$lib/api/reference-uploads";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Badge } from "$lib/components/ui/badge";
  import ReferenceViewer from "./section-reference-viewer.svelte";
  import { assetName, type CompositionSection, type MediaAsset } from "$lib/domain/composition";
  import { REFERENCE_ACCEPT, REFERENCE_MAX_BATCH, referenceFileMetadata, referenceGroups, isReferenceAsset, fileSizeLabel } from "$lib/domain/composition-attachments";
  let { pid, section, sections, canEdit, busy, stale, dirty = $bindable(false), transferring = $bindable(false), onAttach, onUnlink }: {
    pid: string; section: CompositionSection; sections: CompositionSection[]; canEdit: boolean; busy: boolean; stale: boolean;
    dirty?: boolean; transferring?: boolean;
    onAttach: (assetIds: string[]) => Promise<boolean>; onUnlink: (id: string) => void;
  } = $props();
  type PendingFile = { key: number; file: File; status: "waiting" | "uploading" | "ready" | "failed"; message: string; ticket?: ReferenceUploadTicket; asset?: MediaAsset };
  let queue = $state<PendingFile[]>([]);
  let error = $state("");
  let preview = $state<MediaAsset | null>(null);
  let library = $state<MediaAsset[]>([]);
  let query = $state("");
  let searching = $state(false);
  let hasMore = $state(false);
  let disposed = false;
  let nextKey = 0;
  let request = 0;
  const locked = $derived(busy || transferring || stale);
  const groups = $derived(referenceGroups(sections, section));
  const existing = $derived(new Set(groups[0].files.map((media) => media.assetId)));
  const readyCount = $derived(queue.filter((item) => item.asset).length);
  $effect(() => { dirty = queue.length > 0; });

  function selectFiles(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (locked || !canEdit) return;
    error = "";
    if (queue.length + files.length > REFERENCE_MAX_BATCH) { error = "한 번에 최대 10개까지 선택할 수 있습니다. 현재 파일을 첨부한 뒤 추가하세요."; return; }
    try { for (const file of files) referenceFileMetadata(file); }
    catch (failure) { error = failure instanceof Error ? failure.message : "지원하는 파일인지 확인하세요."; return; }
    for (const file of files) {
      if (queue.some((item) => item.file.name === file.name && item.file.size === file.size && item.file.lastModified === file.lastModified)) continue;
      queue.push({ key: ++nextKey, file, status: "waiting", message: "업로드 대기" });
    }
  }
  async function uploadAndAttach() {
    if (locked || !canEdit || !queue.length) return;
    transferring = true; error = "";
    try {
      for (const item of queue) {
        if (item.asset) continue;
        item.status = "uploading"; item.message = "파일 업로드 중…";
        try {
          if (!item.ticket || Date.parse(item.ticket.upload.expiresAt) <= Date.now()) item.ticket = await reserveReferenceUpload(pid, item.file);
          if (disposed) return;
          item.asset = await transferReferenceFile(item.ticket, item.file);
          if (disposed) return;
          item.status = "ready"; item.message = "업로드 완료 · 구간 첨부 대기";
        } catch (failure) {
          item.status = "failed"; item.message = failure instanceof Error ? failure.message : "업로드에 실패했습니다.";
          error = "일부 파일을 올리지 못했습니다. 실패한 파일을 다시 시도하거나 목록에서 제외하세요. 완료된 파일은 다시 업로드하지 않습니다.";
          return;
        }
      }
      if (await onAttach(queue.map((item) => item.asset!.id))) { queue = []; dirty = false; }
      else error = "파일 업로드는 완료됐지만 이 구간에 첨부하지 못했습니다. 위 안내를 확인하세요. 업로드된 파일은 ‘등록된 파일 재사용’에서도 찾을 수 있습니다.";
    } finally { transferring = false; }
  }
  async function search() {
    const revision = ++request;
    searching = true; error = "";
    try {
      const result = await apiRequest<{ assets: MediaAsset[]; hasMore: boolean }>(`/productions/${pid}/composition/library?q=${encodeURIComponent(query)}`);
      if (!disposed && revision === request) { library = result.assets.filter(isReferenceAsset); hasMore = result.hasMore; }
    } catch (failure) { if (!disposed) error = failure instanceof Error ? failure.message : "자료 목록을 불러오지 못했습니다."; }
    finally { if (!disposed && revision === request) searching = false; }
  }
  onMount(() => { if (canEdit) void search(); });
  onDestroy(() => { disposed = true; request += 1; });
</script>

<section class="space-y-5" aria-label="장·막 참고 첨부파일">
  <div><h2 class="text-lg font-semibold">참고 첨부파일</h2><p class="mt-1 text-sm leading-relaxed text-muted-foreground">이 장·막의 악보 원본, 대본 문서, 연출 참고 이미지를 모아 두세요. 시간 설정 없이 확인하는 자료이며 공연 길이와 자동 재생에는 영향을 주지 않습니다.</p></div>
  {#if canEdit}
    <div class="space-y-3 rounded-xl border border-dashed bg-muted/20 p-4">
      <label class="grid gap-2 text-sm font-medium">새 파일 선택<input type="file" multiple accept={REFERENCE_ACCEPT} disabled={locked} onchange={selectFiles} class="block w-full min-w-0 rounded-lg border bg-background p-3 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-3 file:py-2 file:text-primary" /></label>
      <p class="text-xs leading-relaxed text-muted-foreground">PDF · PNG · JPG · WEBP · DOCX · TXT / 파일당 최대 50MB, 한 번에 10개. 파일을 선택한 뒤 아래 버튼으로 첨부합니다.</p>
      {#if queue.length}
        <div class="space-y-2" aria-live="polite">{#each queue as item (item.key)}<div class="flex items-start justify-between gap-2 rounded-lg border bg-card p-3"><div class="min-w-0"><p class="break-words text-sm font-medium">{item.file.name}</p><p class="mt-1 text-xs text-muted-foreground">{fileSizeLabel(item.file.size)} · {item.message}</p></div><Button variant="ghost" size="sm" disabled={locked} onclick={() => queue = queue.filter((row) => row.key !== item.key)}>제외</Button></div>{/each}</div>
        <div class="flex flex-wrap items-center gap-3"><Button disabled={locked} onclick={uploadAndAttach}>{transferring ? `처리 중 · 업로드 ${readyCount}/${queue.length}` : readyCount === queue.length ? `${queue.length}개 파일 이 구간에 첨부` : `${queue.length}개 파일 업로드 후 첨부`}</Button><span class="text-xs text-muted-foreground">원본은 자동 분석하거나 대본으로 변환하지 않습니다.</span></div>
      {/if}
    </div>
  {/if}
  {#if error}<p role="alert" class="rounded-lg border border-destructive/30 p-3 text-sm leading-relaxed text-destructive">{error}</p>{/if}
  {#if preview}<ReferenceViewer asset={preview} onClose={() => preview = null} />{/if}
  {#each groups as group (group.owner.id)}
    {#if !group.inherited || group.files.length}
      <div class="space-y-2"><div class="flex flex-wrap items-center gap-2"><h3 class="text-sm font-semibold">{group.inherited ? `${group.owner.title}의 공통 참고자료` : '이 구간에 첨부된 파일'}</h3><Badge variant="secondary">{group.files.length}개</Badge>{#if group.inherited}<Badge variant="outline">상위 장·막 자료</Badge>{/if}</div>
        {#each group.files as media (media.id)}
          <article class="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"><div class="min-w-0"><h4 class="break-words text-sm font-medium">{media.label || assetName(media.asset)}</h4><p class="mt-1 break-words text-xs text-muted-foreground">{assetName(media.asset)} · {fileSizeLabel(media.asset.sizeBytes)}</p></div><div class="flex gap-1"><Button variant="outline" size="sm" onclick={() => preview = media.asset}>파일 보기</Button>{#if canEdit && !group.inherited}<Button variant="ghost" size="sm" disabled={locked || queue.length > 0} onclick={() => onUnlink(media.id)}>첨부 해제</Button>{/if}</div></article>
        {:else}<p class="rounded-xl border border-dashed p-6 text-center text-sm leading-relaxed text-muted-foreground">아직 참고 첨부파일이 없습니다. 대본을 입력하지 않고 파일만 첨부해도 됩니다.</p>{/each}
        {#if group.inherited}<p class="text-xs text-muted-foreground">상위 자료는 여기서 열람만 합니다. 수정·첨부 해제는 해당 상위 장·막에서 진행하세요.</p>{/if}
      </div>
    {/if}
  {/each}
  {#if canEdit}
    <details class="rounded-xl border p-4"><summary class="cursor-pointer text-sm font-medium">등록된 파일 재사용</summary>
      <p class="mt-2 text-xs text-muted-foreground">다른 장·막에서 사용한 원본을 다시 올리지 않고 연결할 수 있습니다. 현재 선택한 업로드 파일을 먼저 첨부하거나 제외하세요.</p>
      <div class="mt-3 flex gap-2"><Input bind:value={query} aria-label="참고자료 파일명 검색" placeholder="파일명 검색" disabled={locked || searching} onkeydown={(event) => { if (event.key === 'Enter') void search(); }} /><Button variant="outline" disabled={locked || searching} onclick={search}>검색</Button></div>
      {#if hasMore}<p class="mt-2 text-xs text-muted-foreground">검색 결과가 많습니다. 파일명으로 범위를 좁혀 주세요.</p>{/if}
      <div class="mt-3 max-h-72 space-y-2 overflow-y-auto">{#each library as asset (asset.id)}<div class="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/25 p-3"><span class="min-w-0 break-words text-sm">{assetName(asset)} <span class="text-xs text-muted-foreground">{fileSizeLabel(asset.sizeBytes)}</span></span><Button variant="outline" size="sm" disabled={locked || queue.length > 0 || existing.has(asset.id)} onclick={() => void onAttach([asset.id])}>{existing.has(asset.id) ? '이미 첨부됨' : '이 구간에 첨부'}</Button></div>{:else}<p class="py-3 text-sm text-muted-foreground">{searching ? '등록된 파일을 찾고 있습니다.' : '재사용할 참고 파일이 없습니다.'}</p>{/each}</div>
    </details>
  {/if}
  <p class="text-xs leading-relaxed text-muted-foreground">첨부 해제는 이 구간의 연결만 제거합니다. 다른 구간에서 쓰는 원본 파일은 삭제하지 않습니다. 공연에 배정된 사용자가 열람하며, 업로드·첨부 관리는 기존 구간 편집 권한을 따릅니다.</p>
</section>
