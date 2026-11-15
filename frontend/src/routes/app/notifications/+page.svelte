<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { toast } from "svelte-sonner";
  import * as Card from "$lib/components/ui/card";
  import { Button } from "$lib/components/ui/button";
  import { ErrorPanel } from "$lib/components/ui/error-panel";
  import { EmptyState } from "$lib/components/ui/empty-state";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import { apiRequest } from "$lib/api/client";
  import { formatRelative } from "$lib/domain/labels";

  type NotificationItem = {
    id: string;
    title?: string;
    body?: string;
    href?: string | null;
    readAt: string | null;
    createdAt: string;
    production?: { id: string; title: string } | null;
  };

  let items = $state<NotificationItem[]>([]);
  let unreadCount = $state(0);
  let onlyUnread = $state(false);
  let loading = $state(true);
  let markingAll = $state(false);
  let loadError = $state("");
  let actionError = $state("");
  let resultMessage = $state("");
  let openingId = $state("");

  const visible = $derived(onlyUnread ? items.filter((item) => !item.readAt) : items);

  onMount(load);

  async function load() {
    loading = true; loadError = "";
    try {
      const result = await apiRequest<{ items: NotificationItem[]; unreadCount: number }>("/notifications?take=100");
      items = result.items;
      unreadCount = result.unreadCount;
    } catch (error) {
      loadError = error instanceof Error ? error.message : "알림을 불러오지 못했어요.";
    } finally {
      loading = false;
    }
  }

  function notifyChanged() {
    window.dispatchEvent(new CustomEvent("reading-musical:notifications-changed"));
  }

  async function open(notification: NotificationItem) {
    if (openingId || markingAll) return;
    openingId = notification.id; actionError = ""; resultMessage = "";
    try {
      if (!notification.readAt) {
        try {
          await apiRequest(`/notifications/${notification.id}/read`, { method: "PATCH" });
          const wasUnread = items.some((item) => item.id === notification.id && !item.readAt);
          items = items.map((item) => item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item);
          if (wasUnread) unreadCount = Math.max(0, unreadCount - 1);
          resultMessage = "알림을 읽음으로 표시했어요.";
          notifyChanged();
        } catch {
          actionError = "읽음 표시를 저장하지 못했어요. 알림 내용은 열 수 있으니 나중에 다시 눌러 주세요.";
          toast.error(actionError);
        }
      }
      if (notification.href) await goto(notification.href);
    } catch {
      actionError = "알림에 연결된 화면을 열지 못했어요. 다시 눌러 주세요.";
      toast.error(actionError);
    } finally { openingId = ""; }
  }

  async function markAllRead() {
    if (markingAll || openingId) return;
    markingAll = true; actionError = ""; resultMessage = "";
    try {
      await apiRequest("/notifications/read-all", { method: "PATCH" });
      const now = new Date().toISOString();
      items = items.map((item) => (item.readAt ? item : { ...item, readAt: now }));
      unreadCount = 0;
      notifyChanged();
      resultMessage = "모든 알림을 읽음으로 표시했어요.";
      toast.success(resultMessage);
    } catch (error) {
      actionError = error instanceof Error ? error.message : "읽음 표시를 저장하지 못했어요. 다시 시도해 주세요.";
      toast.error(actionError);
    } finally {
      markingAll = false;
    }
  }
</script>

<header class="py-2"><h1 class="text-xl font-bold tracking-tight sm:text-2xl">알림</h1><p class="text-muted-foreground text-sm">공연의 변경 사항과 새 소식을 확인해요.</p></header>
{#if actionError}<p role="alert" class="mb-3 text-sm leading-6 text-destructive">{actionError}</p>{/if}
{#if resultMessage}<p role="status" class="mb-3 text-sm leading-6">{resultMessage}</p>{/if}

<div class="mb-4 flex flex-wrap items-center justify-between gap-2">
  <div class="flex gap-2">
    <Button variant={onlyUnread ? "ghost" : "secondary"} size="sm" class="min-h-11" aria-pressed={!onlyUnread} onclick={() => (onlyUnread = false)}>
      전체 <span class="text-muted-foreground ms-1 tabular-nums">{items.length}</span>
    </Button>
    <Button variant={onlyUnread ? "secondary" : "ghost"} size="sm" class="min-h-11" aria-pressed={onlyUnread} onclick={() => (onlyUnread = true)}>
      읽지 않음 <span class="text-muted-foreground ms-1 tabular-nums">{unreadCount}</span>
    </Button>
  </div>
  <Button variant="outline" size="sm" class="min-h-11" onclick={markAllRead} disabled={loading || Boolean(loadError) || markingAll || Boolean(openingId) || unreadCount === 0}>
    모두 읽음
  </Button>
</div>

<Card.Root>
  <Card.Content class={loading || visible.length === 0 ? "" : "p-0"}>
    {#if loading}
      <div class="space-y-2">
        {#each Array(5) as _, i (i)}
          <Skeleton class="h-14 w-full" />
        {/each}
      </div>
    {:else if loadError}
      <ErrorPanel title="알림을 불러오지 못했어요" message={loadError} onRetry={load} />
    {:else if visible.length === 0}
      <EmptyState title={onlyUnread ? "읽지 않은 알림이 없어요" : "아직 알림이 없어요"} description={onlyUnread ? "새로 도착한 소식을 모두 확인했어요." : "참여한 공연의 새 소식이 오면 여기에서 확인할 수 있어요."} />
    {:else}
      <ul class="divide-border/60 divide-y">
        {#each visible as notification (notification.id)}
          <li>
            <button
              type="button"
              class="hover:bg-muted/40 block min-h-11 w-full px-4 py-4 text-start transition-colors disabled:opacity-60"
              disabled={Boolean(openingId) || markingAll}
              onclick={() => open(notification)}
            >
              <p class="flex items-center gap-2 text-sm {notification.readAt ? 'text-muted-foreground' : 'font-medium'}">
                {#if !notification.readAt}
                  <span class="bg-primary size-1.5 shrink-0 rounded-full"></span>
                {/if}
                <span class="min-w-0 break-words">{notification.title ?? "알림"}</span>
              </p>
              <p class="text-muted-foreground mt-1 break-words text-xs leading-6">
                {#if notification.production}{notification.production.title} · {/if}
                {notification.body ?? ""} · {formatRelative(notification.createdAt)}
              </p>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </Card.Content>
</Card.Root>
