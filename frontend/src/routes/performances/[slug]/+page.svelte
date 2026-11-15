<script lang="ts">
  import { ArrowLeft, CalendarDays, MapPin, ExternalLink, Play } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button";
  import PublicHeader from "$lib/components/showcase/PublicHeader.svelte";
  import ShowcaseImage from "$lib/components/showcase/ShowcaseImage.svelte";
  import { performancePeriod, performanceStatus, safeHttpsLink } from "$lib/api/showcase";
  import type { PageData } from "./$types";
  let { data }: { data: PageData } = $props();
  const performance = $derived(data.performance);
  const siteName = $derived(data.site?.info.siteName || "아트브릿지");
  const officialUrl = $derived(safeHttpsLink(performance.officialUrl));
  const ticketUrl = $derived(safeHttpsLink(performance.ticketUrl));
  const videoUrl = $derived(safeHttpsLink(performance.videoUrl));
</script>

<svelte:head>
  <title>{performance.title} — {siteName}</title>
  <meta name="description" content={performance.synopsis || `${performance.title} 공연 소개와 관람 안내`} />
  <meta property="og:title" content={`${performance.title} — ${siteName}`} />
  <meta property="og:description" content={performance.synopsis || "공연 소개와 관람 안내를 확인해 보세요."} />
</svelte:head>

<PublicHeader {siteName} />
<main id="main-content" tabindex="-1" class="mx-auto max-w-6xl px-5 pb-14 pt-6 sm:px-8 sm:pb-20">
  <a href="/performances" data-sveltekit-preload-data="off" class="text-muted-foreground hover:text-foreground mb-6 inline-flex min-h-11 items-center gap-2 text-sm"><ArrowLeft class="size-4" aria-hidden="true" />공연 소식</a>
  <section class="grid items-start gap-7 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-10 lg:gap-16" aria-labelledby="performance-title">
    <ShowcaseImage src={performance.posterUrl} alt={`${performance.title} 포스터`} class="mx-auto aspect-[2/3] w-full max-w-sm rounded-xl border sm:max-w-none" fallback="포스터 준비 중" eager />
    <div class="min-w-0 py-1 sm:py-5">
      <p class="text-primary text-sm font-semibold">{performanceStatus(performance, data.today)}</p>
      <h1 id="performance-title" class="mt-3 text-3xl font-semibold leading-snug tracking-tight break-words sm:text-4xl">{performance.title}</h1>
      {#if performance.synopsis}<p class="text-muted-foreground mt-5 whitespace-pre-wrap text-base leading-8 break-words">{performance.synopsis}</p>{/if}
      <dl class="mt-7 grid gap-4 border-y py-5 text-sm">
        <div class="flex gap-3"><dt class="text-muted-foreground flex shrink-0 items-center gap-2"><CalendarDays class="size-4" aria-hidden="true" />공연 날짜</dt><dd>{performancePeriod(performance.startDate, performance.endDate)}</dd></div>
        <div class="flex gap-3"><dt class="text-muted-foreground flex shrink-0 items-center gap-2"><MapPin class="size-4" aria-hidden="true" />공연 장소</dt><dd class="break-words">{performance.venue || "장소 미정"}</dd></div>
      </dl>
      {#if ticketUrl || officialUrl}<div class="mt-6 flex flex-wrap gap-3">{#if ticketUrl}<Button href={ticketUrl} target="_blank" rel="noopener noreferrer" class="min-h-12">예매·관람 안내<ExternalLink class="ms-1 size-4" aria-hidden="true" /><span class="sr-only"> (새 창)</span></Button>{/if}{#if officialUrl}<Button href={officialUrl} target="_blank" rel="noopener noreferrer" variant="outline" class="min-h-12">공식 홈페이지<ExternalLink class="ms-1 size-4" aria-hidden="true" /><span class="sr-only"> (새 창)</span></Button>{/if}</div><p class="text-muted-foreground mt-3 text-xs leading-6">외부 페이지가 새 창에서 열려요. 관람 시간과 예매 조건은 해당 페이지에서 확인해 주세요.</p>{/if}
    </div>
  </section>
  {#if performance.description}
    <section class="mt-12 border-t pt-8 sm:mt-16" aria-labelledby="description-title"><h2 id="description-title" class="text-xl font-semibold">공연 소개</h2><p class="text-muted-foreground mt-5 max-w-3xl whitespace-pre-wrap text-base leading-8 break-words">{performance.description}</p></section>
  {/if}
  {#if performance.gallery.length > 0 || videoUrl}
    <section class="mt-12 border-t pt-8" aria-labelledby="gallery-title"><h2 id="gallery-title" class="text-xl font-semibold">사진과 영상</h2>{#if videoUrl}<Button href={videoUrl} target="_blank" rel="noopener noreferrer" variant="outline" class="mt-5 min-h-12"><Play class="size-4" aria-hidden="true" />공연 소개 영상 보기<ExternalLink class="size-4" aria-hidden="true" /><span class="sr-only"> (새 창)</span></Button>{/if}{#if performance.gallery.length > 0}<div class="mt-6 grid gap-6 sm:grid-cols-2">{#each performance.gallery as picture, index (`${picture.url}-${index}`)}<figure class="min-w-0"><ShowcaseImage src={picture.url} alt={picture.caption || `${performance.title} 공연 사진 ${index + 1}`} class="aspect-[4/3] rounded-lg border" />{#if picture.caption}<figcaption class="text-muted-foreground mt-2 whitespace-pre-wrap text-sm leading-6 break-words">{picture.caption}</figcaption>{/if}</figure>{/each}</div>{/if}</section>
  {/if}
  {#if performance.cast.length > 0}
    <section class="mt-12 border-t pt-8" aria-labelledby="cast-title"><h2 id="cast-title" class="text-xl font-semibold">출연진</h2><ul class="mt-6 grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 lg:grid-cols-5">{#each performance.cast as person, index (`${person.displayName}-${index}`)}<li class="min-w-0"><ShowcaseImage src={person.photoUrl} alt={`${person.displayName} 배우 사진`} class="aspect-square rounded-full border" fallback="사진 비공개" /><p class="mt-3 text-center font-semibold break-words">{person.displayName}</p><p class="text-muted-foreground mt-1 text-center text-sm leading-6 break-words">{person.roles.join(" · ")}</p></li>{/each}</ul></section>
  {/if}
  <div class="mt-12 border-t pt-7"><a href="/performances" data-sveltekit-preload-data="off" class="inline-flex min-h-11 items-center gap-2 text-sm font-medium"><ArrowLeft class="size-4" aria-hidden="true" />다른 공연 보기</a></div>
</main>
