<script lang="ts">
  import { afterNavigate, goto } from "$app/navigation";
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import type { Snippet } from "svelte";
  import { apiRequest, clearTokens, getAccessToken } from "$lib/api/client";
  import AppIcon, { type AppIconName } from "$lib/components/AppIcon.svelte";

  type PlatformRole = "SUPER_ADMIN" | "ORG_ADMIN" | "MEMBER";
  type ProfileType = "ACTOR" | "STAFF" | "DIRECTOR" | "MUSIC_DIRECTOR" | "STAGE_MANAGER" | "PLANNER" | "OTHER";
  type FrameKind = "public" | "app" | "admin";
  type MenuItem = {
    href: string;
    label: string;
    icon: AppIconName;
    description?: string;
    badge?: string | number;
    disabled?: boolean;
  };
  type MenuGroup = {
    label: string;
    items: MenuItem[];
  };
  type CurrentUser = {
    id: string;
    email?: string;
    name?: string;
    platformRole: PlatformRole;
    profileType: ProfileType;
    organization?: { id: string; name: string; status: string } | null;
  };
  type ProductionDashboard = {
    production: {
      id: string;
      title: string;
      phase?: string;
      visibility?: string;
    };
    myRoles: string[];
    myStaffDisciplines?: Array<{ discipline: string; label?: string | null }>;
  };
  type Props = {
    children: Snippet;
    unreadNotifications?: number;
    notificationReady?: boolean;
  };

  let { children, unreadNotifications = 0, notificationReady = false }: Props = $props();

  let currentUser = $state<CurrentUser | null>(null);
  let productionContext = $state<ProductionDashboard | null>(null);
  let contextLoading = $state(false);
  let sidebarOpen = $state(false);
  let sidebarCollapsed = $state(false);

  const path = $derived(page.url.pathname);
  const productionId = $derived(extractProductionId(path));
  const frameKind = $derived(getFrameKind(path));
  const isAdminFrame = $derived(frameKind === "admin");
  const isAdminAccount = $derived(hasPlatformRole(currentUser, ["SUPER_ADMIN", "ORG_ADMIN"]));
  const isSuperAdminAccount = $derived(hasPlatformRole(currentUser, ["SUPER_ADMIN"]));
  const isReadingWorkspace = $derived(/^\/p\/[^/]+\/reading(?:\/[^/]+)?/.test(path));
  const usesAdminNavigation = $derived(isAdminFrame || (isAdminAccount && !productionId));
  const userName = $derived(currentUser?.name || currentUser?.email || "로그인 필요");
  const userMeta = $derived(getUserMeta(currentUser));
  const userInitial = $derived((currentUser?.name || currentUser?.email || "A").slice(0, 1).toUpperCase());
  const menuGroups = $derived(
    buildMenuGroups({
      frameKind,
      usesAdminNavigation,
      path,
      productionId,
      currentUser,
      productionContext,
      unreadNotifications,
      notificationReady
    })
  );
  const frameTitle = $derived(getFrameTitle(frameKind, path, productionContext, currentUser));
  const frameDescription = $derived(getFrameDescription(frameKind, path, productionContext, currentUser));

  onMount(() => {
    void loadFrameContext();
  });

  afterNavigate(() => {
    sidebarOpen = false;
    void loadFrameContext();
  });

  async function loadFrameContext() {
    if (frameKind === "public" || typeof localStorage === "undefined") {
      currentUser = null;
      productionContext = null;
      return;
    }

    const token = getAccessToken();
    if (!token) {
      currentUser = null;
      productionContext = null;
      return;
    }

    contextLoading = true;
    try {
      currentUser = await apiRequest<CurrentUser>("/auth/me");
      if (productionId) {
        productionContext = await apiRequest<ProductionDashboard>(`/productions/${productionId}/dashboard`);
      } else {
        productionContext = null;
      }
    } catch {
      currentUser = null;
      productionContext = null;
    } finally {
      contextLoading = false;
    }
  }

  async function logout() {
    clearTokens();
    currentUser = null;
    productionContext = null;
    await goto("/login");
  }

  function getFrameKind(pathname: string): FrameKind {
    if (pathname === "/admin" || pathname.startsWith("/admin/")) return "admin";
    if (
      pathname === "/" ||
      pathname === "/login" ||
      pathname === "/register" ||
      pathname === "/forgot" ||
      pathname === "/reset" ||
      pathname.startsWith("/invite/") ||
      pathname.startsWith("/r/")
    ) {
      return "public";
    }
    return "app";
  }

  function extractProductionId(pathname: string) {
    return pathname.match(/^\/p\/([^/]+)/)?.[1] ?? "";
  }

  function hasPlatformRole(user: CurrentUser | null, roles: PlatformRole[]) {
    return !!user && roles.includes(user.platformRole);
  }

  function hasProductionRole(context: ProductionDashboard | null, roles: string[]) {
    return !!context && context.myRoles.some((role) => roles.includes(role));
  }

  function hasStaffDiscipline(context: ProductionDashboard | null, disciplines: string[]) {
    return !!context?.myStaffDisciplines?.some((assignment) => disciplines.includes(assignment.discipline));
  }

  function canManageProduction(user: CurrentUser | null, context: ProductionDashboard | null) {
    return hasPlatformRole(user, ["SUPER_ADMIN", "ORG_ADMIN"]) || hasProductionRole(context, ["PRODUCER", "DIRECTOR"]);
  }

  function canManageMusic(user: CurrentUser | null, context: ProductionDashboard | null) {
    return (
      canManageProduction(user, context) ||
      hasProductionRole(context, ["MUSIC_DIRECTOR", "STAGE_MANAGER"]) ||
      hasStaffDiscipline(context, ["SOUND", "ACCOMPANIST"])
    );
  }

  function canManageStage(user: CurrentUser | null, context: ProductionDashboard | null) {
    return (
      canManageProduction(user, context) ||
      hasProductionRole(context, ["STAGE_MANAGER"]) ||
      hasStaffDiscipline(context, ["STAGE_CREW", "PROPS", "LIGHTING", "VIDEO", "PRODUCTION_ASSISTANT", "OTHER"])
    );
  }

  function canViewRunSheets(user: CurrentUser | null, context: ProductionDashboard | null) {
    return (
      canManageProduction(user, context) ||
      hasProductionRole(context, ["STAGE_MANAGER", "MUSIC_DIRECTOR", "STAFF"])
    );
  }

  function buildMenuGroups(input: {
    frameKind: FrameKind;
    usesAdminNavigation: boolean;
    path: string;
    productionId: string;
    currentUser: CurrentUser | null;
    productionContext: ProductionDashboard | null;
    unreadNotifications: number;
    notificationReady: boolean;
  }): MenuGroup[] {
    if (input.frameKind === "public") return [];

    const notificationBadge = input.notificationReady && input.unreadNotifications > 0 ? Math.min(input.unreadNotifications, 99) : undefined;
    const isSuperAdmin = hasPlatformRole(input.currentUser, ["SUPER_ADMIN"]);
    const isOrgOperator = hasPlatformRole(input.currentUser, ["SUPER_ADMIN", "ORG_ADMIN"]);

    if (input.usesAdminNavigation) {
      const operationItems: MenuItem[] = [];

      if (isSuperAdmin) {
        operationItems.push({ href: "/admin", label: "운영 대시보드", icon: "shield", description: "현황·감사·설정" });
      }

      operationItems.push({ href: "/admin/productions", label: "공연 관리", icon: "stage", description: "등록·기획 메모" });

      if (isSuperAdmin) {
        operationItems.push({ href: "/admin/members", label: "회원 관리", icon: "users", description: "차단·복구" });
      }

      return [
        { label: "운영 관리", items: operationItems },
        {
          label: "운영자 계정",
          items: [
            { href: "/notifications", label: "운영 알림", icon: "bell", description: "승인·변경 확인", badge: notificationBadge },
            { href: "/app/profile", label: "프로필", icon: "user", description: "연락처·직군·사진" }
          ]
        }
      ];
    }

    const accountItems: MenuItem[] = [
      { href: "/app", label: "내 작업으로", icon: "home", description: "홈·일정·알림" },
      { href: "/app/profile", label: "프로필", icon: "user", description: "연락처·직군·사진" }
    ];

    if (input.frameKind === "admin") {
      return [{ label: "내 작업", items: accountItems }];
    }

    const groups: MenuGroup[] = [{ label: "내 작업", items: accountItems }];

    if (input.productionId) {
      const pid = input.productionId;
      // 조회 화면은 전부 새 워크스페이스로 — 이 셸에는 편집 도구만 남긴다.
      const productionItems: MenuItem[] = [
        { href: `/app/p/${pid}`, label: "워크스페이스", icon: "dashboard", description: "개요·큐시트·대본" },
        { href: `/p/${pid}/reading`, label: "리딩룸", icon: "panel", description: "공연 당일 진행" }
      ];

      if (canManageProduction(input.currentUser, input.productionContext)) {
        productionItems.push(
          { href: `/p/${pid}/script`, label: "대본 편집", icon: "file-edit", description: "블록·버전 관리" },
          { href: `/p/${pid}/casting`, label: "캐스팅", icon: "users", description: "배역 배정" },
          { href: `/p/${pid}/members`, label: "멤버", icon: "user-check", description: "역할 매칭" },
          { href: `/p/${pid}/settings`, label: "공연 설정", icon: "settings", description: "단계·공개" }
        );
      }

      groups.unshift({ label: input.productionContext?.production.title ?? "공연 작업", items: productionItems });
    }

    if (isOrgOperator) {
      groups.push({
        label: "운영 관리",
        items: [
          { href: "/admin", label: "운영 콘솔", icon: "shield", description: "대시보드·문의·회원" },
          { href: "/admin/productions", label: "공연 관리", icon: "stage", description: "등록·기획 메모" }
        ]
      });
    }

    return groups;
  }

  function getFrameTitle(kind: FrameKind, pathname: string, context: ProductionDashboard | null, user: CurrentUser | null) {
    const isOperator = hasPlatformRole(user, ["SUPER_ADMIN", "ORG_ADMIN"]);
    if (kind === "admin") return "운영 대시보드";
    if (context?.production.title) return context.production.title;
    if (pathname === "/productions") return isOperator ? "공연 관리" : "내 공연";
    if (pathname === "/schedule/me") return "내 일정";
    if (pathname === "/notifications") return isOperator ? "운영 알림" : "알림 센터";
    if (pathname === "/settings") return isOperator ? "운영자 계정 설정" : "프로필 설정";
    if (pathname === "/org/members") return "단체 회원 관리";
    return "작업공간";
  }

  function getFrameDescription(kind: FrameKind, pathname: string, context: ProductionDashboard | null, user: CurrentUser | null) {
    const isOperator = hasPlatformRole(user, ["SUPER_ADMIN", "ORG_ADMIN"]);
    if (kind === "admin") return "공연 생성, 사용자 상태, 단체 운영, 감사 로그를 관리합니다.";
    if (context?.myRoles.length) return `내 역할: ${context.myRoles.join(", ")}`;
    if (pathname === "/productions") {
      return isOperator ? "공연을 만들고 배우·스태프 매칭과 공개 준비 상태를 확인합니다." : "공연별 대본, 큐, 일정, 진행표를 확인합니다.";
    }
    if (pathname === "/settings" && isOperator) return "운영자 연락처와 알림 수신 기준을 관리합니다.";
    if (user) return getUserMeta(user);
    return "로그인 후 공연 작업을 이어갑니다.";
  }

  function getUserMeta(user: CurrentUser | null) {
    if (!user) return "로그인 후 사용";
    const platform = user.platformRole === "SUPER_ADMIN" ? "최종관리자" : user.platformRole === "ORG_ADMIN" ? "단체관리자" : "멤버";
    const organization = user.organization?.name ? ` · ${user.organization.name}` : "";
    return `${platform}${organization}`;
  }

  function isActive(href: string, pathname: string) {
    if (href === "/productions") return pathname === href;
    if (href === "/admin") return pathname === href;
    if (href === "/") return pathname === href;
    if (/^\/p\/[^/]+$/.test(href)) return pathname === href;
    return pathname === href || pathname.startsWith(`${href}/`);
  }
</script>

{#if frameKind === "public"}
  <div class="public-shell">
    {@render children()}
  </div>
{:else}
  <div
    class="workspace-shell"
    class:sidebar-open={sidebarOpen}
    class:sidebar-collapsed={sidebarCollapsed}
    class:admin-workspace={usesAdminNavigation}
    class:reading-workspace={isReadingWorkspace}
  >
    <button class="sidebar-scrim" type="button" aria-label="메뉴 닫기" onclick={() => (sidebarOpen = false)}></button>

    <aside class="workspace-sidebar" aria-label={usesAdminNavigation ? "관리자 메뉴" : "작업 메뉴"}>
      <div class="sidebar-brand">
        <a class="brand-mark" href={usesAdminNavigation && isSuperAdminAccount ? "/admin" : "/productions"} aria-label="아트브릿지 홈">A</a>
        <div class="sidebar-brand-text">
          <strong>아트브릿지</strong>
          <span>{usesAdminNavigation ? "운영 관리자 콘솔" : "공연 작업공간"}</span>
        </div>
        <button
          class="sidebar-icon-button collapse-button"
          type="button"
          aria-label={sidebarCollapsed ? "사이드바 펼치기" : "사이드바 접기"}
          aria-expanded={!sidebarCollapsed}
          title={sidebarCollapsed ? "사이드바 펼치기" : "사이드바 접기"}
          onclick={() => (sidebarCollapsed = !sidebarCollapsed)}
        >
          <AppIcon name={sidebarCollapsed ? "chevron-right" : "chevron-left"} />
        </button>
      </div>

      <nav class="sidebar-nav" aria-label={usesAdminNavigation ? "관리자 작업" : "공연 작업"}>
        {#each menuGroups as group (group.label)}
          <section class="sidebar-group">
            <p class="sidebar-group-label">{group.label}</p>
            <div class="sidebar-menu">
              {#each group.items as item (item.href)}
                {#if item.disabled}
                  <span class="sidebar-link disabled" aria-disabled="true">
                    <span class="sidebar-link-icon"><AppIcon name={item.icon} /></span>
                    <span class="sidebar-link-text">
                      <strong>{item.label}</strong>
                      {#if item.description}
                        <small>{item.description}</small>
                      {/if}
                    </span>
                  </span>
                {:else}
                  <a
                    class="sidebar-link"
                    class:active={isActive(item.href, path)}
                    href={item.href}
                    aria-current={isActive(item.href, path) ? "page" : undefined}
                  >
                    <span class="sidebar-link-icon"><AppIcon name={item.icon} /></span>
                    <span class="sidebar-link-text">
                      <strong>{item.label}</strong>
                      {#if item.description}
                        <small>{item.description}</small>
                      {/if}
                    </span>
                    {#if item.badge}
                      <span class="sidebar-badge">{item.badge}</span>
                    {/if}
                  </a>
                {/if}
              {/each}
            </div>
          </section>
        {/each}
      </nav>

      <div class="sidebar-footer">
        <div class="sidebar-user">
          <span class="sidebar-avatar">{userInitial}</span>
          <span class="sidebar-user-text">
            <strong>{userName}</strong>
            <small>{userMeta}</small>
          </span>
        </div>
        <div class="sidebar-footer-actions">
          {#if currentUser}
            <button class="button compact" type="button" onclick={logout}>로그아웃</button>
          {:else}
            <a class="button compact primary" href="/login">로그인</a>
          {/if}
        </div>
      </div>
    </aside>

    <div class="workspace-main">
      <header class="workspace-header">
        <button class="sidebar-icon-button mobile-menu-button" type="button" aria-label="메뉴 열기" onclick={() => (sidebarOpen = true)}>
          <AppIcon name="menu" />
        </button>
        <div class="workspace-heading">
          <p>{usesAdminNavigation ? "운영 관리" : isReadingWorkspace ? "리딩 진행" : "작업공간"}</p>
          <div class="workspace-title">{frameTitle}</div>
          <span>{contextLoading ? "권한과 메뉴를 확인하고 있어요." : frameDescription}</span>
        </div>
        <div class="workspace-actions">
          <a class="button ghost notification-bell" href="/notifications" aria-label={`알림 ${unreadNotifications}건`}>
            <AppIcon name="bell" />
            <span>{usesAdminNavigation ? "운영 알림" : "알림"}</span>
            {#if notificationReady && unreadNotifications > 0}
              <span class="notification-count">{unreadNotifications > 99 ? "99+" : unreadNotifications}</span>
            {/if}
          </a>
          <a class="button" href={usesAdminNavigation ? "/admin/productions" : "/app/profile"}>
            <AppIcon name={usesAdminNavigation ? "stage" : "user"} />
            <span>{usesAdminNavigation ? "공연 관리" : "프로필"}</span>
          </a>
        </div>
      </header>

      <div class="workspace-content">
        {@render children()}
      </div>
    </div>
  </div>
{/if}
