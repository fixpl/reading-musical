<script lang="ts">
  import { onMount, onDestroy, tick } from "svelte";
  import AdminSiteNav from "$lib/components/admin/AdminSiteNav.svelte";
  import ConfirmAction from "$lib/components/admin/ConfirmAction.svelte";
  import * as Select from "$lib/components/ui/select";
  import { Label } from "$lib/components/ui/label";
  import { beforeNavigate } from "$app/navigation";
  import { apiRequest } from "$lib/api/client";
  import { SUPPORT_CATEGORIES, SUPPORT_STATUSES, koreanDate, type SupportTicket } from "$lib/api/site";
  import { Button } from "$lib/components/ui/button";
  import { Textarea } from "$lib/components/ui/textarea";
  import { PageHeader } from "$lib/components/ui/page-header";
  import { ErrorPanel } from "$lib/components/ui/error-panel";
  import { EmptyState } from "$lib/components/ui/empty-state";
  import { Skeleton } from "$lib/components/ui/skeleton";
  let items = $state<SupportTicket[]>([]);
  let total = $state(0);
  let page = $state(1);
  let filter = $state("");
  let selected = $state<SupportTicket | null>(null);
  let answer = $state("");
  let internalNote = $state("");
  let status = $state("OPEN");
  let busy = $state(false);
  let loading = $state(true);
  let feedback = $state("");
  let listError = $state("");
  let detailError = $state("");
  let requestedId = $state("");
  let saveFailed = $state(false);
  let baseline = $state("");
  let detailRef: HTMLElement | null = null;
  let confirmation: { ask: (message: string, heading?: string, acceptLabel?: string) => Promise<boolean> };
  let listSequence = 0;
  let detailSequence = 0;
  const dirty = $derived(selected !== null && JSON.stringify({ answer, internalNote, status }) !== baseline);
  beforeNavigate(({ cancel, willUnload }) => { if (busy || (dirty && (willUnload || !window.confirm("저장하지 않은 문의 답변이 있어요. 이동할까요?")))) cancel(); });
  onDestroy(() => { listSequence += 1; detailSequence += 1; });
  onMount(() => { void load(1); });
  async function load(target: number) {
    const sequence = ++listSequence;
    loading = true; listError = "";
    try { const result = await apiRequest<{ items: SupportTicket[]; total: number; page: number }>(`/admin/site/support?page=${target}${filter ? `&status=${filter}` : ""}`); if (sequence !== listSequence) return; items = result.items; total = result.total; page = result.page; }
    catch (error) { if (sequence === listSequence) listError = error instanceof Error ? error.message : "문의 목록을 불러오지 못했어요."; }
    finally { if (sequence === listSequence) loading = false; }
  }
  function apply(ticket: SupportTicket) { selected = ticket; answer = ticket.answer || ""; internalNote = ticket.internalNote || ""; status = ticket.status; baseline = JSON.stringify({ answer, internalNote, status }); }
  async function open(id: string) {
    if (busy) return;
    if (dirty && !await confirmation.ask("저장하지 않은 답변을 버리고 문의를 불러올까요?", "문의 변경", "불러오기")) return;
    const sequence = ++detailSequence;
    busy = true; feedback = ""; detailError = ""; requestedId = id;
    try { const result = await apiRequest<SupportTicket>(`/admin/site/support/${id}`); if (sequence !== detailSequence) return; apply(result); await tick(); if (window.matchMedia("(max-width: 1023px)").matches) detailRef?.scrollIntoView({ block: "start" }); detailRef?.focus({ preventScroll: true }); }
    catch (error) { if (sequence === detailSequence) detailError = error instanceof Error ? error.message : "문의를 불러오지 못했어요."; }
    finally { if (sequence === detailSequence) busy = false; }
  }
  async function save(event: SubmitEvent) {
    event.preventDefault(); if (!selected || busy) return;
    if (!dirty) return;
    if (answer.trim() !== (selected.answer || "") && !await confirmation.ask("저장한 답변은 문의자가 볼 수 있어요. 저장할까요?", "답변 저장", "저장")) return;
    busy = true; feedback = ""; saveFailed = false;
    try { apply(await apiRequest<SupportTicket>(`/admin/site/support/${selected.id}`, { method: "PATCH", body: JSON.stringify({ revision: selected.revision, status, answer, internalNote }) })); feedback = "문의 처리를 저장했어요. 새 답변이 있으면 안내 메일이 발송 대기열에 등록돼요."; await load(page); }
    catch (error) { saveFailed = true; feedback = error instanceof Error ? error.message : "문의 처리를 저장하지 못했어요. 입력한 내용은 그대로 있어요."; }
    finally { busy = false; }
  }
</script>
<svelte:head><title>고객센터 문의 — 운영 콘솔</title></svelte:head>
<ConfirmAction bind:this={confirmation} />
<div class="mx-auto w-full max-w-6xl space-y-6 [word-break:keep-all] [overflow-wrap:anywhere]">
  <PageHeader title="고객센터 문의" description="접수된 문의를 확인하고 답변과 처리 상태를 저장해요. 공연 의뢰는 공연 신청·상담에서 확인해 주세요.">{#snippet actions()}<Button href="/admin/inquiries" variant="outline">공연 신청·상담</Button>{/snippet}</PageHeader>
  <AdminSiteNav />
  <div class="flex flex-wrap items-end gap-4"><div class="grid w-48 gap-2"><Label for="support-filter">상태</Label><Select.Root type="single" value={filter || "all"} disabled={loading} onValueChange={(value) => { filter = value === "all" ? "" : value; void load(1); }}><Select.Trigger id="support-filter" class="min-h-11 w-full">{filter ? SUPPORT_STATUSES[filter] : "전체"}</Select.Trigger><Select.Content><Select.Item value="all" label="전체" />{#each Object.entries(SUPPORT_STATUSES) as [value, label] (value)}<Select.Item {value} {label} />{/each}</Select.Content></Select.Root></div><Button type="button" variant="outline" disabled={loading} onclick={() => load(page)}>목록 새로고침</Button><span class="py-2 text-sm text-muted-foreground">총 {total.toLocaleString()}건</span></div>
  {#if listError}<ErrorPanel title="문의 목록을 불러오지 못했어요" message={listError} onRetry={() => load(page)} />{#if items.length}<p class="text-muted-foreground text-xs">아래는 이전에 불러온 문의 목록이에요.</p>{/if}{/if}
  {#if feedback}<p role={saveFailed ? 'alert' : 'status'} class="rounded-lg border p-4 text-sm leading-6">{feedback}</p>{/if}
  <div class="grid items-start gap-6 lg:grid-cols-[0.8fr_1.2fr]">
    <section class="rounded-xl border p-4" aria-label="문의 목록"><div class="divide-y" aria-busy={loading}>{#each items as ticket (ticket.id)}<button type="button" disabled={busy} onclick={() => open(ticket.id)} class="w-full rounded-lg p-4 text-left transition-colors hover:bg-muted/50 data-[selected=true]:bg-primary/5" data-selected={selected?.id === ticket.id}><span class="text-xs text-muted-foreground">{SUPPORT_STATUSES[ticket.status]} · {ticket.userId ? "회원" : "비회원"} · {SUPPORT_CATEGORIES[ticket.category]}</span><strong class="mt-2 block text-sm">{ticket.subject}</strong><span class="mt-2 block text-xs text-muted-foreground">{ticket.contactName} · {koreanDate(ticket.createdAt)}</span></button>{:else}{#if loading}<div class="space-y-3 py-3" role="status" aria-label="문의 목록 불러오는 중"><Skeleton class="h-20 w-full" /><Skeleton class="h-20 w-full" /></div>{:else if !listError}<EmptyState title={filter ? "이 상태의 문의가 없어요" : "아직 접수된 문의가 없어요"} description={filter ? "다른 처리 상태를 선택해 확인해 보세요." : "새 문의가 접수되면 여기에서 확인하고 답변할 수 있어요."} />{/if}{/each}</div><div class="mt-5 flex items-center justify-between gap-3"><Button type="button" variant="outline" disabled={loading || page <= 1} onclick={() => load(page - 1)}>이전</Button><span class="text-xs">{page} / {Math.max(1, Math.ceil(total / 30))}</span><Button type="button" variant="outline" disabled={loading || page * 30 >= total} onclick={() => load(page + 1)}>다음</Button></div></section>
    <section bind:this={detailRef} tabindex="-1" class="scroll-mt-5 rounded-xl border p-5 outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-6" aria-label="문의 상세 및 답변">
      {#if detailError}<ErrorPanel title="문의 내용을 불러오지 못했어요" message={detailError} onRetry={() => open(requestedId)} />{#if selected}<p class="text-muted-foreground mt-3 text-xs">아래는 이전에 열었던 문의 내용이에요.</p>{/if}{/if}
      {#if busy && requestedId && requestedId !== selected?.id}<p role="status" class="text-muted-foreground mb-4 text-sm">선택한 문의를 불러오는 중이에요.</p>{/if}
      {#if selected}
        <h2 class="break-words text-xl font-bold">{selected.subject}</h2><dl class="mt-4 grid gap-2 text-xs leading-6 text-muted-foreground"><div><dt class="inline">접수번호: </dt><dd class="inline select-all">{selected.id}</dd></div><div><dt class="inline">문의자: </dt><dd class="inline">{selected.contactName} · {selected.email}</dd></div><div><dt class="inline">보관기한: </dt><dd class="inline">{koreanDate(selected.expiresAt)}</dd></div>{#if selected.privacyDocument}<div><dt class="inline">수집 동의: </dt><dd class="inline">{selected.privacyDocument.title} v{selected.privacyDocument.version}{selected.privacyConsentedAt ? ` · ${koreanDate(selected.privacyConsentedAt)}` : ""}</dd></div>{/if}</dl>
        <p class="my-6 whitespace-pre-wrap rounded-lg bg-muted/30 p-4 text-sm leading-7">{selected.message}</p>
        <form class="grid gap-5 border-t pt-5" onsubmit={save}><fieldset class="grid gap-5" disabled={busy}>
          <div class="grid gap-2"><Label for="support-edit-status">처리 상태</Label><Select.Root type="single" bind:value={status} disabled={busy}><Select.Trigger id="support-edit-status" class="min-h-11 w-full">{SUPPORT_STATUSES[status]}</Select.Trigger><Select.Content>{#each Object.entries(SUPPORT_STATUSES) as [value, label] (value)}<Select.Item {value} {label} />{/each}</Select.Content></Select.Root></div>
          <label class="grid gap-2 text-sm font-semibold">문의자에게 공개할 답변{#if status === "ANSWERED"}<span class="text-destructive text-xs">답변 완료 상태에서는 필수예요</span>{/if}<Textarea bind:value={answer} maxlength={10000} rows={9} required={status === "ANSWERED"} /><span class="text-xs font-normal leading-6 text-muted-foreground">저장한 답변은 처리 상태와 관계없이 문의자가 볼 수 있어요. 메일에는 답변 본문 대신 고객센터에서 확인하는 방법만 안내해요.</span></label>
          <label class="grid gap-2 text-sm">내부 운영 메모 (문의자에게 비공개)<Textarea bind:value={internalNote} maxlength={5000} rows={4} /></label>
          <div class="flex flex-wrap gap-3"><Button type="submit" disabled={busy || !dirty}>{busy ? "저장 중…" : "답변 및 상태 저장"}</Button><Button type="button" variant="outline" onclick={() => selected && open(selected.id)}>최신 내용 다시 불러오기</Button></div>
        </fieldset></form>
      {:else if !busy && !detailError}<EmptyState title="확인할 문의를 선택해 주세요" description="목록에서 문의를 고르면 내용과 답변 입력란이 열려요." />{/if}
    </section>
  </div>
</div>
