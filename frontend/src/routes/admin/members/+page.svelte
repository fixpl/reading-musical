<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { onMount } from "svelte";
  import { toast } from "svelte-sonner";
  import * as Dialog from "$lib/components/ui/dialog";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Textarea } from "$lib/components/ui/textarea";
  import { ErrorPanel } from "$lib/components/ui/error-panel";
  import { EmptyState } from "$lib/components/ui/empty-state";
  import { PageHeader } from "$lib/components/ui/page-header";
  import { apiRequest } from "$lib/api/client";
  import { peek, remember } from "$lib/api/swr";
  import { captureSession, isCurrentSession } from "$lib/api/session";
  import { PROFILE_TYPE_LABELS, USER_STATUS_LABELS, formatDate } from "$lib/domain/labels";

  type Member = {
    id: string;
    email: string;
    name: string;
    phone: string | null;
    profileType: string;
    profileComplete: boolean;
    status: string;
    platformRole: string;
    createdAt: string;
    memberships: Array<{
      id: string;
      primaryRole: string;
      production: { id: string; title: string };
    }>;
  };

  type Result = { total: number; skip: number; take: number; items: Member[]; counts: { all: number; unassigned: number; incomplete: number; blocked: number } };

  // 검색·필터·페이지는 주소에 담는다 — 새로고침이나 뒤로 가기, 링크 공유에도 같은 목록이 나온다.
  const params = $derived($page.url.searchParams);
  const q = $derived(params.get("q") ?? "");
  const type = $derived(params.get("type") ?? "");
  const view = $derived(params.get("view") ?? "all"); // all | unassigned | incomplete | blocked
  const size = $derived([20, 50, 100].includes(Number(params.get("size"))) ? Number(params.get("size")) : 30);
  const current = $derived(Math.max(1, Number(params.get("page")) || 1));

  let result = $state<Result | null>(peek<Result>("admin:members") ?? null);
  let loading = $state(true);
  let error = $state("");
  let queryInput = $state("");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let seq = 0;

  let statusTarget = $state<Member | null>(null);
  let statusReason = $state("");
  let statusSaving = $state(false);

  const key = $derived(JSON.stringify([q, type, view, size, current]));
  $effect(() => { void key; void load(); });
  $effect(() => { queryInput = q; });
  onMount(() => () => clearTimeout(timer));

  async function load() {
    const mine = ++seq;
    const session = captureSession();
    const active = () => mine === seq && isCurrentSession(session);
    loading = true; error = "";
    try {
      const query = new URLSearchParams({ take: String(size), skip: String((current - 1) * size) });
      if (q) query.set("q", q);
      if (type) query.set("profileType", type);
      if (view === "unassigned") { query.set("assigned", "no"); query.set("status", "ACTIVE"); }
      if (view === "incomplete") query.set("profileComplete", "false");
      if (view === "blocked") query.set("status", "BLOCKED");
      const next = await apiRequest<Result>(`/admin/members/search?${query}`);
      if (!active()) return;
      result = next;
      if (key === JSON.stringify(["", "", "all", 30, 1])) remember("admin:members", next, session);
    } catch (cause) { if (active()) error = cause instanceof Error ? cause.message : "회원 목록을 불러오지 못했어요."; }
    finally { if (active()) loading = false; }
  }

  function setParams(changes: Record<string, string | number | null>, resetPage = true) {
    const next = new URLSearchParams($page.url.searchParams);
    for (const [name, value] of Object.entries(changes)) {
      if (value === null || value === "" || (name === "page" && value === 1) || (name === "view" && value === "all")) next.delete(name); else next.set(name, String(value));
    }
    if (resetPage && !("page" in changes)) next.delete("page");
    void goto(`?${next}`, { replaceState: true, keepFocus: true, noScroll: true });
  }
  function onQuery(value: string) {
    queryInput = value;
    clearTimeout(timer);
    timer = setTimeout(() => setParams({ q: value.trim() }), 350);
  }

  const total = $derived(result?.total ?? 0);
  const pages = $derived(Math.max(1, Math.ceil(total / size)));
  const firstShown = $derived(total ? (current - 1) * size + 1 : 0);
  const lastShown = $derived(Math.min(total, current * size));
  const pageButtons = $derived.by(() => {
    const set = new Set([1, pages, current, current - 1, current + 1, current - 2, current + 2].filter((n) => n >= 1 && n <= pages));
    const out: Array<number | "…"> = [];
    for (const n of [...set].sort((a, b) => a - b)) { if (out.length && typeof out.at(-1) === "number" && n - (out.at(-1) as number) > 1) out.push("…"); out.push(n); }
    return out;
  });
  const tabs = $derived([
    { id: "all", label: "전체", count: result?.counts.all },
    { id: "unassigned", label: "배정 대기", count: result?.counts.unassigned, hint: "아직 어느 공연에도 배정되지 않은 회원" },
    { id: "incomplete", label: "프로필 미완성", count: result?.counts.incomplete },
    { id: "blocked", label: "차단", count: result?.counts.blocked }
  ]);

  function nextStatus(member: Member) {
    return member.status === "BLOCKED" ? "ACTIVE" : "BLOCKED";
  }

  async function changeStatus() {
    if (!statusTarget) return;
    statusSaving = true;
    try {
      await apiRequest(`/admin/users/${statusTarget.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus(statusTarget), reason: statusReason.trim() })
      });
      toast.success(nextStatus(statusTarget) === "BLOCKED" ? "계정을 차단했어요" : "계정을 복구했어요");
      statusTarget = null;
      statusReason = "";
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "상태를 변경하지 못했어요");
    } finally {
      statusSaving = false;
    }
  }
  const selectClass = "bg-background min-h-11 min-w-0 rounded-md border px-2.5 text-sm";
</script>

<svelte:head><title>회원 · 매칭 — 운영 콘솔</title></svelte:head>
<div class="mx-auto w-full max-w-6xl space-y-5">
  <PageHeader title="회원·공연 배정" description="회원의 프로필과 일정을 확인해요. 배정은 공연별 멤버 관리에서 할 수 있어요.">
    {#snippet actions()}<Button href="/admin/productions" variant="outline" size="touch">공연 선택</Button>{/snippet}
  </PageHeader>

  <div class="flex flex-wrap gap-1.5" role="tablist" aria-label="회원 보기">
    {#each tabs as tab (tab.id)}
      <button type="button" role="tab" aria-selected={view === tab.id} title={tab.hint} class={["min-h-11 rounded-full border px-4 text-sm transition-colors", view === tab.id ? "bg-foreground text-background border-transparent font-semibold" : "hover:bg-muted"]} onclick={() => setParams({ view: tab.id })}>
        {tab.label}{#if tab.count !== undefined}<span class={["ms-1.5 tabular-nums", view === tab.id ? "opacity-80" : "text-muted-foreground"]}>{tab.count.toLocaleString()}</span>{/if}
      </button>
    {/each}
  </div>

  <form class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem_auto]" role="search" onsubmit={(event) => { event.preventDefault(); clearTimeout(timer); setParams({ q: queryInput.trim() }); }}>
    <Input value={queryInput} oninput={(event) => onQuery(event.currentTarget.value)} placeholder="이름·이메일·연락처로 찾기" aria-label="회원 검색" class="min-h-11" />
    <select class={selectClass} value={type} aria-label="직군" onchange={(event) => setParams({ type: event.currentTarget.value })}>
      <option value="">모든 직군</option>
      {#each Object.entries(PROFILE_TYPE_LABELS) as [value, label] (value)}<option {value}>{label}</option>{/each}
    </select>
    <Button type="submit" class="min-h-11">검색</Button>
  </form>

  <div class="flex flex-wrap items-center justify-between gap-2 text-sm" aria-live="polite">
    <p class="text-muted-foreground">{#if result}{total ? `총 ${total.toLocaleString()}명 중 ${firstShown.toLocaleString()}–${lastShown.toLocaleString()}번째` : "조건에 맞는 회원이 없어요"}{#if loading} · 불러오는 중…{/if}{:else}불러오는 중…{/if}</p>
    <label class="text-muted-foreground flex items-center gap-2 text-xs">한 번에
      <select class={selectClass + " min-h-11"} value={size} onchange={(event) => setParams({ size: event.currentTarget.value })}>{#each [20, 30, 50, 100] as n (n)}<option value={n}>{n}명</option>{/each}</select>
    </label>
  </div>
  {#if error}<ErrorPanel title="회원 목록을 불러오지 못했어요" message={error} onRetry={load} />{/if}

  {#if result?.items.length}
    <div class={["bg-card overflow-hidden rounded-xl border transition-opacity", loading && "opacity-60"]}>
      <table class="w-full text-sm">
        <thead class="bg-muted/50 text-muted-foreground text-left text-xs">
          <tr><th class="px-4 py-2.5 font-medium">이름</th><th class="hidden px-4 py-2.5 font-medium md:table-cell">직군</th><th class="hidden px-4 py-2.5 font-medium lg:table-cell">참여 공연</th><th class="hidden px-4 py-2.5 font-medium sm:table-cell">프로필</th><th class="hidden px-4 py-2.5 font-medium sm:table-cell">상태</th><th class="hidden px-4 py-2.5 font-medium sm:table-cell">가입일</th><th class="px-4 py-2.5 font-medium"><span class="sr-only">계정 관리</span></th></tr>
        </thead>
        <tbody class="divide-y">
          {#each result.items as member (member.id)}
            <tr class="hover:bg-muted/30">
              <td class="px-4 py-3">
                <p class="font-medium"><a href={`/admin/members/${member.id}`} class="inline-flex min-h-11 items-center hover:underline">{member.name}</a>{#if member.platformRole !== "MEMBER"}<Badge variant="outline" class="ms-1.5">운영자</Badge>{/if}</p>
                <p class="text-muted-foreground max-w-[12rem] break-all text-xs">{member.email}</p>
                <p class="text-muted-foreground mt-1 text-xs md:hidden">{PROFILE_TYPE_LABELS[member.profileType] ?? member.profileType}</p>
                <div class="mt-1 flex flex-wrap gap-1 sm:hidden"><Badge variant="outline">프로필 {member.profileComplete ? "완성" : "미완성"}</Badge><Badge variant={member.status === "BLOCKED" ? "destructive" : "secondary"}>{USER_STATUS_LABELS[member.status] ?? member.status}</Badge></div>
              </td>
              <td class="hidden px-4 py-3 md:table-cell">{PROFILE_TYPE_LABELS[member.profileType] ?? member.profileType}</td>
              <td class="text-muted-foreground hidden px-4 py-3 text-xs lg:table-cell">
                {#if member.memberships.length === 0}<span class="rounded bg-amber-500/15 px-1.5 py-0.5 font-medium text-amber-700 dark:text-amber-300">배정 대기</span>
                {:else}<span class="block max-w-[320px] truncate">{member.memberships.map((m) => m.production.title).join(", ")}</span><span class="text-[11px]">{member.memberships.length}개 공연</span>{/if}
              </td>
              <td class="hidden px-4 py-3 sm:table-cell"><Badge variant={member.profileComplete ? "secondary" : "outline"}>{member.profileComplete ? "완성" : "미완성"}</Badge></td>
              <td class="hidden px-4 py-3 sm:table-cell"><Badge variant={member.status === "BLOCKED" ? "destructive" : "secondary"}>{USER_STATUS_LABELS[member.status] ?? member.status}</Badge></td>
              <td class="text-muted-foreground hidden px-4 py-3 text-xs sm:table-cell">{formatDate(member.createdAt)}</td>
              <td class="px-4 py-3 text-right">
                {#if member.platformRole === "MEMBER"}
                  <Button variant="ghost" size="touch" onclick={(event) => { event.stopPropagation(); statusTarget = member; statusReason = ""; }}>{member.status === "BLOCKED" ? "복구" : "차단"}</Button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if pages > 1}
      <nav class="flex flex-wrap items-center justify-center gap-1.5" aria-label="페이지 이동">
        <Button variant="outline" size="touch" class="min-h-11" disabled={current <= 1} onclick={() => setParams({ page: current - 1 }, false)}>이전</Button>
        {#each pageButtons as item, index (index)}
          {#if item === "…"}<span class="text-muted-foreground px-1">…</span>
          {:else}<Button variant={item === current ? "default" : "ghost"} size="touch" class="min-h-11 min-w-11 tabular-nums" aria-current={item === current ? "page" : undefined} onclick={() => setParams({ page: item }, false)}>{item}</Button>{/if}
        {/each}
        <Button variant="outline" size="touch" class="min-h-11" disabled={current >= pages} onclick={() => setParams({ page: current + 1 }, false)}>다음</Button>
      </nav>
    {/if}
  {:else if result && !loading && !error}
    <EmptyState title="조건에 맞는 회원이 없어요" description="검색어나 직군을 바꿔 다시 찾아 주세요.">
      {#snippet action()}{#if q || type || view !== "all"}<Button variant="outline" size="touch" onclick={() => goto("?", { replaceState: true, noScroll: true })}>조건 지우기</Button>{/if}{/snippet}
    </EmptyState>
  {:else if !result && !error}
    <div class="bg-card space-y-px overflow-hidden rounded-xl border" aria-hidden="true">{#each Array(6) as _, index (index)}<div class="bg-muted/30 h-14 animate-pulse"></div>{/each}</div>
  {/if}
</div>

<Dialog.Root open={statusTarget !== null} onOpenChange={(open) => !open && (statusTarget = null)}>
  <Dialog.Content class="sm:max-w-md">
    {#if statusTarget}
      <Dialog.Header>
        <Dialog.Title>
          {statusTarget.name} 계정 {nextStatus(statusTarget) === "BLOCKED" ? "차단" : "복구"}
        </Dialog.Title>
        <Dialog.Description>운영 기록에 남길 사유를 입력해 주세요.</Dialog.Description>
      </Dialog.Header>
      <div class="grid gap-2">
        <Label for="statusReason">사유</Label>
        <Textarea id="statusReason" bind:value={statusReason} rows={3} placeholder="예: 본인 요청으로 계정 정지" />
      </div>
      <Dialog.Footer>
        <Button size="touch" variant="ghost" onclick={() => (statusTarget = null)}>취소</Button>
        <Button
          size="touch"
          variant={nextStatus(statusTarget) === "BLOCKED" ? "destructive" : "default"}
          onclick={changeStatus}
          disabled={statusSaving || !statusReason.trim()}
        >
          {statusSaving ? "처리 중..." : nextStatus(statusTarget) === "BLOCKED" ? "차단" : "복구"}
        </Button>
      </Dialog.Footer>
    {/if}
  </Dialog.Content>
</Dialog.Root>
