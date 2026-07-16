<script lang="ts">
  import { page } from "$app/stores";
  import * as Sidebar from "$lib/components/ui/sidebar";
  import AdminUserMenu from "./admin-user-menu.svelte";
  import type { CurrentUser } from "$lib/api/auth";
  import LayoutDashboardIcon from "@lucide/svelte/icons/layout-dashboard";
  import InboxIcon from "@lucide/svelte/icons/inbox";
  import UsersIcon from "@lucide/svelte/icons/users";
  import TheaterIcon from "@lucide/svelte/icons/theater";
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";

  let { user, inquiryBadge = 0 }: { user: CurrentUser | null; inquiryBadge?: number } = $props();

  const menu = [
    { title: "대시보드", url: "/admin", icon: LayoutDashboardIcon, exact: true },
    { title: "공연 신청 문의", url: "/admin/inquiries", icon: InboxIcon },
    { title: "회원 관리", url: "/admin/members", icon: UsersIcon },
    { title: "공연 관리", url: "/admin/productions", icon: TheaterIcon }
  ];

  function isActive(item: (typeof menu)[number], pathname: string) {
    return item.exact ? pathname === item.url : pathname.startsWith(item.url);
  }
</script>

<Sidebar.Root variant="inset">
  <Sidebar.Header>
    <Sidebar.Menu>
      <Sidebar.MenuItem>
        <Sidebar.MenuButton size="lg">
          {#snippet child({ props })}
            <a href="/admin" {...props}>
              <div
                class="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg font-semibold"
              >
                아
              </div>
              <div class="grid flex-1 text-start text-sm leading-tight">
                <span class="truncate font-semibold">아트브릿지</span>
                <span class="truncate text-xs">운영 콘솔</span>
              </div>
            </a>
          {/snippet}
        </Sidebar.MenuButton>
      </Sidebar.MenuItem>
    </Sidebar.Menu>
  </Sidebar.Header>

  <Sidebar.Content>
    <Sidebar.Group>
      <Sidebar.GroupLabel>운영</Sidebar.GroupLabel>
      <Sidebar.Menu>
        {#each menu as item (item.url)}
          <Sidebar.MenuItem>
            <Sidebar.MenuButton isActive={isActive(item, $page.url.pathname)}>
              {#snippet child({ props })}
                <a href={item.url} {...props}>
                  <item.icon />
                  <span>{item.title}</span>
                </a>
              {/snippet}
            </Sidebar.MenuButton>
            {#if item.url === "/admin/inquiries" && inquiryBadge > 0}
              <Sidebar.MenuBadge class="bg-primary text-primary-foreground rounded-full px-1.5">
                {inquiryBadge}
              </Sidebar.MenuBadge>
            {/if}
          </Sidebar.MenuItem>
        {/each}
      </Sidebar.Menu>
    </Sidebar.Group>

  </Sidebar.Content>

  <Sidebar.Footer>
    <AdminUserMenu {user} />
  </Sidebar.Footer>
</Sidebar.Root>
