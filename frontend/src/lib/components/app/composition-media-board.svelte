<script lang="ts">
  import MediaDetail from "./composition-media-detail.svelte";
  import { assetName, formatTime, isNotesOnly, mediaOwner, MODE_FIELD, sectionOrder, SLOT_LABELS, type CompositionMedia, type CompositionSection } from "$lib/domain/composition";

  // 장면별로 영상·음악·악보가 무엇으로 연결되어 있는지 한눈에 보고, 눌러서 미리보기·교체·해제한다.
  let { pid, sections, canEdit, onChanged, onUnlink, onSettings }: {
    pid: string; sections: CompositionSection[]; canEdit: boolean;
    onChanged: () => Promise<void> | void; onUnlink: (sectionId: string, mediaId: string) => Promise<void> | void; onSettings: (sectionId: string) => void;
  } = $props();

  const SLOTS = [
    { slot: "BACKGROUND" as const, label: "영상·배경", icon: "▶" },
    { slot: "MUSIC" as const, label: "음악", icon: "♪" },
    { slot: "SCORE" as const, label: "악보", icon: "♫" }
  ];
  // 하위 장면이 있는 막은 건너뛰고 실제 장면만 보여 준다.
  const allScenes = $derived(sectionOrder(sections).filter((section) => (section.parentId !== null || !sections.some((other) => other.parentId === section.id)) && !isNotesOnly(section)));
  // 영상이 아직 없는 장면만 모아 보기 — 빠진 곳을 바로 찾는다.
  let onlyMissing = $state(false);
  const scenes = $derived(onlyMissing ? allScenes.filter((section) => cell(section, "BACKGROUND").items.length === 0 && !cell(section, "BACKGROUND").off) : allScenes);
  const parentTitle = (section: CompositionSection) => sections.find((other) => other.id === section.parentId)?.title ?? "";

  type Cell = { items: CompositionMedia[]; owner: CompositionSection | null; off: boolean };
  function cell(section: CompositionSection, slot: "BACKGROUND" | "MUSIC" | "SCORE"): Cell {
    const owner = mediaOwner(sections, section, slot);
    if (!owner) return { items: [], owner: null, off: section[MODE_FIELD[slot]] === "NONE" };
    return { items: owner.media.filter((media) => media.slot === slot), owner, off: false };
  }
  const totals = $derived(SLOTS.map((entry) => ({ ...entry, filled: allScenes.filter((section) => cell(section, entry.slot).items.length > 0).length })));
  const missingCount = $derived(allScenes.filter((section) => cell(section, "BACKGROUND").items.length === 0 && !cell(section, "BACKGROUND").off).length);

  let open = $state<{ section: CompositionSection; media: CompositionMedia; owner: CompositionSection } | null>(null);
</script>

<section class="space-y-3" aria-label="장면별 연결 현황">
  <div class="flex flex-wrap items-baseline justify-between gap-2">
    <h2 class="text-lg font-semibold">장면별 연결 현황</h2>
    <p class="text-muted-foreground text-xs">{#each totals as total, index (total.slot)}{index ? " · " : ""}{total.label} <strong class="text-foreground tabular-nums">{total.filled}</strong>/{allScenes.length}{/each}</p>
  </div>

  {#if allScenes.length}
    <label class="flex w-fit items-center gap-2 text-sm"><input type="checkbox" bind:checked={onlyMissing} />영상이 없는 장면만 보기 <span class="text-muted-foreground text-xs">({missingCount}개)</span></label>
  {/if}
  {#if !scenes.length}
    <p class="text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm">{onlyMissing ? "모든 장면에 영상이 연결돼 있어요." : "아직 장면이 없어요."}</p>
  {:else}
    <div class="overflow-hidden rounded-xl border">
      <table class="w-full text-sm">
        <thead class="bg-muted/50 text-muted-foreground hidden text-left text-xs md:table-header-group"><tr><th class="px-3 py-2 font-medium">장면</th>{#each SLOTS as entry (entry.slot)}<th class="px-3 py-2 font-medium">{entry.label}</th>{/each}</tr></thead>
        <tbody class="divide-y">
          {#each scenes as section (section.id)}
            <tr class="block md:table-row">
              <td class="block px-3 pt-3 md:table-cell md:py-2.5 md:align-top">
                <p class="break-words font-medium">{section.title}</p>
                <p class="text-muted-foreground text-[11px] tabular-nums">{#if parentTitle(section)}{parentTitle(section)} · {/if}{formatTime(section.timing.startMs)}–{formatTime(section.timing.startMs + section.timing.durationMs)}</p>
              </td>
              {#each SLOTS as entry (entry.slot)}
                {@const c = cell(section, entry.slot)}
                <td class="block px-3 py-1.5 md:table-cell md:py-2.5 md:align-top">
                  <span class="text-muted-foreground me-1 text-[11px] md:hidden">{entry.label}</span>
                  {#if c.items.length}
                    <span class="inline-flex max-w-full flex-col gap-1 align-top">
                      {#each c.items as media (media.id)}
                        <button type="button" class="hover:bg-accent focus-visible:outline-primary inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md border px-2 py-1 text-start text-xs transition-colors" title={assetName(media.asset)} onclick={() => (open = { section, media, owner: c.owner! })}>
                          <span aria-hidden="true" class="text-primary">{entry.icon}</span><span class="truncate">{media.label}</span>
                        </button>
                      {/each}
                      {#if c.owner && c.owner.id !== section.id}<span class="text-muted-foreground text-[11px]">상위 “{c.owner.title}” 자료</span>{/if}
                    </span>
                  {:else if c.off}<span class="text-muted-foreground/70 text-xs">사용 안 함</span>
                  {:else}<span class="text-muted-foreground/70 text-xs">없음</span>{/if}
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="text-muted-foreground text-xs leading-relaxed">연결된 이름을 누르면 미리 보고, 다른 파일로 바꾸거나 연결을 해제할 수 있어요. 영상이 없는 장면은 아래에서 파일을 올려 연결해 주세요.</p>
  {/if}
</section>

{#if open}
  <MediaDetail {pid} section={open.section} media={open.media} owner={open.owner} {canEdit} onClose={() => (open = null)} {onChanged} onUnlink={(mediaId, ownerId) => onUnlink(ownerId, mediaId)} {onSettings} />
{/if}
