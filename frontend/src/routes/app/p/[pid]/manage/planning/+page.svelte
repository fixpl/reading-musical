<script lang="ts">
  import { page } from "$app/stores";
  import { toast } from "svelte-sonner";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Textarea } from "$lib/components/ui/textarea";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import { Label } from "$lib/components/ui/label";
  import { ConfirmDialog, type ConfirmAsk } from "$lib/components/ui/confirm-dialog";
  import { ErrorPanel } from "$lib/components/ui/error-panel";
  import { EmptyState } from "$lib/components/ui/empty-state";
  import { PageHeader } from "$lib/components/ui/page-header";
  import { apiRequest, ApiError } from "$lib/api/client";
  import { fetchCurrentUser } from "$lib/api/auth";
  import { formatDateTime } from "$lib/domain/labels";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";

  type Memo = {
    id: string;
    body: string;
    createdAt: string;
    author: { id: string; name: string } | null;
    inquiry: { id: string; orgName: string; status: string } | null;
  };

  const pid = $derived($page.params.pid ?? "");

  let memos = $state<Memo[]>([]);
  let loading = $state(true);
  let forbidden = $state(false);
  let myId = $state<string | null>(null);
  let isAdmin = $state(false);
  let loadError = $state("");
  let confirmation: { ask: ConfirmAsk };

  // 새 메모 작성
  let draft = $state("");
  let saving = $state(false);

  // 인라인 편집
  let editingId = $state<string | null>(null);
  let editBody = $state("");
  let updating = $state(false);

  // 공연이 바뀌면 이전 공연의 메모·작성 중인 글이 남지 않도록 pid마다 다시 불러온다.
  $effect(() => {
    const id = pid;
    memos = [];
    forbidden = false;
    draft = "";
    editingId = null;
    editBody = "";
    void load(id);
  });

  async function load(id: string) {
    loading = true;
    forbidden = false;
    loadError = "";
    try {
      const [me, list] = await Promise.all([
        fetchCurrentUser().catch(() => null),
        apiRequest<Memo[]>(`/productions/${id}/planning-memos`)
      ]);
      if (id !== pid) return;
      myId = me?.id ?? null;
      isAdmin = me?.platformRole === "SUPER_ADMIN" || me?.platformRole === "ORG_ADMIN";
      memos = list;
    } catch (error) {
      if (id !== pid) return;
      if (error instanceof ApiError && error.status === 403) {
        forbidden = true;
      } else {
        loadError = error instanceof Error ? error.message : "기획 메모를 불러오지 못했어요";
      }
    } finally {
      if (id === pid) loading = false;
    }
  }

  function canModify(memo: Memo) {
    return isAdmin || (myId != null && memo.author?.id === myId);
  }

  async function addMemo() {
    const body = draft.trim();
    if (!body) {
      toast.error("내용을 입력해 주세요");
      return;
    }
    saving = true;
    try {
      await apiRequest(`/productions/${pid}/planning-memos`, {
        method: "POST",
        body: JSON.stringify({ body })
      });
      draft = "";
      toast.success("기획 메모를 추가했어요");
      await load(pid);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "메모를 저장하지 못했어요");
    } finally {
      saving = false;
    }
  }

  function startEdit(memo: Memo) {
    editingId = memo.id;
    editBody = memo.body;
  }

  function cancelEdit() {
    editingId = null;
    editBody = "";
  }

  async function saveEdit(memo: Memo) {
    const body = editBody.trim();
    if (!body) {
      toast.error("내용을 입력해 주세요");
      return;
    }
    updating = true;
    try {
      await apiRequest(`/productions/${pid}/planning-memos/${memo.id}`, {
        method: "PATCH",
        body: JSON.stringify({ body })
      });
      cancelEdit();
      toast.success("메모를 수정했어요");
      await load(pid);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "메모를 수정하지 못했어요");
    } finally {
      updating = false;
    }
  }

  async function removeMemo(memo: Memo) {
    const { confirmed } = await confirmation.ask({ title: "기획 메모를 삭제할까요?", description: "삭제한 메모는 되돌릴 수 없어요.", confirmLabel: "메모 삭제", destructive: true });
    if (!confirmed) return;
    try {
      await apiRequest(`/productions/${pid}/planning-memos/${memo.id}`, { method: "DELETE" });
      toast.success("메모를 삭제했어요");
      await load(pid);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "메모를 삭제하지 못했어요");
    }
  }
</script>

<svelte:head><title>기획 메모 — 아트브릿지</title></svelte:head>

<ConfirmDialog bind:this={confirmation} />

<div class="mx-auto grid w-full max-w-3xl gap-6">
  <PageHeader title="기획 메모" description="공연 구성·인원·예산과 협의 내용을 기록해요. 신청 문의에서 옮긴 기획 내용도 여기에 모여요.">
    {#snippet actions()}
      <Button href={`/app/p/${pid}/manage/members`} variant="outline" size="touch">멤버 관리</Button>
      <Button href={`/app/p/${pid}/schedule`} variant="outline" size="touch">일정 등록</Button>
    {/snippet}
  </PageHeader>

  <!-- 새 메모 작성 -->
  {#if !loading && !forbidden && !loadError}
    <div class="bg-card grid gap-3 rounded-2xl border p-4 sm:p-5">
      <Label for="planning-draft">새 기획 메모</Label>
      <Textarea
        id="planning-draft"
        bind:value={draft}
        rows={4}
        placeholder="예) 1막은 낭독 위주, 2막에 넘버 3곡 추가. 배우 6명 / 스태프 3명. 리허설 3회 협의."
        class="resize-y"
      />
      <div class="flex justify-end">
        <Button size="touch" onclick={addMemo} disabled={saving || !draft.trim()}>
          {saving ? "저장 중…" : "메모 추가"}
        </Button>
      </div>
    </div>
  {/if}

  <!-- 목록 -->
  {#if loading}
    <div class="grid gap-3">
      {#each Array(3) as _, index (index)}
        <Skeleton class="h-28 w-full rounded-2xl" />
      {/each}
    </div>
  {:else if forbidden}
    <section class="bg-card rounded-2xl border p-8 text-center" role="alert">
      <h2 class="font-semibold">이 화면을 관리할 권한이 없어요</h2>
      <p class="text-muted-foreground mt-2 text-sm">기획 메모는 제작진만 볼 수 있어요.</p>
    </section>
  {:else if loadError}
    <ErrorPanel title="기획 메모를 불러오지 못했어요" message={loadError} onRetry={() => load(pid)} />
  {:else if memos.length === 0}
    <EmptyState title="아직 기획 메모가 없어요" description="새 기획 메모에 첫 내용을 적어 주세요. 신청 문의를 공연으로 전환하면 기획 내용도 함께 옮겨져요." />
  {:else}
    <div class="grid gap-3">
      <p class="text-muted-foreground text-xs font-semibold tracking-wide uppercase">기획 메모 {memos.length}</p>
      {#each memos as memo (memo.id)}
        <div class="bg-card grid gap-3 rounded-2xl border p-4 sm:p-5">
          {#if editingId === memo.id}
            <Label for={`planning-edit-${memo.id}`}>기획 메모 수정</Label>
            <Textarea id={`planning-edit-${memo.id}`} bind:value={editBody} rows={5} class="resize-y" />
            <div class="flex justify-end gap-2">
              <Button variant="ghost" size="touch" onclick={cancelEdit} disabled={updating}>취소</Button>
              <Button size="touch" onclick={() => saveEdit(memo)} disabled={updating || !editBody.trim()}>
                {updating ? "저장 중…" : "저장"}
              </Button>
            </div>
          {:else}
            <p class="text-[15px] leading-relaxed whitespace-pre-wrap">{memo.body}</p>
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
              {#if memo.inquiry}
                <Badge variant="secondary" class="font-normal">신청 문의 · {memo.inquiry.orgName}</Badge>
              {/if}
              <span class="text-muted-foreground text-xs">
                {memo.author?.name ?? "알 수 없음"} · {formatDateTime(memo.createdAt)}
              </span>
              {#if canModify(memo)}
                <span class="ms-auto flex items-center gap-1">
                  <Button variant="ghost" size="icon-touch" class="size-11" onclick={() => startEdit(memo)} aria-label="기획 메모 수정">
                    <PencilIcon class="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-touch"
                    class="text-destructive hover:text-destructive size-11"
                    onclick={() => removeMemo(memo)}
                    aria-label="기획 메모 삭제"
                  >
                    <Trash2Icon class="size-3.5" />
                  </Button>
                </span>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
