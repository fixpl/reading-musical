<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { formatTime, sectionOrder, KIND_LABELS, type CompositionSection } from "$lib/domain/composition";
  let { sections, selectedId, canEdit, busy, onSelect, onCreate, onReorder, onDuplicate, onArchive }: {
    sections: CompositionSection[]; selectedId: string; canEdit: boolean; busy: boolean;
    onSelect: (id: string) => void; onCreate: (parentId: string | null) => void;
    onReorder: (parentId: string | null, ids: string[]) => void;
    onDuplicate: (id: string) => void; onArchive: (id: string) => void;
  } = $props();
  const ordered = $derived(sectionOrder(sections));
  const selected = $derived(sections.find((s) => s.id === selectedId));
  const parentId = $derived(selected ? selected.parentId || selected.id : null);
  function siblings(section: CompositionSection) { return ordered.filter((s) => s.parentId === section.parentId); }
  function shift(section: CompositionSection, delta: number) {
    const ids = siblings(section).map((s) => s.id);
    const index = ids.indexOf(section.id);
    if (index + delta < 0 || index + delta >= ids.length) return;
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    onReorder(section.parentId, ids);
  }
</script>

<section class="overflow-hidden rounded-2xl border bg-card" aria-label="공연 구성 목록">
  <div class="border-b p-4">
    <div class="flex items-center justify-between"><h2 class="font-semibold">공연 구성</h2><Badge variant="secondary">{sections.length}개 구간</Badge></div>
    <p class="mt-2 text-xs leading-relaxed text-muted-foreground">장만 만들거나 장 아래 막을 추가하세요. 같은 이름도 별개의 구간으로 관리합니다.</p>
    {#if canEdit}<div class="mt-3 flex gap-2"><Button size="sm" disabled={busy} onclick={() => onCreate(null)}>장 추가</Button><Button size="sm" variant="outline" disabled={busy || !parentId} onclick={() => onCreate(parentId)}>하위 구간 추가</Button></div>{/if}
  </div>
  <div class="max-h-[60vh] overflow-y-auto p-2">
    {#each ordered as section (section.id)}
      {@const sameLevel = siblings(section)}
      {@const index = sameLevel.findIndex((s) => s.id === section.id)}
      <div class={`mb-1 rounded-xl border ${section.parentId ? 'ml-4' : ''} ${selectedId === section.id ? 'border-primary bg-primary/5' : ''}`}>
        <button type="button" disabled={busy} onclick={() => onSelect(section.id)} aria-current={selectedId === section.id ? "true" : undefined} class="block w-full rounded-xl p-3 text-left transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary">
          <span class="flex items-start justify-between gap-2"><span class="min-w-0 break-words text-sm font-semibold">{section.title}</span><span class="shrink-0 text-xs text-muted-foreground">{KIND_LABELS[section.kind]}</span></span>
          <span class="mt-1 block font-mono text-xs tabular-nums text-muted-foreground">{formatTime(section.timing.startMs)} – {formatTime(section.timing.startMs + section.timing.durationMs)}</span>
          <span class="mt-2 flex flex-wrap gap-1 text-[11px] text-muted-foreground"><span>{section.scriptText ? '대본 있음' : '대본 없음'}</span><span>· {section.lyrics ? '가사 있음' : '가사 없음'}</span><span>· 재생 자료 {section.media.filter((media) => media.slot !== 'SOURCE').length}개</span><span>· 참고 첨부 {section.media.filter((media) => media.slot === 'SOURCE').length}개</span></span>
        </button>
        {#if canEdit && selectedId === section.id}<div class="flex flex-wrap gap-1 border-t p-1.5"><Button variant="ghost" size="sm" aria-label={`${section.title} 위로 이동`} disabled={busy || index === 0} onclick={() => shift(section, -1)}>위로</Button><Button variant="ghost" size="sm" aria-label={`${section.title} 아래로 이동`} disabled={busy || index === sameLevel.length - 1} onclick={() => shift(section, 1)}>아래로</Button><Button variant="ghost" size="sm" disabled={busy} onclick={() => onDuplicate(section.id)}>복제</Button><Button variant="ghost" size="sm" disabled={busy} onclick={() => onArchive(section.id)}>보관</Button></div>{/if}
      </div>
    {:else}
      <div class="px-4 py-10 text-center"><p class="text-sm font-medium">첫 장부터 시작하세요</p><p class="mt-2 text-xs leading-relaxed text-muted-foreground">대본이나 악보가 완성되지 않아도 구간을 먼저 만들 수 있습니다.</p></div>
    {/each}
  </div>
  {#if canEdit && ordered.length}<p class="border-t p-3 text-xs leading-relaxed text-muted-foreground">위·아래 이동은 같은 단계의 구간을 자동으로 다시 연결합니다. 자료의 구간 내 상대 시간은 유지됩니다.</p>{/if}
</section>
