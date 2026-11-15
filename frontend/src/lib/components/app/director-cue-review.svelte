<script lang="ts">
  import type { CueReview } from "$lib/domain/director-cues";
  import { formatTimelineTime } from "$lib/domain/performance-timeline";

  let { review, scenes, selected = $bindable(), links = $bindable(), disabled }: {
    review: CueReview;
    scenes: Array<{ id: string; title: string; act: string }>;
    selected: Record<string, boolean>;
    links: Record<string, string>;
    disabled: boolean;
  } = $props();

  let needsReviewOnly = $state(false);
  const needsReview = $derived(review.matches.filter(cue => cue.status === "review").length);
  const included = $derived(review.matches.filter(cue => selected[cue.id]).length);
  const visible = $derived(needsReviewOnly ? review.matches.filter(cue => cue.status === "review") : review.matches);
</script>

<section aria-labelledby="director-review-heading" class="grid gap-4 rounded-xl border p-4">
  <div class="grid gap-1">
    <h3 id="director-review-heading" class="font-semibold">디렉터 큐시트 확인</h3>
    <p class="text-muted-foreground text-sm leading-relaxed">큐시트의 큐 {review.matches.length}개 중 {included}개를 대본에서 찾은 큐와 함께 등록해요. 시각이 없는 큐는 시각 미정으로 저장돼요.</p>
    {#if review.warning}<p role="status" class="text-sm leading-relaxed">{review.warning}</p>{/if}
  </div>
  <label class="flex min-h-11 items-center gap-2 text-sm">
    <input type="checkbox" class="size-4 accent-primary" bind:checked={needsReviewOnly} />
    확인 필요한 큐만 보기 ({needsReview}개)
  </label>
  <div class="max-h-[36rem] min-w-0 divide-y overflow-y-auto rounded-lg border" role="region" aria-label="큐 대조 결과">
    {#each visible as cue (cue.id)}
      <article class="grid min-w-0 grid-cols-1 gap-2 p-3 sm:p-4" aria-label={`${cue.number} ${cue.section}`}>
        <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h4 class="text-sm font-semibold">{cue.number} <span class="font-medium">{cue.section}</span></h4>
          <span class={cue.status === "review" ? "text-amber-800 dark:text-amber-300 text-xs" : "text-emerald-800 dark:text-emerald-300 text-xs"}>{cue.status === "review" ? "확인 필요" : "연결 후보"}</span>
        </div>
        <p class="text-muted-foreground text-sm">{cue.reason}</p>
        {#if cue.scriptEvidence}<p class="break-words text-xs"><strong>대본</strong> {cue.scriptEvidence}</p>{/if}
        {#if cue.status === "review"}
          <p class="break-words text-xs"><strong>큐시트</strong> {cue.actions.find(action => action.track === "음악")?.content ?? cue.section}</p>
        {/if}
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label class="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" class="size-4 accent-primary" aria-label={`${cue.number} 등록에 포함`} bind:checked={selected[cue.id]} {disabled} /> 등록에 포함
          </label>
          <select class="bg-background min-h-11 w-full min-w-0 rounded-md border px-2 text-sm sm:w-64" aria-label={`${cue.number} 연결 장면`} bind:value={links[cue.id]} {disabled}>
            <option value="">장면 미지정</option>
            {#each scenes as scene (scene.id)}
              <option value={scene.id}>{scene.act} · {scene.title}</option>
            {/each}
          </select>
          {#if cue.startMs !== null}<span class="text-muted-foreground text-xs">{formatTimelineTime(cue.startMs)}</span>{/if}
        </div>
        <details class="text-sm">
          <summary class="cursor-pointer py-1">큐 지시 보기</summary>
          <ul class="text-muted-foreground mt-1 grid gap-1">
            {#each cue.actions as action (action.track)}
              <li class="break-words"><strong>{action.track}</strong> {action.content}</li>
            {/each}
          </ul>
          {#if cue.note}<p class="text-muted-foreground mt-1 break-words">{cue.note}</p>{/if}
        </details>
      </article>
    {/each}
  </div>
</section>
