<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { page } from "$app/stores";
  import { invalidate } from "$app/navigation";
  import PerformanceCreditSettings from "$lib/components/showcase/PerformanceCreditSettings.svelte";
  import PolicyConsent from "$lib/components/site/PolicyConsent.svelte";
  import { toast } from "svelte-sonner";
  import * as Card from "$lib/components/ui/card";
  import * as Select from "$lib/components/ui/select";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { ErrorPanel } from "$lib/components/ui/error-panel";
  import { PageHeader } from "$lib/components/ui/page-header";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import { apiRequest, saveTokens, uploadSignedObject, type AuthTokens, type SignedObjectRequest } from "$lib/api/client";
  import { fileSha256Checksum } from "$lib/api/checksum";
  import { fetchCurrentUser } from "$lib/api/auth";
  import { assertCurrentSession, captureSession, isCurrentSession, type ClientSession } from "$lib/api/session";
  import { PROFILE_TYPE_LABELS } from "$lib/domain/labels";

  type Me = {
    id: string;
    email: string;
    name: string;
    phone: string | null;
    birthDate: string | null;
    address: string | null;
    profileType: string;
    profileComplete: boolean;
    profileDetails?: Record<string, unknown> | null;
    photoAssetId?: string | null;
  };

  type AssetCreateResponse = {
    asset: { id: string };
    upload: SignedObjectRequest;
  };

  let me = $state<Me | null>(null);
  let creditProfileRevision = $state(0);
  let loading = $state(true);
  let saving = $state(false);
  let loadError = $state("");
  let saveError = $state("");
  let saveMessage = $state("");
  let photoError = $state("");
  let passwordError = $state("");
  let passwordMessage = $state("");
  let profilePrivacyConsent = $state(false);
  const profilePolicy = $derived($page.data.site?.policies.find((item) => item.kind === "PROFILE_PRIVACY"));
  let seenPolicyId = "";
  $effect(() => {
    const id = profilePolicy?.id || "";
    if (seenPolicyId !== id) { seenPolicyId = id; profilePrivacyConsent = false; }
  });

  let name = $state("");
  let phone = $state("");
  let birthDate = $state("");
  let address = $state("");
  let profileType = $state("ACTOR");
  let voiceRange = $state("");
  let specialtiesText = $state("");
  const profileSession = captureSession();
  let disposed = false;
  const active = (session = profileSession) => !disposed && isCurrentSession(profileSession) && isCurrentSession(session);
  function assertActive(session: ClientSession) {
    assertCurrentSession(profileSession);
    assertCurrentSession(session);
    if (disposed) throw new DOMException("닫힌 화면의 요청은 계속하지 않는다", "AbortError");
  }

  // 프로필 사진
  let photoAssetId = $state("");
  let photoFile = $state<File | null>(null);
  let photoPreviewUrl = $state("");
  let localPreview = "";
  onDestroy(() => { disposed = true; if (localPreview) URL.revokeObjectURL(localPreview); });

  const addsOptionalData = $derived.by(() => {
    if (!me) return false;
    const details = me.profileDetails ?? {};
    const oldSpecialties = Array.isArray(details.specialties) ? details.specialties : [];
    return Boolean(photoFile || (photoAssetId && photoAssetId !== me.photoAssetId)
      || (phone.trim() && phone.trim() !== (me.phone || "").trim())
      || (birthDate && birthDate !== me.birthDate?.slice(0, 10))
      || (address.trim() && address.trim() !== (me.address || "").trim())
      || (voiceRange.trim() && voiceRange.trim() !== details.voiceRange)
      || specialtiesText.split(",").map((item) => item.trim()).filter(Boolean).some((item) => !oldSpecialties.includes(item)));
  });

  function clearPhotoLink() {
    if (localPreview) URL.revokeObjectURL(localPreview);
    photoError = "";
    localPreview = ""; photoFile = null; photoAssetId = ""; photoPreviewUrl = "";
  }

  onMount(loadProfile);

  async function loadProfile() {
    if (!active()) return;
    loading = true; loadError = "";
    try {
      const result = await apiRequest<Me>("/auth/me", { session: profileSession });
      if (!active()) return;
      me = result;
      name = me.name;
      phone = me.phone ?? "";
      birthDate = me.birthDate ? me.birthDate.slice(0, 10) : "";
      address = me.address ?? "";
      profileType = me.profileType;
      const details = (me.profileDetails ?? {}) as Record<string, unknown>;
      voiceRange = typeof details.voiceRange === "string" ? details.voiceRange : "";
      specialtiesText = Array.isArray(details.specialties) ? details.specialties.join(", ") : "";
      photoAssetId = me.photoAssetId ?? "";
      if (photoAssetId) void loadPhoto(photoAssetId);
    } catch (error) {
      if (active()) loadError = error instanceof Error ? error.message : "프로필을 불러오지 못했어요.";
    } finally {
      if (active()) loading = false;
    }
  }

  async function loadPhoto(assetId: string) {
    photoError = "";
    try {
      const download = await apiRequest<{ url: string }>(`/assets/${assetId}/url`, { session: profileSession });
      if (active() && !photoFile && photoAssetId === assetId) photoPreviewUrl = download.url;
    } catch {
      if (active() && !photoFile && photoAssetId === assetId) photoError = "사진 미리보기를 불러오지 못했어요. 저장된 사진은 유지돼요.";
    }
  }

  function onPhotoChange(event: Event) {
    if (!active()) return;
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(imageMime(file)) || file.size > 10 * 1024 * 1024) {
      toast.error("10MB 이하의 PNG·JPEG·WebP 사진을 선택해 주세요."); input.value = ""; return;
    }
    photoFile = file;
    if (localPreview) URL.revokeObjectURL(localPreview);
    if (file) {
      localPreview = URL.createObjectURL(file);
      photoPreviewUrl = localPreview;
    }
    input.value = "";
  }

  function imageMime(file: File) {
    if (file.type && file.type !== "application/octet-stream") return file.type;
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "png") return "image/png";
    if (ext === "webp") return "image/webp";
    return "image/jpeg";
  }

  async function uploadPhotoIfNeeded(session: ClientSession, documentId?: string): Promise<string | null> {
    assertActive(session);
    if (!photoFile) return photoAssetId.trim() || null;
    const file = photoFile;
    const mimeType = imageMime(file);
    const checksum = await fileSha256Checksum(file);
    // checksum 계산 중 계정이 바뀌면 사진을 새 계정으로 예약하지 않는다.
    assertActive(session);
    const created = await apiRequest<AssetCreateResponse>("/assets", {
      method: "POST",
      session,
      body: JSON.stringify({
        purpose: "PROFILE_PHOTO",
        profilePrivacyConsent,
        profilePrivacyDocumentId: documentId,
        fileName: file.name,
        mimeType,
        size: file.size,
        checksum
      })
    });
    assertActive(session);
    await uploadSignedObject(created.upload, file, mimeType, { session });
    assertActive(session);
    // 프로필 저장만 실패한 경우 같은 계정에서 완료된 업로드를 재사용한다.
    photoAssetId = created.asset.id; photoFile = null;
    return created.asset.id;
  }

  function buildDetails(): Record<string, unknown> | null {
    // 기존에 저장된 다른 항목은 그대로 두고 이 화면의 값만 덮어쓴다.
    const details: Record<string, unknown> = { ...((me?.profileDetails ?? {}) as Record<string, unknown>) };
    const specialties = specialtiesText
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (specialties.length > 0) details.specialties = specialties;
    else delete details.specialties;
    if (voiceRange.trim()) details.voiceRange = voiceRange.trim();
    else delete details.voiceRange;
    return Object.keys(details).length > 0 ? details : null;
  }

  // 비밀번호 변경
  let currentPassword = $state("");
  let newPassword = $state("");
  let confirmPassword = $state("");
  let changingPassword = $state(false);

  const passwordPolicyOk = $derived(/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(newPassword));
  const passwordMismatch = $derived(confirmPassword.length > 0 && newPassword !== confirmPassword);

  async function changePassword(event: SubmitEvent) {
    event.preventDefault();
    const session = captureSession();
    if (changingPassword || !active(session)) return;
    passwordError = ""; passwordMessage = "";
    if (!passwordPolicyOk) {
      passwordError = "비밀번호는 8자 이상이며 영문과 숫자를 모두 포함해야 해요.";
      toast.error(passwordError);
      return;
    }
    if (newPassword !== confirmPassword) {
      passwordError = "새 비밀번호 확인이 일치하지 않아요.";
      toast.error(passwordError);
      return;
    }
    changingPassword = true;
    try {
      const result = await apiRequest<{ tokens: AuthTokens }>("/auth/password/change", {
        method: "POST",
        session,
        body: JSON.stringify({ currentPassword, newPassword })
      });
      if (!active(session)) return;
      if (!saveTokens(result.tokens, captureSession())) throw new Error("로그인 정보를 확인하지 못했어요. 다시 로그인해 주세요.");
      currentPassword = newPassword = confirmPassword = "";
      passwordMessage = "비밀번호를 변경했어요. 다른 기기에서는 다시 로그인해 주세요.";
      toast.success("비밀번호를 변경했어요.");
    } catch (error) {
      if (!active(session)) return;
      passwordError = error instanceof Error ? error.message : "비밀번호를 변경하지 못했어요.";
      toast.error(passwordError);
    } finally {
      if (active(session)) changingPassword = false;
    }
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    const session = captureSession();
    if (saving || !me || !active(session)) return;
    saveError = ""; saveMessage = "";
    if (addsOptionalData && (!profilePolicy || !profilePrivacyConsent)) {
      saveError = "새 선택 프로필 정보를 저장하려면 개인정보 안내에 동의해 주세요. 기존 정보를 지우는 경우에는 동의하지 않아도 돼요.";
      toast.error(saveError);
      return;
    }
    const documentId = profilePolicy?.id;
    saving = true;
    try {
      const nextPhotoAssetId = await uploadPhotoIfNeeded(session, documentId);
      assertActive(session);
      const updated = await apiRequest<Me>("/users/me/profile", {
        method: "PATCH",
        session,
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim() || null,
          birthDate: birthDate || null,
          address: address.trim() || null,
          profilePrivacyConsent,
          profilePrivacyDocumentId: documentId,
          profileType,
          profileDetails: buildDetails(),
          photoAssetId: nextPhotoAssetId
        })
      });
      if (!active(session)) return;
      me = updated;
      creditProfileRevision += 1;
      photoAssetId = me.photoAssetId ?? "";
      photoFile = null;
      profilePrivacyConsent = false;
      saveMessage = "프로필을 저장했어요.";
      toast.success(saveMessage);
      // 프로필 저장은 끝났으므로 이름 표시 갱신 실패를 저장 실패로 안내하지 않는다.
      void fetchCurrentUser({ fresh: true }).catch(() => {});
    } catch (error) {
      if (!active(session)) return;
      saveError = error instanceof Error ? error.message : "프로필을 저장하지 못했어요. 입력한 내용은 남아 있어요.";
      toast.error(saveError);
      if (error && typeof error === "object" && "code" in error && error.code === "POLICY_CHANGED") {
        profilePrivacyConsent = false;
        await invalidate("site:public");
      }
    } finally {
      if (active(session)) saving = false;
    }
  }
</script>

<svelte:head>
  <title>프로필 — {$page.data.site?.info.siteName || "아트브릿지"}</title>
</svelte:head>

<div class="mx-auto w-full max-w-xl">
  <PageHeader title="내 프로필" description="이름과 활동 분야를 확인하고, 필요한 선택 정보를 저장해요." />
  {#if loading}
    <div class="space-y-3 py-2">
      <Skeleton class="h-80 w-full rounded-2xl" />
    </div>
  {:else if loadError}
    <ErrorPanel title="프로필을 불러오지 못했어요" message={loadError} onRetry={loadProfile} />
  {:else if me}
    <div class="mb-4 flex flex-wrap items-center gap-3"><p class="min-w-0 break-all text-sm text-muted-foreground">{me.email}</p><Badge variant={me.profileComplete ? "secondary" : "outline"}>{me.profileComplete ? "프로필 완성" : "작성 중"}</Badge></div>

    <Card.Root class="mt-2">
      <Card.Content>
        <form class="grid gap-5" onsubmit={save} aria-busy={saving}>
          <fieldset class="grid gap-5" disabled={saving}>
          <p class="text-xs leading-6 text-muted-foreground">연락처·생년월일·지역·전문 분야·사진은 선택 항목이에요. 필요한 항목만 입력해 주세요. 연락처·생년월일·지역은 비운 후 저장하면 프로필에서 제거돼요.</p>
          <!-- 사진 -->
          <div class="flex items-center gap-4">
            {#if photoPreviewUrl}
              <img src={photoPreviewUrl} alt="프로필 사진" class="size-16 shrink-0 rounded-full border object-cover" />
            {:else}
              <div
                class="bg-primary/15 text-primary flex size-16 shrink-0 items-center justify-center rounded-full text-lg font-bold"
              >
                {name.trim().slice(0, 2) || "?"}
              </div>
            {/if}
            <div class="min-w-0">
              <p class="font-semibold">프로필 사진 <span class="text-xs font-normal text-muted-foreground">선택</span></p>
              <p class="text-muted-foreground text-xs">공연 참여자 목록에 함께 보여요.</p>
            </div>
            <label
              class="border-input hover:bg-accent focus-within:outline-2 focus-within:outline-ring ms-auto inline-flex min-h-11 shrink-0 cursor-pointer items-center rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors"
            >
              사진 선택
              <input type="file" accept="image/png,image/jpeg,image/webp" class="sr-only" onchange={onPhotoChange} />
            </label>
          </div>

          {#if photoError}<div role="alert" class="text-sm text-destructive"><p>{photoError}</p><Button type="button" variant="outline" class="mt-2 min-h-11" onclick={() => loadPhoto(photoAssetId)}>사진 다시 불러오기</Button></div>{/if}
          {#if photoAssetId || photoFile}<div class="flex items-center gap-3"><Button type="button" size="sm" class="min-h-11" variant="outline" onclick={clearPhotoLink}>사진 연결 해제</Button><p class="text-xs text-muted-foreground">저장하면 프로필 표시가 해제돼요. 원본 파일 파기 요청은 운영팀 문의를 이용해 주세요.</p></div>{/if}

          <div class="grid gap-2">
            <Label for="name">이름</Label>
            <Input class="min-h-11" id="name" bind:value={name} required maxlength={60} />
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            <div class="grid gap-2">
              <Label for="phone">연락처</Label>
              <Input class="min-h-11" id="phone" bind:value={phone} maxlength={40} placeholder="010-0000-0000" />
            </div>
            <div class="grid gap-2">
              <Label for="profile-type">기본 활동 직군</Label>
              <Select.Root type="single" bind:value={profileType}>
                <Select.Trigger id="profile-type" class="min-h-11 w-full">
                  {PROFILE_TYPE_LABELS[profileType] ?? profileType}
                </Select.Trigger>
                <Select.Content>
                  {#each Object.entries(PROFILE_TYPE_LABELS) as [value, label] (value)}
                    <Select.Item {value} {label} />
                  {/each}
                </Select.Content>
              </Select.Root>
            </div>
            <div class="grid gap-2">
              <Label for="birthDate">생년월일</Label>
              <Input class="min-h-11" id="birthDate" type="date" bind:value={birthDate} />
            </div>
            <div class="grid gap-2">
              <Label for="address">활동 지역</Label>
              <Input class="min-h-11" id="address" bind:value={address} maxlength={120} placeholder="예: 서울 마포구" />
            </div>
          </div>

          <!-- 직군 상세 -->
          <div class="grid gap-4 sm:grid-cols-2">
            <div class="grid gap-2">
              <Label for="specialties">전문 분야</Label>
              <Input class="min-h-11" id="specialties" bind:value={specialtiesText} maxlength={200} placeholder="예: 합창, 안무 (쉼표로 구분)" />
            </div>
            <div class="grid gap-2">
              <Label for="voiceRange">음역·악기</Label>
              <Input class="min-h-11" id="voiceRange" bind:value={voiceRange} maxlength={60} placeholder="예: 소프라노 A3-C5, 엘렉톤" />
            </div>
          </div>

          <PolicyConsent doc={profilePolicy} label="선택 프로필 개인정보 수집·이용에 동의해요." bind:checked={profilePrivacyConsent} />
          <p class="text-xs leading-6 text-muted-foreground">새 선택정보·사진을 추가하거나 변경할 때 확인해요. 기존 정보를 지우거나 이름·활동 직군만 변경할 때에는 동의하지 않아도 저장할 수 있어요.</p>
          {#if !profilePolicy}<p class="text-xs leading-6">선택 프로필 안내가 준비되지 않아 새 선택정보·사진을 저장할 수 없어요. <button type="button" class="inline-flex min-h-11 items-center underline" onclick={() => invalidate("site:public")}>다시 확인</button></p>{/if}
          <div class="flex flex-wrap gap-4 text-sm"><a href="/app/privacy" class="inline-flex min-h-11 items-center underline underline-offset-4">마케팅 수신 동의 관리</a><a href="/support" class="inline-flex min-h-11 items-center underline underline-offset-4">개인정보 문의·권리 행사</a></div>
          {#if saveError}<p role="alert" class="text-sm leading-6 text-destructive">{saveError}</p>{/if}
          {#if saveMessage}<p role="status" class="text-sm leading-6">{saveMessage}</p>{/if}
          <div class="flex justify-end">
            <Button type="submit" class="min-h-11" disabled={saving || !name.trim()}>
              {saving ? "저장 중..." : "프로필 저장"}
            </Button>
          </div>
          </fieldset>
        </form>
      </Card.Content>
    </Card.Root>

    <PerformanceCreditSettings profileRevision={creditProfileRevision} />

    <Card.Root class="mt-4">
      <Card.Header>
        <Card.Title>비밀번호 변경</Card.Title>
      </Card.Header>
      <Card.Content>
        <form class="grid gap-4" onsubmit={changePassword} aria-busy={changingPassword}>
          <div class="grid gap-2">
            <Label for="currentPassword">현재 비밀번호</Label>
            <Input class="min-h-11" id="currentPassword" type="password" autocomplete="current-password" bind:value={currentPassword} required />
          </div>
          <div class="grid gap-2">
            <Label for="newPassword">새 비밀번호</Label>
            <Input class="min-h-11" id="newPassword" type="password" autocomplete="new-password" bind:value={newPassword} required minlength={8} />
            <p class="text-muted-foreground text-xs">8자 이상, 영문과 숫자를 모두 포함해 주세요.</p>
          </div>
          <div class="grid gap-2">
            <Label for="confirmPassword">새 비밀번호 확인</Label>
            <Input class="min-h-11" id="confirmPassword" type="password" autocomplete="new-password" bind:value={confirmPassword} required />
            {#if passwordMismatch}
              <p class="text-destructive text-xs">새 비밀번호가 일치하지 않아요.</p>
            {/if}
          </div>
          {#if passwordError}<p role="alert" class="text-sm leading-6 text-destructive">{passwordError}</p>{/if}
          {#if passwordMessage}<p role="status" class="text-sm leading-6">{passwordMessage}</p>{/if}
          <div class="flex justify-end">
            <Button type="submit" class="min-h-11" disabled={changingPassword || !currentPassword || !passwordPolicyOk || newPassword !== confirmPassword}>
              {changingPassword ? "변경 중..." : "비밀번호 변경"}
            </Button>
          </div>
        </form>
      </Card.Content>
    </Card.Root>
  {/if}
</div>
