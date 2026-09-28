<script lang="ts">
  import { apiRequest } from "$lib/api/client";
  import { Button } from "$lib/components/ui/button";
  import { assetName, type MediaAsset } from "$lib/domain/composition";
  import { fileSizeLabel, referenceUrls } from "$lib/domain/composition-attachments";
  let { asset, onClose }: { asset: MediaAsset; onClose: () => void } = $props();
  const assetId = $derived(asset.id);
  let links = $state<{ open: string; download: string } | null>(null);
  let error = $state("");
  let retry = $state(0);
  let zoom = $state(100);
  $effect(() => {
    const id = assetId;
    void retry;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    links = null; error = ""; zoom = 100;
    async function load() {
      try {
        const result = await apiRequest<{ url: string; expiresAt: string }>(`/assets/${id}/url`);
        if (!active) return;
        links = referenceUrls(result.url);
        const expires = Date.parse(result.expiresAt);
        timer = setTimeout(() => void load(), Number.isFinite(expires) ? Math.max(1000, expires - Date.now() - 15000) : 540000);
      } catch (failure) { if (active) { links = null; error = failure instanceof Error ? failure.message : "파일을 열지 못했습니다."; } }
    }
    void load();
    return () => { active = false; if (timer) clearTimeout(timer); };
  });
</script>

<section aria-label="참고 첨부파일 원본" class="overflow-hidden rounded-xl border bg-card">
  <div class="flex flex-wrap items-center justify-between gap-3 border-b p-3">
    <div class="min-w-0"><h3 class="break-words text-sm font-semibold">{assetName(asset)}</h3><p class="mt-1 text-xs text-muted-foreground">{fileSizeLabel(asset.sizeBytes)} · 원본 참고자료</p></div>
    <div class="flex flex-wrap gap-2">
      {#if links}<Button href={links.open} target="_blank" rel="noreferrer" variant="outline" size="sm">원본 열기</Button><Button href={links.download} target="_blank" rel="noreferrer" variant="outline" size="sm">내려받기</Button>{/if}
      <Button variant="ghost" size="sm" onclick={onClose}>닫기</Button>
    </div>
  </div>
  {#if error}<div role="alert" class="space-y-3 p-4 text-sm"><p class="text-destructive">{error}</p><Button variant="outline" size="sm" onclick={() => retry += 1}>파일 다시 불러오기</Button></div>
  {:else if !links}<p class="p-6 text-sm text-muted-foreground" role="status">원본 파일을 준비하고 있습니다.</p>
  {:else if asset.mime === 'application/pdf'}
    <iframe src={links.open} title={`${assetName(asset)} PDF 원본`} referrerpolicy="no-referrer" class="h-[60vh] min-h-80 w-full border-0 bg-white"></iframe>
    <p class="p-3 text-xs leading-relaxed text-muted-foreground">브라우저 PDF 뷰어를 사용합니다. 모바일에서 표시되지 않으면 ‘원본 열기’ 또는 ‘내려받기’를 이용하세요. 이미지로 된 악보도 텍스트 추출 없이 보관됩니다.</p>
  {:else if ['image/png', 'image/jpeg', 'image/webp'].includes(asset.mime)}
    <label class="flex items-center gap-2 border-b p-3 text-xs">이미지 확대<select bind:value={zoom} class="rounded-md border bg-background p-2"><option value={100}>화면에 맞춤</option><option value={150}>150%</option><option value={200}>200%</option></select></label>
    <div class="max-h-[65vh] overflow-auto bg-muted/20 p-2"><img src={links.open} alt={assetName(asset)} referrerpolicy="no-referrer" style:width={`${zoom}%`} style:max-width="none" class="h-auto" onerror={() => error = '이미지를 읽지 못했습니다. 업로드 상태를 확인하거나 원본을 다시 불러오세요.'} /></div>
  {:else if asset.mime === 'text/plain'}
    <iframe src={links.open} title={`${assetName(asset)} 텍스트 원본`} sandbox="" referrerpolicy="no-referrer" class="h-[45vh] min-h-64 w-full border-0 bg-white"></iframe>
  {:else}<div class="space-y-2 p-6 text-sm"><p>이 문서는 원본 파일로 제공합니다.</p><p class="text-muted-foreground">‘내려받기’로 저장한 뒤 문서 프로그램에서 확인하세요. 웹 미리보기는 PDF와 이미지, TXT를 지원합니다.</p></div>{/if}
</section>
