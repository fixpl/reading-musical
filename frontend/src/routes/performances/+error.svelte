<script lang="ts">
  import { page } from "$app/state";
  import { invalidateAll } from "$app/navigation";
  import PublicHeader from "$lib/components/showcase/PublicHeader.svelte";
  import { Button } from "$lib/components/ui/button";
  let retrying = $state(false);
  async function retry() { retrying = true; try { await invalidateAll(); } finally { retrying = false; } }
</script>

<svelte:head><title>공연 안내 — 아트브릿지</title><meta name="robots" content="noindex" /></svelte:head>
<PublicHeader />
<main id="main-content" tabindex="-1" class="mx-auto min-h-[55vh] max-w-xl px-5 py-16 sm:px-8">
  <h1 class="text-2xl font-semibold">{page.status === 404 ? "공연 소개를 찾을 수 없어요" : "공연 소개를 불러오지 못했어요"}</h1>
  <p class="text-muted-foreground mt-4 text-sm leading-7">{page.error?.message || "잠시 후 다시 확인해 주세요."}</p>
  <div class="mt-6 flex flex-wrap gap-3"><Button href="/performances" class="min-h-11">공연 소식으로</Button>{#if page.status !== 404}<Button variant="outline" class="min-h-11" disabled={retrying} onclick={retry}>{retrying ? "확인 중…" : "다시 확인"}</Button>{/if}</div>
</main>
