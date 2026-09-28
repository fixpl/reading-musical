<script lang="ts">
  import { ArrowRight, AudioLines, CalendarDays, FileText, Layers, Users, MonitorPlay, MessagesSquare, Check, ChevronDown } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button";
  import ProductPreview from "$lib/components/landing/ProductPreview.svelte";
  import InquiryForm from "$lib/components/landing/InquiryForm.svelte";

  const features = [
    { icon: Users, title: "공연과 사람을 한곳에", text: "공연별로 배우와 스태프를 배정하고, 배역과 담당 업무를 정리합니다. 여러 곳에 흩어진 참여자 정보를 다시 찾지 않아도 됩니다.", tag: "공연 · 회원 · 캐스팅" },
    { icon: FileText, title: "대본을 준비의 중심으로", text: "대본을 장면과 대사로 정리하고 팀이 같은 내용을 확인합니다. AI 분석 초안은 원문의 시간표시를 보존하며, 검토한 뒤 적용합니다.", tag: "대본 · 장면 · AI 초안" },
    { icon: Layers, title: "같은 시간 위에 맞추는 큐", text: "대사, 음향, 조명, 배경을 공연 시작 기준 시간으로 맞춥니다. 시작 시점과 길이를 수정하고 담당 트랙의 큐를 정리합니다.", tag: "타임라인 · 큐시트" },
    { icon: CalendarDays, title: "겹치기 전에 확인하는 일정", text: "개인 일정과 다른 공연의 참석 일정을 함께 확인합니다. 중복 배정은 충돌로 알리고, 제작진의 강행 배정에는 사유를 남깁니다.", tag: "공동 일정 · 개인 일정 · 출석" },
    { icon: MonitorPlay, title: "혼자서도 이어가는 리허설", text: "선택한 대본을 재생하고, 시점을 이동하거나 장면을 반복합니다. 내 배역을 강조하고 대사와 배경을 전체화면으로 확인합니다.", tag: "개인 연습 · 시간 편집 · 출력" },
    { icon: MessagesSquare, title: "변경 소식도 공연 안에서", text: "공연별 게시판과 알림으로 준비 내용을 공유합니다. 참여자는 배정된 공연의 일정, 대본, 공지를 모바일에서도 확인합니다.", tag: "공지 · 소통 · 알림" }
  ];
  const workflow = [
    { number: "01", title: "공연을 만듭니다", text: "관리자가 공연을 등록하고 준비할 프로젝트를 엽니다." },
    { number: "02", title: "함께할 팀을 배정합니다", text: "배우·스태프를 초대하고 배역과 담당 트랙을 정합니다." },
    { number: "03", title: "대본과 시간을 맞춥니다", text: "장면, 대사, 큐를 정리하고 공동 리허설 일정을 잡습니다." },
    { number: "04", title: "연습하고 무대를 준비합니다", text: "개인 연습으로 흐름을 익히고, 공연 시간표와 출력을 확인합니다." }
  ];
  const roles = [
    { name: "운영자·제작진", eyebrow: "전체를 보는 사람에게", description: "누가, 언제, 무엇을 준비하는지.", items: ["공연·회원 관리와 참여자 배정", "대본·캐스팅·큐시트 제작 관리", "공동 일정과 출석·충돌 확인"] },
    { name: "배우", eyebrow: "장면을 만드는 사람에게", description: "내 공연과 내 대사에 집중하도록.", items: ["배정된 공연의 대본·공지 확인", "배역 강조와 장면 반복 연습", "개인 일정 관리와 참석 응답"] },
    { name: "스태프", eyebrow: "무대를 연결하는 사람에게", description: "내 큐를 전체 흐름 속에서.", items: ["공연 전체 큐시트 흐름 확인", "담당 트랙의 시간과 큐 편집", "리허설 일정과 변경 소식 확인"] }
  ];
  const questions = [
    { question: "회원가입하면 바로 공연을 만들 수 있나요?", answer: "현재는 슈퍼관리자가 공연과 회원을 운영하는 단계입니다. 배우와 스태프는 가입한 뒤 관리자가 배정한 공연에 참여합니다. 여러 기획사의 셀프 가입·결제 서비스는 현재 제공 범위가 아닙니다." },
    { question: "AI가 대본의 모든 시간을 자동으로 확정하나요?", answer: "아닙니다. 원문에 적힌 시간표시를 우선 보존하며, 시간이 없는 대사와 큐는 자동·추정 배치로 구분합니다. 분석 결과를 검토하고 시작 시간과 길이를 직접 수정할 수 있습니다." },
    { question: "모바일에서도 사용할 수 있나요?", answer: "내 공연, 일정, 대본 확인과 개인 연습 화면을 모바일에서도 이용하도록 구성했습니다. 복잡한 큐시트 제작은 PC 사용을 권장합니다. 영상·음원 재생은 브라우저 권한과 지원 형식에 따라 실제 기기 확인이 필요합니다." },
    { question: "전체화면 출력은 관객용 공개 링크인가요?", answer: "현재 전체화면 출력은 로그인한 기기의 대사·가사와 배경 표시입니다. 외부 관객용 공개 링크나 여러 기기의 동시 제어 기능과는 다릅니다. 실제 관객 자막 활용 전에는 내용과 출력 환경을 별도로 점검해야 합니다." }
  ];
</script>

<svelte:head>
  <title>아트브릿지 — 대본부터 리허설까지, 리딩뮤지컬 공연 관리</title>
  <meta name="description" content="리딩뮤지컬 공연 준비를 한곳에서. 아트브릿지에서 공연·회원·캐스팅을 관리하고 대본, 타임라인, 공동 일정, 개인 연습까지 연결하세요." />
  <meta property="og:title" content="아트브릿지 — 대본의 첫 줄부터, 무대의 마지막 큐까지" />
  <meta property="og:description" content="공연과 사람, 일정과 대본, 리허설의 흐름을 연결하는 리딩뮤지컬 워크스페이스." />
</svelte:head>

<div class="bg-background text-foreground min-h-dvh">
  <a href="#main-content" class="bg-background focus:ring-ring sr-only rounded-lg p-3 focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:ring-2">본문으로 바로가기</a>
  <header class="bg-background/95 sticky top-0 z-30 border-b backdrop-blur-md">
    <div class="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-4 sm:px-8">
      <a href="/" class="flex shrink-0 items-center gap-2.5 font-semibold tracking-tight" aria-label="아트브릿지 홈"><span class="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-xl"><AudioLines size={20} aria-hidden="true" /></span><span>아트브릿지</span></a>
      <nav class="text-muted-foreground hidden items-center gap-7 text-sm md:flex" aria-label="서비스 소개"><a class="hover:text-foreground" href="#features">주요 기능</a><a class="hover:text-foreground" href="#workflow">이용 흐름</a><a class="hover:text-foreground" href="#inquiry">공연 문의</a></nav>
      <Button href="/login" size="sm" variant="outline" class="rounded-full">로그인 <ArrowRight size={14} aria-hidden="true" /></Button>
    </div>
  </header>

  <main id="main-content">
    <section class="mx-auto max-w-6xl px-5 pb-12 pt-16 text-center sm:px-8 sm:pb-16 sm:pt-24" aria-labelledby="hero-title">
      <p class="text-primary bg-primary/5 border-primary/15 mx-auto inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium"><span class="bg-primary size-1.5 rounded-full" aria-hidden="true"></span>리딩뮤지컬 팀을 위한 워크스페이스</p>
      <h1 id="hero-title" class="mx-auto mt-7 max-w-4xl text-balance text-4xl font-semibold leading-[1.2] tracking-tight sm:text-6xl lg:text-7xl">대본의 첫 줄부터,<br /><span class="text-primary">무대의 마지막 큐까지.</span></h1>
      <p class="text-muted-foreground mx-auto mt-6 max-w-2xl text-pretty text-base leading-8 sm:text-lg">공연과 사람, 일정과 대본을 한곳에서.<br class="hidden sm:block" />함께 준비하는 흐름을 연결하고, 각자의 자리에서 리허설을 이어가세요.</p>
      <div class="mt-8 flex flex-col items-stretch justify-center gap-3 min-[380px]:flex-row"><Button href="/login" size="lg" class="rounded-full px-7">내 공연 열기 <ArrowRight size={17} aria-hidden="true" /></Button><Button href="#preview" variant="outline" size="lg" class="rounded-full px-7">기능 먼저 둘러보기</Button></div>
      <p class="text-muted-foreground mt-5 text-xs leading-relaxed">관리자는 공연을 만들고, 배우와 스태프는 배정된 공연에서 함께합니다.</p>
    </section>

    <section id="preview" class="mx-auto max-w-5xl scroll-mt-24 px-5 sm:px-8" aria-labelledby="preview-title">
      <div class="mb-4 flex flex-wrap items-center justify-between gap-2 px-1"><h2 id="preview-title" class="text-sm font-medium">복잡한 준비가 하나의 흐름으로.</h2><span class="text-muted-foreground text-xs">버튼을 눌러 예시 화면을 살펴보세요</span></div>
      <ProductPreview />
      <div class="text-muted-foreground mt-7 flex flex-wrap justify-center gap-x-6 gap-y-3 text-xs sm:text-sm"><span class="flex items-center gap-1.5"><Check size={14} aria-hidden="true" />공연별 역할과 권한</span><span class="flex items-center gap-1.5"><Check size={14} aria-hidden="true" />수정 가능한 시간표</span><span class="flex items-center gap-1.5"><Check size={14} aria-hidden="true" />모바일 일정 확인</span></div>
    </section>

    <section id="features" class="mx-auto max-w-6xl scroll-mt-20 px-5 py-20 sm:px-8 sm:py-28" aria-labelledby="features-title">
      <p class="text-primary text-xs font-semibold tracking-widest">함께 준비하는 도구</p><h2 id="features-title" class="mt-3 max-w-2xl text-balance text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">흩어져 있던 준비를,<br />하나의 공연 안으로.</h2><p class="text-muted-foreground mt-4 max-w-xl text-sm leading-7 sm:text-base">대본 파일을 찾고, 변경된 일정을 다시 묻고, 내 큐를 확인하던 순간들. 팀이 같은 맥락을 보며 준비하도록 연결합니다.</p>
      <div class="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {#each features as feature (feature.title)}<article class="bg-card rounded-2xl border p-6 sm:p-7"><div class="bg-primary/8 text-primary flex size-10 items-center justify-center rounded-xl"><feature.icon size={21} strokeWidth={1.6} aria-hidden="true" /></div><h3 class="mt-5 text-base font-semibold">{feature.title}</h3><p class="text-muted-foreground mt-3 text-sm leading-7">{feature.text}</p><p class="text-muted-foreground mt-5 border-t pt-4 text-xs">{feature.tag}</p></article>{/each}
      </div>
    </section>

    <section id="workflow" class="bg-muted/35 scroll-mt-20 border-y" aria-labelledby="workflow-title">
      <div class="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-20"><p class="text-primary text-xs font-semibold tracking-widest">이렇게 이어집니다</p><h2 id="workflow-title" class="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">준비부터 리허설까지, 네 걸음.</h2><div class="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">{#each workflow as step (step.number)}<article><span class="text-primary/60 font-mono text-3xl font-medium">{step.number}</span><div class="bg-border my-5 h-px"></div><h3 class="text-base font-semibold">{step.title}</h3><p class="text-muted-foreground mt-3 text-sm leading-7">{step.text}</p></article>{/each}</div></div>
    </section>

    <section class="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24" aria-labelledby="roles-title">
      <div class="max-w-2xl"><p class="text-primary text-xs font-semibold tracking-widest">한 팀, 각자의 자리</p><h2 id="roles-title" class="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">같은 공연을 보되,<br />필요한 일에 집중하도록.</h2></div>
      <div class="mt-9 grid gap-4 md:grid-cols-3">{#each roles as role (role.name)}<article class="rounded-2xl border p-6 sm:p-7"><p class="text-muted-foreground text-xs">{role.eyebrow}</p><h3 class="mt-3 text-xl font-semibold">{role.name}</h3><p class="text-muted-foreground mt-2 text-sm leading-6">{role.description}</p><ul class="mt-6 space-y-3">{#each role.items as item (item)}<li class="flex items-start gap-2 text-sm leading-6"><Check size={15} class="text-primary mt-1 shrink-0" aria-hidden="true" />{item}</li>{/each}</ul></article>{/each}</div>
    </section>

    <section class="mx-auto max-w-3xl px-5 pb-20 sm:px-8" aria-labelledby="faq-title"><h2 id="faq-title" class="text-2xl font-semibold tracking-tight sm:text-3xl">시작하기 전에 궁금한 것들</h2><div class="mt-6 divide-y rounded-2xl border px-5 sm:px-6">{#each questions as item (item.question)}<details class="group py-5"><summary class="flex cursor-pointer list-none items-start justify-between gap-4 text-sm font-medium leading-6 [&::-webkit-details-marker]:hidden">{item.question}<ChevronDown size={16} class="text-muted-foreground mt-1 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" /></summary><p class="text-muted-foreground mt-4 text-sm leading-7">{item.answer}</p></details>{/each}</div></section>

    <section class="bg-primary/5 border-y"><div class="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-5 py-12 sm:flex-row sm:items-center sm:px-8"><div><h2 class="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">다음 리허설엔, 같은 시간표로.</h2><p class="text-muted-foreground mt-3 text-sm leading-7">내 공연을 열고 오늘 함께 준비할 내용을 확인하세요.</p></div><Button href="/login" size="lg" class="shrink-0 rounded-full px-7">참여자 로그인 <ArrowRight size={17} aria-hidden="true" /></Button></div></section>

    <section id="inquiry" class="mx-auto grid max-w-6xl scroll-mt-20 gap-8 px-5 py-20 sm:px-8 sm:py-24 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16" aria-labelledby="inquiry-title"><div><p class="text-primary text-xs font-semibold tracking-widest">공연과 프로젝트 상담</p><h2 id="inquiry-title" class="mt-3 text-3xl font-semibold tracking-tight">공연 신청 · 문의</h2><p class="text-muted-foreground mt-5 max-w-sm text-sm leading-7">준비 중인 공연이나 함께하고 싶은 프로젝트가 있나요? 기관·단체의 공연 의뢰와 운영 관련 궁금한 점을 남겨주세요.</p><p class="text-muted-foreground mt-5 max-w-sm text-sm leading-7">로그인 없이 신청할 수 있습니다. 담당자가 확인 후 연락드립니다.</p><div class="mt-7 rounded-xl border p-4"><p class="text-sm font-medium">이미 공연에 참여하고 계신가요?</p><p class="text-muted-foreground mt-2 text-xs leading-6">일정과 대본은 로그인 후 배정된 공연에서 확인하세요.</p><a href="/login" class="text-primary mt-3 inline-flex items-center gap-1 text-sm font-medium">로그인으로 이동 <ArrowRight size={14} aria-hidden="true" /></a></div></div><div class="bg-card rounded-2xl border p-5 sm:p-7"><InquiryForm /></div></section>
  </main>

  <footer class="border-t"><div class="text-muted-foreground mx-auto flex max-w-6xl flex-col gap-4 px-5 py-7 text-xs sm:flex-row sm:items-center sm:justify-between sm:px-8"><div><span class="text-foreground font-semibold">아트브릿지</span><span class="ml-3">리딩뮤지컬 공연 준비·관리 워크스페이스</span></div><div class="flex gap-5"><a class="hover:text-foreground" href="#features">서비스 소개</a><a class="hover:text-foreground" href="#inquiry">공연 문의</a><a class="hover:text-foreground" href="/login">로그인</a></div></div></footer>
</div>
