<script lang="ts">
  import { onMount } from "svelte";
  import { toast } from "svelte-sonner";
  import * as Card from "$lib/components/ui/card";
  import * as Dialog from "$lib/components/ui/dialog";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import { Textarea } from "$lib/components/ui/textarea";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { apiRequest } from "$lib/api/client";
  import { PHASE_LABELS, VISIBILITY_LABELS, formatDate, formatRelative } from "$lib/domain/labels";
  import StickyNoteIcon from "@lucide/svelte/icons/sticky-note";
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import RotateCcwIcon from "@lucide/svelte/icons/rotate-ccw";

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

  let productions = $state<Production[]>([]);
  let loading = $state(true);

  let memoTarget = $state<Production | null>(null);
  let memos = $state<Memo[]>([]);
  let memosLoading = $state(false);
  let newMemo = $state("");
  let memoSaving = $state(false);

  // 새 공연 등록
  let createOpen = $state(false);
  let createTitle = $state("");
  let createVenue = $state("");
  let createDate = $state("");
  let createSynopsis = $state("");
  let creating = $state(false);

  async function createProduction(event: SubmitEvent) {
    event.preventDefault();
    if (!createTitle.trim()) return;
    creating = true;
    try {
      const created = await apiRequest<{ id: string }>("/productions", {
        method: "POST",
        body: JSON.stringify({
          title: createTitle.trim(),
          venue: createVenue.trim() || undefined,
          startDate: createDate ? new Date(createDate).toISOString() : undefined,
          synopsis: createSynopsis.trim() || undefined
        })
      });
      toast.success("공연을 등록했습니다. 워크스페이스에서 참여자와 큐시트를 준비하세요.");
      createOpen = false;
      createTitle = "";
      createVenue = "";
      createDate = "";
      createSynopsis = "";
      await load();
      void created;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "공연을 등록하지 못했습니다");
    } finally {
      creating = false;
    }
  }

  onMount(load);

  async function load() {
    loading = true;
    try {
      productions = await apiRequest<Production[]>("/productions");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "공연 목록을 불러오지 못했습니다");
    } finally {
      loading = false;
    }
  }

  async function openMemos(production: Production) {
    memoTarget = production;
    memosLoading = true;
    newMemo = "";
    try {
      memos = await apiRequest<Memo[]>(`/productions/${production.id}/planning-memos`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "메모를 불러오지 못했습니다");
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
      toast.error(error instanceof Error ? error.message : "메모를 저장하지 못했습니다");
    } finally {
      memoSaving = false;
    }
  }

  async function deleteMemo(memo: Memo) {
    if (!memoTarget) return;
    try {
      await apiRequest(`/productions/${memoTarget.id}/planning-memos/${memo.id}`, { method: "DELETE" });
      memos = memos.filter((item) => item.id !== memo.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "메모를 삭제하지 못했습니다");
    }
  }

  // 공연 삭제(소프트) — 실제 데이터는 남고 목록에서만 사라진다. 휴지통에서 복구 가능.
  let deleteTarget = $state<Production | null>(null);
  let deleting = $state(false);
  let showTrash = $state(false);
  let trash = $state<Production[]>([]);
  let trashLoading = $state(false);
  let restoringId = $state<string | null>(null);

  async function loadTrash() {
    trashLoading = true;
    try {
      trash = await apiRequest<Production[]>("/productions/deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "삭제된 공연을 불러오지 못했습니다");
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
    if (!deleteTarget) return;
    deleting = true;
    try {
      await apiRequest(`/productions/${deleteTarget.id}`, { method: "DELETE" });
      toast.success(`"${deleteTarget.title}" 공연을 삭제했습니다. 삭제된 공연에서 복구할 수 있어요.`);
      deleteTarget = null;
      await load();
      if (showTrash) await loadTrash();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "공연을 삭제하지 못했습니다");
    } finally {
      deleting = false;
    }
  }

  async function restoreProduction(production: Production) {
    restoringId = production.id;
    try {
      await apiRequest(`/productions/${production.id}/restore`, { method: "POST" });
      toast.success(`"${production.title}" 공연을 복구했습니다.`);
      await Promise.all([load(), loadTrash()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "공연을 복구하지 못했습니다");
    } finally {
      restoringId = null;
    }
  }
</script>

<div class="flex items-center justify-between gap-2">
  <p class="text-muted-foreground text-sm">모든 공연을 관리합니다. 워크스페이스에서 대본·큐·일정을 다룹니다.</p>
  <div class="flex shrink-0 gap-1.5">
    <Button variant={showTrash ? "secondary" : "ghost"} size="sm" onclick={toggleTrash}>
      <Trash2Icon />
      삭제된 공연
    </Button>
    <Button onclick={() => (createOpen = true)}>
      <PlusIcon />
      새 공연
    </Button>
  </div>
</div>

{#if showTrash}
  <Card.Root class="border-dashed">
    <Card.Header class="pb-3">
      <Card.Title class="text-sm">삭제된 공연</Card.Title>
      <Card.Description>삭제해도 데이터는 남아 있어요. 복구하면 목록으로 되돌아옵니다.</Card.Description>
    </Card.Header>
    <Card.Content>
      {#if trashLoading}
        <Skeleton class="h-16 w-full" />
      {:else if trash.length === 0}
        <p class="text-muted-foreground py-2 text-center text-sm">삭제된 공연이 없습니다.</p>
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
{:else if productions.length === 0}
  <Card.Root>
    <Card.Content class="py-14 text-center">
      <p class="text-muted-foreground text-sm">아직 등록된 공연이 없습니다. 새 공연을 만들거나 문의를 전환해 보세요.</p>
    </Card.Content>
  </Card.Root>
{:else}
  <div class="grid gap-4 md:grid-cols-2">
    {#each productions as production (production.id)}
      <Card.Root class={production.archived ? "opacity-60" : ""}>
        <Card.Header>
          <div class="flex items-start justify-between gap-2">
            <Card.Title class="text-base leading-snug">{production.title}</Card.Title>
            <div class="flex shrink-0 gap-1.5">
              <Badge variant={production.visibility === "PUBLISHED" ? "default" : "outline"}>
                {VISIBILITY_LABELS[production.visibility] ?? production.visibility}
              </Badge>
              <Badge variant="secondary">{PHASE_LABELS[production.currentPhase] ?? production.currentPhase}</Badge>
            </div>
          </div>
          <Card.Description>
            {production.venue ?? "장소 미정"}
            {#if production.startDate}
              · {formatDate(production.startDate)}
            {/if}
          </Card.Description>
        </Card.Header>
        <Card.Content class="grid gap-3">
          <div class="flex items-center justify-between">
            <span class="text-muted-foreground text-xs">등록 {formatRelative(production.createdAt)}</span>
            <div class="flex gap-1.5">
              <Button variant="outline" size="sm" onclick={() => openMemos(production)}>
                <StickyNoteIcon />
                기획 메모
              </Button>
              <Button variant="outline" size="sm" href={`/app/p/${production.id}`}>
                <ExternalLinkIcon />
                워크스페이스
              </Button>
              <Button
                variant="ghost"
                size="icon"
                class="text-muted-foreground hover:text-destructive size-8 shrink-0"
                title="공연 삭제"
                aria-label="공연 삭제"
                onclick={() => (deleteTarget = production)}
              >
                <Trash2Icon />
              </Button>
            </div>
          </div>
          <div class="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs">
            <span class="font-medium">제작 관리</span>
            <a class="hover:text-foreground underline-offset-2 hover:underline" href={`/app/p/${production.id}/manage/script`}>대본 편집</a>
            <a class="hover:text-foreground underline-offset-2 hover:underline" href={`/app/p/${production.id}/manage/casting`}>캐스팅</a>
            <a class="hover:text-foreground underline-offset-2 hover:underline" href={`/app/p/${production.id}/manage/members`}>멤버</a>
            <a class="hover:text-foreground underline-offset-2 hover:underline" href={`/app/p/${production.id}/manage/settings`}>공연 설정</a>
            <a class="hover:text-foreground underline-offset-2 hover:underline" href={`/app/p/${production.id}/cuesheet`}>큐시트</a>
          </div>
        </Card.Content>
      </Card.Root>
    {/each}
  </div>
{/if}

<!-- 새 공연 등록 -->
<Dialog.Root bind:open={createOpen}>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>새 공연</Dialog.Title>
      <Dialog.Description>기본 정보만 적으면 됩니다. 나머지는 워크스페이스에서 준비합니다.</Dialog.Description>
    </Dialog.Header>
    <form class="grid gap-4" onsubmit={createProduction}>
      <div class="grid gap-2">
        <Label for="npTitle">공연 이름 <span class="text-destructive">*</span></Label>
        <Input id="npTitle" bind:value={createTitle} required maxlength={120} placeholder="예: 따뜻한 것들의 무게" />
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div class="grid gap-2">
          <Label for="npVenue">장소</Label>
          <Input id="npVenue" bind:value={createVenue} maxlength={120} placeholder="미정이면 비워두세요" />
        </div>
        <div class="grid gap-2">
          <Label for="npDate">공연일</Label>
          <Input id="npDate" type="date" bind:value={createDate} />
        </div>
      </div>
      <div class="grid gap-2">
        <Label for="npSynopsis">한 줄 소개</Label>
        <Input id="npSynopsis" bind:value={createSynopsis} maxlength={200} placeholder="공연을 한 문장으로" />
      </div>
      <Dialog.Footer class="gap-2">
        <Button type="button" variant="ghost" onclick={() => (createOpen = false)} disabled={creating}>취소</Button>
        <Button type="submit" disabled={creating || !createTitle.trim()}>
          {creating ? "등록 중..." : "등록"}
        </Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root open={memoTarget !== null} onOpenChange={(open) => !open && (memoTarget = null)}>
  <Dialog.Content class="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
    {#if memoTarget}
      <Dialog.Header>
        <Dialog.Title>기획 메모 — {memoTarget.title}</Dialog.Title>
        <Dialog.Description>제작진만 볼 수 있습니다. 참여자에게는 노출되지 않습니다.</Dialog.Description>
      </Dialog.Header>

      <div class="grid gap-2">
        <Textarea bind:value={newMemo} rows={3} placeholder="견적, 조율 사항, 아이디어 등을 남깁니다" />
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
        <p class="text-muted-foreground py-6 text-center text-sm">아직 메모가 없습니다.</p>
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
<Dialog.Root open={deleteTarget !== null} onOpenChange={(open) => !open && (deleteTarget = null)}>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>공연 삭제</Dialog.Title>
      <Dialog.Description>
        {#if deleteTarget}<span class="text-foreground font-semibold">「{deleteTarget.title}」</span>{/if} 공연을 삭제할까요?
      </Dialog.Description>
    </Dialog.Header>
    <div class="bg-muted/50 text-muted-foreground rounded-xl px-4 py-3 text-sm">
      목록과 참여자·배우 화면에서 사라지지만, <span class="text-foreground font-medium">데이터는 지워지지 않고 보관</span>됩니다.
      "삭제된 공연"에서 언제든 복구할 수 있어요.
    </div>
    <Dialog.Footer class="gap-2">
      <Button variant="ghost" onclick={() => (deleteTarget = null)} disabled={deleting}>취소</Button>
      <Button variant="destructive" onclick={confirmDelete} disabled={deleting}>삭제</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
