<script lang="ts">
  import { onMount } from "svelte";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { apiRequest } from "$lib/api/client";
  import { INQUIRY_STATUS_LABELS, PHASE_LABELS, formatRelative } from "$lib/domain/labels";
  type Stats = { users: number; blockedUsers: number; profileIncompleteUsers: number; productions: number; publishedProductions: number; thisMonthEvents: number };
  type Inquiry = { id: string; orgName: string; contactName: string; status: string; message: string; createdAt: string };
  type Production = { id: string; title: string; currentPhase: string; venue?: string | null; archived?: boolean };
  let stats = $state<Stats | null>(null);
  let inquiries = $state<Inquiry[]>([]);
  let productions = $state<Production[]>([]);
  let newCount = $state(0);
  let loading = $state(true);
  let error = $state("");
  onMount(load);
  async function load() {
    loading = true; error = "";
    try {
      const [summary, inbox, shows] = await Promise.all([
        apiRequest<Stats>("/admin/stats"),
        apiRequest<{ items: Inquiry[]; counts: Partial<Record<string, number>> }>("/admin/inquiries?take=5"),
        apiRequest<Production[]>("/productions")
      ]);
      stats = summary; inquiries = inbox.items; newCount = inbox.counts.NEW ?? 0; productions = shows.filter((show) => !show.archived);
    } catch (cause) { error = cause instanceof Error ? cause.message : "운영 정보를 불러오지 못했습니다"; }
    finally { loading = false; }
  }
</script>

<svelte:head><title>공연 운영 — 아트브릿지</title></svelte:head>
<div class="mx-auto w-full min-w-0 max-w-6xl space-y-5">
  <header class="flex flex-wrap items-end justify-between gap-4 rounded-2xl border bg-card p-5 sm:p-7">
    <div><p class="text-primary text-xs font-bold">운영 관리자</p><h1 class="mt-2 text-2xl font-bold sm:text-3xl">공연 준비를 한곳에서</h1><p class="text-muted-foreground mt-2 text-sm">회원 배정부터 일정, 대본, 리허설까지 공연별로 이어서 관리합니다.</p></div>
    <div class="flex flex-wrap gap-2"><Button href="/admin/productions" class="min-h-11">공연 관리</Button><Button href="/admin/members" variant="outline" class="min-h-11">회원 · 캐스팅 대상</Button></div>
  </header>
  <nav aria-label="운영 메뉴" class="grid grid-cols-2 gap-2 sm:grid-cols-4">
    {#each [{ href: '/admin/productions', title: '공연 만들기 · 관리', detail: '공연별 제작 워크스페이스' }, { href: '/admin/members', title: '회원 관리', detail: '배우 · 스태프 검색과 배정' }, { href: '/admin/inquiries', title: '신청 문의', detail: '문의 확인과 공연 전환' }, { href: '/app', title: '참여자 화면', detail: '내 작업과 연습 화면 확인' }] as item (item.href)}
      <a href={item.href} class="bg-card hover:bg-accent flex min-h-24 min-w-0 flex-col justify-center rounded-xl border p-4 transition-colors"><span class="break-words text-sm font-bold">{item.title}</span><span class="text-muted-foreground mt-1 text-xs">{item.detail}</span></a>
    {/each}
  </nav>
  {#if loading}<p class="bg-card rounded-2xl border p-8" role="status">공연 운영 현황을 불러오고 있습니다…</p>
  {:else if error}<section role="alert" class="bg-card rounded-2xl border p-5"><p>{error}</p><Button variant="outline" class="mt-3 min-h-11" onclick={load}>다시 불러오기</Button></section>
  {:else if stats}
    <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {#each [{ title: '전체 회원', value: stats.users, detail: `프로필 미완성 ${stats.profileIncompleteUsers}명`, href: '/admin/members' }, { title: '관리 공연', value: stats.productions, detail: `공개 ${stats.publishedProductions}편`, href: '/admin/productions' }, { title: '이번 달 일정', value: stats.thisMonthEvents, detail: '공연별 일정에서 확인', href: '/admin/productions' }, { title: '새 신청 문의', value: newCount, detail: '접수 상태 확인 필요', href: '/admin/inquiries' }] as item (item.title)}
        <a href={item.href} class="bg-card rounded-2xl border p-4"><p class="text-muted-foreground text-xs">{item.title}</p><p class="mt-2 text-3xl font-bold tabular-nums">{item.value}</p><p class="text-muted-foreground mt-2 text-xs">{item.detail}</p></a>
      {/each}
    </div>
    <section class="bg-card rounded-2xl border p-4 sm:p-5">
      <div class="flex items-center justify-between gap-2"><h2 class="font-bold">진행 중인 공연</h2><Button href="/admin/productions" variant="ghost">전체 보기</Button></div>
      <p class="text-muted-foreground mt-1 text-sm">공연을 선택하고 참여자 배정 → 일정 공유 → 대본 · 큐 준비 → 리허설 순서로 진행합니다.</p>
      <div class="mt-4 grid gap-3 md:grid-cols-2">
        {#each productions.slice(0, 6) as show (show.id)}
          <article class="min-w-0 rounded-xl border p-4"><div class="flex flex-wrap items-center gap-2"><a href={`/app/p/${show.id}`} class="min-w-0 break-words font-semibold hover:underline">{show.title}</a><Badge variant="secondary">{PHASE_LABELS[show.currentPhase] ?? show.currentPhase}</Badge></div>{#if show.venue}<p class="text-muted-foreground mt-1 text-xs">{show.venue}</p>{/if}<div class="mt-4 grid grid-cols-2 gap-2"><Button href={`/app/p/${show.id}/manage/members`} variant="outline" class="min-h-11">참여자 배정</Button><Button href={`/app/p/${show.id}/schedule`} variant="outline" class="min-h-11">공유 일정</Button><Button href={`/app/p/${show.id}/cuesheet`} variant="outline" class="min-h-11">대본 · 큐 제작</Button><Button href={`/app/p/${show.id}/live`} class="min-h-11">시간표 · 연습</Button></div></article>
        {:else}<p class="text-muted-foreground col-span-full py-6 text-center text-sm">아직 진행 중인 공연이 없습니다. 공연 관리에서 첫 공연을 등록해 주세요.</p>{/each}
      </div>
    </section>
    <section class="bg-card rounded-2xl border p-4 sm:p-5"><div class="flex items-center justify-between gap-2"><h2 class="font-bold">최근 신청 문의</h2><Button href="/admin/inquiries" variant="ghost">문의 관리</Button></div><div class="mt-2 divide-y">{#each inquiries as inquiry (inquiry.id)}<a href="/admin/inquiries" class="flex min-w-0 flex-wrap items-center gap-3 py-4"><Badge variant={inquiry.status === 'NEW' ? 'default' : 'secondary'}>{INQUIRY_STATUS_LABELS[inquiry.status] ?? inquiry.status}</Badge><div class="min-w-0 flex-1"><p class="break-words text-sm font-semibold">{inquiry.orgName} · {inquiry.contactName}</p><p class="text-muted-foreground mt-1 line-clamp-2 break-words text-xs">{inquiry.message}</p></div><span class="text-muted-foreground text-xs">{formatRelative(inquiry.createdAt)}</span></a>{:else}<p class="text-muted-foreground py-6 text-sm">접수된 문의가 없습니다.</p>{/each}</div></section>
  {/if}
</div>
