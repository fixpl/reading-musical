<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { onMount } from "svelte";
  import * as Sidebar from "$lib/components/ui/sidebar";
  import { Separator } from "$lib/components/ui/separator";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import AdminUserMenu from "$lib/components/admin/admin-user-menu.svelte";
  import { fetchCurrentUser, isAdminRole, type CurrentUser } from "$lib/api/auth";
  import { apiRequest } from "$lib/api/client";
  import HouseIcon from "@lucide/svelte/icons/house";
  import CalendarDaysIcon from "@lucide/svelte/icons/calendar-days";
  import BellIcon from "@lucide/svelte/icons/bell";
  import UserIcon from "@lucide/svelte/icons/user";
  import TheaterIcon from "@lucide/svelte/icons/theater";
  import ShieldIcon from "@lucide/svelte/icons/shield";
  import ChevronLeftIcon from "@lucide/svelte/icons/chevron-left";
  import ClipboardListIcon from "@lucide/svelte/icons/clipboard-list";
  import MusicIcon from "@lucide/svelte/icons/music";
  import BookOpenIcon from "@lucide/svelte/icons/book-open";
  import UsersRoundIcon from "@lucide/svelte/icons/users-round";
  import MessageCircleIcon from "@lucide/svelte/icons/message-circle";
  import SquarePenIcon from "@lucide/svelte/icons/square-pen";
  import MicVocalIcon from "@lucide/svelte/icons/mic-vocal";
  import UserCogIcon from "@lucide/svelte/icons/user-cog";
  import SettingsIcon from "@lucide/svelte/icons/settings";
  import NotebookPenIcon from "@lucide/svelte/icons/notebook-pen";

  let { children } = $props();

  let user = $state<CurrentUser | null>(null);
  let checking = $state(true);
  let unread = $state(0);
  let myProductions = $state<Array<{ id: string; title: string }>>([]);
  let productionTitle = $state<string | null>(null);
  let canManageProduction = $state(false);

  const menu = [
    { title: "홈", url: "/app", icon: HouseIcon, exact: true },
    { title: "내 일정", url: "/app/schedule", icon: CalendarDaysIcon },
    { title: "알림", url: "/app/notifications", icon: BellIcon },
    { title: "프로필", url: "/app/profile", icon: UserIcon }
  ];

  // 공연 안에 들어오면 사이드바가 공연 작업 메뉴로 바뀐다.
  const pid = $derived($page.params.pid ?? null);

  const prodMenu = $derived(
    pid
      ? [
          { title: "대시보드", url: `/app/p/${pid}`, icon: ClipboardListIcon, exact: true },
          { title: "장·막 구성", url: `/app/p/${pid}/composition`, icon: NotebookPenIcon, exact: false },
          { title: "연습 · 시간표", url: `/app/p/${pid}/live`, icon: MicVocalIcon, exact: false },
          { title: "큐시트", url: `/app/p/${pid}/cuesheet`, icon: MusicIcon, exact: false },
          { title: "대본", url: `/app/p/${pid}/script`, icon: BookOpenIcon, exact: false },
          { title: "일정", url: `/app/p/${pid}/schedule`, icon: CalendarDaysIcon, exact: false },
          { title: "참여자", url: `/app/p/${pid}/people`, icon: UsersRoundIcon, exact: false },
          { title: "소통", url: `/app/p/${pid}/board`, icon: MessageCircleIcon, exact: false }
        ]
      : []
  );

  const STAFF_ROLES = ["PRODUCER", "DIRECTOR", "MUSIC_DIRECTOR", "STAGE_MANAGER"];

  const manageMenu = $derived(
    pid
      ? [
          { title: "기획 메모", url: `/app/p/${pid}/manage/planning`, icon: NotebookPenIcon },
          { title: "대본 편집", url: `/app/p/${pid}/manage/script`, icon: SquarePenIcon },
          { title: "캐스팅", url: `/app/p/${pid}/manage/casting`, icon: MicVocalIcon },
          { title: "멤버", url: `/app/p/${pid}/manage/members`, icon: UserCogIcon },
          { title: "공연 설정", url: `/app/p/${pid}/manage/settings`, icon: SettingsIcon }
        ]
      : []
  );

  $effect(() => {
    const id = pid;
    productionTitle = null;
    canManageProduction = false;
    if (!id || !user) return;
    let active = true;
    // Use server-scoped permissions, not a global ORG_ADMIN label.
    void apiRequest<{ production: { title: string }; viewer: { canManageTracks: boolean } }>(`/productions/${id}/cue-sheet`)
      .then((result) => { if (active) { productionTitle = result.production.title; canManageProduction = result.viewer.canManageTracks; } })
      .catch(() => { if (active) { productionTitle = null; canManageProduction = false; } });
    return () => { active = false; };
  });

  const currentTitle = $derived.by(() => {
    if (pid) {
      return (
        [...prodMenu, ...manageMenu.map((item) => ({ ...item, exact: false }))].find((item) =>
          item.exact ? $page.url.pathname === item.url : $page.url.pathname.startsWith(item.url)
        )?.title ?? "공연"
      );
    }
    return (
      menu.find((item) => (item.exact ? $page.url.pathname === item.url : $page.url.pathname.startsWith(item.url)))
        ?.title ?? "홈"
    );
  });

  onMount(async () => {
    const me = await fetchCurrentUser();
    if (!me) {
      await goto("/login");
      return;
    }
    user = me;
    checking = false;
    void loadSidebarData();
  });

  // 알림 페이지에서 읽음 처리하면 사이드바 배지를 바로 갱신한다.
  // (async onMount의 return은 정리 함수로 인식되지 않아 동기 onMount로 분리)
  onMount(() => {
    const onNotificationsChanged = () => void loadSidebarData();
    window.addEventListener("reading-musical:notifications-changed", onNotificationsChanged);
    return () => window.removeEventListener("reading-musical:notifications-changed", onNotificationsChanged);
  });

  async function loadSidebarData() {
    try {
      const [summary, productions] = await Promise.all([
        apiRequest<{ unreadCount: number }>("/notifications/summary"),
        apiRequest<Array<{ id: string; title: string }>>("/productions")
      ]);
      unread = summary.unreadCount;
      myProductions = productions.slice(0, 6);
    } catch {
      // 사이드바 보조 정보는 실패해도 화면을 막지 않는다.
    }
  }
</script>

<svelte:head>
  <title>내 작업 — 아트브릿지</title>
</svelte:head>

{#if checking}
  <div class="flex min-h-dvh items-center justify-center">
    <div class="w-full max-w-md space-y-3 px-6">
      <Skeleton class="h-8 w-1/3" />
      <Skeleton class="h-24 w-full" />
      <Skeleton class="h-24 w-full" />
    </div>
  </div>
{:else}
  <Sidebar.Provider>
    <Sidebar.Root variant="inset">
      <Sidebar.Header>
        <Sidebar.Menu>
          <Sidebar.MenuItem>
            <Sidebar.MenuButton size="lg">
              {#snippet child({ props })}
                <a href="/app" {...props}>
                  <div
                    class="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg font-semibold"
                  >
                    아
                  </div>
                  <div class="grid flex-1 text-start text-sm leading-tight">
                    <span class="truncate font-semibold">아트브릿지</span>
                    <span class="truncate text-xs">내 작업</span>
                  </div>
                </a>
              {/snippet}
            </Sidebar.MenuButton>
          </Sidebar.MenuItem>
        </Sidebar.Menu>
      </Sidebar.Header>

      <Sidebar.Content>
        {#if pid}
          <Sidebar.Group>
            <Sidebar.Menu>
              <Sidebar.MenuItem>
                <Sidebar.MenuButton class="font-semibold">
                  {#snippet child({ props })}
                    <!-- 관리자는 공연 관리 목록으로, 참여자는 내 작업으로 돌아간다. -->
                    <a href={isAdminRole(user?.platformRole) ? "/admin/productions" : "/app"} {...props}>
                      <ChevronLeftIcon />
                      <span class="truncate">{productionTitle ?? "돌아가기"}</span>
                    </a>
                  {/snippet}
                </Sidebar.MenuButton>
              </Sidebar.MenuItem>
            </Sidebar.Menu>
          </Sidebar.Group>
          <Sidebar.Group>
            <Sidebar.GroupLabel>공연 작업</Sidebar.GroupLabel>
            <Sidebar.Menu>
              {#each prodMenu as item (item.url)}
                <Sidebar.MenuItem>
                  <Sidebar.MenuButton
                    isActive={(item.exact
                      ? $page.url.pathname === item.url
                      : $page.url.pathname.startsWith(item.url) && !$page.url.pathname.includes("/manage/"))
                      ? true
                      : undefined}
                  >
                    {#snippet child({ props })}
                      <a href={item.url} {...props}>
                        <item.icon />
                        <span>{item.title}</span>
                      </a>
                    {/snippet}
                  </Sidebar.MenuButton>
                </Sidebar.MenuItem>
              {/each}
            </Sidebar.Menu>
          </Sidebar.Group>
          {#if canManageProduction}
            <Sidebar.Group>
              <Sidebar.GroupLabel>제작 관리</Sidebar.GroupLabel>
              <Sidebar.Menu>
                {#each manageMenu as item (item.url)}
                  <Sidebar.MenuItem>
                    <Sidebar.MenuButton isActive={$page.url.pathname.startsWith(item.url) ? true : undefined}>
                      {#snippet child({ props })}
                        <a href={item.url} {...props}>
                          <item.icon />
                          <span>{item.title}</span>
                        </a>
                      {/snippet}
                    </Sidebar.MenuButton>
                  </Sidebar.MenuItem>
                {/each}
              </Sidebar.Menu>
            </Sidebar.Group>
          {/if}
        {:else}
          <Sidebar.Group>
            <Sidebar.Menu>
              {#each menu as item (item.url)}
                <Sidebar.MenuItem>
                  <Sidebar.MenuButton
                    isActive={(item.exact
                      ? $page.url.pathname === item.url
                      : $page.url.pathname.startsWith(item.url))
                      ? true
                      : undefined}
                  >
                    {#snippet child({ props })}
                      <a href={item.url} {...props}>
                        <item.icon />
                        <span>{item.title}</span>
                      </a>
                    {/snippet}
                  </Sidebar.MenuButton>
                  {#if item.url === "/app/notifications" && unread > 0}
                    <Sidebar.MenuBadge class="bg-primary text-primary-foreground rounded-full px-1.5">
                      {unread}
                    </Sidebar.MenuBadge>
                  {/if}
                </Sidebar.MenuItem>
              {/each}
            </Sidebar.Menu>
          </Sidebar.Group>

          {#if myProductions.length > 0}
            <Sidebar.Group>
              <Sidebar.GroupLabel>내 공연</Sidebar.GroupLabel>
              <Sidebar.Menu>
                {#each myProductions as production (production.id)}
                  <Sidebar.MenuItem>
                    <Sidebar.MenuButton>
                      {#snippet child({ props })}
                        <a href={`/app/p/${production.id}`} {...props}>
                          <TheaterIcon />
                          <span class="truncate">{production.title}</span>
                        </a>
                      {/snippet}
                    </Sidebar.MenuButton>
                  </Sidebar.MenuItem>
                {/each}
              </Sidebar.Menu>
            </Sidebar.Group>
          {/if}
        {/if}

        {#if isAdminRole(user?.platformRole)}
          <Sidebar.Group class="mt-auto">
            <Sidebar.Menu>
              <Sidebar.MenuItem>
                <Sidebar.MenuButton>
                  {#snippet child({ props })}
                    <a href="/admin" {...props}>
                      <ShieldIcon />
                      <span>운영 콘솔로</span>
                    </a>
                  {/snippet}
                </Sidebar.MenuButton>
              </Sidebar.MenuItem>
            </Sidebar.Menu>
          </Sidebar.Group>
        {/if}
      </Sidebar.Content>

      <Sidebar.Footer>
        <AdminUserMenu {user} />
      </Sidebar.Footer>
    </Sidebar.Root>

    <Sidebar.Inset class="min-w-0">
      <header class="bg-background/95 sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b px-4 backdrop-blur">
        <Sidebar.Trigger class="-ms-1" />
        <Separator orientation="vertical" class="me-2 data-[orientation=vertical]:h-4" />
        <span class="text-sm font-medium">{currentTitle}</span>
      </header>
      <div class="flex min-w-0 flex-1 flex-col gap-4 p-3 pt-4 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:p-5 md:pb-5">
        {#if pid && ['/script', '/manage/script', '/cuesheet', '/live'].some((suffix) => $page.url.pathname.startsWith(`/app/p/${pid}${suffix}`))}
          <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-3 text-sm">
            <div><p class="font-medium">장·막별로 공연을 구성하고 있나요?</p><p class="mt-1 text-xs leading-relaxed text-muted-foreground">새 구성 화면에서 구간별 대본·가사·등록 자료를 연결할 수 있습니다. 기존 대본과 큐시트는 그대로 보존됩니다.</p></div>
            <a href={`/app/p/${pid}/composition`} class="shrink-0 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground focus-visible:outline-2">장·막 구성 열기</a>
          </div>
        {/if}
        {@render children()}
      </div>
      <nav aria-label="모바일 빠른 메뉴" class="bg-background/95 fixed inset-x-0 bottom-0 z-30 grid {pid ? 'grid-cols-5' : 'grid-cols-4'} border-t px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {#each (pid ? [{ title: "공연 홈", url: `/app/p/${pid}`, icon: HouseIcon, exact: true }, { title: "일정", url: `/app/p/${pid}/schedule`, icon: CalendarDaysIcon, exact: false }, { title: "장·막", url: `/app/p/${pid}/composition`, icon: NotebookPenIcon, exact: false }, { title: "연습", url: `/app/p/${pid}/live`, icon: MicVocalIcon, exact: false }, { title: "소통", url: `/app/p/${pid}/board`, icon: MessageCircleIcon, exact: false }] : menu) as item (item.url)}
          {@const active = item.exact ? $page.url.pathname === item.url : $page.url.pathname.startsWith(item.url)}
          <a href={item.url} aria-current={active ? "page" : undefined} class="flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1 text-xs {active ? 'text-primary font-bold' : 'text-muted-foreground'}"><item.icon class="size-5" /><span>{item.title}{item.url === '/app/notifications' && unread > 0 ? ` (${unread > 99 ? '99+' : unread})` : ''}</span></a>
        {/each}
      </nav>
    </Sidebar.Inset>
  </Sidebar.Provider>
{/if}
