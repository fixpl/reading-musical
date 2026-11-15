<script lang="ts">
  import { goto } from "$app/navigation";
  import { koreanDate, policyHref } from "$lib/api/site";
  import type { PageData } from "./$types";
  let { data }: { data: PageData } = $props();
  const doc = $derived(data.legal.document);
</script>
<svelte:head><title>{doc.title} — {data.site?.info.siteName || "아트브릿지"}</title><meta name="robots" content="noindex,follow" /></svelte:head>
<main class="mx-auto min-h-[65vh] max-w-3xl px-5 py-10 sm:py-16 [word-break:keep-all] [overflow-wrap:anywhere]">
  <nav class="flex gap-5 text-sm text-muted-foreground" aria-label="문서 탐색"><a href="/">홈</a><a href="/support">운영팀 문의</a></nav>
  <h1 class="mt-8 text-3xl font-bold tracking-tight">{doc.title}</h1>
  <p class="mt-3 text-sm text-muted-foreground">시행일 {koreanDate(doc.effectiveAt)}</p>
  {#if data.legal.history.length > 1}<label class="mt-6 grid gap-2 text-sm">이전 내용 보기<select class="min-h-11 rounded-lg border bg-background px-3" value={doc.id} onchange={(event) => goto(policyHref({ kind: doc.kind, id: event.currentTarget.value }))}>{#each data.legal.history as item (item.id)}<option value={item.id}>{koreanDate(item.effectiveAt)} 시행</option>{/each}</select></label>{/if}
  {#if doc.purpose}<dl class="mt-8 grid gap-4 rounded-xl border bg-muted/30 p-5 text-sm leading-7">{#each [["목적", doc.purpose], ["항목", doc.items], ["보유·이용 기간", doc.retention], ["동의 거부권 및 영향", doc.refusal]] as [label, content] (label)}<div><dt class="text-muted-foreground">{label}</dt><dd class="whitespace-pre-wrap font-semibold">{content}</dd></div>{/each}</dl>{/if}
  <article class="mt-8 whitespace-pre-wrap text-sm leading-8" aria-label="문서 본문">{doc.body}</article>
</main>
