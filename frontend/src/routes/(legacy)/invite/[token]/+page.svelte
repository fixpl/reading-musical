<script lang="ts">
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import { ApiError, apiRequest, getAccessToken } from "$lib/api/client";
  import AuthShell from "$lib/components/AuthShell.svelte";

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
  <title>공연 초대 | 아트브릿지</title>
</svelte:head>

<AuthShell>
  <section class="form-card auth-card">
    <h1>공연 초대</h1>

    {#if loading}
      <p class="muted">초대 정보를 확인하고 있어요.</p>
    {:else if invitation}
      <div class="invite-summary">
        <span class="badge">{roleLabels[invitation.role] ?? invitation.role}</span>
        <h2>{invitation.production.title}</h2>
        <dl>
          <div>
            <dt>초대 이메일</dt>
            <dd>{invitation.email}</dd>
          </div>
          <div>
            <dt>상태</dt>
            <dd>{invitation.status}</dd>
          </div>
          <div>
            <dt>만료</dt>
            <dd>{new Date(invitation.expiresAt).toLocaleString("ko-KR")}</dd>
          </div>
        </dl>
      </div>

      {#if errorMessage}
        <p class="error">{errorMessage}</p>
      {/if}
      {#if acceptMessage}
        <p class="success">{acceptMessage}</p>
      {/if}

      {#if invitation.expired || invitation.status !== "PENDING"}
        <p class="muted">관리자에게 초대를 다시 요청해 주세요.</p>
      {:else}
        <div class="button-row">
          {#if getAccessToken()}
            <button class="button primary" type="button" onclick={acceptInvitation} disabled={accepting}>
              {accepting ? "수락 중" : "초대 수락하기"}
            </button>
          {:else}
            <a class="button primary" href={loginHref()}>기존 계정으로 로그인</a>
            <a class="button" href={registerHref()}>회원가입 후 수락</a>
          {/if}
        </div>
      {/if}
    {:else}
      <p class="error">{errorMessage || "초대 정보를 찾을 수 없어요"}</p>
    {/if}
  </section>
</AuthShell>
