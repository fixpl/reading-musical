<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Textarea } from "$lib/components/ui/textarea";
  import { KIND_LABELS, MODE_LABELS, secondsInput, formatTime, type CompositionSection, type SectionWrite, type SectionKind, type MediaMode } from "$lib/domain/composition";
  let { section, sections, canEdit, busy, dirty = $bindable(false), onSave }: {
    section: CompositionSection; sections: CompositionSection[]; canEdit: boolean; busy: boolean;
    dirty?: boolean; onSave: (fields: SectionWrite) => Promise<boolean>;
  } = $props();
  function snapshot() {
    return { title: section.title, kind: section.kind, parentId: section.parentId ?? "", scriptText: section.scriptText, lyrics: section.lyrics,
      start: section.startMs === null ? "" : String(section.startMs / 1000), duration: section.durationMs === null ? "" : String(section.durationMs / 1000),
      backgroundMode: section.backgroundMode, musicMode: section.musicMode, scoreMode: section.scoreMode };
  }
  // The parent keys this form by section ID and saved revision. Failed saves keep this draft.
  let form = $state(snapshot());
  const baseline = JSON.stringify(snapshot());
  let error = $state("");
  const hasChildren = $derived(sections.some((s) => s.parentId === section.id));
  $effect(() => { dirty = JSON.stringify(form) !== baseline; });
  async function save(event: SubmitEvent) {
    event.preventDefault();
    error = "";
    try {
      if (!form.title.trim()) throw new Error("장·막의 제목을 입력하세요.");
      await onSave({ title: form.title.trim(), kind: form.kind, parentId: form.parentId || null, scriptText: form.scriptText, lyrics: form.lyrics,
        startMs: secondsInput(form.start), durationMs: secondsInput(form.duration, true, 1000),
        backgroundMode: form.backgroundMode, musicMode: form.musicMode, scoreMode: form.scoreMode });
    } catch (failure) { error = failure instanceof Error ? failure.message : "입력 내용을 확인하세요."; }
  }
</script>

<form onsubmit={save} class="space-y-5">
  <fieldset disabled={!canEdit || busy} class="space-y-4 disabled:opacity-80">
    <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_110px]">
      <label class="grid gap-1.5 text-sm font-medium">제목 <Input bind:value={form.title} maxlength={200} required placeholder="예: 1장 · 항해의 시작" /></label>
      <label class="grid gap-1.5 text-sm font-medium">구간 종류 <select bind:value={form.kind} class="h-10 rounded-md border bg-background px-3 text-sm">{#each Object.entries(KIND_LABELS) as [value, label]}<option value={value as SectionKind}>{label}</option>{/each}</select></label>
    </div>
    <label class="grid gap-1.5 text-sm font-medium">상위 장·막
      <select bind:value={form.parentId} disabled={hasChildren || !canEdit || busy} class="h-10 rounded-md border bg-background px-3 text-sm" onchange={() => form.start = ""}>
        <option value="">없음 · 최상위 구간</option>
        {#each sections.filter((s) => !s.parentId && s.id !== section.id) as parent (parent.id)}<option value={parent.id}>{parent.title}</option>{/each}
      </select>
    </label>
    {#if hasChildren}<p class="text-xs text-muted-foreground">하위 구간이 있는 항목은 최상위로 유지합니다. 구간 명칭은 자유롭게 바꿀 수 있습니다.</p>{/if}
    <div class="rounded-xl border bg-muted/25 p-3">
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="grid gap-1.5 text-sm font-medium">시작 위치 (초)<Input bind:value={form.start} inputmode="decimal" placeholder="비워두면 앞 구간에 자동 연결" /></label>
        <label class="grid gap-1.5 text-sm font-medium">구간 길이 (초)<Input bind:value={form.duration} inputmode="decimal" placeholder="비워두면 자동 계산" /></label>
      </div>
      <p class="mt-2 text-xs leading-relaxed text-muted-foreground">{form.parentId ? "상위 장·막의 시작을 0초로 계산합니다." : "전체 공연의 시작을 0초로 계산합니다."} 현재 배치: {formatTime(section.timing.startMs)}부터 {formatTime(section.timing.durationMs)} 동안. 빈 구간의 자동 길이는 1분입니다.</p>
    </div>
    <label class="grid gap-1.5 text-sm font-medium">대본 · 대사 · 지문<Textarea bind:value={form.scriptText} rows={9} maxlength={200000} placeholder="배우: 대사를 입력하세요.&#10;[무대 지문]&#10;대본이 없어도 악보만 등록할 수 있습니다." /></label>
    <label class="grid gap-1.5 text-sm font-medium">노래 가사<Textarea bind:value={form.lyrics} rows={6} maxlength={200000} placeholder="이 장·막에서 부르는 노래 가사를 입력하세요." /></label>
    <div class="grid gap-3 sm:grid-cols-3">
      {#each [{ field: "backgroundMode", label: "배경 영상" }, { field: "musicMode", label: "음악" }, { field: "scoreMode", label: "악보" }] as item (item.field)}
        <label class="grid gap-1.5 text-sm font-medium">{item.label}
          <select bind:value={form[item.field as "backgroundMode" | "musicMode" | "scoreMode"]} class="h-10 min-w-0 rounded-md border bg-background px-2 text-sm">
            {#each Object.entries(MODE_LABELS) as [value, label]}<option value={value as MediaMode}>{label}</option>{/each}
          </select>
        </label>
      {/each}
    </div>
    <p class="text-xs leading-relaxed text-muted-foreground">상위 자료 사용은 하위 구간에서 적용됩니다. 최상위 구간은 ‘이 구간의 자료 사용’을 선택하세요. ‘사용하지 않음’으로 바꿔도 자료 연결은 보존됩니다.</p>
  </fieldset>
  {#if error}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
  <div class="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
    <p class="text-xs text-muted-foreground">{canEdit ? dirty ? "저장하지 않은 변경이 있습니다." : "저장된 내용입니다." : "열람 권한으로 보고 있습니다."}</p>
    {#if canEdit}<Button type="submit" disabled={busy || !dirty}>{busy ? "저장 중…" : "구간 저장"}</Button>{/if}
  </div>
</form>
