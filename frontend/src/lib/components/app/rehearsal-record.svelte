<script lang="ts">
  import { untrack } from "svelte";
  import { beforeNavigate } from "$app/navigation";
  import { apiRequest } from "$lib/api/client";
  import { captureSession, isCurrentSession, type ClientSession } from "$lib/api/session";
  import { Button } from "$lib/components/ui/button";
  import { formatTimelineTime } from "$lib/domain/performance-timeline";

  type RecordState = { source: string; positionMs: number; completedKeys: string[]; notes: Record<string, string>; revision: number };
  let { pid, source, positionMs, unitKey, unitTitle, onresume, ondirty = () => {} }: { pid: string; source: string; positionMs: number; unitKey: string; unitTitle: string; onresume: (timeMs: number) => void; ondirty?: (dirty: boolean) => void } = $props();
  let record = $state<RecordState | null>(null);
  let notes = $state<Record<string, string>>({});
  let completed = $state<string[]>([]);
  let loading = $state(true);
  let saving = $state(false);
  let error = $state("");
  let dirty = $state(false);
  let savedAt = $state("");
  let recordSession = $state.raw<ClientSession | null>(null);
  let requestVersion = 0;
  const done = $derived(completed.includes(unitKey));
  const positionChanged = $derived(Boolean(record && Math.round(positionMs) !== record.positionMs));
  $effect(() => { ondirty(dirty); });

  beforeNavigate((navigation) => {
    if (dirty && !window.confirm("개인 메모와 완료 표시가 아직 저장되지 않았어요. 저장하지 않고 이동할까요?")) navigation.cancel();
  });

  $effect(() => {
    const productionId = pid, selectedSource = source;
    const controller = new AbortController();
    record = null; recordSession = null; notes = {}; completed = []; error = ""; loading = true; saving = false; dirty = false; savedAt = "";
    void reload(productionId, selectedSource, controller.signal);
    return () => { recordSession = null; requestVersion += 1; controller.abort(); };
  });

  $effect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  });

  async function reload(productionId = pid, selectedSource = source, signal?: AbortSignal) {
    const session = captureSession(), version = ++requestVersion;
    const active = () => !signal?.aborted && version === requestVersion && productionId === pid && selectedSource === source && isCurrentSession(session);
    loading = true; error = "";
    try {
      const rows = await apiRequest<RecordState[]>(`/productions/${productionId}/rehearsal/me`, { signal, session });
      if (!active()) return;
      record = rows.find((row) => row.source === selectedSource) ?? { source: selectedSource, positionMs: 0, completedKeys: [], notes: {}, revision: 0 };
      recordSession = session;
      notes = { ...record.notes }; completed = [...record.completedKeys]; dirty = false;
    } catch (cause) { if (active()) error = cause instanceof Error ? cause.message : "연습 기록을 읽지 못했어요."; }
    finally { if (active()) loading = false; }
  }

  async function save() {
    if (!record || !recordSession || saving) return;
    // 메모를 읽은 계정의 세션에 저장을 묶어, 폐기된 화면의 콜백이 새 계정으로 전송하지 못하게 한다.
    const session = recordSession;
    if (!isCurrentSession(session)) return;
    const productionId = pid, selectedSource = source;
    const version = requestVersion;
    const active = () => version === requestVersion && productionId === pid && selectedSource === source && recordSession === session && isCurrentSession(session);
    const current = untrack(() => ({ source, positionMs: Math.round(positionMs), completedKeys: [...completed], notes: { ...notes }, expectedRevision: record!.revision }));
    saving = true; error = "";
    try {
      const result = await apiRequest<RecordState>(`/productions/${productionId}/rehearsal/me`, { method: "PUT", body: JSON.stringify(current), session });
      if (!active()) return;
      record = result; dirty = false; savedAt = "저장했어요";
    } catch (cause) { if (active()) error = cause instanceof Error ? cause.message : "연습 기록을 저장하지 못했어요."; }
    finally { if (active()) saving = false; }
  }
</script>

<section class="bg-card space-y-3 rounded-2xl border p-4" aria-label="개인 연습 기록">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <h2 class="text-sm font-bold">개인 연습 기록</h2>
    <span class="bg-muted text-muted-foreground rounded-full px-2.5 py-1 text-xs">나에게만 보여요</span>
  </div>
  <div class="bg-muted/40 grid gap-2 rounded-xl p-3 text-sm sm:grid-cols-2">
    <p><span class="text-muted-foreground mb-1 block text-xs">현재 재생 위치</span><strong class="font-mono tabular-nums">{formatTimelineTime(positionMs)}</strong></p>
    <p><span class="text-muted-foreground mb-1 block text-xs">마지막 저장 위치</span>{record && record.revision > 0 ? formatTimelineTime(record.positionMs) : "저장한 위치가 없어요"}</p>
  </div>
  <p class="text-muted-foreground text-xs"><strong>{unitTitle}</strong>에 메모·완료 표시를 남겨요. 저장 버튼을 눌러야 현재 위치와 함께 내 계정에 남아요.</p>
  {#if record && record.revision > 0}<Button class="min-h-11 w-full" size="sm" variant="outline" onclick={() => onresume(record!.positionMs)}>저장한 {formatTimelineTime(record.positionMs)}부터 이어서 연습</Button>{/if}
  {#if loading}<p role="status" class="text-sm">연습 기록을 불러오는 중…</p>{/if}
  <label class="grid gap-1 text-sm">개인 연습 메모<textarea class="bg-background min-h-24 w-full rounded-lg border p-3" maxlength="5000" value={notes[unitKey] ?? ""} disabled={loading || saving || !record} oninput={(event) => { notes = { ...notes, [unitKey]: event.currentTarget.value }; dirty = true; savedAt = ""; }} placeholder="등장 타이밍, 발성, 장비 준비처럼 다음 연습 때 기억할 내용을 적어 주세요."></textarea></label>
  <div class="flex flex-wrap items-center gap-3">
    <label class="flex min-h-11 items-center gap-2 text-sm"><input class="accent-primary size-4" type="checkbox" checked={done} disabled={loading || saving || !record} onchange={(event) => { completed = event.currentTarget.checked ? [...completed.filter((key) => key !== unitKey), unitKey] : completed.filter((key) => key !== unitKey); dirty = true; savedAt = ""; }} />{unitTitle} 연습 완료</label>
    <Button class="ms-auto min-h-11" disabled={loading || saving || !record} onclick={save}>{saving ? "저장 중…" : "현재 위치·메모 저장"}</Button>
  </div>
  {#if error}<div role="alert" class="text-destructive space-y-2 text-sm"><p>{error}</p><Button variant="outline" disabled={saving || loading} onclick={() => { if (!dirty || window.confirm("메모를 복사했거나 입력을 버려도 괜찮으면 최신 기록을 불러와 주세요.")) void reload(); }}>최신 기록 불러오기</Button></div>{/if}
  <p class="text-muted-foreground text-xs" role="status">{dirty ? "저장하지 않은 메모·완료 변경이 있어요." : positionChanged ? "지금 연습 위치는 아직 저장되지 않았어요." : savedAt || `${completed.length}개 구간에 완료 표시했어요.`}</p>
</section>
