<script lang="ts">
  import { onDestroy, tick, untrack } from "svelte";
  import { beforeNavigate, goto } from "$app/navigation";
  import { ImagePlus, ExternalLink, Eye, Check, ImageOff, X } from "@lucide/svelte";
  import { toast } from "svelte-sonner";
  import * as Card from "$lib/components/ui/card";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Textarea } from "$lib/components/ui/textarea";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import { ErrorPanel } from "$lib/components/ui/error-panel";
  import { ConfirmDialog, type ConfirmAsk } from "$lib/components/ui/confirm-dialog";
  import { ApiError } from "$lib/api/client";
  import {
    captureSession, isCurrentSession, sessionRequestSignal, subscribeSession, type ClientSession
  } from "$lib/api/session";
  import ImageDropzone from "$lib/components/showcase/image-dropzone.svelte";
  import {
    createPendingShowcaseImage, revokePendingShowcaseImage, uploadPendingShowcaseImages,
    type PendingShowcaseImage
  } from "$lib/api/showcase-image-upload";
  import {
    loadShowcaseEditor, saveShowcaseDraft, publishShowcase, unpublishShowcase,
    type ShowcaseDocument, type ShowcaseEditor
  } from "$lib/api/showcase";

  let { productionId, onReady }: { productionId: string; onReady?: (productionId: string) => void } = $props();

  function emptyDocument(): ShowcaseDocument {
    return { title: "", synopsis: "", description: "", venue: "", startDate: null, endDate: null,
      posterAssetId: null, officialUrl: "", ticketUrl: "", videoUrl: "", gallery: [] };
  }

  let editor = $state<ShowcaseEditor | null>(null);
  let draft = $state<ShowcaseDocument>(emptyDocument());
  let loading = $state(true);
  let busy = $state<"save" | "publish" | "unpublish" | "">("");
  let uploadProgress = $state<{ done: number; total: number } | null>(null);
  let loadError = $state("");
  let forbidden = $state(false);
  let actionError = $state("");
  let message = $state("");
  let conflict = $state<ShowcaseEditor | null>(null);
  let hasConflict = $state(false);
  let previewOpen = $state(false);
  let confirmUnpublish = $state(false);
  let mediaUrls = $state<Record<string, string>>({});
  let brokenImages = $state<Record<string, boolean>>({});
  let pendingImages = $state<Record<string, PendingShowcaseImage>>({});
  let viewAbort = new AbortController();
  let requestVersion = 0;
  let disposed = false;
  const viewSession = captureSession();
  const unsubscribeSession = subscribeSession((session) => {
    if (session.owner === viewSession.owner && session.generation === viewSession.generation) return;
    viewAbort.abort();
    requestVersion += 1;
    clearPendingImages();
    editor = null; draft = emptyDocument(); mediaUrls = {}; brokenImages = {};
    busy = ""; uploadProgress = null; loading = false; previewOpen = false;
    conflict = null; hasConflict = false; message = ""; actionError = ""; loadError = ""; forbidden = false; confirmUnpublish = false;
    leaving = false; askingLeave = false; resumedPopstate = null;
  });

  const dirty = $derived(editor !== null && JSON.stringify(draft) !== JSON.stringify(editor.draft));
  const posterUrl = $derived(draft.posterAssetId ? mediaUrls[draft.posterAssetId] ?? "" : "");
  const published = $derived(Boolean(editor?.publishedAt));
  let confirmation: { ask: ConfirmAsk };
  let leaving = false;
  let askingLeave = false;
  let resumedPopstate: { href: string; delta: number } | null = null;

  beforeNavigate((navigation) => {
    if (resumedPopstate && navigation.type === "popstate" && navigation.delta === resumedPopstate.delta && navigation.to?.url.href === resumedPopstate.href) {
      resumedPopstate = null;
      return;
    }
    if (leaving || (!dirty && !busy)) return;
    // 같은 화면의 위치만 바꿀 때는 입력이 유지되므로 이동을 막지 않는다.
    if (!navigation.willUnload && navigation.from?.url.pathname === navigation.to?.url.pathname && navigation.from?.url.search === navigation.to?.url.search) return;
    navigation.cancel();
    // 새로고침과 외부 이동에는 브라우저의 기본 이탈 확인을 사용한다.
    if (navigation.willUnload) return;
    if (busy) { toast.info("이미지를 올리거나 저장하는 중이에요. 잠시 기다려 주세요."); return; }
    if (!navigation.to?.url || askingLeave) return;
    void confirmLeave(navigation.to.url, navigation.type === "popstate" ? navigation.delta : undefined);
  });

  async function confirmLeave(target: URL, delta?: number) {
    const id = productionId; const version = requestVersion;
    askingLeave = true;
    try {
      const answer = await confirmation.ask({ title: "작성 중인 공연 소개를 남기고 이동할까요?", description: "초안에 저장하지 않은 글과 이미지 선택은 사라져요.", confirmLabel: "저장하지 않고 이동" });
      if (!currentRequest(id, version) || !answer.confirmed) return;
      if (delta !== undefined) {
        // 취소한 뒤로·앞으로 이동은 같은 history 위치로 다시 진행한다.
        resumedPopstate = { href: target.href, delta };
        history.go(delta);
        return;
      }
      leaving = true;
      await goto(target);
    } catch { if (currentRequest(id, version)) actionError = "화면을 열지 못했어요. 입력한 내용은 남아 있으니 다시 시도해 주세요."; }
    finally { if (currentRequest(id, version)) { leaving = false; askingLeave = false; } }
  }

  // 공연 id만 구독한다. 입력값이나 업로드 상태 변화가 초안을 다시 읽어 덮어쓰면 안 된다.
  $effect(() => {
    const id = productionId;
    untrack(() => { void load(id); });
  });

  onDestroy(() => {
    disposed = true;
    viewAbort.abort();
    requestVersion += 1;
    unsubscribeSession();
    clearPendingImages();
  });

  function copyDocument(document: ShowcaseDocument): ShowcaseDocument {
    return JSON.parse(JSON.stringify(document)) as ShowcaseDocument;
  }

  function currentRequest(id: string, version: number, session: ClientSession = viewSession) {
    return !disposed && !session.signal.aborted && isCurrentSession(viewSession)
      && isCurrentSession(session) && version === requestVersion && id === productionId;
  }

  function scopedSession() {
    const source = captureSession();
    const scope = sessionRequestSignal(source, viewAbort.signal);
    return { session: { ...source, signal: scope.signal }, dispose: scope.dispose };
  }

  function clearPendingImages() {
    for (const image of Object.values(pendingImages)) revokePendingShowcaseImage(image);
    pendingImages = {};
  }

  function removePendingImage(assetId: string | null) {
    if (!assetId || !pendingImages[assetId]) return;
    revokePendingShowcaseImage(pendingImages[assetId]);
    const nextPending = { ...pendingImages };
    const nextUrls = { ...mediaUrls };
    const nextBroken = { ...brokenImages };
    delete nextPending[assetId]; delete nextUrls[assetId]; delete nextBroken[assetId];
    pendingImages = nextPending; mediaUrls = nextUrls; brokenImages = nextBroken;
  }

  function adopt(value: ShowcaseEditor, preserveInput = false) {
    if (!preserveInput) {
      clearPendingImages();
      draft = copyDocument(value.draft);
    }
    editor = value;
    const nextUrls: Record<string, string> = preserveInput ? { ...mediaUrls } : {};
    if (value.draft.posterAssetId && value.posterUrl) nextUrls[value.draft.posterAssetId] = value.posterUrl;
    for (const item of value.gallery) nextUrls[item.assetId] = item.url;
    mediaUrls = nextUrls;
    brokenImages = {};
    hasConflict = false;
    conflict = null;
    confirmUnpublish = false;
  }

  async function load(id = productionId) {
    if (disposed || !isCurrentSession(viewSession)) return;
    viewAbort.abort();
    viewAbort = new AbortController();
    clearPendingImages();
    const version = ++requestVersion;
    const scope = scopedSession();
    loading = true; loadError = ""; forbidden = false; actionError = ""; message = "";
    editor = null; draft = emptyDocument(); mediaUrls = {}; brokenImages = {};
    previewOpen = false; hasConflict = false; conflict = null; busy = ""; uploadProgress = null;
    leaving = false; askingLeave = false; resumedPopstate = null;
    try {
      const result = await loadShowcaseEditor(id, { session: scope.session });
      if (!currentRequest(id, version, scope.session)) return;
      adopt(result);
    } catch (error) {
      if (!currentRequest(id, version, scope.session)) return;
      if (error instanceof ApiError && error.status === 403) forbidden = true;
      else loadError = error instanceof Error ? error.message : "공연 소개를 불러오지 못했어요.";
    } finally {
      if (currentRequest(id, version, scope.session)) {
        loading = false;
        // 입력 폼이 펼쳐진 뒤 초기 해시 위치를 다시 맞춘다.
        await tick();
        if (currentRequest(id, version, scope.session)) onReady?.(id);
      }
      scope.dispose();
    }
  }

  function normalizedDraft(): ShowcaseDocument {
    return {
      title: draft.title.trim(), synopsis: draft.synopsis.trim(), description: draft.description.trim(),
      venue: draft.venue.trim(), startDate: draft.startDate || null, endDate: draft.endDate || null,
      posterAssetId: draft.posterAssetId,
      officialUrl: draft.officialUrl.trim(), ticketUrl: draft.ticketUrl.trim(), videoUrl: draft.videoUrl.trim(),
      gallery: draft.gallery.map((item) => ({ assetId: item.assetId, caption: item.caption.trim() }))
    };
  }

  function validDate(value: string | null) {
    if (!value) return true;
    return /^\d{4}-\d{2}-\d{2}$/.test(value)
      && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
      && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
  }

  function validationMessage(value: ShowcaseDocument) {
    if (!value.title) return "관객에게 보여 줄 공연 이름을 입력해 주세요.";
    if (!validDate(value.startDate) || !validDate(value.endDate)) return "공연 날짜를 확인해 주세요.";
    if (value.startDate && value.endDate && value.endDate < value.startDate) return "종료일은 시작일과 같거나 이후여야 해요.";
    for (const [label, address] of [["공식 홈페이지", value.officialUrl], ["예매·문의", value.ticketUrl], ["소개 영상", value.videoUrl]]) {
      if (!address) continue;
      try {
        const url = new URL(address);
        if (url.protocol !== "https:" || url.username || url.password) return `${label} 주소는 https://로 시작하는 공개 주소를 입력해 주세요.`;
      } catch { return `${label} 주소를 확인해 주세요.`; }
    }
    return "";
  }

  async function handleFailure(error: unknown, id: string, version: number, session: ClientSession) {
    if (!currentRequest(id, version, session)) return;
    if (error instanceof ApiError && error.status === 409) {
      hasConflict = true;
      actionError = "다른 창에서 공연 소개가 바뀌었어요. 입력한 내용은 이 화면에 남아 있어요.";
      try {
        const latest = await loadShowcaseEditor(id, { session });
        if (currentRequest(id, version, session)) conflict = latest;
      } catch {
        if (currentRequest(id, version, session)) actionError += " 최신 초안 조회도 실패했어요. 아래에서 다시 확인해 주세요.";
      }
      return;
    }
    actionError = error instanceof Error ? error.message : "요청을 처리하지 못했어요. 입력한 내용은 그대로예요.";
  }

  async function refreshConflict() {
    if (busy || disposed || !isCurrentSession(viewSession)) return;
    const id = productionId; const version = requestVersion;
    const scope = scopedSession();
    busy = "save";
    try {
      const latest = await loadShowcaseEditor(id, { session: scope.session });
      if (currentRequest(id, version, scope.session)) { conflict = latest; actionError = "최신 초안을 확인했어요. 어느 내용을 저장할지 선택해 주세요."; }
    } catch (error) {
      if (currentRequest(id, version, scope.session)) actionError = error instanceof Error ? error.message : "최신 초안을 불러오지 못했어요.";
    } finally {
      if (currentRequest(id, version, scope.session)) busy = "";
      scope.dispose();
    }
  }

  async function saveDraft(expectedRevision = editor?.revision) {
    if (!editor || busy || expectedRevision === undefined || disposed || !isCurrentSession(viewSession)) return;
    const value = normalizedDraft();
    actionError = validationMessage(value); message = "";
    if (actionError) return;
    const id = productionId; const version = requestVersion;
    const scope = scopedSession();
    busy = "save";
    uploadProgress = Object.keys(pendingImages).length ? { done: 0, total: Object.keys(pendingImages).length } : null;
    try {
      const resolved = await uploadPendingShowcaseImages(id, value, pendingImages, scope.session, (done, total) => {
        if (currentRequest(id, version, scope.session)) uploadProgress = total ? { done, total } : null;
      });
      if (!currentRequest(id, version, scope.session)) return;
      const result = await saveShowcaseDraft(id, expectedRevision, resolved, { session: scope.session });
      if (!currentRequest(id, version, scope.session)) return;
      adopt(result);
      message = result.publishedAt ? "초안을 저장했어요. 관객에게 보이는 내용은 게시할 때 바뀌어요." : "초안을 저장했어요. 미리본 뒤 관객에게 게시할 수 있어요.";
      toast.success("공연 소개 초안을 저장했어요");
    } catch (error) { await handleFailure(error, id, version, scope.session); }
    finally {
      if (currentRequest(id, version, scope.session)) { busy = ""; uploadProgress = null; }
      scope.dispose();
    }
  }

  async function publish() {
    if (!editor || editor.revision === 0 || busy || dirty || hasConflict || !previewOpen || disposed || !isCurrentSession(viewSession)) return;
    actionError = validationMessage(normalizedDraft()); message = "";
    if (actionError) return;
    const id = productionId; const version = requestVersion;
    const scope = scopedSession();
    busy = "publish";
    try {
      const result = await publishShowcase(id, editor.revision, { session: scope.session });
      if (!currentRequest(id, version, scope.session)) return;
      adopt(result);
      message = "공연 소개를 게시했어요. 공연 목록과 소개 페이지에서 볼 수 있어요.";
      toast.success("공연 소개를 게시했어요");
    } catch (error) { await handleFailure(error, id, version, scope.session); }
    finally {
      if (currentRequest(id, version, scope.session)) busy = "";
      scope.dispose();
    }
  }

  async function unpublish() {
    if (!editor || busy || hasConflict || disposed || !isCurrentSession(viewSession)) return;
    const id = productionId; const version = requestVersion;
    const scope = scopedSession();
    busy = "unpublish"; actionError = ""; message = "";
    try {
      const result = await unpublishShowcase(id, editor.revision, { session: scope.session });
      if (!currentRequest(id, version, scope.session)) return;
      // 게시를 내려도 작성 중인 글과 로컬 이미지는 유지한다.
      adopt(result, true);
      message = "공연 소개를 내렸어요. 초안은 남아 있어요.";
      toast.success("공연 소개를 내렸어요");
    } catch (error) { await handleFailure(error, id, version, scope.session); }
    finally {
      if (currentRequest(id, version, scope.session)) busy = "";
      scope.dispose();
    }
  }

  function selectImages(files: File[], target: "poster" | "gallery") {
    if (!files.length || busy || disposed || !isCurrentSession(viewSession)) return;
    message = "";
    if (target === "poster" && files.length !== 1) {
      actionError = "포스터는 한 장만 선택해 주세요."; return;
    }
    if (target === "gallery" && draft.gallery.length + files.length > 8) {
      actionError = "홍보 사진은 최대 8장까지 선택할 수 있어요. 추가할 사진 수를 확인해 주세요."; return;
    }
    const staged: PendingShowcaseImage[] = [];
    try {
      for (const file of files) staged.push(createPendingShowcaseImage(file, viewSession));
    } catch (error) {
      for (const image of staged) revokePendingShowcaseImage(image);
      actionError = error instanceof Error ? error.message : "10MB 이하의 PNG·JPEG·WebP 이미지를 선택해 주세요.";
      return;
    }
    if (target === "poster") removePendingImage(draft.posterAssetId);
    const nextPending = { ...pendingImages };
    const nextUrls = { ...mediaUrls };
    for (const image of staged) { nextPending[image.id] = image; nextUrls[image.id] = image.previewUrl; }
    pendingImages = nextPending; mediaUrls = nextUrls;
    if (target === "poster") draft.posterAssetId = staged[0].id;
    else draft.gallery = [...draft.gallery, ...staged.map((image) => ({ assetId: image.id, caption: "" }))];
    actionError = ""; message = "이미지는 초안을 저장할 때 함께 저장돼요.";
  }

  function removePoster() {
    if (busy || disposed || !isCurrentSession(viewSession)) return;
    removePendingImage(draft.posterAssetId);
    draft.posterAssetId = null;
  }

  function removeGalleryImage(assetId: string) {
    if (busy || disposed || !isCurrentSession(viewSession)) return;
    removePendingImage(assetId);
    draft.gallery = draft.gallery.filter((item) => item.assetId !== assetId);
  }

  function formatDates(start: string | null, end: string | null) {
    if (!start && !end) return "공연 날짜 미정";
    if (start && end) return start === end ? start.replaceAll("-", ".") : `${start.replaceAll("-", ".")} – ${end.replaceAll("-", ".")}`;
    return start ? `${start.replaceAll("-", ".")}부터 · 종료일 미정` : `${end!.replaceAll("-", ".")}까지 · 시작일 미정`;
  }

  function markBroken(assetId: string) { brokenImages = { ...brokenImages, [assetId]: true }; }
</script>

<section id="showcase" class="scroll-mt-24 mt-6" aria-labelledby="showcase-title">
  <Card.Root class="overflow-hidden">
    <Card.Header class="border-b bg-muted/30">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="showcase-title" class="text-lg font-medium leading-snug">관객에게 보여 줄 공연 소개</h2>
          <Card.Description class="mt-1.5 max-w-prose leading-6">포스터와 공연 소식을 한 페이지에 모아요. 초안을 저장한 뒤 직접 게시해야 아트브릿지 공연 목록에 보여요.</Card.Description>
        </div>
        {#if editor}<Badge variant={published ? "default" : "outline"}>{published ? "게시 중" : "미게시"}</Badge>{/if}
      </div>
    </Card.Header>
    <Card.Content class="pt-5">
      {#if loading}
        <Skeleton class="h-80 w-full rounded-xl" />
      {:else if forbidden}
        <p class="text-muted-foreground rounded-xl border bg-muted/30 p-4 text-sm leading-6">공연 소개는 기획 담당자나 관리자가 작성해요.</p>
      {:else if loadError}
        <ErrorPanel title="공연 소개를 불러오지 못했어요" message={loadError} onRetry={() => load()} />
      {:else if editor}
        <div class="mb-5 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm leading-6 dark:border-amber-900 dark:bg-amber-950/25">
          <p>아래 내용은 관객용 소개예요. 위의 운영용 공연 정보와 따로 저장돼요.</p>
          <p class="text-muted-foreground">출연진은 배역을 배정하고, 배우가 프로필에서 이 공연의 이름·사진 공개를 선택하면 표시돼요.</p>
        </div>
        {#if published}
          <div class="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3">
            <div class="min-w-0 text-sm leading-6">
              <p class="flex items-center gap-1.5 font-medium"><Check class="size-4 text-emerald-600 dark:text-emerald-400" />관객에게 게시되어 있어요</p>
              <p class="text-muted-foreground">{editor.hasDraftChanges ? "저장한 변경 사항은 다시 게시할 때 반영돼요." : "게시 후 초안을 고쳐도 현재 소개 페이지는 그대로예요."}</p>
            </div>
            <Button href={editor.publicPath} target="_blank" rel="noopener noreferrer" variant="outline" size="touch">게시된 페이지<ExternalLink class="size-4" /><span class="sr-only">새 창</span></Button>
          </div>
        {/if}

        <form onsubmit={(event) => { event.preventDefault(); void saveDraft(); }} class="grid gap-6">
          <fieldset aria-label="공연 소개 입력" disabled={Boolean(busy)} class="grid min-w-0 gap-6 disabled:opacity-75">
            <div class="grid gap-4 sm:grid-cols-[9rem_minmax(0,1fr)]">
              <div class="flex aspect-[3/4] items-center justify-center overflow-hidden rounded-xl border bg-muted sm:w-36">
                {#if posterUrl && draft.posterAssetId && !brokenImages[draft.posterAssetId]}
                  <img src={posterUrl} alt="선택한 공연 포스터" class="h-full w-full object-contain" onerror={() => draft.posterAssetId && markBroken(draft.posterAssetId)} />
                {:else}
                  <div class="px-3 text-center text-muted-foreground"><ImageOff class="mx-auto mb-2 size-7" /><p class="text-xs leading-5">{draft.posterAssetId ? "포스터를 불러오지 못했어요" : "포스터를 올려 주세요"}</p></div>
                {/if}
              </div>
              <div class="flex flex-col justify-center gap-3">
                <div><p class="font-medium">공연 포스터</p><p id="showcase-image-help" class="text-muted-foreground mt-1 text-sm leading-6">PNG·JPEG·WebP, 파일당 10MB까지 올릴 수 있어요. 포스터가 없어도 소개를 작성할 수 있어요.</p></div>
                <ImageDropzone label="공연 포스터 선택" hint="이미지는 초안을 저장할 때 함께 저장돼요." disabled={Boolean(busy)} onFiles={(files) => selectImages(files, "poster")} />
                <div class="flex items-center gap-2">
                  {#if draft.posterAssetId && pendingImages[draft.posterAssetId]}<Badge variant="outline">저장 전</Badge>{/if}
                  {#if draft.posterAssetId}<Button variant="ghost" size="touch" class="self-start" onclick={removePoster}>포스터 제거</Button>{/if}
                </div>
              </div>
            </div>
            <div class="grid gap-2">
              <Label for="showcase-title-input">공개용 공연 이름 <span class="text-muted-foreground text-xs">필수</span></Label>
              <Input id="showcase-title-input" required maxlength={120} bind:value={draft.title} class="min-h-11" />
            </div>
            <div class="grid gap-2">
              <Label for="showcase-synopsis">한 줄 소개</Label>
              <Input id="showcase-synopsis" maxlength={200} bind:value={draft.synopsis} placeholder="관객에게 가장 먼저 전하고 싶은 이야기" class="min-h-11" />
            </div>
            <div class="grid gap-2">
              <Label for="showcase-description">공연 소개</Label>
              <Textarea id="showcase-description" maxlength={10000} rows={6} bind:value={draft.description} placeholder="작품 이야기, 관람 포인트, 공연팀 소개를 적어 주세요." class="min-h-40" />
            </div>
            <div class="grid gap-2">
              <Label for="showcase-venue">관객용 공연 장소</Label>
              <Input id="showcase-venue" maxlength={200} bind:value={draft.venue} placeholder="공연장 이름과 찾아올 주소" class="min-h-11" />
            </div>
            <div class="grid gap-4 sm:grid-cols-2">
              <div class="grid gap-2"><Label for="showcase-start">공연 시작일</Label><Input id="showcase-start" type="date" value={draft.startDate ?? ""} onchange={(event) => { draft.startDate = event.currentTarget.value || null; }} aria-describedby="showcase-date-help" class="min-h-11" /></div>
              <div class="grid gap-2"><Label for="showcase-end">공연 종료일</Label><Input id="showcase-end" type="date" value={draft.endDate ?? ""} onchange={(event) => { draft.endDate = event.currentTarget.value || null; }} aria-describedby="showcase-date-help" class="min-h-11" /></div>
            </div>
            <p id="showcase-date-help" class="text-muted-foreground -mt-4 text-xs leading-5">관객이 관람할 공연 날짜예요. 연습 일정은 공개하지 않으며, 미정인 날짜는 비워 둬도 돼요.</p>
            <div class="grid gap-4">
              <div class="grid gap-2"><Label for="showcase-official">공식 홈페이지</Label><Input id="showcase-official" type="url" maxlength={2048} bind:value={draft.officialUrl} placeholder="https://" class="min-h-11" aria-describedby="showcase-link-help" /></div>
              <div class="grid gap-2"><Label for="showcase-ticket">예매·문의 주소</Label><Input id="showcase-ticket" type="url" maxlength={2048} bind:value={draft.ticketUrl} placeholder="https://" class="min-h-11" aria-describedby="showcase-link-help" /></div>
              <div class="grid gap-2"><Label for="showcase-video">소개 영상 주소</Label><Input id="showcase-video" type="url" maxlength={2048} bind:value={draft.videoUrl} placeholder="https://" class="min-h-11" aria-describedby="showcase-link-help" /></div>
              <p id="showcase-link-help" class="text-muted-foreground -mt-2 text-xs leading-5">https://로 시작하는 주소를 입력해 주세요. 소개 영상은 관객이 링크를 눌러 볼 수 있어요.</p>
            </div>
            <div class="grid gap-3 border-t pt-5">
              <div class="flex items-center justify-between gap-2"><h3 class="font-medium">홍보 사진</h3><span class="text-muted-foreground text-sm">{draft.gallery.length}/8장</span></div>
              <p id="showcase-gallery-help" class="text-muted-foreground text-sm leading-6">직접 사용 권한을 확인한 사진만 올려 주세요. 이곳에 올린 사진은 게시할 때 함께 공개돼요.</p>
              {#if draft.gallery.length > 0}
                <div class="grid gap-4 sm:grid-cols-2">
                  {#each draft.gallery as image, index (image.assetId)}
                    <div class="min-w-0 overflow-hidden rounded-xl border">
                      <div class="relative flex aspect-video items-center justify-center bg-muted">
                        {#if mediaUrls[image.assetId] && !brokenImages[image.assetId]}
                          <img src={mediaUrls[image.assetId]} alt={image.caption || `홍보 사진 ${index + 1}`} class="h-full w-full object-contain" onerror={() => markBroken(image.assetId)} />
                        {:else}<p class="text-muted-foreground px-3 text-sm">사진을 불러오지 못했어요</p>{/if}
                        <Button variant="outline" size="icon-touch" class="absolute right-2 top-2 bg-background" aria-label={`홍보 사진 ${index + 1} 제거`} onclick={() => removeGalleryImage(image.assetId)}><X class="size-4" /></Button>
                      </div>
                      <div class="grid gap-2 p-3"><div class="flex items-center justify-between gap-2"><Label for={`showcase-caption-${image.assetId}`}>사진 {index + 1} 설명</Label>{#if pendingImages[image.assetId]}<Badge variant="outline">저장 전</Badge>{/if}</div><Input id={`showcase-caption-${image.assetId}`} maxlength={200} bind:value={image.caption} placeholder="사진에 대한 짧은 설명" class="min-h-11" /></div>
                    </div>
                  {/each}
                </div>
              {/if}
              {#if draft.gallery.length < 8}<ImageDropzone label="홍보 사진 추가" hint="여러 장을 한 번에 선택하거나 끌어다 놓을 수 있어요. 이미지는 초안을 저장할 때 함께 저장돼요." multiple disabled={Boolean(busy)} onFiles={(files) => selectImages(files, "gallery")} />{:else}<p class="text-muted-foreground text-xs">사진은 최대 8장까지 올릴 수 있어요. 기존 사진을 지우면 추가할 수 있어요.</p>{/if}
            </div>
          </fieldset>

          {#if busy === "save" && uploadProgress}<p role="status" class="text-muted-foreground text-sm">이미지 {uploadProgress.done}/{uploadProgress.total}장 저장 중…</p>{/if}
          {#if actionError}<p role="alert" class="text-destructive rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm leading-6">{actionError}</p>{/if}
          {#if hasConflict}
            <div class="grid gap-3 rounded-xl border border-amber-300 p-4 dark:border-amber-800">
              <p class="text-sm leading-6">최신 초안을 불러오면 이 화면의 입력이 바뀌어요. 내 내용으로 저장하면 최신 초안 대신 지금 입력한 내용이 저장돼요. 게시된 내용은 직접 다시 게시할 때 바뀌어요.</p>
              <div class="flex flex-wrap gap-2">
                {#if conflict}
                  <Button variant="outline" size="touch" disabled={Boolean(busy)} onclick={() => { if (conflict) { adopt(conflict); previewOpen = false; actionError = ""; message = "최신 초안을 불러왔어요."; } }}>최신 초안 불러오기</Button>
                  <Button size="touch" disabled={Boolean(busy)} onclick={() => conflict && saveDraft(conflict.revision)}>내 내용으로 초안 저장</Button>
                {:else}<Button variant="outline" size="touch" disabled={Boolean(busy)} onclick={refreshConflict}>최신 초안 다시 확인</Button>{/if}
              </div>
            </div>
          {/if}
          {#if message}<p role="status" class="text-sm leading-6 text-emerald-700 dark:text-emerald-400">{message}</p>{/if}
          <div class="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <p class="text-muted-foreground text-xs">{dirty ? "아직 저장하지 않은 변경 사항이 있어요." : "초안 저장은 외부에 공개되지 않아요."}</p>
            <div class="flex flex-wrap gap-2">
              <Button variant="outline" size="touch" disabled={Boolean(busy)} onclick={() => { previewOpen = !previewOpen; }} aria-expanded={previewOpen} aria-controls="showcase-preview"><Eye class="size-4" />{previewOpen ? "미리보기 닫기" : "미리보기"}</Button>
              <Button type="submit" size="touch" disabled={Boolean(busy) || hasConflict || !draft.title.trim()}>{busy === "save" ? "저장 중…" : "소개 초안 저장"}</Button>
            </div>
          </div>
        </form>

        {#if previewOpen}
          <section id="showcase-preview" aria-label="공연 소개 미리보기" class="mt-6 overflow-hidden rounded-xl border">
            <div class="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-4 py-3"><h3 class="text-sm font-medium">관객 화면 미리보기</h3><span class="text-muted-foreground text-xs">현재 입력 기준 · 외부에 보이지 않아요</span></div>
            <div class="grid gap-5 p-4 sm:grid-cols-[8rem_minmax(0,1fr)] sm:p-5">
              <div class="flex aspect-[3/4] max-h-60 items-center justify-center overflow-hidden rounded-lg border bg-muted">
                {#if posterUrl && draft.posterAssetId && !brokenImages[draft.posterAssetId]}<img src={posterUrl} alt="공연 포스터" class="h-full w-full object-contain" onerror={() => draft.posterAssetId && markBroken(draft.posterAssetId)} />{:else}<ImagePlus class="size-8 text-muted-foreground" />{/if}
              </div>
              <div class="min-w-0 self-center"><p class="text-primary mb-2 text-xs font-medium">아트브릿지 공연</p><h4 class="break-words text-2xl font-semibold tracking-tight">{draft.title.trim() || "공연 이름"}</h4><p class="text-muted-foreground mt-2 break-words text-sm leading-6">{draft.synopsis}</p><p class="mt-4 text-sm">{formatDates(draft.startDate, draft.endDate)}</p><p class="text-muted-foreground mt-1 break-words text-sm">{draft.venue.trim() || "공연 장소 미정"}</p></div>
              {#if draft.description.trim()}<p class="whitespace-pre-wrap break-words text-sm leading-7 sm:col-span-2">{draft.description}</p>{/if}
              <div class="flex flex-wrap gap-2 sm:col-span-2">
                {#if draft.officialUrl.trim()}<span class="rounded-lg border px-3 py-2 text-sm">공식 홈페이지</span>{/if}
                {#if draft.ticketUrl.trim()}<span class="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">예매·문의</span>{/if}
                {#if draft.videoUrl.trim()}<span class="rounded-lg border px-3 py-2 text-sm">소개 영상</span>{/if}
              </div>
              {#if draft.gallery.length > 0}<div class="grid grid-cols-2 gap-3 sm:col-span-2">{#each draft.gallery as image, index (image.assetId)}<figure class="min-w-0"><div class="flex aspect-video items-center justify-center overflow-hidden rounded-lg border bg-muted">{#if mediaUrls[image.assetId] && !brokenImages[image.assetId]}<img src={mediaUrls[image.assetId]} alt={image.caption || `홍보 사진 ${index + 1}`} class="h-full w-full object-contain" onerror={() => markBroken(image.assetId)} />{:else}<ImageOff class="size-6 text-muted-foreground" />{/if}</div>{#if image.caption}<figcaption class="text-muted-foreground mt-1 break-words text-xs leading-5">{image.caption}</figcaption>{/if}</figure>{/each}</div>{/if}
              <p class="text-muted-foreground border-t pt-3 text-xs leading-5 sm:col-span-2">출연진은 본인이 공개를 선택한 이름·사진만 실제 소개 페이지에 표시돼요. 미리보기에는 출연진을 표시하지 않아요.</p>
            </div>
          </section>
        {/if}

        <div class="mt-6 border-t pt-5">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="text-sm leading-6"><p class="font-medium">{published ? "소개 내용을 바꿀 준비가 됐나요?" : "관객에게 소개할 준비가 됐나요?"}</p><p class="text-muted-foreground">{dirty || editor.revision === 0 ? "먼저 초안을 저장하고 미리보기에서 확인해 주세요." : !previewOpen ? "미리보기에서 내용을 확인한 뒤 게시해 주세요." : "게시하면 로그인하지 않은 관객도 소개와 홍보 사진을 볼 수 있어요."}</p></div>
            <Button size="touch" disabled={Boolean(busy) || editor.revision === 0 || dirty || hasConflict || !previewOpen || !draft.title.trim()} onclick={publish}>{busy === "publish" ? "게시 중…" : published ? "저장한 초안으로 다시 게시" : "관객에게 게시"}</Button>
          </div>
          {#if published}
            <div class="mt-4 border-t pt-4">
              {#if confirmUnpublish}
                <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/50 p-3"><p class="text-sm leading-6">소개 페이지와 공연 목록에서 내릴까요? 작성한 초안은 유지돼요.</p><div class="flex gap-2"><Button size="touch" variant="outline" disabled={Boolean(busy)} onclick={() => { confirmUnpublish = false; }}>취소</Button><Button size="touch" variant="destructive" disabled={Boolean(busy) || hasConflict} onclick={unpublish}>{busy === "unpublish" ? "내리는 중…" : "게시 내리기"}</Button></div></div>
              {:else}<Button size="touch" variant="ghost" disabled={Boolean(busy)} onclick={() => { confirmUnpublish = true; }}>공연 소개 게시 내리기</Button>{/if}
            </div>
          {/if}
        </div>
      {/if}
    </Card.Content>
  </Card.Root>
</section>

<ConfirmDialog bind:this={confirmation} />
