<script lang="ts">
    import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import { toast } from "svelte-sonner";
  import * as Avatar from "$lib/components/ui/avatar";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import { Textarea } from "$lib/components/ui/textarea";
  import { apiRequest } from "$lib/api/client";
  import { fetchCurrentUser, isAdminRole, type CurrentUser } from "$lib/api/auth";
  import { getMyProduction, isProductionStaff } from "$lib/api/productions";
  import { formatRelative } from "$lib/domain/labels";
  import ChevronLeftIcon from "@lucide/svelte/icons/chevron-left";
  import PinIcon from "@lucide/svelte/icons/pin";

  type Comment = {
    id: string;
    body: string;
    createdAt: string;
    author: { id: string; name: string };
  };

  type Post = {
    id: string;
    category: "NOTICE" | "QUESTION" | "MATERIAL";
    title: string;
    body: string;
    pinned: boolean;
    createdAt: string;
    author: { id: string; name: string };
    comments: Comment[];
  };

  const pid = $derived($page.params.pid ?? "");
  const postId = $derived($page.params.postId ?? "");

  const CATEGORY_LABELS: Record<string, string> = {
    NOTICE: "공지",
    QUESTION: "질문",
    MATERIAL: "자료"
  };

  let me = $state<CurrentUser | null>(null);
  let post = $state<Post | null>(null);
  let loading = $state(true);
  let isStaff = $state(false);
  let commentBody = $state("");
  let commentSaving = $state(false);

  const canModerate = $derived(isAdminRole(me?.platformRole) || isStaff);
  const canDelete = $derived(post && me && (post.author.id === me.id || canModerate));

  async function loadPage() {
    try {
      const [user, found, production] = await Promise.all([
        fetchCurrentUser(),
        apiRequest<Post>(`/productions/${pid}/board/${postId}`),
        getMyProduction(pid).catch(() => null)
      ]);
      me = user;
      post = found;
      isStaff = isProductionStaff(production, user?.platformRole);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "글을 불러오지 못했습니다");
    } finally {
      loading = false;
    }
  }

  // pid가 바뀌어도(같은 라우트에서 공연 전환·딥링크) 다시 불러온다 — onMount는 재실행되지 않음.
  $effect(() => {
    void pid;
    void postId;
    void loadPage();
  });

  async function addComment(event: SubmitEvent) {
    event.preventDefault();
    if (!post || !commentBody.trim()) return;
    commentSaving = true;
    try {
      const created = await apiRequest<Comment>(`/productions/${pid}/board/${post.id}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: commentBody.trim() })
      });
      post = { ...post, comments: [...post.comments, created] };
      commentBody = "";
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "댓글을 등록하지 못했습니다");
    } finally {
      commentSaving = false;
    }
  }

  async function removeComment(comment: Comment) {
    if (!post) return;
    try {
      await apiRequest(`/productions/${pid}/board/${post.id}/comments/${comment.id}`, { method: "DELETE" });
      post = { ...post, comments: post.comments.filter((item) => item.id !== comment.id) };
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "댓글을 삭제하지 못했습니다");
    }
  }

  let confirmingPostDelete = $state(false);
  let postConfirmTimer: ReturnType<typeof setTimeout> | undefined;

  function requestRemovePost() {
    if (confirmingPostDelete) {
      confirmingPostDelete = false;
      clearTimeout(postConfirmTimer);
      void removePost();
      return;
    }
    confirmingPostDelete = true;
    clearTimeout(postConfirmTimer);
    postConfirmTimer = setTimeout(() => (confirmingPostDelete = false), 3000);
  }

  async function removePost() {
    if (!post) return;
    try {
      await apiRequest(`/productions/${pid}/board/${post.id}`, { method: "DELETE" });
      toast.success("글을 삭제했습니다");
      await goto(`/app/p/${pid}/board`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "글을 삭제하지 못했습니다");
    }
  }

  function canDeleteComment(comment: Comment) {
    return me && (comment.author.id === me.id || canModerate);
  }
</script>

<svelte:head>
  <title>{post?.title ?? "소통"} — 아트브릿지</title>
</svelte:head>

<div class="mx-auto w-full max-w-xl">
  <div class="flex items-center gap-1 py-2">
    <Button href={`/app/p/${pid}/board`} variant="ghost" size="icon" class="-ms-2 size-8" aria-label="소통 목록으로">
      <ChevronLeftIcon />
    </Button>
    <h1 class="text-xl font-bold tracking-tight">소통</h1>
  </div>

  {#if loading}
    <div class="mt-4 space-y-2">
      <Skeleton class="h-40 w-full rounded-2xl" />
      <Skeleton class="h-24 w-full rounded-2xl" />
    </div>
  {:else if !post}
    <div class="bg-card mt-4 rounded-2xl px-6 py-14 text-center">
      <p class="font-semibold">글을 찾을 수 없습니다</p>
    </div>
  {:else}
    <article class="bg-card mt-2 rounded-2xl p-5">
      <div class="flex items-center gap-2">
        <Badge variant={post.category === "NOTICE" ? "default" : "secondary"} class="text-xs">
          {CATEGORY_LABELS[post.category] ?? post.category}
        </Badge>
        {#if post.pinned}
          <PinIcon class="text-primary size-3.5" />
        {/if}
      </div>
      <h2 class="mt-2 text-lg font-bold">{post.title}</h2>
      <p class="text-muted-foreground mt-1 text-xs">{post.author.name} · {formatRelative(post.createdAt)}</p>
      <p class="mt-4 text-sm leading-relaxed whitespace-pre-wrap">{post.body}</p>
      {#if canDelete}
        <div class="mt-4 flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            class={`h-7 px-2 text-xs ${confirmingPostDelete ? "text-destructive font-semibold" : "text-muted-foreground"}`}
            onclick={requestRemovePost}
          >
            {confirmingPostDelete ? "한 번 더 누르면 삭제돼요" : "삭제"}
          </Button>
        </div>
      {/if}
    </article>

    <section class="mt-4">
      <p class="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase">
        답글 {post.comments.length}
      </p>
      <div class="grid gap-2">
        {#each post.comments as comment (comment.id)}
          <div class="bg-card flex items-start gap-3 rounded-2xl px-4 py-3">
            <Avatar.Root class="mt-0.5 size-7 rounded-lg">
              <Avatar.Fallback class="rounded-lg text-xs">{comment.author.name.slice(0, 1)}</Avatar.Fallback>
            </Avatar.Root>
            <div class="min-w-0 flex-1">
              <p class="text-xs font-medium">
                {comment.author.name}
                <span class="text-muted-foreground font-normal">· {formatRelative(comment.createdAt)}</span>
              </p>
              <p class="mt-0.5 text-sm leading-relaxed whitespace-pre-wrap">{comment.body}</p>
            </div>
            {#if canDeleteComment(comment)}
              <Button
                variant="ghost"
                size="sm"
                class="text-muted-foreground h-6 shrink-0 px-2 text-xs"
                onclick={() => removeComment(comment)}
              >
                삭제
              </Button>
            {/if}
          </div>
        {/each}
      </div>

      <form class="mt-3 grid gap-2" onsubmit={addComment}>
        <Textarea bind:value={commentBody} rows={2} maxlength={2000} placeholder="답글을 남겨주세요" />
        <div class="flex justify-end">
          <Button type="submit" size="sm" disabled={commentSaving || !commentBody.trim()}>
            {commentSaving ? "등록 중..." : "답글 등록"}
          </Button>
        </div>
      </form>
    </section>
  {/if}
</div>
