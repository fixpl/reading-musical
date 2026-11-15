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
  };

  let email = $state("");
  let result = $state<ForgotResponse | null>(null);
  let errorMessage = $state("");
  let submitting = $state(false);

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (submitting) return;
    errorMessage = "";
    submitting = true;
    try {
      result = await apiRequest<ForgotResponse>("/auth/password/forgot", {
        method: "POST",
        body: JSON.stringify({ email })
      });
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "메일을 요청하지 못했어요. 잠시 후 다시 시도해 주세요.";
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
      <h1 class="text-2xl font-semibold tracking-tight">비밀번호 찾기</h1>
      <p class="text-muted-foreground mt-3 text-sm leading-7">가입한 이메일로 비밀번호 재설정 링크를 보내드려요.</p>
    </div>

    {#if result}
      <div role="status" class="bg-muted/25 rounded-xl border px-5 py-6">
        <p class="font-semibold">메일을 확인해 주세요</p>
        <p class="text-muted-foreground mt-3 text-sm leading-7">
          {result.message}
          {#if result.expiresInMinutes}
            링크는 {result.expiresInMinutes}분 동안 유효해요.
          {/if}
        </p>
      </div>
      <Button variant="outline" class="min-h-12 w-full" href="/login">로그인으로 돌아가기</Button>
    {:else}
      <form class="grid gap-5" onsubmit={handleSubmit} aria-busy={submitting}>
        <div class="grid gap-2">
          <Label for="email">이메일</Label>
          <Input class="min-h-11" id="email" type="email" autocomplete="email" placeholder="name@example.com" bind:value={email} required />
        </div>
        {#if errorMessage}
          <p role="alert" class="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm leading-6 text-destructive">{errorMessage}</p>
        {/if}
        <Button type="submit" class="min-h-12 w-full" disabled={submitting}>
          {submitting ? "보내는 중..." : "재설정 메일 보내기"}
        </Button>
      </form>
      <p class="text-muted-foreground text-center text-sm">
        <a class="text-foreground inline-flex min-h-11 items-center font-medium underline underline-offset-4" href="/login">로그인으로 돌아가기</a>
      </p>
    {/if}
  </div>
</AuthShell>
