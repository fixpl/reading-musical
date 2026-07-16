<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { onMount } from "svelte";
  import AdminSidebar from "$lib/components/admin/admin-sidebar.svelte";
  import * as Breadcrumb from "$lib/components/ui/breadcrumb";
  import { Separator } from "$lib/components/ui/separator";
  import * as Sidebar from "$lib/components/ui/sidebar";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import { fetchCurrentUser, isAdminRole, type CurrentUser } from "$lib/api/auth";
  import { apiRequest } from "$lib/api/client";
  import { newInquiryCount } from "$lib/stores/admin-badges";

  let { children } = $props();

  let user = $state<CurrentUser | null>(null);
  let checking = $state(true);

  const pageTitles: Array<[string, string]> = [
    ["/admin/inquiries", "공연 신청 문의"],
    ["/admin/members", "회원 관리"],
    ["/admin/productions", "공연 관리"]
  ];

  const currentTitle = $derived(
    pageTitles.find(([prefix]) => $page.url.pathname.startsWith(prefix))?.[1] ?? "대시보드"
  );

  onMount(async () => {
    const me = await fetchCurrentUser();
    if (!me) {
      await goto("/login");
      return;
    }
    if (!isAdminRole(me.platformRole)) {
      await goto("/app");
      return;
    }
    user = me;
    checking = false;
    void loadInquiryBadge();
  });

  async function loadInquiryBadge() {
    try {
      const result = await apiRequest<{ counts: Partial<Record<string, number>> }>("/admin/inquiries?take=1");
      newInquiryCount.set(result.counts.NEW ?? 0);
    } catch {
      newInquiryCount.set(0);
    }
  }
</script>

<svelte:head>
  <title>{currentTitle} — 운영 콘솔</title>
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
    <AdminSidebar {user} inquiryBadge={$newInquiryCount ?? 0} />
    <Sidebar.Inset>
      <header class="flex h-14 shrink-0 items-center gap-2">
        <div class="flex items-center gap-2 px-4">
          <Sidebar.Trigger class="-ms-1" />
          <Separator orientation="vertical" class="me-2 data-[orientation=vertical]:h-4" />
          <Breadcrumb.Root>
            <Breadcrumb.List>
              <Breadcrumb.Item class="hidden md:block">
                <Breadcrumb.Link href="/admin">운영 콘솔</Breadcrumb.Link>
              </Breadcrumb.Item>
              <Breadcrumb.Separator class="hidden md:block" />
              <Breadcrumb.Item>
                <Breadcrumb.Page>{currentTitle}</Breadcrumb.Page>
              </Breadcrumb.Item>
            </Breadcrumb.List>
          </Breadcrumb.Root>
        </div>
      </header>
      <div class="flex flex-1 flex-col gap-4 p-4 pt-0">
        {@render children()}
      </div>
    </Sidebar.Inset>
  </Sidebar.Provider>
{/if}
