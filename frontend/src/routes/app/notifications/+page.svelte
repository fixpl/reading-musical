<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { toast } from "svelte-sonner";
  import * as Card from "$lib/components/ui/card";
  import { Button } from "$lib/components/ui/button";
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

  const visible = $derived(onlyUnread ? items.filter((item) => !item.readAt) : items);

  onMount(load);

  async function load() {
    loading = true;
    try {
      const result = await apiRequest<{ items: NotificationItem[]; unreadCount: number }>("/notifications?take=100");
      items = result.items;
      unreadCount = result.unreadCount;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "알림을 불러오지 못했습니다");
    } finally {
      loading = false;
    }
  }

  function notifyChanged() {
    window.dispatchEvent(new CustomEvent("reading-musical:notifications-changed"));
  }

  async function open(notification: NotificationItem) {
    if (!notification.readAt) {
      try {
        await apiRequest(`/notifications/${notification.id}/read`, { method: "PATCH" });
        items = items.map((item) =>
          item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item
        );
        unreadCount = Math.max(0, unreadCount - 1);
        notifyChanged();
      } catch {
        // 읽음 처리 실패는 이동을 막지 않는다.
      }
    }
    if (notification.href) {
      await goto(notification.href);
    }
  }

  async function markAllRead() {
    markingAll = true;
    try {
      await apiRequest("/notifications/read-all", { method: "PATCH" });
      const now = new Date().toISOString();
      items = items.map((item) => (item.readAt ? item : { ...item, readAt: now }));
      unreadCount = 0;
      notifyChanged();
      toast.success("모두 읽음으로 처리했습니다");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "처리하지 못했습니다");
    } finally {
      markingAll = false;
    }
  }
</script>

<div class="flex items-center justify-between">
  <div class="flex gap-2">
    <Button variant={onlyUnread ? "ghost" : "secondary"} size="sm" onclick={() => (onlyUnread = false)}>
      전체 <span class="text-muted-foreground ms-1 tabular-nums">{items.length}</span>
    </Button>
    <Button variant={onlyUnread ? "secondary" : "ghost"} size="sm" onclick={() => (onlyUnread = true)}>
      읽지 않음 <span class="text-muted-foreground ms-1 tabular-nums">{unreadCount}</span>
    </Button>
  </div>
  <Button variant="outline" size="sm" onclick={markAllRead} disabled={markingAll || unreadCount === 0}>
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
    {:else if visible.length === 0}
      <p class="text-muted-foreground py-14 text-center text-sm">
        {onlyUnread ? "읽지 않은 알림이 없습니다." : "알림이 없습니다."}
      </p>
    {:else}
      <ul class="divide-border/60 divide-y">
        {#each visible as notification (notification.id)}
          <li>
            <button
              type="button"
              class="hover:bg-muted/40 block w-full px-4 py-3 text-start transition-colors"
              onclick={() => open(notification)}
            >
              <p class="flex items-center gap-2 text-sm {notification.readAt ? 'text-muted-foreground' : 'font-medium'}">
                {#if !notification.readAt}
                  <span class="bg-primary size-1.5 shrink-0 rounded-full"></span>
                {/if}
                <span class="truncate">{notification.title ?? "알림"}</span>
              </p>
              <p class="text-muted-foreground mt-0.5 truncate text-xs">
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
