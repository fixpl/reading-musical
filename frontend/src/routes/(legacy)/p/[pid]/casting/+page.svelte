<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { ApiError, apiRequest } from "$lib/api/client";
  import AppIcon from "$lib/components/AppIcon.svelte";

  type CastAssignmentKind = "MAIN" | "DOUBLE" | "UNDERSTUDY";
  type UserSummary = { id: string; email: string; name: string; profileType: string; profileComplete: boolean };
  type ActorMembership = { id: string; user: UserSummary };
  type Assignment = {
    id: string;
    kind: CastAssignmentKind;
    membershipId: string;
    membership: ActorMembership;
  };
  type RoleSummary = {
    id: string;
    name: string;
    description?: string | null;
    assignments: Assignment[];
    sceneCount: number;
    lineCount: number;
    songCount: number;
    hasActor: boolean;
  };
  type SceneCasting = {
    id: string;
    title: string;
    order: number;
    act: { id: string; title: string; order: number; script: { id: string; title: string } };
    confirmedRoleIds: string[];
    suggestedRoleIds: string[];
    missingSuggestedRoleIds: string[];
    sceneRoles: Array<{ id: string; roleId: string; roleName: string; lineCount: number; songCount: number }>;
  };
  type Workload = {
    roles: RoleSummary[];
    actorMemberships: ActorMembership[];
    scenes: SceneCasting[];
    totals: { roles: number; actorMemberships: number; unassignedRoles: number; scenesWithMissingSuggestions: number };
  };
  type Dashboard = { production: { title: string }; myRoles: string[] };

  const productionId = $derived(page.params.pid);
  const assignmentKinds: Array<{ value: CastAssignmentKind; label: string }> = [
    { value: "MAIN", label: "주연/본배역" },
    { value: "DOUBLE", label: "더블" },
    { value: "UNDERSTUDY", label: "언더스터디" }
  ];

  let productionTitle = $state("");
  let roles = $state<string[]>([]);
  let workload = $state<Workload | null>(null);
  let loading = $state(true);
  let saving = $state(false);
  let errorMessage = $state("");
  let noticeMessage = $state("");

  let newRoleName = $state("");
  let newRoleDescription = $state("");
  let editingRoleId = $state("");
  let editRoleName = $state("");
  let editRoleDescription = $state("");
  let pendingDeleteRoleId = $state("");
  let pendingDeleteMessage = $state("");

  let assignRoleId = $state("");
  let assignMembershipId = $state("");
  let assignmentKind = $state<CastAssignmentKind>("MAIN");
  let sceneSelections = $state<Record<string, string[]>>({});

  const canEdit = $derived(roles.length === 0 || roles.includes("PRODUCER") || roles.includes("DIRECTOR"));
  const maxLineCount = $derived(Math.max(1, ...(workload?.roles.map((role) => role.lineCount + role.songCount) ?? [1])));

  onMount(() => {
    void loadInitial();
  });

  async function loadInitial() {
    loading = true;
    errorMessage = "";
    try {
      const dashboard = await apiRequest<Dashboard>(`/productions/${productionId}/dashboard`);
      productionTitle = dashboard.production.title;
      roles = dashboard.myRoles;
      await loadWorkload();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "캐스팅 화면을 불러오지 못했어요";
    } finally {
      loading = false;
    }
  }

  async function loadWorkload() {
    workload = await apiRequest<Workload>(`/productions/${productionId}/casting/workload`);
    sceneSelections = Object.fromEntries(workload.scenes.map((scene) => [scene.id, [...scene.confirmedRoleIds]]));
    if (!assignRoleId && workload.roles[0]) assignRoleId = workload.roles[0].id;
    if (!assignMembershipId && workload.actorMemberships[0]) assignMembershipId = workload.actorMemberships[0].id;
  }

  async function createRole(event: SubmitEvent) {
    event.preventDefault();
    if (!newRoleName.trim()) return;
    await mutate(async () => {
      await apiRequest(`/productions/${productionId}/roles`, {
        method: "POST",
        body: JSON.stringify({ name: newRoleName, description: newRoleDescription || null })
      });
      newRoleName = "";
      newRoleDescription = "";
      noticeMessage = "배역을 만들었어요.";
      await loadWorkload();
    });
  }

  function startEditRole(role: RoleSummary) {
    editingRoleId = role.id;
    editRoleName = role.name;
    editRoleDescription = role.description ?? "";
  }

  async function saveRole(roleId: string) {
    if (!editRoleName.trim()) return;
    await mutate(async () => {
      await apiRequest(`/productions/${productionId}/roles/${roleId}`, {
        method: "PATCH",
        body: JSON.stringify({ name: editRoleName, description: editRoleDescription || null })
      });
      editingRoleId = "";
      noticeMessage = "배역 정보를 저장했어요.";
      await loadWorkload();
    });
  }

  async function deleteRole(roleId: string, force = false) {
    await mutate(async () => {
      try {
        await apiRequest(`/productions/${productionId}/roles/${roleId}${force ? "?force=true" : ""}`, { method: "DELETE" });
        pendingDeleteRoleId = "";
        pendingDeleteMessage = "";
        noticeMessage = "배역을 삭제했어요.";
        await loadWorkload();
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          pendingDeleteRoleId = roleId;
          pendingDeleteMessage = error.message;
          return;
        }
        throw error;
      }
    });
  }

  async function assignActor(event: SubmitEvent) {
    event.preventDefault();
    if (!assignRoleId || !assignMembershipId) return;
    await mutate(async () => {
      await apiRequest(`/productions/${productionId}/roles/${assignRoleId}/assignments`, {
        method: "POST",
        body: JSON.stringify({ membershipId: assignMembershipId, kind: assignmentKind })
      });
      noticeMessage = "배우를 배역에 배정했어요.";
      await loadWorkload();
    });
  }

  async function deleteAssignment(roleId: string, assignmentId: string) {
    await mutate(async () => {
      await apiRequest(`/productions/${productionId}/roles/${roleId}/assignments/${assignmentId}`, { method: "DELETE" });
      noticeMessage = "배우 배정을 해제했어요.";
      await loadWorkload();
    });
  }

  function toggleSceneRole(sceneId: string, roleId: string, checked: boolean) {
    const current = sceneSelections[sceneId] ?? [];
    const next = checked ? [...new Set([...current, roleId])] : current.filter((id) => id !== roleId);
    sceneSelections = { ...sceneSelections, [sceneId]: next };
  }

  async function saveSceneRoles(sceneId: string) {
    await mutate(async () => {
      await apiRequest(`/productions/${productionId}/scenes/${sceneId}/roles`, {
        method: "PUT",
        body: JSON.stringify({ roleIds: sceneSelections[sceneId] ?? [], syncMatchingBlocks: true })
      });
      noticeMessage = "장면 배역을 확정했어요.";
      await loadWorkload();
    });
  }

  function isSceneRoleSelected(sceneId: string, roleId: string) {
    return (sceneSelections[sceneId] ?? []).includes(roleId);
  }

  function actorLabel(membership: ActorMembership) {
    return `${membership.user.name} (${membership.user.email})`;
  }

  function assignmentKindLabel(value: CastAssignmentKind) {
    return assignmentKinds.find((kind) => kind.value === value)?.label ?? value;
  }

  async function mutate(work: () => Promise<void>) {
    saving = true;
    errorMessage = "";
    noticeMessage = "";
    try {
      await work();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "저장하지 못했어요";
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head>
  <title>{productionTitle || "캐스팅"} · 아트브릿지</title>
</svelte:head>

<main class="page">
  <div class="container">
    <div class="toolbar">
      <div>
        <p class="badge">SCR-13 캐스팅</p>
        <h1>{productionTitle || "캐스팅"}</h1>
        <p class="muted">배역, 배우 배정, 장면별 등장 배역, 블록 기반 분량을 관리합니다.</p>
      </div>
      <div class="button-row">
        <a class="button" href={`/p/${productionId}`}>대시보드</a>
        <a class="button" href={`/p/${productionId}/script`}>대본 편집</a>
      </div>
    </div>

    <section class="work-focus-strip" aria-label="캐스팅 작업 기준">
      <article class="work-focus-card primary">
        <span class="work-focus-icon"><AppIcon name="users" /></span>
        <div>
          <strong>배역 정의</strong>
          <p>배역명, 설명, 대사·가사 분량을 기준으로 배우 배정 전 상태를 정리합니다.</p>
        </div>
      </article>
      <article class="work-focus-card cue">
        <span class="work-focus-icon"><AppIcon name="user-check" /></span>
        <div>
          <strong>배우 배정</strong>
          <p>본배역, 더블, 언더스터디를 구분해 배우가 본인 역할을 정확히 확인하게 합니다.</p>
        </div>
      </article>
      <article class="work-focus-card info">
        <span class="work-focus-icon"><AppIcon name="book-open" /></span>
        <div>
          <strong>장면 등장 확정</strong>
          <p>장면별 등장 배역을 확정하면 대본 블록 연결과 참여자 화면이 함께 정리됩니다.</p>
        </div>
      </article>
    </section>

    {#if loading}
      <article class="card">캐스팅 정보를 불러오고 있어요.</article>
    {:else if errorMessage && !workload}
      <article class="card">
        <h2>캐스팅을 불러오지 못했어요</h2>
        <p class="error">{errorMessage}</p>
      </article>
    {:else if workload}
      {#if noticeMessage}
        <p class="success">{noticeMessage}</p>
      {/if}
      {#if errorMessage}
        <p class="error">{errorMessage}</p>
      {/if}

      <section class="grid three" aria-label="캐스팅 요약">
        <article class="card">
          <h2>배역</h2>
          <p>{workload.totals.roles}개</p>
        </article>
        <article class="card">
          <h2>배우 후보</h2>
          <p>{workload.totals.actorMemberships}명</p>
        </article>
        <article class="card">
          <h2>확인 필요</h2>
          <p>{workload.totals.unassignedRoles}개 배역 · {workload.totals.scenesWithMissingSuggestions}개 장면</p>
        </article>
      </section>

      <div class="casting-grid">
        <aside class="panel">
          <h2>배역 만들기</h2>
          {#if canEdit}
            <form class="stack" onsubmit={createRole}>
              <div class="field">
                <label for="newRoleName">배역명</label>
                <input id="newRoleName" bind:value={newRoleName} placeholder="예: 민준" required />
              </div>
              <div class="field">
                <label for="newRoleDescription">설명</label>
                <textarea id="newRoleDescription" rows="4" bind:value={newRoleDescription} placeholder="성격, 음역, 특이사항"></textarea>
              </div>
              <button class="button primary" type="submit" disabled={saving || !newRoleName.trim()}>배역 추가</button>
            </form>
          {:else}
            <p class="muted">편집 권한이 없어 읽기 전용으로 표시됩니다.</p>
          {/if}

          <form class="stack compact" onsubmit={assignActor}>
            <h3>배우 배정</h3>
            {#if workload.roles.length === 0}
              <p class="muted">먼저 배역을 만들어 주세요.</p>
            {:else if workload.actorMemberships.length === 0}
              <p class="muted">ACTOR 역할을 가진 공연 멤버가 없어요. 멤버 관리에서 배우를 매칭해야 합니다.</p>
            {:else}
              <div class="field">
                <label for="assignRole">배역</label>
                <select id="assignRole" bind:value={assignRoleId} disabled={!canEdit}>
                  {#each workload.roles as role (role.id)}
                    <option value={role.id}>{role.name}</option>
                  {/each}
                </select>
              </div>
              <div class="field">
                <label for="assignActor">배우</label>
                <select id="assignActor" bind:value={assignMembershipId} disabled={!canEdit}>
                  {#each workload.actorMemberships as membership (membership.id)}
                    <option value={membership.id}>{actorLabel(membership)}</option>
                  {/each}
                </select>
              </div>
              <div class="field">
                <label for="assignmentKind">구분</label>
                <select id="assignmentKind" bind:value={assignmentKind} disabled={!canEdit}>
                  {#each assignmentKinds as kind (kind.value)}
                    <option value={kind.value}>{kind.label}</option>
                  {/each}
                </select>
              </div>
              {#if canEdit}
                <button class="button primary" type="submit" disabled={saving || !assignRoleId || !assignMembershipId}>배정 저장</button>
              {/if}
            {/if}
          </form>
        </aside>

        <section class="panel">
          <div class="panel-title">
            <div>
              <h2>배역과 분량</h2>
              <p class="muted">대사/가사 수는 대본 블록의 배역 연결에서 계산됩니다.</p>
            </div>
          </div>

          {#if workload.roles.length === 0}
            <article class="empty-state">
              <h3>아직 배역이 없어요.</h3>
              <p class="muted">연출자가 배역을 등록하면 배우 배정과 장면 매핑을 시작할 수 있어요.</p>
            </article>
          {:else}
            <div class="role-list">
              {#each workload.roles as role (role.id)}
                <article class="role-card">
                  {#if editingRoleId === role.id}
                    <div class="field">
                      <label for={`roleName-${role.id}`}>배역명</label>
                      <input id={`roleName-${role.id}`} bind:value={editRoleName} />
                    </div>
                    <div class="field">
                      <label for={`roleDescription-${role.id}`}>설명</label>
                      <textarea id={`roleDescription-${role.id}`} rows="3" bind:value={editRoleDescription}></textarea>
                    </div>
                    <div class="button-row">
                      <button class="button primary" type="button" disabled={saving || !editRoleName.trim()} onclick={() => void saveRole(role.id)}>저장</button>
                      <button class="button" type="button" onclick={() => (editingRoleId = "")}>취소</button>
                    </div>
                  {:else}
                    <div class="role-card-head">
                      <div>
                        <h3>{role.name}</h3>
                        <p class="muted">{role.description || "설명 없음"}</p>
                      </div>
                      <span class="badge">{role.hasActor ? "배정됨" : "미배정"}</span>
                    </div>

                    <div class="workload-bar" aria-label={`${role.name} 분량`}>
                      <span style={`width: ${Math.max(4, ((role.lineCount + role.songCount) / maxLineCount) * 100)}%`}></span>
                    </div>
                    <p class="muted">대사 {role.lineCount} · 가사 {role.songCount} · 장면 {role.sceneCount}</p>

                    <div class="assignment-list">
                      {#each role.assignments as assignment (assignment.id)}
                        <p>
                          <span class="badge">{assignmentKindLabel(assignment.kind)}</span>
                          {assignment.membership.user.name}
                          {#if canEdit}
                            <button class="text-button" type="button" onclick={() => void deleteAssignment(role.id, assignment.id)}>해제</button>
                          {/if}
                        </p>
                      {:else}
                        <p class="muted">배정된 배우가 없어요.</p>
                      {/each}
                    </div>

                    {#if canEdit}
                      <div class="button-row">
                        <button class="button" type="button" onclick={() => startEditRole(role)}>수정</button>
                        <button class="button danger" type="button" onclick={() => void deleteRole(role.id)}>삭제</button>
                      </div>
                      {#if pendingDeleteRoleId === role.id}
                        <div class="warning-box">
                          <p>{pendingDeleteMessage}</p>
                          <button class="button danger" type="button" onclick={() => void deleteRole(role.id, true)}>영향 확인 후 삭제</button>
                        </div>
                      {/if}
                    {/if}
                  {/if}
                </article>
              {/each}
            </div>
          {/if}
        </section>
      </div>

      <section class="panel scene-matrix">
        <div class="panel-title">
          <div>
            <h2>장면별 등장 배역</h2>
            <p class="muted">대본 화자 라벨과 배역명이 같으면 저장 시 블록 배역 연결을 자동 보정합니다.</p>
          </div>
        </div>

        {#if workload.scenes.length === 0}
          <article class="empty-state">
            <h3>장면이 없어요.</h3>
            <p class="muted">대본 에디터에서 막과 장을 먼저 만들면 캐스팅 매트릭스가 표시됩니다.</p>
          </article>
        {:else if workload.roles.length === 0}
          <article class="empty-state">
            <h3>매핑할 배역이 없어요.</h3>
            <p class="muted">배역을 만든 뒤 장면별 등장 여부를 확정하세요.</p>
          </article>
        {:else}
          <div class="matrix-list">
            {#each workload.scenes as scene (scene.id)}
              <article class="matrix-row">
                <div>
                  <h3>{scene.act.title} · {scene.title}</h3>
                  <p class="muted">
                    확정 {scene.confirmedRoleIds.length}개
                    {#if scene.missingSuggestedRoleIds.length}
                      · 제안 미확정 {scene.missingSuggestedRoleIds.length}개
                    {/if}
                  </p>
                  {#if scene.sceneRoles.length}
                    <div class="button-row">
                      {#each scene.sceneRoles as sceneRole (sceneRole.id)}
                        <span class="badge">{sceneRole.roleName} 대사 {sceneRole.lineCount} 가사 {sceneRole.songCount}</span>
                      {/each}
                    </div>
                  {/if}
                </div>
                <div class="role-checkboxes">
                  {#each workload.roles as role (role.id)}
                    <label class:suggested={scene.suggestedRoleIds.includes(role.id)}>
                      <input
                        type="checkbox"
                        checked={isSceneRoleSelected(scene.id, role.id)}
                        disabled={!canEdit}
                        onchange={(event) => toggleSceneRole(scene.id, role.id, event.currentTarget.checked)}
                      />
                      {role.name}
                    </label>
                  {/each}
                </div>
                {#if canEdit}
                  <button class="button primary" type="button" disabled={saving} onclick={() => void saveSceneRoles(scene.id)}>장면 배역 저장</button>
                {/if}
              </article>
            {/each}
          </div>
        {/if}
      </section>
    {/if}
  </div>
</main>
