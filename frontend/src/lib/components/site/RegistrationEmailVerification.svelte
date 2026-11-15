<script lang="ts">
  import { onMount, tick } from "svelte";
  import { RegistrationEmailVerification, type RegistrationEmailProof, type RegistrationEmailState } from "$lib/api/registration";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";

  let { email = $bindable(""), disabled = false }: { email?: string; disabled?: boolean } = $props();
  let verification = $state.raw<RegistrationEmailVerification | null>(null);
  let verificationState = $state<RegistrationEmailState>({ phase: "idle", challengeExpiresAt: 0, proofExpiresAt: 0, retryAt: 0, error: "", stopped: false });
  let code = $state("");
  let now = $state(0);
  let emailInput = $state<HTMLInputElement | null>(null);
  let codeInput = $state<HTMLInputElement | null>(null);
  const pending = $derived(verificationState.phase === "sending" || verificationState.phase === "verifying");
  const verified = $derived(verificationState.phase === "verified");
  const retrySeconds = $derived(Math.max(0, Math.ceil((verificationState.retryAt - now) / 1000)));
  const remainingSeconds = $derived(Math.max(0, Math.ceil((verificationState.challengeExpiresAt - now) / 1000)));
  const remainingLabel = $derived(`${Math.floor(remainingSeconds / 60)}:${String(remainingSeconds % 60).padStart(2, "0")}`);

  onMount(() => {
    const current = new RegistrationEmailVerification((next) => { verificationState = next; if (next.phase === "idle" || next.phase === "verified") code = ""; });
    verification = current;
    current.setEmail(email);
    now = Date.now();
    const timer = setInterval(() => { now = Date.now(); current.tick(); }, 1000);
    return () => { clearInterval(timer); current.dispose(); };
  });

  $effect(() => { verification?.setEmail(email); });

  export function getProof(value: string): RegistrationEmailProof | null { return verification?.getProof(value) ?? null; }
  export function reset(message: string) { verification?.reset(message); }

  function changeEmail(event: Event) {
    const value = (event.currentTarget as HTMLInputElement).value;
    verification?.setEmail(value);
    code = "";
    email = value;
  }

  function editEmail() { verification?.reset(); emailInput?.focus(); }

  async function sendCode() {
    if (!emailInput?.reportValidity()) return;
    code = "";
    if (await verification?.send()) { await tick(); codeInput?.focus(); }
  }

  async function checkCode() {
    if (!codeInput?.reportValidity()) return;
    await verification?.verify(code);
  }

  function handleCodeKey(event: KeyboardEvent) {
    if (event.key === "Enter") { event.preventDefault(); if (!pending && !disabled) void checkCode(); }
  }
</script>

<div class="grid min-w-0 gap-2" data-registration-email-verification>
  <Label for="email">이메일 <span class="text-destructive">*</span></Label>
  <div class="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
    <Input id="email" bind:ref={emailInput} class="min-h-11" type="email" autocomplete="email" value={email} oninput={changeEmail} required maxlength={254} readonly={verified} disabled={disabled || verificationState.stopped} aria-describedby="registration-email-help" placeholder="name@example.com" />
    {#if verified}
      <Button type="button" variant="outline" class="min-h-11" disabled={disabled || verificationState.stopped} onclick={editEmail}>이메일 수정</Button>
    {:else}
      <Button type="button" variant="outline" class="min-h-11" disabled={disabled || pending || retrySeconds > 0 || verificationState.stopped || !verification} onclick={sendCode}>
        {verificationState.phase === "sending" ? "보내는 중…" : retrySeconds > 0 ? `${retrySeconds}초 후 재전송` : verificationState.phase === "code" ? "인증번호 다시 받기" : "인증번호 받기"}
      </Button>
    {/if}
  </div>
  <p id="registration-email-help" class="text-xs leading-6 text-muted-foreground">가입할 이메일로 인증번호를 보내요. 받은 메일에서 6자리 번호를 확인해 주세요.</p>

  {#if verificationState.phase === "code" || verificationState.phase === "verifying"}
    <div class="mt-1 grid gap-2 rounded-xl border bg-muted/20 p-3" aria-busy={verificationState.phase === "verifying"}>
      <div class="flex items-center justify-between gap-2">
        <Label for="registration-email-code">인증번호</Label>
        <span class="text-xs tabular-nums text-muted-foreground" aria-label={`인증번호 남은 시간 ${remainingLabel}`}>{remainingLabel}</span>
      </div>
      <div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <Input id="registration-email-code" bind:ref={codeInput} class="min-h-11 tracking-widest" type="text" inputmode="numeric" autocomplete="one-time-code" pattern={"[0-9]{6}"} maxlength={6} minlength={6} bind:value={code} required disabled={disabled || pending || verificationState.stopped} aria-describedby="registration-email-code-help" placeholder="6자리 숫자" onkeydown={handleCodeKey} />
        <Button type="button" class="min-h-11" disabled={disabled || pending || verificationState.stopped || !/^[0-9]{6}$/.test(code)} onclick={checkCode}>{verificationState.phase === "verifying" ? "확인하는 중…" : "인증번호 확인"}</Button>
      </div>
      <p id="registration-email-code-help" class="text-xs leading-6 text-muted-foreground">메일이 보이지 않으면 스팸함도 확인해 주세요. 번호는 10분 동안 사용할 수 있어요.</p>
    </div>
  {/if}
  {#if verified}
    <p role="status" class="text-sm font-medium text-emerald-700 dark:text-emerald-400">이메일을 확인했어요. 10분 안에 가입을 마쳐 주세요.</p>
  {:else if verificationState.phase === "code"}
    <p role="status" class="text-xs leading-6 text-muted-foreground">인증번호를 요청했어요. 메일을 확인해 주세요.</p>
  {/if}
  {#if verificationState.error}<p role="alert" class="text-sm leading-6 text-destructive">{verificationState.error}</p>{/if}
</div>
