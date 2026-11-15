<script lang="ts">
  import { beforeNavigate } from "$app/navigation";
  import { tick } from "svelte";
  import { Button } from "$lib/components/ui/button";
  import { fetchCurrentUser } from "$lib/api/auth";
  import { createCommunityPost, getCommunityPost, listCommunity, updateCommunityPost, watchCommunity, type CommunityPost, type MemoAnchor } from "$lib/api/community";
  import { formatTimelineTime } from "$lib/domain/performance-timeline";
  import { formatRelative } from "$lib/domain/labels";
  import LockKeyholeIcon from "@lucide/svelte/icons/lock-keyhole";
  import UsersRoundIcon from "@lucide/svelte/icons/users-round";
  import NotebookPenIcon from "@lucide/svelte/icons/notebook-pen";

  let { pid, source, positionMs, unitKey, unitTitle, onseek, onanchor, onitems = () => {}, ondirty = () => {}, canModerate = false, highlightId = "" }: {
    pid: string; source: string; positionMs: number; unitKey: string; unitTitle: string; onseek: (time: number) => void; onanchor: () => void;
    onitems?: (items: CommunityPost[]) => void; ondirty?: (dirty: boolean) => void; canModerate?: boolean; highlightId?: string;
  } = $props();
  let items = $state<CommunityPost[]>([]);
  let cursor = $state<string | null>(null);
  let userId = $state("");
  let loading = $state(true);
  let error = $state("");
  let busy = $state(false);
  let loadingMore = $state(false);
  let draftAnchor = $state<MemoAnchor | null>(null);
  let editingPost = $state<CommunityPost | null>(null);
  let latestEditingPost = $state<CommunityPost | null>(null);
  let body = $state("");
  let visibility = $state<"PRIVATE" | "TEAM">("PRIVATE");
  let view = $state<"ALL" | "MINE" | "TEAM">("ALL");
  let includeResolved = $state(false);
  let textarea = $state<HTMLTextAreaElement | undefined>();
  let requestVersion = 0;
  const dirty = $derived(Boolean(draftAnchor && body.trim()));
  const visible = $derived(items.filter((item) => (includeResolved || item.status === "OPEN") && (view === "ALL" || (view === "MINE" ? item.author.id === userId : item.visibility === "TEAM"))).sort((a, b) => (a.positionMs ?? 0) - (b.positionMs ?? 0)));
  $effect(() => { onitems(items); });
  $effect(() => { ondirty(dirty); });

  beforeNavigate((navigation) => {
    if (dirty && !window.confirm("작성 중인 시점 메모를 남기고 이동할까요?")) navigation.cancel();
  });
  $effect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  });

  $effect(() => {
    const productionId = pid, selectedSource = source;
    const controller = new AbortController();
    items = []; cursor = null; draftAnchor = null; editingPost = null; latestEditingPost = null; body = ""; visibility = "PRIVATE"; error = ""; loading = true; userId = "";
    void fetchCurrentUser().then((user) => { if (!controller.signal.aborted && productionId === pid && selectedSource === source) userId = user?.id ?? ""; });
    void reload(productionId, selectedSource, controller.signal);
    const stop = watchCommunity(productionId, () => void reload(productionId, selectedSource, controller.signal));
    return () => { controller.abort(); stop(); };
  });

  async function reload(productionId = pid, selectedSource = source, signal?: AbortSignal, older = false) {
    const version = ++requestVersion;
    if (older) loadingMore = true;
    try {
      const result = await listCommunity(productionId, { source: selectedSource, visibility: "ALL", limit: "100", ...(older && cursor ? { cursor } : {}) }, signal);
      const editingId = editingPost?.id;
      const latest = editingId ? result.items.find((post) => post.id === editingId) ?? await getCommunityPost(productionId, editingId, signal) : null;
      if (signal?.aborted || version !== requestVersion || productionId !== pid || selectedSource !== source) return;
      items = older ? [...items, ...result.items.filter((post) => !items.some((item) => item.id === post.id))] : result.items;
      cursor = result.nextCursor; error = "";
      if (editingPost?.id === editingId) latestEditingPost = latest;
    } catch (cause) {
      if (!signal?.aborted && version === requestVersion && productionId === pid && selectedSource === source) error = cause instanceof Error ? cause.message : "시점 메모를 읽지 못했어요.";
    } finally { if (!signal?.aborted && version === requestVersion && productionId === pid && selectedSource === source) { loading = false; loadingMore = false; } }
  }

  export async function start(post?: CommunityPost) {
    if (loading || !userId || busy || (dirty && !window.confirm("작성 중인 내용을 버리고 다른 메모를 열까요?"))) return;
    onanchor();
    draftAnchor = post ? { source: post.source!, unitKey: post.unitKey!, positionMs: post.positionMs!, contextLabel: post.contextLabel! }
      : { source, unitKey, positionMs: Math.round(positionMs), contextLabel: unitTitle.slice(0, 120) };
    editingPost = post ?? null; latestEditingPost = post ?? null; body = post?.body ?? ""; visibility = post?.visibility ?? "PRIVATE"; error = "";
    await tick(); textarea?.focus();
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (!draftAnchor || !body.trim() || busy) return;
    const productionId = pid, selectedSource = source;
    busy = true; error = "";
    try {
      if (editingPost) await updateCommunityPost(productionId, editingPost, { body: body.trim(), visibility });
      else await createCommunityPost(productionId, { ...draftAnchor, body: body.trim(), channel: "REHEARSAL", visibility });
      if (productionId !== pid || selectedSource !== source) return;
      draftAnchor = null; editingPost = null; latestEditingPost = null; body = ""; visibility = "PRIVATE"; await reload(productionId, selectedSource);
    } catch (cause) { if (productionId === pid && selectedSource === source) error = cause instanceof Error ? cause.message : "메모를 저장하지 못했어요."; }
    finally { busy = false; }
  }

  async function patch(post: CommunityPost, input: Parameters<typeof updateCommunityPost>[2]) {
    if (busy) return;
    const productionId = pid, selectedSource = source;
    busy = true; error = "";
    try {
      await updateCommunityPost(productionId, post, input);
      if (productionId === pid && selectedSource === source) await reload(productionId, selectedSource);
    } catch (cause) { if (productionId === pid && selectedSource === source) error = cause instanceof Error ? cause.message : "메모를 변경하지 못했어요."; }
    finally { busy = false; }
  }
</script>

<section class="bg-card space-y-4 rounded-2xl border p-4 sm:p-5" aria-label="시점 메모">
  <header class="flex flex-wrap items-center justify-between gap-3">
    <div><h2 class="flex items-center gap-2 font-bold"><NotebookPenIcon class="size-5 text-primary" />시점 메모</h2><p class="text-muted-foreground mt-1 text-xs">내 연습 메모와 팀 의견을 공연의 특정 시점에 연결해 보세요.</p></div>
    <Button class="min-h-11" disabled={loading || busy || !userId} onclick={() => start()}>현재 {formatTimelineTime(positionMs)}에 메모</Button>
  </header>
  {#if draftAnchor}
    <form class="bg-muted/40 space-y-3 rounded-xl border p-4" onsubmit={save}>
      <p class="text-sm font-semibold">{editingPost ? "메모 수정" : "새 시점 메모"} · {formatTimelineTime(draftAnchor.positionMs)} · {draftAnchor.contextLabel}</p>
      <label class="grid gap-2 text-sm font-medium">메모 내용<textarea bind:this={textarea} class="bg-background min-h-28 w-full rounded-lg border p-3 font-normal" bind:value={body} maxlength="4000" disabled={busy} placeholder="등장 타이밍, 준비 사항, 수정 의견을 적어 주세요."></textarea></label>
      {#if editingPost && latestEditingPost && editingPost.revision !== latestEditingPost.revision}
        <div class="space-y-2 rounded-lg border p-3 text-sm"><p class="font-semibold">편집하는 동안 메모가 바뀌었어요. 최신 내용과 내 수정안을 확인해 주세요.</p><p class="whitespace-pre-wrap break-words text-muted-foreground">{latestEditingPost.body}</p><Button variant="outline" class="min-h-11" disabled={busy} onclick={() => { editingPost = { ...latestEditingPost! }; error = ""; }}>수정안 유지 · 최신 버전 기준으로 맞추기</Button></div>
      {/if}
      <fieldset class="space-y-2"><legend class="text-sm font-medium">공개 범위</legend><div class="grid grid-cols-2 gap-2"><label class="bg-background flex min-h-12 items-center gap-2 rounded-lg border p-3 text-sm"><input type="radio" bind:group={visibility} value="PRIVATE" disabled={busy} /><LockKeyholeIcon class="size-4" />나만 보기</label><label class="bg-background flex min-h-12 items-center gap-2 rounded-lg border p-3 text-sm"><input type="radio" bind:group={visibility} value="TEAM" disabled={busy} /><UsersRoundIcon class="size-4" />팀 공유</label></div></fieldset>
      <p class="text-muted-foreground text-xs leading-5">{visibility === "PRIVATE" ? "작성자만 볼 수 있어요. 나중에 팀에 공유할 수도 있어요." : "이 공연의 참여자와 관리자가 읽고 답글을 달 수 있어요. 원본 대본은 기획자가 수정해요."}</p>
      <div class="flex items-center justify-between gap-2"><span class="text-muted-foreground text-xs">{body.length}/4,000</span><div class="flex gap-2"><Button variant="outline" class="min-h-11" disabled={busy} onclick={() => { if (!dirty || window.confirm("작성 중인 메모를 버릴까요?")) { draftAnchor = null; editingPost = null; latestEditingPost = null; body = ""; } }}>취소</Button><Button type="submit" class="min-h-11" disabled={busy || !body.trim()}>{busy ? "저장 중…" : visibility === "PRIVATE" ? "내 메모 저장" : "팀에 공유"}</Button></div></div>
    </form>
  {/if}
  <div class="flex flex-wrap items-center justify-between gap-2">
    <div class="flex flex-wrap gap-1" aria-label="메모 필터">{#each [{ id: "ALL", label: "함께 보기" }, { id: "MINE", label: "내 메모" }, { id: "TEAM", label: "팀 공유" }] as filter (filter.id)}<button class="min-h-11 rounded-lg px-3 text-sm {view === filter.id ? 'bg-primary/10 text-primary font-semibold' : 'text-muted-foreground hover:bg-accent'}" aria-pressed={view === filter.id} onclick={() => view = filter.id as typeof view}>{filter.label}</button>{/each}</div>
    <label class="flex min-h-11 items-center gap-2 text-xs"><input type="checkbox" bind:checked={includeResolved} />처리 완료 포함</label>
  </div>
  {#if loading}<p role="status" class="text-sm">메모를 불러오는 중…</p>
  {:else}
    <div class="grid max-h-[42dvh] gap-2 overflow-y-auto">
      {#each visible as post (post.id)}
        <article class="space-y-2 rounded-xl border p-3" class:ring-2={highlightId === post.id} class:ring-primary={highlightId === post.id}>
          <div class="flex flex-wrap items-center justify-between gap-1"><button class="text-primary min-h-11 text-start text-xs font-semibold" onclick={() => onseek(post.positionMs ?? 0)}><span class="font-mono">{formatTimelineTime(post.positionMs ?? 0)}</span> · {post.contextLabel}</button><span class="text-muted-foreground flex items-center gap-1 text-xs">{#if post.visibility === "PRIVATE"}<LockKeyholeIcon class="size-3" />나만 보기{:else}<UsersRoundIcon class="size-3" />팀 공유{/if}{post.status === "RESOLVED" ? " · 처리 완료" : ""}</span></div>
          <p class="whitespace-pre-wrap break-words text-sm leading-6">{post.body}</p>
          <p class="text-muted-foreground text-xs">{post.author.name} · {formatRelative(post.createdAt)}</p>
          <div class="flex flex-wrap gap-2">
            <Button href={`/app/p/${pid}/board/${post.id}`} variant="outline" class="min-h-11 text-xs">답글 {post._count?.comments ?? 0} · 대화 열기</Button>
            {#if post.author.id === userId}<Button variant="ghost" class="min-h-11 text-xs" disabled={busy} onclick={() => start(post)}>수정</Button><Button variant="ghost" class="min-h-11 text-xs" disabled={busy} onclick={() => patch(post, { visibility: post.visibility === "PRIVATE" ? "TEAM" : "PRIVATE" })}>{post.visibility === "PRIVATE" ? "팀에 공유" : "나만 보기로"}</Button>{/if}
            {#if post.author.id === userId || (canModerate && post.visibility === "TEAM")}<Button variant="ghost" class="min-h-11 text-xs" disabled={busy} onclick={() => patch(post, { status: post.status === "OPEN" ? "RESOLVED" : "OPEN" })}>{post.status === "OPEN" ? "처리 완료" : "다시 열기"}</Button>{/if}
          </div>
        </article>
      {:else}<p class="text-muted-foreground rounded-xl border border-dashed p-5 text-center text-sm">아직 표시할 시점 메모가 없어요. 연습 중 기억할 내용이나 팀에 확인하고 싶은 의견을 남겨 보세요.</p>{/each}
    </div>
    {#if cursor}<Button variant="outline" class="min-h-11 w-full" disabled={loadingMore} onclick={() => reload(pid, source, undefined, true)}>{loadingMore ? "불러오는 중…" : "이전 시점 메모 더 보기"}</Button>{/if}
  {/if}
  {#if error}<div role="alert" class="space-y-2 text-sm text-destructive"><p>{error}</p><Button variant="outline" class="min-h-11" disabled={busy} onclick={() => reload()}>최신 내용 불러오기</Button></div>{/if}
</section>
