<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();

  // 서비스가 하는 일 — 타이핑되는 문장들
  const PHRASES = [
    "대본을 붙여넣으면 장면과 큐가 정리됩니다.",
    "배우는 내 대사만, 조명은 내 큐만 봅니다.",
    "리허설은 타임라인을 재생하며 맞춥니다.",
    "출석 응답과 공지가 공연 안에서 끝납니다."
  ];

  let typed = $state("");
  let timer: ReturnType<typeof setTimeout> | null = null;

  onMount(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      typed = PHRASES[0];
      return;
    }
    let index = 0;
    let position = 0;
    let deleting = false;

    const tick = () => {
      const phrase = PHRASES[index];
      if (!deleting) {
        position += 1;
        typed = phrase.slice(0, position);
        if (position === phrase.length) {
          deleting = true;
          timer = setTimeout(tick, 2200);
          return;
        }
        timer = setTimeout(tick, 62);
      } else {
        position -= 1;
        typed = phrase.slice(0, position);
        if (position === 0) {
          deleting = false;
          index = (index + 1) % PHRASES.length;
          timer = setTimeout(tick, 350);
          return;
        }
        timer = setTimeout(tick, 26);
      }
    };
    timer = setTimeout(tick, 600);
  });

  onDestroy(() => {
    if (timer) clearTimeout(timer);
  });
</script>

<div class="grid min-h-dvh lg:grid-cols-2">
  <!-- 왼쪽: 폼 -->
  <div class="flex flex-col p-6 sm:p-10">
    <a href="/" class="flex items-center gap-2.5 font-semibold">
      <span class="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg">아</span>
      아트브릿지
    </a>
    <div class="flex flex-1 items-center justify-center py-10">
      <div class="w-full max-w-sm">
        {@render children()}
      </div>
    </div>
    <p class="text-muted-foreground/60 text-center text-xs">리딩뮤지컬 제작·진행 플랫폼</p>
  </div>

  <!-- 오른쪽: 타이포그래픽 서비스 소개 -->
  <div
    class="relative hidden flex-col justify-center gap-10 overflow-hidden border-s p-14 lg:flex"
    style="background:
      radial-gradient(ellipse 70% 55% at 75% 10%, color-mix(in oklab, var(--primary) 16%, transparent), transparent 65%),
      linear-gradient(165deg, color-mix(in oklab, var(--primary) 7%, var(--background)), var(--background) 55%);"
  >
    <p class="text-primary text-sm font-bold tracking-[0.18em] uppercase">아트브릿지가 하는 일</p>

    <!-- 타이핑 타이포그래피 -->
    <div class="min-h-[9.5rem] xl:min-h-[11rem]">
      <h2 class="text-foreground max-w-xl text-4xl leading-snug font-bold tracking-tight text-balance xl:text-5xl">
        {typed}<span class="text-primary animate-pulse font-light">|</span>
      </h2>
    </div>

    <div class="text-muted-foreground grid max-w-md gap-4 text-[17px] leading-relaxed">
      <p>
        <span class="text-primary me-3 font-mono text-sm font-bold">01</span>
        관리자는 공연을 만들고 대본을 등록합니다.
      </p>
      <p>
        <span class="text-primary me-3 font-mono text-sm font-bold">02</span>
        배우·스태프는 본인 공연에서 담당 큐와 일정만 정리합니다.
      </p>
      <p>
        <span class="text-primary me-3 font-mono text-sm font-bold">03</span>
        공연 당일엔 큐시트를 슬라이드처럼 재생하며 진행합니다.
      </p>
    </div>

    <p class="text-muted-foreground/60 text-sm">대본 · 큐시트 · 일정 · 소통 — 공연 하나에 전부 들어 있습니다.</p>
  </div>
</div>
