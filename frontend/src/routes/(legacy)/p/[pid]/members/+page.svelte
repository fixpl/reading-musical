<script lang="ts">
  import { page } from "$app/state";
  import { onMount } from "svelte";
  import { apiRequest } from "$lib/api/client";
  import AppIcon from "$lib/components/AppIcon.svelte";

  type ProfileDetails = Record<string, unknown> | null;

  type Member = {
    id: string;
    primaryRole: string;
    user: {
      id: string;
      email: string;
      name: string;
      phone?: string | null;
      profileType: string;
      profileDetails?: ProfileDetails;
      profileComplete: boolean;
    };
    roles: Array<{ role: string }>;
    staffAssignments: Array<{ discipline: string; customLabel?: string | null; isLead?: boolean; note?: string | null }>;
  };

  type SearchUser = {
    id: string;
    email: string;
    name: string;
    phone?: string | null;
    gender?: string | null;
    birthDate?: string | null;
    age?: number | null;
    address?: string | null;
    profileType: string;
    profileDetails?: ProfileDetails;
    profileComplete: boolean;
    status: string;
    participationCount?: number;
    specialtyText?: string;
  };

  type Dashboard = {
    myRoles: string[];
  };

  type StaffAssignmentPayload = {
    assignments: Array<{ discipline: string; customLabel?: string | null; isLead?: boolean; note?: string | null }>;
  };

  const productionRoles = [
    { value: "PRODUCER", label: "기획자" },
    { value: "DIRECTOR", label: "연출자" },
    { value: "MUSIC_DIRECTOR", label: "음악감독" },
    { value: "STAGE_MANAGER", label: "무대감독" },
    { value: "ACTOR", label: "배우" },
    { value: "STAFF", label: "스태프" },
    { value: "GUEST", label: "게스트" }
  ];

  const staffDisciplines = [
    { value: "SOUND", label: "음향" },
    { value: "LIGHTING", label: "조명" },
    { value: "STAGE_CREW", label: "무대" },
    { value: "PROPS", label: "소품" },
    { value: "COSTUME", label: "의상" },
    { value: "MAKEUP", label: "분장" },
    { value: "VIDEO", label: "영상" },
    { value: "FRONT_OF_HOUSE", label: "객석운영" },
    { value: "PRODUCTION_ASSISTANT", label: "제작보조" },
    { value: "ACCOMPANIST", label: "반주" },
    { value: "OTHER", label: "기타" }
  ];
  const profileTypes = [
    { value: "", label: "직군 전체" },
    { value: "ACTOR", label: "배우" },
    { value: "STAFF", label: "스태프" },
    { value: "DIRECTOR", label: "연출" },
    { value: "MUSIC_DIRECTOR", label: "음악감독" },
    { value: "STAGE_MANAGER", label: "무대감독" },
    { value: "PLANNER", label: "기획" },
    { value: "OTHER", label: "기타" }
  ];
  const genderOptions = [
    { value: "", label: "성별 전체" },
    { value: "UNSPECIFIED", label: "미입력" },
    { value: "FEMALE", label: "여성" },
    { value: "MALE", label: "남성" },
    { value: "OTHER", label: "기타" }
  ];
  const statusOptions = [
    { value: "ACTIVE", label: "활성 회원" },
    { value: "", label: "상태 전체" },
    { value: "INACTIVE", label: "비활성" },
    { value: "BLOCKED", label: "차단" }
  ];
  const profileDetailLabels: Record<string, string> = {
    voiceRange: "음역",
    specialties: "전문분야/특기",
    instruments: "악기/움직임",
    equipment: "장비/툴",
    experienceSummary: "경력 메모",
    planningScope: "기획·운영 범위",
    musicTools: "음악 툴/악기",
    directingNotes: "연출 메모",
    runSheetExperience: "진행표/큐 경험",
    memo: "매칭 메모"
  };

  let members = $state<Member[]>([]);
  let searchResults = $state<SearchUser[]>([]);
  let loading = $state(true);
  let searching = $state(false);
  let searchAttempted = $state(false);
  let saving = $state(false);
  let errorMessage = $state("");
  let noticeMessage = $state("");
  let myRoles = $state<string[]>([]);
  let search = $state("");
  let searchProfileType = $state("");
  let searchGender = $state("");
  let searchStatus = $state("ACTIVE");
  let searchProfileComplete = $state("");
  let searchRegion = $state("");
  let searchSpecialty = $state("");
  let searchMinAge = $state("");
  let searchMaxAge = $state("");
  let searchMinParticipation = $state("");
  let searchMaxParticipation = $state("");
  let searchAvailableStartAt = $state("");
  let searchAvailableEndAt = $state("");
  let selectedUserIds = $state<string[]>([]);
  let selectedRoles = $state<string[]>(["ACTOR"]);
  let selectedPrimaryRole = $state("ACTOR");
  let inviteEmail = $state("");
  let inviteRole = $state("ACTOR");
  let inviteUrl = $state("");
  let selectedStaffMembershipId = $state("");
  let selectedStaffDisciplines = $state<string[]>(["SOUND"]);
  let leadStaffDiscipline = $state("SOUND");
  let staffCustomLabel = $state("");
  let editingMemberId = $state("");
  let editRoles = $state<string[]>([]);
  let editPrimaryRole = $state("");
  let pendingRemoveMemberId = $state("");

  const pid = $derived(page.params.pid ?? "");
  const staffMembers = $derived(members.filter((member) => member.roles.some((role) => role.role === "STAFF")));
  const canManageMembers = $derived(myRoles.includes("PRODUCER"));
  const canManageStaffAssignments = $derived(myRoles.includes("PRODUCER") || myRoles.includes("STAGE_MANAGER"));
  const selectedRoleOptions = $derived(productionRoles.filter((role) => selectedRoles.includes(role.value)));

  onMount(loadMembers);

  async function loadMembers() {
    loading = true;
    errorMessage = "";
    try {
      const [memberList, dashboard] = await Promise.all([
        apiRequest<Member[]>(`/productions/${pid}/members`),
        apiRequest<Dashboard>(`/productions/${pid}/dashboard`)
      ]);
      members = memberList;
      myRoles = dashboard.myRoles ?? [];
      const nextStaffMembers = memberList.filter((member) => member.roles.some((role) => role.role === "STAFF"));
      if (selectedStaffMembershipId && !nextStaffMembers.some((member) => member.id === selectedStaffMembershipId)) {
        selectedStaffMembershipId = "";
      }
      if (!selectedStaffMembershipId && nextStaffMembers[0]) {
        selectedStaffMembershipId = nextStaffMembers[0].id;
      }
      syncStaffAssignmentForm(nextStaffMembers.find((member) => member.id === selectedStaffMembershipId));
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "멤버 목록을 불러오지 못했어요";
    } finally {
      loading = false;
    }
  }

  function startEditMember(member: Member) {
    editingMemberId = member.id;
    editRoles = member.roles.map((role) => role.role);
    editPrimaryRole = member.primaryRole;
    cancelRemoveMember();
    errorMessage = "";
    noticeMessage = "";
  }

  function cancelEditMember() {
    editingMemberId = "";
    editRoles = [];
    editPrimaryRole = "";
  }

  function toggleEditRole(roleValue: string) {
    const nextRoles = editRoles.includes(roleValue) ? editRoles.filter((role) => role !== roleValue) : [...editRoles, roleValue];
    if (nextRoles.length === 0) {
      errorMessage = "역할을 1개 이상 선택해 주세요";
      return;
    }
    errorMessage = "";
    editRoles = nextRoles;
    if (!editRoles.includes(editPrimaryRole)) {
      editPrimaryRole = editRoles[0];
    }
  }

  async function saveMemberRoles(event: SubmitEvent, member: Member) {
    event.preventDefault();
    if (editRoles.length === 0) {
      errorMessage = "역할을 1개 이상 선택해 주세요";
      return;
    }
    await runAction(async () => {
      await apiRequest<Member>(`/productions/${pid}/members/${member.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          roles: editRoles,
          primaryRole: editPrimaryRole || editRoles[0]
        })
      });
      noticeMessage = "멤버 역할을 저장했어요.";
      cancelEditMember();
      await loadMembers();
    });
  }

  async function removeMember(member: Member) {
    await runAction(async () => {
      await apiRequest(`/productions/${pid}/members/${member.id}`, { method: "DELETE" });
      if (selectedStaffMembershipId === member.id) {
        selectedStaffMembershipId = "";
      }
      if (editingMemberId === member.id) {
        cancelEditMember();
      }
      cancelRemoveMember();
      noticeMessage = "멤버를 해제했어요.";
      await loadMembers();
    });
  }

  function startRemoveMember(member: Member) {
    if (editingMemberId === member.id) {
      cancelEditMember();
    }
    pendingRemoveMemberId = member.id;
    errorMessage = "";
    noticeMessage = "";
  }

  function cancelRemoveMember() {
    pendingRemoveMemberId = "";
  }

  async function searchUsers(event: SubmitEvent) {
    event.preventDefault();
    if (search.trim().length > 0 && search.trim().length < 2) {
      errorMessage = "검색어는 2자 이상 입력해 주세요";
      return;
    }
    if (!hasUserSearchCriteria()) {
      errorMessage = "검색어 또는 필터를 1개 이상 입력해 주세요";
      return;
    }
    if ((searchAvailableStartAt && !searchAvailableEndAt) || (!searchAvailableStartAt && searchAvailableEndAt)) {
      errorMessage = "가용성 필터는 시작과 종료를 함께 입력해 주세요";
      return;
    }
    if (searchMinAge && searchMaxAge && Number(searchMinAge) > Number(searchMaxAge)) {
      errorMessage = "최소 나이는 최대 나이보다 클 수 없어요";
      return;
    }
    if (searchMinParticipation && searchMaxParticipation && Number(searchMinParticipation) > Number(searchMaxParticipation)) {
      errorMessage = "최소 참여수는 최대 참여수보다 클 수 없어요";
      return;
    }
    searching = true;
    errorMessage = "";
    try {
      const params = buildUserSearchParams();
      searchResults = await apiRequest<SearchUser[]>(`/users/search?${params.toString()}`);
      searchAttempted = true;
      selectedUserIds = searchResults[0]?.id ? [searchResults[0].id] : [];
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "사용자를 검색하지 못했어요";
    } finally {
      searching = false;
    }
  }

  async function addSelectedUsers(event: SubmitEvent) {
    event.preventDefault();
    if (selectedUserIds.length === 0) {
      errorMessage = "추가할 사용자를 1명 이상 선택해 주세요";
      return;
    }
    if (selectedRoles.length === 0) {
      errorMessage = "부여할 역할을 1개 이상 선택해 주세요";
      return;
    }
    await runAction(async () => {
      await apiRequest<{ count: number }>(`/productions/${pid}/members`, {
        method: "POST",
        body: JSON.stringify({
          userIds: selectedUserIds,
          roles: selectedRoles,
          primaryRole: selectedRoles.includes(selectedPrimaryRole) ? selectedPrimaryRole : selectedRoles[0],
          sendNotification: true
        })
      });
      noticeMessage = `${selectedUserIds.length}명을 멤버로 매칭했어요.`;
      selectedUserIds = [];
      searchResults = [];
      searchAttempted = false;
      search = "";
      await loadMembers();
    });
  }

  function toggleSelectedUser(userId: string) {
    selectedUserIds = selectedUserIds.includes(userId) ? selectedUserIds.filter((id) => id !== userId) : [...selectedUserIds, userId];
  }

  function selectAllSearchResults() {
    selectedUserIds = searchResults.map((user) => user.id);
  }

  function clearSelectedUsers() {
    selectedUserIds = [];
  }

  function toggleSelectedRole(roleValue: string) {
    const nextRoles = selectedRoles.includes(roleValue)
      ? selectedRoles.filter((role) => role !== roleValue)
      : [...selectedRoles, roleValue];
    if (nextRoles.length === 0) {
      errorMessage = "부여할 역할을 1개 이상 선택해 주세요";
      return;
    }
    errorMessage = "";
    selectedRoles = nextRoles;
    if (!selectedRoles.includes(selectedPrimaryRole)) {
      selectedPrimaryRole = selectedRoles[0];
    }
  }

  async function createInvitation(event: SubmitEvent) {
    event.preventDefault();
    await runAction(async () => {
      const invitation = await apiRequest<{ inviteUrl: string }>(`/productions/${pid}/invitations`, {
        method: "POST",
        body: JSON.stringify({ email: inviteEmail, role: inviteRole })
      });
      inviteUrl = invitation.inviteUrl;
      noticeMessage = "초대 링크를 만들었어요.";
      inviteEmail = "";
    });
  }

  async function saveStaffAssignment(event: SubmitEvent) {
    event.preventDefault();
    if (!selectedStaffMembershipId) {
      errorMessage = "스태프 멤버를 선택해 주세요";
      return;
    }
    if (selectedStaffDisciplines.length === 0) {
      errorMessage = "스태프 직무를 1개 이상 선택해 주세요";
      return;
    }
    if (selectedStaffDisciplines.includes("OTHER") && !staffCustomLabel.trim()) {
      errorMessage = "기타 직무명을 입력해 주세요";
      return;
    }
    await runAction(async () => {
      const payload = await apiRequest<StaffAssignmentPayload>(`/productions/${pid}/members/${selectedStaffMembershipId}/staff-assignments`, {
        method: "PUT",
        body: JSON.stringify({
          assignments: selectedStaffDisciplines.map((discipline) => ({
            discipline,
            customLabel: discipline === "OTHER" ? staffCustomLabel.trim() : null,
            isLead: discipline === leadStaffDiscipline
          }))
        })
      });
      noticeMessage = "스태프 직무를 저장했어요.";
      const member = members.find((item) => item.id === selectedStaffMembershipId);
      if (member) {
        member.staffAssignments = payload.assignments;
      }
      await loadMembers();
    });
  }

  function selectStaffMember(membershipId: string) {
    selectedStaffMembershipId = membershipId;
    syncStaffAssignmentForm(staffMembers.find((member) => member.id === selectedStaffMembershipId));
  }

  function toggleStaffDiscipline(discipline: string) {
    const nextDisciplines = selectedStaffDisciplines.includes(discipline)
      ? selectedStaffDisciplines.filter((item) => item !== discipline)
      : [...selectedStaffDisciplines, discipline];
    if (nextDisciplines.length === 0) {
      errorMessage = "스태프 직무를 1개 이상 선택해 주세요";
      return;
    }
    selectedStaffDisciplines = nextDisciplines;
    if (!selectedStaffDisciplines.includes(leadStaffDiscipline)) {
      leadStaffDiscipline = selectedStaffDisciplines[0];
    }
    if (!selectedStaffDisciplines.includes("OTHER")) {
      staffCustomLabel = "";
    }
    errorMessage = "";
  }

  function syncStaffAssignmentForm(member?: Member) {
    const assignments = member?.staffAssignments ?? [];
    selectedStaffDisciplines = assignments.length ? Array.from(new Set(assignments.map((assignment) => assignment.discipline))) : ["SOUND"];
    leadStaffDiscipline =
      assignments.find((assignment) => assignment.isLead || assignment.note === "lead")?.discipline ?? selectedStaffDisciplines[0] ?? "SOUND";
    staffCustomLabel = assignments.find((assignment) => assignment.discipline === "OTHER")?.customLabel ?? "";
  }

  async function runAction(action: () => Promise<void>) {
    saving = true;
    errorMessage = "";
    noticeMessage = "";
    try {
      await action();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "요청을 처리하지 못했어요";
    } finally {
      saving = false;
    }
  }

  async function copyInviteUrl() {
    if (!inviteUrl || typeof navigator === "undefined") return;
    await navigator.clipboard.writeText(inviteUrl);
    noticeMessage = "초대 링크를 복사했어요.";
  }

  function roleLabel(value: string) {
    return productionRoles.find((role) => role.value === value)?.label ?? value;
  }

  function disciplineLabel(value: string) {
    return staffDisciplines.find((discipline) => discipline.value === value)?.label ?? value;
  }

  function profileTypeLabel(value: string) {
    return profileTypes.find((profileType) => profileType.value === value)?.label ?? value;
  }

  function genderLabel(value?: string | null) {
    return genderOptions.find((gender) => gender.value === value)?.label ?? "미입력";
  }

  function statusLabel(value: string) {
    return statusOptions.find((status) => status.value === value)?.label ?? value;
  }

  function profileDetailRows(details?: ProfileDetails) {
    if (!details || Array.isArray(details)) {
      return [];
    }
    return Object.entries(details)
      .map(([key, value]) => ({
        label: profileDetailLabels[key] ?? key,
        value: formatProfileDetailValue(value)
      }))
      .filter((row) => row.value);
  }

  function profileDetailSummary(details?: ProfileDetails) {
    const rows = profileDetailRows(details);
    if (rows.length === 0) {
      return "직군 상세정보 미입력";
    }
    return rows
      .slice(0, 3)
      .map((row) => `${row.label}: ${row.value}`)
      .join(" · ");
  }

  function formatProfileDetailValue(value: unknown): string {
    if (Array.isArray(value)) {
      return value
        .map((item) => formatProfileDetailValue(item))
        .filter(Boolean)
        .join(", ");
    }
    if (typeof value === "string") return value.trim();
    if (typeof value === "number") return String(value);
    if (typeof value === "boolean") return value ? "예" : "아니오";
    if (value && typeof value === "object") return JSON.stringify(value);
    return "";
  }

  function hasUserSearchCriteria() {
    return Boolean(
      search.trim() ||
        searchProfileType ||
        searchGender ||
        searchStatus ||
        searchProfileComplete ||
        searchRegion.trim() ||
        searchSpecialty.trim() ||
        searchMinAge ||
        searchMaxAge ||
        searchMinParticipation ||
        searchMaxParticipation ||
        searchAvailableStartAt ||
        searchAvailableEndAt
    );
  }

  function buildUserSearchParams() {
    const params = new URLSearchParams();
    params.set("productionId", pid);
    params.set("excludeAlreadyMembers", "true");
    params.set("take", "50");
    if (search.trim()) params.set("q", search.trim());
    if (searchProfileType) params.set("profileType", searchProfileType);
    if (searchGender) params.set("gender", searchGender);
    if (searchStatus) params.set("status", searchStatus);
    if (searchProfileComplete) params.set("profileComplete", searchProfileComplete);
    if (searchRegion.trim()) params.set("region", searchRegion.trim());
    if (searchSpecialty.trim()) params.set("specialty", searchSpecialty.trim());
    if (searchMinAge) params.set("minAge", searchMinAge);
    if (searchMaxAge) params.set("maxAge", searchMaxAge);
    if (searchMinParticipation) params.set("minParticipationCount", searchMinParticipation);
    if (searchMaxParticipation) params.set("maxParticipationCount", searchMaxParticipation);
    if (searchAvailableStartAt) params.set("availableStartAt", new Date(searchAvailableStartAt).toISOString());
    if (searchAvailableEndAt) params.set("availableEndAt", new Date(searchAvailableEndAt).toISOString());
    return params;
  }
</script>

<svelte:head>
  <title>멤버 관리 · 아트브릿지</title>
</svelte:head>

<main class="page">
  <div class="container">
    <div class="toolbar">
      <div>
        <p class="badge">SCR-18</p>
        <h1>멤버 관리</h1>
        <p class="muted">기존 사용자를 공연에 매칭하거나 미가입자에게 초대 링크를 보냅니다.</p>
      </div>
      <div class="button-row">
        <a class="button" href={`/p/${pid}/people`}>참여자 프로필</a>
        <a class="button" href={`/p/${pid}`}>대시보드</a>
        <button class="button" type="button" onclick={loadMembers}>새로고침</button>
      </div>
    </div>

    <section class="work-focus-strip" aria-label="멤버 매칭 작업 기준">
      <article class="work-focus-card primary">
        <span class="work-focus-icon"><AppIcon name="user-check" /></span>
        <div>
          <strong>기존 사용자 매칭</strong>
          <p>프로필, 가능 일정, 전문분야를 확인한 뒤 공연 역할을 부여합니다.</p>
        </div>
      </article>
      <article class="work-focus-card info">
        <span class="work-focus-icon"><AppIcon name="users" /></span>
        <div>
          <strong>역할과 대표 역할</strong>
          <p>한 사람이 여러 역할을 가질 수 있고 대표 역할은 화면 표시 기준으로 사용됩니다.</p>
        </div>
      </article>
      <article class="work-focus-card accent">
        <span class="work-focus-icon"><AppIcon name="settings" /></span>
        <div>
          <strong>스태프 직무 지정</strong>
          <p>음향, 조명, 무대, 소품, 영상, 객석운영 등 실제 현장 직무를 지정합니다.</p>
        </div>
      </article>
    </section>

    {#if errorMessage}
      <p class="error">{errorMessage}</p>
    {/if}
    {#if noticeMessage}
      <p class="success">{noticeMessage}</p>
    {/if}

    <section class="members-layout">
      <article class="panel">
        <div class="panel-title">
          <h2>현재 멤버</h2>
          <span class="badge">{members.length}명</span>
        </div>

        {#if loading}
          <p class="muted">멤버 목록을 불러오고 있어요.</p>
        {:else}
          <div class="member-list">
            {#each members as member (member.id)}
              <article class="member-row">
                <div class="member-main">
                  <strong>{member.user.name}</strong>
                  <p>{member.user.email}</p>
                  <small>
                    {profileTypeLabel(member.user.profileType)} · {member.user.profileComplete ? "프로필 완료" : "보완 필요"}
                  </small>
                  <small class="profile-detail-summary">직군 상세정보: {profileDetailSummary(member.user.profileDetails)}</small>
                </div>
                <div class="role-stack">
                  <span class="badge">{roleLabel(member.primaryRole)}</span>
                  <small>{member.roles.map((role) => roleLabel(role.role)).join(", ")}</small>
                  {#if member.staffAssignments.length > 0}
                    <small>
                      {member.staffAssignments
                        .map((assignment) => `${assignment.customLabel ?? disciplineLabel(assignment.discipline)}${assignment.isLead ? " 리드" : ""}`)
                        .join(", ")}
                    </small>
                  {/if}
                  {#if canManageMembers}
                    <div class="member-actions">
                      <button class="button" type="button" onclick={() => startEditMember(member)}>역할 수정</button>
                      <button class="button danger" type="button" onclick={() => startRemoveMember(member)} disabled={saving}>
                        해제
                      </button>
                    </div>
                  {/if}
                </div>
                {#if pendingRemoveMemberId === member.id}
                  <div class="warning-box wide">
                    <strong>{member.user.name} 멤버를 이 공연에서 해제합니다</strong>
                    <p class="muted">해제하면 출석, 배역 배정, 스태프 직무, 체크리스트 담당 연결이 정리되고 감사 로그에 기록됩니다.</p>
                    <div class="button-row">
                      <button class="button danger" type="button" onclick={() => removeMember(member)} disabled={saving}>멤버 해제</button>
                      <button class="button" type="button" onclick={cancelRemoveMember} disabled={saving}>취소</button>
                    </div>
                  </div>
                {/if}
                {#if editingMemberId === member.id}
                  <form class="member-edit-form" onsubmit={(event) => saveMemberRoles(event, member)}>
                    <fieldset class="role-edit-grid">
                      <legend>역할 선택</legend>
                      {#each productionRoles as role (role.value)}
                        <label>
                          <input
                            type="checkbox"
                            checked={editRoles.includes(role.value)}
                            onchange={() => toggleEditRole(role.value)}
                          />
                          <span>{role.label}</span>
                        </label>
                      {/each}
                    </fieldset>
                    <label class="field">
                      <span>대표 역할</span>
                      <select bind:value={editPrimaryRole}>
                        {#each productionRoles.filter((role) => editRoles.includes(role.value)) as role (role.value)}
                          <option value={role.value}>{role.label}</option>
                        {/each}
                      </select>
                    </label>
                    <div class="button-row">
                      <button class="button primary" type="submit" disabled={saving}>역할 저장</button>
                      <button class="button" type="button" onclick={cancelEditMember}>취소</button>
                    </div>
                  </form>
                {/if}
              </article>
            {:else}
              <article class="empty-state">
                <h3>아직 멤버가 없어요</h3>
                <p class="muted">사용자 검색 또는 초대 링크로 첫 멤버를 추가하세요.</p>
              </article>
            {/each}
          </div>
        {/if}
      </article>

      <aside class="stack">
        {#if canManageMembers}
          <form class="panel" onsubmit={searchUsers}>
            <h2>기존 사용자 매칭</h2>
            <label class="field">
              <span>사용자 검색</span>
              <input bind:value={search} placeholder="이름 또는 이메일 2자 이상" />
            </label>
            <div class="inline-grid">
              <label class="field">
                <span>직군</span>
                <select bind:value={searchProfileType}>
                  {#each profileTypes as option (option.value)}
                    <option value={option.value}>{option.label}</option>
                  {/each}
                </select>
              </label>
              <label class="field">
                <span>성별</span>
                <select bind:value={searchGender}>
                  {#each genderOptions as option (option.value)}
                    <option value={option.value}>{option.label}</option>
                  {/each}
                </select>
              </label>
            </div>
            <div class="inline-grid">
              <label class="field">
                <span>회원 상태</span>
                <select bind:value={searchStatus}>
                  {#each statusOptions as option (option.value)}
                    <option value={option.value}>{option.label}</option>
                  {/each}
                </select>
              </label>
              <label class="field">
                <span>프로필 완성</span>
                <select bind:value={searchProfileComplete}>
                  <option value="">전체</option>
                  <option value="true">완료</option>
                  <option value="false">보완 필요</option>
                </select>
              </label>
            </div>
            <div class="inline-grid">
              <label class="field">
                <span>지역</span>
                <input bind:value={searchRegion} placeholder="예: 서울, 대학로" />
              </label>
              <label class="field">
                <span>전문분야</span>
                <input bind:value={searchSpecialty} placeholder="예: 안무, 합창, 음향" />
              </label>
            </div>
            <div class="inline-grid">
              <label class="field">
                <span>최소 나이</span>
                <input type="number" min="0" max="120" bind:value={searchMinAge} />
              </label>
              <label class="field">
                <span>최대 나이</span>
                <input type="number" min="0" max="120" bind:value={searchMaxAge} />
              </label>
            </div>
            <div class="inline-grid">
              <label class="field">
                <span>최소 참여수</span>
                <input type="number" min="0" bind:value={searchMinParticipation} />
              </label>
              <label class="field">
                <span>최대 참여수</span>
                <input type="number" min="0" bind:value={searchMaxParticipation} />
              </label>
            </div>
            <div class="inline-grid">
              <label class="field">
                <span>가용 시작</span>
                <input type="datetime-local" bind:value={searchAvailableStartAt} />
              </label>
              <label class="field">
                <span>가용 종료</span>
                <input type="datetime-local" bind:value={searchAvailableEndAt} />
              </label>
            </div>
            <p class="muted">현재 공연에 이미 매칭된 회원은 기본 제외됩니다.</p>
            <button class="button" type="submit" disabled={searching}>{searching ? "검색 중" : "검색"}</button>
          </form>

          {#if searchResults.length > 0}
            <form class="panel" onsubmit={addSelectedUsers}>
              <div class="panel-title">
                <h2>검색 결과 매칭</h2>
                <span class="badge">{selectedUserIds.length}/{searchResults.length}명 선택</span>
              </div>
              <div class="button-row">
                <button class="button" type="button" onclick={selectAllSearchResults}>전체 선택</button>
                <button class="button" type="button" onclick={clearSelectedUsers}>선택 해제</button>
              </div>
              <div class="member-list compact-list">
                {#each searchResults as user (user.id)}
                  <label class="member-row selectable-row">
                    <input
                      type="checkbox"
                      checked={selectedUserIds.includes(user.id)}
                      onchange={() => toggleSelectedUser(user.id)}
                    />
                    <span class="member-main">
                      <strong>{user.name}</strong>
                      <small>{user.email}</small>
                      <small>
                        {profileTypeLabel(user.profileType)} · {genderLabel(user.gender)} · {user.age == null ? "나이 미입력" : `${user.age}세`} · 참여 {user.participationCount ?? 0}회
                      </small>
                      <small>{user.address ?? "지역 미입력"} · {statusLabel(user.status)}</small>
                      <small class="profile-detail-summary">직군 상세정보: {profileDetailSummary(user.profileDetails)}</small>
                      {#if user.specialtyText}
                        <small class="profile-detail-summary">검색 키워드: {user.specialtyText}</small>
                      {/if}
                    </span>
                    <span class="badge">{user.profileComplete ? "프로필 완료" : "보완 필요"}</span>
                  </label>
                {/each}
              </div>
              <fieldset class="role-edit-grid">
                <legend>부여 역할</legend>
                {#each productionRoles as role (role.value)}
                  <label>
                    <input
                      type="checkbox"
                      checked={selectedRoles.includes(role.value)}
                      onchange={() => toggleSelectedRole(role.value)}
                    />
                    <span>{role.label}</span>
                  </label>
                {/each}
              </fieldset>
              <label class="field">
                <span>대표 역할</span>
                <select bind:value={selectedPrimaryRole}>
                  {#each selectedRoleOptions as role (role.value)}
                    <option value={role.value}>{role.label}</option>
                  {/each}
                </select>
              </label>
              <button class="button primary" type="submit" disabled={saving || selectedUserIds.length === 0}>
                선택 {selectedUserIds.length}명 일괄 매칭
              </button>
            </form>
          {:else if searchAttempted && !searching}
            <article class="panel empty-state">
              <h2>검색 결과 없음</h2>
              <p class="muted">조건에 맞는 등록 사용자가 없어요. 필터를 줄이거나 미가입자 초대를 사용하세요.</p>
            </article>
          {/if}

          <form class="panel" onsubmit={createInvitation}>
            <h2>미가입자 초대</h2>
            <label class="field">
              <span>이메일</span>
              <input type="email" bind:value={inviteEmail} required />
            </label>
            <label class="field">
              <span>역할</span>
              <select bind:value={inviteRole}>
                {#each productionRoles as role (role.value)}
                  <option value={role.value}>{role.label}</option>
                {/each}
              </select>
            </label>
            <button class="button primary" type="submit" disabled={saving}>초대 링크 만들기</button>
            {#if inviteUrl}
              <div class="invite-link-box">
                <strong>초대 링크</strong>
                <p>{inviteUrl}</p>
                <button class="button" type="button" onclick={copyInviteUrl}>복사</button>
              </div>
            {/if}
          </form>
        {:else}
          <article class="panel notice-panel">
            <h2>멤버 변경 권한</h2>
            <p class="muted">기획자만 멤버 매칭, 역할 수정, 공연 해제를 처리할 수 있어요.</p>
          </article>
        {/if}

        {#if canManageStaffAssignments}
          <form class="panel" onsubmit={saveStaffAssignment}>
            <h2>스태프 직무 지정</h2>
            {#if staffMembers.length === 0}
              <p class="muted">STAFF 역할 멤버를 먼저 매칭하세요.</p>
            {:else}
              <label class="field">
                <span>스태프</span>
                <select bind:value={selectedStaffMembershipId} onchange={() => selectStaffMember(selectedStaffMembershipId)}>
                  {#each staffMembers as member (member.id)}
                    <option value={member.id}>{member.user.name} · {member.user.email}</option>
                  {/each}
                </select>
              </label>
              <fieldset class="role-edit-grid">
                <legend>직무 선택</legend>
                {#each staffDisciplines as discipline (discipline.value)}
                  <label>
                    <input
                      type="checkbox"
                      checked={selectedStaffDisciplines.includes(discipline.value)}
                      onchange={() => toggleStaffDiscipline(discipline.value)}
                    />
                    <span>{discipline.label}</span>
                  </label>
                {/each}
              </fieldset>
              <label class="field">
                <span>대표 직무</span>
                <select bind:value={leadStaffDiscipline}>
                  {#each staffDisciplines.filter((discipline) => selectedStaffDisciplines.includes(discipline.value)) as discipline (discipline.value)}
                    <option value={discipline.value}>{discipline.label}</option>
                  {/each}
                </select>
              </label>
              {#if selectedStaffDisciplines.includes("OTHER")}
                <label class="field">
                  <span>기타 직무명</span>
                  <input bind:value={staffCustomLabel} required />
                </label>
              {/if}
              <button class="button primary" type="submit" disabled={saving}>직무 저장</button>
            {/if}
          </form>
        {:else}
          <article class="panel notice-panel">
            <h2>스태프 직무</h2>
            <p class="muted">기획자 또는 무대감독이 스태프 세부 직무를 지정할 수 있어요.</p>
          </article>
        {/if}
      </aside>
    </section>
  </div>
</main>
