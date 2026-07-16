<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import AuthShell from "$lib/components/app/auth-shell.svelte";
  import { apiRequest } from "$lib/api/client";

  type ForgotResponse = {
    ok: boolean;
    message: string;
    expiresInMinutes?: number;
    devResetUrl?: string;
  };

  let email = $state("");
  let result = $state<ForgotResponse | null>(null);
  let errorMessage = $state("");
  let submitting = $state(false);

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    errorMessage = "";
    submitting = true;
    try {
      result = await apiRequest<ForgotResponse>("/auth/password/forgot", {
        method: "POST",
        body: JSON.stringify({ email })
      });
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "요청을 처리하지 못했습니다";
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head>
  <title>비밀번호 찾기 — 아트브릿지</title>
</svelte:head>

<AuthShell>
  <div class="grid gap-6">
    <div>
      <h1 class="text-2xl font-bold tracking-tight">비밀번호 찾기</h1>
      <p class="text-muted-foreground mt-1 text-sm">가입한 이메일로 비밀번호 재설정 링크를 보내드립니다.</p>
    </div>

    {#if result}
      <div class="bg-card rounded-2xl border px-5 py-6 text-center">
        <p class="font-semibold">메일을 확인해 주세요</p>
        <p class="text-muted-foreground mt-1 text-sm">
          {result.message}
          {#if result.expiresInMinutes}
            링크는 {result.expiresInMinutes}분 동안 유효합니다.
          {/if}
        </p>
        {#if result.devResetUrl}
          <a class="text-primary mt-3 inline-block text-sm underline underline-offset-4" href={result.devResetUrl}>
            (개발용) 바로 재설정하기
          </a>
        {/if}
      </div>
      <Button variant="outline" class="w-full" href="/login">로그인으로 돌아가기</Button>
    {:else}
      <form class="grid gap-4" onsubmit={handleSubmit}>
        <div class="grid gap-2">
          <Label for="email">이메일</Label>
          <Input id="email" type="email" autocomplete="email" placeholder="name@example.com" bind:value={email} required />
        </div>
        {#if errorMessage}
          <p class="text-destructive text-sm">{errorMessage}</p>
        {/if}
        <Button type="submit" class="w-full" disabled={submitting}>
          {submitting ? "보내는 중..." : "재설정 메일 보내기"}
        </Button>
      </form>
      <p class="text-muted-foreground text-center text-sm">
        <a class="text-foreground font-medium underline-offset-4 hover:underline" href="/login">로그인으로 돌아가기</a>
      </p>
    {/if}
  </div>
</AuthShell>
