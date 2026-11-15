<script lang="ts">
  import { fade, fly, scale } from "svelte/transition";
  import { CalendarDays, Layers, MessageSquare, PlayCircle, Pause, Play } from "@lucide/svelte";

  // 처음에는 선택한 화면을 그대로 보여 준다. 사용자가 재생을 선택한 동안에만 예시를 움직인다.
  const STEPS = [
    { icon: PlayCircle, label: "개인 연습", title: "화면으로 먼저 연습해 보세요", text: "내 배역의 대사를 찾고, 누르면 해당 시점으로 이동해요. 어려운 장면은 반복하거나 속도를 늦춰 연습해 보세요." },
    { icon: Layers, label: "큐시트", title: "대사·음악·조명·영상이 한 흐름에서", text: "담당 큐가 앞뒤 대사와 어떻게 이어지는지 확인해요. 재생 위치에 맞춰 대사·음악·조명·영상 큐를 함께 볼 수 있어요." },
    { icon: MessageSquare, label: "메모", title: "생각난 순간에 바로 메모", text: "연습하다 걸리는 대목이 있으면 그 시점에 메모를 남겨 주세요. 연출과 동료가 같은 대목을 보면서 답을 달 수 있어요." },
    { icon: CalendarDays, label: "일정", title: "다음 일정에 버튼 한 번으로 답하기", text: "참석이나 불참을 누르면 끝이에요. 다른 참여자의 응답도 볼 수 있고, 다른 공연과 겹치면 알려 줘요." }
  ] as const;
  const STEP_MS = 5200;

  let step = $state(0);
  let playing = $state(false);
  let visible = $state(true);
  let reduced = $state(false);
  let root = $state<HTMLElement | null>(null);
  const dur = (ms: number) => (reduced ? 0 : ms);
  const running = $derived(playing && visible && !reduced);

  $effect(() => {
    reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!root || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver((entries) => { visible = entries[0]?.isIntersecting ?? true; }, { threshold: 0.25 });
    observer.observe(root);
    return () => observer.disconnect();
  });
  $effect(() => {
    if (!running) return;
    const currentStep = step;
    const timer = setTimeout(() => { step = (currentStep + 1) % STEPS.length; }, STEP_MS);
    return () => clearTimeout(timer);
  });

  const LINES = [
    { who: "하윤", text: "오늘도 부치지 못한 편지가 한 통 늘었네.", me: true }, { who: "지후", text: "안녕하세요. 오늘부터 이 구역 맡게 된 지후입니다.", me: false },
    { who: "하윤", text: "아… 네. 벌써 오셨어요?", me: true }, { who: "♪ 하윤", text: "밤마다 한 줄씩 적어 내려간 마음", me: true }
  ];
  const LANES = [
    { name: "대사", color: "bg-emerald-200 text-emerald-950", clips: [[0, 28, "해설"], [30, 62, "하윤 · 내 대사"], [66, 98, "지후"]] },
    { name: "음악", color: "bg-amber-200 text-amber-950", clips: [[8, 60, "넘버 1 · 독창"], [70, 98, "배경음악"]] },
    { name: "조명", color: "bg-lime-200 text-lime-950", clips: [[0, 20, "암전"], [22, 64, "따뜻한 빛"], [66, 98, "전체"]] },
    { name: "영상", color: "bg-pink-200 text-pink-950", clips: [[0, 55, "새벽의 우체국"], [58, 98, "낮의 마을"]] }
  ];
  const EVENTS = [
    { day: "토 10/10", time: "오후 1:00", title: "1차 테이블 리딩", yes: 5, no: 0, wait: 2 },
    { day: "일 10/11", time: "오후 6:00", title: "음악 큐 리허설", yes: 3, no: 1, wait: 3 }
  ];
  let activeLine = $state(0);
  let playhead = $state(8);
  $effect(() => {
    if (step !== 0 || !running) return;
    const timer = setInterval(() => { activeLine = (activeLine + 1) % LINES.length; }, 1100);
    return () => clearInterval(timer);
  });
  $effect(() => {
    if (step !== 1 || !running) return;
    playhead = 4;
    const timer = setInterval(() => { playhead = playhead >= 96 ? 4 : playhead + 1.2; }, 80);
    return () => clearInterval(timer);
  });
</script>

<div
  bind:this={root}
  class="bg-card overflow-hidden rounded-2xl border"
  role="group"
  aria-label="공연별 기능 사용 예시"
>
  <div class="bg-muted/40 flex items-center gap-1 overflow-x-auto border-b p-2 sm:p-3">
    {#each STEPS as item, index (item.label)}
      <button
        type="button"
        class={["flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-3 text-xs font-semibold transition-colors sm:px-4 sm:text-sm", step === index ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:bg-muted"]}
        aria-pressed={step === index}
        onclick={() => { step = index; playing = false; }}
      >
        <item.icon size={15} aria-hidden="true" /><span>{item.label}</span>
      </button>
    {/each}
    <button type="button" class="text-muted-foreground hover:bg-muted ms-auto flex size-11 shrink-0 items-center justify-center rounded-xl" aria-pressed={playing} aria-label={playing ? "예시 재생 멈추기" : "예시 재생하기"} title={playing ? "예시 재생 멈추기" : "예시 재생하기"} onclick={() => (playing = !playing)}>
      {#if playing}<Pause size={16} aria-hidden="true" />{:else}<Play size={16} aria-hidden="true" />{/if}
    </button>
  </div>

  <div class="relative grid min-h-[22rem] gap-0 sm:min-h-[24rem] md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
    <!-- 설명 -->
    <div class="flex flex-col justify-center gap-3 p-6 sm:p-8">
      {#key step}
        <div in:fly={{ y: 12, duration: dur(380) }}>
          <p class="text-muted-foreground text-xs">사용 예시 · {STEPS[step].label}</p>
          <h3 class="mt-2 text-balance break-keep text-xl font-semibold leading-snug sm:text-2xl">{STEPS[step].title}</h3>
          <p class="text-muted-foreground mt-3 break-keep text-sm leading-7">{STEPS[step].text}</p>
        </div>
      {/key}
      <div class="mt-3 flex gap-1.5" aria-hidden="true">
        {#each STEPS as _, index (index)}
          <span class="bg-muted relative h-1 flex-1 overflow-hidden rounded-full"><span class={["bg-primary absolute inset-y-0 start-0 rounded-full", index < step ? "w-full" : index === step && running ? "demo-fill" : index === step ? "w-1/3" : "w-0"]}></span></span>
        {/each}
      </div>
    </div>

    <!-- 실제 자료가 아닌 설명용 화면임을 표기한다. -->
    <div class="bg-muted/30 relative flex items-center justify-center overflow-hidden border-t p-5 sm:p-8 md:border-s md:border-t-0" aria-hidden="true">
      {#key step}
        <div class="w-full max-w-md" in:fade={{ duration: dur(300) }}>
          {#if step === 0}
            <div class="bg-card overflow-hidden rounded-2xl border">
              <div class="relative flex h-24 items-end bg-gradient-to-br from-slate-800 to-indigo-900 p-3 text-white">
                {#if running}<span class="demo-shimmer absolute inset-0"></span>{/if}
                <span class="relative text-xs">제1장 새벽의 우체국 · 00:{String(8 + activeLine * 6).padStart(2, "0")}</span>
                <span class="bg-primary relative ms-auto rounded-md px-2 py-0.5 text-[10px] font-bold">장면 반복</span>
              </div>
              <div class="space-y-0.5 p-2">
                {#each LINES as line, index (index)}
                  <div class={["flex items-start gap-2 rounded-lg border-s-4 px-2 py-1.5 text-xs transition-colors duration-300", activeLine === index ? "border-primary bg-primary/10" : line.me ? "border-amber-400" : "border-transparent opacity-60"]}>
                    <span class="w-12 shrink-0 font-semibold">{line.who}</span><span class="min-w-0 truncate">{line.text}</span>{#if line.me}<span class="text-primary ms-auto shrink-0 font-bold">내 파트</span>{/if}
                  </div>
                {/each}
              </div>
              <div class="bg-muted mx-3 mb-3 h-1.5 overflow-hidden rounded-full"><div class="bg-primary h-full rounded-full transition-all duration-500" style:width={`${20 + activeLine * 22}%`}></div></div>
            </div>
            <p class="text-muted-foreground mt-2 text-center text-xs">대사를 누르면 그 시점으로 이동 · 진행 바도 눌러서 이동</p>
          {:else if step === 1}
            <div class="bg-card rounded-2xl border p-3">
              <div class="text-muted-foreground mb-1.5 flex justify-between ps-9 font-mono text-[10px]"><span>00:00</span><span>05:00</span><span>10:00</span><span>15:00</span></div>
              <div class="relative space-y-1.5">
                {#each LANES as lane, laneIndex (lane.name)}
                  <div class="flex items-center gap-1.5">
                    <span class="text-muted-foreground w-7 shrink-0 text-[10px]">{lane.name}</span>
                    <div class="bg-muted/60 relative h-7 flex-1 overflow-hidden rounded-md">
                      {#each lane.clips as clip, clipIndex (clipIndex)}
                        <div in:fly={{ x: -12, duration: dur(300), delay: dur(laneIndex * 160 + clipIndex * 90) }} class={["absolute inset-y-0.5 overflow-hidden truncate rounded px-1.5 text-[10px] leading-6 font-medium", lane.color]} style:left={`${clip[0]}%`} style:width={`${(clip[1] as number) - (clip[0] as number)}%`}>{clip[2]}</div>
                      {/each}
                    </div>
                  </div>
                {/each}
                <div class="bg-primary pointer-events-none absolute inset-y-0 w-0.5 rounded" style:left={`calc(2.25rem + (100% - 2.25rem) * ${playhead / 100})`}></div>
              </div>
            </div>
            <p class="text-muted-foreground mt-2 text-center text-xs">재생 위치에 따라 화면의 대사·영상·큐가 함께 바뀌어요</p>
          {:else if step === 2}
            <div class="space-y-2">
              <div class="bg-card rounded-xl border p-3 text-xs">
                <p class="text-muted-foreground">제1장 · 00:14</p>
                <p class="mt-1 text-sm font-semibold">하윤 · 오늘도 부치지 못한 편지가 한 통 늘었네.</p>
                <div in:scale={{ start: 0.9, duration: dur(300), delay: dur(300) }} class="bg-primary text-primary-foreground mt-2 w-fit rounded-lg px-3 py-1.5 font-semibold">이 시점에 메모</div>
              </div>
              {#each [{ who: "나", text: "여기서 숨을 길게 쉬고 시작하기", delay: 900 }, { who: "연출", text: "좋아요, 조명도 천천히 올릴게요", delay: 1800 }, { who: "조명", text: "조06 큐 여기에 맞춰 둘게요", delay: 2700 }] as memo (memo.text)}
                <div in:fly={{ y: 12, duration: dur(320), delay: dur(memo.delay) }} class="bg-card flex items-start gap-2 rounded-xl border p-2.5 text-xs">
                  <span class="bg-secondary flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold">{memo.who}</span><span class="pt-0.5">{memo.text}</span>
                </div>
              {/each}
            </div>
          {:else}
            <div class="space-y-2">
              {#each EVENTS as event, index (event.title)}
                <div in:fly={{ y: 14, duration: dur(320), delay: dur(index * 300) }} class="bg-card rounded-xl border p-3 text-xs">
                  <div class="flex items-center justify-between gap-2"><div><p class="text-muted-foreground">{event.day} · {event.time}</p><p class="mt-0.5 text-sm font-semibold">{event.title}</p></div>
                    <div class="flex gap-1.5"><span class={["rounded-md px-2.5 py-1.5 font-semibold", index === 0 ? "bg-primary text-primary-foreground" : "border"]}>참석</span><span class="rounded-md border px-2.5 py-1.5">불참</span></div></div>
                  <div in:fade={{ duration: dur(300), delay: dur(700 + index * 300) }} class="mt-2.5 flex items-center gap-3">
                    <div class="bg-muted flex h-1.5 flex-1 overflow-hidden rounded-full"><span class="bg-emerald-500" style:width={`${event.yes * 10}%`}></span><span class="bg-red-400" style:width={`${event.no * 10}%`}></span></div>
                    <span class="text-muted-foreground">참석 {event.yes} · 불참 {event.no} · 미응답 {event.wait}</span>
                  </div>
                </div>
              {/each}
              <p in:fade={{ duration: dur(300), delay: dur(1500) }} class="text-muted-foreground flex items-center gap-1.5 pt-1 text-xs"><CalendarDays size={13} class="text-primary" />다른 공연과 겹치면 미리 알려 줘요</p>
            </div>
          {/if}
        </div>
      {/key}
    </div>
  </div>
</div>

<style>
  .demo-fill { animation: demo-fill 5.2s linear forwards; }
  @keyframes demo-fill { from { width: 0; } to { width: 100%; } }
  .demo-shimmer { background: linear-gradient(110deg, transparent 30%, rgb(255 255 255 / 0.22) 50%, transparent 70%); background-size: 200% 100%; animation: demo-shimmer 2.4s linear infinite; }
  @keyframes demo-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
  @media (prefers-reduced-motion: reduce) {
    .demo-fill, .demo-shimmer { animation: none; }
    .demo-fill { width: 100%; }
  }
</style>
