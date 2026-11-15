<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { onMount } from "svelte";
  import { isAdminPath } from "$lib/domain/admin-navigation";
  import AdminSidebar from "$lib/components/admin/admin-sidebar.svelte";
  import * as Breadcrumb from "$lib/components/ui/breadcrumb";
  import { Separator } from "$lib/components/ui/separator";
  import * as Sidebar from "$lib/components/ui/sidebar";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import { fetchCurrentUser, type CurrentUser } from "$lib/api/auth";
  import { newInquiryCount, refreshInquiryBadge } from "$lib/stores/admin-badges";
  import { peek, remember } from "$lib/api/swr";
  import { captureSession, isCurrentSession } from "$lib/api/session";

  let { children } = $props();

  // 현재 계정의 서버 확인 전에는 이전 관리자 캐시로 children을 렌더링하지 않는다.
  const remembered = peek<CurrentUser>("me") ?? null;
  let user = $state<CurrentUser | null>(remembered);
  let checking = $state(true);

  const pageTitles: Array<[string, string]> = [
    ["/admin/inquiries", "공연 신청·상담"],
    ["/admin/support", "고객센터 문의"],
    ["/admin/settings", "사이트·약관 설정"],
    ["/admin/faq", "자주 묻는 질문 관리"],
    ["/admin/members", "회원·공연 배정"],
    ["/admin/assistant", "공연 도우미"],
    ["/admin/productions", "공연 관리"],
    ["/admin/activity", "활동 기록"],
    ["/admin/system", "시스템 점검"]
  ];

  const currentTitle = $derived(
    pageTitles.find(([prefix]) => isAdminPath($page.url.pathname, prefix))?.[1] ?? "운영 현황"
  );

  onMount(async () => {
    const session = captureSession();
    const me = await fetchCurrentUser({ fresh: true });
    if (!isCurrentSession(session)) return;
    if (!me) {
      await goto(`/login?next=${encodeURIComponent($page.url.pathname + $page.url.search)}`, { replaceState: true });
      return;
    }
    if (me.platformRole !== "SUPER_ADMIN") {
      await goto("/app");
      return;
    }
    user = remember("me", me, session);
    checking = false;
    void refreshInquiryBadge().catch(() => {});
  });
</script>

<svelte:head>
  <title>{currentTitle} — 공연 운영</title>
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
  <a class="skip-link" href="#admin-main">본문으로 건너뛰기</a>
  <Sidebar.Provider>
    <AdminSidebar {user} inquiryBadge={$newInquiryCount ?? 0} />
    <Sidebar.Inset class="min-w-0">
      <header class="bg-background/95 sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b backdrop-blur">
        <div class="flex min-w-0 items-center gap-2 px-4">
          <Sidebar.Trigger class="-ms-1 size-11" aria-label="관리자 메뉴 열기" />
          <Separator orientation="vertical" class="me-2 data-[orientation=vertical]:h-4" />
          <Breadcrumb.Root>
            <Breadcrumb.List>
              <Breadcrumb.Item class="hidden md:block">
                <Breadcrumb.Link href="/admin">공연 운영</Breadcrumb.Link>
              </Breadcrumb.Item>
              <Breadcrumb.Separator class="hidden md:block" />
              <Breadcrumb.Item>
                <Breadcrumb.Page>{currentTitle}</Breadcrumb.Page>
              </Breadcrumb.Item>
            </Breadcrumb.List>
          </Breadcrumb.Root>
        </div>
      </header>
      <main id="admin-main" tabindex="-1" class="flex min-w-0 flex-1 flex-col gap-5 p-4 sm:p-6" aria-label={currentTitle}>
        {@render children()}
      </main>
    </Sidebar.Inset>
  </Sidebar.Provider>
{/if}
