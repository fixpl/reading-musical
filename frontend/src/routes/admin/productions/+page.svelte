<script lang="ts">
  import { takeProductionDraft } from "$lib/api/production-assistant";
  import { afterNavigate, beforeNavigate, goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { onMount, onDestroy } from "svelte";
  import ProductionImpact, { type DeletionImpact } from "$lib/components/admin/ProductionImpact.svelte";
  import ConfirmAction from "$lib/components/admin/ConfirmAction.svelte";
  import { toast } from "svelte-sonner";
  import * as Card from "$lib/components/ui/card";
  import * as Dialog from "$lib/components/ui/dialog";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import { Textarea } from "$lib/components/ui/textarea";
  import { Input } from "$lib/components/ui/input";
  import { PageHeader } from "$lib/components/ui/page-header";
  import { FormField } from "$lib/components/ui/form-field";
  import { EmptyState } from "$lib/components/ui/empty-state";
  import { apiRequest } from "$lib/api/client";
  import { peek, remember } from "$lib/api/swr";
  import { captureSession, assertCurrentSession, isCurrentSession, sessionRequestSignal, subscribeSession, type ClientSession } from "$lib/api/session";
  import { PHASE_LABELS, formatDate, formatRelative } from "$lib/domain/labels";
  import StickyNoteIcon from "@lucide/svelte/icons/sticky-note";
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import RotateCcwIcon from "@lucide/svelte/icons/rotate-ccw";
  import CheckIcon from "@lucide/svelte/icons/check";
  import CircleMinusIcon from "@lucide/svelte/icons/circle-minus";
  import CircleHelpIcon from "@lucide/svelte/icons/circle-help";
  import ImageIcon from "@lucide/svelte/icons/image";
  import PlayIcon from "@lucide/svelte/icons/play";
  import { rehearsalPreparationSteps, readinessStepLink, readinessStepState, type OperationStep, type ProductionReadiness } from "$lib/domain/operations-dashboard";

  import { loadShowcaseEditor, loadShowcaseSummaries, saveShowcaseDraft, showcaseDocumentsEqual, type ShowcaseDocument, type ShowcaseSummary } from "$lib/api/showcase";
  import { createPendingShowcaseImage, revokePendingShowcaseImage, uploadPendingShowcaseImages, type PendingShowcaseImage } from "$lib/api/showcase-image-upload";
  import ImageDropzone from "$lib/components/showcase/image-dropzone.svelte";
  type CardReadiness = ProductionReadiness & { casting?: { done: boolean; detail: string } };
  type WorkStatus = {
    key: string;
    label: string;
    href: string;
    state: "등록됨" | "추가 필요" | "해당 없음" | "확인 중" | "확인 필요";
    detail: string;
  };

  type Production = {
    id: string;
    title: string;
    venue: string | null;
    startDate: string | null;
    endDate: string | null;
    currentPhase: string;
    visibility: string;
    archived: boolean;
    deletedAt?: string | null;
    createdAt: string;
  };

  type Memo = {
    id: string;
    body: string;
    createdAt: string;
    author: { id: string; name: string };
    inquiry: { id: string; orgName: string } | null;
  };

  // 받아 둔 목록이 있으면 먼저 보여 주고 뒤에서 새로 받는다(메뉴를 옮길 때 빈 화면이 번쩍이지 않도록).
  let productions = $state<Production[]>(peek<Production[]>("admin:productions") ?? []);
  let loading = $state(!peek("admin:productions"));
  let loadError = $state("");
  let readiness = $state<Record<string, CardReadiness>>({});
  let readinessLoading = $state(true);
  let readinessError = $state("");
  let showcases = $state<Record<string, ShowcaseSummary>>({});
  let showcasesLoading = $state(true);
  let showcasesError = $state("");
  let failedPosters = $state<Record<string, string>>({});
  let loadSequence = 0;
  let readinessSequence = 0;
  let showcasesSequence = 0;

  function workStatuses(production: Production): WorkStatus[] {
    const current = readiness[production.id];
    const steps = current ? rehearsalPreparationSteps(current) : [];
    const definitions = [
      { key: "script", label: "대본·자료" },
      { key: "members", label: "멤버" },
      { key: "casting", label: "배역" },
      { key: "schedule", label: "일정" },
      { key: "cues", label: "큐시트" }
    ];
    const basics: WorkStatus = {
      key: "basics", label: "기본정보", href: `/app/p/${production.id}/manage/settings`,
      state: "등록됨", detail: "장소·날짜는 선택"
    };
    return [basics, ...definitions.map(({ key, label }): WorkStatus => {
      const casting = key === "casting" && current?.casting;
      const step: OperationStep | undefined = casting
        ? { key, label, ...casting }
        : steps.find((item) => item.key === key);
      if (readinessLoading || readinessError || !step) {
        return {
          key, label, href: readinessStepLink(production.id, key),
          state: readinessLoading ? "확인 중" : "확인 필요",
          detail: readinessLoading ? "등록 현황 조회 중" : "열어서 확인"
        };
      }
      return {
        key, label, href: readinessStepLink(production.id, key), state: readinessStepState(step),
        detail: key === "schedule" && step.done ? formatDate(step.detail) : step.detail
      };
    })];
  }

  function performanceDates(production: Production) {
    if (!production.startDate && !production.endDate) return "공연일 미정";
    if (!production.startDate) return `${formatDate(production.endDate)}까지`;
    if (!production.endDate || production.endDate === production.startDate) return formatDate(production.startDate);
    return `${formatDate(production.startDate)} ~ ${formatDate(production.endDate)}`;
  }

  async function loadReadiness() {
    const current = ++readinessSequence;
    readinessLoading = true;
    readinessError = "";
    try {
      const result = await apiRequest<{ items: CardReadiness[] }>("/admin/overview");
      if (current === readinessSequence) readiness = Object.fromEntries(result.items.map((item) => [item.id, item]));
    } catch (error) {
      if (current === readinessSequence) readinessError = error instanceof Error ? error.message : "등록 현황을 불러오지 못했어요";
    } finally {
      if (current === readinessSequence) readinessLoading = false;
    }
  }

  async function loadShowcases() {
    const current = ++showcasesSequence;
    showcasesLoading = true;
    showcasesError = "";
    try {
      const result = await loadShowcaseSummaries();
      if (current === showcasesSequence) showcases = Object.fromEntries(result.items.map((item) => [item.productionId, item]));
    } catch (error) {
      if (current === showcasesSequence) showcasesError = error instanceof Error ? error.message : "공연 소개 정보를 불러오지 못했어요";
    } finally {
      if (current === showcasesSequence) showcasesLoading = false;
    }
  }

  let memoTarget = $state<Production | null>(null);
  let memos = $state<Memo[]>([]);
  let memosLoading = $state(false);
  let newMemo = $state("");
  let memoSaving = $state(false);

  // 공연 ID와 업로드 예약을 유지해 일부 실패 후에도 같은 등록을 이어 간다.
  let createOpen = $state(false);
  let createDetailsOpen = $state(false);
  let createTitle = $state("");
  let createVenue = $state("");
  let createDate = $state("");
  let createSynopsis = $state("");
  let creating = $state(false);
  let createError = $state("");
  let createProgress = $state("");
  let createdProductionId = $state<string | null>(null);
  let createdBasics: ShowcaseDocument | null = null;
  let lastAttemptedDraft: ShowcaseDocument | null = null;
  let pendingImages = $state<Record<string, PendingShowcaseImage>>({});
  let createPosterId = $state<string | null>(null);
  let createGalleryIds = $state<string[]>([]);
  let creationSession: ClientSession | null = null;
  let creationUrlInFlight: string | null = null;
  let creationNavigationAllowed = false;
  let creationOperation = 0;
  let disposed = false;
  const creationAbort = new AbortController();

  function clearCreation() {
    Object.values(pendingImages).forEach(revokePendingShowcaseImage);
    pendingImages = {};
    createPosterId = null;
    createGalleryIds = [];
    createdProductionId = null;
    createdBasics = null;
    lastAttemptedDraft = null;
    creationSession = null;
    createTitle = "";
    createVenue = "";
    createDate = "";
    createSynopsis = "";
    createError = "";
    createProgress = "";
  }

  function setCreationOpen(open: boolean) {
    if (creating) return;
    if (!open && !createdProductionId) clearCreation();
    createOpen = open;
    if (!open) createDetailsOpen = false;
  }

  function currentCreationSession() {
    const session = creationSession ?? captureSession();
    assertCurrentSession(session);
    if (disposed || creationAbort.signal.aborted || session.signal.aborted) throw new DOMException("공연 등록을 중단했어요.", "AbortError");
    creationSession = session;
    return session;
  }

  function selectCreationImages(files: File[], poster: boolean) {
    if (creating || !files.length) return;
    const selected: PendingShowcaseImage[] = [];
    try {
      if (poster && files.length !== 1) throw new Error("포스터는 한 장만 선택해 주세요.");
      if (!poster && createGalleryIds.length + files.length > 8) throw new Error("홍보 사진은 8장까지 등록할 수 있어요.");
      const session = currentCreationSession();
      // 전체 파일을 검증한 뒤 반영해 잘못된 파일이 섞여도 기존 선택을 유지한다.
      for (const file of files) selected.push(createPendingShowcaseImage(file, session));
      if (poster && createPosterId) removeCreationImage(createPosterId);
      for (const image of selected) pendingImages[image.id] = image;
      if (poster) createPosterId = selected[0].id;
      else createGalleryIds = [...createGalleryIds, ...selected.map((image) => image.id)];
      createError = "";
    } catch (error) {
      selected.forEach(revokePendingShowcaseImage);
      createError = error instanceof Error ? error.message : "이미지를 선택하지 못했어요.";
    }
  }

  function removeCreationImage(id: string) {
    if (creating) return;
    const image = pendingImages[id];
    if (image) revokePendingShowcaseImage(image);
    delete pendingImages[id];
    if (createPosterId === id) createPosterId = null;
    createGalleryIds = createGalleryIds.filter((imageId) => imageId !== id);
  }

  function creationDocument(): ShowcaseDocument {
    const basics = createdBasics ?? {
      title: createTitle.trim(), synopsis: createSynopsis.trim(), description: "", venue: createVenue.trim(),
      startDate: createDate || null, endDate: null, posterAssetId: null,
      officialUrl: "", ticketUrl: "", videoUrl: "", gallery: []
    };
    return { ...basics, posterAssetId: createPosterId, gallery: createGalleryIds.map((assetId) => ({ assetId, caption: "" })) };
  }

  function openCreationFromUrl(requestUrl: URL) {
    if (requestUrl.searchParams.get("create") !== "1" || creationUrlInFlight === requestUrl.href) return;
    creationUrlInFlight = requestUrl.href;
    setCreationOpen(true);
    if (requestUrl.searchParams.get("draft") === "assistant" && !creating && !createdProductionId) {
      const draft = takeProductionDraft();
      if (draft) {
        createTitle = draft.title;
        createVenue = draft.venue;
        createDate = draft.startDate;
        createSynopsis = draft.synopsis;
        createDetailsOpen = Boolean(draft.venue || draft.startDate || draft.synopsis);
      }
    }
    const url = new URL(requestUrl);
    url.searchParams.delete("create");
    url.searchParams.delete("draft");
    // 등록 진입 표시는 소비해 메뉴 재방문 시 창이 다시 열리지 않게 한다.
    void goto(url, { replaceState: true, noScroll: true, keepFocus: true }).catch(() => {
      toast.error("화면 이동을 마치지 못했어요. 잠시 후 다시 시도해 주세요.");
    }).finally(() => { creationUrlInFlight = null; });
  }
  afterNavigate(({ to }) => { if (to) openCreationFromUrl(to.url); });
  beforeNavigate(({ cancel }) => { if (creating && !creationNavigationAllowed) cancel(); });

  async function createProduction(event: SubmitEvent) {
    event.preventDefault();
    if (creating || !createTitle.trim()) return;
    const operation = ++creationOperation;
    let request: ReturnType<typeof sessionRequestSignal> | undefined;
    let session: ClientSession | undefined;
    let productionId = createdProductionId;
    try {
      session = currentCreationSession();
      request = sessionRequestSignal(session, creationAbort.signal);
      const scopedSession = { ...session, signal: request.signal };
      const active = () => !disposed && operation === creationOperation && !request!.signal.aborted && isCurrentSession(session!) && productionId === createdProductionId;
      const requireActive = () => { if (!active()) throw new DOMException("공연 등록을 중단했어요.", "AbortError"); };
      const document = creationDocument();
      creating = true;
      createError = "";
      createProgress = productionId ? "선택한 사진을 저장하고 있어요." : "공연 기본정보를 등록하고 있어요.";
      if (!productionId) {
        const created = await apiRequest<{ id: string }>("/productions", {
          method: "POST", session: scopedSession,
          body: JSON.stringify({ title: document.title, venue: document.venue || undefined,
            startDate: document.startDate ? new Date(document.startDate).toISOString() : undefined,
            synopsis: document.synopsis || undefined })
        });
        requireActive();
        productionId = created.id;
        createdProductionId = created.id;
        createdBasics = { ...document, posterAssetId: null, gallery: [] };
      }
      requireActive();
      if (document.posterAssetId || document.gallery.length || lastAttemptedDraft) {
        const resolved = await uploadPendingShowcaseImages(productionId, document, pendingImages, scopedSession, (completed, total) => {
          if (active()) createProgress = `사진 저장 중 · ${completed}/${total}장`;
        });
        requireActive();
        createProgress = "공연 소개에 사진을 연결하고 있어요.";
        const editor = await loadShowcaseEditor(productionId, { session: scopedSession });
        requireActive();
        if (!showcaseDocumentsEqual(editor.draft, resolved)) {
          if (editor.revision > 0 && (!lastAttemptedDraft || !showcaseDocumentsEqual(editor.draft, lastAttemptedDraft))) {
            throw new Error("다른 창에서 공연 소개가 수정됐어요. 공연 설정에서 내용을 확인해 주세요.");
          }
          lastAttemptedDraft = resolved;
          try {
            await saveShowcaseDraft(productionId, editor.revision, resolved, { session: scopedSession });
            requireActive();
          } catch (error) {
            requireActive();
            // 응답이 유실돼도 서버 초안이 같으면 중복 저장 없이 완료 처리한다.
            const latest = await loadShowcaseEditor(productionId, { session: scopedSession });
            requireActive();
            if (!showcaseDocumentsEqual(latest.draft, resolved)) throw error;
          }
        }
      }
      requireActive();
      const destination = `/app/p/${productionId}/composition`;
      createProgress = "공연 작업으로 이동하고 있어요.";
      creationNavigationAllowed = true;
      try { await goto(destination); }
      finally { if (!disposed && operation === creationOperation && isCurrentSession(session)) creationNavigationAllowed = false; }
      if (!disposed && operation === creationOperation && isCurrentSession(session)) {
        toast.success("공연을 등록했어요. 대본과 자료를 추가해 주세요.");
        creating = false;
        createOpen = false;
        clearCreation();
      }
    } catch (error) {
      if (!disposed && operation === creationOperation && (!session || isCurrentSession(session))) {
        createError = error instanceof Error ? error.message : "공연을 등록하지 못했어요.";
      }
    } finally {
      request?.dispose();
      if (!disposed && operation === creationOperation && (!session || isCurrentSession(session))) { creating = false; createProgress = ""; }
    }
  }

  onMount(() => {
    const unsubscribe = subscribeSession(() => {
      if (creationSession && !isCurrentSession(creationSession)) {
        creationOperation += 1;
        creating = false;
        createProgress = "";
        creationNavigationAllowed = false;
        createOpen = false;
        clearCreation();
      }
    });
    void load();
    // 권한 확인 뒤 늦게 마운트되어 초기 navigation을 놓친 경우에도 현재 주소를 처리한다.
    openCreationFromUrl($page.url);
    return unsubscribe;
  });

  async function load() {
    const current = ++loadSequence;
    const session = captureSession();
    const active = () => current === loadSequence && isCurrentSession(session);
    if (!productions.length) loading = true;
    loadError = "";
    // 목록과 등록 현황을 따로 받아, 홍보 정보 조회가 늦어도 공연 작업을 먼저 열 수 있게 한다.
    const details = Promise.allSettled([loadReadiness(), loadShowcases()]);
    try {
      const result = await apiRequest<Production[]>("/productions");
      if (active()) productions = remember("admin:productions", result, session);
    } catch (error) {
      if (active()) {
        loadError = error instanceof Error ? error.message : "공연 목록을 불러오지 못했어요";
        toast.error(loadError);
      }
    } finally {
      if (active()) loading = false;
    }
    await details;
  }

  async function openMemos(production: Production) {
    memoTarget = production;
    memosLoading = true;
    newMemo = "";
    try {
      memos = await apiRequest<Memo[]>(`/productions/${production.id}/planning-memos`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "메모를 불러오지 못했어요");
      memos = [];
    } finally {
      memosLoading = false;
    }
  }

  async function addMemo() {
    if (!memoTarget || !newMemo.trim()) return;
    memoSaving = true;
    try {
      const created = await apiRequest<Memo>(`/productions/${memoTarget.id}/planning-memos`, {
        method: "POST",
        body: JSON.stringify({ body: newMemo.trim() })
      });
      memos = [created, ...memos];
      newMemo = "";
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "메모를 저장하지 못했어요");
    } finally {
      memoSaving = false;
    }
  }

  async function deleteMemo(memo: Memo) {
    if (!memoTarget) return;
    if (!await confirmation.ask("이 기획 메모를 삭제할까요? 삭제한 메모는 되돌릴 수 없어요.", "메모 삭제", "삭제")) return;
    try {
      await apiRequest(`/productions/${memoTarget.id}/planning-memos/${memo.id}`, { method: "DELETE" });
      memos = memos.filter((item) => item.id !== memo.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "메모를 삭제하지 못했어요");
    }
  }

  // 공연 삭제(소프트) — 실제 데이터는 남고 목록에서만 사라진다. 휴지통에서 복구 가능.
  let deleteTarget = $state<Production | null>(null);
  let inspectionOnly = $state(false);
  let impact = $state<DeletionImpact | null>(null);
  let impactLoading = $state(false);
  let impactError = $state("");
  let participantsConfirmed = $state(false);
  let impactSequence = 0;
  let confirmation: { ask: (message: string, heading?: string, label?: string) => Promise<boolean> };
  onDestroy(() => {
    disposed = true;
    creationAbort.abort();
    Object.values(pendingImages).forEach(revokePendingShowcaseImage);
    impactSequence += 1;
    loadSequence += 1;
    readinessSequence += 1;
    showcasesSequence += 1;
  });
  async function inspectProduction(production: Production, readOnly = false) {
    const current = ++impactSequence; deleteTarget = production; inspectionOnly = readOnly;
    impact = null; impactLoading = true; impactError = ""; participantsConfirmed = false;
    try { const result = await apiRequest<DeletionImpact>(`/admin/productions/${production.id}/deletion-impact`); if (current === impactSequence) impact = result; }
    catch (error) { if (current === impactSequence) impactError = error instanceof Error ? error.message : "연결 정보를 확인하지 못했어요."; }
    finally { if (current === impactSequence) impactLoading = false; }
  }
  function closeInspection() { if (deleting) return; impactSequence += 1; deleteTarget = null; impact = null; impactLoading = false; }
  let deleting = $state(false);
  let showTrash = $state(false);
  let trash = $state<Production[]>([]);
  let trashLoading = $state(false);
  let trashError = $state("");
  let restoringId = $state<string | null>(null);

  async function loadTrash() {
    trashLoading = true;
    trashError = "";
    try {
      trash = await apiRequest<Production[]>("/productions/deleted");
    } catch (error) {
      trashError = error instanceof Error ? error.message : "삭제된 공연을 불러오지 못했어요";
      toast.error(trashError);
      trash = [];
    } finally {
      trashLoading = false;
    }
  }

  async function toggleTrash() {
    showTrash = !showTrash;
    if (showTrash) await loadTrash();
  }

  async function confirmDelete() {
    if (!deleteTarget || deleting || impactLoading || !impact || inspectionOnly || impact.liveSessions > 0 || (impact.counts.members > 0 && !participantsConfirmed)) return;
    deleting = true;
    try {
      await apiRequest(`/productions/${deleteTarget.id}`, { method: "DELETE" });
      toast.success(`"${deleteTarget.title}" 공연을 휴지통으로 옮겼어요. 삭제된 공연에서 복구할 수 있어요.`);
      deleteTarget = null;
      await load();
      if (showTrash) await loadTrash();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "공연을 삭제하지 못했어요");
    } finally {
      deleting = false;
    }
  }

  async function restoreProduction(production: Production) {
    if (restoringId) return;
    if (!await confirmation.ask(`‘${production.title}’ 공연을 복구할까요? 기존 배정이 돌아오므로 일정과 참여자 안내를 확인해 주세요. 공연 소개는 복구 후 게시 상태를 확인해 주세요.`, "공연 복구", "복구")) return;
    restoringId = production.id;
    try {
      await apiRequest(`/productions/${production.id}/restore`, { method: "POST" });
      toast.success(`"${production.title}" 공연을 복구했어요.`);
      await Promise.all([load(), loadTrash()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "공연을 복구하지 못했어요");
    } finally {
      restoringId = null;
    }
  }
</script>

<svelte:head><title>공연 관리 — 운영 콘솔</title></svelte:head>
<ConfirmAction bind:this={confirmation} />
<PageHeader title="공연 관리" description="공연별 등록 현황을 확인하고, 필요한 항목부터 준비해 보세요.">
  {#snippet actions()}
    <Button variant={showTrash ? "secondary" : "ghost"} class="min-h-11" onclick={toggleTrash}>
      <Trash2Icon />
      삭제된 공연
    </Button>
    <Button class="min-h-11" onclick={() => setCreationOpen(true)}>
      <PlusIcon />
      공연 등록
    </Button>
  {/snippet}
</PageHeader>

{#if showTrash}
  <Card.Root class="border-dashed">
    <Card.Header class="pb-3">
      <Card.Title class="text-sm">삭제된 공연</Card.Title>
      <Card.Description>휴지통에서도 자료와 참여자 연결은 남아 있어요. 연결 정보를 확인한 뒤 복구해 주세요.</Card.Description>
    </Card.Header>
    <Card.Content>
      {#if trashLoading}
        <Skeleton class="h-16 w-full" />
      {:else if trashError}
        <div class="grid justify-items-center gap-2 py-2 text-center">
          <p role="alert" class="text-destructive text-sm">{trashError}</p>
          <Button type="button" variant="outline" size="sm" onclick={loadTrash}>다시 시도</Button>
        </div>
      {:else if trash.length === 0}
        <p class="text-muted-foreground py-2 text-center text-sm">휴지통에 있는 공연이 없어요.</p>
      {:else}
        <div class="grid gap-2">
          {#each trash as item (item.id)}
            <div class="border-border/60 flex items-center gap-3 rounded-xl border px-3 py-2.5">
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium">{item.title}</p>
                <p class="text-muted-foreground text-xs">
                  삭제됨 {item.deletedAt ? formatRelative(item.deletedAt) : ""}
                </p>
              </div>
              <Button type="button" variant="ghost" size="sm" onclick={() => inspectProduction(item, true)}>연결 정보</Button>
              <Button
                variant="outline"
                size="sm"
                class="h-8"
                onclick={() => restoreProduction(item)}
                disabled={restoringId === item.id}
              >
                <RotateCcwIcon />
                복구
              </Button>
            </div>
          {/each}
        </div>
      {/if}
    </Card.Content>
  </Card.Root>
{/if}

{#if loading}
  <div class="grid gap-4 md:grid-cols-2">
    {#each Array(4) as _, i (i)}
      <Skeleton class="h-36 w-full" />
    {/each}
  </div>
{:else if loadError && productions.length === 0}
  <Card.Root>
    <Card.Content class="grid justify-items-center gap-3 py-14 text-center">
      <p role="alert" class="text-destructive text-sm">{loadError}</p>
      <Button type="button" variant="outline" size="sm" onclick={load}>다시 시도</Button>
    </Card.Content>
  </Card.Root>
{:else if productions.length === 0}
  <EmptyState title="아직 등록된 공연이 없어요" description="공연 이름만 입력하면 시작할 수 있어요. 접수된 문의에서 공연을 만들 수도 있어요.">
    {#snippet action()}<div class="flex flex-wrap justify-center gap-2"><Button onclick={() => setCreationOpen(true)}>첫 공연 등록</Button><Button href="/admin/inquiries" variant="outline">공연 문의 확인</Button></div>{/snippet}
  </EmptyState>
{:else}
  <div class="space-y-4">
    <div class="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-2 text-xs" role="group" aria-label="등록 현황 안내">
      <span class="inline-flex items-center gap-1.5"><CheckIcon class="text-success size-3.5" aria-hidden="true" />등록됨</span>
      <span class="inline-flex items-center gap-1.5"><PlusIcon class="text-primary size-3.5" aria-hidden="true" />추가 필요</span>
      <span class="inline-flex items-center gap-1.5"><CircleMinusIcon class="size-3.5" aria-hidden="true" />해당 없음</span>
      <span>버튼을 누르면 해당 작업으로 이동해요.</span>
    </div>
    {#if loadError}
      <div role="alert" class="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 text-sm"><p>{loadError} 이전에 불러온 목록이에요.</p><Button variant="outline" class="min-h-11" onclick={load}>다시 불러오기</Button></div>
    {/if}
    {#if readinessError || showcasesError}
      <div class="bg-muted/25 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
        <div role="alert" class="min-w-0 text-sm leading-6">
          {#if readinessError}<p>자료 등록 현황을 불러오지 못했어요. 항목을 눌러 직접 확인할 수 있어요.</p>{/if}
          {#if showcasesError}<p>포스터와 공연 소개의 게시 상태를 확인하지 못했어요.</p>{/if}
        </div>
        <Button variant="outline" class="min-h-11" onclick={() => { if (readinessError) void loadReadiness(); if (showcasesError) void loadShowcases(); }}>다시 확인</Button>
      </div>
    {/if}
    <div id="production-list" class="grid scroll-mt-6 gap-4 xl:grid-cols-2">
      {#each productions as production (production.id)}
        {@const showcase = showcases[production.id]}
        {@const posterUrl = showcasesLoading || showcasesError ? null : showcase?.posterUrl}
        {@const posterFailed = Boolean(posterUrl && failedPosters[production.id] === posterUrl)}
        <Card.Root class={["min-w-0 gap-0 overflow-hidden py-0", production.archived && "opacity-60"]}>
          <Card.Header class="grid grid-cols-[4.75rem_minmax(0,1fr)] items-start gap-4 p-4 pb-4 sm:grid-cols-[5.5rem_minmax(0,1fr)] sm:p-5">
            <a href={`/app/p/${production.id}/manage/settings#showcase`} aria-label={`${production.title} 포스터와 공연 소개 설정`} class="bg-muted/50 text-muted-foreground focus-visible:ring-ring flex aspect-[2/3] w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-lg border text-center focus-visible:ring-3 focus-visible:outline-none">
              {#if posterUrl && !posterFailed}
                <img src={posterUrl} alt={`${production.title} 포스터`} class="h-full w-full object-cover" loading="lazy" onerror={() => { if (posterUrl) failedPosters[production.id] = posterUrl; }} />
              {:else}
                <ImageIcon class="size-6" aria-hidden="true" />
                <span class="px-1 text-[11px] leading-4">{showcasesLoading ? "확인 중" : showcasesError ? "조회 실패" : posterFailed ? "포스터 확인" : "포스터 추가"}</span>
              {/if}
            </a>
            <div class="min-w-0">
              <div class="mb-2 flex flex-wrap gap-1.5">
                <Badge variant="secondary">{PHASE_LABELS[production.currentPhase] ?? production.currentPhase}</Badge>
                {#if !showcasesLoading && !showcasesError}
                  <Badge variant="outline" class={showcase?.publishedAt ? "border-success/30 text-success" : "text-muted-foreground"}>{showcase?.publishedAt ? "공연 소개 게시 중" : "공연 소개 비공개"}</Badge>
                  {#if showcase?.hasDraftChanges}<Badge variant="outline" class="border-primary/30 text-primary">수정한 초안 있음</Badge>{/if}
                {/if}
              </div>
              <Card.Title class="line-clamp-2 break-words text-base leading-6"><a href={`/app/p/${production.id}`} class="hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">{production.title}</a></Card.Title>
              <Card.Description class="mt-2 space-y-1 text-xs leading-5"><span class="block break-words">{production.venue?.trim() || "장소 미정"}</span><span class="block">{performanceDates(production)}</span></Card.Description>
              <p class="text-muted-foreground mt-2 text-[11px]">등록 {formatRelative(production.createdAt)}</p>
            </div>
          </Card.Header>
          <Card.Content class="grid gap-4 p-4 pt-0 sm:p-5 sm:pt-0">
            <div class="grid grid-cols-2 gap-2 sm:grid-cols-3" role="group" aria-label={`${production.title} 등록 현황과 작업`}>
              {#each workStatuses(production) as item (item.key)}
                <a href={item.href} aria-label={`${production.title} · ${item.label} · ${item.state} · ${item.detail}`} class={["focus-visible:ring-ring hover:bg-muted/50 flex min-h-[4.25rem] min-w-0 flex-col justify-center gap-1 rounded-lg border px-3 py-2 transition-colors focus-visible:ring-3 focus-visible:outline-none", item.state === "추가 필요" && "border-primary/30 bg-primary/5", item.state === "등록됨" && "border-success/25 bg-success/5"]}>
                  <span class="flex items-center gap-1.5 text-sm font-medium">
                    {#if item.state === "등록됨"}<CheckIcon class="text-success size-3.5" aria-hidden="true" />{:else if item.state === "추가 필요"}<PlusIcon class="text-primary size-3.5" aria-hidden="true" />{:else if item.state === "해당 없음"}<CircleMinusIcon class="text-muted-foreground size-3.5" aria-hidden="true" />{:else}<CircleHelpIcon class="text-muted-foreground size-3.5" aria-hidden="true" />{/if}
                    {item.label}
                  </span>
                  <span class="text-muted-foreground line-clamp-2 text-[11px] leading-4">{item.state} · {item.detail}</span>
                </a>
              {/each}
            </div>
            <div class="flex flex-wrap items-center gap-2 border-t pt-3">
              <Button variant="outline" class="min-h-11" href={`/app/p/${production.id}`}><ExternalLinkIcon aria-hidden="true" />공연 작업 열기</Button>
              <Button variant="outline" class="min-h-11" href={`/app/p/${production.id}/manage/recruitment`}>배우·스태프 모집</Button>
              <Button variant="ghost" class="min-h-11" href={`/app/p/${production.id}/live`}><PlayIcon aria-hidden="true" />연습 열기</Button>
              <Button variant="ghost" class="min-h-11" onclick={() => openMemos(production)}><StickyNoteIcon aria-hidden="true" />기획 메모</Button>
              <div class="ml-auto flex items-center gap-1">
                <Button variant="ghost" class="min-h-11" href={`/admin/inquiries?productionId=${production.id}`}>연결 신청·상담</Button>
                <Button variant="ghost" size="icon-touch" class="text-muted-foreground hover:text-destructive shrink-0" title="휴지통으로 이동" aria-label={`${production.title} 휴지통으로 이동`} onclick={() => inspectProduction(production)}><Trash2Icon aria-hidden="true" /></Button>
              </div>
            </div>
          </Card.Content>
        </Card.Root>
      {/each}
    </div>
  </div>
{/if}

<!-- 새 공연 등록 -->
<Dialog.Root open={createOpen} onOpenChange={setCreationOpen}>
  <Dialog.Content showCloseButton={!creating} escapeKeydownBehavior={creating ? "ignore" : "close"} interactOutsideBehavior={creating ? "ignore" : "close"} class="flex max-h-[calc(100dvh-1rem)] min-h-0 flex-col gap-0 overflow-hidden p-0 sm:max-h-[90dvh] sm:max-w-2xl [&_[data-slot=dialog-close]]:size-11">
    <Dialog.Header class="shrink-0 border-b px-4 py-4 pe-14 text-start sm:ps-5">
      <Dialog.Title>공연 등록</Dialog.Title>
      <Dialog.Description>공연 이름만 입력해도 등록할 수 있어요.</Dialog.Description>
    </Dialog.Header>
    <form class="flex min-h-0 min-w-0 flex-col" onsubmit={createProduction} aria-busy={creating}>
      <div class="grid min-h-0 min-w-0 gap-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
        {#if createdProductionId}
          <div class="grid gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm leading-6">
            <p>공연 기본정보는 등록됐어요. 사진 저장을 다시 시도해 주세요.</p>
            <a class="w-fit underline underline-offset-4" href={`/app/p/${createdProductionId}/manage/settings#showcase`}>공연 설정에서 확인</a>
          </div>
        {/if}
        <FormField label="공연 이름 (필수)" for="npTitle" hint="준비 중인 이름을 적어도 돼요. 나중에 수정할 수 있어요.">
          <Input id="npTitle" class="min-h-11" bind:value={createTitle} required maxlength={120} placeholder="예: 따뜻한 것들의 무게" aria-describedby="npTitle-hint" disabled={creating || Boolean(createdProductionId)} />
        </FormField>
        <details class="min-w-0 rounded-xl border" bind:open={createDetailsOpen}>
          <summary class="min-h-11 cursor-pointer rounded-xl px-3 py-3 text-sm font-medium">장소·공연일·소개 추가 <span class="text-muted-foreground font-normal">(선택)</span></summary>
          <div class="grid min-w-0 gap-4 border-t px-3 py-4">
            <p class="text-muted-foreground text-xs leading-6">아직 정해지지 않았다면 비워 두어도 괜찮아요. 공연 기본정보에서 언제든 추가할 수 있어요.</p>
            <div class="grid min-w-0 gap-3 sm:grid-cols-2">
              <FormField label="장소" for="npVenue"><Input id="npVenue" class="min-h-11" bind:value={createVenue} maxlength={120} placeholder="예: 합정 소극장" disabled={creating || Boolean(createdProductionId)} /></FormField>
              <FormField label="공연 시작일" for="npDate"><Input id="npDate" class="min-h-11" type="date" bind:value={createDate} disabled={creating || Boolean(createdProductionId)} /></FormField>
            </div>
            <FormField label="한 줄 소개" for="npSynopsis"><Input id="npSynopsis" class="min-h-11" bind:value={createSynopsis} maxlength={200} placeholder="예: 이웃의 이야기를 담은 낭독 뮤지컬" disabled={creating || Boolean(createdProductionId)} /></FormField>
          </div>
        </details>
        <details class="min-w-0 rounded-xl border">
          <summary class="min-h-11 cursor-pointer rounded-xl px-3 py-3 text-sm font-medium">포스터·홍보 사진 추가 <span class="text-muted-foreground font-normal">(선택)</span></summary>
          <div class="grid min-w-0 gap-3 border-t px-3 py-4">
            <p class="text-muted-foreground text-xs leading-5">사진은 공연 소개 초안에 저장돼요. 소개 공개는 공연 설정에서 할 수 있어요.</p>
            <ImageDropzone label="등록할 공연 포스터 선택" disabled={creating} onFiles={(files) => selectCreationImages(files, true)} />
            {#if createPosterId && pendingImages[createPosterId]}
              {@const poster = pendingImages[createPosterId]}
              <div class="flex min-w-0 items-center gap-3 rounded-lg border p-3">
                <img src={poster.previewUrl} alt="등록할 공연 포스터 미리보기" class="h-28 w-20 shrink-0 rounded-md object-contain" />
                <div class="min-w-0 flex-1"><p class="break-all text-xs">{poster.file.name}</p><Button type="button" variant="ghost" class="mt-1 min-h-11" aria-label="포스터 선택 취소" disabled={creating} onclick={() => createPosterId && removeCreationImage(createPosterId)}>선택 취소</Button></div>
              </div>
            {/if}
            <ImageDropzone label="등록할 홍보 사진 추가" hint={`PNG·JPEG·WebP · 한 장당 최대 10MB · ${createGalleryIds.length}/8장 선택`} multiple disabled={creating || createGalleryIds.length >= 8} onFiles={(files) => selectCreationImages(files, false)} />
            {#if createGalleryIds.length}
              <div class="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4">
                {#each createGalleryIds as id, index (id)}
                  {@const image = pendingImages[id]}
                  {#if image}<div class="min-w-0 overflow-hidden rounded-lg border p-2"><img src={image.previewUrl} alt={`등록할 홍보 사진 ${index + 1} 미리보기`} class="aspect-square w-full rounded-md object-cover" /><p class="mt-2 truncate text-xs" title={image.file.name}>{image.file.name}</p><Button type="button" variant="ghost" class="mt-1 min-h-11 w-full" aria-label={`홍보 사진 ${index + 1} 제거`} disabled={creating} onclick={() => removeCreationImage(id)}>제거</Button></div>{/if}
                {/each}
              </div>
            {/if}
          </div>
        </details>
      </div>
      {#if createError || creating}
        <div class="shrink-0 border-t px-4 py-2">
          {#if createError}<p role="alert" class="text-destructive break-words text-sm leading-6">{createError}</p>{/if}
          {#if creating}<p role="status" class="text-muted-foreground text-sm">{createProgress}</p>{/if}
        </div>
      {/if}
      <Dialog.Footer class="mx-0 mb-0 shrink-0 flex-row justify-end gap-2 rounded-none px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-5">
        <Button type="button" variant="ghost" size="touch" onclick={() => setCreationOpen(false)} disabled={creating}>{createdProductionId ? "나중에 계속" : "취소"}</Button>
        <Button type="submit" size="touch" disabled={creating || !createTitle.trim()}>{creating ? "등록 중…" : createdProductionId ? "사진 저장 다시 시도" : "등록하고 대본 준비"}</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root open={memoTarget !== null} onOpenChange={(open) => !open && (memoTarget = null)}>
  <Dialog.Content class="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
    {#if memoTarget}
      <Dialog.Header>
        <Dialog.Title>기획 메모 — {memoTarget.title}</Dialog.Title>
        <Dialog.Description>제작진만 볼 수 있는 메모예요. 다른 참여자에게는 보이지 않아요.</Dialog.Description>
      </Dialog.Header>

      <div class="grid gap-2">
        <Textarea bind:value={newMemo} rows={3} placeholder="견적, 조율할 내용, 아이디어 등을 남겨 주세요" aria-label="새 기획 메모" />
        <div class="flex justify-end">
          <Button size="sm" onclick={addMemo} disabled={memoSaving || !newMemo.trim()}>
            {memoSaving ? "저장 중..." : "메모 추가"}
          </Button>
        </div>
      </div>

      {#if memosLoading}
        <div class="space-y-2">
          {#each Array(3) as _, i (i)}
            <Skeleton class="h-16 w-full" />
          {/each}
        </div>
      {:else if memos.length === 0}
        <p class="text-muted-foreground py-6 text-center text-sm">아직 기획 메모가 없어요.</p>
      {:else}
        <ul class="space-y-3">
          {#each memos as memo (memo.id)}
            <li class="border-border/60 rounded-lg border p-3">
              <p class="text-sm leading-relaxed whitespace-pre-wrap">{memo.body}</p>
              <div class="text-muted-foreground mt-2 flex items-center justify-between text-xs">
                <span>
                  {memo.author.name} · {formatRelative(memo.createdAt)}
                  {#if memo.inquiry}
                    · 문의: {memo.inquiry.orgName}
                  {/if}
                </span>
                <Button variant="ghost" size="sm" class="h-6 px-2 text-xs" onclick={() => deleteMemo(memo)}>
                  삭제
                </Button>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </Dialog.Content>
</Dialog.Root>

<!-- 공연 삭제 확인 -->
<Dialog.Root bind:open={() => deleteTarget !== null, (open) => { if (!open) closeInspection(); }}>
  <Dialog.Content showCloseButton={!deleting} class="flex max-h-[90dvh] flex-col sm:max-w-2xl">
    <Dialog.Header><Dialog.Title>{inspectionOnly ? "삭제된 공연 연결 정보" : "휴지통으로 이동"}</Dialog.Title><Dialog.Description>{deleteTarget?.title} 공연의 참여자·자료·연결 신청을 확인해 주세요.</Dialog.Description></Dialog.Header>
    <div class="min-h-0 space-y-4 overflow-y-auto pr-1">
      {#if impactLoading}<Skeleton class="h-44 w-full" />{:else if impact}<ProductionImpact {impact} />{#if !inspectionOnly && impact.counts.members > 0}<label class="flex cursor-pointer items-start gap-3 rounded-lg border p-4 text-sm leading-7"><input type="checkbox" bind:checked={participantsConfirmed} disabled={deleting} class="mt-1.5 size-4 shrink-0" /><span>이 공연의 참여자 접근과 일정에 미치는 영향을 확인했어요. 회원 계정과 다른 공연 배정은 그대로 유지돼요.</span></label>{/if}{/if}
      {#if impactError}<p role="alert" class="text-sm text-destructive">{impactError}</p><Button type="button" variant="outline" onclick={() => deleteTarget && inspectProduction(deleteTarget, inspectionOnly)}>다시 확인</Button>{/if}
    </div>
    <Dialog.Footer class="gap-2 border-t pt-4"><Button type="button" variant="outline" onclick={closeInspection} disabled={deleting}>{inspectionOnly ? "닫기" : "취소"}</Button>{#if !inspectionOnly}<Button type="button" variant="destructive" onclick={confirmDelete} disabled={deleting || impactLoading || !impact || impact.liveSessions > 0 || (impact.counts.members > 0 && !participantsConfirmed)}>{deleting ? "처리 중…" : "휴지통으로 이동"}</Button>{/if}</Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
