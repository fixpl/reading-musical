<script lang="ts">
  import { onMount } from "svelte";
  import { toast } from "svelte-sonner";
  import * as Card from "$lib/components/ui/card";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import { apiRequest } from "$lib/api/client";
  import { fetchCurrentUser, type CurrentUser } from "$lib/api/auth";
  import {
    EVENT_TYPE_LABELS,
    PHASE_LABELS,
    PRODUCTION_ROLE_LABELS,
    VISIBILITY_LABELS,
    formatDateTime,
    formatRelative
  } from "$lib/domain/labels";

  type MyProduction = {
    id: string;
    title: string;
    venue: string | null;
    startDate: string | null;
    currentPhase: string;
    visibility: string;
    myMembership?: { id: string; primaryRole: string; roles: string[] };
  };

  type MyAttendance = {
    id: string;
    status: "INVITED" | "ACCEPTED" | "DECLINED" | "TENTATIVE";
    event: {
      id: string;
      type: string;
      title: string;
      startAt: string;
      endAt: string;
      location: string | null;
      production: { id: string; title: string };
    };
  };

  type NotificationItem = {
    id: string;
    title?: string;
    body?: string;
    href?: string | null;
    readAt?: string | null;
    createdAt: string;
  };

  let user = $state<CurrentUser | null>(null);
  let productions = $state<MyProduction[]>([]);
  let attendances = $state<MyAttendance[]>([]);
  let notifications = $state<NotificationItem[]>([]);
  let loading = $state(true);
  let responding = $state<string | null>(null);

  const upcoming = $derived(
    attendances
      .filter((attendance) => new Date(attendance.event.endAt).getTime() >= Date.now())
      .slice(0, 6)
  );

  onMount(async () => {
    user = await fetchCurrentUser();
    try {
      const [productionsResult, scheduleResult, notificationsResult] = await Promise.all([
        apiRequest<MyProduction[]>("/productions"),
        apiRequest<{ attendances: MyAttendance[] }>("/schedule/me"),
        apiRequest<{ items: NotificationItem[] }>("/notifications?take=5")
      ]);
      productions = productionsResult;
      attendances = scheduleResult.attendances;
      notifications = notificationsResult.items;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "데이터를 불러오지 못했습니다");
    } finally {
      loading = false;
    }
  });

  async function respond(attendance: MyAttendance, status: "ACCEPTED" | "DECLINED") {
    responding = attendance.id;
    try {
      await apiRequest(`/productions/${attendance.event.production.id}/events/${attendance.event.id}/attendance`, {
        method: "POST",
        body: JSON.stringify({ status })
      });
      attendances = attendances.map((item) => (item.id === attendance.id ? { ...item, status } : item));
      toast.success(status === "ACCEPTED" ? "참석으로 응답했습니다" : "불참으로 응답했습니다");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "응답하지 못했습니다");
    } finally {
      responding = null;
    }
  }

  function myRoleLabel(production: MyProduction) {
    const role = production.myMembership?.primaryRole;
    return role ? (PRODUCTION_ROLE_LABELS[role] ?? role) : null;
  }
</script>

{#if loading}
  <div class="grid gap-4">
    <Skeleton class="h-8 w-56" />
    <div class="grid gap-4 md:grid-cols-2">
      <Skeleton class="h-40 w-full" />
      <Skeleton class="h-40 w-full" />
    </div>
    <Skeleton class="h-64 w-full" />
  </div>
{:else}
  <div>
    <h1 class="text-xl font-semibold tracking-tight">
      안녕하세요{user?.name ? `, ${user.name}님` : ""}
    </h1>
    <p class="text-muted-foreground mt-1 text-sm">참여 중인 공연과 이번 일정입니다.</p>
  </div>

  <section>
    <h2 class="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase">내 공연</h2>
    {#if productions.length === 0}
      <Card.Root>
        <Card.Content class="py-10 text-center">
          <p class="text-muted-foreground text-sm">
            아직 배정된 공연이 없습니다. 공연에 배정되면 알림으로 알려드립니다.
          </p>
        </Card.Content>
      </Card.Root>
    {:else}
      <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {#each productions as production (production.id)}
          <a href={`/app/p/${production.id}`} class="group">
            <Card.Root class="group-hover:border-primary/50 h-full transition-colors">
              <Card.Header>
                <div class="flex items-start justify-between gap-2">
                  <Card.Title class="text-base leading-snug">{production.title}</Card.Title>
                  <Badge variant="secondary" class="shrink-0">
                    {PHASE_LABELS[production.currentPhase] ?? production.currentPhase}
                  </Badge>
                </div>
                <Card.Description>
                  {#if myRoleLabel(production)}
                    내 역할 · {myRoleLabel(production)}
                  {:else}
                    {VISIBILITY_LABELS[production.visibility] ?? production.visibility}
                  {/if}
                </Card.Description>
              </Card.Header>
              <Card.Content>
                <p class="text-muted-foreground text-xs">
                  {production.venue ?? "장소 미정"}
                  {#if production.startDate}
                    · {formatDateTime(production.startDate)}
                  {/if}
                </p>
              </Card.Content>
            </Card.Root>
          </a>
        {/each}
      </div>
    {/if}
  </section>

  <div class="grid gap-4 lg:grid-cols-5">
    <section class="lg:col-span-3">
      <h2 class="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase">다가오는 일정</h2>
      <Card.Root>
        <Card.Content class={upcoming.length === 0 ? "py-10" : "p-0"}>
          {#if upcoming.length === 0}
            <p class="text-muted-foreground text-center text-sm">예정된 일정이 없습니다.</p>
          {:else}
            <ul class="divide-border/60 divide-y">
              {#each upcoming as attendance (attendance.id)}
                <li class="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                      <Badge variant="outline">{EVENT_TYPE_LABELS[attendance.event.type] ?? attendance.event.type}</Badge>
                      <p class="truncate text-sm font-medium">{attendance.event.title}</p>
                    </div>
                    <p class="text-muted-foreground mt-0.5 text-xs">
                      {formatDateTime(attendance.event.startAt)}
                      {#if attendance.event.location}
                        · {attendance.event.location}
                      {/if}
                      · {attendance.event.production.title}
                    </p>
                  </div>
                  <div class="flex shrink-0 items-center gap-1.5">
                    {#if attendance.status === "ACCEPTED"}
                      <Badge variant="secondary">참석</Badge>
                    {:else if attendance.status === "DECLINED"}
                      <Badge variant="outline">불참</Badge>
                    {:else}
                      <Button
                        size="sm"
                        disabled={responding === attendance.id}
                        onclick={() => respond(attendance, "ACCEPTED")}
                      >
                        참석
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={responding === attendance.id}
                        onclick={() => respond(attendance, "DECLINED")}
                      >
                        불참
                      </Button>
                    {/if}
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
        </Card.Content>
      </Card.Root>
    </section>

    <section class="lg:col-span-2">
      <div class="mb-2 flex items-center justify-between">
        <h2 class="text-muted-foreground text-xs font-semibold tracking-wide uppercase">최근 알림</h2>
        <a href="/app/notifications" class="text-muted-foreground hover:text-foreground text-xs transition-colors">
          전체 보기
        </a>
      </div>
      <Card.Root>
        <Card.Content class={notifications.length === 0 ? "py-10" : "p-0"}>
          {#if notifications.length === 0}
            <p class="text-muted-foreground text-center text-sm">새 알림이 없습니다.</p>
          {:else}
            <ul class="divide-border/60 divide-y">
              {#each notifications as notification (notification.id)}
                <li>
                  <a
                    href={notification.href ?? "/app/notifications"}
                    class="hover:bg-muted/40 block px-4 py-3 transition-colors"
                  >
                    <p class="flex items-center gap-2 text-sm {notification.readAt ? 'text-muted-foreground' : 'font-medium'}">
                      {#if !notification.readAt}
                        <span class="bg-primary size-1.5 shrink-0 rounded-full"></span>
                      {/if}
                      <span class="truncate">{notification.title ?? "알림"}</span>
                    </p>
                    <p class="text-muted-foreground mt-0.5 truncate text-xs">
                      {notification.body ?? ""} · {formatRelative(notification.createdAt)}
                    </p>
                  </a>
                </li>
              {/each}
            </ul>
          {/if}
        </Card.Content>
      </Card.Root>
    </section>
  </div>
{/if}
