<script lang="ts">
  import { onDestroy } from "svelte";
  import { toast } from "svelte-sonner";
  import { apiRequest, streamNdjson, uploadForm, type StreamEvent } from "$lib/api/client";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Textarea } from "$lib/components/ui/textarea";
  import { FormField } from "$lib/components/ui/form-field";
  import type { ImportPreview } from "$lib/domain/composition";
  import { outlineOf } from "$lib/domain/script-outline";
  import { counts, formatMmSs, parseMmSs, pruned, sceneMs, setSceneMs, speakers, totalMs, type Draft } from "$lib/domain/draft-review";
  import { formatTimelineTime } from "$lib/domain/performance-timeline";
  import type { CueReview, DirectorCue } from "$lib/domain/director-cues";
  import DirectorCueReview from "./director-cue-review.svelte";

  let { pid, busy, hasSections, dirty = $bindable(false), onPreview, onCompose, onManual, onVideos }: {
    pid: string;
    busy: boolean;
    hasSections: boolean;
    dirty?: boolean;
    onPreview: (source: { scriptId: string }) => Promise<ImportPreview>;
    onCompose: (preview: ImportPreview) => Promise<boolean>;
    onManual: () => void;
    onVideos: () => void;
  } = $props();

  type Step = "input" | "analyzing" | "review" | "done";
  let step = $state<Step>("input");
  let source = $state<"file" | "paste">("file");
  let title = $state("");
  let text = $state("");
  let fileName = $state("");
  let cueFileName = $state("");
  let cueSheet = $state<DirectorCue[]>([]);
  let cueReading = $state(false);
  let cueReview = $state<CueReview | null>(null);
  let includedCues = $state<Record<string, boolean>>({});
  let linkedScenes = $state<Record<string, string>>({});
  let reading = $state(false);
  let dragging = $state(false);
  let draft = $state<Draft | null>(null);
  let progress = $state<{ done: number; total: number; comparing: boolean } | null>(null);
  let elapsed = $state(0);
  let working = $state(false);
  let error = $state("");
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let limit: ReturnType<typeof setTimeout> | null = null;
  type Applied = { scriptId: string; newRoles: number; cues: number; scenes: number };
  let applied = $state<Applied | null>(null);
  function clearAnalysisTimers() {
    if (timer !== null) clearInterval(timer);
    if (limit !== null) clearTimeout(limit);
    timer = null; limit = null;
  }
  onDestroy(() => { controller?.abort(); clearAnalysisTimers(); });
  type AiStatus = { available: boolean; slow?: boolean; reason: string | null };
  let ai = $state<AiStatus | null>(null);
  $effect(() => {
    const check = new AbortController();
    ai = null;
    void apiRequest<AiStatus>(`/productions/${pid}/ai/status`, { signal: check.signal })
      .then((value) => { if (!check.signal.aborted) ai = value; })
      .catch(() => {
        if (!check.signal.aborted) ai = { available: false, reason: "AI 연결 상태를 확인하지 못했어요." };
      });
    return () => check.abort();
  });
  let result = $state<{ scenes: number; roles: number; cues: number } | null>(null);

  const MIN_TEXT_CHARS = 80;
  const MAX_TEXT_CHARS = 120_000;
  const tooLong = $derived(text.length > MAX_TEXT_CHARS);
  const ready = $derived(text.trim().length >= MIN_TEXT_CHARS && !tooLong);
  const outline = $derived(outlineOf(text));
  const summary = $derived(draft ? { ...counts(draft), ms: totalMs(draft), roles: speakers(draft) } : null);
  const reviewScenes = $derived(draft?.acts.flatMap(act => act.scenes.flatMap(scene =>
    scene.reviewId ? [{ id: scene.reviewId, title: scene.title, act: act.title }] : []
  )) ?? []);
  // 등록을 마친 뒤에는 남은 입력이 없다.
  $effect(() => { dirty = step === "analyzing" || step === "review" || (step === "input" && Boolean(text.trim() || cueFileName)); });

  async function readFile(file: File) {
    if (reading || busy || working) return;
    error = "";
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!["docx", "pdf", "txt"].includes(extension)) { error = "docx, pdf, txt 파일만 올릴 수 있어요."; return; }
    if (file.size > 15 * 1024 * 1024) { error = "파일은 15MB 이하여야 해요."; return; }
    reading = true;
    try {
      const form = new FormData();
      form.append("file", file);
      const extracted = await uploadForm<{ text: string; filename: string; chars: number }>(`/productions/${pid}/ai/extract`, form);
      text = extracted.text;
      fileName = file.name; // 브라우저가 아는 원래 이름을 쓴다(서버 응답의 이름은 인코딩이 깨질 수 있다).
      if (!title.trim()) title = fileName.replace(/\.[^.]+$/, "").slice(0, 120);
    } catch (failure) {
      error = failure instanceof Error ? failure.message : "파일을 읽지 못했어요.";
    } finally { reading = false; }
  }
  function pick(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (file) void readFile(file);
  }
  function drop(event: DragEvent) {
    event.preventDefault();
    dragging = false;
    const file = event.dataTransfer?.files?.[0];
    if (file) void readFile(file);
  }

  async function pickCueSheet(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file || busy || working || cueReading) return;
    error = "";
    if (!file.name.toLowerCase().endsWith(".docx") || file.size > 2 * 1024 * 1024) {
      error = "큐시트는 2MB 이하의 Word(.docx) 파일을 올려 주세요.";
      return;
    }
    cueReading = true;
    try {
      const form = new FormData();
      form.append("file", file);
      const extracted = await uploadForm<{ rows: DirectorCue[] }>(`/productions/${pid}/ai/cue-sheet/extract`, form);
      cueSheet = extracted.rows;
      cueFileName = file.name;
    } catch (failure) {
      error = failure instanceof Error ? failure.message : "큐시트에서 표를 읽지 못했어요.";
    } finally { cueReading = false; }
  }

  async function analyze() {
    if (!ready || reading || cueReading || busy || working) return;
    error = ""; working = true; step = "analyzing"; progress = null; elapsed = 0;
    cueReview = null; includedCues = {}; linkedScenes = {};
    timer = setInterval(() => { elapsed += 1; }, 1000);
    controller = new AbortController();
    limit = setTimeout(() => controller?.abort(), 600_000);
    let finished = false;
    let analysisError: string | null = null;
    try {
      const body = cueSheet.length ? { text, cueSheet: $state.snapshot(cueSheet) } : { text };
      await streamNdjson(`/productions/${pid}/ai/cue-draft/stream`, body, (event: StreamEvent) => {
        if (event.type === "progress") progress = { done: Number(event.done) || 0, total: Number(event.total) || 1, comparing: event.stage === "cue-review" };
        else if (event.type === "error") analysisError = typeof event.message === "string" ? event.message : "AI 분석에 실패했어요.";
        else if (event.type === "result") {
          const incoming = event.draft as Draft;
          const review = event.cueReview as CueReview | undefined;
          if (review) {
            for (const scene of review.scenes) {
              const draftScene = incoming.acts[scene.actIndex]?.scenes[scene.sceneIndex];
              if (draftScene) draftScene.reviewId = scene.id;
            }
            cueReview = review;
            includedCues = Object.fromEntries(review.matches.map(cue => [cue.id, cue.status === "candidate"]));
            linkedScenes = Object.fromEntries(review.matches.map(cue => [cue.id, cue.sceneId ?? ""]));
          }
          draft = incoming;
          finished = true;
          if (Number(event.truncatedChunks) > 0) toast.warning("대본이 매우 길어 앞부분만 처리했어요. 나머지는 이어서 한 번 더 등록해 주세요.");
        }
      }, { signal: controller.signal });
      if (analysisError) throw new Error(analysisError);
      if (!finished || !draft) throw new Error("AI 분석 결과가 비어 있어요. 다시 시도해 주세요.");
      step = "review";
    } catch (failure) {
      step = "input";
      error = failure instanceof DOMException && failure.name === "AbortError"
        ? "분석을 멈췄어요. 대본이 길면 막 단위로 나누어 등록해 보세요."
        : failure instanceof Error && /network|fetch|load failed|terminated|aborted/i.test(failure.message)
          ? "서버와 연결이 끊겨 분석을 마치지 못했어요. 입력한 대본은 그대로 있어요. 다시 눌러 주세요."
          : failure instanceof Error ? failure.message : "AI 분석에 실패했어요.";
    } finally {
      clearAnalysisTimers(); controller = null; working = false; progress = null;
    }
  }
  function cancel() { controller?.abort(); }

  function editTime(scene: Draft["acts"][number]["scenes"][number], value: string, input: HTMLInputElement) {
    const ms = parseMmSs(value);
    if (ms === null) { input.value = formatMmSs(sceneMs(scene)); error = "시간은 3:30 또는 210(초)처럼 1초 이상으로 입력해 주세요."; return; }
    error = "";
    setSceneMs(scene, ms);
    input.value = formatMmSs(sceneMs(scene));
  }
  function removeScene(actIndex: number, sceneIndex: number) {
    if (!draft) return;
    const id = draft.acts[actIndex].scenes[sceneIndex]?.reviewId;
    if (id) for (const cueId of Object.keys(linkedScenes)) {
      if (linkedScenes[cueId] === id) {
        linkedScenes[cueId] = "";
        includedCues[cueId] = false;
      }
    }
    draft.acts[actIndex].scenes.splice(sceneIndex, 1);
    draft = pruned(draft);
  }

  function reviewedCuePayload() {
    if (!draft || !cueReview || applied) return [];
    const sceneIndexById = new Map(pruned(draft).acts.flatMap((act, actIndex) => act.scenes.flatMap((scene, sceneIndex) =>
      scene.reviewId ? [[scene.reviewId, { actIndex, sceneIndex }] as const] : []
    )));
    return cueReview.matches.filter(cue => includedCues[cue.id]).map(cue => {
      const target = sceneIndexById.get(linkedScenes[cue.id]);
      return { number: cue.number, startMs: cue.startMs, note: cue.note, actions: cue.actions,
        actIndex: target?.actIndex ?? null, sceneIndex: target?.sceneIndex ?? null };
    });
  }

  async function register(directorCues: ReturnType<typeof reviewedCuePayload> = []) {
    if (!draft || busy || working) return;
    const finalDraft = pruned(draft);
    if (!applied && !finalDraft.acts.length) { error = "등록할 장면이 없어요."; return; }
    working = true; error = "";
    try {
      // 대본 저장이 끝났다면 구성 반영만 재시도해 같은 대본을 중복 생성하지 않는다.
      applied ??= await apiRequest<Applied>(`/productions/${pid}/ai/cue-draft/apply`, {
        method: "POST", body: JSON.stringify({ scriptTitle: title.trim() || "AI 구성 대본", draft: finalDraft, ...(directorCues.length ? { directorCues } : {}) })
      });
      const preview = await onPreview({ scriptId: applied.scriptId });
      if (!(await onCompose(preview))) throw new Error("대본·역할·큐는 등록했지만 장·막 구성에 반영하지 못했어요. '구성 반영 다시 시도'를 누르면 등록한 대본을 그대로 사용해요.");
      result = { scenes: applied.scenes, roles: applied.newRoles, cues: applied.cues };
      step = "done";
    } catch (failure) {
      error = failure instanceof Error ? failure.message : "등록하지 못했어요.";
    } finally { working = false; }
  }
  function reset() {
    step = "input"; draft = null; applied = null; text = ""; fileName = ""; title = ""; result = null; error = "";
    cueFileName = ""; cueSheet = []; cueReview = null; includedCues = {}; linkedScenes = {};
  }
</script>

<section class="space-y-5" aria-label="대본 등록">
  <div>
    <h2 class="text-lg font-semibold">대본 등록</h2>
    <p class="text-muted-foreground mt-1 text-sm leading-relaxed">
      대본을 올리거나 붙여 넣으세요. AI가 만든 <strong class="text-foreground">장면·배역·큐·예상 시간</strong>을 검토해 공연에 등록해요.
    </p>
    <ol class="text-muted-foreground mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="대본 등록 단계">
      <li class={step === 'input' || step === 'analyzing' ? 'text-foreground font-semibold' : ''} aria-current={step === 'input' || step === 'analyzing' ? 'step' : undefined}>1. 대본 선택</li>
      <li class={step === 'review' ? 'text-foreground font-semibold' : ''} aria-current={step === 'review' ? 'step' : undefined}>2. 초안 검토</li>
      <li class={step === 'done' ? 'text-foreground font-semibold' : ''} aria-current={step === 'done' ? 'step' : undefined}>3. 공연에 반영</li>
    </ol>
  </div>

  {#if step === "input"}
    <div class="grid gap-4">
      <FormField label="대본 이름" for="script-register-title" hint="선택사항이에요. 파일을 처음 올리면 파일 이름을 자동으로 채워요.">
        <Input id="script-register-title" class="min-h-11" bind:value={title} maxlength={120} placeholder="예: 따뜻한 것들의 무게 최종본" aria-describedby="script-register-title-hint" />
      </FormField>

      <div class="bg-muted inline-flex w-fit rounded-lg p-0.5" role="group" aria-label="대본 넣는 방법">
        <Button variant="ghost" size="touch" class={source === "file" ? "bg-background font-semibold shadow-sm" : "text-muted-foreground"} aria-pressed={source === "file"} onclick={() => (source = "file")}>파일 올리기</Button>
        <Button variant="ghost" size="touch" class={source === "paste" ? "bg-background font-semibold shadow-sm" : "text-muted-foreground"} aria-pressed={source === "paste"} onclick={() => (source = "paste")}>붙여넣기</Button>
      </div>

      {#if source === "file"}
        <label
          class={["flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center transition-colors focus-within:ring-2 focus-within:ring-ring", dragging ? "border-primary bg-primary/5" : "hover:bg-muted/40"]}
          ondragover={(event) => { event.preventDefault(); dragging = true; }}
          ondragleave={() => (dragging = false)}
          ondrop={drop}
        >
          <input type="file" class="sr-only" accept=".docx,.pdf,.txt,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onchange={pick} disabled={reading || busy} />
          {#if reading}
            <span class="text-sm font-medium">파일에서 글을 읽는 중…</span>
          {:else if fileName}
            <span class="max-w-full text-sm font-semibold [overflow-wrap:anywhere]">{fileName}</span>
            <span class="text-muted-foreground text-xs">{text.length.toLocaleString()}자를 읽었어요 · 다른 파일을 올리려면 누르거나 끌어다 놓아 주세요</span>
          {:else}
            <span class="text-sm font-semibold">대본 파일을 끌어다 놓거나 눌러서 선택해 주세요</span>
            <span class="text-muted-foreground text-xs">Word(.docx) · PDF · 텍스트(.txt) · 15MB 이하</span>
          {/if}
        </label>
      {/if}

      <div class="grid gap-2 rounded-xl border p-4">
        <label for="director-cue-file" class="text-sm font-semibold">큐시트 함께 올리기 <span class="text-muted-foreground font-normal">(선택)</span></label>
        <p id="director-cue-hint" class="text-muted-foreground text-sm">큐 번호·구간·부서별 지시가 표로 정리된 Word 파일을 올리면 대본과 비교해요.</p>
        <input id="director-cue-file" type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" class="text-muted-foreground min-h-11 max-w-full text-sm file:me-2 file:min-h-11 file:rounded-md file:border file:bg-background file:px-3 file:text-foreground" onchange={pickCueSheet} disabled={busy || working || cueReading} aria-describedby="director-cue-hint" />
        {#if cueReading}<p role="status" class="text-sm">큐시트에서 표를 읽고 있어요.</p>{/if}
        {#if cueFileName}
          <div class="flex flex-wrap items-center gap-x-3">
            <p class="text-sm [overflow-wrap:anywhere]">{cueFileName} · 큐 {cueSheet.length}개</p>
            <Button type="button" variant="ghost" size="touch" disabled={busy || cueReading} onclick={() => { cueFileName = ""; cueSheet = []; }}>큐시트 빼기</Button>
          </div>
        {/if}
      </div>

      {#if text.trim()}
        <div class="bg-muted/40 space-y-2 rounded-xl border p-3 text-sm" aria-label="제목 인식 요약">
          <p class="font-semibold">이렇게 읽었어요 <span class="text-muted-foreground font-normal">· {text.trim().length.toLocaleString()}자</span></p>
          {#if outline.items.length}
            <p class="text-muted-foreground text-xs">{outline.acts ? `막·장 ${outline.acts}개` : ""}{outline.scenes ? ` · 장면 ${outline.scenes}개` : ""}{outline.songs ? ` · 노래 ${outline.songs}곡` : ""} — 이 제목들을 기준으로 AI가 나눠요.</p>
            <ul class="max-h-48 space-y-0.5 overflow-y-auto text-sm">
              {#each outline.items as item (item.line)}
                <li class={["flex items-baseline gap-2", item.level === 1 && "ps-4", item.level === 2 && "ps-8"]}>
                  <span class={["rounded px-1.5 py-px text-[11px] font-semibold", item.kind === "곡" ? "bg-violet-500/15 text-violet-700 dark:text-violet-300" : item.kind === "메모" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-primary/15 text-primary"]}>{item.kind}</span>
                  <span class="min-w-0 break-words">{item.title}</span>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="text-muted-foreground text-xs leading-relaxed">“1막”, “제1장”, “넘버 1” 같은 제목을 찾지 못했어요. 괜찮아요. 내용을 보고 AI가 장면을 나누고, 등록 전에 직접 고칠 수 있어요.</p>
          {/if}
        </div>
      {/if}

      {#if source === "paste"}
        <label class="grid gap-1.5 text-sm font-medium">
          대본 내용
          <Textarea bind:value={text} rows={14} maxlength={MAX_TEXT_CHARS} placeholder="막·장·넘버 제목, 대사, 가사, 지문을 그대로 붙여 넣어 주세요." disabled={reading || busy} />
        </label>
      {:else if text}
        <details class="rounded-xl border p-3">
          <summary class="cursor-pointer text-sm font-medium">읽어 온 내용 보기 · 고치기</summary>
          <Textarea class="mt-3" bind:value={text} rows={12} maxlength={MAX_TEXT_CHARS} aria-label="읽어 온 내용" disabled={reading || busy} />
          <p class="text-muted-foreground mt-1 text-xs">글자가 잘못 읽혔을 때만 고치면 돼요. 서식(굵게·크기)은 반영되지 않아요.</p>
        </details>
      {/if}
      {#if tooLong}
        <p class="text-destructive text-sm" role="alert">한 번에 12만 자까지 분석할 수 있어요. 대본을 막이나 장면 단위로 나눠 주세요.</p>
      {:else if !ready && (source === "paste" || text)}
        <p class="text-muted-foreground -mt-2 text-xs">대본 내용은 {MIN_TEXT_CHARS}자 이상 입력해 주세요.</p>
      {/if}

      {#if hasSections}
        <p class="bg-muted/50 rounded-lg px-3 py-2 text-xs leading-relaxed">이미 구성된 장·막이 있어요. 새 대본은 기존 구성 <strong>뒤에 추가</strong>되며 기존 내용은 지우지 않아요.</p>
      {/if}

      <div class="bg-muted/40 grid gap-1 rounded-xl border p-3">
        <p class="text-sm leading-6" role="status">
          {#if !ai}AI 연결을 확인하고 있어요.
          {:else if !ai.available}{ai.reason ?? "AI가 지금 응답하지 않아요."} 장면을 직접 작성할 수 있어요.
          {:else if ai.slow}AI 응답이 느려요. 긴 대본은 분석에 몇 분 걸릴 수 있어요.
          {:else}AI를 사용할 수 있어요.
          {/if}
        </p>
        <p class="text-muted-foreground text-xs leading-5">AI 분석을 시작하면 대본 텍스트와 대조에 필요한 큐시트 내용이 서버에 설정된 AI 공급자에게 전송돼요.</p>
      </div>

      <div class="grid gap-2 sm:flex sm:flex-wrap sm:items-center">
        <Button size="touch" disabled={!ready || reading || cueReading || busy} onclick={analyze}>AI로 장면 초안 만들기</Button>
        <Button variant="outline" size="touch" disabled={busy || cueReading} onclick={onManual}>직접 장면 작성하기</Button>
      </div>
    </div>

  {:else if step === "analyzing"}
    <div class="space-y-4 rounded-2xl border p-6 text-center">
      <p class="font-semibold" role="status">{progress?.comparing ? "대본과 큐시트를 대조하고 있어요." : `장면 초안을 만들고 있어요${progress ? ` (${progress.done}/${progress.total} 구간)` : ""}.`}</p>
      <div class="bg-muted mx-auto h-2 w-full max-w-md overflow-hidden rounded-full" aria-hidden="true">
        <div class="bg-primary h-full rounded-full transition-all" style={`width:${progress ? Math.max(6, Math.round((progress.done / progress.total) * 100)) : 6}%`}></div>
      </div>
      <p class="text-muted-foreground text-sm" aria-hidden="true">{elapsed}초 경과</p>
      {#if elapsed > 150 && !progress?.done}
        <p class="text-warning text-sm">첫 구간의 응답을 기다리고 있어요. 멈춰도 입력한 대본은 남아요.</p>
      {/if}
      <Button variant="outline" onclick={cancel}>멈추기</Button>
    </div>

  {:else if step === "review" && draft && summary}
    <div class="space-y-4">
      <div class="bg-muted/40 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border p-3 text-sm">
        <span>막 <strong>{summary.acts}</strong></span><span>장면 <strong>{summary.scenes}</strong></span><span>대사·지문 <strong>{summary.lines}</strong>줄</span><span>큐 <strong>{summary.cues}</strong>개</span>
        <span>총 예상 시간 <strong class="font-mono tabular-nums">{formatMmSs(summary.ms)}</strong></span>
      </div>
      {#if summary.roles.length}
        <p class="text-sm"><span class="text-muted-foreground">만들어질 배역</span> {#each summary.roles as role (role)}<span class="bg-secondary ms-1 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium">{role}</span>{/each}</p>
      {/if}
      {#if draft.characters?.length}
        <ul class="text-muted-foreground space-y-0.5 text-xs">
          {#each draft.characters as character (character.name)}<li><strong class="text-foreground">{character.name}</strong> · {character.description}</li>{/each}
        </ul>
      {/if}
      <p class="text-muted-foreground text-xs leading-relaxed">장면 제목과 예상 길이를 고칠 수 있어요. 길이를 바꾸면 타임코드가 없는 줄의 길이만 조정돼요.</p>

      <div class="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
        {#each draft.acts as act, actIndex (actIndex)}
          <div class="rounded-xl border">
            <div class="bg-muted/40 flex items-center gap-2 border-b px-3 py-2">
              <span class="text-primary text-xs font-bold">막·장</span>
              <Input class="h-9 flex-1 font-semibold" bind:value={act.title} maxlength={120} aria-label="막 제목" disabled={working || applied !== null} />
            </div>
            <ul class="divide-y">
              {#each act.scenes as scene, sceneIndex (sceneIndex)}
                {@const timedLines = scene.lines.filter((line) => line.startMs != null)}
                <li class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_5.5rem_auto]">
                  <Input class="col-span-full h-11 sm:col-span-1 sm:h-9" bind:value={scene.title} maxlength={120} aria-label="장면 제목" disabled={working || applied !== null} />
                  <input
                    class="bg-background h-11 w-22 rounded-md border px-2 text-center font-mono text-sm tabular-nums sm:h-9"
                    value={formatMmSs(sceneMs(scene))}
                    aria-label={`${scene.title} 시간`}
                    disabled={working || applied !== null}
                    onchange={(event) => editTime(scene, event.currentTarget.value, event.currentTarget)}
                  />
                  <Button variant="ghost" size="sm" class="min-h-11 justify-self-end sm:min-h-9" onclick={() => removeScene(actIndex, sceneIndex)} aria-label={`${scene.title} 제외`} disabled={working || applied !== null}>제외</Button>
                  <p class="text-muted-foreground col-span-full text-xs">{scene.lines.length}줄 · 큐 {scene.cues.length}개{scene.summary ? ` · ${scene.summary}` : ""}</p>
                  {#if timedLines.length}
                    <details class="col-span-full mt-1 rounded-lg border px-3 text-sm">
                      <summary class="min-h-11 cursor-pointer py-3">원문 타임코드 <span class="text-muted-foreground ms-1 text-xs">{timedLines.length}줄</span></summary>
                      <ul class="divide-y">
                        {#each timedLines as line (line)}
                          <li class="grid gap-0.5 py-2 sm:grid-cols-[max-content_minmax(0,1fr)] sm:gap-3">
                            <span class="text-muted-foreground font-mono text-xs leading-6 tabular-nums">{formatTimelineTime(line.startMs ?? 0)}</span>
                            <span class="min-w-0 [overflow-wrap:anywhere]">{line.speaker ? `${line.speaker} · ` : ""}{line.text}</span>
                          </li>
                        {/each}
                      </ul>
                    </details>
                  {/if}
                </li>
              {/each}
            </ul>
          </div>
        {/each}
      </div>

      {#if cueReview}
        <DirectorCueReview review={cueReview} scenes={reviewScenes} bind:selected={includedCues} bind:links={linkedScenes} disabled={busy || working || applied !== null} />
      {/if}

      <div class="flex flex-wrap items-center gap-2">
        <Button class="min-h-11" disabled={busy || working} onclick={() => register(reviewedCuePayload())}>{working ? "반영 중…" : applied ? "구성 반영 다시 시도" : "검토한 초안 반영하기"}</Button>
        <Button variant="outline" class="min-h-11" disabled={busy || working || applied !== null} onclick={() => { step = "input"; }}>대본으로 돌아가기</Button>
      </div>
    </div>

  {:else if step === "done" && result && applied}
    <div class="space-y-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-6">
      <p class="font-semibold">대본과 장면을 등록했어요</p>
      <p class="text-sm leading-relaxed">장면 {result.scenes}개 · 큐 {result.cues}개 · 새 배역 {result.roles}개를 공연에 반영했어요.</p>
      <div class="flex flex-wrap gap-2">
        <Button href={`/app/p/${pid}/live?source=${encodeURIComponent(applied.scriptId)}`} class="min-h-11">원문 시간으로 연습</Button>
        <Button href={`/app/p/${pid}`} variant="outline" class="min-h-11">공연 홈에서 다음 할 일 보기</Button>
        <Button variant="ghost" class="min-h-11" onclick={onVideos}>자료 연결 (선택)</Button>
        <Button variant="ghost" class="min-h-11" onclick={reset}>다른 대본 등록</Button>
      </div>
    </div>
  {/if}

  {#if error}<p role="alert" class="text-destructive text-sm">{error}</p>{/if}
</section>
