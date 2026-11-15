<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { untrack } from "svelte";
  import { Input } from "$lib/components/ui/input";
  import { Textarea } from "$lib/components/ui/textarea";
  import { KIND_LABELS, type ImportPreview, type SectionKind } from "$lib/domain/composition";
  let { scripts, busy, initialMode = "text", dirty = $bindable(false), onPreview, onApply }: {
    scripts: Array<{ id: string; title: string }>; busy: boolean; dirty?: boolean;
    initialMode?: "text" | "script";
    onPreview: (source: { rawText?: string; scriptId?: string }) => Promise<ImportPreview>;
    onApply: (preview: ImportPreview) => Promise<boolean>;
  } = $props();
  let mode = $state(untrack(() => initialMode));
  let rawText = $state("");
  // 대본이 하나뿐이면 따로 고르지 않아도 되도록 미리 선택한다.
  let scriptId = $state("");
  $effect(() => { if (!scriptId && scripts.length === 1) scriptId = scripts[0].id; });
  let preview = $state<ImportPreview | null>(null);
  let working = $state(false);
  let reviewed = $state(false);
  let error = $state("");
  $effect(() => { dirty = Boolean(rawText.trim() || preview); });
  async function analyze() {
    if (busy || working) return;
    error = ""; working = true;
    try {
      if (mode === "text" && !rawText.trim()) throw new Error("나눌 대본 내용을 입력해 주세요.");
      if (mode === "script" && !scriptId) throw new Error("기존 대본을 선택해 주세요.");
      preview = await onPreview(mode === "text" ? { rawText } : { scriptId });
      reviewed = false;
    } catch (failure) { error = failure instanceof Error ? failure.message : "대본을 나누지 못했어요."; }
    finally { working = false; }
  }
  function remove(key: string) {
    if (!preview) return;
    if (preview.sections.some((s) => s.parentKey === key)) {
      error = "하위 구간이 있어요. 하위 구간을 최상위로 옮기거나 먼저 제외해 주세요."; return;
    }
    preview = { ...preview, sections: preview.sections.filter((s) => s.key !== key) };
    reviewed = false;
  }
  async function apply() {
    if (!preview || !reviewed || busy || working) return;
    working = true; error = "";
    try {
      if (await onApply(preview)) { preview = null; rawText = ""; reviewed = false; }
    } catch (failure) { error = failure instanceof Error ? failure.message : "구간을 추가하지 못했어요."; }
    finally { working = false; }
  }
</script>

<section class="space-y-4" aria-label="전체 대본을 구간으로 가져오기">
  <div><h2 class="text-lg font-semibold">대본을 장·막으로 나누기</h2><p class="mt-1 text-sm leading-relaxed text-muted-foreground">“1막”, “1장”, “# 제목”처럼 쓴 제목을 기준으로 나눠요. 나뉜 모습을 먼저 확인한 뒤 추가해 주세요. 이미 있는 내용은 지우지 않아요.</p></div>
  {#if !preview}
    <div class="flex gap-2" role="group" aria-label="가져올 자료 선택"><Button variant={mode === 'text' ? 'default' : 'outline'} disabled={working || busy} onclick={() => mode = 'text'}>내용 직접 입력</Button><Button variant={mode === 'script' ? 'default' : 'outline'} disabled={working || busy} onclick={() => mode = 'script'}>기존 대본</Button></div>
    {#if mode === "text"}<label class="grid gap-2 text-sm font-medium">전체 대본<Textarea bind:value={rawText} disabled={working || busy} rows={13} maxlength={200000} placeholder="1장 항해&#10;1막 출발&#10;배우: 바다로 떠나자.&#10;♪ 함께 부르는 노래&#10;2막 폭풍" /></label>
    {:else}<label class="grid gap-2 text-sm font-medium">공연에 등록된 대본<select bind:value={scriptId} disabled={working || busy} class="h-11 rounded-md border bg-background px-3"><option value="">대본 선택</option>{#each scripts as script (script.id)}<option value={script.id}>{script.title}</option>{/each}</select></label><p class="text-xs leading-relaxed text-muted-foreground">원본 대본·일정·주석·큐는 보존돼요. 가져온 사본은 원본이 바뀌어도 자동으로 함께 바뀌지 않아요.</p>{/if}
    <Button disabled={working || busy || (mode === 'script' && !scripts.length)} onclick={analyze}>{working ? '구간 나누는 중…' : '나눠 보기'}</Button>
  {:else}
    {#if preview.warnings.length}<div class="rounded-xl border bg-muted/25 p-3 text-sm leading-relaxed">{#each preview.warnings as warning, index (index)}<p class="mb-1">{warning}</p>{/each}</div>{/if}
    <div class="flex items-center justify-between gap-2"><p class="text-sm font-semibold">검수할 구간 {preview.sections.length}개</p><Button variant="outline" size="sm" disabled={busy || working} onclick={() => { preview = null; reviewed = false; }}>입력으로 돌아가기</Button></div>
    <div class="max-h-[65vh] space-y-2 overflow-y-auto pr-1">
      {#each preview.sections as section, index (section.key)}
        <details open={index === 0} class="rounded-xl border p-3"><summary class="cursor-pointer text-sm font-semibold">{index + 1}. {section.title}{section.parentKey ? ' · 하위 구간' : ''}</summary>
          <fieldset disabled={busy || working} class="mt-3 grid gap-3" oninput={() => reviewed = false}>
            <label class="grid gap-1 text-sm">제목<Input bind:value={section.title} maxlength={200} /></label>
            <div class="grid gap-2 sm:grid-cols-2"><label class="grid gap-1 text-sm">종류<select bind:value={section.kind} class="h-10 rounded-md border bg-background px-2">{#each Object.entries(KIND_LABELS) as [value, label] (value)}<option value={value as SectionKind}>{label}</option>{/each}</select></label>
            <label class="grid gap-1 text-sm">상위 구간<select value={section.parentKey ?? ''} onchange={(e) => { section.parentKey = e.currentTarget.value || null; reviewed = false; }} class="h-10 rounded-md border bg-background px-2"><option value="">최상위</option>{#each preview.sections.filter((s) => !s.parentKey && s.key !== section.key) as parent (parent.key)}<option value={parent.key}>{parent.title}</option>{/each}</select></label></div>
            <label class="grid gap-1 text-sm">대본<Textarea bind:value={section.scriptText} rows={5} maxlength={200000} /></label><label class="grid gap-1 text-sm">가사<Textarea bind:value={section.lyrics} rows={3} maxlength={200000} /></label>
            <Button variant="ghost" size="sm" onclick={() => remove(section.key)}>이 구간 제외</Button>
          </fieldset>
        </details>
      {/each}
    </div>
    <label class="flex items-start gap-2 text-sm"><input type="checkbox" bind:checked={reviewed} disabled={working || busy} class="mt-1" />제목·상하위 관계·대사와 가사를 확인했어요.</label>
    <Button disabled={busy || working || !reviewed || !preview.sections.length} onclick={apply}>{busy || working ? '등록 중…' : `확인한 ${preview.sections.length}개 추가`}</Button>
  {/if}
  {#if error}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
</section>
