<script lang="ts">
  import { goto } from "$app/navigation";
  import { onDestroy } from "svelte";
  import { ConfirmDialog, type ConfirmAsk } from "$lib/components/ui/confirm-dialog";
  import { Button } from "$lib/components/ui/button";
  import { apiRequest } from "$lib/api/client";
  import { getCommunityPost, updateCommunityPost, watchCommunity, rehearsalLink, COMMUNITY_CHANNELS, type CommunityPost, type CommunityComment } from "$lib/api/community";
  import { formatRelative } from "$lib/domain/labels";
  import { formatTimelineTime } from "$lib/domain/performance-timeline";
  import XIcon from "@lucide/svelte/icons/x";
  import LockKeyholeIcon from "@lucide/svelte/icons/lock-keyhole";
  import MessageCircleIcon from "@lucide/svelte/icons/message-circle";

  let { pid, postId, userId, canModerate = false, onDirty }: { pid: string; postId: string; userId: string; canModerate?: boolean; onDirty?: (dirty: boolean) => void } = $props();
  let post = $state<CommunityPost | null>(null);
  let loading = $state(true);
  let error = $state("");
  let body = $state("");
  let busy = $state(false);
  let editing = $state(false);
  let editBody = $state("");
  let editingSnapshot = $state<CommunityPost | null>(null);
  let requestVersion = 0;
  const canEdit = $derived(post && (post.author.id === userId || (canModerate && post.visibility === "TEAM")));
  const dirty = $derived(Boolean(body.trim() || (editingSnapshot && editBody !== editingSnapshot.body)));
  let confirmation: { ask: ConfirmAsk };
  $effect(() => { onDirty?.(dirty); });
  onDestroy(() => onDirty?.(false));
  $effect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  });

  $effect(() => {
    const productionId = pid, id = postId;
    const controller = new AbortController();
    post = null; body = ""; error = ""; loading = true; editing = false; editBody = ""; editingSnapshot = null;
    void reload(productionId, id, controller.signal);
    const stop = watchCommunity(productionId, (changedId) => {
      if (!changedId || changedId === id) void reload(productionId, id, controller.signal);
    });
    return () => { controller.abort(); stop(); };
  });

  async function reload(productionId = pid, id = postId, signal?: AbortSignal) {
    const version = ++requestVersion;
    try {
      const found = await getCommunityPost(productionId, id, signal);
      if (signal?.aborted || version !== requestVersion || productionId !== pid || id !== postId) return;
      post = found; error = "";
    } catch (cause) {
      if (!signal?.aborted && version === requestVersion && productionId === pid && id === postId) {
        post = null; error = cause instanceof Error ? cause.message : "대화를 불러오지 못했어요.";
      }
    } finally {
      if (!signal?.aborted && version === requestVersion && productionId === pid && id === postId) loading = false;
    }
  }

  async function patch(input: Parameters<typeof updateCommunityPost>[2], original = post) {
    if (!original || busy) return;
    const productionId = pid, id = original.id;
    busy = true; error = "";
    try {
      await updateCommunityPost(productionId, original, input);
      if (productionId !== pid || id !== postId) return;
      editing = false; editingSnapshot = null; await reload(productionId, id);
    } catch (cause) { if (productionId === pid && id === postId) error = cause instanceof Error ? cause.message : "저장하지 못했어요."; }
    finally { busy = false; }
  }

  async function reply(event: SubmitEvent) {
    event.preventDefault();
    if (!post || !body.trim() || busy) return;
    const productionId = pid, id = post.id;
    busy = true; error = "";
    try {
      await apiRequest<CommunityComment>(`/productions/${productionId}/board/${id}/comments`, { method: "POST", body: JSON.stringify({ body: body.trim() }) });
      if (productionId !== pid || id !== postId) return;
      body = ""; await reload(productionId, id);
    } catch (cause) { if (productionId === pid && id === postId) error = cause instanceof Error ? cause.message : "답글을 보내지 못했어요."; }
    finally { busy = false; }
  }

  async function remove(commentId?: string) {
    if (!post || busy) return;
    const productionId = pid, id = post.id;
    const answer = await confirmation.ask({
      title: commentId ? "답글을 삭제할까요?" : post.visibility === "PRIVATE" ? "나만 보기 메모를 삭제할까요?" : "팀 대화를 삭제할까요?",
      description: commentId ? "이 답글만 삭제해요. 대화 본문과 다른 답글은 남아요. 삭제한 답글은 되돌릴 수 없어요." : `이 글과 달린 답글 ${post.comments?.length ?? post._count?.comments ?? 0}개를 모두 삭제해요. 삭제한 내용은 되돌릴 수 없어요.`,
      confirmLabel: commentId ? "답글 삭제" : "글과 답글 삭제", destructive: true
    });
    if (!answer.confirmed || busy || productionId !== pid || id !== postId) return;
    busy = true; error = "";
    try {
      await apiRequest(`/productions/${productionId}/board/${id}${commentId ? `/comments/${commentId}` : ""}`, { method: "DELETE" });
      if (productionId !== pid || id !== postId) return;
      if (commentId) await reload(productionId, id);
      else { body = ""; editing = false; editingSnapshot = null; onDirty?.(false); await goto(`/app/p/${productionId}/board`); }
    } catch (cause) { if (productionId === pid && id === postId) error = cause instanceof Error ? cause.message : "삭제하지 못했어요."; }
    finally { busy = false; }
  }
  async function changeVisibility() {
    if (!post || busy) return;
    const original = post;
    const productionId = pid;
    const visibility = original.visibility === "PRIVATE" ? "TEAM" : "PRIVATE";
    const answer = await confirmation.ask({
      title: visibility === "TEAM" ? "공연팀에 공유할까요?" : "나만 보기로 바꿀까요?",
      description: visibility === "TEAM" ? "이 메모와 달린 답글을 이 공연의 참여자가 볼 수 있어요. 개인적인 내용이 포함됐는지 확인해 주세요." : "이 메모와 달린 답글을 작성자만 볼 수 있게 바꿔요. 공연팀에서는 더 이상 보이지 않아요.",
      confirmLabel: visibility === "TEAM" ? "공연팀에 공유" : "나만 보기로 변경"
    });
    if (answer.confirmed && productionId === pid && original.id === postId) await patch({ visibility }, original);
  }

</script>

<section class="bg-card min-w-0 overflow-hidden rounded-2xl border" aria-label="대화 답글">
  <header class="flex min-h-14 items-center justify-between gap-2 border-b px-4">
    <h2 class="flex items-center gap-2 font-bold"><MessageCircleIcon class="size-4 text-primary" />주제별 답글</h2>
    <Button href={`/app/p/${pid}/board`} variant="ghost" class="size-11" aria-label="대화 목록으로"><XIcon class="size-4" /></Button>
  </header>
  {#if loading}<p role="status" class="p-5 text-sm">대화를 불러오는 중…</p>
  {:else if post}
    <article class="space-y-3 border-b p-4 sm:p-5">
      <div class="flex flex-wrap items-center gap-2 text-xs">
        <span class="bg-muted rounded-md px-2 py-1 font-medium"># {COMMUNITY_CHANNELS.find((channel) => channel.id === post?.channel)?.label ?? "대화"}</span>
        {#if post.visibility === "PRIVATE"}<span class="flex items-center gap-1"><LockKeyholeIcon class="size-3" />나만 보기</span>{:else}<span>팀 공유</span>{/if}
        {#if post.status === "RESOLVED"}<span class="text-primary font-semibold">처리 완료</span>{/if}
        {#if post.pinned}<span class="text-primary">상단 고정</span>{/if}
      </div>
      {#if post.category !== "QUESTION"}<h3 class="break-words text-lg font-bold">{post.title}</h3>{/if}
      <p class="text-muted-foreground break-words text-xs">{post.author.name} · {formatRelative(post.createdAt)}</p>
      {#if post.source !== null}
        <a href={rehearsalLink(pid, post)} class="bg-primary/5 text-primary flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium">
          <span class="font-mono">{formatTimelineTime(post.positionMs ?? 0)}</span><span class="min-w-0 break-words">{post.contextLabel} · 연습 화면에서 보기</span>
        </a>
        <p class="text-muted-foreground text-xs">메모를 작성할 때의 공연 시점이에요. 구간 시간이 바뀌었다면 연결 시점을 다시 확인해 주세요.</p>
      {/if}
      {#if editing}
        <form class="space-y-2" onsubmit={(event) => { event.preventDefault(); void patch({ body: editBody.trim() }, editingSnapshot); }}>
          <label class="grid gap-1 text-sm font-medium">내용 수정<textarea class="bg-background min-h-28 rounded-lg border p-3 font-normal" bind:value={editBody} maxlength="4000" disabled={busy}></textarea></label>
          {#if editingSnapshot && editingSnapshot.revision !== post.revision}<div class="space-y-2 rounded-lg border p-3 text-sm"><p class="font-semibold">편집 중 대화가 바뀌었어요. 최신 내용과 내 수정안을 확인해 주세요.</p><p class="whitespace-pre-wrap break-words text-muted-foreground">{post.body}</p><Button variant="outline" class="min-h-11" disabled={busy} onclick={() => { editingSnapshot = { ...post! }; error = ""; }}>수정안 유지 · 최신 버전 기준으로 맞추기</Button></div>{/if}
          <div class="flex gap-2"><Button type="submit" class="min-h-11" disabled={busy || !editBody.trim()}>수정 저장</Button><Button variant="outline" class="min-h-11" disabled={busy} onclick={() => { editing = false; editingSnapshot = null; }}>취소</Button></div>
        </form>
      {:else}<p class="whitespace-pre-wrap break-words text-sm leading-7">{post.body}</p>{/if}
      {#if post.channel === "MATERIAL"}
        {#each [...new Set(post.body.match(/https?:\/\/[^\s<>]+/g) ?? [])].slice(0, 5) as link (link)}
          <a href={link} target="_blank" rel="noopener noreferrer" class="text-primary block min-h-11 break-all py-2 text-sm underline">자료 열기 · {link}</a>
        {/each}
      {/if}
      {#if canEdit && !editing}
        <div class="flex flex-wrap gap-2">
          <Button variant="outline" class="min-h-11" disabled={busy} onclick={() => { editingSnapshot = { ...post! }; editBody = post!.body; editing = true; }}>수정</Button>
          <Button variant="outline" class="min-h-11" disabled={busy} onclick={() => patch({ status: post!.status === "OPEN" ? "RESOLVED" : "OPEN" })}>{post.status === "OPEN" ? "처리 완료" : "다시 열기"}</Button>
          {#if post.source && post.author.id === userId}
            <Button variant="outline" class="min-h-11" disabled={busy} onclick={changeVisibility}>{post.visibility === "PRIVATE" ? "팀에 공유" : "나만 보기로"}</Button>
          {/if}
          {#if canModerate && post.visibility === "TEAM"}<Button variant="outline" class="min-h-11" disabled={busy} onclick={() => patch({ pinned: !post!.pinned })}>{post.pinned ? "고정 해제" : "상단 고정"}</Button>{/if}
          <Button variant="ghost" class="text-muted-foreground min-h-11" disabled={busy} onclick={() => remove()}>삭제</Button>
        </div>
      {/if}
      {#if post.visibility === "PRIVATE"}<p class="text-muted-foreground text-xs">작성자만 볼 수 있어요. 팀에 공유하면 이 메모와 답글을 이 공연의 참여자가 볼 수 있어요.</p>{/if}
    </article>
    <div class="max-h-[42dvh] space-y-4 overflow-y-auto p-4 sm:p-5" aria-label="답글 목록">
      {#each post.comments ?? [] as comment (comment.id)}
        <article class="flex gap-3">
          <span class="bg-muted flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold" aria-hidden="true">{comment.author.name.slice(0, 1)}</span>
          <div class="min-w-0 flex-1"><p class="break-words text-xs font-semibold">{comment.author.name} <span class="text-muted-foreground font-normal">· {formatRelative(comment.createdAt)}</span></p><p class="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{comment.body}</p>
            {#if comment.author.id === userId || canModerate}<Button variant="ghost" class="text-muted-foreground mt-1 min-h-11 px-2 text-xs" disabled={busy} onclick={() => remove(comment.id)}>답글 삭제</Button>{/if}
          </div>
        </article>
      {:else}<p class="text-muted-foreground text-sm">이 주제에 대한 의견을 답글로 이어보세요.</p>{/each}
    </div>
    <form class="space-y-2 border-t p-4" onsubmit={reply}>
      <label class="grid gap-2 text-sm font-medium">답글<textarea class="bg-background min-h-24 rounded-xl border p-3 font-normal" bind:value={body} maxlength="2000" placeholder="준비 사항이나 의견을 답글로 남겨 주세요." disabled={busy}></textarea></label>
      <div class="flex items-center justify-between gap-2"><span class="text-muted-foreground text-xs">{body.length}/2,000</span><Button type="submit" class="min-h-11" disabled={busy || !body.trim()}>{busy ? "저장 중…" : "답글 보내기"}</Button></div>
    </form>
  {/if}
  {#if error}<div role="alert" class="space-y-2 border-t p-4 text-sm text-destructive"><p>{error}</p><Button variant="outline" class="min-h-11" disabled={busy} onclick={() => reload()}>최신 내용 불러오기</Button></div>{/if}
</section>

<ConfirmDialog bind:this={confirmation} />
