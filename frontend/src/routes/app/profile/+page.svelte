<script lang="ts">
  import { onMount } from "svelte";
  import { toast } from "svelte-sonner";
  import * as Card from "$lib/components/ui/card";
  import * as Select from "$lib/components/ui/select";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import { apiRequest, uploadSignedObject, type SignedObjectRequest } from "$lib/api/client";
  import { fileSha256Checksum } from "$lib/api/checksum";
  import { fetchCurrentUser } from "$lib/api/auth";
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
  let loading = $state(true);
  let saving = $state(false);

  let name = $state("");
  let phone = $state("");
  let birthDate = $state("");
  let address = $state("");
  let profileType = $state("ACTOR");
  let voiceRange = $state("");
  let specialtiesText = $state("");

  // 프로필 사진
  let photoAssetId = $state("");
  let photoFile = $state<File | null>(null);
  let photoPreviewUrl = $state("");
  let localPreview = "";

  onMount(async () => {
    try {
      me = await apiRequest<Me>("/auth/me");
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
      toast.error(error instanceof Error ? error.message : "프로필을 불러오지 못했습니다");
    } finally {
      loading = false;
    }
  });

  async function loadPhoto(assetId: string) {
    try {
      const download = await apiRequest<{ url: string }>(`/assets/${assetId}/url`);
      if (!photoFile) photoPreviewUrl = download.url;
    } catch {
      // 사진 미리보기는 실패해도 화면을 막지 않는다.
    }
  }

  function onPhotoChange(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0] ?? null;
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

  async function uploadPhotoIfNeeded(): Promise<string | null> {
    if (!photoFile) return photoAssetId.trim() || null;
    const mimeType = imageMime(photoFile);
    const checksum = await fileSha256Checksum(photoFile);
    const created = await apiRequest<AssetCreateResponse>("/assets", {
      method: "POST",
      body: JSON.stringify({
        purpose: "PROFILE_PHOTO",
        fileName: photoFile.name,
        mimeType,
        size: photoFile.size,
        checksum
      })
    });
    await uploadSignedObject(created.upload, photoFile, mimeType);
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

  async function save(event: SubmitEvent) {
    event.preventDefault();
    saving = true;
    try {
      const nextPhotoAssetId = await uploadPhotoIfNeeded();
      await apiRequest("/users/me/profile", {
        method: "PATCH",
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim() || undefined,
          birthDate: birthDate || undefined,
          address: address.trim() || undefined,
          profileType,
          profileDetails: buildDetails(),
          photoAssetId: nextPhotoAssetId
        })
      });
      me = await apiRequest<Me>("/auth/me");
      photoAssetId = me.photoAssetId ?? "";
      photoFile = null;
      await fetchCurrentUser({ fresh: true });
      toast.success("프로필을 저장했습니다");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "저장하지 못했습니다");
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head>
  <title>프로필 — 아트브릿지</title>
</svelte:head>

<div class="mx-auto w-full max-w-xl">
  {#if loading}
    <div class="space-y-3 py-2">
      <Skeleton class="h-9 w-40" />
      <Skeleton class="h-80 w-full rounded-2xl" />
    </div>
  {:else if me}
    <div class="flex items-center gap-3 py-2">
      <div>
        <h1 class="text-2xl font-bold tracking-tight">프로필</h1>
        <p class="text-muted-foreground mt-0.5 text-sm">{me.email}</p>
      </div>
      <Badge variant={me.profileComplete ? "secondary" : "outline"} class="ms-auto">
        {me.profileComplete ? "프로필 완성" : "작성 중"}
      </Badge>
    </div>

    <Card.Root class="mt-2">
      <Card.Content>
        <form class="grid gap-5" onsubmit={save}>
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
              <p class="font-semibold">프로필 사진</p>
              <p class="text-muted-foreground text-xs">공연 참여자 목록에 함께 보입니다.</p>
            </div>
            <label
              class="border-input hover:bg-accent ms-auto shrink-0 cursor-pointer rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors"
            >
              사진 선택
              <input type="file" accept="image/png,image/jpeg,image/webp" class="hidden" onchange={onPhotoChange} />
            </label>
          </div>

          <div class="grid gap-2">
            <Label for="name">이름</Label>
            <Input id="name" bind:value={name} required maxlength={60} />
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            <div class="grid gap-2">
              <Label for="phone">연락처</Label>
              <Input id="phone" bind:value={phone} maxlength={40} placeholder="010-0000-0000" />
            </div>
            <div class="grid gap-2">
              <Label>기본 활동 직군</Label>
              <Select.Root type="single" bind:value={profileType}>
                <Select.Trigger class="w-full">
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
              <Input id="birthDate" type="date" bind:value={birthDate} />
            </div>
            <div class="grid gap-2">
              <Label for="address">활동 지역</Label>
              <Input id="address" bind:value={address} maxlength={120} placeholder="예: 서울 마포구" />
            </div>
          </div>

          <!-- 직군 상세 -->
          <div class="grid gap-4 sm:grid-cols-2">
            <div class="grid gap-2">
              <Label for="specialties">전문 분야</Label>
              <Input id="specialties" bind:value={specialtiesText} maxlength={200} placeholder="예: 합창, 안무 (쉼표로 구분)" />
            </div>
            <div class="grid gap-2">
              <Label for="voiceRange">음역·악기</Label>
              <Input id="voiceRange" bind:value={voiceRange} maxlength={60} placeholder="예: 소프라노 A3-C5, 엘렉톤" />
            </div>
          </div>

          <div class="flex justify-end">
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving ? "저장 중..." : "저장"}
            </Button>
          </div>
        </form>
      </Card.Content>
    </Card.Root>
  {/if}
</div>
