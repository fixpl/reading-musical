<script lang="ts">
  import PerformanceCard from "$lib/components/showcase/PerformanceCard.svelte";
  import FaqBrowser from "$lib/components/site/FaqBrowser.svelte";
  import type { PageData } from "./$types";
  let { data }: { data: PageData } = $props();
  const siteName = $derived(data.site?.info.siteName || "아트브릿지");
  import BrandMark from "$lib/components/ui/brand-mark.svelte";
  import { Button } from "$lib/components/ui/button";
  import MyProductionsBoard from "$lib/components/landing/MyProductionsBoard.svelte";
  import InquiryForm from "$lib/components/landing/InquiryForm.svelte";
  import InstallGate from "$lib/components/landing/InstallGate.svelte";
  import HeroDemo from "$lib/components/landing/HeroDemo.svelte";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";

  // 설치 안내는 사용자가 선택했을 때만 연다. 설치한 앱의 시작 경로는 유지한다.
  let showGate = $state(false);
  onMount(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) { void goto("/app", { replaceState: true }); return; }
    showGate = new URL(location.href).searchParams.get("install") === "1";
  });
  function showIntroduction() { showGate = false; void goto("/?web=1", { replaceState: true }); }

  const journey = [
    { title: "프로필과 가능한 일정을 남겨요", text: "가입 후 활동 직군과 참여 가능한 일정을 적어 주세요." },
    { title: "운영팀의 배정이나 초대로 참여해요", text: "아트브릿지 운영팀이 공연의 배역·담당 자리와 일정을 확인해 배정해요. 초대 링크로 참여할 수도 있어요. 가입만으로 공연 참여가 확정되지는 않아요." },
    { title: "내 공연에서 준비를 시작해요", text: "배정되면 알림을 확인하고, 공연별 대본과 연습 자료를 열어 보세요. 여러 공연에 참여해도 역할과 자료는 공연별로 구분해요." }
  ];
  const roles = [
    { name: "배우", action: "대본 읽기와 개인 연습", text: "내 배역의 대사를 찾고, 반주·영상과 함께 장면을 반복해요. 다음 연습 일정에 참석 여부를 남겨요." },
    { name: "스태프", action: "담당 큐와 앞뒤 흐름 확인", text: "큐시트에서 조명·음향·영상 큐를 확인해요. 연습 중 바꿔야 할 지점은 같은 시점의 메모로 나눠요." },
    { name: "연출·제작진", action: "공연 자료와 참여자 준비", text: "공연별 대본·반주·영상을 정리하고, 참여자를 배정하거나 초대해요. 일정 응답과 공유 메모를 함께 확인해요." }
  ];

</script>

<svelte:head>
  <title>{siteName} — 공연 준비와 연습</title>
  <meta name="description" content="공연별 대본, 반주, 담당 큐, 일정과 공유 메모를 한곳에서 확인해요. 아트브릿지가 운영하는 리딩뮤지컬 공연에 배정되거나 초대받아 참여해요." />
  <meta property="og:title" content={`${siteName} — 공연 준비와 연습`} />
  <meta property="og:description" content="배우는 대본과 개인 연습을, 스태프는 담당 큐를 확인해요. 일정과 공유 메모도 내 공연에서 찾아요." />
</svelte:head>

{#if showGate}
  <InstallGate onSkip={() => showGate = false} onLearn={showIntroduction} />
{:else}
<div class="bg-background text-foreground min-h-dvh">
  <a href="#main-content" class="bg-background focus:ring-ring sr-only rounded-lg p-3 focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:ring-2">본문으로 바로가기</a>
  <header class="bg-background/95 sticky top-0 z-30 border-b">
    <div class="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-3 sm:px-8">
      <a href="/" class="flex min-h-11 shrink-0 items-center gap-2.5 font-semibold tracking-tight" aria-label="아트브릿지 홈"><BrandMark size={30} /><span>{siteName}</span></a>
      <nav class="text-muted-foreground hidden items-center gap-6 text-sm md:flex" aria-label="서비스 소개"><a class="inline-flex min-h-11 items-center hover:text-foreground" href="/performances" data-sveltekit-preload-data="off">공연 소식</a><a class="inline-flex min-h-11 items-center hover:text-foreground" href="#inside">사용 예시</a><a class="inline-flex min-h-11 items-center hover:text-foreground" href="#join">참여 방법</a></nav>
      <div class="flex items-center gap-1 sm:gap-2"><Button href="/login" variant="ghost" class="min-h-11 px-3">로그인</Button><Button href="/register" class="min-h-11 px-3 sm:px-4">회원가입</Button></div>
    </div>
  </header>
  <main id="main-content" tabindex="-1">
    <section class="mx-auto grid max-w-6xl items-center gap-8 px-5 py-10 sm:px-8 sm:py-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-14 lg:py-16" aria-labelledby="hero-title">
      <div>
        <h1 id="hero-title" class="max-w-xl break-keep text-[clamp(2rem,4vw,3.25rem)] font-semibold leading-[1.25] tracking-[-0.04em] text-balance">공연 준비부터 리허설까지</h1>
        <p class="text-muted-foreground mt-5 max-w-lg break-keep text-base leading-7">기획자는 대본·배역·일정을 준비하고, 배우와 스태프는 같은 자료로 연습해요.</p>
        <div class="mt-6 flex flex-wrap gap-2.5">
          <Button href="/app" class="min-h-12 px-4 sm:px-6">내 공연 열기</Button>
          <Button href="/inquiries/new" variant="outline" class="min-h-12 px-4 sm:px-6">기관·단체 공연 신청</Button>
        </div>
        {#if data.site?.ready.inquiry === false}<p class="text-muted-foreground mt-3 text-sm">현재 기관·단체 공연 신청을 준비 중이에요.</p>{/if}
      </div>
      <MyProductionsBoard />
    </section>

    <section id="inside" class="scroll-mt-24 border-y bg-muted/20" aria-labelledby="inside-title">
      <div class="mx-auto max-w-6xl px-5 py-10 sm:px-8 sm:py-14">
        <h2 id="inside-title" class="mb-6 text-2xl font-semibold tracking-tight sm:text-3xl">공연 자료 사용 예시</h2>
        <HeroDemo />
      </div>
    </section>

    {#if data.performancesError || data.performances.length}
    <section id="performances" class="scroll-mt-24" aria-labelledby="performances-title">
      <div class="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-16">
        <div class="mb-7 flex flex-wrap items-center justify-between gap-4"><h2 id="performances-title" class="text-2xl font-semibold tracking-tight sm:text-3xl">공연 소식</h2><Button href="/performances" variant="outline" class="min-h-11" data-sveltekit-preload-data="off">전체 공연 보기</Button></div>
        {#if data.performancesError}<div class="bg-muted/30 rounded-xl border p-5"><p class="text-muted-foreground text-sm leading-7">공연 소식을 불러오지 못했어요. <a href="/performances" data-sveltekit-preload-data="off" class="text-foreground inline-flex min-h-11 items-center font-medium underline underline-offset-4">공연 소식에서 다시 확인해 주세요.</a></p></div>
        {:else}<div class="grid grid-cols-2 gap-x-4 gap-y-8 sm:gap-x-6 lg:grid-cols-4">{#each data.performances as performance (performance.slug)}<PerformanceCard {performance} today={data.today} />{/each}</div>{/if}
      </div>
    </section>
    {/if}

    <section class="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-16" aria-labelledby="roles-title">
      <h2 id="roles-title" class="text-2xl font-semibold tracking-tight sm:text-3xl">역할별로 하는 일</h2>
      <dl class="mt-7 divide-y border-y">
        {#each roles as role (role.name)}
          <div class="grid gap-3 py-6 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-8"><dt class="text-base font-semibold">{role.name}</dt><dd class="max-w-2xl"><p class="font-medium">{role.action}</p><p class="text-muted-foreground mt-2 text-sm leading-7">{role.text}</p></dd></div>
        {/each}
      </dl>
    </section>

    <section id="join" class="scroll-mt-24 border-y bg-muted/20" aria-labelledby="join-title">
      <div class="mx-auto grid max-w-6xl gap-7 px-5 py-12 sm:px-8 sm:py-16 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)] lg:gap-16">
        <div><h2 id="join-title" class="text-2xl font-semibold tracking-tight sm:text-3xl">공연 참여는 이렇게 이어져요.</h2><p class="text-muted-foreground mt-4 max-w-sm text-sm leading-7">아트브릿지는 리딩뮤지컬 공연을 직접 운영해요. 운영팀이 공연을 준비하고, 참여자에게 역할과 자료를 연결해요.</p><Button href="/register" variant="outline" class="mt-5 min-h-11">회원가입</Button></div>
        <ol class="grid gap-6">
          {#each journey as step, index (step.title)}
            <li class="flex gap-4"><span class="bg-secondary text-secondary-foreground mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold" aria-hidden="true">{index + 1}</span><div><h3 class="font-semibold">{step.title}</h3><p class="text-muted-foreground mt-2 text-sm leading-7">{step.text}</p></div></li>
          {/each}
        </ol>
      </div>
    </section>

    <section class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-5 px-5 py-8 sm:px-8" aria-label="설치 안내"><div><p class="font-medium">자주 쓰는 휴대폰에는 홈 화면에 추가해 보세요.</p><p class="text-muted-foreground mt-1 text-sm leading-6">설치 없이 웹에서도 같은 기능을 사용할 수 있어요.</p></div><Button variant="outline" class="min-h-11 shrink-0" onclick={() => showGate = true}>설치 안내</Button></section>

    <section id="faq" class="mx-auto max-w-3xl scroll-mt-24 px-5 py-12 sm:px-8 sm:py-16" aria-labelledby="faq-title"><h2 id="faq-title" class="text-2xl font-semibold tracking-tight">자주 묻는 질문</h2><div class="mt-6"><FaqBrowser categories={data.faq} errorMessage={data.faqError} /></div></section>

    <section id="inquiry" class="scroll-mt-24 border-t bg-muted/20" aria-labelledby="inquiry-title"><div class="mx-auto grid max-w-6xl gap-8 px-5 py-12 sm:px-8 sm:py-16 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16"><div><h2 id="inquiry-title" class="text-2xl font-semibold tracking-tight sm:text-3xl">기관·단체 공연을 준비하고 있나요?</h2><p class="text-muted-foreground mt-4 max-w-sm text-sm leading-7">공연 의뢰나 운영에 관한 궁금한 점을 남겨 주세요. 담당자가 내용을 확인한 뒤 연락드려요.</p><p class="text-muted-foreground mt-5 text-sm leading-7">이미 참여 중인 공연의 대본과 일정은 <a href="/app" class="text-foreground inline-flex min-h-11 items-center font-medium underline underline-offset-4">내 공연</a>에서 확인해 주세요.</p></div><div class="bg-card rounded-xl border p-5 sm:p-7"><InquiryForm /></div></div></section>
  </main>
</div>
{/if}
