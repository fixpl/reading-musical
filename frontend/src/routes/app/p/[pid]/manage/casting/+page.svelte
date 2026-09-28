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

  let roles = $state<Role[]>([]);
  let members = $state<Membership[]>([]);
  let loading = $state(true);
  let forbidden = $state(false);
  let saving = $state(false);
  let newRoleName = $state("");
  let selectedMembershipId = $state<string | null>(null);

  // 비멤버 배우 검색
  let query = $state("");
  let candidates = $state<Candidate[]>([]);
  let searching = $state(false);
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
    const [roleList, memberList] = await Promise.all([
      apiRequest<Role[]>(`/productions/${pid}/roles`),
      apiRequest<Membership[]>(`/productions/${pid}/members`)
    ]);
    roles = roleList;
    members = memberList;
  }

  async function addRole(event: SubmitEvent) {
    event.preventDefault();
    if (!newRoleName.trim()) return;
    saving = true;
    try {
      await apiRequest(`/productions/${pid}/roles`, { method: "POST", body: JSON.stringify({ name: newRoleName.trim() }) });
      newRoleName = "";
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "배역을 추가하지 못했습니다");
    } finally {
      saving = false;
    }
  }

  let confirmingRoleId = $state<string | null>(null);
  let confirmTimer: ReturnType<typeof setTimeout> | undefined;

  function requestRemoveRole(role: Role) {
    if (confirmingRoleId === role.id) {
      confirmingRoleId = null;
      clearTimeout(confirmTimer);
      void removeRole(role);
      return;
    }
    confirmingRoleId = role.id;
    clearTimeout(confirmTimer);
    confirmTimer = setTimeout(() => (confirmingRoleId = null), 3000);
  }

  async function removeRole(role: Role) {
    saving = true;
    try {
      await apiRequest(`/productions/${pid}/roles/${role.id}`, { method: "DELETE" });
      toast.success(`${role.name} 배역을 삭제했습니다`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "삭제하지 못했습니다");
    } finally {
      saving = false;
    }
  }

  function openMerge(role: Role) {
    mergeSource = role;
    mergeTargetId = "";
  }

  async function confirmMerge() {
    if (!mergeSource || !mergeTargetId) return;
    merging = true;
    try {
      const target = roles.find((role) => role.id === mergeTargetId);
      await apiRequest(`/productions/${pid}/roles/${mergeSource.id}/merge`, {
        method: "POST",
        body: JSON.stringify({ targetRoleId: mergeTargetId })
      });
      toast.success(`${mergeSource.name} → ${target?.name ?? "대상"} 배역으로 합쳤습니다`);
      mergeSource = null;
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "합치지 못했습니다");
    } finally {
      merging = false;
    }
  }

  async function assignSelectedTo(role: Role) {
    if (!selectedMembershipId) return;
    if (role.assignments.some((a) => a.membership.id === selectedMembershipId)) {
      toast.info("이미 이 배역에 배정된 배우입니다");
      return;
    }
    saving = true;
    try {
      await apiRequest(`/productions/${pid}/roles/${role.id}/assignments`, {
        method: "POST",
        body: JSON.stringify({ membershipId: selectedMembershipId })
      });
      selectedMembershipId = null;
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "배정하지 못했습니다");
    } finally {
      saving = false;
    }
  }

  async function unassign(role: Role, assignment: Assignment) {
    saving = true;
    try {
      await apiRequest(`/productions/${pid}/roles/${role.id}/assignments/${assignment.id}`, { method: "DELETE" });
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "해제하지 못했습니다");
    } finally {
      saving = false;
    }
  }

  function onQueryInput() {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(searchCandidates, 350);
  }

  async function searchCandidates() {
    const q = query.trim();
    if (q.length < 2) {
      candidates = [];
      return;
    }
    searching = true;
    try {
      const params = new URLSearchParams({ productionId: pid, q, profileType: "ACTOR", take: "8" });
      const result = await apiRequest<{ users: Candidate[] } | Candidate[]>(`/users/search?${params.toString()}`);
      const list = Array.isArray(result) ? result : (result.users ?? []);
      const memberIds = new Set(members.map((m) => m.user.id));
      candidates = list.filter((c) => !memberIds.has(c.id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "검색하지 못했습니다");
    } finally {
      searching = false;
    }
  }

  // 비멤버 배우를 배우 멤버로 추가 → 풀에 합류
  async function addAsActor(candidate: Candidate) {
    saving = true;
    try {
      await apiRequest(`/productions/${pid}/members`, {
        method: "POST",
        body: JSON.stringify({ userIds: [candidate.id], roles: ["ACTOR"], primaryRole: "ACTOR" })
      });
      toast.success(`${candidate.name}님을 배우로 추가했습니다. 배역을 눌러 배정하세요.`);
      query = "";
      candidates = [];
      await load();
      const added = members.find((m) => m.user.id === candidate.id);
      if (added) selectedMembershipId = added.id;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "추가하지 못했습니다");
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
        await load();
      } catch (error) {
        if (error instanceof ApiError && error.status === 403) {
          forbidden = true;
        } else {
          toast.error(error instanceof Error ? error.message : "캐스팅 정보를 불러오지 못했습니다");
        }
      } finally {
        loading = false;
      }
    })();
  });
</script>

<svelte:head>
  <title>캐스팅 — 아트브릿지</title>
</svelte:head>

<div class="mx-auto w-full max-w-5xl">
  <div class="py-2">
    <h1 class="text-xl font-bold tracking-tight">캐스팅</h1>
    <p class="text-muted-foreground text-sm">배우를 고른 뒤 배역을 눌러 배정합니다. 한 배역에 여러 명도 됩니다. 배역은 대본의 화자로도 쓰입니다.</p>
  </div>

  {#if forbidden}
    <section class="bg-card mt-2 rounded-2xl border p-8 text-center" role="alert">
      <h2 class="font-semibold">이 화면을 관리할 권한이 없어요</h2>
      <p class="text-muted-foreground mt-2 text-sm">캐스팅은 제작진만 편집할 수 있습니다.</p>
    </section>
  {:else if !loading && looksDuplicated}
    <div class="border-border/60 bg-muted/40 text-muted-foreground mt-1 flex items-start gap-2 rounded-xl border px-4 py-2.5 text-sm">
      <GitMergeIcon class="text-foreground mt-0.5 size-4 shrink-0" />
      <span>같은 인물이 여러 배역으로 나뉘어 있을 수 있어요. 배역 카드의 <b class="text-foreground">합치기</b>로 하나로 모으면 배정·대본·큐가 함께 옮겨집니다.</span>
    </div>
  {/if}

  {#if loading}
    <Skeleton class="mt-2 h-[460px] w-full rounded-2xl" />
  {:else if !forbidden}
    <div class="mt-2 grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <!-- 배우 풀 -->
      <div class="bg-card h-fit rounded-2xl p-4">
        <p class="font-semibold">배역 없는 배우 <span class="text-muted-foreground/70 text-sm">{poolActors.length}</span></p>
        <p class="text-muted-foreground mt-0.5 text-xs">배우를 누르면 선택돼요. 오른쪽 배역을 눌러 배정하세요.</p>

        <div class="mt-3 grid gap-1.5">
          {#each poolActors as member (member.id)}
            {@const picked = selectedMembershipId === member.id}
            <button
              type="button"
              class="flex items-center gap-2.5 rounded-xl border px-3 py-2 text-start transition-colors
                {picked ? 'border-primary bg-primary/10' : 'border-border/60 hover:bg-accent/60'}"
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
            <p class="text-muted-foreground px-1 py-3 text-sm">배역 없는 배우가 없습니다.</p>
          {/if}
        </div>

        <!-- 비멤버 배우 찾아 추가 -->
        <div class="mt-4 border-t pt-3">
          <p class="text-muted-foreground mb-2 text-xs font-semibold">공연에 없는 배우 추가</p>
          <div class="relative">
            <SearchIcon class="text-muted-foreground absolute start-2.5 top-2.5 size-4" />
            <Input bind:value={query} oninput={onQueryInput} placeholder="이름·이메일 (2자 이상)" class="ps-8" autocomplete="off" />
          </div>
          {#if searching}
            <Skeleton class="mt-2 h-10 w-full rounded-xl" />
          {:else if candidates.length > 0}
            <div class="mt-2 grid gap-1.5">
              {#each candidates as candidate (candidate.id)}
                <div class="border-border/60 flex items-center gap-2 rounded-xl border px-3 py-2">
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-sm font-medium">{candidate.name}</span>
                    <span class="text-muted-foreground block truncate text-xs">{candidate.email}</span>
                  </span>
                  <Button size="sm" variant="outline" class="h-7 shrink-0 px-2 text-xs" disabled={saving} onclick={() => addAsActor(candidate)}>
                    <UserPlusIcon class="size-3.5" />
                    추가
                  </Button>
                </div>
              {/each}
            </div>
          {:else if query.trim().length >= 2}
            <p class="text-muted-foreground mt-2 text-xs">검색 결과가 없습니다.</p>
          {/if}
        </div>
      </div>

      <!-- 배역 보드 -->
      <div class="grid gap-2">
        {#if selectedActor}
          <div class="border-primary/30 bg-primary/5 text-primary flex items-center gap-2 rounded-xl border px-4 py-2 text-sm">
            <span class="font-semibold">{selectedActor.user.name}</span> 선택됨 — 배정할 배역을 누르세요.
            <button type="button" class="ms-auto text-xs underline-offset-2 hover:underline" onclick={() => (selectedMembershipId = null)}>
              선택 해제
            </button>
          </div>
        {/if}

        {#each roles as role (role.id)}
          {@const alreadyHere = selectedActor && role.assignments.some((a) => a.membership.id === selectedActor.id)}
          <div class="bg-card rounded-2xl px-5 py-4">
            <div class="flex items-center gap-2">
              <p class="font-semibold">{role.name}</p>
              {#if role.sceneRoles.length > 0}
                <span class="text-muted-foreground text-xs">등장 {role.sceneRoles.length}장면</span>
              {/if}
              <div class="ms-auto flex items-center gap-1">
                {#if roles.length > 1}
                  <Button
                    variant="ghost"
                    size="sm"
                    class="text-muted-foreground h-7 gap-1 px-2 text-xs"
                    disabled={saving}
                    onclick={() => openMerge(role)}
                  >
                    <GitMergeIcon class="size-3.5" />
                    합치기
                  </Button>
                {/if}
                <Button
                  variant="ghost"
                  size="sm"
                  class={`h-7 px-2 text-xs ${confirmingRoleId === role.id ? "text-destructive font-semibold" : "text-muted-foreground"}`}
                  disabled={saving}
                  onclick={() => requestRemoveRole(role)}
                >
                  {confirmingRoleId === role.id ? "한 번 더 누르면 삭제돼요" : "배역 삭제"}
                </Button>
              </div>
            </div>
            <div class="mt-2.5 flex flex-wrap items-center gap-1.5">
              {#each role.assignments as assignment (assignment.id)}
                <Badge variant="secondary" class="gap-1 py-1 ps-2.5 pe-1">
                  {assignment.membership.user.name}
                  {#if assignment.kind && assignment.kind !== "MAIN"}
                    <span class="text-muted-foreground text-[10px]">({CAST_ASSIGNMENT_KIND_LABELS[assignment.kind] ?? assignment.kind})</span>
                  {/if}
                  <button type="button" class="hover:bg-background/80 rounded-full p-0.5" aria-label="배정 해제" onclick={() => unassign(role, assignment)}>
                    <XIcon class="size-3" />
                  </button>
                </Badge>
              {/each}
              {#if role.assignments.length === 0 && !selectedActor}
                <span class="text-muted-foreground text-xs">아직 배정된 배우가 없습니다.</span>
              {/if}
              {#if selectedActor}
                <Button
                  size="sm"
                  variant="outline"
                  class="border-primary/40 text-primary h-7 px-2.5 text-xs"
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

        <form class="border-border/60 flex gap-2 rounded-2xl border border-dashed p-3" onsubmit={addRole}>
          <Input bind:value={newRoleName} maxlength={60} placeholder="새 배역 이름 (예: 엄마)" class="flex-1" />
          <Button type="submit" size="sm" class="h-9" disabled={saving || !newRoleName.trim()}>
            <PlusIcon />
            배역 추가
          </Button>
        </form>

        {#if roles.length === 0}
          <p class="text-muted-foreground px-2 text-sm">
            아직 배역이 없습니다. 배역을 만들면 배우를 배정하고 대본 편집에서 화자로 선택할 수 있습니다.
          </p>
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
        이 배역을 다른 배역으로 합칩니다. 배우 배정·장면 매핑·대본 화자·큐 인물이 모두 남는 배역으로 옮겨지고, “{mergeSource?.name}”은 사라집니다.
      </Dialog.Description>
    </Dialog.Header>
    <div class="grid gap-2">
      <Label>어느 배역으로 합칠까요?</Label>
      <Select.Root type="single" bind:value={mergeTargetId}>
        <Select.Trigger class="w-full">
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
      <Button type="button" variant="ghost" onclick={() => (mergeSource = null)} disabled={merging}>취소</Button>
      <Button type="button" disabled={merging || !mergeTargetId} onclick={confirmMerge}>
        {merging ? "합치는 중..." : "합치기"}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
