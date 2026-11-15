<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { onMount } from "svelte";
  import SiteFooter from "$lib/components/site/SiteFooter.svelte";
  import * as Sidebar from "$lib/components/ui/sidebar";
  import { Separator } from "$lib/components/ui/separator";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import AdminUserMenu from "$lib/components/admin/admin-user-menu.svelte";
  import SidebarNavigationSync from "$lib/components/app/sidebar-navigation-sync.svelte";
  import { fetchCurrentUser, type CurrentUser } from "$lib/api/auth";
  import { apiRequest } from "$lib/api/client";
  import type { MyProduction } from "$lib/api/productions";
  import { captureSession, isCurrentSession } from "$lib/api/session";
  import { EMPTY_PRODUCTION_ACCESS, getProductionAccess, type ProductionAccess } from "$lib/api/production-access";
  import { WORKSPACE_MENU, WORKSPACE_SUPPORT_MENU, productionNavigation, workspaceTitle, type WorkspaceMenuItem } from "$lib/domain/workspace-navigation";
  import BrandMark from "$lib/components/ui/brand-mark.svelte";
  import HouseIcon from "@lucide/svelte/icons/house";
  import CalendarDaysIcon from "@lucide/svelte/icons/calendar-days";
  import BellIcon from "@lucide/svelte/icons/bell";
  import UserIcon from "@lucide/svelte/icons/user";
  import TheaterIcon from "@lucide/svelte/icons/theater";
  import ShieldIcon from "@lucide/svelte/icons/shield";
  import ChevronLeftIcon from "@lucide/svelte/icons/chevron-left";
  import ClipboardListIcon from "@lucide/svelte/icons/clipboard-list";
  import ListChecksIcon from "@lucide/svelte/icons/list-checks";
  import MusicIcon from "@lucide/svelte/icons/music";
  import BookOpenIcon from "@lucide/svelte/icons/book-open";
  import UsersRoundIcon from "@lucide/svelte/icons/users-round";
  import MessageCircleIcon from "@lucide/svelte/icons/message-circle";
  import MicVocalIcon from "@lucide/svelte/icons/mic-vocal";
  import UserCogIcon from "@lucide/svelte/icons/user-cog";
  import SettingsIcon from "@lucide/svelte/icons/settings";
  import NotebookPenIcon from "@lucide/svelte/icons/notebook-pen";
  import SearchIcon from "@lucide/svelte/icons/search";

  let { children } = $props();

  let user = $state<CurrentUser | null>(null);
  let checking = $state(true);
  let mounted = false;
  let unread = $state(0);
  let myProductions = $state<MyProduction[]>([]);
  let productionTitle = $state<string | null>(null);
  let access = $state<ProductionAccess>({ ...EMPTY_PRODUCTION_ACCESS });
  let hasAssignedTracks = $state(false);

  const icons = {
    house: HouseIcon, calendar: CalendarDaysIcon, search: SearchIcon, clipboard: ClipboardListIcon,
    bell: BellIcon, user: UserIcon, shield: ShieldIcon, message: MessageCircleIcon, book: BookOpenIcon,
    notebook: NotebookPenIcon, music: MusicIcon, mic: MicVocalIcon, users: UsersRoundIcon,
    checks: ListChecksIcon, userCog: UserCogIcon, settings: SettingsIcon
  };
  const withIcons = (items: WorkspaceMenuItem[]) => items.map((item) => ({ ...item, icon: icons[item.icon] }));
  const menu = withIcons(WORKSPACE_MENU);
  const supportMenu = withIcons(WORKSPACE_SUPPORT_MENU);
  const siteName = $derived($page.data.site?.info.siteName || "아트브릿지");
  const pid = $derived($page.params.pid ?? null);
  const membership = $derived(myProductions.find((production) => production.id === pid)?.myMembership);
  const isStaff = $derived(membership?.primaryRole === "STAFF" || membership?.roles.includes("STAFF") === true);
  const navigation = $derived(productionNavigation(pid, access, hasAssignedTracks || isStaff));
  const prodMenu = $derived(withIcons(navigation.production));
  const manageMenu = $derived(withIcons(navigation.manage));
  const mobileMenu = $derived(withIcons(navigation.mobile));

  $effect(() => {
    const id = pid;
    productionTitle = null;
    access = { ...EMPTY_PRODUCTION_ACCESS };
    hasAssignedTracks = false;
    if (!id || !user) return;
    let active = true;
    const session = captureSession();
    const current = () => active && mounted && isCurrentSession(session);
    // 공연 전환 중에는 이전 공연의 메뉴 권한을 사용하지 않는다.
    void apiRequest<{ production: { title: string }; viewer: { myTrackIds?: string[] } }>(`/productions/${id}/cue-sheet`)
      .then((result) => { if (current()) { productionTitle = result.production.title; hasAssignedTracks = (result.viewer.myTrackIds?.length ?? 0) > 0; } })
      .catch(() => { if (current()) { productionTitle = null; hasAssignedTracks = false; } });
    void getProductionAccess(id)
      .then((result) => { if (current()) access = result; })
      .catch(() => { if (current()) access = { ...EMPTY_PRODUCTION_ACCESS }; });
    return () => { active = false; };
  });

  const currentTitle = $derived(workspaceTitle($page.url.pathname, pid, navigation.production, navigation.manage));

  onMount(() => {
    mounted = true;
    const session = captureSession();
    void (async () => {
      const me = await fetchCurrentUser();
      // 파괴된 이전 계정 화면의 늦은 인증 결과로 현재 계정을 이동시키지 않는다.
      if (!mounted || !isCurrentSession(session)) return;
      if (!me) {
        await goto(`/login?next=${encodeURIComponent($page.url.pathname + $page.url.search)}`);
        return;
      }
      user = me;
      checking = false;
      void loadSidebarData();
    })();
    return () => { mounted = false; };
  });

  // 이벤트 정리 함수가 실행되도록 비동기 인증 조회와 별도 등록한다.
  onMount(() => {
    const onNotificationsChanged = () => void loadSidebarData();
    window.addEventListener("reading-musical:notifications-changed", onNotificationsChanged);
    return () => window.removeEventListener("reading-musical:notifications-changed", onNotificationsChanged);
  });

  async function loadSidebarData() {
    if (!mounted) return;
    const session = captureSession();
    const [summary, productions] = await Promise.allSettled([
      apiRequest<{ unreadCount: number }>("/notifications/summary"),
      apiRequest<MyProduction[]>("/productions")
    ]);
    if (!mounted || !isCurrentSession(session)) return;
    if (summary.status === "fulfilled") unread = summary.value.unreadCount;
    if (productions.status === "fulfilled") myProductions = productions.value;
  }
</script>

<svelte:head>
  <title>{currentTitle} — {siteName}</title>
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
  <a class="skip-link" href="#workspace-main">본문으로 건너뛰기</a>
  <Sidebar.Provider>
    <SidebarNavigationSync />
    <Sidebar.Root variant="inset">
      <Sidebar.Header>
        <Sidebar.Menu>
          <Sidebar.MenuItem>
            <Sidebar.MenuButton size="lg">
              {#snippet child({ props })}
                <a href="/app" {...props}>
                  <BrandMark size={32} class="shrink-0" />
                  <div class="grid flex-1 text-start text-sm leading-tight">
                    <span class="truncate font-semibold">{siteName}</span>
                    <span class="truncate text-xs">내 공연</span>
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
                    <a href={user?.platformRole === "SUPER_ADMIN" ? "/admin/productions" : "/app"} {...props}>
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
                      <a href={item.url} {...props} aria-current={(item.exact ? $page.url.pathname === item.url : $page.url.pathname.startsWith(item.url)) ? "page" : undefined}>
                        <item.icon aria-hidden="true" />
                        <span>{item.title}</span>
                      </a>
                    {/snippet}
                  </Sidebar.MenuButton>
                </Sidebar.MenuItem>
              {/each}
            </Sidebar.Menu>
          </Sidebar.Group>
          {#if manageMenu.length > 0}
            <Sidebar.Group>
              <Sidebar.GroupLabel>제작 관리</Sidebar.GroupLabel>
              <Sidebar.Menu>
                {#each manageMenu as item (item.url)}
                  <Sidebar.MenuItem>
                    <Sidebar.MenuButton isActive={$page.url.pathname.startsWith(item.url) ? true : undefined}>
                      {#snippet child({ props })}
                        <a href={item.url} {...props} aria-current={$page.url.pathname.startsWith(item.url) ? "page" : undefined}>
                          <item.icon aria-hidden="true" />
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
                      <a href={item.url} {...props} aria-current={(item.exact ? $page.url.pathname === item.url : $page.url.pathname.startsWith(item.url)) ? "page" : undefined}>
                        <item.icon aria-hidden="true" />
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
                {#each myProductions.slice(0, 6) as production (production.id)}
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

        {#if !pid}
        <Sidebar.Group>
          <Sidebar.GroupLabel>도움말 · 개인정보</Sidebar.GroupLabel>
          <Sidebar.Menu>
            {#each supportMenu as item (item.url)}
              <Sidebar.MenuItem>
                <Sidebar.MenuButton isActive={$page.url.pathname === item.url}>
                  {#snippet child({ props })}<a href={item.url} {...props}><item.icon aria-hidden="true" /><span>{item.title}</span></a>{/snippet}
                </Sidebar.MenuButton>
              </Sidebar.MenuItem>
            {/each}
          </Sidebar.Menu>
        </Sidebar.Group>

        {#if user?.platformRole === "SUPER_ADMIN"}
          <Sidebar.Group class="mt-auto">
            <Sidebar.Menu>
              <Sidebar.MenuItem>
                <Sidebar.MenuButton>
                  {#snippet child({ props })}
                    <a href="/admin" {...props}>
                      <ShieldIcon />
                      <span>공연 운영으로</span>
                    </a>
                  {/snippet}
                </Sidebar.MenuButton>
              </Sidebar.MenuItem>
            </Sidebar.Menu>
          </Sidebar.Group>
        {/if}
        {/if}
      </Sidebar.Content>

      <Sidebar.Footer>
        <AdminUserMenu {user} />
      </Sidebar.Footer>
    </Sidebar.Root>

    <Sidebar.Inset class="min-w-0">
      <header class="bg-background/95 sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b px-4 backdrop-blur">
        <Sidebar.Trigger class="-ms-1 size-11" aria-label="공연 메뉴 열기" />
        <Separator orientation="vertical" class="me-2 data-[orientation=vertical]:h-4" />
        <div class="min-w-0 flex-1"><p class="truncate text-sm font-semibold">{productionTitle ?? currentTitle}</p>{#if pid}<p class="text-muted-foreground truncate text-[11px]">{currentTitle}</p>{/if}</div>
        {#if pid}<a href="/app/notifications" class="relative flex size-11 shrink-0 items-center justify-center rounded-xl hover:bg-accent focus-visible:outline-2" aria-label={`알림${unread ? ` ${unread}개 읽지 않음` : ''}`}><BellIcon class="size-5" />{#if unread > 0}<span class="bg-primary absolute end-1 top-1 size-2 rounded-full"></span>{/if}</a>{/if}
      </header>
      <main id="workspace-main" tabindex="-1" class="flex min-w-0 flex-1 flex-col gap-5 p-4 pt-5 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:p-6 md:pb-6" aria-label={currentTitle}>
        {@render children()}
      </main>
      {#if !pid}
        <div class="pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
          <SiteFooter site={$page.data.site ?? null} errorMessage={$page.data.siteError ?? ""} />
        </div>
      {/if}
      <nav aria-label="모바일 빠른 메뉴" class="bg-background/95 fixed inset-x-0 bottom-0 z-30 grid {pid ? 'grid-cols-5' : 'grid-cols-4'} border-t px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {#each mobileMenu as item (item.url)}
          {@const active = item.exact ? $page.url.pathname === item.url : $page.url.pathname.startsWith(item.url)}
          <a href={item.url} aria-current={active ? "page" : undefined} class="flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1 text-center text-xs {active ? 'text-primary font-bold' : 'text-muted-foreground'}"><item.icon aria-hidden="true" class="size-5" /><span>{item.title}{item.url === '/app/notifications' && unread > 0 ? ` (${unread > 99 ? '99+' : unread})` : ''}</span></a>
        {/each}
      </nav>
    </Sidebar.Inset>
  </Sidebar.Provider>
{/if}
