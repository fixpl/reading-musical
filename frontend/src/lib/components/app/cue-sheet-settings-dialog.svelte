<script lang="ts">
  import { toast } from "svelte-sonner";
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { apiRequest } from "$lib/api/client";

  type Track = {
    id: string;
    name: string;
    order: number;
    ownerMembership: { id: string; user: { id: string; name: string } } | null;
  };
  type Person = { id: string; user: { name: string } };

  let {
    pid,
    open = $bindable(false),
    tracks,
    cueCount,
    canManage,
    palette,
    onReloaded
  }: {
    pid: string;
    open: boolean;
    tracks: Track[];
    cueCount: number;
    canManage: boolean;
    palette: string[];
    /** 트랙/큐 변경 후 부모가 큐시트를 다시 불러오도록 호출. */
    onReloaded: () => void | Promise<void>;
  } = $props();

  let people = $state<Person[]>([]);
  let newTrackName = $state("");
  let newTrackOwner = $state("");
  let trackSaving = $state(false);

  $effect(() => {
    if (open && people.length === 0) {
      void apiRequest<{ people: Person[] }>(`/productions/${pid}/people`)
        .then((result) => (people = result.people))
        .catch(() => {
          // 담당자 선택은 선택 사항이므로 실패해도 다이얼로그는 연다.
        });
    }
  });

  async function importMusic() {
    trackSaving = true;
    try {
      const result = await apiRequest<{ imported: number }>(`/productions/${pid}/cue-sheet/tracks/import-music`, {
        method: "POST"
      });
      toast.success(
        result.imported > 0 ? `음악 큐 ${result.imported}개를 가져왔습니다` : "가져올 새 음악 큐가 없습니다"
      );
      await onReloaded();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "가져오지 못했습니다");
    } finally {
      trackSaving = false;
    }
  }

  async function addTrack(event: SubmitEvent) {
    event.preventDefault();
    if (!newTrackName.trim()) return;
    trackSaving = true;
    try {
      await apiRequest(`/productions/${pid}/cue-sheet/tracks`, {
        method: "POST",
        body: JSON.stringify({
          name: newTrackName.trim(),
          ownerMembershipId: newTrackOwner || undefined
        })
      });
      newTrackName = "";
      newTrackOwner = "";
      await onReloaded();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "트랙을 추가하지 못했습니다");
    } finally {
      trackSaving = false;
    }
  }

  async function setTrackOwner(track: Track, membershipId: string) {
    try {
      await apiRequest(`/productions/${pid}/cue-sheet/tracks/${track.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ownerMembershipId: membershipId || null })
      });
      await onReloaded();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "담당자를 바꾸지 못했습니다");
    }
  }

  // 트랙 삭제는 그 트랙의 큐가 함께 지워지므로 두 번 눌러 확정한다.
  let confirmingTrackId = $state<string | null>(null);
  let trackConfirmTimer: ReturnType<typeof setTimeout> | undefined;

  function requestRemoveTrack(track: Track) {
    if (confirmingTrackId === track.id) {
      confirmingTrackId = null;
      clearTimeout(trackConfirmTimer);
      void removeTrack(track);
      return;
    }
    confirmingTrackId = track.id;
    clearTimeout(trackConfirmTimer);
    trackConfirmTimer = setTimeout(() => (confirmingTrackId = null), 3000);
  }

  async function removeTrack(track: Track) {
    try {
      await apiRequest(`/productions/${pid}/cue-sheet/tracks/${track.id}`, { method: "DELETE" });
      toast.success(`${track.name} 트랙을 삭제했습니다`);
      await onReloaded();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "삭제하지 못했습니다");
    }
  }

  let confirmingReset = $state(false);
  let resetConfirmTimer: ReturnType<typeof setTimeout> | undefined;
  let resetting = $state(false);

  function requestResetCues() {
    if (confirmingReset) {
      confirmingReset = false;
      clearTimeout(resetConfirmTimer);
      void resetCues();
      return;
    }
    confirmingReset = true;
    clearTimeout(resetConfirmTimer);
    resetConfirmTimer = setTimeout(() => (confirmingReset = false), 3000);
  }

  async function resetCues() {
    resetting = true;
    try {
      const result = await apiRequest<{ removedCues: number }>(`/productions/${pid}/cue-sheet/reset`, {
        method: "POST"
      });
      await onReloaded();
      // 소프트 삭제라 데이터는 남아 있다 — 바로 되돌리기 제공.
      toast.success(`큐 ${result.removedCues}개를 비웠습니다. 데이터는 보관돼요.`, {
        action: { label: "되돌리기", onClick: () => void restoreCues() }
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "큐시트를 초기화하지 못했습니다");
    } finally {
      resetting = false;
    }
  }

  async function restoreCues() {
    try {
      const result = await apiRequest<{ restoredCues: number }>(`/productions/${pid}/cue-sheet/restore`, {
        method: "POST"
      });
      await onReloaded();
      toast.success(`큐 ${result.restoredCues}개를 되돌렸습니다`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "되돌리지 못했습니다");
    }
  }

  let generatingActor = $state(false);
  async function generateActorCues() {
    generatingActor = true;
    try {
      const result = await apiRequest<{ created: number }>(
        `/productions/${pid}/cue-sheet/actor-cues-from-script`,
        { method: "POST" }
      );
      await onReloaded();
      if (result.created > 0) {
        toast.success(`대본 지문에서 배우 큐 ${result.created}개를 만들었습니다`);
      } else {
        toast.info("대본에 배우 큐로 만들 지문이 없습니다");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "배우 큐를 만들지 못했습니다");
    } finally {
      generatingActor = false;
    }
  }

  let autotagging = $state(false);
  async function autotagActors() {
    autotagging = true;
    try {
      const result = await apiRequest<{ tagged: number; total: number }>(
        `/productions/${pid}/cue-sheet/autotag-actors`,
        { method: "POST" }
      );
      await onReloaded();
      toast.success(`배우 큐 ${result.tagged}개를 인물별로 정리했습니다`, {
        description: result.total > result.tagged ? `${result.total - result.tagged}개는 인물이 특정되지 않아 미지정으로 남았어요.` : undefined
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "자동 태깅에 실패했습니다");
    } finally {
      autotagging = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-h-[85dvh] overflow-y-auto sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>트랙 관리</Dialog.Title>
      <Dialog.Description>
        트랙은 부서나 사람 단위입니다. 담당자를 지정하면 그 사람이 직접 큐를 작성합니다.
      </Dialog.Description>
    </Dialog.Header>

    <div class="grid gap-2">
      {#each tracks as track, index (track.id)}
        <div class="border-border/60 flex items-center gap-3 rounded-xl border px-3 py-2.5">
          <span class="size-2.5 shrink-0 rounded-full" style={`background: ${palette[index % palette.length]};`}></span>
          <span class="min-w-0 flex-1 truncate text-sm font-medium">{track.name}</span>
          <select
            class="border-input bg-background h-8 max-w-36 rounded-md border px-2 text-xs"
            value={track.ownerMembership?.id ?? ""}
            onchange={(event) => setTrackOwner(track, event.currentTarget.value)}
          >
            <option value="">담당자 없음</option>
            {#each people as person (person.id)}
              <option value={person.id}>{person.user.name}</option>
            {/each}
          </select>
          <Button
            variant="ghost"
            size="sm"
            class={`h-7 px-2 text-xs ${confirmingTrackId === track.id ? "text-destructive font-semibold" : "text-muted-foreground"}`}
            onclick={() => requestRemoveTrack(track)}
          >
            {confirmingTrackId === track.id ? "한 번 더 누르면 삭제돼요" : "삭제"}
          </Button>
        </div>
      {/each}
    </div>

    <form class="border-border/60 grid gap-3 rounded-xl border border-dashed p-3" onsubmit={addTrack}>
      <div class="grid grid-cols-2 gap-2">
        <Input bind:value={newTrackName} maxlength={40} placeholder="새 트랙 이름" />
        <select
          class="border-input bg-background h-9 rounded-md border px-2 text-sm"
          bind:value={newTrackOwner}
          onchange={(event) => {
            const person = people.find((item) => item.id === event.currentTarget.value);
            if (person && !newTrackName.trim()) newTrackName = person.user.name;
          }}
        >
          <option value="">담당자 없음</option>
          {#each people as person (person.id)}
            <option value={person.id}>{person.user.name}</option>
          {/each}
        </select>
      </div>
      <p class="text-muted-foreground/70 text-xs">
        담당자를 고르면 그 사람 이름의 전용 트랙(타임라인 레인)이 생기고, 본인이 직접 큐를 씁니다.
      </p>
      <div class="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onclick={importMusic}
          disabled={trackSaving}
        >
          음악 큐 가져오기
        </Button>
        <Button type="submit" size="sm" disabled={trackSaving || !newTrackName.trim()}>트랙 추가</Button>
      </div>
    </form>

    {#if canManage && cueCount > 0}
      <div class="border-border/60 grid gap-2 rounded-xl border border-dashed p-3">
        <div>
          <p class="text-sm font-semibold">배우 큐 정리</p>
          <p class="text-muted-foreground text-xs">대본 지문(무대 동작)으로 배우 큐를 만들고, 배우 큐를 내용 속 배역 이름으로 자동 태깅해 인물별 줄(▸)로 갈라 봅니다.</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            class="h-8 px-2.5 text-xs"
            onclick={generateActorCues}
            disabled={generatingActor}
          >
            {generatingActor ? "만드는 중..." : "대본 지문에서 배우 큐 만들기"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            class="h-8 px-2.5 text-xs"
            onclick={autotagActors}
            disabled={autotagging}
          >
            {autotagging ? "정리 중..." : "인물 자동 태깅"}
          </Button>
        </div>
      </div>

      <div class="border-destructive/20 grid gap-2 rounded-xl border border-dashed p-3">
        <div>
          <p class="text-sm font-semibold">큐시트 초기화</p>
          <p class="text-muted-foreground text-xs">잘못 등록한 큐를 한 번에 비웁니다. 트랙·담당자는 그대로 남고, 데이터는 보관돼 바로 되돌릴 수 있어요.</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          class={`h-8 justify-self-start px-2.5 text-xs ${confirmingReset ? "text-destructive font-semibold" : "text-muted-foreground"}`}
          onclick={requestResetCues}
          disabled={resetting}
        >
          {confirmingReset ? `한 번 더 누르면 큐 ${cueCount}개가 지워져요` : "큐 전체 지우기"}
        </Button>
      </div>
    {/if}
  </Dialog.Content>
</Dialog.Root>
