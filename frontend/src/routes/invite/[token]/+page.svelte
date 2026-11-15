<script lang="ts">
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import { ApiError, apiRequest, getAccessToken } from "$lib/api/client";
  import AuthShell from "$lib/components/app/auth-shell.svelte";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";

  type Invitation = {
    email: string;
    role: string;
    status: string;
    expiresAt: string;
    expired: boolean;
    production: {
      id: string;
      title: string;
      currentPhase: string;
      visibility: string;
    };
  };

  const roleLabels: Record<string, string> = {
    PRODUCER: "기획자",
    DIRECTOR: "연출자",
    MUSIC_DIRECTOR: "음악감독",
    STAGE_MANAGER: "무대감독",
    ACTOR: "배우",
    STAFF: "스태프",
    GUEST: "게스트"
  };

  const STATUS_LABELS: Record<string, string> = { PENDING: "수락을 기다리는 중", ACCEPTED: "이미 수락함", REVOKED: "취소된 초대", EXPIRED: "기간이 지남" };

  let token = $state("");
  let invitation = $state<Invitation | null>(null);
  let loading = $state(true);
  let accepting = $state(false);
  let errorMessage = $state("");
  let acceptMessage = $state("");

  onMount(() => {
    token = decodeURIComponent(window.location.pathname.split("/").filter(Boolean).pop() ?? "");
    void loadInvitation();
  });

  async function loadInvitation() {
    loading = true;
    errorMessage = "";
    try {
      invitation = await apiRequest<Invitation>(`/invitations/${encodeURIComponent(token)}`);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "초대 정보를 불러오지 못했어요";
    } finally {
      loading = false;
    }
  }

  async function acceptInvitation() {
    accepting = true;
    acceptMessage = "";
    errorMessage = "";
    try {
      const result = await apiRequest<{ next: string }>(`/invitations/${encodeURIComponent(token)}/accept`, {
        method: "POST"
      });
      acceptMessage = "초대를 수락했어요.";
      await goto(result.next || "/app");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        errorMessage = "초대를 수락하려면 먼저 로그인해 주세요.";
      } else {
        errorMessage = error instanceof Error ? error.message : "초대를 수락하지 못했어요";
      }
    } finally {
      accepting = false;
    }
  }

  function loginHref() {
    return invitation ? `/login?invite=${encodeURIComponent(token)}&email=${encodeURIComponent(invitation.email)}` : "/login";
  }

  function registerHref() {
    return invitation ? `/register?invite=${encodeURIComponent(token)}&email=${encodeURIComponent(invitation.email)}` : "/register";
  }
</script>

<svelte:head>
  <title>공연 초대 — 아트브릿지</title>
</svelte:head>

<AuthShell>
  <div class="space-y-5">
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">공연 초대</h1>
      <p class="text-muted-foreground mt-3 text-sm leading-7">공연과 역할을 확인한 뒤 초대를 수락해 주세요.</p>
    </div>

    {#if loading}
      <p class="text-muted-foreground text-sm" role="status">초대 정보를 확인하고 있어요…</p>
    {:else if invitation}
      <section class="bg-card space-y-3 rounded-xl border p-4">
        <div class="flex flex-wrap items-center gap-2">
          <h2 class="min-w-0 break-words text-lg font-semibold">{invitation.production.title}</h2>
          <Badge variant="secondary">{roleLabels[invitation.role] ?? invitation.role}</Badge>
        </div>
        <dl class="text-sm">
          <div class="flex justify-between gap-3 py-1"><dt class="text-muted-foreground">초대한 이메일</dt><dd class="break-all text-end">{invitation.email}</dd></div>
          <div class="flex justify-between gap-3 py-1"><dt class="text-muted-foreground">상태</dt><dd>{STATUS_LABELS[invitation.expired ? "EXPIRED" : invitation.status] ?? invitation.status}</dd></div>
          <div class="flex justify-between gap-3 py-1"><dt class="text-muted-foreground">유효 기간</dt><dd>{new Date(invitation.expiresAt).toLocaleString("ko-KR")}까지</dd></div>
        </dl>
      </section>

      {#if errorMessage}<p role="alert" class="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm leading-6 text-destructive">{errorMessage}</p>{/if}
      {#if acceptMessage}<p role="status" class="text-sm font-medium text-emerald-700 dark:text-emerald-400">{acceptMessage}</p>{/if}

      {#if invitation.expired || invitation.status !== "PENDING"}
        <p class="text-muted-foreground text-sm">이 초대는 더 이상 쓸 수 없어요. 운영팀에 초대를 다시 요청해 주세요.</p>
      {:else if getAccessToken()}
        <Button class="min-h-12 w-full" onclick={acceptInvitation} disabled={accepting}>{accepting ? "수락하는 중…" : "초대 수락하기"}</Button>
      {:else}
        <div class="grid gap-2">
          <Button href={loginHref()} class="min-h-12">로그인하고 초대 수락</Button>
          <Button href={registerHref()} variant="outline" class="min-h-12">회원가입하고 초대 수락</Button>
        </div>
      {/if}
    {:else}
      <p role="alert" class="text-destructive text-sm leading-7">{errorMessage || "초대 정보를 찾을 수 없어요."}</p>
      <Button variant="outline" class="min-h-11 w-full" onclick={loadInvitation}>초대 다시 확인</Button>
      <a href="/" class="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4">홈으로 돌아가기</a>
    {/if}
  </div>
</AuthShell>
