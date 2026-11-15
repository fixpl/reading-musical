<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { Button } from "$lib/components/ui/button";
  import BrandMark from "$lib/components/ui/brand-mark.svelte";

  // 사용자가 설치 안내를 열었을 때만 보인다. 웹 시작을 먼저 제공하고 설치 방법은 선택으로 둔다.
  // Android·PC 크롬은 버튼 한 번으로 설치된다. iPhone은 Apple이 사이트가 설치 창을 직접 띄우는 것을 막아서 공유 메뉴를 거쳐야 한다.
  let { onSkip, onLearn }: { onSkip: () => void; onLearn: () => void } = $props();

  type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
  let deferred = $state<InstallPrompt | null>(null);
  let installed = $state(false);
  let platform = $state<"ios-safari" | "ios-other" | "android" | "other">("other");
  let inAppBrowser = $state(false);
  let copied = $state(false);
  let installError = $state("");

  onMount(() => {
    const ua = navigator.userAgent;
    const android = /Android/i.test(ua);
    // iPadOS는 Mac처럼 보이므로 터치 지원으로 가려낸다. Android는 먼저 확인한다.
    const ios = !android && (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
    inAppBrowser = /KAKAOTALK|NAVER\(|Instagram|FBAN|FBAV|Line\//i.test(ua);
    if (ios) platform = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|KAKAOTALK|NAVER/i.test(ua) ? "ios-safari" : "ios-other";
    else if (android) platform = "android";
    const onPrompt = (event: Event) => { event.preventDefault(); deferred = event as InstallPrompt; };
    const onInstalled = () => { installed = true; deferred = null; };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  });

  async function install() {
    if (!deferred) return;
    installError = "";
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      deferred = null;
      if (choice.outcome === "accepted") installed = true;
    } catch { deferred = null; installError = "설치 창을 열지 못했어요. 아래 브라우저 메뉴 안내를 따라 추가해 주세요."; }
  }
  async function copyLink() {
    try { await navigator.clipboard.writeText(location.origin); copied = true; setTimeout(() => (copied = false), 2500); } catch { /* 복사할 수 없으면 주소창에서 직접 복사 */ }
  }
  function useWeb() { onSkip(); void goto("/app"); }
</script>

<main class="bg-background text-foreground flex min-h-dvh flex-col px-6 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))]">
  <div class="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8">
    <!-- 홈 화면에 이렇게 생겨요 -->
    <div class="flex flex-col items-center gap-2" aria-hidden="true">
      <BrandMark size={48} />
      <span class="text-muted-foreground text-[13px] font-medium">아트브릿지</span>
    </div>

    <div class="space-y-2 text-center">
      <h1 class="text-2xl font-bold tracking-tight text-balance">웹에서도, 홈 화면에서도 열 수 있어요</h1>
      <p class="text-muted-foreground text-[15px] leading-relaxed">홈 화면에서 내 공연·연습·일정을 바로 열 수 있어요. 설치 없이 웹에서도 같은 기능을 사용할 수 있어요.</p>
    </div>

    <Button class="min-h-12 w-full" onclick={useWeb}>설치 없이 웹에서 시작하기</Button>

    <ul class="grid grid-cols-3 gap-2 text-center text-xs" aria-label="주요 기능">
      <li class="bg-muted/50 rounded-xl p-3"><strong class="block text-sm">내 공연</strong><span class="text-muted-foreground mt-1 block">배역과 공지 확인</span></li>
      <li class="bg-muted/50 rounded-xl p-3"><strong class="block text-sm">개인 연습</strong><span class="text-muted-foreground mt-1 block">대본·반주·내 배역</span></li>
      <li class="bg-muted/50 rounded-xl p-3"><strong class="block text-sm">내 일정</strong><span class="text-muted-foreground mt-1 block">리허설과 참석 응답</span></li>
    </ul>
    {#if installError}<p role="alert" class="text-destructive text-sm">{installError}</p>{/if}

    {#if installed}
      <div class="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-5 text-center" role="status">
        <p class="font-semibold">추가했어요</p>
        <p class="mt-1 text-sm leading-relaxed">홈 화면의 아트브릿지 아이콘으로 열면 로그인부터 시작해요.</p>
      </div>
    {:else if inAppBrowser}
      <div class="space-y-3 rounded-2xl border p-5 text-sm leading-relaxed">
        <p class="font-semibold">지금 열린 앱 안의 브라우저로는 추가할 수 없어요</p>
        <p class="text-muted-foreground">오른쪽 위 메뉴(⋮ 또는 공유)에서 <strong class="text-foreground">다른 브라우저로 열기</strong>를 눌러 {platform.startsWith("ios") ? "Safari" : "Chrome"}에서 다시 열어 주세요.</p>
        <Button variant="outline" class="min-h-11 w-full" onclick={copyLink}>{copied ? "주소를 복사했어요" : "주소 복사"}</Button>
      </div>
    {:else if deferred}
      <Button variant="outline" class="min-h-12 w-full" onclick={install}>홈 화면에 추가</Button>
    {:else if platform === "ios-safari"}
      <ol class="space-y-4 text-[15px] leading-snug">
        <li class="flex items-center gap-3">
          <span class="bg-muted flex size-11 shrink-0 items-center justify-center rounded-xl" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M8 7l4-4 4 4M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" /></svg>
          </span>
          <span>Safari의 <strong>공유 버튼</strong>을 눌러 주세요. 메뉴 안에 있으면 메뉴를 먼저 열어 주세요.</span>
        </li>
        <li class="flex items-center gap-3">
          <span class="bg-muted flex size-11 shrink-0 items-center justify-center rounded-xl" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M12 8v8M8 12h8" /></svg>
          </span>
          <span>목록에서 <strong>홈 화면에 추가</strong>를 골라 주세요</span>
        </li>
        <li class="flex items-center gap-3">
          <span class="bg-muted flex size-11 shrink-0 items-center justify-center rounded-xl text-sm font-semibold" aria-hidden="true">추가</span>
          <span>오른쪽 위 <strong>추가</strong>를 누르면 끝이에요</span>
        </li>
      </ol>
    {:else if platform === "ios-other"}
      <div class="space-y-3 rounded-2xl border p-5 text-sm leading-relaxed">
        <p class="text-muted-foreground">이 브라우저에서는 공유 메뉴의 <strong class="text-foreground">홈 화면에 추가</strong>가 없을 수 있어요. 주소를 복사해 <strong class="text-foreground">Safari</strong>에서 열어 주세요.</p>
        <Button variant="outline" class="min-h-11 w-full" onclick={copyLink}>{copied ? "주소를 복사했어요" : "주소 복사"}</Button>
      </div>
    {:else}
      <ol class="space-y-4 text-[15px] leading-snug">
        <li class="flex items-center gap-3"><span class="bg-muted flex size-11 shrink-0 items-center justify-center rounded-xl text-lg font-bold" aria-hidden="true">⋮</span><span>브라우저 오른쪽 위의 <strong>메뉴</strong>를 눌러 주세요</span></li>
        <li class="flex items-center gap-3"><span class="bg-muted flex size-11 shrink-0 items-center justify-center rounded-xl text-lg" aria-hidden="true">＋</span><span><strong>앱 설치</strong> 또는 <strong>홈 화면에 추가</strong>를 골라 주세요</span></li>
      </ol>
    {/if}
  </div>

  <div class="mx-auto w-full max-w-sm pt-6 text-center">
    <Button variant="outline" class="min-h-12 w-full" onclick={onLearn}>서비스 소개로 돌아가기</Button>

  </div>
</main>
