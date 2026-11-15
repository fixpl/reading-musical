<script lang="ts">
  import { goto, invalidate } from "$app/navigation";
  import { page } from "$app/stores";
  import PolicyConsent from "$lib/components/site/PolicyConsent.svelte";
  import PolicyViewer from "$lib/components/site/PolicyViewer.svelte";
  import FieldHelp from "$lib/components/site/FieldHelp.svelte";
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import { displayPolicy, type LegalKind } from "$lib/api/site";
  import { onMount } from "svelte";
  import * as Select from "$lib/components/ui/select";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import AuthShell from "$lib/components/app/auth-shell.svelte";
  import RegistrationEmailVerification from "$lib/components/site/RegistrationEmailVerification.svelte";
  import { finishVerifiedRegistration, isRegistrationEmailProofError, registerVerifiedAccount, type RegistrationEmailProof } from "$lib/api/registration";
  import { captureSession, isCurrentSession, subscribeSession, type ClientSession } from "$lib/api/session";
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
  let sessionChanged = $state(false);
  let accountCreated = $state(false);
  let signedIn = $state(false);
  let recoveryHref = $state("/app");
  let emailVerification = $state<{ getProof: (email: string) => RegistrationEmailProof | null; reset: (message: string) => void } | null>(null);
  let active = false;
  let viewSession: ClientSession | null = null;
  let submission: AbortController | null = null;
  let inviteToken = $state("");
  let terms = $state(false);
  let privacy = $state(false);
  let age14 = $state(false);
  let optionalProfile = $state(false);
  let marketingPrivacy = $state(false);
  let marketing = $state(false);
  let requiredOpen = $state(false);
  let optionalOpen = $state(false);
  const requiredCount = $derived(Number(age14) + Number(terms) + Number(privacy));
  const optionalCount = $derived(Number(optionalProfile) + Number(marketingPrivacy) + Number(marketing));
  const site = $derived($page.data.site);
  const registrationReady = $derived(site?.registration?.ready.signup ?? site?.ready.signup ?? false);
  const contactReady = $derived(site?.registration?.ready.optionalProfile ?? site?.ready.optionalProfile ?? false);
  const registrationPolicies = $derived(site?.registration?.policies ?? site?.policies ?? []);
  const policy = (kind: LegalKind) => registrationPolicies.find((item) => item.kind === kind);
  const documentFor = (kind: LegalKind) => policy(kind) ?? displayPolicy(site, kind);
  const phoneHelp = "연락처는 선택 항목이에요. 입력하지 않아도 가입할 수 있어요. 입력하는 경우 아래 선택 동의에서 연락처 수집·이용에 동의해 주세요.";
  function setRequired(event: Event) {
    if (!registrationReady) return;
    terms = privacy = age14 = (event.currentTarget as HTMLInputElement).checked;
  }
  let policyFingerprint = "";
  $effect(() => {
    const fingerprint = registrationPolicies.map((item) => item.id).sort().join(",");
    if (fingerprint !== policyFingerprint) {
      policyFingerprint = fingerprint;
      terms = privacy = age14 = optionalProfile = marketingPrivacy = marketing = false;
    }
  });
  $effect(() => { if (!marketingPrivacy) marketing = false; });

  onMount(() => {
    active = true;
    viewSession = captureSession();
    const params = new URLSearchParams(window.location.search);
    inviteToken = params.get("invite") ?? "";
    email = params.get("email") ?? email;
    signedIn = Boolean(viewSession.owner);
    recoveryHref = inviteToken ? `/invite/${encodeURIComponent(inviteToken)}` : "/app";
    const unsubscribe = subscribeSession(() => {
      sessionChanged = true;
      submission?.abort();
      name = email = phone = "";
      password = confirm = "";
      errorMessage = "로그인 상태가 바뀌었어요. 이 화면을 새로 열어 가입해 주세요.";
    });
    return () => { active = false; submission?.abort(); unsubscribe(); password = confirm = ""; };
  });

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (submitting || accountCreated || signedIn || !active || !viewSession || !isCurrentSession(viewSession, true)) return;
    const proof = emailVerification?.getProof(email);
    if (!proof) {
      errorMessage = "가입할 이메일의 인증번호를 먼저 확인해 주세요.";
      return;
    }
    if (!registrationReady || !terms || !privacy || !age14) {
      requiredOpen = true;
      errorMessage = registrationReady ? "필수 약관과 만 14세 이상 여부를 확인해 주세요." : "가입에 필요한 문서를 불러오지 못했어요. 다시 확인해 주세요.";
      return;
    }
    if (phone.trim() && !optionalProfile) {
      optionalOpen = true;
      errorMessage = "연락처를 입력하려면 선택 개인정보 수집에 동의하거나 연락처를 비워 주세요.";
      return;
    }
    if (password !== confirm) {
      errorMessage = "비밀번호가 서로 달라요. 다시 확인해 주세요.";
      return;
    }
    errorMessage = "";
    submitting = true;
    const startSession = viewSession;
    const inviteAtStart = inviteToken;
    const request = new AbortController();
    submission = request;
    let registeredSession: ClientSession | null = null;
    try {
      registeredSession = await registerVerifiedAccount({
          email,
          emailVerificationToken: proof.token,
          password,
          name,
          phone: phone.trim() || undefined,
          profileType,
          agreements: {
            terms, privacy, age14, optionalProfile, marketingPrivacy, marketing,
            termsDocumentId: policy("TERMS")?.id,
            privacyDocumentId: policy("SIGNUP_PRIVACY")?.id,
            optionalProfileDocumentId: policy("OPTIONAL_PROFILE")?.id,
            marketingPrivacyDocumentId: policy("MARKETING_PRIVACY")?.id,
            marketingEmailDocumentId: policy("MARKETING_EMAIL")?.id
          }
      }, startSession, request.signal);
      if (!isCurrentSession(registeredSession, true)) return;
      if (active) {
        viewSession = registeredSession;
        sessionChanged = false;
        errorMessage = "";
        accountCreated = true;
        password = confirm = "";
      }
      const destination = await finishVerifiedRegistration(registeredSession, inviteAtStart);
      if (!isCurrentSession(registeredSession)) return;
      if (active) recoveryHref = destination;
      await goto(destination);
    } catch (error) {
      if (!active || !isCurrentSession(registeredSession ?? startSession)) return;
      if (accountCreated) {
        errorMessage = "가입은 완료됐어요. 아래 버튼으로 계속해 주세요.";
        return;
      }
      errorMessage = error instanceof Error ? error.message : "가입하지 못했어요. 입력 내용을 확인해 주세요.";
      if (isRegistrationEmailProofError(error)) emailVerification?.reset("이메일 인증 시간이 지났거나 다시 확인이 필요해요. 새 인증번호를 받아 주세요.");
      if (error && typeof error === "object" && "code" in error && error.code === "POLICY_CHANGED") {
        terms = privacy = optionalProfile = marketingPrivacy = marketing = false;
        await invalidate("site:public");
      }
    } finally {
      if (active && isCurrentSession(registeredSession ?? startSession)) { submitting = false; submission = null; }
    }
  }
</script>

<svelte:head>
  <title>회원가입 — {site?.info.siteName || "아트브릿지"}</title>
</svelte:head>

<AuthShell>
  <div class="grid gap-6">
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">회원가입</h1>
      <p class="text-muted-foreground mt-3 text-sm leading-7">
        {inviteToken ? "초대받은 이메일로 가입하면 해당 공연에 참여할 수 있어요." : "운영팀의 배정이나 초대로 공연에 참여해요. 가입 후 프로필과 가능한 일정을 남겨 주세요."}
      </p>
    </div>

    {#if signedIn}
      <p role="status" class="text-sm leading-6">로그인되어 있어요. {inviteToken ? "초대 화면에서 공연 참여를 확인해 주세요." : "내 공연에서 일정을 확인해 주세요."}</p>
      <Button href={recoveryHref} class="min-h-12 w-full">{inviteToken ? "초대 확인하기" : "내 공연으로 이동"}</Button>
    {:else}
    <form class="grid gap-5" onsubmit={handleSubmit} aria-busy={submitting}>
      <div class="grid gap-2">
        <Label for="name">이름 <span class="text-destructive">*</span></Label>
        <Input id="name" class="min-h-11" autocomplete="name" bind:value={name} required maxlength={60} placeholder="실명을 입력해 주세요" />
      </div>
      <RegistrationEmailVerification bind:this={emailVerification} bind:email disabled={submitting || !registrationReady || sessionChanged || accountCreated} />
      <div class="grid items-start gap-4 sm:grid-cols-2" data-registration-profile-fields>
        <div class="flex min-w-0 flex-col gap-2">
          <div class="flex h-7 items-center gap-1">
            <Label for="phone">연락처 <span class="ml-1 text-xs font-normal text-muted-foreground">선택</span></Label>
            <FieldHelp id="phone-help" title="연락처 입력 안내" text={phoneHelp} />
          </div>
          <Input id="phone" class="h-10 w-full" type="tel" autocomplete="tel" aria-describedby="phone-help-description" bind:value={phone} maxlength={40} disabled={submitting || !contactReady} placeholder="선택 입력" />
        </div>
        <div class="flex min-w-0 flex-col gap-2">
          <div class="flex h-7 items-center gap-1">
            <Label for="profile-type">활동 직군</Label>
            <FieldHelp id="profile-type-help" title="활동 직군 선택 안내" text="주로 참여할 활동 직군을 선택해 주세요. 배우·스태프 등 현재 활동에 가까운 항목을 골라 주세요. 실제 공연에서 맡는 역할은 공연별 배정에 따라 정해져요." />
          </div>
          <Select.Root type="single" bind:value={profileType}>
            <Select.Trigger id="profile-type" aria-describedby="profile-type-help-description" class="h-10 w-full data-[size=default]:h-10">{PROFILE_TYPE_LABELS[profileType] ?? profileType}</Select.Trigger>
            <Select.Content>
              {#each Object.entries(PROFILE_TYPE_LABELS) as [value, label] (value)}
                <Select.Item {value} {label} />
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
      </div>
      <div class="grid gap-2">
        <div class="flex h-7 items-center gap-1">
          <Label for="password">비밀번호 <span class="text-destructive">*</span></Label>
          <FieldHelp id="password-help" title="비밀번호 설정 안내" text="영문과 숫자를 모두 포함해 8자 이상 입력해 주세요. 아래 비밀번호 확인란에도 같은 비밀번호를 입력해 주세요." />
        </div>
        <Input
          id="password"
          class="min-h-11"
          type="password"
          autocomplete="new-password"
          aria-describedby="password-help-description"
          placeholder="영문·숫자 포함 8자 이상"
          bind:value={password}
          required
          minlength={8}
          pattern={passwordPattern}
        />
      </div>
      <div class="grid gap-2">
        <Label for="confirm">비밀번호 확인 <span class="text-destructive">*</span></Label>
        <Input id="confirm" class="min-h-11" type="password" autocomplete="new-password" bind:value={confirm} required minlength={8} />
      </div>

      <fieldset class="mt-1 min-w-0 space-y-2 border-0 p-0" disabled={submitting} data-registration-consents>
        <legend class="mb-1 p-0 text-sm font-semibold">약관 동의</legend>
        <section class="rounded-xl bg-muted/25 px-3 py-2" aria-label="필수 동의">
          <div class="flex min-h-11 items-center gap-2">
            <label class="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-sm font-semibold">
              <input id="required-agreements" type="checkbox" class="size-4 shrink-0" checked={requiredCount === 3} indeterminate={requiredCount > 0 && requiredCount < 3} onchange={setRequired} required disabled={!registrationReady} aria-describedby="required-agreement-summary" />
              <span>필수 항목 모두 동의 <span class="ml-1 text-xs font-normal text-muted-foreground">{requiredCount}/3</span></span>
            </label>
            <button id="required-agreement-toggle" type="button" aria-expanded={requiredOpen} aria-controls="required-agreement-details" aria-label={`필수 동의 ${requiredOpen ? "닫기" : "열기"}`} class="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" onclick={() => requiredOpen = !requiredOpen}>{requiredOpen ? "닫기" : "열기"}<ChevronDownIcon aria-hidden="true" class={`size-3.5 transition-transform motion-reduce:transition-none ${requiredOpen ? "rotate-180" : ""}`} /></button>
          </div>
          <p id="required-agreement-summary" class="ml-6 text-xs leading-5 text-muted-foreground">만 14세 이상 · 이용약관 · 개인정보 수집·이용</p>
          <div id="required-agreement-details" hidden={!requiredOpen}>
            {#if requiredOpen}
              <div class="mt-2 space-y-1 px-1">
                <label class="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm"><input type="checkbox" class="size-4 shrink-0" bind:checked={age14} required disabled={!registrationReady} /><span><strong>[필수]</strong> 만 14세 이상이에요.</span></label>
                <PolicyConsent doc={documentFor("TERMS")} label="이용약관 동의" bind:checked={terms} required />
                <PolicyConsent doc={documentFor("SIGNUP_PRIVACY")} label="개인정보 수집·이용 동의" bind:checked={privacy} required />
              </div>
            {/if}
          </div>
        </section>
        <section class="rounded-xl bg-muted/25 px-3 py-1" aria-label="선택 동의">
          <div class="flex min-h-11 items-center justify-between gap-3 text-sm">
            <span>선택 동의 <span class="ml-1 text-xs text-muted-foreground">{optionalCount ? `${optionalCount}개 선택` : "동의하지 않아도 가입 가능"}</span></span>
            <button id="optional-agreement-toggle" type="button" aria-expanded={optionalOpen} aria-controls="optional-agreement-details" aria-label={`선택 동의 ${optionalOpen ? "닫기" : "열기"}`} class="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" onclick={() => optionalOpen = !optionalOpen}>{optionalOpen ? "닫기" : "열기"}<ChevronDownIcon aria-hidden="true" class={`size-3.5 transition-transform motion-reduce:transition-none ${optionalOpen ? "rotate-180" : ""}`} /></button>
          </div>
          <div id="optional-agreement-details" hidden={!optionalOpen}>
            {#if optionalOpen}
              <div class="space-y-1 px-1">
                {#if documentFor("OPTIONAL_PROFILE")}<PolicyConsent doc={documentFor("OPTIONAL_PROFILE")} label="연락처 수집·이용" bind:checked={optionalProfile} />{/if}
                <PolicyConsent doc={documentFor("MARKETING_PRIVACY")} label="마케팅 목적 개인정보 이용" bind:checked={marketingPrivacy} />
                <PolicyConsent doc={documentFor("MARKETING_EMAIL")} label="이메일 광고성 정보 수신" bind:checked={marketing} disabled={!marketingPrivacy} />
              </div>
              <p class="py-2 text-xs leading-6 text-muted-foreground">연락처를 입력할 때만 해당 수집 동의가 필요해요. 광고 수신은 서비스 알림과 별개이며 언제든지 철회할 수 있어요.</p>
            {/if}
          </div>
        </section>
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
          <PolicyViewer doc={documentFor("PRIVACY_POLICY")} label="개인정보 처리방침" className="px-0 font-semibold" />
        </div>
        {#if !registrationReady}
          <p role="status" class="text-xs leading-6 text-muted-foreground">현재 회원가입을 이용할 수 없어요. 잠시 후 다시 시도해 주세요. <button type="button" class="underline" onclick={() => invalidate("site:public")}>다시 확인</button></p>
        {/if}
      </fieldset>
      {#if errorMessage}
        <p role="alert" class="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm leading-6 text-destructive">{errorMessage}</p>
      {/if}

      {#if sessionChanged}
        <Button href={`${$page.url.pathname}${$page.url.search}`} variant="outline" class="min-h-12 w-full">가입 화면 다시 열기</Button>
      {:else if accountCreated}
        <p role="status" class="text-sm leading-6">회원가입을 완료했어요.</p>
        <Button href={recoveryHref} class="min-h-12 w-full">{inviteToken ? "초대 확인하기" : "내 공연으로 이동"}</Button>
      {:else}
        <Button type="submit" class="min-h-12 w-full" disabled={submitting || !registrationReady}>
          {submitting ? "가입 중…" : "가입하기"}
        </Button>
      {/if}
    </form>
    {/if}

    <p class="text-muted-foreground text-center text-sm">
      이미 계정이 있나요?
      <a class="text-foreground inline-flex min-h-11 items-center font-medium underline underline-offset-4" href="/login">로그인</a>
    </p>
  </div>
</AuthShell>
