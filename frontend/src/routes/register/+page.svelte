<script lang="ts">
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import * as Select from "$lib/components/ui/select";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import AuthShell from "$lib/components/app/auth-shell.svelte";
  import { apiRequest, saveTokens } from "$lib/api/client";
  import { fetchCurrentUser, homePathFor } from "$lib/api/auth";
  import { PROFILE_TYPE_LABELS } from "$lib/domain/labels";

  const passwordPattern = "(?=.*[A-Za-z])(?=.*[0-9]).{8,}";

  let name = $state("");
  let email = $state("");
  let phone = $state("");
  let profileType = $state("ACTOR");
  let password = $state("");
  let confirm = $state("");
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
    if (password !== confirm) {
      errorMessage = "비밀번호가 서로 달라요. 다시 확인해 주세요.";
      return;
    }
    errorMessage = "";
    submitting = true;
    try {
      const result = await apiRequest<{ tokens: { accessToken: string; refreshToken: string } }>("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          email,
          password,
          name,
          phone: phone.trim() || undefined,
          profileType,
          agreements: { terms: true, privacy: true, marketing: false }
        })
      });
      saveTokens(result.tokens);
      if (inviteToken) {
        await apiRequest(`/invitations/${encodeURIComponent(inviteToken)}/accept`, { method: "POST" });
      }
      const me = await fetchCurrentUser({ fresh: true });
      await goto(homePathFor(me?.platformRole));
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "가입하지 못했습니다";
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head>
  <title>회원가입 — 아트브릿지</title>
</svelte:head>

<AuthShell>
  <div class="grid gap-6">
    <div>
      <h1 class="text-2xl font-bold tracking-tight">회원가입</h1>
      <p class="text-muted-foreground mt-1 text-sm">
        {inviteToken ? "가입하면 초대받은 공연에 바로 연결됩니다." : "가입 후 공연에 배정되면 내 작업이 열립니다."}
      </p>
    </div>

    <form class="grid gap-4" onsubmit={handleSubmit}>
      <div class="grid gap-2">
        <Label for="name">이름 <span class="text-destructive">*</span></Label>
        <Input id="name" autocomplete="name" bind:value={name} required maxlength={60} placeholder="실명을 적어주세요" />
      </div>
      <div class="grid gap-2">
        <Label for="email">이메일 <span class="text-destructive">*</span></Label>
        <Input id="email" type="email" autocomplete="email" bind:value={email} required placeholder="name@example.com" />
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <div class="grid gap-2">
          <Label for="phone">연락처</Label>
          <Input id="phone" autocomplete="tel" bind:value={phone} maxlength={40} placeholder="010-0000-0000" />
        </div>
        <div class="grid gap-2">
          <Label>활동 직군</Label>
          <Select.Root type="single" bind:value={profileType}>
            <Select.Trigger class="w-full">{PROFILE_TYPE_LABELS[profileType] ?? profileType}</Select.Trigger>
            <Select.Content>
              {#each Object.entries(PROFILE_TYPE_LABELS) as [value, label] (value)}
                <Select.Item {value} {label} />
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
      </div>
      <div class="grid gap-2">
        <Label for="password">비밀번호 <span class="text-destructive">*</span></Label>
        <Input
          id="password"
          type="password"
          autocomplete="new-password"
          bind:value={password}
          required
          minlength={8}
          pattern={passwordPattern}
        />
        <p class="text-muted-foreground text-xs">영문과 숫자를 포함해 8자 이상</p>
      </div>
      <div class="grid gap-2">
        <Label for="confirm">비밀번호 확인 <span class="text-destructive">*</span></Label>
        <Input id="confirm" type="password" autocomplete="new-password" bind:value={confirm} required minlength={8} />
      </div>

      {#if errorMessage}
        <p class="text-destructive text-sm">{errorMessage}</p>
      {/if}

      <Button type="submit" class="w-full" disabled={submitting}>
        {submitting ? "가입 중..." : "가입하기"}
      </Button>
    </form>

    <p class="text-muted-foreground text-center text-sm">
      이미 계정이 있나요?
      <a class="text-foreground font-medium underline-offset-4 hover:underline" href="/login">로그인</a>
    </p>
  </div>
</AuthShell>
