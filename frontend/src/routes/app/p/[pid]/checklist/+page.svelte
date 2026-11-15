<script lang="ts">
  import { untrack } from "svelte";
  import { page } from "$app/stores";
  import { toast } from "svelte-sonner";
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { PageHeader } from "$lib/components/ui/page-header";
  import { ErrorPanel } from "$lib/components/ui/error-panel";
  import { EmptyState } from "$lib/components/ui/empty-state";
  import { LoadingBlock } from "$lib/components/ui/loading-block";
  import { Input } from "$lib/components/ui/input";
  import { Textarea } from "$lib/components/ui/textarea";
  import { ConfirmDialog, type ConfirmAsk } from "$lib/components/ui/confirm-dialog";
  import { apiRequest } from "$lib/api/client";
  import { peek, remember } from "$lib/api/swr";
  import { captureSession, isCurrentSession } from "$lib/api/session";
  import { PHASE_LABELS, formatDateTime } from "$lib/domain/labels";

  type Status = "TODO" | "IN_PROGRESS" | "WAITING_APPROVAL" | "DONE" | "BLOCKED";
  type Item = {
    id: string; label: string; description: string | null; status: Status; order: number; dueAt: string | null; requiresApproval: boolean; reviewNote: string | null; completionNote: string | null;
    event: { id: string; title: string } | null;
    assignments: Array<{ membershipId: string; membership: { user: { id: string; name: string } } }>;
  };
  type PhaseBlock = { id: string; phase: string; items: Item[] };
  type Member = { id: string; user: { id: string; name: string } };
  type Workspace = { production: { id: string; title: string }; myMembershipId: string | null; canEdit: boolean; phases: PhaseBlock[]; memberships: Member[]; totals: { items: number; done: number; waitingApproval: number; blocked: number; myAssigned: number } };

  const pid = $derived($page.params.pid ?? "");
  const STATUS_LABEL: Record<Status, string> = { TODO: "해야 해요", IN_PROGRESS: "진행 중", WAITING_APPROVAL: "승인 대기", DONE: "완료", BLOCKED: "도움 필요" };
  const STATUS_STYLE: Record<Status, string> = {
    TODO: "bg-muted text-muted-foreground", IN_PROGRESS: "bg-sky-500/15 text-sky-700 dark:text-sky-300", WAITING_APPROVAL: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    DONE: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", BLOCKED: "bg-red-500/15 text-red-700 dark:text-red-300"
  };

  let data = $state<Workspace | null>(null);
  let loading = $state(true);
  let error = $state("");
  let filter = $state<"all" | "mine" | "waiting" | "blocked" | "late">("all");
  let busyId = $state<string | null>(null);
  let confirmation: { ask: ConfirmAsk };
  let adding = $state<Record<string, { label: string; due: string }>>({});

  let editing = $state<Item | null>(null);
  let editLabel = $state(""); let editDescription = $state(""); let editDue = $state(""); let editApproval = $state(false); let editAssignees = $state<string[]>([]);

  let loadVersion = 0;
  let productionEpoch = 0;
  async function load() {
    const productionId = pid, version = ++loadVersion;
    const session = captureSession();
    const active = () => productionId === pid && version === loadVersion && isCurrentSession(session);
    const key = `checklist:${productionId}`;
    const cached = peek<Workspace>(key);
    if (cached && !data) { data = cached; loading = false; }
    error = "";
    try {
      const result = await apiRequest<Workspace>(`/productions/${productionId}/checklist`);
      if (active()) data = remember(key, result, session);
    }
    catch (failure) { if (active()) error = failure instanceof Error ? failure.message : "체크리스트를 불러오지 못했어요."; }
    finally { if (active()) loading = false; }
  }
  $effect(() => {
    void pid;
    productionEpoch += 1;
    // 공연 전환 시 이전 항목을 비우고, 늦은 응답이나 캐시 읽기로 재조회가 반복되지 않게 한다.
    untrack(() => { data = null; editing = null; busyId = null; adding = {}; loading = true; error = ""; void load(); });
    return () => { loadVersion += 1; };
  });

  const mine = (item: Item) => Boolean(data?.myMembershipId) && item.assignments.some((assignment) => assignment.membershipId === data!.myMembershipId);
  const late = (item: Item) => Boolean(item.dueAt) && item.status !== "DONE" && Date.parse(item.dueAt!) < Date.now();
  const visible = (items: Item[]) => items.filter((item) => filter === "all" || (filter === "mine" && mine(item)) || (filter === "waiting" && item.status === "WAITING_APPROVAL") || (filter === "blocked" && item.status === "BLOCKED") || (filter === "late" && late(item)));
  const counts = $derived.by(() => {
    const items = data?.phases.flatMap((phase) => phase.items) ?? [];
    return { all: items.length, mine: items.filter(mine).length, waiting: items.filter((item) => item.status === "WAITING_APPROVAL").length, blocked: items.filter((item) => item.status === "BLOCKED").length, late: items.filter(late).length };
  });
  const dueText = (value: string) => new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", weekday: "short" }).format(new Date(value));

  async function act(id: string, work: () => Promise<unknown>, done?: string) {
    const productionId = pid, epoch = productionEpoch;
    const active = () => productionId === pid && epoch === productionEpoch;
    busyId = id;
    try {
      await work();
      if (!active()) return false;
      await load();
      if (!active()) return false;
      if (done) toast.success(done);
      return true;
    }
    catch (failure) { if (active()) toast.error(failure instanceof Error ? failure.message : "처리하지 못했어요."); return false; }
    finally { if (active()) busyId = null; }
  }
  const setStatus = (item: Item, status: Status) => act(item.id, () => apiRequest(`/productions/${pid}/checklist/items/${item.id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }));
  const quickToggle = (item: Item) => setStatus(item, item.status === "DONE" || item.status === "WAITING_APPROVAL" ? "TODO" : "DONE");
  async function decide(item: Item, decision: "APPROVED" | "REJECTED") {
    const productionId = pid, epoch = productionEpoch;
    let reviewNote: string | undefined;
    if (decision === "REJECTED") {
      const answer = await confirmation.ask({ title: "반려하기", description: "반려하는 이유를 적어 주세요.", confirmLabel: "반려하기", destructive: true, reason: { label: "반려 이유", required: true } });
      reviewNote = answer.reason?.trim();
      if (!answer.confirmed || !reviewNote) return;
    }
    if (productionId !== pid || epoch !== productionEpoch) return;
    await act(item.id, () => apiRequest(`/productions/${pid}/checklist/items/${item.id}/approve`, { method: "POST", body: JSON.stringify({ decision, reviewNote }) }), decision === "APPROVED" ? "승인했어요." : "반려했어요.");
  }
  async function add(phase: PhaseBlock, event: SubmitEvent) {
    event.preventDefault();
    const draft = adding[phase.id];
    if (!draft?.label.trim()) return;
    const saved = await act(phase.id, () => apiRequest(`/productions/${pid}/checklist/items`, { method: "POST", body: JSON.stringify({ phase: phase.phase, label: draft.label.trim(), dueAt: draft.due ? new Date(`${draft.due}T23:59:00+09:00`).toISOString() : undefined }) }), "항목을 추가했어요.");
    if (saved && adding[phase.id] === draft) adding[phase.id] = { label: "", due: "" };
  }
  function openEdit(item: Item) {
    editing = item; editLabel = item.label; editDescription = item.description ?? ""; editApproval = item.requiresApproval;
    editDue = item.dueAt ? new Date(Date.parse(item.dueAt) + 9 * 3600_000).toISOString().slice(0, 10) : "";
    editAssignees = item.assignments.map((assignment) => assignment.membershipId);
  }
  async function saveEdit() {
    if (!editing || !editLabel.trim()) return;
    const item = editing, productionId = pid;
    const saved = await act(item.id, async () => {
      const membershipIds = [...editAssignees];
      await apiRequest(`/productions/${productionId}/checklist/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ label: editLabel.trim(), description: editDescription.trim() || null, requiresApproval: editApproval, dueAt: editDue ? new Date(`${editDue}T23:59:00+09:00`).toISOString() : null }) });
      await apiRequest(`/productions/${productionId}/checklist/items/${item.id}/assignments`, { method: "POST", body: JSON.stringify({ membershipIds }) });
    }, "저장했어요.");
    if (saved && editing === item) editing = null;
  }
  async function remove(item: Item) {
    const productionId = pid, epoch = productionEpoch;
    const answer = await confirmation.ask({ title: "항목 지우기", description: `“${item.label}” 항목을 지울까요? 지우는 이유를 적어 주세요(기록에 남아요).`, confirmLabel: "지우기", destructive: true, reason: { label: "지우는 이유", required: true } });
    const reason = answer.reason?.trim();
    if (!answer.confirmed || !reason || productionId !== pid || epoch !== productionEpoch) return;
    const removed = await act(item.id, () => apiRequest(`/productions/${pid}/checklist/items/${item.id}?force=true`, { method: "DELETE", body: JSON.stringify({ reason }) }), "항목을 지웠어요.");
    if (removed && editing?.id === item.id) editing = null;
  }
</script>

<svelte:head><title>준비 체크리스트 — {data?.production.title ?? "공연"}</title></svelte:head>
<div class="mx-auto min-w-0 w-full max-w-4xl space-y-6">
  <PageHeader title="준비 체크리스트" description="해야 할 일과 담당자, 마감일을 함께 확인해요. 내 담당 항목은 끝낸 뒤 완료로 표시해 주세요." />

  {#if error}<ErrorPanel title="체크리스트를 불러오지 못했어요" message={error + (data ? " 현재 표시된 내용은 이전 조회 결과예요." : "")} onRetry={load} />{/if}
  {#if loading && !data}<LoadingBlock lines={5} />
  {:else if data}
    <div class="bg-card rounded-xl border p-4">
      <div class="flex flex-wrap items-baseline justify-between gap-2"><p class="text-sm font-semibold">전체 진행 <span class="text-muted-foreground font-normal tabular-nums">{data.totals.done} / {data.totals.items} 완료</span></p>
        {#if data.totals.waitingApproval}<p class="text-xs text-amber-700 dark:text-amber-300">승인 기다리는 항목 {data.totals.waitingApproval}개</p>{/if}</div>
      <div class="bg-muted mt-2 h-2 overflow-hidden rounded-full" role="img" aria-label={`전체 ${data.totals.items}개 중 ${data.totals.done}개 완료`}><div class="bg-primary h-full rounded-full transition-all" style={`width:${data.totals.items ? Math.round((data.totals.done / data.totals.items) * 100) : 0}%`}></div></div>
    </div>

    <div class="flex flex-wrap gap-1.5" role="group" aria-label="할 일 필터">
      {#each [["all", "전체"], ["mine", "내 담당"], ["late", "마감 지남"], ["waiting", "승인 대기"], ["blocked", "도움 필요"]] as [id, label] (id)}
        <button type="button" aria-pressed={filter === id} class={["min-h-11 rounded-full border px-4 text-sm transition-colors", filter === id ? "bg-foreground text-background border-transparent font-semibold" : "hover:bg-muted"]} onclick={() => (filter = id as typeof filter)}>{label}<span class={["ms-1.5 tabular-nums", filter === id ? "opacity-80" : "text-muted-foreground"]}>{counts[id as keyof typeof counts]}</span></button>
      {/each}
    </div>

    {#each data.phases as phase (phase.id)}
      {@const items = visible(phase.items)}
      {#if items.length || (filter === "all" && data.canEdit)}
        <section aria-labelledby={`phase-${phase.id}`}>
          <h2 id={`phase-${phase.id}`} class="flex items-baseline gap-2 text-base font-semibold">{PHASE_LABELS[phase.phase] ?? phase.phase}<span class="text-muted-foreground text-xs font-normal tabular-nums">{phase.items.filter((item) => item.status === "DONE").length}/{phase.items.length}</span></h2>
          <ul class="bg-card mt-2 divide-y overflow-hidden rounded-xl border">
            {#each items as item (item.id)}
              {@const can = data.canEdit || mine(item)}
              <li class="flex flex-wrap items-start gap-x-3 gap-y-2 p-3.5 {item.status === 'DONE' ? 'opacity-70' : ''}">
                <button type="button" class={["mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold transition-colors", item.status === "DONE" ? "border-emerald-500 bg-emerald-500 text-white" : item.status === "WAITING_APPROVAL" ? "border-amber-500 text-amber-600" : "border-muted-foreground/40 hover:border-primary"]} disabled={!can || busyId === item.id} aria-label={item.status === "DONE" ? "완료 취소" : "완료로 표시"} onclick={() => quickToggle(item)}>{item.status === "DONE" ? "✓" : item.status === "WAITING_APPROVAL" ? "…" : ""}</button>
                <div class="min-w-0 flex-1">
                  <p class={["break-words text-sm font-medium", item.status === "DONE" && "line-through"]}>{item.label}</p>
                  {#if item.description}<p class="text-muted-foreground mt-0.5 text-xs leading-5">{item.description}</p>{/if}
                  <p class="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    {#if item.dueAt}<span class={late(item) ? "font-semibold text-red-600 dark:text-red-400" : ""}>마감 {dueText(item.dueAt)}{late(item) ? " · 지났어요" : ""}</span>{/if}
                    {#if item.event}<span>일정 · {item.event.title}</span>{/if}
                    {#if item.assignments.length}<span>담당 {item.assignments.map((assignment) => assignment.membership.user.name).join(", ")}</span>{:else}<span>담당 미정</span>{/if}
                    {#if item.requiresApproval}<span>승인 필요</span>{/if}
                  </p>
                  {#if item.reviewNote && item.status !== "DONE"}<p class="mt-1 rounded bg-red-500/10 px-2 py-1 text-xs">반려 사유: {item.reviewNote}</p>{/if}
                </div>
                <div class="flex flex-wrap items-center gap-1.5">
                  {#if can && item.status !== "WAITING_APPROVAL"}
                    <select class={["min-h-11 rounded-md border px-2 text-xs font-medium", STATUS_STYLE[item.status]]} value={item.status} disabled={busyId === item.id} aria-label={`${item.label} 상태`} onchange={(event) => setStatus(item, event.currentTarget.value as Status)}>
                      {#each Object.entries(STATUS_LABEL).filter(([value]) => value !== "WAITING_APPROVAL") as [value, label] (value)}<option {value}>{label}</option>{/each}
                    </select>
                  {:else}<span class={["rounded-md px-2 py-1 text-xs font-medium", STATUS_STYLE[item.status]]}>{STATUS_LABEL[item.status]}</span>{/if}
                  {#if item.status === "WAITING_APPROVAL" && data.canEdit}
                    <Button size="sm" class="min-h-11" disabled={busyId === item.id} onclick={() => decide(item, "APPROVED")}>승인</Button>
                    <Button size="sm" variant="outline" class="min-h-11" disabled={busyId === item.id} onclick={() => decide(item, "REJECTED")}>반려</Button>
                  {/if}
                  {#if data.canEdit}<Button size="sm" variant="ghost" class="min-h-11" disabled={busyId === item.id} onclick={() => openEdit(item)}>수정</Button>{/if}
                </div>
              </li>
            {:else}<li class="text-muted-foreground p-6 text-center text-sm">이 단계에는 아직 항목이 없어요.</li>{/each}
            {#if data.canEdit && filter === "all"}
              <li class="bg-muted/20 p-3">
                <form class="flex flex-wrap items-center gap-2" onsubmit={(event) => add(phase, event)}>
                  <Input class="min-w-0 flex-1" placeholder="할 일 추가 (예: 의상 확인)" aria-label={`${PHASE_LABELS[phase.phase] ?? phase.phase} 단계에 할 일 추가`} value={adding[phase.id]?.label ?? ""} oninput={(event) => (adding[phase.id] = { label: event.currentTarget.value, due: adding[phase.id]?.due ?? "" })} />
                  <input type="date" class="bg-background min-h-11 rounded-md border px-2 text-sm" aria-label="마감일" value={adding[phase.id]?.due ?? ""} onchange={(event) => (adding[phase.id] = { label: adding[phase.id]?.label ?? "", due: event.currentTarget.value })} />
                  <Button type="submit" class="min-h-11" disabled={busyId === phase.id || !(adding[phase.id]?.label ?? "").trim()}>추가</Button>
                </form>
              </li>
            {/if}
          </ul>
        </section>
      {/if}
    {/each}
    {#if data.phases.every((phase) => visible(phase.items).length === 0)}
      <EmptyState title={filter === "all" ? "등록된 할 일이 없어요" : "이 조건에 해당하는 할 일이 없어요"} description={filter === "all" ? "공연 준비에 필요한 일을 단계별로 추가해 주세요." : "다른 필터를 선택하거나 전체 할 일을 확인해 보세요."}>
        {#snippet action()}{#if filter !== "all"}<Button variant="outline" size="touch" onclick={() => filter = "all"}>전체 할 일 보기</Button>{/if}{/snippet}
      </EmptyState>
    {/if}
  {/if}
</div>

{#if editing}
  <Dialog.Root open onOpenChange={(open) => { if (!open) editing = null; }}>
    <Dialog.Content class="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
      <Dialog.Header><Dialog.Title>할 일 수정</Dialog.Title><Dialog.Description>담당자와 마감일을 정하면 알림과 “내 담당” 목록에 반영돼요.</Dialog.Description></Dialog.Header>
      <div class="space-y-3 text-sm">
        <label class="grid gap-1 font-medium">할 일<Input bind:value={editLabel} maxlength={200} /></label>
        <label class="grid gap-1 font-medium">설명<Textarea rows={3} bind:value={editDescription} /></label>
        <label class="grid gap-1 font-medium">마감일<input type="date" class="bg-background min-h-11 rounded-md border px-2" bind:value={editDue} /></label>
        <label class="flex items-center gap-2"><input type="checkbox" bind:checked={editApproval} />끝나면 책임자의 승인을 받아야 해요</label>
        <fieldset>
          <legend class="mb-1 font-medium">담당자</legend>
          <div class="grid max-h-44 gap-1 overflow-y-auto rounded-lg border p-2 sm:grid-cols-2">
            {#each data?.memberships ?? [] as member (member.id)}
              <label class="flex items-center gap-2 min-h-11 rounded px-2 py-2 hover:bg-muted"><input type="checkbox" checked={editAssignees.includes(member.id)} onchange={(event) => { editAssignees = event.currentTarget.checked ? [...editAssignees, member.id] : editAssignees.filter((id) => id !== member.id); }} />{member.user.name}</label>
            {/each}
          </div>
        </fieldset>
      </div>
      <Dialog.Footer class="flex-wrap gap-2">
        <Button variant="ghost" class="text-destructive me-auto min-h-11" onclick={() => editing && remove(editing)}>지우기</Button>
        <Button variant="ghost" class="min-h-11" onclick={() => (editing = null)}>취소</Button>
        <Button class="min-h-11" disabled={!editLabel.trim() || busyId === editing.id} onclick={saveEdit}>저장</Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
{/if}
<ConfirmDialog bind:this={confirmation} />
