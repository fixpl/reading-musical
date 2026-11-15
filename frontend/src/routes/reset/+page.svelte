<script lang="ts">
  import { onMount } from "svelte";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import AuthShell from "$lib/components/app/auth-shell.svelte";
  import { apiRequest } from "$lib/api/client";

  const passwordPattern = "(?=.*[A-Za-z])(?=.*[0-9]).{8,}";

  let token = $state("");
  let newPassword = $state("");
  let confirm = $state("");
  let done = $state(false);
  let errorMessage = $state("");
  let submitting = $state(false);

  onMount(() => {
    token = new URLSearchParams(window.location.search).get("token") ?? "";
    if (!token) {
      errorMessage = "재설정 링크가 올바르지 않아요. 메일의 링크로 다시 들어와 주세요.";
    }
  });

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (!token || submitting) return;
    if (newPassword !== confirm) {
      errorMessage = "비밀번호가 서로 달라요. 다시 확인해 주세요.";
      return;
    }
    errorMessage = "";
    submitting = true;
    try {
      await apiRequest<{ ok: boolean }>("/auth/password/reset", {
        method: "POST",
        body: JSON.stringify({ token, newPassword })
      });
      done = true;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "비밀번호를 변경하지 못했어요. 다시 시도해 주세요.";
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head>
  <title>비밀번호 재설정 — 아트브릿지</title>
</svelte:head>

<AuthShell>
  <div class="grid gap-6">
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">비밀번호 재설정</h1>
      <p class="text-muted-foreground mt-3 text-sm leading-7">새 비밀번호는 영문과 숫자를 포함해 8자 이상 입력해 주세요.</p>
    </div>

    {#if done}
      <div role="status" class="bg-muted/25 rounded-xl border px-5 py-6">
        <p class="font-semibold">비밀번호를 변경했어요</p>
        <p class="text-muted-foreground mt-3 text-sm leading-7">새 비밀번호로 다시 로그인해 주세요.</p>
      </div>
      <Button class="min-h-12 w-full" href="/login">로그인하기</Button>
    {:else}
      <form class="grid gap-5" onsubmit={handleSubmit} aria-busy={submitting}>
        <div class="grid gap-2">
          <Label for="pw">새 비밀번호</Label>
          <Input
            id="pw"
            class="min-h-11"
            type="password"
            autocomplete="new-password"
            bind:value={newPassword}
            required
            minlength={8}
            pattern={passwordPattern}
          />
        </div>
        <div class="grid gap-2">
          <Label for="confirm">새 비밀번호 확인</Label>
          <Input class="min-h-11" id="confirm" type="password" autocomplete="new-password" bind:value={confirm} required minlength={8} />
        </div>
        {#if errorMessage}
          <p role="alert" class="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm leading-6 text-destructive">{errorMessage}</p>
        {/if}
        {#if !token}<a href="/forgot" class="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4">새 재설정 메일 받기</a>{/if}
        <Button type="submit" class="min-h-12 w-full" disabled={submitting || !token}>
          {submitting ? "변경 중..." : "비밀번호 변경"}
        </Button>
      </form>
    {/if}
  </div>
</AuthShell>
