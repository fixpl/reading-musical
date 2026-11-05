<script lang="ts">
  import { toast } from "svelte-sonner";
  import * as Dialog from "$lib/components/ui/dialog";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Textarea } from "$lib/components/ui/textarea";
  import { apiRequest, streamNdjson, uploadForm, type StreamEvent } from "$lib/api/client";

  type DraftCue = { track: string; content: string; trigger: string | null; note: string | null; character?: string | null; seconds?: number | null };
  type DraftLine = { kind: string; speaker: string | null; text: string };
  type DraftScene = { title: string; summary: string | null; lines: DraftLine[]; cues: DraftCue[] };
  type DraftAct = { title: string; scenes: DraftScene[] };
  type AiDraft = { acts: DraftAct[] };
  type AiStats = { acts: number; scenes: number; cues: number; lines: number; cuesByTrack: Record<string, number> };

  let {
    pid,
    open = $bindable(false),
    onApplied
  }: {
    pid: string;
    open: boolean;
    /** 큐시트에 적용 완료 후 호출 — 부모가 board를 다시 불러오는 용도. */
    onApplied: () => void | Promise<void>;
  } = $props();

  let step = $state<"input" | "preview">("input");
  let text = $state("");
  let scriptTitle = $state("");
  let busy = $state(false);
  let uploading = $state(false);
  let draft = $state<AiDraft | null>(null);
  let stats = $state<AiStats | null>(null);
  let progress = $state<{ done: number; total: number } | null>(null);
  let elapsed = $state(0);
  let target = $state("new");
  let scripts = $state<Array<{ id: string; title: string }>>([]);

  $effect(() => {
    if (open) {
      void resetAndLoad();
    }
  });

  async function resetAndLoad() {
    step = "input";
    draft = null;
    stats = null;
    progress = null;
    target = "new";
    try {
      scripts = await apiRequest<Array<{ id: string; title: string }>>(`/productions/${pid}/scripts`);
    } catch {
      scripts = [];
    }
  }

  async function onFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    uploading = true;
    try {
      const form = new FormData();
      form.append("file", file);
      const result = await uploadForm<{ text: string; filename: string; chars: number }>(
        `/productions/${pid}/ai/extract`,
        form
      );
      text = result.text;
      if (!scriptTitle.trim()) {
        scriptTitle = file.name.replace(/\.[^.]+$/, "");
      }
      toast.success(`파일에서 ${result.chars.toLocaleString()}자를 불러왔어요.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "파일을 읽지 못했습니다");
    } finally {
      uploading = false;
    }
  }

  async function generate() {
    if (text.trim().length < 80) {
      toast.error("대본 내용을 80자 이상 붙여넣어 주세요");
      return;
    }
    busy = true;
    progress = null;
    elapsed = 0;
    const elapsedTimer = setInterval(() => {
      elapsed += 1;
    }, 1000);
    let done = false;
    // 긴 대본은 조각으로 나눠 처리하므로 넉넉히 기다린다. 그래도 안 끝나면 중단.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180_000);
    try {
      await streamNdjson(
        `/productions/${pid}/ai/cue-draft/stream`,
        { text },
        (event: StreamEvent) => {
          if (event.type === "progress") {
            progress = { done: Number(event.done) || 0, total: Number(event.total) || 1 };
          } else if (event.type === "result") {
            draft = event.draft as AiDraft;
            stats = event.stats as AiStats;
            step = "preview";
            done = true;
            if (typeof event.truncatedChunks === "number" && event.truncatedChunks > 0) {
              toast.warning("대본이 매우 길어 앞부분만 처리했어요. 나머지는 이어서 한 번 더 만들어 주세요.");
            } else if (typeof event.failedChunks === "number" && event.failedChunks > 0) {
              toast.warning(`일부 구간(${event.failedChunks}조각)을 읽지 못했어요. 결과를 확인해 주세요.`);
            }
          } else if (event.type === "error") {
            throw new Error(typeof event.message === "string" ? event.message : "초안을 만들지 못했습니다");
          }
        },
        { signal: controller.signal }
      );
      if (!done) {
        toast.error("초안을 만들지 못했습니다. 다시 시도해 주세요.");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        toast.error("시간이 오래 걸려 멈췄어요. 대본을 막 단위로 나눠 다시 시도해 주세요.");
      } else {
        toast.error(error instanceof Error ? error.message : "초안을 만들지 못했습니다");
      }
    } finally {
      clearTimeout(timer);
      clearInterval(elapsedTimer);
      busy = false;
      progress = null;
    }
  }

  async function apply() {
    if (!draft) return;
    busy = true;
    try {
      const result = await apiRequest<{ scenes: number; cues: number; blocks: number; appended: boolean }>(
        `/productions/${pid}/ai/cue-draft/apply`,
        {
          method: "POST",
          body: JSON.stringify({
            scriptTitle: target === "new" ? scriptTitle.trim() || undefined : undefined,
            targetScriptId: target === "new" ? undefined : target,
            draft
          })
        }
      );
      toast.success(
        `${result.appended ? "기존 대본에 이어서 " : ""}장면 ${result.scenes}개 · 대사 ${result.blocks}줄 · 큐 ${result.cues}개를 등록했습니다`
      );
      open = false;
      text = "";
      scriptTitle = "";
      await onApplied();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "적용하지 못했습니다");
    } finally {
      busy = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title>AI 큐시트 초안</Dialog.Title>
      <Dialog.Description>
        {step === "input"
          ? "대본을 붙여넣으면 장면 구조·대사 본문·배역·부서별 큐까지 한 번에 준비해 드립니다. 등록 전에 확인합니다."
          : "초안을 확인하고 적용하세요. 적용하면 대본과 큐시트에 함께 등록되고, 이후 자유롭게 고칠 수 있습니다."}
      </Dialog.Description>
    </Dialog.Header>

    {#if step === "input"}
      <div class="grid gap-4">
        <div class="grid gap-2">
          <Label for="aiTitle">대본 제목</Label>
          <Input id="aiTitle" bind:value={scriptTitle} maxlength={120} placeholder="예: 통합 리허설 대본" />
        </div>
        <div class="grid gap-2">
          <div class="flex items-center justify-between">
            <Label for="aiText">대본 내용</Label>
            <label class="text-primary cursor-pointer text-xs font-medium hover:underline">
              {uploading ? "불러오는 중..." : "파일 불러오기 (txt·docx·pdf)"}
              <input
                type="file"
                accept=".txt,.md,.docx,.pdf,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                class="hidden"
                disabled={uploading}
                onchange={onFile}
              />
            </label>
          </div>
          <Textarea
            id="aiText"
            bind:value={text}
            class="h-64 resize-none overflow-y-auto font-mono text-xs leading-relaxed"
            placeholder="대본 전체를 붙여넣어 주세요. 한글 파일이나 워드 문서는 내용을 복사해서 붙여넣으면 됩니다. 길어도 괜찮아요 — 긴 대본은 자동으로 나눠서 처리합니다."
          />
          <p class="text-muted-foreground text-xs">
            {text.trim().length.toLocaleString()}자
            {#if text.trim().length > 4500}
              · 약 {Math.ceil(text.trim().length / 4500)}조각으로 나눠 처리해요
            {/if}
          </p>
        </div>
        {#if busy}
          <div class="bg-muted/60 grid gap-2 rounded-xl px-4 py-3">
            <div class="flex items-center gap-3">
              <span class="border-primary/30 border-t-primary size-4 shrink-0 animate-spin rounded-full border-2"></span>
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium">대본을 읽고 장면·대사·큐로 정리하고 있어요</p>
                <p class="text-muted-foreground mt-0.5 text-xs">
                  {#if progress && progress.total > 1}
                    {progress.done}/{progress.total} 조각 처리했어요
                  {:else}
                    대본을 읽고 있어요… {elapsed}초
                  {/if}
                </p>
              </div>
              {#if progress && progress.total > 1}
                <span class="text-primary text-sm font-semibold tabular-nums">
                  {Math.round((progress.done / progress.total) * 100)}%
                </span>
              {/if}
            </div>
            {#if progress && progress.total > 1}
              <div class="bg-border h-1.5 overflow-hidden rounded-full">
                <div
                  class="bg-primary h-full rounded-full transition-all duration-300"
                  style={`width: ${Math.round((progress.done / progress.total) * 100)}%`}
                ></div>
              </div>
            {:else}
              <div class="bg-border h-1.5 overflow-hidden rounded-full">
                <div class="bg-primary h-full w-1/3 animate-pulse rounded-full"></div>
              </div>
            {/if}
          </div>
        {/if}
        <Dialog.Footer class="gap-2">
          <Button type="button" variant="ghost" onclick={() => (open = false)} disabled={busy}>취소</Button>
          <Button type="button" onclick={generate} disabled={busy || text.trim().length < 80}>
            {busy ? "분석 중..." : "초안 만들기"}
          </Button>
        </Dialog.Footer>
      </div>
    {:else if draft}
      <div class="grid gap-4">
        {#if stats}
          <div class="flex flex-wrap gap-1.5">
            <Badge variant="secondary">막 {stats.acts}</Badge>
            <Badge variant="secondary">장면 {stats.scenes}</Badge>
            <Badge variant="secondary">대사 {stats.lines}줄</Badge>
            <Badge variant="secondary">큐 {stats.cues}</Badge>
            {#each Object.entries(stats.cuesByTrack) as [track, count] (track)}
              <Badge variant="outline">{track} {count}</Badge>
            {/each}
          </div>
        {/if}
        <div class="border-border/60 grid max-h-80 gap-4 overflow-y-auto rounded-xl border p-4">
          {#each draft.acts as act, actIndex (actIndex)}
            <div class="grid gap-3">
              <p class="text-muted-foreground text-xs font-bold tracking-wide uppercase">{act.title}</p>
              {#each act.scenes as scene, sceneIndex (sceneIndex)}
                <div>
                  <p class="text-sm font-semibold">
                    {scene.title}
                    {#if scene.lines?.length}
                      <span class="text-muted-foreground ms-1 text-xs font-normal">대사 {scene.lines.length}줄</span>
                    {/if}
                  </p>
                  {#if scene.summary}
                    <p class="text-muted-foreground mt-0.5 text-xs">{scene.summary}</p>
                  {/if}
                  {#if scene.cues.length > 0}
                    <ul class="mt-1.5 grid gap-1">
                      {#each scene.cues as cue, cueIndex (cueIndex)}
                        <li class="flex items-start gap-2 text-xs">
                          <Badge variant="outline" class="shrink-0 px-1.5 py-0 text-[11px]">{cue.track}</Badge>
                          <span class="min-w-0">
                            <span class="font-medium">
                              {#if cue.character}<span class="text-primary">[{cue.character}]</span> {/if}{cue.content}
                            </span>
                            {#if cue.seconds}
                              <span class="text-muted-foreground font-mono"> {cue.seconds}초</span>
                            {/if}
                            {#if cue.trigger}
                              <span class="text-muted-foreground"> — {cue.trigger}</span>
                            {/if}
                          </span>
                        </li>
                      {/each}
                    </ul>
                  {/if}
                </div>
              {/each}
            </div>
          {/each}
        </div>

        <div class="grid gap-2">
          <Label>어디에 등록할까요?</Label>
          <label class="border-border/60 has-[:checked]:border-primary has-[:checked]:bg-primary/5 flex cursor-pointer items-start gap-2.5 rounded-xl border px-3.5 py-2.5">
            <input type="radio" name="aiTarget" value="new" bind:group={target} class="accent-primary mt-0.5 size-4" />
            <span class="min-w-0">
              <span class="block text-sm font-medium">새 대본으로 등록</span>
              <span class="text-muted-foreground block text-xs">새 대본과 큐시트를 만들어요.</span>
            </span>
          </label>
          {#if target === "new"}
            <Input bind:value={scriptTitle} maxlength={120} placeholder="새 대본 제목 (예: 통합 리허설 대본)" class="ms-6" />
          {/if}
          {#each scripts as script (script.id)}
            <label class="border-border/60 has-[:checked]:border-primary has-[:checked]:bg-primary/5 flex cursor-pointer items-start gap-2.5 rounded-xl border px-3.5 py-2.5">
              <input type="radio" name="aiTarget" value={script.id} bind:group={target} class="accent-primary mt-0.5 size-4" />
              <span class="min-w-0">
                <span class="block text-sm font-medium">기존 대본에 이어붙이기</span>
                <span class="text-muted-foreground block truncate text-xs">{script.title} — 이 대본 뒤에 장면·큐를 추가</span>
              </span>
            </label>
          {/each}
        </div>

        <Dialog.Footer class="gap-2 sm:justify-between">
          <Button type="button" variant="ghost" onclick={() => (step = "input")} disabled={busy}>
            다시 만들기
          </Button>
          <div class="flex gap-2">
            <Button type="button" variant="ghost" onclick={() => (open = false)} disabled={busy}>취소</Button>
            <Button type="button" onclick={apply} disabled={busy}>
              {busy ? "적용 중..." : "큐시트에 적용"}
            </Button>
          </div>
        </Dialog.Footer>
      </div>
    {/if}
  </Dialog.Content>
</Dialog.Root>
