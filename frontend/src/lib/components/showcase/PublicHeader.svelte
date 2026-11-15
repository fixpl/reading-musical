<script lang="ts">
  import BrandMark from "$lib/components/ui/brand-mark.svelte";
  import { Button } from "$lib/components/ui/button";
  let { siteName = "아트브릿지" }: { siteName?: string } = $props();
</script>

<a href="#main-content" class="bg-background focus:ring-ring sr-only rounded-lg p-3 focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:ring-2">본문으로 바로가기</a>
<header class="bg-background/95 sticky top-0 z-30 border-b">
  <div class="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-3 sm:px-8">
    <a href="/" class="flex min-h-11 min-w-0 items-center gap-2.5 font-semibold tracking-tight"><BrandMark size={30} /><span class="truncate">{siteName}</span></a>
    <nav class="flex shrink-0 items-center gap-1 sm:gap-3" aria-label="주 메뉴">
      <a href="/performances" data-sveltekit-preload-data="off" class="inline-flex min-h-11 items-center px-2 text-sm font-medium">공연 소식</a>
      <Button href="/app" variant="outline" class="min-h-11 px-3">내 공연</Button>
    </nav>
  </div>
</header>
