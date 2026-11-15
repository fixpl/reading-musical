<script lang="ts">
  import { beforeNavigate, goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { ConfirmDialog, type ConfirmAsk } from "$lib/components/ui/confirm-dialog";
  import { Button } from "$lib/components/ui/button";
  import { fetchCurrentUser, type CurrentUser } from "$lib/api/auth";
  import { getMyProduction, isProductionStaff } from "$lib/api/productions";
  import { COMMUNITY_CHANNELS, createCommunityPost, listCommunity, rehearsalLink, watchCommunity, type CommunityChannel, type CommunityPost } from "$lib/api/community";
  import CommunityThread from "./community-thread.svelte";
  import { formatRelative } from "$lib/domain/labels";
  import { formatTimelineTime } from "$lib/domain/performance-timeline";
  import HashIcon from "@lucide/svelte/icons/hash";
  import MessageCircleIcon from "@lucide/svelte/icons/message-circle";
  import PinIcon from "@lucide/svelte/icons/pin";
  import LockKeyholeIcon from "@lucide/svelte/icons/lock-keyhole";
  import SendIcon from "@lucide/svelte/icons/send";

  let { pid, postId = "" }: { pid: string; postId?: string } = $props();
  let user = $state<CurrentUser | null>(null);
  let title = $state("공연");
  let isStaff = $state(false);
  let posts = $state<CommunityPost[]>([]);
  let cursor = $state<string | null>(null);
  let loading = $state(true);
  let loadingMore = $state(false);
  let error = $state("");
  let connected = $state(false);
  let body = $state("");
  let subject = $state("");
  let saving = $state(false);
  let status = $state<"ALL" | "OPEN" | "RESOLVED">("ALL");
  let search = $state("");
  let requestVersion = 0;
  const channel = $derived.by(() => {
    const value = $page.url.searchParams.get("channel") ?? "ALL";
    return value === "MINE" || COMMUNITY_CHANNELS.some((item) => item.id === value) ? value : "ALL";
  });
  const channelInfo = $derived(COMMUNITY_CHANNELS.find((item) => item.id === channel));
  const channelTitle = $derived(channel === "ALL" ? "전체 대화" : channel === "MINE" ? "내 시점 메모" : channelInfo?.label ?? "전체 대화");
  const needsTitle = $derived(channel === "NOTICE" || channel === "MATERIAL");
  const canWrite = $derived(channel !== "MINE" && (channel !== "NOTICE" || isStaff));
  const visible = $derived(posts.filter((post) => (!search.trim() || [post.body, post.title, post.author.name, post.contextLabel ?? ""].some((text) => text.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))) && (status === "ALL" || post.status === status)));

  let confirmation: { ask: ConfirmAsk };
  let threadDirty = $state(false);
  let leaving = false;
  let askingLeave = false;
  let resumedPopstate: { href: string; delta: number } | null = null;
  beforeNavigate((navigation) => {
    if (resumedPopstate && navigation.type === "popstate" && navigation.delta === resumedPopstate.delta && navigation.to?.url.href === resumedPopstate.href) {
      resumedPopstate = null;
      return;
    }
    if (leaving || !(body.trim() || subject.trim() || threadDirty)) return;
    navigation.cancel();
    // 탭을 닫거나 외부 사이트로 이동할 때는 브라우저의 기본 이탈 보호를 사용한다.
    if (navigation.willUnload || !navigation.to?.url || askingLeave) return;
    void confirmLeave(navigation.to.url, navigation.type === "popstate" ? navigation.delta : undefined);
  });
  async function confirmLeave(target: URL, delta?: number) {
    askingLeave = true;
    try {
      const answer = await confirmation.ask({ title: "작성 중인 내용을 남기고 이동할까요?", description: "보내지 않은 대화·답글과 저장하지 않은 수정 내용은 사라져요.", confirmLabel: "저장하지 않고 이동" });
      if (!answer.confirmed) return;
      if (delta !== undefined) {
        // SvelteKit이 취소한 popstate는 반대 방향으로 되돌리므로, 확인 후 같은 history 이동을 다시 실행한다.
        resumedPopstate = { href: target.href, delta };
        history.go(delta);
        return;
      }
      leaving = true;
      await goto(target);
    } catch { error = "화면을 열지 못했어요. 작성한 내용은 남아 있으니 다시 시도해 주세요."; }
    finally { leaving = false; askingLeave = false; }
  }
  function retry() {
    loading = true;
    if (user) void reload();
    else void initialize(pid, channel, new AbortController().signal);
  }


  $effect(() => {
    const productionId = pid, currentChannel = channel;
    const controller = new AbortController();
    posts = []; cursor = null; loading = true; error = ""; body = ""; subject = ""; search = ""; status = "ALL";
    threadDirty = false;
    user = null; isStaff = false; title = "공연"; connected = false;
    void initialize(productionId, currentChannel, controller.signal);
    const stop = watchCommunity(productionId, () => void reload(productionId, currentChannel, controller.signal), (value) => connected = value);
    return () => { controller.abort(); stop(); };
  });

  async function initialize(productionId: string, currentChannel: string, signal: AbortSignal) {
    try {
      const [me, production] = await Promise.all([fetchCurrentUser(), getMyProduction(productionId)]);
      if (signal.aborted || productionId !== pid || currentChannel !== channel) return;
      user = me; title = production?.title ?? "공연"; isStaff = isProductionStaff(production, me?.platformRole);
      await reload(productionId, currentChannel, signal);
    } catch (cause) {
      if (!signal.aborted && productionId === pid && currentChannel === channel) { error = cause instanceof Error ? cause.message : "공연 정보를 불러오지 못했어요."; loading = false; }
    }
  }

  async function reload(productionId = pid, currentChannel = channel, signal?: AbortSignal, older = false) {
    const version = ++requestVersion;
    const query: Record<string, string> = { visibility: currentChannel === "MINE" ? "PRIVATE" : "TEAM" };
    if (currentChannel !== "MINE" && currentChannel !== "ALL") query.channel = currentChannel;
    if (older && cursor) query.cursor = cursor;
    if (older) loadingMore = true;
    try {
      const result = await listCommunity(productionId, query, signal);
      if (signal?.aborted || version !== requestVersion || productionId !== pid || currentChannel !== channel) return;
      posts = older ? [...posts, ...result.items.filter((item) => !posts.some((post) => post.id === item.id))] : result.items;
      cursor = result.nextCursor; error = "";
    } catch (cause) {
      if (!signal?.aborted && version === requestVersion && productionId === pid && currentChannel === channel) error = cause instanceof Error ? cause.message : "대화를 불러오지 못했어요.";
    } finally { if (!signal?.aborted && version === requestVersion && productionId === pid && currentChannel === channel) { loading = false; loadingMore = false; } }
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!body.trim() || !canWrite || saving) return;
    const productionId = pid, currentChannel = channel;
    saving = true; error = "";
    try {
      await createCommunityPost(productionId, { body: body.trim(), ...(needsTitle ? { title: subject.trim() } : {}), channel: (currentChannel === "ALL" ? "GENERAL" : currentChannel) as CommunityChannel, visibility: "TEAM" });
      if (productionId !== pid || currentChannel !== channel) return;
      body = ""; subject = ""; await reload(productionId, currentChannel);
    } catch (cause) { if (productionId === pid && currentChannel === channel) error = cause instanceof Error ? cause.message : "대화를 보내지 못했어요."; }
    finally { saving = false; }
  }

  function openChannel(value: string) {
    if (value === channel) return;
    void goto(`/app/p/${pid}/board${value === "ALL" ? "" : `?channel=${value}`}`);
  }
</script>

<svelte:head><title>팀 대화·메모 — {title}</title></svelte:head>

<div class="mx-auto w-full min-w-0 max-w-6xl space-y-4">
  <header class="flex items-start justify-between gap-3">
    <div><p class="text-primary text-xs font-semibold">함께 만드는 공연</p><h1 class="mt-1 text-2xl font-bold tracking-tight">팀 대화·메모</h1><p class="text-muted-foreground mt-1 hidden text-sm sm:block">준비할 일과 연습 의견을 공연팀과 나눠요.</p></div>
    <Button href={`/app/p/${pid}/schedule`} variant="outline" class="min-h-11 shrink-0">공유 일정</Button>
  </header>
  <div class="grid min-w-0 items-start gap-4 lg:grid-cols-[180px_minmax(0,1fr)]">
    <aside class="min-w-0 lg:sticky lg:top-20" aria-label="공연 대화 채널">
      <div class="bg-card flex min-w-0 gap-1 overflow-x-auto rounded-xl border p-1 lg:grid lg:gap-1 lg:p-2">
        {#each [{ id: "ALL", label: "전체 대화" }, ...COMMUNITY_CHANNELS, { id: "MINE", label: "내 메모" }] as item (item.id)}
          <button class="flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 text-start text-sm {channel === item.id ? 'bg-primary/10 text-primary font-semibold' : 'text-muted-foreground hover:bg-accent'}" aria-pressed={channel === item.id} onclick={() => openChannel(item.id)}>
            {#if item.id === "MINE"}<LockKeyholeIcon class="size-4 shrink-0" />{:else}<HashIcon class="hidden size-4 shrink-0 lg:block" />{/if}{item.label}
          </button>
        {/each}
      </div>
      <p class="text-muted-foreground mt-3 hidden px-2 text-xs leading-5 lg:block">팀 대화는 이 공연의 참여자에게 공유돼요. 나만 보기 메모는 작성자에게만 보여요.</p>
    </aside>
    <div class="grid min-w-0 items-start gap-4 {postId ? 'xl:grid-cols-[minmax(0,1fr)_minmax(300px,0.85fr)]' : ''}">
      <section class="bg-card flex h-[calc(100dvh-19rem)] min-h-[480px] min-w-0 flex-col overflow-hidden rounded-2xl border md:h-auto {postId ? 'hidden xl:flex' : ''}" aria-label="공연 대화">
        <header class="space-y-3 border-b p-4">
          <div class="flex items-center justify-between gap-2"><h2 class="flex items-center gap-2 font-bold"><HashIcon class="size-5 text-primary" />{channelTitle}</h2><span class="text-muted-foreground text-xs" role="status">{connected ? "실시간 연결" : "연결 대기 · 자동 새로고침"}</span></div>
          <p class="text-muted-foreground text-xs leading-5">{channel === "ALL" ? "모든 채널의 최신 대화와 공유 시점 메모예요." : channel === "MINE" ? "연습 시점에 저장한 나만 보기 메모예요. 공유 여부는 메모의 답글 화면에서 바꿀 수 있어요." : channelInfo?.description}</p>
          <div class="flex gap-2">
            <label class="min-w-0 flex-1"><span class="sr-only">불러온 대화 검색</span><input class="bg-background min-h-11 w-full rounded-lg border px-3 text-sm" bind:value={search} placeholder="불러온 대화에서 내용·작성자 검색" /></label>
            <label><span class="sr-only">처리 상태</span><select class="bg-background min-h-11 max-w-28 rounded-lg border px-2 text-sm" bind:value={status}><option value="ALL">모든 상태</option><option value="OPEN">미처리</option><option value="RESOLVED">처리 완료</option></select></label>
          </div>
        </header>
        {#if error}<div role="alert" class="space-y-2 border-b p-4 text-sm text-destructive"><p>{error}</p><Button variant="outline" class="min-h-11" onclick={retry}>다시 불러오기</Button></div>{/if}
        <div class="min-h-0 flex-1 divide-y overflow-y-auto overscroll-contain md:max-h-[52dvh] lg:max-h-[58dvh]" aria-label="최근 대화 목록">
          {#if loading}<p role="status" class="p-6 text-sm">대화를 불러오는 중…</p>
          {:else if !error || posts.length}
            {#each visible as post (post.id)}
              <article class="space-y-2 p-4 hover:bg-accent/30">
                <div class="flex items-start gap-3">
                  <span class="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold" aria-hidden="true">{post.author.name.slice(0, 1)}</span>
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"><span class="break-words font-semibold">{post.author.name}</span><span class="text-muted-foreground">{formatRelative(post.createdAt)}</span><span class="text-muted-foreground"># {COMMUNITY_CHANNELS.find((item) => item.id === post.channel)?.label}</span>{#if post.pinned}<PinIcon class="size-3 text-primary" /><span class="text-primary">고정</span>{/if}{#if post.status === "RESOLVED"}<span class="text-primary">처리 완료</span>{/if}</div>
                    {#if post.category !== "QUESTION"}<h3 class="mt-2 break-words text-sm font-bold">{post.title}</h3>{/if}
                    <p class="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{post.body}</p>
                    {#if post.source}
                      <a href={rehearsalLink(pid, post)} class="bg-primary/5 text-primary mt-2 flex min-h-11 items-center gap-2 rounded-lg px-3 text-xs font-medium"><span class="font-mono">{formatTimelineTime(post.positionMs ?? 0)}</span><span class="min-w-0 break-words">{post.contextLabel} · 시점 보기</span></a>
                    {/if}
                    <a href={`/app/p/${pid}/board/${post.id}${channel !== "ALL" ? `?channel=${channel}` : ""}`} class="text-primary mt-1 inline-flex min-h-11 items-center gap-1.5 rounded-md px-1 text-xs font-semibold"><MessageCircleIcon class="size-4" />답글 {post._count?.comments ?? 0} · 대화 열기</a>
                  </div>
                </div>
              </article>
            {:else}<div class="space-y-2 px-5 py-10 text-center"><MessageCircleIcon class="mx-auto size-7 text-muted-foreground" /><h3 class="font-semibold">{search || status !== "ALL" ? "조건에 맞는 대화가 없어요" : "첫 대화를 기다리고 있어요"}</h3><p class="text-muted-foreground text-sm">{channel === "MINE" ? "연습 화면에서 현재 시점에 메모를 남겨보세요." : "일정, 준비 사항, 연습 의견을 공연팀과 나눠보세요."}</p>{#if channel === "MINE"}<Button href={`/app/p/${pid}/live`} class="mt-3 min-h-11">연습하며 메모하기</Button>{/if}</div>{/each}
            {#if cursor}<div class="p-3"><Button variant="outline" class="min-h-11 w-full" disabled={loadingMore} onclick={() => reload(pid, channel, undefined, true)}>{loadingMore ? "불러오는 중…" : "이전 대화 더 보기"}</Button></div>{/if}
          {/if}
        </div>
        {#if canWrite}
          <form class="shrink-0 space-y-3 border-t bg-card p-4" onsubmit={submit}>
            {#if needsTitle}<label class="grid gap-1 text-sm font-medium">제목<input class="bg-background min-h-11 rounded-lg border px-3 font-normal" bind:value={subject} required maxlength="120" disabled={saving} /></label>{/if}
            <label class="grid gap-2 text-sm font-medium">{needsTitle ? "내용" : "팀에 메시지 보내기"}<textarea class="bg-background min-h-20 w-full rounded-xl border p-3 font-normal" rows="2" bind:value={body} maxlength="4000" placeholder={channel === "MATERIAL" ? "자료 설명과 링크를 입력해 주세요." : "준비 사항이나 연습 의견을 남겨 주세요."} disabled={saving}></textarea></label>
            <div class="flex items-center justify-between gap-3"><p class="text-muted-foreground text-xs">{channel === "ALL" ? "# 팀 대화" : `# ${channelTitle}`} · 팀 공유 · {body.length}/4,000</p><Button type="submit" class="min-h-11 shrink-0" disabled={saving || !body.trim() || (needsTitle && !subject.trim())}><SendIcon class="size-4" />{saving ? "보내는 중…" : "보내기"}</Button></div>
          </form>
        {:else if channel === "NOTICE"}<p class="text-muted-foreground border-t p-4 text-xs">공지는 제작진이 작성해요. 답글로 의견을 남길 수 있어요.</p>{/if}
      </section>
      {#if postId && user}<CommunityThread {pid} {postId} userId={user.id} canModerate={isStaff} onDirty={(value) => threadDirty = value} />{/if}
    </div>
  </div>
</div>

<ConfirmDialog bind:this={confirmation} />
