<script lang="ts">
  import MediaDetail from "./composition-media-detail.svelte";
  import { mediaOwner, MODE_FIELD, type CompositionMedia, type CompositionSection } from "$lib/domain/composition";

  // 선택한 장면에 지금 연결된 영상·음악·악보를 한 줄로 보여 준다. 눌러서 미리보기·교체·해제.
  let { pid, sections, section, canEdit, onChanged, onUnlink, onSettings, onManage }: {
    pid: string; sections: CompositionSection[]; section: CompositionSection; canEdit: boolean;
    onChanged: () => Promise<void> | void; onUnlink: (sectionId: string, mediaId: string) => Promise<void> | void; onSettings: (sectionId: string) => void; onManage: () => void;
  } = $props();
  const SLOTS = [{ slot: "BACKGROUND" as const, label: "영상", icon: "▶" }, { slot: "MUSIC" as const, label: "음악", icon: "♪" }, { slot: "SCORE" as const, label: "악보", icon: "♫" }];
  const rows = $derived(SLOTS.map((entry) => {
    const owner = mediaOwner(sections, section, entry.slot);
    return { ...entry, owner, items: owner ? owner.media.filter((media) => media.slot === entry.slot) : [], off: !owner && section[MODE_FIELD[entry.slot]] === "NONE" };
  }));
  let open = $state<{ media: CompositionMedia; owner: CompositionSection } | null>(null);
</script>

<div class="bg-muted/30 mb-5 rounded-xl border p-3" aria-label="이 장면에 연결된 자료">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <p class="text-xs font-semibold">이 장면에 연결된 자료</p>
    <button type="button" class="text-primary text-xs underline underline-offset-4" onclick={onManage}>{canEdit ? "전체 현황 보기 · 파일 올리기" : "전체 현황 보기"}</button>
  </div>
  <ul class="mt-2 grid gap-1.5 sm:grid-cols-3">
    {#each rows as row (row.slot)}
      <li class="min-w-0 text-xs">
        <p class="text-muted-foreground mb-0.5">{row.label}</p>
        {#if row.items.length}
          {#each row.items as media (media.id)}
            <button type="button" class="hover:bg-accent focus-visible:outline-primary bg-background mb-1 flex w-full min-w-0 items-center gap-1.5 rounded-md border px-2 py-1.5 text-start transition-colors" onclick={() => (open = { media, owner: row.owner! })}>
              <span aria-hidden="true" class="text-primary">{row.icon}</span><span class="truncate">{media.label}</span>{#if row.owner && row.owner.id !== section.id}<span class="text-muted-foreground ms-auto shrink-0">상위</span>{/if}
            </button>
          {/each}
        {:else}<p class="text-muted-foreground/70 rounded-md border border-dashed px-2 py-1.5">{row.off ? "사용 안 함" : "연결 안 됨"}</p>{/if}
      </li>
    {/each}
  </ul>
</div>

{#if open}
  <MediaDetail {pid} {section} media={open.media} owner={open.owner} {canEdit} onClose={() => (open = null)} {onChanged} onUnlink={(mediaId, ownerId) => onUnlink(ownerId, mediaId)} {onSettings} />
{/if}
