<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { onMount } from "svelte";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { PageHeader } from "$lib/components/ui/page-header";
  import { EmptyState } from "$lib/components/ui/empty-state";
  import { ErrorPanel } from "$lib/components/ui/error-panel";
  import { LoadingBlock } from "$lib/components/ui/loading-block";
  import { apiRequest } from "$lib/api/client";
  import { peek, remember } from "$lib/api/swr";
  import { captureSession, isCurrentSession } from "$lib/api/session";
  import { actionLabel, ENTITY_LABELS } from "$lib/domain/activity";
  import { formatDateTime } from "$lib/domain/labels";

  type Log = {
    id: string; action: string; entity: string; entityId: string; reason: string | null; createdAt: string;
    actor: { id: string; name: string; email: string } | null; production: { id: string; title: string } | null;
    beforeJson: unknown; afterJson: unknown;
  };
  type Result = { total: number; skip: number; take: number; items: Log[]; actions: Array<{ action: string; count: number }>; productions: Array<{ id: string; title: string }> };

  // 검색 조건은 주소에 담아 둔다 — 새로고침·뒤로 가기·링크 공유에도 같은 목록이 나온다.
  const params = $derived($page.url.searchParams);
  const q = $derived(params.get("q") ?? "");
  const action = $derived(params.get("action") ?? "");
  const production = $derived(params.get("production") ?? "");
  const from = $derived(params.get("from") ?? "");
  const to = $derived(params.get("to") ?? "");
  const size = $derived([20, 50, 100].includes(Number(params.get("size"))) ? Number(params.get("size")) : 30);
  const current = $derived(Math.max(1, Number(params.get("page")) || 1));

  let result = $state<Result | null>(peek<Result>("admin:activity:facets") ?? null);
  let loading = $state(true);
  let error = $state("");
  let openId = $state<string | null>(null);
  let queryInput = $state("");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let seq = 0;

  const key = $derived(JSON.stringify([q, action, production, from, to, size, current]));
  $effect(() => { void key; void load(); });
  $effect(() => { queryInput = q; });

  async function load() {
    const mine = ++seq;
    const session = captureSession();
    const active = () => mine === seq && isCurrentSession(session);
    loading = true; error = "";
    try {
      const query = new URLSearchParams({ take: String(size), skip: String((current - 1) * size) });
      if (q) query.set("q", q);
      if (action) query.set("action", action);
      if (production) query.set("productionId", production);
      if (from) query.set("from", from);
      if (to) query.set("to", to);
      const next = await apiRequest<Result>(`/admin/activity-logs/search?${query}`);
      if (!active()) return;
      result = next;
      remember("admin:activity:facets", { ...next, items: [] }, session);
    } catch (cause) { if (active()) error = cause instanceof Error ? cause.message : "활동 기록을 불러오지 못했어요."; }
    finally { if (active()) loading = false; }
  }

  function setParams(changes: Record<string, string | number | null>, resetPage = true) {
    const next = new URLSearchParams($page.url.searchParams);
    for (const [name, value] of Object.entries(changes)) {
      if (value === null || value === "" || (name === "page" && value === 1)) next.delete(name); else next.set(name, String(value));
    }
    if (resetPage && !("page" in changes)) next.delete("page");
    void goto(`?${next}`, { replaceState: true, keepFocus: true, noScroll: true });
  }
  function onQuery(value: string) {
    queryInput = value;
    clearTimeout(timer);
    timer = setTimeout(() => setParams({ q: value.trim() }), 350);
  }
  onMount(() => () => clearTimeout(timer));

  const total = $derived(result?.total ?? 0);
  const pages = $derived(Math.max(1, Math.ceil(total / size)));
  const firstShown = $derived(total ? (current - 1) * size + 1 : 0);
  const lastShown = $derived(Math.min(total, current * size));
  const pageButtons = $derived.by(() => {
    const set = new Set([1, pages, current, current - 1, current + 1, current - 2, current + 2].filter((n) => n >= 1 && n <= pages));
    const sorted = [...set].sort((a, b) => a - b);
    const out: Array<number | "…"> = [];
    for (const n of sorted) { if (out.length && typeof out.at(-1) === "number" && n - (out.at(-1) as number) > 1) out.push("…"); out.push(n); }
    return out;
  });
  const hasFilter = $derived(Boolean(q || action || production || from || to));
  const reset = () => { clearTimeout(timer); void goto("?", { replaceState: true, keepFocus: true, noScroll: true }); };
  const selectClass = "bg-background h-11 min-w-0 rounded-md border px-2.5 text-sm";
</script>

<svelte:head><title>활동 기록 — 운영 콘솔</title></svelte:head>
<div class="mx-auto w-full min-w-0 max-w-6xl space-y-5">
  <PageHeader title="활동 기록" description="누가 언제 무엇을 바꿨는지 최근 순으로 확인해요. 회원 정보 수정, 공연 삭제, 초대 기록을 찾을 수 있어요." />

  <form class="bg-card grid gap-3 rounded-xl border p-3 sm:p-4 md:grid-cols-[minmax(0,1.4fr)_repeat(2,minmax(0,1fr))]" role="search" aria-label="활동 기록 검색" onsubmit={(event) => { event.preventDefault(); clearTimeout(timer); setParams({ q: queryInput.trim() }); }}>
    <label class="grid min-w-0 gap-1 text-sm font-medium md:col-span-1">검색어
      <Input class="min-h-11" value={queryInput} oninput={(event) => onQuery(event.currentTarget.value)} placeholder="이름·이메일·이유·대상 번호" aria-label="검색어" />
    </label>
    <label class="grid min-w-0 gap-1 text-sm font-medium">동작
      <select class={selectClass + " w-full"} value={action} onchange={(event) => setParams({ action: event.currentTarget.value })}>
        <option value="">전체 동작</option>
        {#each result?.actions ?? [] as item (item.action)}<option value={item.action}>{actionLabel(item.action)} · {item.count}</option>{/each}
      </select>
    </label>
    <label class="grid min-w-0 gap-1 text-sm font-medium">공연
      <select class={selectClass + " w-full"} value={production} onchange={(event) => setParams({ production: event.currentTarget.value })}>
        <option value="">전체 공연</option>
        {#each result?.productions ?? [] as item (item.id)}<option value={item.id}>{item.title}</option>{/each}
      </select>
    </label>
    <div class="grid grid-cols-2 gap-3 md:col-span-2">
      <label class="grid min-w-0 gap-1 text-sm font-medium">시작일<input type="date" class={selectClass + " w-full"} value={from} max={to || undefined} onchange={(event) => setParams({ from: event.currentTarget.value })} /></label>
      <label class="grid min-w-0 gap-1 text-sm font-medium">종료일<input type="date" class={selectClass + " w-full"} value={to} min={from || undefined} onchange={(event) => setParams({ to: event.currentTarget.value })} /></label>
    </div>
    <div class="flex items-end gap-2">
      <Button type="submit" size="touch" class="flex-1">검색</Button>
      <Button type="button" size="touch" variant="ghost" disabled={!hasFilter} onclick={reset}>조건 지우기</Button>
    </div>
  </form>

  <div class="flex flex-wrap items-center justify-between gap-2 text-sm" aria-live="polite">
    <p class="text-muted-foreground">{#if loading}활동 기록을 불러오는 중이에요…{:else if error}{result?.items.length ? "아래는 이전에 불러온 기록이에요." : "기록을 불러오지 못했어요."}{:else if result}{total ? `총 ${total.toLocaleString()}건 중 ${firstShown.toLocaleString()}–${lastShown.toLocaleString()}번째` : "조건에 맞는 기록이 없어요"}{/if}</p>
    <label class="text-muted-foreground flex items-center gap-2 text-sm">한 번에
      <select class={selectClass} value={size} onchange={(event) => setParams({ size: event.currentTarget.value })}>{#each [20, 30, 50, 100] as n (n)}<option value={n}>{n}개</option>{/each}</select>
    </label>
  </div>

  {#if error}<ErrorPanel class="[overflow-wrap:anywhere]" title="활동 기록을 불러오지 못했어요" message={error} onRetry={load} />{/if}

  {#if result?.items.length}
    <div class={["bg-card overflow-hidden rounded-xl border transition-opacity", loading && "opacity-60"]} aria-busy={loading}>
      <table class="hidden w-full table-fixed text-sm md:table">
        <thead class="bg-muted/50 text-muted-foreground text-left text-xs"><tr><th class="w-44 px-4 py-2.5 font-medium">시각</th><th class="w-44 px-4 py-2.5 font-medium">누가</th><th class="px-4 py-2.5 font-medium">무엇을</th><th class="w-52 px-4 py-2.5 font-medium">공연</th></tr></thead>
        <tbody class="divide-y">
          {#each result.items as log (log.id)}
            <tr class="hover:bg-muted/30 align-top">
              <td class="text-muted-foreground px-4 py-3 text-xs tabular-nums">{formatDateTime(log.createdAt)}</td>
              <td class="px-4 py-3 [overflow-wrap:anywhere]"><span class="font-medium">{log.actor?.name ?? "알 수 없음"}</span></td>
              <td class="px-4 py-3 [overflow-wrap:anywhere]"><button type="button" class="focus-visible:ring-ring min-h-11 w-full rounded-md text-start hover:underline focus-visible:ring-2 focus-visible:outline-none" aria-expanded={openId === log.id} onclick={() => (openId = openId === log.id ? null : log.id)}><span class="text-muted-foreground text-xs">{ENTITY_LABELS[log.entity] ?? log.entity} · </span>{actionLabel(log.action)}</button>{#if log.reason}<span class="text-muted-foreground block text-sm leading-6">{log.reason}</span>{/if}
                {#if openId === log.id}{@render detail(log)}{/if}</td>
              <td class="text-muted-foreground px-4 py-3 text-sm [overflow-wrap:anywhere]">{log.production?.title ?? "—"}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      <ul class="divide-y md:hidden">
        {#each result.items as log (log.id)}
          <li class="p-3.5">
            <button type="button" class="focus-visible:ring-ring min-h-11 w-full rounded-md text-start focus-visible:ring-2 focus-visible:outline-none" aria-expanded={openId === log.id} onclick={() => (openId = openId === log.id ? null : log.id)}>
              <p class="text-muted-foreground flex justify-between gap-2 text-xs"><span class="shrink-0 tabular-nums">{formatDateTime(log.createdAt)}</span><span class="min-w-0 text-right [overflow-wrap:anywhere]">{log.production?.title ?? ""}</span></p>
              <p class="mt-1 text-sm leading-6 [overflow-wrap:anywhere]"><strong>{log.actor?.name ?? "알 수 없음"}</strong> · {ENTITY_LABELS[log.entity] ?? log.entity} — {actionLabel(log.action)}</p>
            </button>
            {#if openId === log.id}{@render detail(log)}{/if}
          </li>
        {/each}
      </ul>
    </div>

    {#if pages > 1}
      <nav class="flex flex-wrap items-center justify-center gap-1.5" aria-label="페이지 이동">
        <Button variant="outline" size="touch" disabled={current <= 1} onclick={() => setParams({ page: current - 1 }, false)}>이전</Button>
        {#each pageButtons as item, index (index)}
          {#if item === "…"}<span class="text-muted-foreground px-1">…</span>
          {:else}<Button variant={item === current ? "default" : "ghost"} size="touch" class="min-w-11 tabular-nums" aria-current={item === current ? "page" : undefined} onclick={() => setParams({ page: item }, false)}>{item}</Button>{/if}
        {/each}
        <Button variant="outline" size="touch" disabled={current >= pages} onclick={() => setParams({ page: current + 1 }, false)}>다음</Button>
      </nav>
    {/if}
  {:else if loading}
    <LoadingBlock class="bg-card rounded-xl border p-6" lines={6} />
  {:else if result && !error}
    <EmptyState title={hasFilter ? "조건에 맞는 기록이 없어요" : "아직 활동 기록이 없어요"} description={hasFilter ? "검색어나 기간을 바꿔 다시 찾아 주세요." : "회원 정보나 공연을 변경하면 여기에서 확인할 수 있어요."}>
      {#snippet action()}{#if hasFilter}<Button size="touch" variant="outline" onclick={reset}>조건 지우기</Button>{/if}{/snippet}
    </EmptyState>
  {/if}
</div>

{#snippet detail(log: Log)}
  <div class="bg-muted/40 mt-2 min-w-0 space-y-1.5 rounded-lg p-3 text-xs leading-5">
    <p class="text-muted-foreground break-all">동작 <code>{log.action}</code> · 대상 {ENTITY_LABELS[log.entity] ?? log.entity} <code>{log.entityId}</code>{log.actor ? ` · ${log.actor.email}` : ""}</p>
    {#if log.beforeJson}<pre class="whitespace-pre-wrap break-words [overflow-wrap:anywhere]"><strong>이전</strong> {JSON.stringify(log.beforeJson, null, 1)}</pre>{/if}
    {#if log.afterJson}<pre class="whitespace-pre-wrap break-words [overflow-wrap:anywhere]"><strong>이후</strong> {JSON.stringify(log.afterJson, null, 1)}</pre>{/if}
  </div>
{/snippet}
