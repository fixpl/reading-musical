<script lang="ts">
  import { loadPublicPerformances } from "$lib/api/showcase";
  import { invalidate } from "$app/navigation";
  import PublicHeader from "$lib/components/showcase/PublicHeader.svelte";
  import PerformanceCard from "$lib/components/showcase/PerformanceCard.svelte";
  import { Button } from "$lib/components/ui/button";
  import type { PageData } from "./$types";
  let { data }: { data: PageData } = $props();
  const siteName = $derived(data.site?.info.siteName || "아트브릿지");
  let refreshing = $state(false);
  let performances = $derived(data.performances);
  let hasMore = $derived(data.hasMore);
  let offset = $derived(data.offset + data.performances.length);
  let loadingMore = $state(false);
  let moreError = $state("");
  async function more() {
    if (loadingMore) return;
    loadingMore = true;
    moreError = "";
    try {
      const result = await loadPublicPerformances(fetch, 60, offset);
      const ids = new Set(performances.map((item) => item.slug));
      performances = [...performances, ...result.items.filter((item) => !ids.has(item.slug))];
      offset = result.offset + result.items.length;
      hasMore = result.hasMore;
    } catch { moreError = "다음 공연 소식을 불러오지 못했어요. 다시 시도해 주세요."; }
    finally { loadingMore = false; }
  }
  async function retry() {
    refreshing = true;
    try { await invalidate("showcase:public"); } finally { refreshing = false; }
  }
</script>

<svelte:head>
  <title>공연 소식 — {siteName}</title>
  <meta name="description" content={`${siteName}의 공연을 만나 보세요. 공연 소개와 날짜, 장소, 출연진을 확인할 수 있어요.`} />
</svelte:head>

<PublicHeader {siteName} />
<main id="main-content" tabindex="-1" class="mx-auto min-h-[60vh] max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
  <header class="mb-8"><h1 class="text-3xl font-semibold tracking-tight sm:text-4xl">공연 소식</h1></header>
  {#if data.performancesError}
    <div class="rounded-xl border p-6" role="alert"><h2 class="font-semibold">공연 소식을 확인하지 못했어요</h2><p class="text-muted-foreground mt-2 text-sm leading-6">{data.performancesError}</p><Button variant="outline" class="mt-4 min-h-11" disabled={refreshing} onclick={retry}>{refreshing ? "확인 중…" : "다시 확인"}</Button></div>
  {:else if performances.length === 0}
    <div class="rounded-xl border px-6 py-8"><h2 class="font-semibold">공개된 공연 소식이 아직 없어요.</h2><Button href="/" variant="outline" class="mt-4 min-h-11">홈으로 이동</Button></div>
  {:else}
    <div class="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">{#each performances as performance (performance.slug)}<PerformanceCard {performance} today={data.today} />{/each}</div>
    {#if hasMore}<div class="mt-10 text-center">{#if moreError}<p role="alert" class="mb-3 text-sm leading-6 text-destructive">{moreError}</p>{/if}<Button variant="outline" class="min-h-12 min-w-40" disabled={loadingMore} onclick={more}>{loadingMore ? "불러오는 중…" : moreError ? "다시 불러오기" : "공연 더 보기"}</Button></div>{/if}
  {/if}
</main>
