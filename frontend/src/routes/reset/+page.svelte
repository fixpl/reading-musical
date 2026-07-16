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
      errorMessage = "재설정 링크가 올바르지 않습니다. 메일의 링크로 다시 들어와 주세요.";
    }
  });

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (!token) return;
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
      errorMessage = error instanceof Error ? error.message : "비밀번호를 변경하지 못했습니다";
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
      <h1 class="text-2xl font-bold tracking-tight">비밀번호 재설정</h1>
      <p class="text-muted-foreground mt-1 text-sm">새 비밀번호는 영문과 숫자를 포함해 8자 이상이어야 합니다.</p>
    </div>

    {#if done}
      <div class="bg-card rounded-2xl border px-5 py-6 text-center">
        <p class="font-semibold">비밀번호를 변경했습니다</p>
        <p class="text-muted-foreground mt-1 text-sm">새 비밀번호로 다시 로그인해 주세요.</p>
      </div>
      <Button class="w-full" href="/login">로그인하기</Button>
    {:else}
      <form class="grid gap-4" onsubmit={handleSubmit}>
        <div class="grid gap-2">
          <Label for="pw">새 비밀번호</Label>
          <Input
            id="pw"
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
          <Input id="confirm" type="password" autocomplete="new-password" bind:value={confirm} required minlength={8} />
        </div>
        {#if errorMessage}
          <p class="text-destructive text-sm">{errorMessage}</p>
        {/if}
        <Button type="submit" class="w-full" disabled={submitting || !token}>
          {submitting ? "변경 중..." : "비밀번호 변경"}
        </Button>
      </form>
    {/if}
  </div>
</AuthShell>
