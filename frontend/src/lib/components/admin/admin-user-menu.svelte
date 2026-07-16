<script lang="ts">
  import { goto } from "$app/navigation";
  import * as Avatar from "$lib/components/ui/avatar";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import * as Sidebar from "$lib/components/ui/sidebar";
  import { useSidebar } from "$lib/components/ui/sidebar";
  import { logout, type CurrentUser } from "$lib/api/auth";
  import { toggleMode } from "mode-watcher";
  import ChevronsUpDownIcon from "@lucide/svelte/icons/chevrons-up-down";
  import LogOutIcon from "@lucide/svelte/icons/log-out";
  import MoonIcon from "@lucide/svelte/icons/moon";
  import UserIcon from "@lucide/svelte/icons/user";

  let { user }: { user: CurrentUser | null } = $props();

  const sidebar = useSidebar();

  const roleLabel = $derived(
    user?.platformRole === "SUPER_ADMIN" ? "운영자" : user?.platformRole === "ORG_ADMIN" ? "단체 관리자" : "멤버"
  );

  async function handleLogout() {
    await logout();
    await goto("/login");
  }
</script>

<Sidebar.Menu>
  <Sidebar.MenuItem>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        {#snippet child({ props })}
          <Sidebar.MenuButton
            size="lg"
            class="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            {...props}
          >
            <Avatar.Root class="size-8 rounded-lg">
              <Avatar.Fallback class="rounded-lg">{user?.name?.slice(0, 1) ?? "?"}</Avatar.Fallback>
            </Avatar.Root>
            <div class="grid flex-1 text-start text-sm leading-tight">
              <span class="truncate font-medium">{user?.name ?? "..."}</span>
              <span class="text-muted-foreground truncate text-xs">{roleLabel}</span>
            </div>
            <ChevronsUpDownIcon class="ms-auto size-4" />
          </Sidebar.MenuButton>
        {/snippet}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content
        class="w-(--bits-dropdown-menu-anchor-width) min-w-56 rounded-lg"
        side={sidebar.isMobile ? "bottom" : "right"}
        align="end"
        sideOffset={4}
      >
        <DropdownMenu.Label class="p-0 font-normal">
          <div class="flex items-center gap-2 px-1 py-1.5 text-start text-sm">
            <Avatar.Root class="size-8 rounded-lg">
              <Avatar.Fallback class="rounded-lg">{user?.name?.slice(0, 1) ?? "?"}</Avatar.Fallback>
            </Avatar.Root>
            <div class="grid flex-1 leading-tight">
              <span class="truncate font-medium">{user?.name}</span>
              <span class="text-muted-foreground truncate text-xs">{user?.email}</span>
            </div>
          </div>
        </DropdownMenu.Label>
        <DropdownMenu.Separator />
        <DropdownMenu.Item onclick={() => goto("/app/profile")}>
          <UserIcon />
          내 계정 설정
        </DropdownMenu.Item>
        <DropdownMenu.Item onclick={toggleMode}>
          <MoonIcon />
          다크 모드 전환
        </DropdownMenu.Item>
        <DropdownMenu.Separator />
        <DropdownMenu.Item onclick={handleLogout}>
          <LogOutIcon />
          로그아웃
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </Sidebar.MenuItem>
</Sidebar.Menu>
