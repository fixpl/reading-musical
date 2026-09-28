<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { apiRequest } from "$lib/api/client";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { assetName, acceptsAsset, SLOT_LABELS, secondsInput, type CompositionSection, type CompositionMedia, type MediaAsset, type MediaSlot, type MediaWrite } from "$lib/domain/composition";
  let { pid, section, busy, canEdit, dirty = $bindable(false), onSave, onUnlink }: {
    pid: string; section: CompositionSection; busy: boolean; canEdit: boolean; dirty?: boolean;
    onSave: (id: string | null, fields: MediaWrite) => Promise<boolean>; onUnlink: (id: string) => void;
  } = $props();
  let library = $state<MediaAsset[]>([]);
  let query = $state("");
  let loading = $state(false);
  let hasMore = $state(false);
  let error = $state("");
  let editing = $state<string | null>(null);
  let slot = $state<MediaSlot>("SCORE");
  let assetId = $state("");
  let label = $state("");
  let offset = $state("0");
  let duration = $state("");
  let sourceStart = $state("0");
  let page = $state("1");
  let volume = $state("100");
  let loop = $state(false);
  let disposed = false;
  let request = 0;
  const assets = $derived([...new Map([...section.media.map((m) => m.asset), ...library].map((a) => [a.id, a])).values()]);
  const selectedAsset = $derived(assets.find((a) => a.id === assetId));
  async function search() {
    const current = ++request;
    loading = true; error = "";
    try {
      const result = await apiRequest<{ assets: MediaAsset[]; hasMore: boolean }>(`/productions/${pid}/composition/library?q=${encodeURIComponent(query)}`);
      if (!disposed && current === request) { library = result.assets; hasMore = result.hasMore; }
    } catch (failure) { if (!disposed && current === request) error = failure instanceof Error ? failure.message : "자료 목록을 읽지 못했습니다."; }
    finally { if (!disposed && current === request) loading = false; }
  }
  onMount(() => { void search(); });
  onDestroy(() => { disposed = true; request += 1; });
  function reset() { editing = null; slot = "SCORE"; assetId = ""; label = ""; offset = "0"; duration = ""; sourceStart = "0"; page = "1"; volume = "100"; loop = false; dirty = false; }
  function edit(media: CompositionMedia) {
    if (dirty && !window.confirm("저장하지 않은 자료 설정을 버리고 다른 연결을 편집할까요?")) return;
    editing = media.id; slot = media.slot; assetId = media.assetId; label = media.label; offset = String(media.offsetMs / 1000);
    duration = media.durationMs === null ? "" : String(media.durationMs / 1000); sourceStart = String(media.sourceStartMs / 1000); page = String(media.page); volume = String(media.volume * 100); loop = media.loop; dirty = false;
  }
  async function save(event: SubmitEvent) {
    event.preventDefault(); error = "";
    try {
      if (!selectedAsset || !acceptsAsset(selectedAsset, slot)) throw new Error("자료 종류에 맞는 파일을 선택하세요.");
      const pageNumber = Number(page), volumeNumber = Number(volume);
      if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 10000) throw new Error("페이지는 1~10,000 사이 정수로 입력하세요.");
      if (!volume.trim() || !Number.isFinite(volumeNumber) || volumeNumber < 0 || volumeNumber > 100) throw new Error("음량은 0~100%로 입력하세요.");
      const result = await onSave(editing, { assetId, slot, label: label.trim() || assetName(selectedAsset), offsetMs: secondsInput(offset, false)!, durationMs: secondsInput(duration, true, 1000), sourceStartMs: secondsInput(sourceStart, false)!, page: selectedAsset.mime === "application/pdf" ? pageNumber : 1, volume: volumeNumber / 100, loop });
      if (result) reset();
    } catch (failure) { error = failure instanceof Error ? failure.message : "자료 설정을 확인하세요."; }
  }
</script>

<section class="space-y-4" aria-label="구간 자료 연결">
  <div><h2 class="text-lg font-semibold">이 구간의 재생 자료</h2><p class="mt-1 text-sm leading-relaxed text-muted-foreground">시간에 맞춰 사용할 배경·음악·악보를 연결합니다. 시간 설정 없이 보관하고 열어볼 문서·이미지는 ‘참고 첨부’ 탭에서 올려 주세요.</p></div>
  <div class="space-y-2">{#each section.media.filter((media) => media.slot !== 'SOURCE') as media (media.id)}<div class="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3"><div class="min-w-0"><p class="break-words text-sm font-medium">{media.label}</p><p class="mt-1 text-xs text-muted-foreground">{SLOT_LABELS[media.slot]} · 시작 후 {media.offsetMs / 1000}초{media.slot === 'SCORE' ? ` · ${media.page}쪽` : ''}</p></div>{#if canEdit}<div class="flex gap-1"><Button variant="outline" size="sm" disabled={busy} onclick={() => edit(media)}>설정</Button><Button variant="ghost" size="sm" disabled={busy} onclick={() => onUnlink(media.id)}>연결 해제</Button></div>{/if}</div>{:else}<p class="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">직접 연결한 자료가 없습니다. 상위 자료 사용 여부는 ‘구간 편집’에서 확인하세요.</p>{/each}</div>
  {#if canEdit}
    <div class="flex gap-2"><Input bind:value={query} placeholder="공연 자료 파일명 검색" aria-label="공연 자료 검색" disabled={loading || busy} onkeydown={(e) => { if (e.key === 'Enter') void search(); }} /><Button variant="outline" disabled={loading || busy} onclick={search}>{loading ? '검색 중…' : '검색'}</Button></div>
    {#if hasMore}<p class="text-xs text-muted-foreground">최근 200개를 표시합니다. 파일명을 입력해 범위를 좁혀 주세요.</p>{/if}
    <form onsubmit={save} class="rounded-xl border bg-muted/20 p-4">
      <fieldset disabled={busy || loading} class="space-y-3" oninput={() => dirty = true}>
        <h3 class="text-sm font-semibold">{editing ? '자료 연결 설정' : '등록된 파일 연결'}</h3>
        <label class="grid gap-1 text-sm">자료 종류<select bind:value={slot} disabled={!!editing || busy || loading} onchange={(event) => { slot = event.currentTarget.value as MediaSlot; assetId = ''; volume = slot === 'BACKGROUND' ? '0' : '100'; dirty = true; }} class="h-10 rounded-md border bg-background px-2">{#each Object.entries(SLOT_LABELS).filter(([key]) => key !== 'SOURCE') as [value, text]}<option value={value as MediaSlot}>{text}</option>{/each}</select></label>
        <label class="grid gap-1 text-sm">파일<select bind:value={assetId} class="h-10 min-w-0 rounded-md border bg-background px-2"><option value="">등록 파일 선택</option>{#each assets.filter((a) => acceptsAsset(a, slot)) as asset (asset.id)}<option value={asset.id}>{assetName(asset)}</option>{/each}</select></label>
        <label class="grid gap-1 text-sm">표시 이름<Input bind:value={label} maxlength={255} placeholder="비우면 파일명 사용" /></label>
        <div class="grid gap-3 sm:grid-cols-2"><label class="grid gap-1 text-sm">구간 시작 후 (초)<Input bind:value={offset} inputmode="decimal" /></label><label class="grid gap-1 text-sm">표시·재생 길이 (초)<Input bind:value={duration} inputmode="decimal" placeholder="비우면 구간 끝까지" /></label></div>
        {#if slot === 'BACKGROUND' || slot === 'MUSIC'}<div class="grid gap-3 sm:grid-cols-2"><label class="grid gap-1 text-sm">원본 시작 (초)<Input bind:value={sourceStart} inputmode="decimal" /></label><label class="grid gap-1 text-sm">음량 (%)<Input bind:value={volume} inputmode="decimal" /></label></div><label class="flex items-center gap-2 text-sm"><input type="checkbox" bind:checked={loop} />구간 내 반복 재생</label>{/if}
        {#if slot === 'SCORE' && selectedAsset?.mime === 'application/pdf'}<label class="grid gap-1 text-sm">악보 페이지<Input bind:value={page} inputmode="numeric" /></label>{/if}
        <p class="text-xs leading-relaxed text-muted-foreground">배경과 음악은 구간별로 각각 한 개입니다. 여러 곡은 하위 구간으로 나누세요. 여러 악보 페이지는 같은 PDF를 페이지·시작 시점별로 연결할 수 있습니다.</p>
      </fieldset>
      <div class="mt-4 flex gap-2"><Button type="submit" disabled={busy || loading || !assetId}>{editing ? '자료 설정 저장' : '이 구간에 연결'}</Button>{#if editing || dirty}<Button variant="ghost" disabled={busy} onclick={reset}>입력 취소</Button>{/if}</div>
    </form>
  {/if}
  {#if error}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
</section>
