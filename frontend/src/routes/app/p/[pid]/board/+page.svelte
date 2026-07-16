<script lang="ts">
    import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import { toast } from "svelte-sonner";
  import * as Dialog from "$lib/components/ui/dialog";
  import * as Select from "$lib/components/ui/select";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import { Textarea } from "$lib/components/ui/textarea";
  import { apiRequest } from "$lib/api/client";
  import { fetchCurrentUser } from "$lib/api/auth";
  import { getMyProduction, isProductionStaff } from "$lib/api/productions";
  import { formatRelative } from "$lib/domain/labels";
  import ChevronLeftIcon from "@lucide/svelte/icons/chevron-left";
  import PinIcon from "@lucide/svelte/icons/pin";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import MessageCircleIcon from "@lucide/svelte/icons/message-circle";

  type Post = {
    id: string;
    category: "NOTICE" | "QUESTION" | "MATERIAL";
    title: string;
    body: string;
    pinned: boolean;
    createdAt: string;
    author: { id: string; name: string };
    _count: { comments: number };
  };

  const pid = $derived($page.params.pid ?? "");

  const CATEGORY_LABELS: Record<string, string> = {
    NOTICE: "공지",
    QUESTION: "질문",
    MATERIAL: "자료"
  };

  const FILTERS = ["ALL", "NOTICE", "QUESTION", "MATERIAL"] as const;

  let posts = $state<Post[]>([]);
  let title = $state("소통");
  let filter = $state<(typeof FILTERS)[number]>("ALL");
  let isStaff = $state(false);
  let loading = $state(true);

  let writeOpen = $state(false);
  let formCategory = $state("QUESTION");
  let formTitle = $state("");
  let formBody = $state("");
  let saving = $state(false);

  const visible = $derived(filter === "ALL" ? posts : posts.filter((post) => post.category === filter));

  async function loadPage() {
    try {
      const [me, production, board] = await Promise.all([
        fetchCurrentUser(),
        getMyProduction(pid),
        apiRequest<{ items: Post[] }>(`/productions/${pid}/board`)
      ]);
      if (production) title = production.title;
      isStaff = isProductionStaff(production, me?.platformRole);
      posts = board.items;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "글을 불러오지 못했습니다");
    } finally {
      loading = false;
    }
  }

  // pid가 바뀌어도(같은 라우트에서 공연 전환·딥링크) 다시 불러온다 — onMount는 재실행되지 않음.
  $effect(() => {
    void pid;
    void loadPage();
  });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    saving = true;
    try {
      const created = await apiRequest<Post>(`/productions/${pid}/board`, {
        method: "POST",
        body: JSON.stringify({ category: formCategory, title: formTitle.trim(), body: formBody.trim() })
      });
      writeOpen = false;
      formTitle = formBody = "";
      formCategory = "QUESTION";
      await goto(`/app/p/${pid}/board/${created.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "글을 등록하지 못했습니다");
    } finally {
      saving = false;
    }
  }

  function categoryVariant(category: string): "default" | "secondary" | "outline" {
    if (category === "NOTICE") return "default";
    if (category === "MATERIAL") return "outline";
    return "secondary";
  }
</script>

<svelte:head>
  <title>소통 — {title}</title>
</svelte:head>

<div class="mx-auto w-full max-w-xl">
  <div class="flex items-center gap-1 py-2">
    <Button href={`/app/p/${pid}`} variant="ghost" size="icon" class="-ms-2 size-8" aria-label="공연 홈으로">
      <ChevronLeftIcon />
    </Button>
    <div>
      <h1 class="text-xl font-bold tracking-tight">소통</h1>
      <p class="text-muted-foreground text-sm">{title}</p>
    </div>
    <Button size="sm" class="ms-auto" onclick={() => (writeOpen = true)}>
      <PlusIcon />
      글쓰기
    </Button>
  </div>

  <div class="mt-1 flex gap-1.5">
    {#each FILTERS as value (value)}
      <Button
        variant={filter === value ? "secondary" : "ghost"}
        size="sm"
        class="h-7 px-3 text-xs"
        onclick={() => (filter = value)}
      >
        {value === "ALL" ? "전체" : CATEGORY_LABELS[value]}
      </Button>
    {/each}
  </div>

  {#if loading}
    <div class="mt-4 space-y-2">
      {#each Array(4) as _, i (i)}
        <Skeleton class="h-20 w-full rounded-2xl" />
      {/each}
    </div>
  {:else if visible.length === 0}
    <div class="bg-card mt-4 rounded-2xl px-6 py-14 text-center">
      <p class="font-semibold">아직 글이 없습니다</p>
      <p class="text-muted-foreground mt-1 text-sm">공지, 질문, 자료를 이 공연의 참여자들과 나눠보세요.</p>
      <Button size="sm" class="mt-5" onclick={() => (writeOpen = true)}>첫 글 쓰기</Button>
    </div>
  {:else}
    <div class="mt-4 grid gap-2">
      {#each visible as post (post.id)}
        <a
          href={`/app/p/${pid}/board/${post.id}`}
          class="bg-card hover:bg-accent/60 block rounded-2xl px-5 py-4 transition-colors"
        >
          <div class="flex items-center gap-2">
            <Badge variant={categoryVariant(post.category)} class="text-xs">
              {CATEGORY_LABELS[post.category] ?? post.category}
            </Badge>
            {#if post.pinned}
              <PinIcon class="text-primary size-3.5" />
            {/if}
            <span class="truncate font-semibold">{post.title}</span>
          </div>
          <p class="text-muted-foreground mt-1 line-clamp-1 text-sm">{post.body}</p>
          <p class="text-muted-foreground/80 mt-1.5 flex items-center gap-1 text-xs">
            {post.author.name} · {formatRelative(post.createdAt)}
            {#if post._count.comments > 0}
              · <MessageCircleIcon class="size-3" /> {post._count.comments}
            {/if}
          </p>
        </a>
      {/each}
    </div>
  {/if}
</div>

<Dialog.Root bind:open={writeOpen}>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>글쓰기</Dialog.Title>
      <Dialog.Description>이 공연의 참여자 모두가 볼 수 있습니다.</Dialog.Description>
    </Dialog.Header>
    <form class="grid gap-4" onsubmit={submit}>
      <div class="grid gap-2">
        <Label>분류</Label>
        <Select.Root type="single" bind:value={formCategory}>
          <Select.Trigger class="w-full">{CATEGORY_LABELS[formCategory] ?? formCategory}</Select.Trigger>
          <Select.Content>
            <Select.Item value="QUESTION" label="질문" />
            <Select.Item value="MATERIAL" label="자료" />
            {#if isStaff}
              <Select.Item value="NOTICE" label="공지 (상단 고정)" />
            {/if}
          </Select.Content>
        </Select.Root>
      </div>
      <div class="grid gap-2">
        <Label for="postTitle">제목</Label>
        <Input id="postTitle" bind:value={formTitle} required maxlength={120} />
      </div>
      <div class="grid gap-2">
        <Label for="postBody">내용</Label>
        <Textarea id="postBody" bind:value={formBody} required rows={5} maxlength={4000} />
      </div>
      <Dialog.Footer>
        <Button type="button" variant="ghost" onclick={() => (writeOpen = false)}>취소</Button>
        <Button type="submit" disabled={saving || !formTitle.trim() || !formBody.trim()}>
          {saving ? "등록 중..." : "등록"}
        </Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
