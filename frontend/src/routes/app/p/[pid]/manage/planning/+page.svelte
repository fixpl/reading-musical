<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/stores";
  import { toast } from "svelte-sonner";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Textarea } from "$lib/components/ui/textarea";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import { apiRequest } from "$lib/api/client";
  import { fetchCurrentUser } from "$lib/api/auth";
  import { formatDateTime } from "$lib/domain/labels";
  import NotebookPenIcon from "@lucide/svelte/icons/notebook-pen";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import InboxIcon from "@lucide/svelte/icons/inbox";

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
  let myId = $state<string | null>(null);
  let isAdmin = $state(false);

  // 새 메모 작성
  let draft = $state("");
  let saving = $state(false);

  // 인라인 편집
  let editingId = $state<string | null>(null);
  let editBody = $state("");
  let updating = $state(false);

  onMount(load);

  async function load() {
    loading = true;
    try {
      const [me, list] = await Promise.all([
        fetchCurrentUser().catch(() => null),
        apiRequest<Memo[]>(`/productions/${pid}/planning-memos`)
      ]);
      myId = me?.id ?? null;
      isAdmin = me?.platformRole === "SUPER_ADMIN" || me?.platformRole === "ORG_ADMIN";
      memos = list;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "기획 메모를 불러오지 못했습니다");
    } finally {
      loading = false;
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
      toast.success("기획 메모를 추가했습니다");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "메모를 저장하지 못했습니다");
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
      toast.success("메모를 수정했습니다");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "메모를 수정하지 못했습니다");
    } finally {
      updating = false;
    }
  }

  async function removeMemo(memo: Memo) {
    if (!confirm("이 기획 메모를 삭제할까요?")) return;
    try {
      await apiRequest(`/productions/${pid}/planning-memos/${memo.id}`, { method: "DELETE" });
      toast.success("메모를 삭제했습니다");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "메모를 삭제하지 못했습니다");
    }
  }
</script>

<div class="mx-auto grid w-full max-w-3xl gap-6 p-4 sm:p-6">
  <!-- 헤더 -->
  <div class="grid gap-1">
    <div class="flex items-center gap-2">
      <NotebookPenIcon class="text-primary size-5" />
      <h1 class="text-xl font-semibold sm:text-2xl">기획 메모</h1>
    </div>
    <p class="text-muted-foreground text-sm">
      공연 신청 문의와 공연 관리에서 정리한 기획 내용이 모두 여기에 모입니다. 프로그램 구성·인원·일정·견적·협의
      사항을 자유롭게 기록하세요.
    </p>
  </div>

  <!-- 새 메모 작성 -->
  <div class="bg-card grid gap-3 rounded-2xl border p-4 sm:p-5">
    <Textarea
      bind:value={draft}
      rows={4}
      placeholder="예) 1막은 낭독 위주, 2막에 넘버 3곡 추가. 배우 6명 / 스텝 3명. 리허설 3회 협의."
      class="resize-y"
    />
    <div class="flex justify-end">
      <Button onclick={addMemo} disabled={saving || !draft.trim()}>
        {saving ? "저장 중…" : "메모 추가"}
      </Button>
    </div>
  </div>

  <!-- 목록 -->
  {#if loading}
    <div class="grid gap-3">
      {#each Array(3) as _}
        <Skeleton class="h-28 w-full rounded-2xl" />
      {/each}
    </div>
  {:else if memos.length === 0}
    <div class="text-muted-foreground grid place-items-center gap-2 rounded-2xl border border-dashed py-14 text-center">
      <InboxIcon class="size-8 opacity-50" />
      <p class="text-sm">아직 기획 메모가 없습니다.</p>
      <p class="text-xs">위 입력란에 첫 메모를 작성하거나, 신청 문의를 공연으로 전환하면 기획 내용이 여기로 옮겨집니다.</p>
    </div>
  {:else}
    <div class="grid gap-3">
      <p class="text-muted-foreground text-xs font-semibold tracking-wide uppercase">기획 메모 {memos.length}</p>
      {#each memos as memo (memo.id)}
        <div class="bg-card grid gap-3 rounded-2xl border p-4 sm:p-5">
          {#if editingId === memo.id}
            <Textarea bind:value={editBody} rows={5} class="resize-y" />
            <div class="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onclick={cancelEdit} disabled={updating}>취소</Button>
              <Button size="sm" onclick={() => saveEdit(memo)} disabled={updating || !editBody.trim()}>
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
                  <Button variant="ghost" size="icon" class="size-7" onclick={() => startEdit(memo)} title="수정">
                    <PencilIcon class="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="text-destructive hover:text-destructive size-7"
                    onclick={() => removeMemo(memo)}
                    title="삭제"
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
