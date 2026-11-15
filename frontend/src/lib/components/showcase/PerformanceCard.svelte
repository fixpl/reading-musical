<script lang="ts">
  import { ArrowUpRight } from "@lucide/svelte";
  import { performancePeriod, performanceStatus, type PublicPerformance } from "$lib/api/showcase";
  import ShowcaseImage from "./ShowcaseImage.svelte";
  let { performance, today }: { performance: PublicPerformance; today: string } = $props();
</script>

<article class="group min-w-0">
  <a href={`/performances/${encodeURIComponent(performance.slug)}`} data-sveltekit-preload-data="off" class="focus-visible:outline-ring block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4">
    <ShowcaseImage src={performance.posterUrl} alt={`${performance.title} 포스터`} class="aspect-[3/4] rounded-xl border" fallback="포스터 준비 중" />
    <div class="mt-4 flex items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="text-primary mb-1.5 text-xs font-semibold">{performanceStatus(performance, today)}</p>
        <h3 class="text-lg font-semibold leading-7 break-words group-hover:underline group-hover:underline-offset-4">{performance.title}</h3>
      </div>
      <ArrowUpRight class="text-muted-foreground mt-1.5 size-5 shrink-0" aria-hidden="true" />
    </div>
    {#if performance.synopsis}<p class="text-muted-foreground mt-2 line-clamp-2 text-sm leading-6">{performance.synopsis}</p>{/if}
    <div class="text-muted-foreground mt-3 grid gap-1 text-xs leading-5"><p>{performancePeriod(performance.startDate, performance.endDate)}</p><p class="break-words">{performance.venue || "장소 미정"}</p></div>
  </a>
</article>
