<script lang="ts">
  import { page } from "$app/state";
  import type { Snippet } from "svelte";
  import BrandMark from "$lib/components/ui/brand-mark.svelte";
  let { children }: { children: Snippet } = $props();
</script>

<div class="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
  <div class="flex min-w-0 flex-col px-5 py-5 sm:px-10 sm:py-7">
    <a href="/" class="flex min-h-11 w-fit max-w-full items-center gap-2.5 rounded-md font-semibold focus-visible:outline-2 focus-visible:outline-ring"><BrandMark size={30} class="shrink-0" /><span class="min-w-0 [overflow-wrap:anywhere]">{page.data.site?.info.siteName || "아트브릿지"}</span></a>
    <main class="flex flex-1 items-center justify-center py-10"><div class="w-full max-w-sm">{@render children()}</div></main>
  </div>
  <aside class="hidden min-w-0 flex-col justify-center border-s bg-muted/25 px-12 py-16 lg:flex xl:px-16" aria-labelledby="auth-participation">
    <h2 id="auth-participation" class="max-w-md text-2xl font-semibold tracking-tight">공연에 참여하는 방법</h2>
    <dl class="mt-6 max-w-md divide-y border-y text-sm">
      <div class="py-4"><dt class="font-semibold">운영팀에서 배정받았다면</dt><dd class="text-muted-foreground mt-1 leading-6">로그인 후 ‘내 공연’에서 배정된 공연을 열어요.</dd></div>
      <div class="py-4"><dt class="font-semibold">초대 링크를 받았다면</dt><dd class="text-muted-foreground mt-1 leading-6">링크를 열고 초대받은 이메일로 로그인하거나 가입해요.</dd></div>
    </dl>
  </aside>
</div>
