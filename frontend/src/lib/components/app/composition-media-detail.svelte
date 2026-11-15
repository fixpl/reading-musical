<script lang="ts">
  import { onDestroy } from "svelte";
  import { toast } from "svelte-sonner";
  import { apiRequest } from "$lib/api/client";
  import { linkMedia, uploadMediaFile } from "$lib/api/composition-media";
  import { assertCurrentSession, captureSession, isCurrentSession } from "$lib/api/session";
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { assetName, formatTime, SLOT_LABELS, type CompositionMedia, type CompositionSection } from "$lib/domain/composition";

  // 장면에 연결된 영상·음악·악보를 보고(미리보기), 다른 파일로 바꾸고, 연결을 끊는 창.
  let { pid, section, media, owner, canEdit, onClose, onChanged, onUnlink, onSettings }: {
    pid: string; section: CompositionSection; media: CompositionMedia; owner: CompositionSection; canEdit: boolean;
    onClose: () => void; onChanged: () => Promise<void> | void; onUnlink: (mediaId: string, ownerId: string) => Promise<void> | void; onSettings: (ownerId: string) => void;
  } = $props();

  let url = $state<string | null>(null);
  let failed = $state(false);
  let working = $state(false);
  let disposed = false;
  const viewSession = captureSession();
  onDestroy(() => { disposed = true; });
  const inherited = $derived(owner.id !== section.id);
  const mime = $derived(media.asset.mime);
  const isVideo = $derived(mime.startsWith("video/"));
  const isAudio = $derived(mime.startsWith("audio/"));
  const isImage = $derived(mime.startsWith("image/"));
  const isPdf = $derived(mime === "application/pdf");
  const MB = (bytes: number) => `${(bytes / 1048576).toFixed(1)}MB`;

  $effect(() => {
    const id = media.assetId;
    let cancelled = false;
    url = null; failed = false;
    void apiRequest<{ url: string }>(`/assets/${id}/url`, { session: viewSession }).then((result) => { if (!cancelled && isCurrentSession(viewSession) && id === media.assetId) url = result.url; }).catch(() => { if (!cancelled && isCurrentSession(viewSession)) failed = true; });
    return () => { cancelled = true; };
  });

  async function replace(event: Event) {
    const session = captureSession(); const id = pid; const ownerId = owner.id; const slot = media.slot;
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file || disposed || !isCurrentSession(viewSession)) return;
    working = true;
    try {
      const uploaded = await uploadMediaFile(id, file, session);
      assertCurrentSession(session);
      if (disposed || id !== pid) return;
      await linkMedia(id, ownerId, uploaded.assetId, slot, file.name.replace(/\.[^.]+$/, ""), session);
      if (disposed || id !== pid || !isCurrentSession(session)) return;
      toast.success("새 파일로 바꿨어요.");
      await onChanged();
      if (disposed || id !== pid || !isCurrentSession(session)) return;
      onClose();
    } catch (failure) {
      if (disposed || id !== pid || !isCurrentSession(session)) return;
      toast.error(failure instanceof Error ? failure.message : "파일을 바꾸지 못했어요.");
    } finally { if (!disposed && id === pid && isCurrentSession(session)) working = false; }
  }
  async function unlink() {
    if (!window.confirm(`“${media.label}” 연결을 해제할까요? 원본 파일은 남아 있고, 이 장면에서만 연결을 해제해요.`)) return;
    working = true;
    try { await onUnlink(media.id, owner.id); onClose(); } finally { working = false; }
  }
  const accept = $derived(media.slot === "MUSIC" ? "audio/mpeg,audio/wav,audio/mp4,audio/aac,.mp3,.wav,.m4a,.aac" : media.slot === "SCORE" ? "application/pdf,image/png,image/jpeg,image/webp,.pdf,.png,.jpg,.jpeg,.webp" : "video/mp4,image/png,image/jpeg,image/webp,.mp4,.png,.jpg,.jpeg,.webp");
</script>

<Dialog.Root open onOpenChange={(open) => { if (!open && !working) onClose(); }}>
  <Dialog.Content class="sm:max-w-2xl">
    <Dialog.Header>
      <Dialog.Title class="break-words">{SLOT_LABELS[media.slot]} · {media.label}</Dialog.Title>
      <Dialog.Description>{section.title}{inherited ? ` — 상위 “${owner.title}”의 자료를 함께 사용해요` : ""}</Dialog.Description>
    </Dialog.Header>

    <div class="bg-muted/40 grid min-h-48 place-items-center overflow-hidden rounded-xl border">
      {#if failed}<p class="text-muted-foreground p-6 text-center text-sm">미리보기를 불러오지 못했어요. 파일이 지워졌거나 저장소에 연결되지 않았을 수 있어요.</p>
      {:else if !url}<p class="text-muted-foreground p-6 text-sm" role="status">불러오는 중…</p>
      {:else if isVideo}<video src={url} class="max-h-[50vh] w-full bg-black" controls loop muted playsinline preload="metadata"><track kind="captions" /></video>
      {:else if isAudio}<audio src={url} class="w-full p-4" controls preload="metadata"></audio>
      {:else if isImage}<img src={url} alt={media.label} class="max-h-[50vh] w-full object-contain" />
      {:else if isPdf}<iframe title={media.label} src={`${url}#page=${media.page}`} class="h-[50vh] w-full"></iframe>
      {:else}<p class="text-muted-foreground p-6 text-sm">이 파일 형식은 미리 볼 수 없어요.</p>{/if}
    </div>

    <dl class="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
      <div><dt class="text-muted-foreground text-xs">파일</dt><dd class="break-words">{assetName(media.asset)}</dd></div>
      <div><dt class="text-muted-foreground text-xs">크기</dt><dd>{MB(media.asset.sizeBytes)}</dd></div>
      <div><dt class="text-muted-foreground text-xs">장면 시작 후</dt><dd class="tabular-nums">{formatTime(media.offsetMs)}부터</dd></div>
      <div><dt class="text-muted-foreground text-xs">재생 길이</dt><dd>{media.durationMs ? formatTime(media.durationMs) : "장면 끝까지"}</dd></div>
      {#if media.slot !== "SCORE"}<div><dt class="text-muted-foreground text-xs">반복</dt><dd>{media.loop ? "장면이 끝날 때까지 반복" : "한 번만"}</dd></div>{/if}
      {#if media.slot !== "SCORE"}<div><dt class="text-muted-foreground text-xs">음량</dt><dd>{Math.round(media.volume * 100)}%</dd></div>{/if}
      {#if isPdf}<div><dt class="text-muted-foreground text-xs">악보 페이지</dt><dd>{media.page}쪽</dd></div>{/if}
    </dl>

    <Dialog.Footer class="flex-wrap gap-2">
      {#if canEdit}
        <label class={["border-input hover:bg-accent inline-flex min-h-10 cursor-pointer items-center rounded-md border px-4 text-sm font-medium", working && "pointer-events-none opacity-50"]}>
          {working ? "바꾸는 중…" : "다른 파일로 바꾸기"}
          <input type="file" class="sr-only" {accept} onchange={replace} disabled={working} />
        </label>
        <Button variant="outline" class="min-h-10" disabled={working} onclick={() => { onSettings(owner.id); onClose(); }}>길이·음량 설정</Button>
        <Button variant="ghost" class="text-destructive min-h-10" disabled={working} onclick={unlink}>연결 해제</Button>
      {/if}
      <Button variant="secondary" class="min-h-10" disabled={working} onclick={onClose}>닫기</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
