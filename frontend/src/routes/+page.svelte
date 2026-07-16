<script lang="ts">
  import { toast } from "svelte-sonner";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Textarea } from "$lib/components/ui/textarea";
  import * as Card from "$lib/components/ui/card";
  import { apiRequest } from "$lib/api/client";

  const formats = [
    {
      name: "기본형",
      spec: "공연 40–45분 + 토크 10–15분",
      description: "대표 레퍼토리 〈따뜻한 것들의 무게〉를 중심으로 가족, 관계, 위로를 다루는 정규 구성입니다."
    },
    {
      name: "단축형",
      spec: "공연 25–35분 + 토크 10분",
      description: "교내 행사, 사내 프로그램처럼 운영 시간이 짧은 현장에 맞춘 압축 구성입니다."
    },
    {
      name: "기관 맞춤형",
      spec: "주제·장르·러닝타임 별도 편성",
      description: "소통, 번아웃, 세대 공감 등 기관의 목적과 대상에 맞춰 곡과 이야기 구조를 새로 편성합니다."
    }
  ];

  let orgName = $state("");
  let contactName = $state("");
  let email = $state("");
  let phone = $state("");
  let preferredTiming = $state("");
  let audience = $state("");
  let message = $state("");
  let submitting = $state(false);

  async function submitInquiry(event: SubmitEvent) {
    event.preventDefault();
    submitting = true;
    try {
      await apiRequest("/inquiries", {
        method: "POST",
        body: JSON.stringify({
          orgName,
          contactName,
          email,
          phone: phone || undefined,
          preferredTiming: preferredTiming || undefined,
          audience: audience || undefined,
          message
        })
      });
      toast.success("신청이 접수되었습니다", {
        description: "담당자가 확인 후 남겨주신 이메일로 연락드리겠습니다."
      });
      orgName = contactName = email = phone = preferredTiming = audience = message = "";
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "신청을 접수하지 못했습니다");
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head>
  <title>아트브릿지 — 리딩뮤지컬 프로젝트 공연</title>
  <meta
    name="description"
    content="예술과 이야기, 짧은 대화를 결합한 맞춤형 리딩뮤지컬 공연. 기관·기업·복지·청소년 현장에 맞춰 제작합니다."
  />
</svelte:head>

<div class="relative min-h-dvh overflow-hidden">
  <div
    class="pointer-events-none absolute inset-x-0 top-0 h-[480px]"
    style="background: radial-gradient(ellipse 70% 60% at 50% -10%, color-mix(in oklab, var(--primary) 16%, transparent), transparent 70%);"
  ></div>

  <header class="relative mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5">
    <a href="/" class="flex items-center gap-2.5 font-semibold tracking-tight">
      <span class="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg text-sm">아</span>
      <span>
        아트브릿지
        <span class="text-muted-foreground ml-1.5 hidden text-xs font-normal sm:inline">리딩뮤지컬 프로젝트</span>
      </span>
    </a>
    <Button href="/login" variant="outline" size="sm">로그인</Button>
  </header>

  <main class="relative mx-auto w-full max-w-5xl px-6">
    <section class="py-16 text-center sm:py-24">
      <h1 class="mx-auto max-w-3xl text-balance text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
        예술을 더 가깝게, 마음을 더 깊게
      </h1>
      <p class="text-muted-foreground mx-auto mt-5 max-w-xl text-pretty text-base leading-relaxed sm:text-lg">
        리딩뮤지컬 음악공연과 공연 후 짧은 토크로 관객이 자신의 마음을 돌아보는 시간을 만듭니다.
        기관·기업·복지·상담·청소년 현장에 맞춘 맞춤형 공연을 제작합니다.
      </p>
      <div class="mt-8 flex items-center justify-center gap-3">
        <Button href="#inquiry" size="lg">공연 신청 · 문의</Button>
        <Button href="#formats" size="lg" variant="ghost">공연 소개</Button>
      </div>
    </section>

    <section id="formats" class="grid gap-4 pb-16 sm:grid-cols-3">
      {#each formats as format (format.name)}
        <Card.Root class="bg-card/60">
          <Card.Header>
            <Card.Title class="text-base">{format.name}</Card.Title>
            <Card.Description class="text-foreground/80 font-medium">{format.spec}</Card.Description>
          </Card.Header>
          <Card.Content>
            <p class="text-muted-foreground text-sm leading-relaxed">{format.description}</p>
          </Card.Content>
        </Card.Root>
      {/each}
    </section>

    <section class="pb-16">
      <div class="border-border/60 bg-card/40 rounded-2xl border px-6 py-10 text-center sm:px-12">
        <p class="text-muted-foreground text-sm leading-relaxed sm:text-base">
          공연은 한 장면, 한 목소리, 한 곡의 여운으로 관객에게 질문을 건넵니다.<br class="hidden sm:block" />
          그 질문은 정답을 요구하지 않고, 각자의 속도로 마음에 머물도록 열려 있습니다.
        </p>
      </div>
    </section>

    <section id="inquiry" class="mx-auto max-w-2xl pb-24">
      <Card.Root>
        <Card.Header>
          <Card.Title class="text-xl">공연 신청 · 문의</Card.Title>
          <Card.Description>로그인 없이 신청할 수 있습니다. 담당자가 확인 후 연락드립니다.</Card.Description>
        </Card.Header>
        <Card.Content>
          <form class="grid gap-4" onsubmit={submitInquiry}>
            <div class="grid gap-4 sm:grid-cols-2">
              <div class="grid gap-2">
                <Label for="orgName">기관·단체명 <span class="text-destructive">*</span></Label>
                <Input id="orgName" bind:value={orgName} required maxlength={120} placeholder="예: 서울○○복지관" />
              </div>
              <div class="grid gap-2">
                <Label for="contactName">담당자 성함 <span class="text-destructive">*</span></Label>
                <Input id="contactName" bind:value={contactName} required maxlength={60} />
              </div>
              <div class="grid gap-2">
                <Label for="email">이메일 <span class="text-destructive">*</span></Label>
                <Input id="email" type="email" bind:value={email} required maxlength={160} placeholder="name@example.org" />
              </div>
              <div class="grid gap-2">
                <Label for="phone">연락처</Label>
                <Input id="phone" bind:value={phone} maxlength={40} placeholder="010-0000-0000" />
              </div>
              <div class="grid gap-2">
                <Label for="preferredTiming">희망 시기</Label>
                <Input id="preferredTiming" bind:value={preferredTiming} maxlength={60} placeholder="예: 12월 중" />
              </div>
              <div class="grid gap-2">
                <Label for="audience">관람 대상</Label>
                <Input id="audience" bind:value={audience} maxlength={120} placeholder="예: 임직원 80명" />
              </div>
            </div>
            <div class="grid gap-2">
              <Label for="message">문의 내용 <span class="text-destructive">*</span></Label>
              <Textarea
                id="message"
                bind:value={message}
                required
                maxlength={2000}
                rows={5}
                placeholder="공연 목적, 공간 여건, 기대하시는 분위기 등을 알려주시면 맞춤 구성으로 제안드립니다"
              />
            </div>
            <div class="flex items-center justify-between gap-4">
              <p class="text-muted-foreground text-xs">남겨주신 정보는 공연 상담 목적으로만 사용합니다.</p>
              <Button type="submit" disabled={submitting}>
                {submitting ? "접수 중..." : "신청 보내기"}
              </Button>
            </div>
          </form>
        </Card.Content>
      </Card.Root>
    </section>
  </main>

  <footer class="border-border/60 border-t">
    <div class="text-muted-foreground mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6 text-xs">
      <span>아트브릿지 리딩뮤지컬 프로젝트</span>
      <a href="/login" class="hover:text-foreground transition-colors">참여자 로그인</a>
    </div>
  </footer>
</div>
