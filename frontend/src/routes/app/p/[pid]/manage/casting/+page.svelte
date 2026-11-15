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
  import { ErrorPanel } from "$lib/components/ui/error-panel";
  import { ConfirmDialog, type ConfirmAsk } from "$lib/components/ui/confirm-dialog";
  import { EmptyState } from "$lib/components/ui/empty-state";
  import { PageHeader } from "$lib/components/ui/page-header";
  import { apiRequest, ApiError } from "$lib/api/client";
  import { EMPTY_PRODUCTION_ACCESS, getProductionAccess, type ProductionAccess } from "$lib/api/production-access";
  import { CAST_ASSIGNMENT_KIND_LABELS } from "$lib/domain/labels";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import SearchIcon from "@lucide/svelte/icons/search";
  import XIcon from "@lucide/svelte/icons/x";
  import UserPlusIcon from "@lucide/svelte/icons/user-plus";
  import GitMergeIcon from "@lucide/svelte/icons/git-merge";

  type Assignment = { id: string; kind: string; membership: { id: string; user: { id: string; name: string } } };
  type Role = {
    id: string;
    name: string;
    description: string | null;
    assignments: Assignment[];
    sceneRoles: Array<{ scene: { id: string; title: string } }>;
  };
  type Membership = { id: string; primaryRole: string; roles: Array<{ role: string }>; user: { id: string; name: string } };
  type Candidate = { id: string; name: string; email: string; profileType: string };

  const pid = $derived($page.params.pid ?? "");

  let access = $state<ProductionAccess>({ ...EMPTY_PRODUCTION_ACCESS });
  let roles = $state<Role[]>([]);
  let members = $state<Membership[]>([]);
  let loading = $state(true);
  let forbidden = $state(false);
  let saving = $state(false);
  let loadError = $state("");
  let retryKey = $state(0);
  let confirmation: { ask: ConfirmAsk };
  let newRoleName = $state("");
  let selectedMembershipId = $state<string | null>(null);

  // 비멤버 배우 검색
  let query = $state("");
  let candidates = $state<Candidate[]>([]);
  let searching = $state(false);
  let searchError = $state("");
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  // 배역 합치기(중복 정리)
  let mergeSource = $state<Role | null>(null);
  let mergeTargetId = $state("");
  let merging = $state(false);

  // 이름이 같거나 다른 배역의 앞글자로 시작하는(약칭 의심) 배역이 있으면 중복 후보로 본다.
  const looksDuplicated = $derived.by(() => {
    const names = roles.map((role) => role.name.trim());
    return roles.some((role) => {
      const name = role.name.trim();
      return names.filter((other) => other === name).length > 1 || names.some((other) => other !== name && other.startsWith(name));
    });
  });

  const actorMembers = $derived(
    members.filter((member) => member.roles.some((item) => item.role === "ACTOR" || item.role === "GUEST"))
  );
  const assignedMembershipIds = $derived(
    new Set(roles.flatMap((role) => role.assignments.map((a) => a.membership.id)))
  );
  // 배역이 아직 없는 배우 = 풀
  const poolActors = $derived(actorMembers.filter((member) => !assignedMembershipIds.has(member.id)));
  const selectedActor = $derived(actorMembers.find((member) => member.id === selectedMembershipId) ?? null);

  async function load() {
    const id = pid;
    const permissions = await getProductionAccess(id);
    if (id !== pid) return;
    access = permissions;
    const [roleList, memberList] = await Promise.all([
      apiRequest<Role[]>(`/productions/${id}/roles`),
      permissions.canViewMembers ? apiRequest<Membership[]>(`/productions/${id}/members`) : Promise.resolve([])
    ]);
    if (id !== pid) return;
    roles = roleList;
    members = memberList;
  }

  async function addRole(event: SubmitEvent) {
    event.preventDefault();
    if (!access.canEditCasting || saving || !newRoleName.trim()) return;
    saving = true;
    try {
      await apiRequest(`/productions/${pid}/roles`, { method: "POST", body: JSON.stringify({ name: newRoleName.trim() }) });
      newRoleName = "";
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "배역을 추가하지 못했어요");
    } finally {
      saving = false;
    }
  }

  async function requestRemoveRole(role: Role) {
    if (!access.canEditCasting || saving) return;
    const { confirmed } = await confirmation.ask({
      title: `“${role.name}” 배역을 삭제할까요?`,
      description: "이 배역과 연결된 배우 배정을 삭제해요. 삭제한 배역은 되돌릴 수 없어요.",
      confirmLabel: "배역 삭제",
      destructive: true
    });
    if (confirmed) await removeRole(role);
  }

  async function removeRole(role: Role) {
    if (!access.canEditCasting || saving) return;
    saving = true;
    try {
      await apiRequest(`/productions/${pid}/roles/${role.id}`, { method: "DELETE" });
      toast.success(`${role.name} 배역을 삭제했어요`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "삭제하지 못했어요");
    } finally {
      saving = false;
    }
  }

  function openMerge(role: Role) {
    if (!access.canEditCasting) return;
    mergeSource = role;
    mergeTargetId = "";
  }

  async function confirmMerge() {
    if (!access.canEditCasting || merging || !mergeSource || !mergeTargetId) return;
    merging = true;
    try {
      const target = roles.find((role) => role.id === mergeTargetId);
      await apiRequest(`/productions/${pid}/roles/${mergeSource.id}/merge`, {
        method: "POST",
        body: JSON.stringify({ targetRoleId: mergeTargetId })
      });
      toast.success(`${mergeSource.name} → ${target?.name ?? "대상"} 배역으로 합쳤어요`);
      mergeSource = null;
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "합치지 못했어요");
    } finally {
      merging = false;
    }
  }

  async function assignSelectedTo(role: Role) {
    if (!access.canEditCasting || saving || !selectedMembershipId) return;
    if (role.assignments.some((a) => a.membership.id === selectedMembershipId)) {
      toast.info("이미 이 배역에 배정된 배우예요");
      return;
    }
    saving = true;
    try {
      await apiRequest(`/productions/${pid}/roles/${role.id}/assignments`, {
        method: "POST",
        body: JSON.stringify({ membershipId: selectedMembershipId })
      });
      toast.success(`${selectedActor?.user.name ?? "선택한 배우"}님을 ${role.name} 배역에 배정했어요.`);
      selectedMembershipId = null;
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "배정하지 못했어요");
    } finally {
      saving = false;
    }
  }

  async function unassign(role: Role, assignment: Assignment) {
    if (!access.canEditCasting || saving) return;
    const { confirmed } = await confirmation.ask({
      title: "배역 배정을 해제할까요?",
      description: `${assignment.membership.user.name}님의 “${role.name}” 배역 배정을 해제해요. 공연 멤버로는 남아 있어요.`,
      confirmLabel: "배정 해제",
      destructive: true
    });
    if (!confirmed) return;
    saving = true;
    try {
      await apiRequest(`/productions/${pid}/roles/${role.id}/assignments/${assignment.id}`, { method: "DELETE" });
      toast.success(`${assignment.membership.user.name}님의 ${role.name} 배역 배정을 해제했어요.`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "해제하지 못했어요");
    } finally {
      saving = false;
    }
  }

  function onQueryInput() {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(searchCandidates, 350);
  }

  async function searchCandidates() {
    if (!access.canManageMembers) return;
    const q = query.trim();
    if (q.length < 2) {
      candidates = [];
      return;
    }
    const id = pid;
    searching = true;
    searchError = "";
    try {
      const params = new URLSearchParams({ productionId: id, q, profileType: "ACTOR", take: "8" });
      const result = await apiRequest<{ users: Candidate[] } | Candidate[]>(`/users/search?${params.toString()}`);
      if (id !== pid) return;
      const list = Array.isArray(result) ? result : (result.users ?? []);
      const memberIds = new Set(members.map((m) => m.user.id));
      candidates = list.filter((c) => !memberIds.has(c.id));
    } catch (error) {
      if (id !== pid) return;
      searchError = error instanceof Error ? error.message : "검색하지 못했어요";
    } finally {
      if (id === pid) searching = false;
    }
  }

  // 비멤버 배우를 배우 멤버로 추가 → 풀에 합류
  async function addAsActor(candidate: Candidate) {
    if (!access.canManageMembers || saving) return;
    saving = true;
    try {
      await apiRequest(`/productions/${pid}/members`, {
        method: "POST",
        body: JSON.stringify({ userIds: [candidate.id], roles: ["ACTOR"], primaryRole: "ACTOR" })
      });
      toast.success(`${candidate.name}님을 배우로 추가했어요. 배역을 눌러 배정해 주세요.`);
      query = "";
      candidates = [];
      await load();
      const added = members.find((m) => m.user.id === candidate.id);
      if (added) selectedMembershipId = added.id;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "추가하지 못했어요");
    } finally {
      saving = false;
    }
  }

  $effect(() => {
    const id = pid;
    void retryKey;
    loadError = "";
    searchError = "";
    // 공연이 바뀌면 이전 공연의 배역·멤버·선택 상태가 남지 않도록 모두 비운다.
    access = { ...EMPTY_PRODUCTION_ACCESS };
    roles = [];
    members = [];
    selectedMembershipId = null;
    newRoleName = "";
    query = "";
    candidates = [];
    searching = false;
    mergeSource = null;
    mergeTargetId = "";
    if (searchTimer) clearTimeout(searchTimer);
    loading = true;
    forbidden = false;
    (async () => {
      try {
        await load();
      } catch (error) {
        if (id !== pid) return;
        if (error instanceof ApiError && error.status === 403) {
          forbidden = true;
        } else {
          loadError = error instanceof Error ? error.message : "캐스팅 정보를 불러오지 못했어요";
        }
      } finally {
        if (id === pid) loading = false;
      }
    })();
    return () => {
      if (searchTimer) clearTimeout(searchTimer);
    };
  });
</script>

<svelte:head>
  <title>캐스팅 — 아트브릿지</title>
</svelte:head>

<ConfirmDialog bind:this={confirmation} />

<div class="mx-auto w-full max-w-5xl">
  <PageHeader title={access.canEditCasting ? "배역 배정" : "배역"} description={access.canEditCasting ? "배우를 고른 뒤 배역 카드에서 배정해요. 한 배역에 여러 배우를 배정할 수도 있어요." : "공연의 배역과 배정된 배우를 확인해요. 배역 변경은 기획·연출 담당자가 진행해요."}>
    {#snippet actions()}
      {#if access.canViewMembers}<Button href={`/app/p/${pid}/manage/members`} variant="outline" size="touch">멤버·스태프 관리</Button>{/if}
      <Button href={`/app/p/${pid}/schedule`} variant="outline" size="touch">공연 일정</Button>
    {/snippet}
  </PageHeader>

  {#if forbidden}
    <ErrorPanel class="mt-2" title="이 화면을 관리할 권한이 없어요" message="캐스팅은 제작진만 편집할 수 있어요." />
  {:else if !loading && access.canEditCasting && looksDuplicated}
    <div class="border-border/60 bg-muted/40 text-muted-foreground mt-1 flex items-start gap-2 rounded-xl border px-4 py-2.5 text-sm">
      <GitMergeIcon class="text-foreground mt-0.5 size-4 shrink-0" />
      <span>같은 인물이 여러 배역으로 나뉘어 있을 수 있어요. 배역 카드의 <b class="text-foreground">합치기</b>로 하나로 모으면 배정·대본·큐가 함께 옮겨져요.</span>
    </div>
  {/if}

  {#if loading}
    <Skeleton class="mt-2 h-[460px] w-full rounded-2xl" />
  {:else if loadError}
    <ErrorPanel class="mt-2" title="배역 정보를 불러오지 못했어요" message={loadError} onRetry={() => (retryKey += 1)} />
  {:else if !forbidden}
    <div class="mt-2 grid gap-4 {access.canEditCasting ? 'lg:grid-cols-[300px_minmax(0,1fr)]' : ''}">
      {#if access.canEditCasting}
      <!-- 배우 풀 -->
      <div class="bg-card h-fit rounded-2xl p-4">
        <p class="font-semibold">배역 없는 배우 <span class="text-muted-foreground/70 text-sm">{poolActors.length}</span></p>
        <p class="text-muted-foreground mt-0.5 text-xs">배우를 고른 뒤 배역 카드의 배정 버튼을 눌러 주세요.</p>

        <div class="mt-3 grid gap-1.5">
          {#each poolActors as member (member.id)}
            {@const picked = selectedMembershipId === member.id}
            <button
              type="button"
              class="flex min-h-11 items-center gap-2.5 rounded-xl border px-3 py-2 text-start transition-colors
                {picked ? 'border-primary bg-primary/10' : 'border-border/60 hover:bg-accent/60'}"
              aria-pressed={picked}
              onclick={() => (selectedMembershipId = picked ? null : member.id)}
            >
              <span class="bg-primary/15 text-primary flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold">
                {member.user.name.slice(0, 2)}
              </span>
              <span class="flex-1 truncate text-sm font-medium">{member.user.name}</span>
              {#if picked}<span class="text-primary text-xs font-semibold">선택됨</span>{/if}
            </button>
          {/each}
          {#if poolActors.length === 0}
            <p class="text-muted-foreground px-1 py-3 text-sm">{actorMembers.length === 0 ? "아직 배우 멤버가 없어요. 기획 담당자가 멤버를 추가하면 배역을 배정할 수 있어요." : "모든 배우에게 배역이 배정되어 있어요."}</p>
          {/if}
        </div>

        {#if access.canManageMembers}
        <!-- 비멤버 배우 찾아 추가 -->
        <div class="mt-4 border-t pt-3">
          <p class="text-muted-foreground mb-2 text-xs font-semibold">공연에 없는 배우 추가</p>
          <div class="relative">
            <SearchIcon class="text-muted-foreground absolute start-2.5 top-2.5 size-4" />
            <Input aria-label="공연에 추가할 배우 검색" bind:value={query} oninput={onQueryInput} placeholder="이름·이메일 (2자 이상)" class="min-h-11 ps-8" autocomplete="off" />
          </div>
          {#if searching}
            <Skeleton class="mt-2 h-10 w-full rounded-xl" />
          {:else if searchError}
            <ErrorPanel class="mt-2 p-4" message={searchError} onRetry={searchCandidates} />
          {:else if candidates.length > 0}
            <div class="mt-2 grid gap-1.5">
              {#each candidates as candidate (candidate.id)}
                <div class="border-border/60 flex items-center gap-2 rounded-xl border px-3 py-2">
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-sm font-medium">{candidate.name}</span>
                    <span class="text-muted-foreground block truncate text-xs">{candidate.email}</span>
                  </span>
                  <Button size="touch" variant="outline" class="min-h-11 shrink-0 px-2 text-xs" disabled={saving} onclick={() => addAsActor(candidate)}>
                    <UserPlusIcon class="size-3.5" />
                    추가
                  </Button>
                </div>
              {/each}
            </div>
          {:else if query.trim().length >= 2}
            <p class="text-muted-foreground mt-2 text-xs">검색 결과가 없어요.</p>
          {/if}
        </div>
        {/if}
      </div>

      {/if}
      <!-- 배역 보드 -->
      <div class="grid gap-2">
        {#if selectedActor}
          <div class="border-primary/30 bg-primary/5 text-primary flex items-center gap-2 rounded-xl border px-4 py-2 text-sm">
            <span class="font-semibold">{selectedActor.user.name}</span> 선택됨 — 배정할 배역을 눌러 주세요.
            <button type="button" class="ms-auto min-h-11 px-2 text-xs underline-offset-2 hover:underline" onclick={() => (selectedMembershipId = null)}>
              선택 해제
            </button>
          </div>
        {/if}

        {#each roles as role (role.id)}
          {@const alreadyHere = selectedActor && role.assignments.some((a) => a.membership.id === selectedActor.id)}
          <div class="bg-card rounded-2xl px-5 py-4">
            <div class="flex flex-wrap items-center gap-2">
              <p class="font-semibold">{role.name}</p>
              {#if role.sceneRoles.length > 0}
                <span class="text-muted-foreground text-xs">등장 {role.sceneRoles.length}장면</span>
              {/if}
              {#if access.canEditCasting}<div class="ms-auto flex items-center gap-1">
                {#if roles.length > 1}
                  <Button
                    variant="ghost"
                    size="touch"
                    class="text-muted-foreground min-h-11 gap-1 px-2 text-xs"
                    disabled={saving}
                    onclick={() => openMerge(role)}
                  >
                    <GitMergeIcon class="size-3.5" />
                    합치기
                  </Button>
                {/if}
                <Button
                  variant="ghost"
                  size="touch"
                  class="min-h-11 px-2 text-xs text-destructive"
                  disabled={saving}
                  onclick={() => requestRemoveRole(role)}
                >
                  배역 삭제
                </Button>
              </div>{/if}
            </div>
            <div class="mt-2.5 flex flex-wrap items-center gap-1.5">
              {#each role.assignments as assignment (assignment.id)}
                <Badge variant="secondary" class="gap-1 py-1 ps-2.5 pe-1">
                  {assignment.membership.user.name}
                  {#if assignment.kind && assignment.kind !== "MAIN"}
                    <span class="text-muted-foreground text-[10px]">({CAST_ASSIGNMENT_KIND_LABELS[assignment.kind] ?? assignment.kind})</span>
                  {/if}
                  {#if access.canEditCasting}<button type="button" class="hover:bg-background/80 flex size-11 items-center justify-center rounded-full" aria-label={`${assignment.membership.user.name} · ${role.name} 배정 해제`} disabled={saving} onclick={() => unassign(role, assignment)}>
                    <XIcon class="size-3" />
                  </button>{/if}
                </Badge>
              {/each}
              {#if role.assignments.length === 0 && !selectedActor}
                <span class="text-muted-foreground text-xs">아직 배정된 배우가 없어요.</span>
              {/if}
              {#if selectedActor}
                <Button
                  size="touch"
                  variant="outline"
                  class="border-primary/40 text-primary min-h-11 px-2.5 text-xs"
                  disabled={saving || alreadyHere}
                  onclick={() => assignSelectedTo(role)}
                >
                  <PlusIcon class="size-3.5" />
                  {alreadyHere ? "이미 배정됨" : `${selectedActor.user.name} 배정`}
                </Button>
              {/if}
            </div>
          </div>
        {/each}

        {#if access.canEditCasting}<form class="border-border/60 grid gap-2 sm:flex rounded-2xl border border-dashed p-3" onsubmit={addRole}>
          <Input aria-label="새 배역 이름" bind:value={newRoleName} maxlength={60} placeholder="새 배역 이름 (예: 엄마)" class="min-h-11 flex-1" />
          <Button type="submit" size="touch" class="min-h-11" disabled={saving || !newRoleName.trim()}>
            <PlusIcon />
            배역 추가
          </Button>
        </form>{/if}

        {#if roles.length === 0}
          <EmptyState title="아직 배역이 없어요" description={access.canEditCasting ? "새 배역 이름을 입력해 추가해 주세요. 만든 배역은 대본의 화자로도 쓸 수 있어요." : "기획·연출 담당자가 배역을 등록하면 여기에 표시돼요."} />
        {/if}
      </div>
    </div>
  {/if}
</div>

<!-- 배역 합치기 -->
<Dialog.Root open={mergeSource !== null} onOpenChange={(open) => !open && (mergeSource = null)}>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>“{mergeSource?.name}” 배역 합치기</Dialog.Title>
      <Dialog.Description>
        배우 배정·등장 장면·대본 화자·큐 인물을 선택한 배역으로 옮겨요. 합친 뒤 “{mergeSource?.name}” 배역은 사라져요.
      </Dialog.Description>
    </Dialog.Header>
    <div class="grid gap-2">
      <Label for="merge-target">남길 배역</Label>
      <Select.Root type="single" bind:value={mergeTargetId}>
        <Select.Trigger id="merge-target" class="min-h-11 w-full">
          {mergeTargetId ? (roles.find((role) => role.id === mergeTargetId)?.name ?? "배역") : "남길 배역 선택"}
        </Select.Trigger>
        <Select.Content>
          {#each roles.filter((role) => role.id !== mergeSource?.id) as role (role.id)}
            <Select.Item value={role.id} label={role.name} />
          {/each}
        </Select.Content>
      </Select.Root>
    </div>
    <Dialog.Footer class="gap-2">
      <Button type="button" size="touch" variant="ghost" onclick={() => (mergeSource = null)} disabled={merging}>취소</Button>
      <Button type="button" size="touch" disabled={merging || !mergeTargetId} onclick={confirmMerge}>
        {merging ? "합치는 중..." : "합치기"}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
