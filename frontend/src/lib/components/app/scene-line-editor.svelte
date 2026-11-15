<script lang="ts">
  import { toast } from "svelte-sonner";
  import { ApiError, apiRequest } from "$lib/api/client";
  import { Button } from "$lib/components/ui/button";
  import * as Dialog from "$lib/components/ui/dialog";
  import { Textarea } from "$lib/components/ui/textarea";

  // 장면의 줄을 하나씩 고친다: 종류(대사·가사·지문·메모), 화자(배역), 내용, 순서, 삭제.
  // 고친 내용은 구간 글에 자동으로 반영된다(대본 ↔ 구간 동기화).
  let { pid, scriptId, sceneId, sceneTitle, canEdit, onChanged, onDirty = () => {}, onWorking = () => {} }: {
    pid: string; scriptId: string; sceneId: string; sceneTitle: string; canEdit: boolean; onChanged: () => Promise<void> | void;
    onDirty?: (dirty: boolean) => void; onWorking?: (working: boolean) => void;
  } = $props();

  type LineType = "DIALOGUE" | "LYRIC" | "STAGE_DIRECTION" | "NOTE";
  type Line = { id: string; order: number; type: LineType; text: string; cueLabel: string | null; updatedAt: string; character: { id: string; name: string } | null };
  type Draft = { type: LineType; text: string; characterId: string; expectedUpdatedAt: string };
  const TYPES: Array<{ value: LineType; label: string }> = [
    { value: "DIALOGUE", label: "대사" }, { value: "LYRIC", label: "가사" }, { value: "STAGE_DIRECTION", label: "지문" }, { value: "NOTE", label: "제작 메모" }
  ];
  const TYPE_STYLE: Record<LineType, string> = {
    DIALOGUE: "border-s-primary", LYRIC: "border-s-violet-400", STAGE_DIRECTION: "border-s-zinc-400", NOTE: "border-s-amber-400 bg-amber-500/5"
  };

  let lines = $state<Line[]>([]);
  let roles = $state<Array<{ id: string; name: string }>>([]);
  let drafts = $state<Record<string, Draft>>({});
  let loading = $state(true);
  let busyId = $state<string | null>(null);
  let adding = $state(false);
  let newType = $state<LineType>("DIALOGUE");
  let newText = $state("");
  let newRole = $state("");
  let conflicts = $state<Record<string, boolean>>({});
  let deleteOpen = $state(false);
  let deleteTarget = $state<Line | null>(null);
  let loadVersion = 0;

  const hasSpeaker = (type: LineType) => type === "DIALOGUE" || type === "LYRIC";
  const dirty = (line: Line) => {
    const draft = drafts[line.id];
    return Boolean(draft) && (draft.type !== line.type || draft.text !== line.text || (hasSpeaker(draft.type) ? draft.characterId : "") !== (hasSpeaker(line.type) ? line.character?.id ?? "" : ""));
  };
  $effect(() => { onDirty(lines.some(dirty) || Boolean(newText.trim())); });
  $effect(() => { onWorking(busyId !== null || adding); });

  async function load(preserveDrafts = false, savedId?: string) {
    const version = ++loadVersion;
    const currentPid = pid, currentScriptId = scriptId, currentSceneId = sceneId;
    loading = true;
    if (!preserveDrafts) {
      lines = []; drafts = {}; conflicts = {}; newText = ""; deleteOpen = false; deleteTarget = null;
    }
    try {
      const [script, roleList] = await Promise.all([
        apiRequest<{ acts: Array<{ scenes: Array<{ id: string; blocks: Line[] }> }> }>(`/productions/${currentPid}/scripts/${currentScriptId}`),
        apiRequest<Array<{ id: string; name: string }>>(`/productions/${currentPid}/roles`).catch(() => [])
      ]);
      if (version !== loadVersion || currentPid !== pid || currentScriptId !== scriptId || currentSceneId !== sceneId) return;
      roles = roleList;
      const scene = script.acts.flatMap((act) => act.scenes).find((candidate) => candidate.id === currentSceneId);
      const previous = new Map(lines.map((line) => [line.id, line]));
      const pending = preserveDrafts ? Object.fromEntries(lines.filter(line => line.id !== savedId && dirty(line)).map(line => [line.id, { ...drafts[line.id] }])) : {};
      lines = [...(scene?.blocks ?? [])].sort((a, b) => a.order - b.order);
      drafts = Object.fromEntries(lines.map((line) => {
        const draft = pending[line.id];
        const base = previous.get(line.id);
        // 순서만 바뀐 줄은 초안을 보존하며 버전만 갱신한다. 실제 충돌의 옛 기준은 유지한다.
        if (draft && base && draft.expectedUpdatedAt === base.updatedAt && base.type === line.type && base.text === line.text && (base.character?.id ?? "") === (line.character?.id ?? "")) {
          draft.expectedUpdatedAt = line.updatedAt;
        }
        return [line.id, draft ?? { type: line.type, text: line.text, characterId: line.character?.id ?? "", expectedUpdatedAt: line.updatedAt }];
      }));
      if (savedId) delete conflicts[savedId];
    } catch (error) {
      if (version === loadVersion && currentPid === pid && currentScriptId === scriptId && currentSceneId === sceneId) toast.error(error instanceof Error ? error.message : "줄을 불러오지 못했어요");
    } finally { if (version === loadVersion) loading = false; }
  }
  $effect(() => { void pid; void sceneId; void scriptId; void load(); });

  async function run(id: string, work: () => Promise<unknown>, done?: string, savedId?: string) {
    busyId = id;
    try { await work(); await load(true, savedId); await onChanged(); if (done) toast.success(done); }
    catch (error) {
      if (error instanceof ApiError && error.status === 409) conflicts[id] = true;
      toast.error(error instanceof Error ? error.message : "저장하지 못했어요");
    }
    finally { busyId = null; }
  }

  const save = (line: Line) => run(line.id, () => {
    const draft = drafts[line.id];
    if (!draft.text.trim()) throw new Error("내용을 입력해 주세요. 줄을 없애려면 삭제를 눌러 주세요.");
    return apiRequest(`/productions/${pid}/blocks/${line.id}`, { method: "PATCH", body: JSON.stringify({
      type: draft.type, text: draft.text.trim(),
      expectedUpdatedAt: draft.expectedUpdatedAt,
      characterId: hasSpeaker(draft.type) && draft.characterId ? draft.characterId : null,
      // 함께 부르는 표기(cueLabel)는 화자를 바꾸면 의미가 없으므로 지운다.
      cueLabel: draft.characterId === (line.character?.id ?? "") ? undefined : null
    }) });
  }, "저장했어요.", line.id);

  async function remove() {
    const line = deleteTarget;
    if (!line || busyId !== null) return;
    deleteOpen = false; deleteTarget = null;
    await run(line.id, () => apiRequest(`/productions/${pid}/blocks/${line.id}?force=true`, { method: "DELETE" }), "삭제했어요.");
  }

  const move = (line: Line, delta: -1 | 1) => {
    const index = lines.findIndex((item) => item.id === line.id);
    const target = index + delta;
    if (target < 0 || target >= lines.length) return Promise.resolve();
    const ids = lines.map((item) => item.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    return run(line.id, () => apiRequest(`/productions/${pid}/scenes/${sceneId}/blocks/reorder`, { method: "POST", body: JSON.stringify({ blockIds: ids }) }));
  };

  async function add(event: SubmitEvent) {
    event.preventDefault();
    if (!newText.trim() || adding) return;
    adding = true;
    try {
      await apiRequest(`/productions/${pid}/scenes/${sceneId}/blocks`, { method: "POST", body: JSON.stringify({
        type: newType, text: newText.trim(), characterId: hasSpeaker(newType) && newRole ? newRole : null
      }) });
      newText = "";
      await load(true);
      await onChanged();
      toast.success("줄을 추가했어요.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "추가하지 못했어요"); }
    finally { adding = false; }
  }
</script>

<section class="space-y-3" aria-label="줄 편집">
  <div>
    <h2 class="text-lg font-semibold">줄 편집 · {sceneTitle}</h2>
    <p class="text-muted-foreground mt-1 text-sm leading-relaxed">줄마다 종류와 화자를 고르고 내용을 고쳐요. 고친 내용은 이 구간의 글에도 바로 반영돼요.</p>
  </div>

  {#if loading && !lines.length}
    <p class="text-muted-foreground py-6 text-center text-sm" role="status">줄을 불러오는 중…</p>
  {:else if !lines.length}
    <p class="text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm">이 장면에는 아직 줄이 없어요. 아래에서 첫 줄을 추가해 주세요.</p>
  {/if}

  <ol class="space-y-2">
    {#each lines as line, index (line.id)}
      {@const draft = drafts[line.id]}
      {#if draft}
        <li class={["rounded-xl border border-s-4 p-3", TYPE_STYLE[draft.type]]}>
          <div class="flex flex-wrap items-center gap-2">
            <select class="bg-background h-10 rounded-lg border px-2 text-sm" bind:value={draft.type} disabled={!canEdit || busyId === line.id} aria-label={`${index + 1}번째 줄 종류`}>
              {#each TYPES as type (type.value)}<option value={type.value}>{type.label}</option>{/each}
            </select>
            {#if hasSpeaker(draft.type)}
              <select class="bg-background h-10 min-w-0 flex-1 rounded-lg border px-2 text-sm" bind:value={draft.characterId} disabled={!canEdit || busyId === line.id} aria-label={`${index + 1}번째 줄 화자`}>
                <option value="">화자 없음(해설)</option>
                {#each roles as role (role.id)}<option value={role.id}>{role.name}</option>{/each}
              </select>
            {/if}
            {#if line.cueLabel && draft.characterId === (line.character?.id ?? "")}<span class="text-muted-foreground text-xs">{line.cueLabel}</span>{/if}
          </div>
          <Textarea class="mt-2 min-h-16 text-base" rows={2} bind:value={draft.text} disabled={!canEdit || busyId === line.id} aria-label={`${index + 1}번째 줄 내용`} />
          {#if canEdit}
            <div class="mt-2 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" class="min-h-10 min-w-10" disabled={busyId !== null || index === 0} onclick={() => move(line, -1)} aria-label={`${index + 1}번째 줄 위로 이동`}><span aria-hidden="true">↑</span></Button>
              <Button size="sm" variant="outline" class="min-h-10 min-w-10" disabled={busyId !== null || index === lines.length - 1} onclick={() => move(line, 1)} aria-label={`${index + 1}번째 줄 아래로 이동`}><span aria-hidden="true">↓</span></Button>
              <Button size="sm" variant="ghost" class="text-destructive min-h-10" disabled={busyId !== null} onclick={() => { deleteTarget = line; deleteOpen = true; }} aria-label={`${index + 1}번째 줄 삭제`}>삭제</Button>
              {#if dirty(line)}<Button size="sm" class="ms-auto min-h-10" disabled={busyId !== null} onclick={() => save(line)}>{busyId === line.id ? "저장 중…" : "저장"}</Button>{/if}
            </div>
            {#if conflicts[line.id]}
              <div class="mt-2 space-y-2 text-sm" role="alert">
                <p>다른 변경 내용이 있어요. 최신 줄을 불러오면 작성 중인 내용을 최신 내용으로 바꿔요.</p>
                <Button size="sm" variant="outline" disabled={busyId !== null || loading} onclick={() => load(true, line.id)}>최신 줄 불러오기</Button>
              </div>
            {/if}
          {/if}
        </li>
      {/if}
    {/each}
  </ol>

  {#if canEdit}
    <form class="bg-muted/30 space-y-2 rounded-xl border border-dashed p-3" onsubmit={add}>
      <p class="text-sm font-semibold">줄 추가 (맨 끝)</p>
      <div class="flex flex-wrap gap-2">
        <select class="bg-background h-10 rounded-lg border px-2 text-sm" bind:value={newType} aria-label="새 줄 종류">
          {#each TYPES as type (type.value)}<option value={type.value}>{type.label}</option>{/each}
        </select>
        {#if hasSpeaker(newType)}
          <select class="bg-background h-10 min-w-0 flex-1 rounded-lg border px-2 text-sm" bind:value={newRole} aria-label="새 줄 화자">
            <option value="">화자 없음(해설)</option>
            {#each roles as role (role.id)}<option value={role.id}>{role.name}</option>{/each}
          </select>
        {/if}
      </div>
      <Textarea class="min-h-16 text-base" rows={2} placeholder="새 줄 내용" bind:value={newText} disabled={adding} />
      <Button type="submit" class="min-h-11" disabled={adding || !newText.trim()}>{adding ? "추가하는 중…" : "줄 추가"}</Button>
    </form>
  {/if}
</section>

<Dialog.Root bind:open={deleteOpen}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>이 줄을 삭제할까요?</Dialog.Title>
      <Dialog.Description>이 줄에 붙은 주석·음악 큐 연결도 끊겨요. 삭제한 줄은 되돌릴 수 없어요.</Dialog.Description>
    </Dialog.Header>
    <Dialog.Footer>
      <Button variant="outline" onclick={() => { deleteOpen = false; deleteTarget = null; }}>취소</Button>
      <Button variant="destructive" disabled={busyId !== null} onclick={remove}>삭제</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
