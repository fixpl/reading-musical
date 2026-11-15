<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { safeLoginReturn } from "$lib/domain/login-return";
  import { onMount } from "svelte";
  import { Eye, EyeOff } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import AuthShell from "$lib/components/app/auth-shell.svelte";
  import { ApiError, apiRequest, saveTokens, type AuthTokens } from "$lib/api/client";
  import { homePathFor, type PlatformRole } from "$lib/api/auth";

  let email = $state("");
  let password = $state("");
  let showPassword = $state(false);
  let errorMessage = $state("");
  let invalidCredentials = $state(false);
  let mounted = $state(false);
  let submitting = $state(false);
  let inviteToken = $state("");
  let returnTo = $state<string | null>(null);

  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    inviteToken = params.get("invite") ?? "";
    returnTo = safeLoginReturn(params.get("next"));
    email = params.get("email") ?? email;
    mounted = true;
  });

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (submitting) return;
    errorMessage = "";
    invalidCredentials = false;
    submitting = true;
    const invitation = inviteToken;
    const destination = returnTo;

    try {
      const result = await apiRequest<{ user: { platformRole: PlatformRole }; tokens: AuthTokens }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), password })
      });
      saveTokens(result.tokens);

      if (invitation) {
        const accepted = await apiRequest<{ next: string }>(`/invitations/${encodeURIComponent(invitation)}/accept`, { method: "POST" });
        await goto(safeLoginReturn(accepted.next) ?? "/app");
        return;
      }

      await goto(destination || homePathFor(result.user.platformRole));
    } catch (error) {
      invalidCredentials = error instanceof ApiError && error.status === 401;
      errorMessage = error instanceof TypeError
        ? "로그인 서버에 연결할 수 없어요. 연결을 확인한 뒤 다시 시도해 주세요."
        : error instanceof Error ? error.message : "로그인하지 못했어요. 다시 시도해 주세요.";
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head>
  <title>로그인 — {$page.data.site?.info.siteName || "아트브릿지"}</title>
</svelte:head>

<AuthShell>
  <div class="grid gap-6">
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">로그인</h1>
      {#if inviteToken}<p class="text-muted-foreground mt-3 text-sm leading-7">초대받은 이메일로 로그인해 공연에 참여해요.</p>{/if}
    </div>

    <form class="grid gap-5" method="post" onsubmit={handleSubmit} aria-busy={!mounted || submitting}>
      <div class="grid gap-2">
        <Label for="email">이메일</Label>
        <Input class="min-h-11" id="email" name="email" type="email" autocomplete="username" autocapitalize="none" placeholder="name@example.com" bind:value={email} required aria-invalid={invalidCredentials} aria-describedby={invalidCredentials ? "login-error" : undefined} />
      </div>
      <div class="grid gap-2">
        <div class="flex items-center justify-between">
          <Label for="password">비밀번호</Label>
          <a href="/forgot" class="text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center text-sm transition-colors">
            비밀번호 찾기
          </a>
        </div>
        <div class="relative">
          <Input class="min-h-11 pe-12" id="password" name="password" type={showPassword ? "text" : "password"} autocomplete="current-password" bind:value={password} required aria-invalid={invalidCredentials} aria-describedby={invalidCredentials ? "login-error" : undefined} />
          <Button variant="ghost" size="icon-touch" class="text-muted-foreground absolute inset-y-0 end-0" aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 표시"} aria-controls="password" disabled={!mounted} onclick={() => (showPassword = !showPassword)}>
            {#if showPassword}<EyeOff aria-hidden="true" />{:else}<Eye aria-hidden="true" />{/if}
          </Button>
        </div>
      </div>

      {#if errorMessage}
        <p id="login-error" role="alert" class="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm leading-6 text-destructive">{errorMessage}</p>
      {/if}

      <Button type="submit" class="min-h-12 w-full" disabled={!mounted || submitting}>
        {!mounted ? "로그인 준비 중…" : submitting ? "로그인 중…" : "로그인"}
      </Button>
    </form>

    <p class="text-muted-foreground text-center text-sm">
      아직 계정이 없나요?
      <a
        class="text-foreground inline-flex min-h-11 items-center font-medium underline underline-offset-4"
        href={inviteToken
          ? `/register?invite=${encodeURIComponent(inviteToken)}&email=${encodeURIComponent(email)}`
          : "/register"}
      >
        회원가입
      </a>
    </p>
  </div>
</AuthShell>
