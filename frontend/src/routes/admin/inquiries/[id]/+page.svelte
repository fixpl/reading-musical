<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import { beforeNavigate } from "$app/navigation";
  import { page } from "$app/stores";
  import { toast } from "svelte-sonner";
  import * as Tabs from "$lib/components/ui/tabs";
  import * as Select from "$lib/components/ui/select";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import { Textarea } from "$lib/components/ui/textarea";
  import { PageHeader } from "$lib/components/ui/page-header";
  import { ErrorPanel } from "$lib/components/ui/error-panel";
  import ConfirmAction from "$lib/components/admin/ConfirmAction.svelte";
  import { apiRequest } from "$lib/api/client";
  import { INQUIRY_LABELS, type ManagedInquiry } from "$lib/api/inquiries";
  import { koreanDate } from "$lib/api/site";
  import { refreshInquiryBadge } from "$lib/stores/admin-badges";
  const inquiryId = $derived($page.params.id ?? "");
  let inquiry = $state<ManagedInquiry | null>(null);
  let loading = $state(true); let busy = $state(false); let feedback = $state("");
  let loadError = $state("");
  let tab = $state("conversation"); let reply = $state("");
  let editStatus = $state("NEW"); let editNote = $state(""); let editPlanning = $state("");
  let baseline = $state(""); let title = $state(""); let productionId = $state("");
  let productions = $state<Array<{ id: string; title: string }>>([]);
  let choicesLoaded = $state(false); let choiceError = $state(""); let sequence = 0;
  let confirmation: { ask: (message: string, heading?: string, action?: string) => Promise<boolean> };
  const internalDirty = $derived(inquiry !== null && JSON.stringify([editStatus, editNote, editPlanning]) !== baseline);
  const dirty = $derived(internalDirty || Boolean(reply.trim()));
  beforeNavigate(({ cancel, willUnload }) => { if (busy || (dirty && (willUnload || !window.confirm("저장하지 않은 내용이 있어요. 이동할까요?")))) cancel(); });
  onDestroy(() => { sequence += 1; });
  // 조회 결과를 적용할 때는 재조회하지 않고 주소의 신청 ID가 바뀔 때만 불러온다.
  $effect(() => { const id = inquiryId; if (id) untrack(() => { void load(id); }); });
  function apply(data: ManagedInquiry) {
    const newCountChanged = inquiry?.id === data.id && (inquiry.status === "NEW") !== (data.status === "NEW");
    inquiry = data;
    editStatus = data.status; editNote = data.adminNote || ""; editPlanning = data.planningNote || "";
    baseline = JSON.stringify([editStatus, editNote, editPlanning]);
    title = data.production?.title || `${data.orgName} 공연`;
    if (newCountChanged) void refreshInquiryBadge().catch(() => {});
  }
  async function load(id: string) {
    const current = ++sequence; loading = true; feedback = ""; loadError = "";
    if (inquiry?.id !== id) { inquiry = null; reply = ""; }
    try { const data = await apiRequest<ManagedInquiry>(`/admin/inquiries/${id}`); if (current === sequence) apply(data); }
    catch (error) { if (current === sequence) loadError = error instanceof Error ? error.message : "신청을 불러오지 못했어요."; }
    finally { if (current === sequence) loading = false; }
  }
  async function reload() {
    if (busy || loading) return;
    if (dirty && !await confirmation.ask("저장하지 않은 내용을 버리고 최신 정보를 불러올까요?", "다시 불러오기", "불러오기")) return;
    reply = ""; await load(inquiryId);
  }
  async function saveInternal(event: SubmitEvent) {
    event.preventDefault(); if (!inquiry || busy || !internalDirty) return; busy = true; feedback = "";
    try { apply(await apiRequest<ManagedInquiry>(`/admin/inquiries/${inquiry.id}`, { method: "PATCH", body: JSON.stringify({ revision: inquiry.revision, status: editStatus, adminNote: editNote, planningNote: editPlanning }) })); toast.success("처리 상태와 내부 메모를 저장했어요."); }
    catch (error) { feedback = error instanceof Error ? error.message : "저장하지 못했어요. 입력한 내용은 그대로 있어요."; }
    finally { busy = false; }
  }
  async function sendReply(event: SubmitEvent) {
    event.preventDefault(); if (!inquiry || busy || !reply.trim()) return;
    if (internalDirty) { feedback = "상태·메모에서 변경사항을 먼저 저장해 주세요."; return; }
    if (!await confirmation.ask("이 답변은 신청자에게 공개돼요. 등록할까요?", "신청자 답변", "답변 등록")) return;
    busy = true; feedback = "";
    try { apply(await apiRequest<ManagedInquiry>(`/admin/inquiries/${inquiry.id}/reply`, { method: "POST", body: JSON.stringify({ revision: inquiry.revision, body: reply.trim() }) })); reply = ""; toast.success("답변을 등록했어요. 이메일 안내는 발송 대기 중이에요."); }
    catch (error) { feedback = error instanceof Error ? error.message : "답변을 저장하지 못했어요."; }
    finally { busy = false; }
  }
  async function loadChoices() {
    choiceError = "";
    try { productions = await apiRequest<Array<{ id: string; title: string }>>("/productions"); choicesLoaded = true; }
    catch { choiceError = "공연 목록을 불러오지 못했어요."; }
  }
  async function connect(existing: boolean) {
    if (!inquiry || busy || (existing ? !productionId : !title.trim())) return;
    if (dirty) { feedback = "작성 중인 답변과 내부 변경사항을 먼저 저장해 주세요."; return; }
    if (!await confirmation.ask(
      existing ? "선택한 공연에 이 신청을 연결할까요?" : "이 신청으로 비공개 공연을 만들까요? 연락처와 상담 원문은 신청 관리에만 남아요.",
      existing ? "공연 연결" : "공연 만들기",
      existing ? "연결" : "공연 만들기"
    )) return;
    busy = true; feedback = "";
    try {
      await apiRequest(`/admin/inquiries/${inquiry.id}/${existing ? "link" : "convert"}`, { method: "POST", body: JSON.stringify(existing ? { productionId, revision: inquiry.revision } : { title: title.trim(), revision: inquiry.revision }) });
      await load(inquiry.id); toast.success(existing ? "공연을 연결했어요." : "비공개 공연을 만들었어요.");
    } catch (error) { feedback = error instanceof Error ? error.message : existing ? "공연을 연결하지 못했어요." : "공연을 만들지 못했어요."; }
    finally { busy = false; }
  }
</script>
<svelte:head><title>공연 신청·상담 — 운영 콘솔</title></svelte:head>
<ConfirmAction bind:this={confirmation} />
<div class="mx-auto w-full max-w-6xl space-y-6 [word-break:keep-all] [overflow-wrap:anywhere]">
  <a href="/admin/inquiries" class="text-muted-foreground inline-flex min-h-11 items-center text-sm hover:underline">신청 목록으로</a>
  <PageHeader title={inquiry?.orgName || "공연 신청·상담"} description={inquiry ? `${inquiry.contactName} · ${inquiry.email}${inquiry.phone ? ` · ${inquiry.phone}` : ""}` : "신청 내용을 확인하고 답변이나 내부 메모를 남겨 주세요."}>{#snippet actions()}<Button type="button" variant="outline" disabled={busy || loading} onclick={reload}>최신 내용 불러오기</Button>{/snippet}</PageHeader>
  {#if loadError}<ErrorPanel title="신청 내용을 불러오지 못했어요" message={loadError} onRetry={reload} />{#if inquiry}<p class="text-muted-foreground text-xs">아래는 이전에 불러온 내용이에요.</p>{/if}{/if}
  {#if feedback}<p role="alert" class="rounded-lg border p-4 text-sm leading-6">{feedback}</p>{/if}
  {#if loading}<Skeleton class="h-72 w-full" />{:else if inquiry}
    <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,320px)_1fr]">
      <aside class="space-y-4 rounded-xl border p-5">
        <div class="flex flex-wrap items-center gap-2"><h2 class="font-semibold">신청 내용</h2><Badge variant="secondary">{INQUIRY_LABELS[inquiry.status]}</Badge></div>
        <p class="whitespace-pre-wrap rounded-lg bg-muted/30 p-4 text-sm leading-7">{inquiry.message}</p>
        <dl class="grid gap-4 text-sm">{#each [["접수 일시", koreanDate(inquiry.createdAt)], ["희망 시기", inquiry.preferredTiming || "미정"], ["관람 대상", inquiry.audience || "미정"], ["담당 운영자", inquiry.handledBy?.name || "미배정"], ["접수번호", inquiry.id]] as [label, value] (label)}<div><dt class="text-xs text-muted-foreground">{label}</dt><dd class="mt-1">{value}</dd></div>{/each}</dl>
        <details><summary class="min-h-11 cursor-pointer py-3 text-sm font-medium">접수 경로 보기</summary><dl class="grid gap-2 text-xs leading-6">{#each [["접수 경로", inquiry.source?.channel || "기존 접수"], ["사이트 내 페이지", inquiry.source?.page || "확인되지 않음"], ["캠페인", inquiry.source?.campaign || "없음"], ["이전 사이트", inquiry.source?.referrerHost || "확인되지 않음"]] as [label, value] (label)}<div><dt class="text-muted-foreground">{label}</dt><dd>{value}</dd></div>{/each}</dl></details>
      </aside>
      <Tabs.Root bind:value={tab} onValueChange={(value) => { if (value === "production" && !choicesLoaded) void loadChoices(); }}>
        <Tabs.List aria-label="공연 신청 관리" class="h-auto w-full flex-wrap justify-start gap-1 sm:w-auto"><Tabs.Trigger value="conversation" class="min-h-11">신청자 답변</Tabs.Trigger><Tabs.Trigger value="internal" class="min-h-11">상태·메모</Tabs.Trigger><Tabs.Trigger value="production" class="min-h-11">{inquiry.production ? "연결된 공연" : "공연 만들기"}</Tabs.Trigger></Tabs.List>
        <Tabs.Content value="conversation"><div class="space-y-4">{#each (inquiry.messages || []).filter((item) => item.public) as item (item.id)}<article class="rounded-xl border p-4"><header class="flex justify-between gap-3 text-xs"><strong>{item.authorKind === "APPLICANT" ? "신청자" : "운영팀"}</strong><time class="text-muted-foreground">{koreanDate(item.createdAt)}</time></header><p class="mt-3 whitespace-pre-wrap text-sm leading-7">{item.body}</p></article>{:else}<p class="rounded-xl border p-6 text-sm text-muted-foreground">아직 등록된 답변이 없어요. 신청 내용을 확인한 뒤 첫 답변을 남겨 주세요.</p>{/each}<form onsubmit={sendReply} class="grid gap-3 rounded-xl border p-5"><Label for="inquiry-reply">신청자에게 공개할 답변 (필수)</Label><Textarea id="inquiry-reply" bind:value={reply} required maxlength={5000} rows={6} disabled={busy} placeholder="신청 내용을 확인하고 안내할 내용을 적어 주세요." /><p class="text-xs leading-6 text-muted-foreground">이 답변은 신청자가 이메일 인증 후 볼 수 있어요. 운영팀만 볼 내용은 내부 메모에 적어 주세요.</p><Button type="submit" disabled={busy || !reply.trim()}>답변 등록</Button></form></div></Tabs.Content>
        <Tabs.Content value="internal"><form onsubmit={saveInternal} class="grid gap-5 rounded-xl border p-5"><div class="grid gap-2"><Label for="inquiry-status">처리 상태</Label><Select.Root type="single" bind:value={editStatus} disabled={busy}><Select.Trigger id="inquiry-status" class="w-full">{INQUIRY_LABELS[editStatus]}</Select.Trigger><Select.Content>{#each Object.entries(INQUIRY_LABELS) as [value, label] (value)}{#if value !== "CONVERTED" || inquiry.production}<Select.Item {value} {label} />{/if}{/each}</Select.Content></Select.Root></div><div class="grid gap-2"><Label for="inquiry-note">운영 메모 · 신청자에게 비공개</Label><Textarea id="inquiry-note" bind:value={editNote} rows={4} maxlength={2000} disabled={busy} /></div><div class="grid gap-2"><Label for="inquiry-planning">기획·견적 메모 · 신청자에게 비공개</Label><Textarea id="inquiry-planning" bind:value={editPlanning} rows={8} maxlength={8000} disabled={busy} /></div><p class="text-xs leading-6 text-muted-foreground">신청자의 연락처와 상담 원문은 공연 참여자에게 자동 공유되지 않아요.</p><Button type="submit" disabled={busy || !internalDirty}>상태·내부 메모 저장</Button></form></Tabs.Content>
        <Tabs.Content value="production">
          <div class="space-y-5 rounded-xl border p-5">
            {#if inquiry.production}
              <h2 class="font-semibold">{inquiry.production.title}</h2>
              {#if inquiry.production.deletedAt}
                <Badge variant="outline">휴지통에 있는 공연</Badge><p class="text-sm">신청 원본은 그대로 남아 있어요. 공연 관리에서 복구 여부를 확인해 주세요.</p>
                <Button href="/admin/productions" variant="outline" size="touch">공연 관리</Button>
              {:else if inquiry.production.archived}
                <Badge variant="outline">보관된 공연</Badge><Button href="/admin/productions" variant="outline" size="touch">공연 관리</Button>
              {:else}
                <div class="flex flex-wrap gap-2"><Button href={`/app/p/${inquiry.production.id}/composition`} size="touch">대본 준비하기</Button><Button href={`/app/p/${inquiry.production.id}/manage/settings`} variant="outline" size="touch">공연 기본정보</Button></div>
              {/if}
            {:else}
              <p class="text-sm leading-6 text-muted-foreground">이 신청으로 비공개 공연을 만들어 대본과 일정을 준비할 수 있어요.</p>
              <div class="grid gap-3">
                <Label for="new-inquiry-production">새 공연 이름 (필수)</Label>
                <Input id="new-inquiry-production" class="min-h-11" bind:value={title} maxlength={120} disabled={busy} />
                <Button type="button" size="touch" disabled={busy || !title.trim() || dirty} onclick={() => connect(false)}>이 신청으로 공연 만들기</Button>
              </div>
              <details class="border-t">
                <summary class="min-h-11 cursor-pointer py-3 text-sm font-medium">이미 등록한 공연에 연결</summary>
                <div class="grid gap-3 pt-2">
                  <Label for="existing-inquiry-production">기존 공연 선택</Label>
                  <Select.Root type="single" bind:value={productionId} disabled={busy}>
                    <Select.Trigger id="existing-inquiry-production" class="min-h-11 w-full">{productions.find((item) => item.id === productionId)?.title || "공연 선택"}</Select.Trigger>
                    <Select.Content>{#each productions as item (item.id)}<Select.Item value={item.id} label={item.title} />{/each}</Select.Content>
                  </Select.Root>
                  {#if choiceError}<p role="alert" class="text-sm">{choiceError} <button type="button" class="underline" onclick={loadChoices}>다시 불러오기</button></p>{/if}
                  <Button type="button" variant="outline" size="touch" disabled={busy || !productionId || dirty} onclick={() => connect(true)}>선택한 공연에 연결</Button>
                </div>
              </details>
              {#if dirty}<p class="text-sm text-muted-foreground">작성 중인 답변이나 메모를 먼저 저장해 주세요.</p>{/if}
            {/if}
          </div>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  {/if}
</div>
