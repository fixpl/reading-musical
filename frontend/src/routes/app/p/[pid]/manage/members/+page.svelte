<script lang="ts">
  import { page } from "$app/stores";
  import { toast } from "svelte-sonner";
  import * as Dialog from "$lib/components/ui/dialog";
  import * as Select from "$lib/components/ui/select";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import { ConfirmDialog, type ConfirmAsk } from "$lib/components/ui/confirm-dialog";
  import { ErrorPanel } from "$lib/components/ui/error-panel";
  import { EmptyState } from "$lib/components/ui/empty-state";
  import { PageHeader } from "$lib/components/ui/page-header";
  import { apiRequest, ApiError } from "$lib/api/client";
  import { EMPTY_PRODUCTION_ACCESS, getProductionAccess, type ProductionAccess } from "$lib/api/production-access";
  import {
    PRODUCTION_ROLE_LABELS,
    PROFILE_TYPE_LABELS,
    STAFF_DISCIPLINE_LABELS
  } from "$lib/domain/labels";
  import { staffAssignmentInput, type StaffAssignmentValue } from "$lib/domain/staff-assignment-editor";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import SearchIcon from "@lucide/svelte/icons/search";

  type StaffAssignment = { id: string; discipline: string; customLabel: string | null; isLead: boolean };
  type Membership = {
    id: string;
    primaryRole: string;
    roles: Array<{ role: string }>;
    staffAssignments: StaffAssignment[];
    user: { id: string; name: string; email: string; profileType: string };
  };
  type Candidate = { id: string; name: string; email: string; profileType: string };
  type CastingRole = { id: string; name: string; assignments: Array<{ membership: { id: string } }> };

  const pid = $derived($page.params.pid ?? "");
  const ALL_ROLES = ["ACTOR", "STAFF", "DIRECTOR", "MUSIC_DIRECTOR", "STAGE_MANAGER", "PRODUCER", "GUEST"];
  const ALL_DISCIPLINES = Object.keys(STAFF_DISCIPLINE_LABELS);

  // 직군 탭: [추가할 역할, 회원 풀 필터(profileType)]
  const TABS: Array<{ role: string; profileType: string }> = [
    { role: "ACTOR", profileType: "ACTOR" },
    { role: "STAFF", profileType: "STAFF" },
    { role: "DIRECTOR", profileType: "DIRECTOR" },
    { role: "MUSIC_DIRECTOR", profileType: "MUSIC_DIRECTOR" },
    { role: "STAGE_MANAGER", profileType: "STAGE_MANAGER" },
    { role: "PRODUCER", profileType: "PLANNER" }
  ];

  const GROUPS: Array<{ key: string; label: string; roles: string[] }> = [
    { key: "actor", label: "배우", roles: ["ACTOR", "GUEST"] },
    { key: "staff", label: "스태프", roles: ["STAFF"] },
    { key: "crew", label: "제작진", roles: ["PRODUCER", "DIRECTOR", "MUSIC_DIRECTOR", "STAGE_MANAGER"] }
  ];

  let access = $state<ProductionAccess>({ ...EMPTY_PRODUCTION_ACCESS });
  let members = $state<Membership[]>([]);
  let castingRoles = $state<CastingRole[]>([]);
  let loading = $state(true);
  let forbidden = $state(false);
  let saving = $state(false);
  let loadError = $state("");
  let retryKey = $state(0);
  let confirmation: { ask: ConfirmAsk };

  // 추가 패널
  let addTab = $state("ACTOR");
  let pool = $state<Candidate[]>([]);
  let poolLoading = $state(false);
  let poolError = $state("");
  let query = $state("");
  let selectedIds = $state<Set<string>>(new Set());
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let poolRequest: AbortController | null = null;

  // 편집 다이얼로그
  let editTarget = $state<Membership | null>(null);
  let editRoles = $state<string[]>([]);
  let editPrimary = $state("ACTOR");
  let editDisciplines = $state<string[]>([]);
  let editOtherLabels = $state<string[]>([]);
  let editError = $state("");

  const addRoleLabel = $derived(PRODUCTION_ROLE_LABELS[addTab] ?? addTab);

  // 아직 가입하지 않은 사람은 이메일로 초대한다. 선택한 직군이 초대 역할이 된다.
  let inviteEmail = $state("");
  let inviting = $state(false);
  let inviteResult = $state<{ email: string; url: string } | null>(null);
  type PendingInvite = { id: string; email: string; role: string; expiresAt: string; inviteUrl: string };
  let invites = $state<PendingInvite[]>([]);
  let invitesError = $state("");
  async function loadInvites() {
    if (!access.canManageMembers) return;
    const id = pid;
    invitesError = "";
    try {
      const list = await apiRequest<PendingInvite[]>(`/productions/${id}/invitations`);
      if (id === pid) invites = list;
    } catch {
      if (id === pid) invitesError = "보낸 초대를 불러오지 못했어요.";
    }
  }
  async function revokeInvite(invite: PendingInvite) {
    if (!access.canManageMembers) return;
    const { confirmed } = await confirmation.ask({ title: "초대를 취소할까요?", description: `${invite.email}에 보낸 초대 링크를 더 이상 쓸 수 없어요.`, confirmLabel: "초대 취소", destructive: true });
    if (!confirmed) return;
    try {
      await apiRequest(`/productions/${pid}/invitations/${invite.id}`, { method: "DELETE" });
      toast.success("초대를 취소했어요.");
      await loadInvites();
    } catch (error) { toast.error(error instanceof Error ? error.message : "초대를 취소하지 못했어요"); }
  }
  async function copyLink(url: string) {
    try { await navigator.clipboard.writeText(url); toast.success("초대 링크를 복사했어요."); }
    catch { toast.error("복사하지 못했어요."); }
  }
  async function sendInvite(event: SubmitEvent) {
    event.preventDefault();
    const email = inviteEmail.trim();
    if (!access.canManageMembers || !email || inviting) return;
    inviting = true;
    inviteResult = null;
    try {
      const result = await apiRequest<{ email: string; inviteUrl: string }>(`/productions/${pid}/invitations`, {
        method: "POST", body: JSON.stringify({ email, role: addTab })
      });
      inviteResult = { email: result.email, url: result.inviteUrl };
      inviteEmail = "";
      toast.success("초대 링크를 만들었어요.");
      await loadInvites();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "초대하지 못했어요");
    } finally {
      inviting = false;
    }
  }
  async function copyInvite() {
    if (!inviteResult) return;
    try { await navigator.clipboard.writeText(inviteResult.url); toast.success("초대 링크를 복사했어요."); }
    catch { toast.error("복사하지 못했어요. 링크를 직접 선택해 복사해 주세요."); }
  }

  function memberGroup(group: { roles: string[] }) {
    return members.filter((member) => member.roles.some((item) => group.roles.includes(item.role)));
  }

  function castingRolesOf(membershipId: string) {
    return castingRoles.filter((role) => role.assignments.some((a) => a.membership.id === membershipId)).map((r) => r.name);
  }

  async function loadMembers() {
    const id = pid;
    const [memberList, roleList] = await Promise.all([
      apiRequest<Membership[]>(`/productions/${id}/members`),
      apiRequest<CastingRole[]>(`/productions/${id}/roles`).catch(() => [] as CastingRole[])
    ]);
    if (id !== pid) return;
    members = memberList;
    castingRoles = roleList;
  }

  const POOL_PAGE = 40;
  let poolRaw = 0; // 서버에서 지금까지 받은 후보 수(다음 페이지 시작 위치)
  let poolHasMore = $state(false);
  let poolMoreLoading = $state(false);

  function stopPoolSearch() {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = null;
    poolRequest?.abort();
    poolRequest = null;
  }

  // append=true 이면 이미 보이는 뒤에 다음 페이지를 이어 붙인다.
  async function loadPool(append = false) {
    if (!access.canManageMembers) return;
    stopPoolSearch();
    const id = pid;
    const request = new AbortController();
    poolRequest = request;
    const current = () => !request.signal.aborted && id === pid;
    poolMoreLoading = append;
    poolLoading = !append;
    poolError = "";
    try {
      const tab = TABS.find((t) => t.role === addTab) ?? TABS[0];
      const params = new URLSearchParams({ productionId: id, take: String(POOL_PAGE), skip: String(append ? poolRaw : 0) });
      const q = query.trim();
      if (q.length >= 2) params.set("q", q);
      else params.set("profileType", tab.profileType);
      const result = await apiRequest<{ users: Candidate[] } | Candidate[]>(`/users/search?${params.toString()}`, { signal: request.signal });
      if (!current()) return;
      const list = Array.isArray(result) ? result : (result.users ?? []);
      const memberIds = new Set(members.map((m) => m.user.id));
      const fresh = list.filter((c) => !memberIds.has(c.id));
      poolRaw = (append ? poolRaw : 0) + list.length;
      poolHasMore = list.length >= POOL_PAGE;
      pool = append ? [...pool, ...fresh.filter((c) => !pool.some((p) => p.id === c.id))] : fresh;
    } catch (error) {
      if (!current()) return;
      poolError = error instanceof Error ? error.message : "회원을 불러오지 못했어요";
    } finally {
      if (current()) {
        poolRequest = null;
        poolLoading = false;
        poolMoreLoading = false;
      }
    }
  }

  function onQueryInput() {
    stopPoolSearch();
    poolLoading = true;
    poolMoreLoading = false;
    searchTimer = setTimeout(() => void loadPool(), 350);
  }

  function selectTab(role: string) {
    if (saving || inviting || addTab === role) return;
    addTab = role;
    query = "";
    selectedIds = new Set();
    void loadPool();
  }

  function toggleSelect(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selectedIds = next;
  }

  async function addSelected() {
    if (!access.canManageMembers || selectedIds.size === 0 || saving) return;
    const id = pid;
    const role = addTab;
    const userIds = [...selectedIds];
    saving = true;
    try {
      await apiRequest(`/productions/${id}/members`, {
        method: "POST",
        body: JSON.stringify({ userIds, roles: [role], primaryRole: role })
      });
      if (id !== pid) return;
      toast.success(`${userIds.length}명을 ${PRODUCTION_ROLE_LABELS[role] ?? role} 역할로 추가했어요.`);
      selectedIds = new Set();
      await loadMembers();
      await loadPool();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "추가하지 못했어요");
    } finally {
      saving = false;
    }
  }

  function openEdit(member: Membership) {
    if (!canEditMember(member)) return;
    editTarget = member;
    editRoles = member.roles.map((item) => item.role);
    editPrimary = member.primaryRole;
    editDisciplines = [...new Set(member.staffAssignments.map((item) => item.discipline))];
    editOtherLabels = member.staffAssignments.filter((item) => item.discipline === "OTHER").map((item) => item.customLabel ?? "");
    editError = "";
  }

  function canEditMember(member: Membership) {
    return access.canManageMembers || (access.canManageStaffAssignments && member.roles.some((item) => item.role === "STAFF"));
  }

  function toggleEditRole(role: string) {
    if (!access.canManageMembers) return;
    editRoles = editRoles.includes(role) ? editRoles.filter((item) => item !== role) : [...editRoles, role];
    if (!editRoles.includes(editPrimary) && editRoles.length > 0) editPrimary = editRoles[0];
  }

  function toggleDiscipline(discipline: string) {
    if (!access.canManageStaffAssignments) return;
    editError = "";
    if (discipline === "OTHER" && !editDisciplines.includes("OTHER") && editOtherLabels.length === 0) editOtherLabels = [""];
    editDisciplines = editDisciplines.includes(discipline)
      ? editDisciplines.filter((item) => item !== discipline)
      : [...editDisciplines, discipline];
  }

  async function saveEdit() {
    if (!editTarget || !canEditMember(editTarget) || editRoles.length === 0 || saving) return;
    editError = "";
    let assignments: StaffAssignmentValue[] = [];
    // 역할 PATCH 전에 직무를 검증해 입력 오류로 인한 부분 저장을 막는다.
    try {
      if (access.canManageStaffAssignments && editRoles.includes("STAFF")) assignments = staffAssignmentInput(editDisciplines, editOtherLabels, editTarget.staffAssignments);
    } catch (error) {
      editError = error instanceof Error ? error.message : "스태프 직무를 확인해 주세요.";
      return;
    }
    saving = true;
    try {
      if (access.canManageMembers) {
        await apiRequest(`/productions/${pid}/members/${editTarget.id}`, {
          method: "PATCH",
          body: JSON.stringify({ roles: editRoles, primaryRole: editPrimary })
        });
      }
      if (access.canManageStaffAssignments && editRoles.includes("STAFF")) {
        await apiRequest(`/productions/${pid}/members/${editTarget.id}/staff-assignments`, {
          method: "PUT",
          body: JSON.stringify({ assignments })
        });
      }
      toast.success("저장했어요");
      editTarget = null;
      await loadMembers();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "저장하지 못했어요");
    } finally {
      saving = false;
    }
  }

  async function requestRemoveMember() {
    const target = editTarget;
    if (!access.canManageMembers || !target || saving) return;
    const { confirmed } = await confirmation.ask({
      title: `${target.user.name}님을 공연에서 내보낼까요?`,
      description: "이 공연의 멤버와 배역·직무 배정에서 빠져요. 회원 계정은 유지돼요.",
      confirmLabel: "공연에서 내보내기",
      destructive: true
    });
    if (confirmed) await removeMember(target);
  }

  async function removeMember(target: Membership) {
    if (!access.canManageMembers || saving) return;
    saving = true;
    try {
      await apiRequest(`/productions/${pid}/members/${target.id}`, { method: "DELETE" });
      toast.success("멤버를 내보냈어요");
      editTarget = null;
      await loadMembers();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "내보내지 못했어요");
    } finally {
      saving = false;
    }
  }

  $effect(() => {
    const id = pid;
    void retryKey;
    loadError = "";
    poolError = "";
    invitesError = "";
    // 공연이 바뀌면 이전 공연의 멤버·후보·선택 상태가 남지 않도록 모두 비운다.
    access = { ...EMPTY_PRODUCTION_ACCESS };
    members = [];
    castingRoles = [];
    pool = [];
    poolRaw = 0;
    poolHasMore = false;
    poolLoading = false;
    poolMoreLoading = false;
    query = "";
    selectedIds = new Set();
    editTarget = null;
    invites = [];
    inviteResult = null;
    inviteEmail = "";
    stopPoolSearch();
    loading = true;
    forbidden = false;
    (async () => {
      try {
        const permissions = await getProductionAccess(id);
        if (id !== pid) return;
        access = permissions;
        if (!access.canViewMembers) { forbidden = true; return; }
        await loadMembers();
        if (id !== pid || !permissions.canManageMembers) return;
        await loadPool();
        if (id !== pid) return;
        void loadInvites();
      } catch (error) {
        if (id !== pid) return;
        if (error instanceof ApiError && error.status === 403) {
          forbidden = true;
        } else {
          loadError = error instanceof Error ? error.message : "멤버를 불러오지 못했어요";
        }
      } finally {
        if (id === pid) loading = false;
      }
    })();
    return stopPoolSearch;
  });
</script>

<svelte:head>
  <title>멤버 관리 — 아트브릿지</title>
</svelte:head>

<ConfirmDialog bind:this={confirmation} />

<div class="mx-auto w-full max-w-5xl">
  <PageHeader title="멤버 관리" description={access.canManageMembers ? "배우·스태프를 추가하고 공연에서 맡을 역할을 정해요." : access.canManageStaffAssignments ? "공연 멤버와 역할을 확인해요. 스태프를 누르면 담당 직무를 정할 수 있어요." : "공연 멤버와 배정된 역할을 확인해요."}>
    {#snippet actions()}
      {#if access.canManageMembers && !loading && !loadError}<Button href="#add-production-members" size="touch"><PlusIcon />멤버 추가</Button>{/if}
      {#if access.canEditCasting}<Button href={`/app/p/${pid}/manage/casting`} variant="outline" size="touch">배역 배정</Button>{/if}
      <Button href={`/app/p/${pid}/schedule`} variant="outline" size="touch">공연 일정</Button>
    {/snippet}
  </PageHeader>

  {#if loading}
    <Skeleton class="mt-2 h-[460px] w-full rounded-2xl" />
  {:else if forbidden}
    <section class="bg-card mt-2 rounded-2xl border p-8 text-center" role="alert">
      <h2 class="font-semibold">이 화면을 관리할 권한이 없어요</h2>
      <p class="text-muted-foreground mt-2 text-sm">멤버 관리는 제작진만 할 수 있어요.</p>
    </section>
  {:else if loadError}
    <ErrorPanel class="mt-2" title="멤버를 불러오지 못했어요" message={loadError} onRetry={() => (retryKey += 1)} />
  {:else}
    <div class="mt-2 grid min-w-0 grid-cols-1 gap-4 {access.canManageMembers ? 'lg:grid-cols-[minmax(0,1fr)_360px]' : ''}">
      <!-- 현재 멤버 -->
      <div class="grid min-w-0 gap-4">
        {#each GROUPS as group (group.key)}
          {@const list = memberGroup(group)}
          {#if list.length > 0}
            <div>
              <p class="text-muted-foreground mb-1.5 text-xs font-semibold tracking-wide uppercase">
                {group.label} <span class="text-muted-foreground/70">{list.length}</span>
              </p>
              <div class="grid min-w-0 grid-cols-1 gap-2">
                {#each list as member (member.id)}
                  {@const castNames = castingRolesOf(member.id)}
                  <button
                    type="button"
                    class="bg-card hover:bg-accent/60 grid w-full min-w-0 grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-x-3.5 gap-y-2 rounded-2xl px-4 py-3 text-start transition-colors sm:flex"
                    disabled={!canEditMember(member)}
                    onclick={() => openEdit(member)}
                  >
                    <span class="bg-primary/15 text-primary flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold">
                      {member.user.name.slice(0, 2)}
                    </span>
                    <span class="min-w-0 flex-1">
                      <span class="block break-words text-sm font-semibold [overflow-wrap:anywhere]">{member.user.name}</span>
                      <span class="text-muted-foreground block truncate text-xs">
                        {#if group.key === "actor" && castNames.length > 0}
                          {castNames.join(", ")}
                        {:else if group.key === "staff" && member.staffAssignments.length > 0}
                          {member.staffAssignments.map((item) => item.discipline === "OTHER" ? item.customLabel || "기타" : STAFF_DISCIPLINE_LABELS[item.discipline] ?? item.discipline).join(", ")}
                        {:else}
                          {member.user.email}
                        {/if}
                      </span>
                    </span>
                    <span class="col-start-2 flex min-w-0 flex-wrap gap-1 sm:ms-auto sm:max-w-[50%] sm:shrink-0 sm:justify-end">
                      {#each member.roles as role (role.role)}
                        <Badge variant={role.role === member.primaryRole ? "default" : "outline"} class="text-xs">
                          {PRODUCTION_ROLE_LABELS[role.role] ?? role.role}
                        </Badge>
                      {/each}
                    </span>
                  </button>
                {/each}
              </div>
            </div>
          {/if}
        {/each}
        {#if members.length === 0}
          <EmptyState title="아직 멤버가 없어요" description={access.canManageMembers ? "멤버 추가에서 직군을 고르고 회원을 선택해 주세요. 미가입자는 이메일로 초대할 수 있어요." : "기획 담당자가 멤버를 추가하면 여기에 표시돼요."} />
        {/if}
      </div>

      {#if access.canManageMembers}
      <div class="grid min-w-0 content-start gap-4">
        <section id="add-production-members" class="bg-card min-w-0 scroll-mt-16 rounded-2xl border p-4 sm:p-5" aria-labelledby="add-members-title" tabindex="-1">
          <h2 id="add-members-title" class="font-semibold">멤버 추가</h2>
          <p class="text-muted-foreground mt-1 text-sm">공연 역할을 고르고 추가할 회원을 선택해 주세요.</p>
          <div class="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="추가할 공연 역할">
            {#each TABS as tab (tab.role)}
              <button
                type="button"
                class="min-h-11 rounded-full border px-3 py-2 text-xs font-medium transition-colors
                  {addTab === tab.role
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border/70 text-muted-foreground hover:bg-accent/60'}"
                aria-pressed={addTab === tab.role}
                disabled={saving || inviting}
                onclick={() => selectTab(tab.role)}
              >
                {PRODUCTION_ROLE_LABELS[tab.role] ?? tab.role}
              </button>
            {/each}
          </div>

          <div class="relative mt-3">
            <SearchIcon class="text-muted-foreground absolute start-2.5 top-2.5 size-4" />
            <Input aria-label="추가할 회원 검색" bind:value={query} oninput={onQueryInput} placeholder="이름·이메일로 찾기 (2자 이상)" class="min-h-11 ps-8" autocomplete="off" disabled={saving} />
          </div>

          <div class="mt-3 grid max-h-[300px] gap-1 overflow-y-auto overscroll-contain" aria-busy={poolLoading || poolMoreLoading}>
            {#if poolLoading}
              {#each Array(4) as _, i (i)}
                <Skeleton class="h-12 w-full rounded-xl" />
              {/each}
            {:else if poolError}
              <ErrorPanel class="p-4" message={poolError} onRetry={() => loadPool()} />
            {:else if pool.length === 0}
              <p class="text-muted-foreground px-1 py-4 text-center text-sm">
                {query.trim().length >= 2 ? "검색 결과가 없어요." : "이 직군에 추가할 회원이 없어요."}
              </p>
            {:else}
              {#each pool as candidate (candidate.id)}
                {@const picked = selectedIds.has(candidate.id)}
                <button
                  type="button"
                  class="flex min-h-12 w-full min-w-0 items-center gap-2.5 rounded-xl border px-3 py-2 text-start transition-colors
                    {picked ? 'border-primary bg-primary/10' : 'border-border/60 hover:bg-accent/60'}"
                  aria-pressed={picked}
                  disabled={saving}
                  onclick={() => toggleSelect(candidate.id)}
                >
                  <span
                    class="flex size-4 shrink-0 items-center justify-center rounded border
                      {picked ? 'border-primary bg-primary text-primary-foreground' : 'border-border'}"
                  >
                    {#if picked}<span class="text-[10px] leading-none">✓</span>{/if}
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-sm font-medium">{candidate.name}</span>
                    <span class="text-muted-foreground block truncate text-xs">{candidate.email}</span>
                  </span>
                  <Badge variant="outline" class="shrink-0 text-[11px]">
                    {PROFILE_TYPE_LABELS[candidate.profileType] ?? candidate.profileType}
                  </Badge>
                </button>
              {/each}
              {#if poolHasMore}
                <Button variant="outline" class="min-h-11" disabled={poolMoreLoading} onclick={() => loadPool(true)}>{poolMoreLoading ? "불러오는 중…" : "더 보기"}</Button>
              {/if}
            {/if}
          </div>

          <div class="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <span class="text-muted-foreground text-sm" role="status">{addRoleLabel} · {selectedIds.size}명 선택</span>
            <Button size="touch" disabled={saving || selectedIds.size === 0} onclick={addSelected}>
              <PlusIcon />
              {saving ? "추가하는 중…" : "선택한 회원 추가"}
            </Button>
          </div>
        </section>

        <!-- 이메일 초대 -->
        <section class="bg-card min-w-0 rounded-2xl border p-4 sm:p-5" aria-labelledby="invite-members-title">
          <h2 id="invite-members-title" class="font-semibold">이메일로 초대</h2>
          <p class="text-muted-foreground mt-1 text-sm leading-6"><strong class="text-foreground">{addRoleLabel}</strong> 역할로 초대해요. 링크는 72시간 동안 유효해요.</p>
          <form class="mt-3 grid gap-2" onsubmit={sendInvite}>
            <Input type="email" class="min-h-11 min-w-0 flex-1" placeholder="name@example.com" bind:value={inviteEmail} disabled={inviting} aria-label="초대할 이메일" required />
            <Button type="submit" size="touch" variant="outline" disabled={inviting || !inviteEmail.trim()}>{inviting ? "초대 준비 중…" : "초대 메일 요청"}</Button>
          </form>
          {#if invitesError}<ErrorPanel class="mt-3 p-4" message={invitesError} onRetry={loadInvites} />{/if}
          {#if invites.length}
            <div class="mt-3 space-y-1.5">
              <p class="text-muted-foreground text-xs font-semibold">보낸 초대 {invites.length}건 (수락 대기)</p>
              {#each invites as invite (invite.id)}
                <div class="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-sm">
                  <span class="min-w-0 flex-1"><span class="block truncate font-medium">{invite.email}</span>
                    <span class="text-muted-foreground text-xs">{PRODUCTION_ROLE_LABELS[invite.role] ?? invite.role} · {new Date(invite.expiresAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}까지</span></span>
                  <Button size="touch" variant="outline" onclick={() => copyLink(invite.inviteUrl)}>링크 복사</Button>
                  <Button size="touch" variant="ghost" class="text-destructive" onclick={() => revokeInvite(invite)}>취소</Button>
                </div>
              {/each}
            </div>
          {/if}
          {#if inviteResult}
            <div class="bg-muted/50 mt-3 space-y-1.5 rounded-xl p-3 text-sm">
              <p class="[overflow-wrap:anywhere]" role="status"><strong>{inviteResult.email}</strong> 초대 링크를 만들었어요. 이 링크를 직접 전달해도 돼요.</p>
              <div class="flex items-center gap-2"><code class="min-w-0 flex-1 truncate">{inviteResult.url}</code><Button size="touch" variant="outline" onclick={copyInvite}>복사</Button></div>
            </div>
          {/if}
        </section>
      </div>
      {/if}
    </div>
  {/if}
</div>

<!-- 역할·직무 편집 -->
<Dialog.Root open={editTarget !== null} onOpenChange={(open) => !open && (editTarget = null)}>
  <Dialog.Content class="max-h-[90dvh] overflow-y-auto sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title class="break-words [overflow-wrap:anywhere]">{editTarget?.user.name} · 역할과 직무</Dialog.Title>
      <Dialog.Description>{access.canManageMembers ? "이 공연에서 맡는 역할을 골라 주세요. 여러 개도 돼요." : "스태프의 담당 직무를 정해요. 공연 역할은 기획 담당자가 변경해요."}</Dialog.Description>
    </Dialog.Header>
    <div class="grid gap-4">
      <div class="grid gap-2">
        <p id="edit-roles-label" class="text-sm font-medium">공연 역할 (여러 개 선택)</p>
        <div class="flex flex-wrap gap-1.5" role="group" aria-labelledby="edit-roles-label">
          {#each ALL_ROLES as role (role)}
            <button
              type="button"
              class="min-h-11 rounded-full border px-3 py-2 text-xs font-medium transition-colors
                {editRoles.includes(role)
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border/70 text-muted-foreground hover:bg-accent/60'}"
              disabled={!access.canManageMembers || saving}
              aria-pressed={editRoles.includes(role)}
              onclick={() => toggleEditRole(role)}
            >
              {PRODUCTION_ROLE_LABELS[role] ?? role}
            </button>
          {/each}
        </div>
      </div>

      {#if editRoles.includes("STAFF")}
        <div class="grid gap-2">
          <p id="staff-disciplines-label" class="text-sm font-medium">스태프 직무 <span class="text-muted-foreground font-normal">(조명·음향 등)</span></p>
          <div class="flex flex-wrap gap-1.5" role="group" aria-labelledby="staff-disciplines-label">
            {#each ALL_DISCIPLINES as discipline (discipline)}
              <button
                type="button"
                class="min-h-11 rounded-full border px-3 py-2 text-xs font-medium transition-colors
                  {editDisciplines.includes(discipline)
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border/70 text-muted-foreground hover:bg-accent/60'}"
                disabled={!access.canManageStaffAssignments || saving}
                aria-pressed={editDisciplines.includes(discipline)}
                onclick={() => toggleDiscipline(discipline)}
              >
                {STAFF_DISCIPLINE_LABELS[discipline]}
              </button>
            {/each}
          </div>
          {#if editDisciplines.includes("OTHER")}
            {#each editOtherLabels as label, index (index)}
              <div class="grid gap-2">
                <Label for={`edit-other-discipline-${index}`}>기타 직무 이름{editOtherLabels.length > 1 ? ` ${index + 1}` : ""}</Label>
                <Input id={`edit-other-discipline-${index}`} value={label} oninput={(event) => { editOtherLabels[index] = event.currentTarget.value; editError = ""; }} maxlength={80} required disabled={!access.canManageStaffAssignments || saving} placeholder="예: 자막 운영" class="min-h-11" />
              </div>
            {/each}
          {/if}
        </div>
      {/if}

      {#if editRoles.length > 1}
        <div class="grid gap-2">
          <Label for="edit-primary-role">대표 역할</Label>
          <Select.Root type="single" bind:value={editPrimary} disabled={!access.canManageMembers || saving}>
            <Select.Trigger id="edit-primary-role" class="min-h-11 w-full">{PRODUCTION_ROLE_LABELS[editPrimary] ?? editPrimary}</Select.Trigger>
            <Select.Content>
              {#each editRoles as role (role)}
                <Select.Item value={role} label={PRODUCTION_ROLE_LABELS[role] ?? role} />
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
      {/if}

      {#if editError}<p role="alert" class="text-sm text-destructive">{editError}</p>{/if}
      <Dialog.Footer class="gap-2 sm:justify-between">
        {#if access.canManageMembers}<Button
          type="button"
          variant="ghost"
          class="min-h-11 text-destructive"
          onclick={requestRemoveMember}
          disabled={saving}
        >
          공연에서 내보내기
        </Button>{/if}
        <div class="flex gap-2">
          <Button type="button" size="touch" variant="ghost" onclick={() => (editTarget = null)}>취소</Button>
          <Button type="button" size="touch" onclick={saveEdit} disabled={saving || editRoles.length === 0}>
            {saving ? "저장 중..." : "저장"}
          </Button>
        </div>
      </Dialog.Footer>
    </div>
  </Dialog.Content>
</Dialog.Root>
