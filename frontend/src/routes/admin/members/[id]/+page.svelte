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
  import { apiRequest } from "$lib/api/client";
  import {
    EVENT_TYPE_LABELS,
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
      toast.success("출석 상태를 변경했습니다 (운영자 변경으로 기록)");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "변경하지 못했습니다");
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
      toast.success("개인 일정을 등록했습니다");
      blockOpen = false;
      blockTitle = "";
      blockDate = "";
      blockReason = "";
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "등록하지 못했습니다");
    } finally {
      blockSaving = false;
    }
  }

  async function removeBlock(availabilityId: string) {
    try {
      await apiRequest(`/admin/users/${memberId}/availabilities/${availabilityId}`, { method: "DELETE" });
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "삭제하지 못했습니다");
    }
  }

  const timeText = (iso: string) =>
    new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });

  onMount(load);

  async function load() {
    loading = true;
    try {
      overview = await apiRequest<Overview>(`/admin/users/${memberId}/overview`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "회원 정보를 불러오지 못했습니다");
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
      toast.success(nextStatus === "BLOCKED" ? "계정을 차단했습니다" : "계정을 복구했습니다");
      statusOpen = false;
      statusReason = "";
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "상태를 변경하지 못했습니다");
    } finally {
      statusSaving = false;
    }
  }
</script>

<svelte:head>
  <title>{overview?.user.name ?? "회원"} — 운영 콘솔</title>
</svelte:head>

{#if loading}
  <div class="space-y-3">
    <Skeleton class="h-16 w-full rounded-2xl" />
    <Skeleton class="h-64 w-full rounded-2xl" />
  </div>
{:else if overview}
  {@const user = overview.user}
  <div class="flex flex-wrap items-center gap-3">
    <Button href="/admin/members" variant="ghost" size="icon" class="-ms-2 size-8" aria-label="회원 목록으로">
      <ChevronLeftIcon />
    </Button>
    <span
      class="bg-primary/15 text-primary flex size-12 shrink-0 items-center justify-center rounded-full text-base font-bold"
    >
      {user.name.slice(0, 2)}
    </span>
    <div class="min-w-0">
      <p class="flex flex-wrap items-center gap-1.5 text-lg font-bold tracking-tight">
        {user.name}
        {#if user.platformRole !== "MEMBER"}
          <Badge variant="outline">운영자</Badge>
        {/if}
        <Badge variant={user.status === "BLOCKED" ? "destructive" : "secondary"}>
          {USER_STATUS_LABELS[user.status] ?? user.status}
        </Badge>
        <Badge variant={user.profileComplete ? "secondary" : "outline"}>
          프로필 {user.profileComplete ? "완성" : "미완성"}
        </Badge>
      </p>
      <p class="text-muted-foreground text-sm">{user.email}</p>
    </div>
    {#if user.platformRole === "MEMBER"}
      <Button
        variant={user.status === "BLOCKED" ? "default" : "outline"}
        size="sm"
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
      <Card.Header>
        <Card.Title class="text-base">기본 정보</Card.Title>
      </Card.Header>
      <Card.Content class="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
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
      </Card.Content>
    </Card.Root>

    <Card.Root>
      <Card.Header>
        <Card.Title class="text-base">참여 공연 {overview.memberships.length}</Card.Title>
      </Card.Header>
      <Card.Content class="grid gap-2">
        {#if overview.memberships.length === 0}
          <p class="text-muted-foreground text-sm">참여 중인 공연이 없습니다.</p>
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
              <Button
                variant="ghost"
                size="icon"
                class="size-7"
                href={`/app/p/${membership.production.id}`}
                aria-label="워크스페이스 열기"
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
        <Card.Description>이 회원이 출석 대상인 일정입니다.</Card.Description>
      </Card.Header>
      <Card.Content class="grid gap-2">
        {#if overview.upcomingEvents.length === 0}
          <p class="text-muted-foreground text-sm">다가오는 일정이 없습니다.</p>
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
                class="border-input bg-background h-8 shrink-0 rounded-lg border px-2 text-xs"
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
            <Card.Description>공연 일정 배정 시 충돌로 확인되는 회원의 개인 일정입니다.</Card.Description>
          </div>
          <Button variant="outline" size="sm" onclick={() => (blockOpen = true)}>개인 일정 등록</Button>
        </div>
      </Card.Header>
      <Card.Content class="grid gap-2">
        {#if overview.availabilities.length === 0}
          <p class="text-muted-foreground text-sm">등록된 개인 일정이 없습니다.</p>
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
                class="text-muted-foreground hover:text-foreground ms-auto text-xs"
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
        <Dialog.Description>회원 요청으로 전달받은 개인 일정을 대신 등록합니다.</Dialog.Description>
      </Dialog.Header>
      <form class="grid gap-4" onsubmit={addBlock}>
        <div class="grid gap-2">
          <Label for="blockTitle">일정 이름</Label>
          <Input id="blockTitle" bind:value={blockTitle} maxlength={120} placeholder="예: 본업 근무, 다른 공연" />
        </div>
        <div class="grid gap-2">
          <Label for="blockDate">날짜</Label>
          <Input id="blockDate" type="date" bind:value={blockDate} required />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div class="grid gap-2">
            <Label for="blockStart">시작</Label>
            <Input id="blockStart" type="time" bind:value={blockStart} />
          </div>
          <div class="grid gap-2">
            <Label for="blockEnd">종료</Label>
            <Input id="blockEnd" type="time" bind:value={blockEnd} />
          </div>
        </div>
        <div class="grid gap-2">
          <Label for="blockReason">메모 (선택)</Label>
          <Input id="blockReason" bind:value={blockReason} maxlength={120} />
        </div>
        <Dialog.Footer class="gap-2">
          <Button type="button" variant="ghost" onclick={() => (blockOpen = false)} disabled={blockSaving}>취소</Button>
          <Button type="submit" disabled={blockSaving || !blockDate}>
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
        <Button variant="ghost" onclick={() => (statusOpen = false)}>취소</Button>
        <Button
          variant={nextStatus === "BLOCKED" ? "destructive" : "default"}
          onclick={changeStatus}
          disabled={statusSaving || !statusReason.trim()}
        >
          {statusSaving ? "처리 중..." : nextStatus === "BLOCKED" ? "차단" : "복구"}
        </Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
{/if}
