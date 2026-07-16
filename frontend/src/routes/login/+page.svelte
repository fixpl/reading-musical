<script lang="ts">
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import AuthShell from "$lib/components/app/auth-shell.svelte";
  import { apiRequest, saveTokens } from "$lib/api/client";
  import { fetchCurrentUser, homePathFor } from "$lib/api/auth";

  let email = $state("");
  let password = $state("");
  let errorMessage = $state("");
  let submitting = $state(false);
  let inviteToken = $state("");

  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    inviteToken = params.get("invite") ?? "";
    email = params.get("email") ?? email;
  });

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    errorMessage = "";
    submitting = true;

    try {
      const result = await apiRequest<{ tokens: { accessToken: string; refreshToken: string } }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password })
      });
      saveTokens(result.tokens);

      if (inviteToken) {
        await apiRequest(`/invitations/${encodeURIComponent(inviteToken)}/accept`, { method: "POST" });
      }

      const me = await fetchCurrentUser({ fresh: true });
      await goto(homePathFor(me?.platformRole));
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "로그인하지 못했습니다";
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head>
  <title>로그인 — 아트브릿지</title>
</svelte:head>

<AuthShell>
  <div class="grid gap-6">
    <div>
      <h1 class="text-2xl font-bold tracking-tight">로그인</h1>
      <p class="text-muted-foreground mt-1 text-sm">
        {inviteToken
          ? "초대받은 이메일로 로그인하면 공연 멤버로 연결됩니다."
          : "내 공연, 큐시트, 일정을 내 역할 기준으로 확인합니다."}
      </p>
    </div>

    <form class="grid gap-4" onsubmit={handleSubmit}>
      <div class="grid gap-2">
        <Label for="email">이메일</Label>
        <Input id="email" type="email" autocomplete="email" placeholder="name@example.com" bind:value={email} required />
      </div>
      <div class="grid gap-2">
        <div class="flex items-center justify-between">
          <Label for="password">비밀번호</Label>
          <a href="/forgot" class="text-muted-foreground hover:text-foreground text-xs transition-colors">
            비밀번호 찾기
          </a>
        </div>
        <Input id="password" type="password" autocomplete="current-password" bind:value={password} required />
      </div>

      {#if errorMessage}
        <p class="text-destructive text-sm">{errorMessage}</p>
      {/if}

      <Button type="submit" class="w-full" disabled={submitting}>
        {submitting ? "로그인 중..." : "로그인"}
      </Button>
    </form>

    <p class="text-muted-foreground text-center text-sm">
      아직 계정이 없나요?
      <a
        class="text-foreground font-medium underline-offset-4 hover:underline"
        href={inviteToken
          ? `/register?invite=${encodeURIComponent(inviteToken)}&email=${encodeURIComponent(email)}`
          : "/register"}
      >
        회원가입
      </a>
    </p>
  </div>
</AuthShell>
