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
  import { apiRequest, ApiError } from "$lib/api/client";
  import {
    PRODUCTION_ROLE_LABELS,
    PROFILE_TYPE_LABELS,
    STAFF_DISCIPLINE_LABELS
  } from "$lib/domain/labels";
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

  let members = $state<Membership[]>([]);
  let castingRoles = $state<CastingRole[]>([]);
  let loading = $state(true);
  let forbidden = $state(false);
  let saving = $state(false);

  // 추가 패널
  let addTab = $state("ACTOR");
  let pool = $state<Candidate[]>([]);
  let poolLoading = $state(false);
  let query = $state("");
  let selectedIds = $state<Set<string>>(new Set());
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  // 편집 다이얼로그
  let editTarget = $state<Membership | null>(null);
  let editRoles = $state<string[]>([]);
  let editPrimary = $state("ACTOR");
  let editDisciplines = $state<string[]>([]);

  const addRoleLabel = $derived(PRODUCTION_ROLE_LABELS[addTab] ?? addTab);

  function memberGroup(group: { roles: string[] }) {
    return members.filter((member) => member.roles.some((item) => group.roles.includes(item.role)));
  }

  function castingRolesOf(membershipId: string) {
    return castingRoles.filter((role) => role.assignments.some((a) => a.membership.id === membershipId)).map((r) => r.name);
  }

  async function loadMembers() {
    const [memberList, roleList] = await Promise.all([
      apiRequest<Membership[]>(`/productions/${pid}/members`),
      apiRequest<CastingRole[]>(`/productions/${pid}/roles`).catch(() => [] as CastingRole[])
    ]);
    members = memberList;
    castingRoles = roleList;
  }

  async function loadPool() {
    poolLoading = true;
    try {
      const tab = TABS.find((t) => t.role === addTab) ?? TABS[0];
      const params = new URLSearchParams({ productionId: pid, take: "40" });
      const q = query.trim();
      if (q.length >= 2) params.set("q", q);
      else params.set("profileType", tab.profileType);
      const result = await apiRequest<{ users: Candidate[] } | Candidate[]>(`/users/search?${params.toString()}`);
      const list = Array.isArray(result) ? result : (result.users ?? []);
      const memberIds = new Set(members.map((m) => m.user.id));
      pool = list.filter((c) => !memberIds.has(c.id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "회원을 불러오지 못했습니다");
    } finally {
      poolLoading = false;
    }
  }

  function onQueryInput() {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(loadPool, 350);
  }

  function selectTab(role: string) {
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
    if (selectedIds.size === 0) return;
    saving = true;
    try {
      await apiRequest(`/productions/${pid}/members`, {
        method: "POST",
        body: JSON.stringify({ userIds: [...selectedIds], roles: [addTab], primaryRole: addTab })
      });
      toast.success(`${selectedIds.size}명을 ${addRoleLabel}(으)로 추가했습니다`);
      selectedIds = new Set();
      await loadMembers();
      await loadPool();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "추가하지 못했습니다");
    } finally {
      saving = false;
    }
  }

  function openEdit(member: Membership) {
    editTarget = member;
    editRoles = member.roles.map((item) => item.role);
    editPrimary = member.primaryRole;
    editDisciplines = member.staffAssignments.map((a) => a.discipline);
  }

  function toggleEditRole(role: string) {
    editRoles = editRoles.includes(role) ? editRoles.filter((item) => item !== role) : [...editRoles, role];
    if (!editRoles.includes(editPrimary) && editRoles.length > 0) editPrimary = editRoles[0];
  }

  function toggleDiscipline(discipline: string) {
    editDisciplines = editDisciplines.includes(discipline)
      ? editDisciplines.filter((item) => item !== discipline)
      : [...editDisciplines, discipline];
  }

  async function saveEdit() {
    if (!editTarget || editRoles.length === 0) return;
    saving = true;
    try {
      await apiRequest(`/productions/${pid}/members/${editTarget.id}`, {
        method: "PATCH",
        body: JSON.stringify({ roles: editRoles, primaryRole: editPrimary })
      });
      if (editRoles.includes("STAFF")) {
        await apiRequest(`/productions/${pid}/members/${editTarget.id}/staff-assignments`, {
          method: "PUT",
          body: JSON.stringify({ assignments: editDisciplines.map((discipline) => ({ discipline })) })
        });
      }
      toast.success("저장했습니다");
      editTarget = null;
      await loadMembers();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "저장하지 못했습니다");
    } finally {
      saving = false;
    }
  }

  let confirmingRemove = $state(false);
  let removeConfirmTimer: ReturnType<typeof setTimeout> | undefined;

  function requestRemoveMember() {
    if (confirmingRemove) {
      confirmingRemove = false;
      clearTimeout(removeConfirmTimer);
      void removeMember();
      return;
    }
    confirmingRemove = true;
    clearTimeout(removeConfirmTimer);
    removeConfirmTimer = setTimeout(() => (confirmingRemove = false), 3000);
  }

  async function removeMember() {
    if (!editTarget) return;
    saving = true;
    try {
      await apiRequest(`/productions/${pid}/members/${editTarget.id}`, { method: "DELETE" });
      toast.success("멤버를 내보냈습니다");
      editTarget = null;
      await loadMembers();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "내보내지 못했습니다");
    } finally {
      saving = false;
    }
  }

  $effect(() => {
    void pid;
    loading = true;
    forbidden = false;
    (async () => {
      try {
        await loadMembers();
        await loadPool();
      } catch (error) {
        if (error instanceof ApiError && error.status === 403) {
          forbidden = true;
        } else {
          toast.error(error instanceof Error ? error.message : "멤버를 불러오지 못했습니다");
        }
      } finally {
        loading = false;
      }
    })();
  });
</script>

<svelte:head>
  <title>멤버 관리 — 아트브릿지</title>
</svelte:head>

<div class="mx-auto w-full max-w-5xl">
  <div class="py-2">
    <h1 class="text-xl font-bold tracking-tight">멤버</h1>
    <p class="text-muted-foreground text-sm">직군 탭에서 회원을 골라 한 번에 추가하고, 멤버를 눌러 역할·직무를 정합니다.</p>
  </div>

  {#if loading}
    <Skeleton class="mt-2 h-[460px] w-full rounded-2xl" />
  {:else if forbidden}
    <section class="bg-card mt-2 rounded-2xl border p-8 text-center" role="alert">
      <h2 class="font-semibold">이 화면을 관리할 권한이 없어요</h2>
      <p class="text-muted-foreground mt-2 text-sm">멤버 관리는 제작진만 할 수 있습니다.</p>
    </section>
  {:else}
    <div class="mt-2 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <!-- 현재 멤버 -->
      <div class="grid gap-4">
        {#each GROUPS as group (group.key)}
          {@const list = memberGroup(group)}
          {#if list.length > 0}
            <div>
              <p class="text-muted-foreground mb-1.5 text-xs font-semibold tracking-wide uppercase">
                {group.label} <span class="text-muted-foreground/70">{list.length}</span>
              </p>
              <div class="grid gap-2">
                {#each list as member (member.id)}
                  {@const castNames = castingRolesOf(member.id)}
                  <button
                    type="button"
                    class="bg-card hover:bg-accent/60 flex items-center gap-3.5 rounded-2xl px-4 py-3 text-start transition-colors"
                    onclick={() => openEdit(member)}
                  >
                    <span class="bg-primary/15 text-primary flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold">
                      {member.user.name.slice(0, 2)}
                    </span>
                    <span class="min-w-0 flex-1">
                      <span class="block text-sm font-semibold">{member.user.name}</span>
                      <span class="text-muted-foreground block truncate text-xs">
                        {#if group.key === "actor" && castNames.length > 0}
                          {castNames.join(", ")}
                        {:else if group.key === "staff" && member.staffAssignments.length > 0}
                          {member.staffAssignments.map((a) => STAFF_DISCIPLINE_LABELS[a.discipline] ?? a.discipline).join(", ")}
                        {:else}
                          {member.user.email}
                        {/if}
                      </span>
                    </span>
                    <span class="flex shrink-0 flex-wrap justify-end gap-1">
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
          <div class="bg-card rounded-2xl px-6 py-14 text-center">
            <p class="font-semibold">아직 멤버가 없습니다</p>
            <p class="text-muted-foreground mt-1 text-sm">오른쪽에서 직군을 고르고 회원을 선택해 추가하세요.</p>
          </div>
        {/if}
      </div>

      <!-- 멤버 추가 -->
      <div class="bg-card h-fit rounded-2xl p-4 sm:p-5">
        <p class="font-semibold">멤버 추가</p>
        <div class="mt-3 flex flex-wrap gap-1.5">
          {#each TABS as tab (tab.role)}
            <button
              type="button"
              class="rounded-full border px-3 py-1.5 text-xs font-medium transition-colors
                {addTab === tab.role
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border/70 text-muted-foreground hover:bg-accent/60'}"
              onclick={() => selectTab(tab.role)}
            >
              {PRODUCTION_ROLE_LABELS[tab.role] ?? tab.role}
            </button>
          {/each}
        </div>

        <div class="relative mt-3">
          <SearchIcon class="text-muted-foreground absolute start-2.5 top-2.5 size-4" />
          <Input bind:value={query} oninput={onQueryInput} placeholder="이름·이메일로 좁히기" class="ps-8" autocomplete="off" />
        </div>

        <div class="mt-3 grid max-h-[300px] gap-1 overflow-y-auto">
          {#if poolLoading}
            {#each Array(4) as _, i (i)}
              <Skeleton class="h-12 w-full rounded-xl" />
            {/each}
          {:else if pool.length === 0}
            <p class="text-muted-foreground px-1 py-4 text-center text-sm">
              {query.trim().length >= 2 ? "검색 결과가 없습니다." : "이 직군에 추가할 회원이 없습니다."}
            </p>
          {:else}
            {#each pool as candidate (candidate.id)}
              {@const picked = selectedIds.has(candidate.id)}
              <button
                type="button"
                class="flex items-center gap-2.5 rounded-xl border px-3 py-2 text-start transition-colors
                  {picked ? 'border-primary bg-primary/10' : 'border-border/60 hover:bg-accent/60'}"
                onclick={() => toggleSelect(candidate.id)}
              >
                <span
                  class="flex size-4 shrink-0 items-center justify-center rounded border
                    {picked ? 'border-primary bg-primary text-primary-foreground' : 'border-border'}"
                >
                  {#if picked}<span class="text-[10px] leading-none">✓</span>{/if}
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block text-sm font-medium">{candidate.name}</span>
                  <span class="text-muted-foreground block truncate text-xs">{candidate.email}</span>
                </span>
                <Badge variant="outline" class="shrink-0 text-[11px]">
                  {PROFILE_TYPE_LABELS[candidate.profileType] ?? candidate.profileType}
                </Badge>
              </button>
            {/each}
          {/if}
        </div>

        <div class="mt-3 flex items-center gap-2 border-t pt-3">
          <span class="text-muted-foreground text-sm">선택 {selectedIds.size}명</span>
          <Button class="ms-auto h-9" disabled={saving || selectedIds.size === 0} onclick={addSelected}>
            <PlusIcon />
            {addRoleLabel}(으)로 추가
          </Button>
        </div>
      </div>
    </div>
  {/if}
</div>

<!-- 역할·직무 편집 -->
<Dialog.Root open={editTarget !== null} onOpenChange={(open) => !open && (editTarget = null)}>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>{editTarget?.user.name}</Dialog.Title>
      <Dialog.Description>이 공연에서 맡는 역할을 고르세요. 여러 개도 됩니다.</Dialog.Description>
    </Dialog.Header>
    <div class="grid gap-4">
      <div class="grid gap-2">
        <Label>역할</Label>
        <div class="flex flex-wrap gap-1.5">
          {#each ALL_ROLES as role (role)}
            <button
              type="button"
              class="rounded-full border px-3 py-1.5 text-xs font-medium transition-colors
                {editRoles.includes(role)
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border/70 text-muted-foreground hover:bg-accent/60'}"
              onclick={() => toggleEditRole(role)}
            >
              {PRODUCTION_ROLE_LABELS[role] ?? role}
            </button>
          {/each}
        </div>
      </div>

      {#if editRoles.includes("STAFF")}
        <div class="grid gap-2">
          <Label>스태프 직무 <span class="text-muted-foreground font-normal">(조명·음향 등)</span></Label>
          <div class="flex flex-wrap gap-1.5">
            {#each ALL_DISCIPLINES as discipline (discipline)}
              <button
                type="button"
                class="rounded-full border px-3 py-1.5 text-xs font-medium transition-colors
                  {editDisciplines.includes(discipline)
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border/70 text-muted-foreground hover:bg-accent/60'}"
                onclick={() => toggleDiscipline(discipline)}
              >
                {STAFF_DISCIPLINE_LABELS[discipline]}
              </button>
            {/each}
          </div>
        </div>
      {/if}

      {#if editRoles.length > 1}
        <div class="grid gap-2">
          <Label>대표 역할</Label>
          <Select.Root type="single" bind:value={editPrimary}>
            <Select.Trigger class="w-full">{PRODUCTION_ROLE_LABELS[editPrimary] ?? editPrimary}</Select.Trigger>
            <Select.Content>
              {#each editRoles as role (role)}
                <Select.Item value={role} label={PRODUCTION_ROLE_LABELS[role] ?? role} />
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
      {/if}

      <Dialog.Footer class="gap-2 sm:justify-between">
        <Button
          type="button"
          variant={confirmingRemove ? "destructive" : "ghost"}
          class={confirmingRemove ? "" : "text-destructive"}
          onclick={requestRemoveMember}
          disabled={saving}
        >
          {confirmingRemove ? "한 번 더 누르면 내보내요" : "공연에서 내보내기"}
        </Button>
        <div class="flex gap-2">
          <Button type="button" variant="ghost" onclick={() => (editTarget = null)}>취소</Button>
          <Button type="button" onclick={saveEdit} disabled={saving || editRoles.length === 0}>
            {saving ? "저장 중..." : "저장"}
          </Button>
        </div>
      </Dialog.Footer>
    </div>
  </Dialog.Content>
</Dialog.Root>
