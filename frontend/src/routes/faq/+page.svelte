<script lang="ts">
  import FaqBrowser from "$lib/components/site/FaqBrowser.svelte";
  import type { PageData } from "./$types";
  let { data }: { data: PageData } = $props();
</script>
<svelte:head><title>자주 묻는 질문 — {data.site?.info.siteName || "아트브릿지"}</title></svelte:head>
<main class="mx-auto min-h-[65vh] max-w-3xl px-5 py-10 sm:py-16">
  <a href="/" class="text-sm text-muted-foreground underline-offset-4 hover:underline">홈으로</a>
  <h1 class="mt-7 text-3xl font-bold tracking-tight">자주 묻는 질문</h1>
  <p class="mb-8 mt-3 text-sm leading-7 text-muted-foreground">카테고리를 고르거나 궁금한 내용을 검색해 보세요.</p>
  <FaqBrowser categories={data.faq} errorMessage={data.faqError} />
</main>
