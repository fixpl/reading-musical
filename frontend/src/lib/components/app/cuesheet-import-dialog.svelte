<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import { toast } from "svelte-sonner";
  import { apiRequest } from "$lib/api/client";
  import { captureSession, isCurrentSession } from "$lib/api/session";
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { Textarea } from "$lib/components/ui/textarea";
  import { parseCuesheet, type ImportRow } from "$lib/domain/cuesheet-import";

  // 엑셀·구글시트·한글 문서의 큐시트 표를 가져온다. 올리면 먼저 미리 보고(저장 안 함), 확인한 뒤에 등록한다.
  let { pid, onClose, onDone }: { pid: string; onClose: () => void; onDone: () => Promise<void> | void } = $props();

  type Preview = { total: number; newTracks: string[]; sceneLinked: number; warnings: string[] };
  let text = $state("");
  let fileName = $state("");
  let rows = $state<ImportRow[]>([]);
  let problems = $state<string[]>([]);
  let preview = $state<Preview | null>(null);
  let working = $state(false);
  let error = $state("");
  const ownerSession = captureSession();
  type ImportRequest = { productionId: string; version: number; controller: AbortController };
  let activePid = untrack(() => pid);
  let disposed = false;
  let requestVersion = 0;
  let requestController: AbortController | null = null;
  let previewRequest: ImportRequest | null = null;

  function synchronizeProduction(productionId: string) {
    if (productionId === activePid) return;
    requestController?.abort(); requestVersion += 1; activePid = productionId;
    text = ""; fileName = ""; rows = []; problems = []; preview = null; previewRequest = null; working = false; error = "";
  }
  $effect(() => {
    const productionId = pid;
    untrack(() => synchronizeProduction(productionId));
  });
  onDestroy(() => { disposed = true; requestVersion += 1; requestController?.abort(); });

  function current(request: ImportRequest) {
    // 계정 확인 중 root가 동기적으로 화면을 폐기할 수 있으므로 생존 여부를 다시 확인한다.
    return !disposed && isCurrentSession(ownerSession) && !disposed && request.productionId === pid &&
      request.productionId === activePid && request.version === requestVersion && !request.controller.signal.aborted;
  }
  function startRequest(): ImportRequest | null {
    if (disposed || !isCurrentSession(ownerSession) || disposed) return null;
    synchronizeProduction(pid);
    requestController?.abort();
    requestController = new AbortController();
    return { productionId: pid, version: ++requestVersion, controller: requestController };
  }
  function close() {
    if (!disposed && isCurrentSession(ownerSession) && !disposed) onClose();
  }
  function invalidatePreview() {
    if (disposed || !isCurrentSession(ownerSession) || disposed) return;
    requestController?.abort(); requestVersion += 1;
    preview = null; previewRequest = null; rows = []; problems = []; working = false; error = "";
  }

  async function previewSource(source: string, request: ImportRequest) {
    if (!current(request)) return;
    error = ""; preview = null; previewRequest = null; rows = []; problems = [];
    if (!source.trim()) return;
    const parsed = parseCuesheet(source);
    rows = parsed.rows; problems = parsed.problems;
    if (!rows.length) return;
    const result = await apiRequest<Preview>(`/productions/${request.productionId}/cue-sheet/import`, {
      method: "POST", session: ownerSession, signal: request.controller.signal, body: JSON.stringify({ rows, dryRun: true })
    });
    if (!current(request)) return;
    preview = result; previewRequest = request;
  }

  async function analyze(source: string) {
    if (working) return;
    const request = startRequest();
    if (!request) return;
    working = true;
    try { await previewSource(source, request); }
    catch (failure) { if (current(request)) error = failure instanceof Error ? failure.message : "미리보기를 만들지 못했어요."; }
    finally { if (current(request)) working = false; }
  }
  async function pick(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file || working) return;
    const request = startRequest();
    if (!request) return;
    preview = null; previewRequest = null; rows = []; problems = [];
    if (file.size > 2 * 1024 * 1024) { error = "2MB 이하의 파일만 올릴 수 있어요."; return; }
    fileName = file.name;
    working = true; error = "";
    try {
      const source = await file.text();
      if (!current(request)) return;
      text = source;
      await previewSource(source, request);
    } catch (failure) { if (current(request)) error = failure instanceof Error ? failure.message : "파일을 읽지 못했어요."; }
    finally { if (current(request)) working = false; }
  }
  async function commit() {
    if (!rows.length || working || !preview || !previewRequest || !current(previewRequest)) return;
    const request = startRequest();
    if (!request) return;
    previewRequest = request;
    working = true; error = "";
    try {
      const result = await apiRequest<{ created: number; newTracks: string[] }>(`/productions/${request.productionId}/cue-sheet/import`, {
        method: "POST", session: ownerSession, signal: request.controller.signal, body: JSON.stringify({ rows })
      });
      if (!current(request)) return;
      toast.success(`큐 ${result.created}개를 가져왔어요${result.newTracks.length ? ` · 새 트랙 ${result.newTracks.join(", ")}` : ""}.`);
      await onDone();
      if (current(request)) close();
    } catch (failure) { if (current(request)) error = failure instanceof Error ? failure.message : "큐를 가져오지 못했어요."; }
    finally { if (current(request)) working = false; }
  }
</script>

<Dialog.Root open onOpenChange={(open) => { if (!open && !working) close(); }}>
  <Dialog.Content class="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
    <Dialog.Header>
      <Dialog.Title>엑셀에서 큐시트 가져오기</Dialog.Title>
      <Dialog.Description>엑셀·구글시트에서 “CSV로 저장”한 파일을 올리거나 표를 복사해 붙여 넣어 주세요. 가져온 큐는 기존 큐 뒤에 추가되고, 기존 큐는 바뀌지 않아요.</Dialog.Description>
    </Dialog.Header>

    <div class="space-y-3 text-sm">
      <div class="bg-muted/40 rounded-lg p-3 text-xs leading-relaxed">
        <p class="font-semibold">표 첫 줄(머리글)에 이런 이름이 있으면 알아서 읽어요</p>
        <p class="text-muted-foreground mt-1"><strong class="text-foreground">부서</strong>(필수) · <strong class="text-foreground">내용</strong>(필수) · 큐번호 · 시간(1:30) · 장면 · 계기 · 출연 · 길이(초) · 비고. 우리 큐시트의 “엑셀로 내보내기” 파일을 그대로 올려도 돼요.</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <label class="border-input hover:bg-accent inline-flex min-h-10 cursor-pointer items-center rounded-md border px-4 text-sm font-medium">CSV 파일 선택<input type="file" class="sr-only" accept=".csv,.tsv,.txt,text/csv,text/plain" onchange={pick} disabled={working} /></label>
        {#if fileName}<span class="text-muted-foreground text-xs">{fileName}</span>{/if}
      </div>
      <Textarea rows={5} bind:value={text} placeholder={"또는 엑셀에서 복사한 표를 여기에 붙여넣기\n큐번호\t시간\t부서\t내용\n조01\t0:30\t조명\t무대를 천천히 밝힌다"} aria-label="표 붙여넣기" disabled={working} oninput={invalidatePreview} onblur={() => text.trim() && !preview && analyze(text)} />
      <Button variant="outline" class="min-h-10" disabled={working || !text.trim()} onclick={() => analyze(text)}>{working ? "확인 중…" : "내용 확인"}</Button>

      {#if preview}
        <div class="rounded-xl border p-3">
          <p class="font-semibold">큐 {preview.total}개를 가져올 수 있어요</p>
          <ul class="text-muted-foreground mt-1 space-y-0.5 text-xs">
            <li>대본 장면과 연결되는 큐 {preview.sceneLinked}개{preview.total - preview.sceneLinked ? ` · 나머지 ${preview.total - preview.sceneLinked}개는 “장면 미지정”` : ""}</li>
            {#if preview.newTracks.length}<li>새로 만들 트랙(부서): <strong class="text-foreground">{preview.newTracks.join(", ")}</strong></li>{/if}
          </ul>
          <div class="mt-3 overflow-x-auto">
            <table class="w-full min-w-[32rem] text-xs"><thead class="text-muted-foreground text-left"><tr><th class="py-1 pe-3 font-medium">큐번호</th><th class="pe-3 font-medium">시간</th><th class="pe-3 font-medium">부서</th><th class="font-medium">내용</th></tr></thead>
              <tbody class="divide-y">{#each rows.slice(0, 6) as row, index (index)}<tr><td class="py-1.5 pe-3">{row.cueNumber ?? "자동"}</td><td class="pe-3 tabular-nums">{row.startMs != null ? `${Math.floor(row.startMs / 60000)}:${String(Math.floor((row.startMs % 60000) / 1000)).padStart(2, "0")}` : "—"}</td><td class="pe-3">{row.track}</td><td class="max-w-[18rem] truncate">{row.content}</td></tr>{/each}</tbody></table>
            {#if rows.length > 6}<p class="text-muted-foreground mt-1 text-xs">… 외 {rows.length - 6}줄</p>{/if}
          </div>
        </div>
      {/if}
      {#if problems.length || preview?.warnings.length}
        <details class="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-xs" open={(problems.length + (preview?.warnings.length ?? 0)) <= 4}>
          <summary class="cursor-pointer font-semibold">확인할 점 {problems.length + (preview?.warnings.length ?? 0)}개</summary>
          <ul class="text-muted-foreground mt-2 list-disc space-y-0.5 ps-5">{#each [...problems, ...(preview?.warnings ?? [])].slice(0, 30) as line (line)}<li>{line}</li>{/each}</ul>
        </details>
      {/if}
      {#if error}<p role="alert" class="text-destructive text-sm">{error}</p>{/if}
    </div>

    <Dialog.Footer class="gap-2">
      <Button variant="ghost" class="min-h-10" disabled={working} onclick={close}>취소</Button>
      <Button class="min-h-10" disabled={working || !preview || !rows.length} onclick={commit}>{working ? "처리 중…" : preview ? `${preview.total}개 가져오기` : "가져오기"}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
