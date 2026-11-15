<script lang="ts">
  import { afterNavigate } from "$app/navigation";
  import { page } from "$app/stores";
  import * as Sidebar from "$lib/components/ui/sidebar";
  import AdminUserMenu from "./admin-user-menu.svelte";
  import BrandMark from "$lib/components/ui/brand-mark.svelte";
  import { isAdminPath } from "$lib/domain/admin-navigation";
  import type { CurrentUser } from "$lib/api/auth";
  import LayoutDashboardIcon from "@lucide/svelte/icons/layout-dashboard";
  import InboxIcon from "@lucide/svelte/icons/inbox";
  import UsersIcon from "@lucide/svelte/icons/users";
  import TheaterIcon from "@lucide/svelte/icons/theater";
  import HeartPulseIcon from "@lucide/svelte/icons/heart-pulse";
  import HistoryIcon from "@lucide/svelte/icons/history";
  import SettingsIcon from "@lucide/svelte/icons/settings";
  import CircleHelpIcon from "@lucide/svelte/icons/circle-help";
  import MessagesSquareIcon from "@lucide/svelte/icons/messages-square";

  let { user, inquiryBadge = 0 }: { user: CurrentUser | null; inquiryBadge?: number } = $props();
  const sidebar = Sidebar.useSidebar();
  afterNavigate(() => { sidebar.setOpenMobile(false); });
  const groups = [
    { title: "공연 운영", items: [
      { title: "운영 현황", url: "/admin", icon: LayoutDashboardIcon, exact: true },
      { title: "공연 도우미", url: "/admin/assistant", icon: MessagesSquareIcon, exact: false },
      { title: "공연 관리", url: "/admin/productions", icon: TheaterIcon, exact: false },
      { title: "회원·공연 배정", url: "/admin/members", icon: UsersIcon, exact: false },
      { title: "공연 신청·상담", url: "/admin/inquiries", icon: InboxIcon, exact: false }
    ] },
    { title: "사이트 관리", items: [
      { title: "사이트·약관 설정", url: "/admin/settings", icon: SettingsIcon, exact: false },
      { title: "자주 묻는 질문 관리", url: "/admin/faq", icon: CircleHelpIcon, exact: false },
      { title: "고객센터 문의", url: "/admin/support", icon: MessagesSquareIcon, exact: false }
    ] },
    { title: "관리 도구", items: [
      { title: "활동 기록", url: "/admin/activity", icon: HistoryIcon, exact: false },
      { title: "시스템 점검", url: "/admin/system", icon: HeartPulseIcon, exact: false }
    ] }
  ];
</script>
<Sidebar.Root variant="inset">
  <Sidebar.Header><Sidebar.Menu><Sidebar.MenuItem><Sidebar.MenuButton size="lg">
    {#snippet child({ props })}<a href="/admin" {...props}><BrandMark size={32} class="shrink-0" /><div class="grid flex-1 text-start text-sm leading-tight"><span class="truncate font-semibold">{$page.data.site?.info.siteName || "아트브릿지"}</span><span class="truncate text-xs">공연 운영</span></div></a>{/snippet}
  </Sidebar.MenuButton></Sidebar.MenuItem></Sidebar.Menu></Sidebar.Header>
  <Sidebar.Content>
    {#each groups as group (group.title)}
      <Sidebar.Group><Sidebar.GroupLabel>{group.title}</Sidebar.GroupLabel><Sidebar.Menu>
        {#each group.items as item (item.url)}
          {@const active = isAdminPath($page.url.pathname, item.url, item.exact)}
          <Sidebar.MenuItem><Sidebar.MenuButton isActive={active}>
            {#snippet child({ props })}<a href={item.url} {...props} aria-current={active ? "page" : undefined}><item.icon aria-hidden="true" /><span>{item.title}</span></a>{/snippet}
          </Sidebar.MenuButton>
          {#if item.url === "/admin/inquiries" && inquiryBadge > 0}<Sidebar.MenuBadge class="rounded-full bg-primary px-1.5 text-primary-foreground">{inquiryBadge}</Sidebar.MenuBadge>{/if}
          </Sidebar.MenuItem>
        {/each}
      </Sidebar.Menu></Sidebar.Group>
    {/each}
  </Sidebar.Content>
  <Sidebar.Footer><AdminUserMenu {user} /></Sidebar.Footer>
</Sidebar.Root>
