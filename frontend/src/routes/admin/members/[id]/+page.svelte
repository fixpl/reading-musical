<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/stores";
  import { toast } from "svelte-sonner";
  import * as Card from "$lib/components/ui/card";
  import * as Dialog from "$lib/components/ui/dialog";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import { Textarea } from "$lib/components/ui/textarea";
  import ConfirmAction from "$lib/components/admin/ConfirmAction.svelte";
  import { EmptyState } from "$lib/components/ui/empty-state";
  import { apiRequest } from "$lib/api/client";
  import {
    EVENT_TYPE_LABELS,
    GENDER_LABELS,
    PHASE_LABELS,
    PRODUCTION_ROLE_LABELS,
    PROFILE_TYPE_LABELS,
    USER_STATUS_LABELS,
    VISIBILITY_LABELS,
    formatDate,
    formatDateTime
  } from "$lib/domain/labels";
  import ChevronLeftIcon from "@lucide/svelte/icons/chevron-left";
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import KeyRoundIcon from "@lucide/svelte/icons/key-round";
  import CopyIcon from "@lucide/svelte/icons/copy";

  type Overview = {
    user: {
      id: string;
      email: string;
      name: string;
      phone: string | null;
      birthDate: string | null;
      address: string | null;
      gender: string | null;
      profileType: string;
      profileComplete: boolean;
      profileDetails: Record<string, unknown> | null;
      status: string;
      platformRole: string;
      createdAt: string;
    };
    memberships: Array<{
      id: string;
      primaryRole: string;
      roles: Array<{ role: string }>;
      production: { id: string; title: string; currentPhase: string; visibility: string };
    }>;
    availabilities: Array<{
      id: string;
      title: string | null;
      startAt: string;
      endAt: string;
      isAvailable: boolean;
      reason: string | null;
    }>;
    upcomingEvents: Array<{
      id: string;
      title: string;
      type: string;
      startAt: string;
      endAt: string;
      location: string | null;
      production: { id: string; title: string };
      myStatus: string | null;
      myAttendanceId: string | null;
    }>;
  };

  const ATTENDANCE_LABELS: Record<string, string> = {
    ACCEPTED: "참석",
    DECLINED: "불참",
    INVITED: "미응답",
    TENTATIVE: "미정"
  };

  const memberId = $derived($page.params.id ?? "");

  let overview = $state<Overview | null>(null);
  let loading = $state(true);
  let loadError = $state("");
  let confirmation: { ask: (message: string, heading?: string, label?: string) => Promise<boolean> };

  let statusOpen = $state(false);
  let statusReason = $state("");
  let statusSaving = $state(false);

  // 개인 일정 등록 (운영자 대리)
  let blockOpen = $state(false);
  let blockTitle = $state("");
  let blockDate = $state("");
  let blockStart = $state("09:00");
  let blockEnd = $state("18:00");
  let blockReason = $state("");
  let blockSaving = $state(false);

  async function setAttendance(attendanceId: string | null, status: string) {
    if (!attendanceId) return;
    try {
      await apiRequest(`/admin/attendances/${attendanceId}`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      toast.success("출석 상태를 변경했어요. 운영자 변경으로 기록해요.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "변경하지 못했어요");
    }
  }

  async function addBlock(event: SubmitEvent) {
    event.preventDefault();
    if (!blockDate) return;
    blockSaving = true;
    try {
      await apiRequest(`/admin/users/${memberId}/availabilities`, {
        method: "POST",
        body: JSON.stringify({
          title: blockTitle.trim() || "운영자 등록 일정",
          startAt: new Date(`${blockDate}T${blockStart}:00`).toISOString(),
          endAt: new Date(`${blockDate}T${blockEnd}:00`).toISOString(),
          reason: blockReason.trim() || undefined
        })
      });
      toast.success("개인 일정을 등록했어요");
      blockOpen = false;
      blockTitle = "";
      blockDate = "";
      blockReason = "";
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "등록하지 못했어요");
    } finally {
      blockSaving = false;
    }
  }

  async function removeBlock(availabilityId: string) {
    if (!await confirmation.ask("이 개인 일정을 삭제할까요? 삭제한 일정은 되돌릴 수 없어요.", "개인 일정 삭제", "삭제")) return;
    try {
      await apiRequest(`/admin/users/${memberId}/availabilities/${availabilityId}`, { method: "DELETE" });
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "삭제하지 못했어요");
    }
  }

  const timeText = (iso: string) =>
    new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });

  onMount(load);

  async function load() {
    loading = true;
    loadError = "";
    try {
      overview = await apiRequest<Overview>(`/admin/users/${memberId}/overview`);
    } catch (error) {
      loadError = error instanceof Error ? error.message : "회원 정보를 불러오지 못했어요";
      toast.error(loadError);
    } finally {
      loading = false;
    }
  }

  const details = $derived((overview?.user.profileDetails ?? {}) as Record<string, unknown>);
  const specialties = $derived(Array.isArray(details.specialties) ? details.specialties.join(", ") : null);
  const voiceRange = $derived(typeof details.voiceRange === "string" ? details.voiceRange : null);
  const DETAIL_LABELS: Record<string, string> = {
    memo: "메모",
    mainSkills: "주요 스킬",
    position: "직책",
    organization: "소속",
    instruments: "악기",
    experience: "경력",
    portfolioUrl: "포트폴리오"
  };
  const extraDetails = $derived(
    Object.entries(details)
      .filter(([key]) => key !== "specialties" && key !== "voiceRange")
      .map(([key, value]) => [DETAIL_LABELS[key] ?? key, value] as [string, unknown])
  );

  const nextStatus = $derived(overview?.user.status === "BLOCKED" ? "ACTIVE" : "BLOCKED");

  async function changeStatus() {
    if (!overview) return;
    statusSaving = true;
    try {
      await apiRequest(`/admin/users/${overview.user.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus, reason: statusReason.trim() })
      });
      toast.success(nextStatus === "BLOCKED" ? "계정을 차단했어요" : "계정을 복구했어요");
      statusOpen = false;
      statusReason = "";
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "상태를 변경하지 못했어요");
    } finally {
      statusSaving = false;
    }
  }

  // 회원 기본 정보 직접 수정
  let editingProfile = $state(false);
  let profileSaving = $state(false);
  let formName = $state("");
  let formPhone = $state("");
  let formBirthDate = $state("");
  let formAddress = $state("");
  let formGender = $state("UNSPECIFIED");
  let formProfileType = $state("ACTOR");
  let formSpecialties = $state("");
  let formVoiceRange = $state("");
  let formDetailText = $state<Record<string, string>>({});
  const EDITABLE_DETAIL_KEYS = ["memo", "mainSkills", "position", "organization", "instruments", "experience", "portfolioUrl"];

  function openProfileEdit() {
    if (!overview) return;
    const u = overview.user;
    formName = u.name;
    formPhone = u.phone ?? "";
    formBirthDate = u.birthDate ? u.birthDate.slice(0, 10) : "";
    formAddress = u.address ?? "";
    formGender = u.gender ?? "UNSPECIFIED";
    formProfileType = u.profileType;
    formSpecialties = specialties ?? "";
    formVoiceRange = voiceRange ?? "";
    const next: Record<string, string> = {};
    for (const key of EDITABLE_DETAIL_KEYS) {
      const value = details[key];
      next[key] = typeof value === "string" ? value : "";
    }
    formDetailText = next;
    editingProfile = true;
  }

  async function saveProfile(event: SubmitEvent) {
    event.preventDefault();
    if (!overview) return;
    profileSaving = true;
    try {
      const profileDetails: Record<string, unknown> = {};
      const specialtyList = formSpecialties
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (specialtyList.length) profileDetails.specialties = specialtyList;
      if (formVoiceRange.trim()) profileDetails.voiceRange = formVoiceRange.trim();
      for (const key of EDITABLE_DETAIL_KEYS) {
        if (formDetailText[key]?.trim()) profileDetails[key] = formDetailText[key].trim();
      }
      await apiRequest(`/admin/users/${overview.user.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: formName.trim(),
          phone: formPhone.trim() || null,
          birthDate: formBirthDate || null,
          address: formAddress.trim() || null,
          gender: formGender,
          profileType: formProfileType,
          profileDetails
        })
      });
      toast.success("회원 정보를 저장했어요");
      editingProfile = false;
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "저장하지 못했어요");
    } finally {
      profileSaving = false;
    }
  }

  // 비밀번호 발급 · 직접 지정 — 두 경우 다 대상 회원의 로그인 세션을 모두 종료시킨다.
  let passwordOpen = $state(false);
  let passwordMode = $state<"generate" | "manual">("generate");
  let manualPassword = $state("");
  let passwordSaving = $state(false);
  let issuedPassword = $state("");

  function openPassword(mode: "generate" | "manual") {
    passwordMode = mode;
    manualPassword = "";
    issuedPassword = "";
    passwordOpen = true;
  }

  async function submitPassword(event: SubmitEvent) {
    event.preventDefault();
    if (!overview) return;
    passwordSaving = true;
    try {
      const result = await apiRequest<{ password: string }>(`/admin/users/${overview.user.id}/password`, {
        method: "POST",
        body: JSON.stringify({ password: passwordMode === "manual" ? manualPassword.trim() : undefined })
      });
      issuedPassword = result.password;
      toast.success("비밀번호를 변경했어요. 이 회원의 기존 로그인은 모두 종료돼요.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "비밀번호를 변경하지 못했어요");
    } finally {
      passwordSaving = false;
    }
  }

  async function copyPassword() {
    try {
      await navigator.clipboard.writeText(issuedPassword);
      toast.success("비밀번호를 복사했어요");
    } catch {
      toast.error("복사하지 못했어요. 직접 선택해 복사해 주세요");
    }
  }
</script>

<svelte:head>
  <title>{overview?.user.name ?? "회원"} — 운영 콘솔</title>
</svelte:head>

<ConfirmAction bind:this={confirmation} />

{#if loading}
  <div class="space-y-3">
    <Skeleton class="h-16 w-full rounded-2xl" />
    <Skeleton class="h-64 w-full rounded-2xl" />
  </div>
{:else if !overview}
  <div class="grid justify-items-center gap-3 py-16 text-center">
    <p role="alert" class="text-destructive text-sm">{loadError || "회원 정보를 불러오지 못했어요"}</p>
    <div class="flex gap-2">
      <Button href="/admin/members" variant="ghost" size="touch">회원 목록으로</Button>
      <Button type="button" variant="outline" size="touch" onclick={load}>다시 시도</Button>
    </div>
  </div>
{:else}
  {@const user = overview.user}
  <div class="flex flex-wrap items-center gap-3">
    <Button href="/admin/members" variant="ghost" size="icon-touch" class="-ms-2 size-11" aria-label="회원 목록으로">
      <ChevronLeftIcon />
    </Button>
    <span
      class="bg-primary/15 text-primary flex size-12 shrink-0 items-center justify-center rounded-full text-base font-bold"
    >
      {user.name.slice(0, 2)}
    </span>
    <div class="min-w-0">
      <h1 class="text-lg font-bold tracking-tight">{user.name}</h1>
      <div class="mt-1 flex flex-wrap items-center gap-1.5" aria-label="회원 상태">
        {#if user.platformRole !== "MEMBER"}
          <Badge variant="outline">운영자</Badge>
        {/if}
        <Badge variant={user.status === "BLOCKED" ? "destructive" : "secondary"}>
          {USER_STATUS_LABELS[user.status] ?? user.status}
        </Badge>
        <Badge variant={user.profileComplete ? "secondary" : "outline"}>
          프로필 {user.profileComplete ? "완성" : "미완성"}
        </Badge>
      </div>
      <p class="text-muted-foreground mt-1 break-all text-sm">{user.email}</p>
    </div>
    {#if user.platformRole === "MEMBER"}
      <Button
        variant={user.status === "BLOCKED" ? "default" : "outline"}
        size="touch"
        class="ms-auto"
        onclick={() => {
          statusReason = "";
          statusOpen = true;
        }}
      >
        {user.status === "BLOCKED" ? "계정 복구" : "계정 차단"}
      </Button>
    {/if}
  </div>

  <div class="grid gap-4 lg:grid-cols-2">
    <Card.Root>
      <Card.Header class="flex-row items-center justify-between space-y-0">
        <Card.Title class="text-base">기본 정보</Card.Title>
        {#if !editingProfile}
          <Button variant="outline" size="touch" onclick={openProfileEdit}>
            <PencilIcon class="size-3.5" />
            정보 수정
          </Button>
        {/if}
      </Card.Header>
      <Card.Content>
        {#if editingProfile}
          <form class="grid gap-3" onsubmit={saveProfile}>
            <div class="grid grid-cols-2 gap-3">
              <div class="grid gap-1.5">
                <Label for="formName">이름</Label>
                <Input id="formName" bind:value={formName} required class="min-h-11" />
              </div>
              <div class="grid gap-1.5">
                <Label for="formPhone">연락처</Label>
                <Input id="formPhone" bind:value={formPhone} placeholder="010-0000-0000" class="min-h-11" />
              </div>
              <div class="grid gap-1.5">
                <Label for="formBirthDate">생년월일</Label>
                <Input id="formBirthDate" type="date" bind:value={formBirthDate} class="min-h-11" />
              </div>
              <div class="grid gap-1.5">
                <Label for="formAddress">활동 지역</Label>
                <Input id="formAddress" bind:value={formAddress} class="min-h-11" />
              </div>
              <div class="grid gap-1.5">
                <Label for="formGender">성별</Label>
                <select id="formGender" class="border-input bg-background min-h-11 rounded-lg border px-2 text-sm" bind:value={formGender}>
                  {#each Object.entries(GENDER_LABELS) as [value, label] (value)}
                    <option {value}>{label}</option>
                  {/each}
                </select>
              </div>
              <div class="grid gap-1.5">
                <Label for="formProfileType">직군</Label>
                <select
                  id="formProfileType"
                  class="border-input bg-background min-h-11 rounded-lg border px-2 text-sm"
                  bind:value={formProfileType}
                >
                  {#each Object.entries(PROFILE_TYPE_LABELS) as [value, label] (value)}
                    <option {value}>{label}</option>
                  {/each}
                </select>
              </div>
              <div class="grid gap-1.5">
                <Label for="formSpecialties">전문 분야</Label>
                <Input id="formSpecialties" bind:value={formSpecialties} placeholder="쉼표로 구분" class="min-h-11" />
              </div>
              <div class="grid gap-1.5">
                <Label for="formVoiceRange">음역·악기</Label>
                <Input id="formVoiceRange" bind:value={formVoiceRange} class="min-h-11" />
              </div>
              {#each EDITABLE_DETAIL_KEYS as key (key)}
                <div class="grid gap-1.5">
                  <Label for={`formDetail-${key}`}>{DETAIL_LABELS[key]}</Label>
                  <Input id={`formDetail-${key}`} bind:value={formDetailText[key]} class="min-h-11" />
                </div>
              {/each}
            </div>
            <div class="flex justify-end gap-2 pt-1">
              <Button size="touch" type="button" variant="ghost" onclick={() => (editingProfile = false)} disabled={profileSaving}
                >취소</Button
              >
              <Button size="touch" type="submit" disabled={profileSaving || !formName.trim()}>
                {profileSaving ? "저장 중..." : "저장"}
              </Button>
            </div>
          </form>
        {:else}
          <div class="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <p class="text-muted-foreground text-xs">직군</p>
              <p class="mt-0.5 font-medium">{PROFILE_TYPE_LABELS[user.profileType] ?? user.profileType}</p>
            </div>
            <div>
              <p class="text-muted-foreground text-xs">연락처</p>
              <p class="mt-0.5 font-medium">{user.phone ?? "—"}</p>
            </div>
            <div>
              <p class="text-muted-foreground text-xs">생년월일</p>
              <p class="mt-0.5 font-medium">{user.birthDate ? formatDate(user.birthDate) : "—"}</p>
            </div>
            <div>
              <p class="text-muted-foreground text-xs">활동 지역</p>
              <p class="mt-0.5 font-medium">{user.address ?? "—"}</p>
            </div>
            <div>
              <p class="text-muted-foreground text-xs">성별</p>
              <p class="mt-0.5 font-medium">{GENDER_LABELS[user.gender ?? "UNSPECIFIED"] ?? "—"}</p>
            </div>
            <div>
              <p class="text-muted-foreground text-xs">가입일</p>
              <p class="mt-0.5 font-medium">{formatDate(user.createdAt)}</p>
            </div>
            <div>
              <p class="text-muted-foreground text-xs">전문 분야</p>
              <p class="mt-0.5 font-medium">{specialties ?? "—"}</p>
            </div>
            <div>
              <p class="text-muted-foreground text-xs">음역·악기</p>
              <p class="mt-0.5 font-medium">{voiceRange ?? "—"}</p>
            </div>
            {#each extraDetails as [key, value] (key)}
              <div>
                <p class="text-muted-foreground text-xs">{key}</p>
                <p class="mt-0.5 font-medium break-all">
                  {typeof value === "string" ? value : Array.isArray(value) ? value.join(", ") : JSON.stringify(value)}
                </p>
              </div>
            {/each}
          </div>
        {/if}
      </Card.Content>
    </Card.Root>

    <Card.Root>
      <Card.Header>
        <Card.Title class="text-base">계정 · 보안</Card.Title>
        <Card.Description>회원이 비밀번호를 잊었거나 로그인할 수 없을 때 운영자가 직접 재설정할 수 있어요.</Card.Description>
      </Card.Header>
      <Card.Content class="flex flex-wrap gap-2">
        <Button variant="outline" size="touch" onclick={() => openPassword("generate")}>
          <KeyRoundIcon class="size-3.5" />
          임시 비밀번호 발급
        </Button>
        <Button variant="outline" size="touch" onclick={() => openPassword("manual")}>직접 입력하여 변경</Button>
      </Card.Content>
    </Card.Root>

    <Card.Root>
      <Card.Header>
        <Card.Title class="text-base">참여 공연 {overview.memberships.length}</Card.Title>
      </Card.Header>
      <Card.Content class="grid gap-2">
        {#if overview.memberships.length === 0}
          <EmptyState title="참여 중인 공연이 없어요" description="공연을 선택한 뒤 멤버 관리에서 이 회원을 추가해 주세요.">
            {#snippet action()}<Button href="/admin/productions" variant="outline" size="touch">공연 선택</Button>{/snippet}
          </EmptyState>
        {:else}
          {#each overview.memberships as membership (membership.id)}
            <div class="border-border/60 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2.5">
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-semibold">{membership.production.title}</p>
                <p class="text-muted-foreground text-xs">
                  {PHASE_LABELS[membership.production.currentPhase] ?? membership.production.currentPhase}
                  · {VISIBILITY_LABELS[membership.production.visibility] ?? membership.production.visibility}
                </p>
              </div>
              <span class="flex shrink-0 flex-wrap gap-1">
                {#each membership.roles as role (role.role)}
                  <Badge variant={role.role === membership.primaryRole ? "default" : "outline"} class="text-xs">
                    {PRODUCTION_ROLE_LABELS[role.role] ?? role.role}
                  </Badge>
                {/each}
              </span>
              <Button href={`/app/p/${membership.production.id}/manage/members`} variant="outline" size="touch">멤버·역할 관리</Button>
              <Button
                variant="ghost"
                size="icon-touch"
                class="size-11"
                href={`/app/p/${membership.production.id}`}
                aria-label={`${membership.production.title} 공연 열기`}
              >
                <ExternalLinkIcon class="size-3.5" />
              </Button>
            </div>
          {/each}
        {/if}
      </Card.Content>
    </Card.Root>

    <Card.Root class="lg:col-span-2">
      <Card.Header>
        <Card.Title class="text-base">다가오는 일정 {overview.upcomingEvents.length}</Card.Title>
        <Card.Description>이 회원이 참석 응답을 받는 일정이에요.</Card.Description>
      </Card.Header>
      <Card.Content class="grid gap-2">
        {#if overview.upcomingEvents.length === 0}
          <p class="text-muted-foreground text-sm">다가오는 일정이 없어요.</p>
        {:else}
          {#each overview.upcomingEvents as event (event.id)}
            <div class="border-border/60 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border px-3 py-2.5">
              <div class="w-40 shrink-0">
                <p class="text-sm font-semibold">{formatDateTime(event.startAt)}</p>
                <p class="text-muted-foreground text-xs">{EVENT_TYPE_LABELS[event.type] ?? event.type}</p>
              </div>
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium">{event.title}</p>
                <p class="text-muted-foreground truncate text-xs">
                  {event.production.title}
                  {#if event.location}
                    · {event.location}
                  {/if}
                </p>
              </div>
              <select
                class="border-input bg-background min-h-11 shrink-0 rounded-lg border px-2 text-xs"
                aria-label={`${event.title} 출석 상태`}
                value={event.myStatus ?? "INVITED"}
                onchange={(changeEvent) => setAttendance(event.myAttendanceId, changeEvent.currentTarget.value)}
              >
                <option value="ACCEPTED">참석</option>
                <option value="DECLINED">불참</option>
                <option value="INVITED">미응답</option>
              </select>
            </div>
          {/each}
        {/if}
      </Card.Content>
    </Card.Root>

    <Card.Root class="lg:col-span-2">
      <Card.Header>
        <div class="flex items-center justify-between">
          <div>
            <Card.Title class="text-base">개인 일정 {overview.availabilities.length}</Card.Title>
            <Card.Description>공연 일정 배정 시 시간 충돌로 확인되는 개인 일정이에요.</Card.Description>
          </div>
          <Button variant="outline" size="touch" onclick={() => (blockOpen = true)}>개인 일정 등록</Button>
        </div>
      </Card.Header>
      <Card.Content class="grid gap-2">
        {#if overview.availabilities.length === 0}
          <p class="text-muted-foreground text-sm">등록된 개인 일정이 없어요.</p>
        {:else}
          {#each overview.availabilities as block (block.id)}
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-red-500/10 px-3.5 py-2.5">
              <span class="text-sm font-semibold text-red-500">{block.title ?? "개인 일정"}</span>
              <span class="text-muted-foreground text-sm">
                {formatDate(block.startAt)} {timeText(block.startAt)}–{timeText(block.endAt)}
              </span>
              {#if block.reason}
                <span class="text-muted-foreground text-sm">{block.reason}</span>
              {/if}
              <button
                type="button"
                class="text-muted-foreground hover:text-foreground ms-auto min-h-11 px-3 text-xs"
                onclick={() => removeBlock(block.id)}
              >
                삭제
              </button>
            </div>
          {/each}
        {/if}
      </Card.Content>
    </Card.Root>
  </div>

  <Dialog.Root bind:open={blockOpen}>
    <Dialog.Content class="sm:max-w-md">
      <Dialog.Header>
        <Dialog.Title>{user.name} 개인 일정 등록</Dialog.Title>
        <Dialog.Description>회원이 요청한 개인 일정을 대신 등록해요.</Dialog.Description>
      </Dialog.Header>
      <form class="grid gap-4" onsubmit={addBlock}>
        <div class="grid gap-2">
          <Label for="blockTitle">일정 이름</Label>
          <Input id="blockTitle" bind:value={blockTitle} maxlength={120} placeholder="예: 본업 근무, 다른 공연" class="min-h-11" />
        </div>
        <div class="grid gap-2">
          <Label for="blockDate">날짜</Label>
          <Input id="blockDate" type="date" bind:value={blockDate} required class="min-h-11" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div class="grid gap-2">
            <Label for="blockStart">시작</Label>
            <Input id="blockStart" type="time" bind:value={blockStart} class="min-h-11" />
          </div>
          <div class="grid gap-2">
            <Label for="blockEnd">종료</Label>
            <Input id="blockEnd" type="time" bind:value={blockEnd} class="min-h-11" />
          </div>
        </div>
        <div class="grid gap-2">
          <Label for="blockReason">메모 (선택)</Label>
          <Input id="blockReason" bind:value={blockReason} maxlength={120} class="min-h-11" />
        </div>
        <Dialog.Footer class="gap-2">
          <Button size="touch" type="button" variant="ghost" onclick={() => (blockOpen = false)} disabled={blockSaving}>취소</Button>
          <Button size="touch" type="submit" disabled={blockSaving || !blockDate}>
            {blockSaving ? "등록 중..." : "등록"}
          </Button>
        </Dialog.Footer>
      </form>
    </Dialog.Content>
  </Dialog.Root>

  <Dialog.Root bind:open={statusOpen}>
    <Dialog.Content class="sm:max-w-md">
      <Dialog.Header>
        <Dialog.Title>{user.name} 계정 {nextStatus === "BLOCKED" ? "차단" : "복구"}</Dialog.Title>
        <Dialog.Description>운영 기록에 남길 사유를 입력해 주세요.</Dialog.Description>
      </Dialog.Header>
      <div class="grid gap-2">
        <Label for="reason">사유</Label>
        <Textarea id="reason" bind:value={statusReason} rows={3} placeholder="예: 본인 요청으로 계정 정지" />
      </div>
      <Dialog.Footer>
        <Button size="touch" variant="ghost" onclick={() => (statusOpen = false)}>취소</Button>
        <Button size="touch"
          variant={nextStatus === "BLOCKED" ? "destructive" : "default"}
          onclick={changeStatus}
          disabled={statusSaving || !statusReason.trim()}
        >
          {statusSaving ? "처리 중..." : nextStatus === "BLOCKED" ? "차단" : "복구"}
        </Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>

  <Dialog.Root bind:open={passwordOpen}>
    <Dialog.Content class="sm:max-w-md">
      <Dialog.Header>
        <Dialog.Title>{user.name} 비밀번호 {passwordMode === "generate" ? "임시 발급" : "직접 변경"}</Dialog.Title>
        <Dialog.Description>
          변경하면 이 회원의 기존 로그인 세션이 모두 종료돼요. 새 비밀번호를 회원에게 안전하게 전달해 주세요.
        </Dialog.Description>
      </Dialog.Header>
      {#if issuedPassword}
        <div class="grid gap-2">
          <Label for="issuedPassword">새 비밀번호</Label>
          <div class="flex gap-2">
            <Input id="issuedPassword" value={issuedPassword} readonly class="min-h-11 font-mono" />
            <Button type="button" variant="outline" size="icon-touch" onclick={copyPassword} aria-label="복사">
              <CopyIcon class="size-4" />
            </Button>
          </div>
          <p class="text-muted-foreground text-xs">이 창을 닫으면 다시 확인할 수 없어요. 지금 복사해 전달해 주세요.</p>
        </div>
        <Dialog.Footer>
          <Button size="touch" onclick={() => (passwordOpen = false)}>닫기</Button>
        </Dialog.Footer>
      {:else}
        <form class="grid gap-4" onsubmit={submitPassword}>
          {#if passwordMode === "manual"}
            <div class="grid gap-2">
              <Label for="manualPassword">새 비밀번호</Label>
              <Input
                id="manualPassword"
                type="text"
                bind:value={manualPassword}
                placeholder="영문 + 숫자 포함 8자 이상"
                autocomplete="off"
              class="min-h-11" />
            </div>
          {:else}
            <p class="text-muted-foreground text-sm">
              영문·숫자가 섞인 임시 비밀번호를 자동으로 만들어 바로 보여드려요.
            </p>
          {/if}
          <Dialog.Footer class="gap-2">
            <Button size="touch" type="button" variant="ghost" onclick={() => (passwordOpen = false)} disabled={passwordSaving}
              >취소</Button
            >
            <Button size="touch" type="submit" disabled={passwordSaving || (passwordMode === "manual" && !manualPassword.trim())}>
              {passwordSaving ? "처리 중..." : passwordMode === "generate" ? "발급" : "변경"}
            </Button>
          </Dialog.Footer>
        </form>
      {/if}
    </Dialog.Content>
  </Dialog.Root>
{/if}
