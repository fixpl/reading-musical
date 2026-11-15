<script lang="ts">
  import { onDestroy } from "svelte";
  import { toast } from "svelte-sonner";
  import { apiRequest } from "$lib/api/client";
  import { linkMedia, slotForMime, uploadMediaFile } from "$lib/api/composition-media";
  import { assertCurrentSession, captureSession, isCurrentSession, type ClientSession } from "$lib/api/session";
  import { Button } from "$lib/components/ui/button";
  import { formatTime, sectionOrder, type CompositionSection } from "$lib/domain/composition";
  import { suggestScenes } from "$lib/domain/video-match";

  let { pid, sections, busy, dirty = $bindable(false), onDone }: {
    pid: string; sections: CompositionSection[]; busy: boolean; dirty?: boolean; onDone: (session?: ClientSession) => Promise<void>;
  } = $props();

  type Item = {
    key: string; file: File; sectionId: string; duration: number | null; playable: boolean | null;
    status: "ready" | "uploading" | "linked" | "failed"; message: string;
  };
  const MAX_BYTES = 500 * 1024 * 1024;
  let items = $state<Item[]>([]);
  let dragging = $state(false);
  let working = $state(false);
  let matching = $state(false);
  // MP4가 아니어서 올리지 못한 영상 — 변환 안내를 보여 주는 데 쓴다.
  let needsConvert = $state<string[]>([]);
  let reasons = $state<Record<string, string>>({});
  let error = $state("");
  let disposed = false;
  const viewSession = captureSession();
  onDestroy(() => { disposed = true; });
  const ordered = $derived(sectionOrder(sections));
  const queued = $derived(items.filter((item) => item.sectionId && item.playable !== false && item.status !== "linked" && item.file.size <= MAX_BYTES));
  // 아직 올리지 않았고 장면까지 고른 파일이 있을 때만 "저장하지 않은 변경"이다. 연결된 영상은 그 순간 저장되고, "연결 안 함"인 파일은 저장할 내용이 아니다.
  $effect(() => { dirty = items.some((item) => item.status !== "linked" && item.sectionId !== "" && item.playable !== false); });

  // 브라우저가 재생하지 못하는 파일(ProRes 등)은 올리기 전에 알려 준다.
  function probe(file: File): Promise<{ duration: number | null; playable: boolean }> {
    return new Promise((resolve) => {
      if (!file.type.startsWith("video/") && !/\.(mp4|m4v|webm|mov)$/i.test(file.name)) return resolve({ duration: null, playable: true });
      const video = document.createElement("video");
      const url = URL.createObjectURL(file);
      const finish = (value: { duration: number | null; playable: boolean }) => { URL.revokeObjectURL(url); video.removeAttribute("src"); video.load(); resolve(value); };
      const timer = setTimeout(() => finish({ duration: null, playable: true }), 8000);
      video.preload = "metadata";
      video.onloadedmetadata = () => { clearTimeout(timer); finish({ duration: Number.isFinite(video.duration) ? video.duration : null, playable: video.videoWidth > 0 }); };
      video.onerror = () => { clearTimeout(timer); finish({ duration: null, playable: false }); };
      video.src = url;
    });
  }

  async function add(files: File[], fromFolder = false) {
    error = ""; needsConvert = [];
    // 영상은 MP4(H.264)만 올린다. MOV·WebM 등은 따로 걸러서 변환 방법을 안내한다.
    const unsupportedVideo = files.filter((file) => /\.(mov|webm|avi|mkv|mts|m2ts|wmv|flv)$/i.test(file.name));
    const accepted = files.filter((file) => /\.(mp4|m4v|mp3|wav|m4a|aac|png|jpe?g|webp)$/i.test(file.name) && !file.name.startsWith("."));
    // 폴더에는 .DS_Store 같은 숨김 파일이 섞여 있으므로 폴더로 고를 때는 조용히 건너뛴다.
    if (unsupportedVideo.length) {
      needsConvert = unsupportedVideo.map((file) => file.name);
      error = `영상은 MP4(H.264)만 올릴 수 있어요. ${unsupportedVideo.length}개(${unsupportedVideo.slice(0, 2).map((file) => file.name).join(", ")}${unsupportedVideo.length > 2 ? " 외" : ""})는 제외했어요. 아래 변환 방법을 참고해 주세요.`;
    } else if (!fromFolder && accepted.length !== files.length) error = "MP4 영상·이미지·음원(mp3·wav·m4a·aac) 파일만 올릴 수 있어요. 지원하지 않는 파일은 제외했어요.";
    if (fromFolder && !accepted.length) { error = "이 폴더에서 올릴 수 있는 영상·이미지·음원 파일을 찾지 못했어요."; return; }
    const fresh = accepted.filter((file) => !items.some((item) => item.file.name === file.name && item.file.size === file.size));
    const suggestions = suggestScenes(fresh.map((file) => file.name), ordered);
    const added: Item[] = fresh.map((file, index) => ({ key: `${file.name}:${file.size}:${Math.random()}`, file, sectionId: suggestions[index] ?? "", duration: null, playable: null, status: "ready", message: "" }));
    items = [...items, ...added];
    for (const item of added) {
      const info = await probe(item.file);
      const target = items.find((candidate) => candidate.key === item.key);
      if (target) { target.duration = info.duration; target.playable = info.playable; if (!info.playable) { target.sectionId = ""; target.message = "이 브라우저에서는 재생할 수 없는 형식이에요(ProRes·MJPEG 등). MP4(H.264)로 변환해 올려 주세요."; } }
    }
  }
  function pick(event: Event, fromFolder = false) {
    const input = event.currentTarget as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = "";
    void add(files, fromFolder);
  }

  // AI가 파일 이름과 장면 제목·내용을 보고 장면을 추천한다(영상 내용은 보지 않는다). 직접 고른 장면도 바뀌므로 눌렀을 때만 동작한다.
  async function aiMatch() {
    const targets = items.filter((item) => item.status !== "linked" && item.playable !== false);
    if (!targets.length || matching || working) return;
    matching = true; error = "";
    try {
      const result = await apiRequest<{ matches: Array<{ file: string; sectionId: string | null; reason: string | null }> }>(`/productions/${pid}/ai/match-media`, {
        method: "POST", body: JSON.stringify({ fileNames: targets.map((item) => item.file.name) })
      });
      const byFile = new Map(result.matches.map((match) => [match.file, match]));
      let picked = 0;
      for (const item of targets) {
        const match = byFile.get(item.file.name);
        if (match?.sectionId) { item.sectionId = match.sectionId; picked += 1; }
        reasons[item.key] = match?.reason ?? "";
      }
      toast.success(picked ? `AI가 ${targets.length}개 중 ${picked}개의 장면을 추천했어요. 맞는지 확인해 주세요.` : "AI가 추천할 장면을 찾지 못했어요. 장면을 직접 골라 주세요.");
    } catch (failure) {
      error = failure instanceof Error ? failure.message : "AI 추천을 받지 못했어요.";
    } finally { matching = false; }
  }
  function drop(event: DragEvent) {
    event.preventDefault(); dragging = false;
    void add([...(event.dataTransfer?.files ?? [])]);
  }
  const sectionLabel = (section: CompositionSection) => `${section.parentId ? "　↳ " : ""}${section.title}${section.media.some((m) => m.slot === "BACKGROUND") ? " · 영상 교체" : ""}`;

  async function linkAll() {
    const session = captureSession(); const id = pid;
    if (disposed || !isCurrentSession(viewSession) || working || busy || !queued.length) return;
    working = true; error = "";
    let done = 0;
    try {
      for (const item of queued) {
        if (disposed || id !== pid || !isCurrentSession(session)) return;
        item.status = "uploading"; item.message = "올리는 중…";
        try {
          const uploaded = await uploadMediaFile(id, item.file, session);
          assertCurrentSession(session);
          if (disposed || id !== pid) return;
          const slot = slotForMime(uploaded.mime);
          const title = await linkMedia(id, item.sectionId, uploaded.assetId, slot, item.file.name.replace(/\.[^.]+$/, ""), session);
          if (disposed || id !== pid || !isCurrentSession(session)) return;
          item.status = "linked"; item.message = `${title}에 연결했어요.`; done += 1;
        } catch (failure) {
          if (disposed || id !== pid || !isCurrentSession(session) || (failure instanceof Error && failure.name === "AbortError")) return;
          item.status = "failed"; item.message = failure instanceof Error ? failure.message : "파일을 올리지 못했어요.";
        }
      }
    } finally {
      if (!disposed && id === pid && isCurrentSession(session)) {
        working = false;
        await onDone(session);
      }
    }
    if (disposed || id !== pid || !isCurrentSession(session)) return;
    if (done) toast.success(`영상 ${done}개를 연결했어요.`);
    if (queued.some((item) => item.status === "failed")) error = "일부 파일을 연결하지 못했어요. 실패한 줄을 확인하고 다시 눌러 주세요(이미 연결한 파일은 다시 올리지 않아요).";
  }
</script>

<section class="space-y-4" aria-label="장면 영상 연결">
  <div>
    <h2 class="text-lg font-semibold">장면 영상 연결</h2>
    <p class="text-muted-foreground mt-1 text-sm leading-relaxed">영상 파일을 한꺼번에 올리고 장면을 고르면 <strong class="text-foreground">장면이 끝날 때까지 반복 재생되는 배경</strong>으로 연결돼요. 10~15초의 짧은 영상도 장면이 끝날 때까지 계속 반복해요. 이미 영상이 있는 장면은 새 영상으로 교체돼요. <strong class="text-foreground">“올리고 연결”을 누르면 바로 저장</strong>되며 따로 저장할 필요는 없어요.</p>
  </div>

  <label
    class={["flex min-h-32 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed p-5 text-center transition-colors", dragging ? "border-primary bg-primary/5" : "hover:bg-muted/40"]}
    ondragover={(event) => { event.preventDefault(); dragging = true; }} ondragleave={() => (dragging = false)} ondrop={drop}
  >
    <input type="file" multiple class="sr-only" accept="video/mp4,audio/mpeg,image/png,image/jpeg,image/webp,.mp4,.m4v,.mp3,.wav,.m4a,.aac,.png,.jpg,.jpeg,.webp" onchange={pick} disabled={working || busy} />
    <span class="text-sm font-semibold">영상 파일을 끌어다 놓거나 눌러서 여러 개 선택해 주세요</span>
    <span class="text-muted-foreground text-xs">영상은 MP4(H.264) · 이미지 · 음원(MP3 등) · 파일당 500MB 이하</span>
  </label>
  <div class="flex flex-wrap items-center gap-2">
    <label class="bg-background hover:bg-muted inline-flex min-h-11 cursor-pointer items-center rounded-md border px-4 text-sm font-medium">
      폴더 통째로 선택
      <input type="file" class="sr-only" webkitdirectory multiple onchange={(event) => pick(event, true)} disabled={working || busy} />
    </label>
    <span class="text-muted-foreground text-xs">폴더 안의 영상·음원·이미지를 한 번에 선택할 수 있어요. 영상 내용은 분석하지 않고 파일 이름의 번호와 단어를 바탕으로 장면을 추천해요.</span>
  </div>

  {#if items.length}
    <ul class="divide-y rounded-xl border">
      {#each items as item (item.key)}
        <li class="grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,16rem)] sm:items-center">
          <div class="min-w-0">
            <p class="truncate text-sm font-medium">{item.file.name}</p>
            <p class="text-muted-foreground text-xs">{(item.file.size / 1048576).toFixed(1)}MB{item.duration ? ` · ${formatTime(item.duration * 1000)}` : ""}{item.playable === null ? " · 확인 중…" : ""}</p>
            {#if item.file.size > MAX_BYTES}<p class="text-destructive text-xs">500MB를 넘는 파일은 올릴 수 없어요.</p>{/if}
            {#if reasons[item.key] && item.sectionId}<p class="text-primary text-xs">AI 추천 이유 · {reasons[item.key]}</p>{/if}
            {#if item.message}<p class={["text-xs", item.status === "failed" || item.playable === false ? "text-destructive" : "text-muted-foreground"]}>{item.message}</p>{/if}
          </div>
          <div class="flex items-center gap-2">
            <select class="bg-background h-10 min-w-0 flex-1 rounded-md border px-2 text-sm" bind:value={item.sectionId} disabled={working || item.status === "linked" || item.playable === false} aria-label={`${item.file.name} 연결할 장면`}>
              <option value="">연결 안 함</option>
              {#each ordered as section (section.id)}<option value={section.id}>{sectionLabel(section)}</option>{/each}
            </select>
            {#if item.status === "linked"}<span class="text-xs font-semibold text-emerald-600">연결됨</span>
            {:else}<Button variant="ghost" size="sm" disabled={working} onclick={() => (items = items.filter((candidate) => candidate.key !== item.key))} aria-label="목록에서 제외">제외</Button>{/if}
          </div>
        </li>
      {/each}
    </ul>
    {#if needsConvert.length || items.some((item) => item.playable === false)}
      <details class="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-sm" open>
        <summary class="cursor-pointer font-semibold">MP4로 바꿔서 올려 주세요{needsConvert.length ? ` (${needsConvert.length}개)` : ""}</summary>
        <div class="text-muted-foreground mt-2 space-y-2 text-xs leading-relaxed">
          <p>영상은 <strong class="text-foreground">MP4(H.264)</strong>만 올릴 수 있어요. 카메라·편집 프로그램에서 내보낸 MOV(ProRes 등)는 브라우저가 재생하지 못하는 경우가 많고, MP4로 바꾸면 용량도 10분의 1 이하로 줄어요.</p>
          <ul class="list-disc space-y-1 ps-5">
            <li><strong class="text-foreground">HandBrake(무료)</strong>: 파일을 열고 프리셋 “Fast 1080p30”, 형식 MP4로 두고 ‘Start’.</li>
            <li><strong class="text-foreground">터미널(ffmpeg)</strong>: <code class="bg-muted rounded px-1 break-all">ffmpeg -i 원본.mov -an -vf "scale='min(1920,iw)':-2,format=yuv420p" -c:v libx264 -crf 24 -movflags +faststart 결과.mp4</code></li>
            <li>여러 개는 프로젝트의 <code class="bg-muted rounded px-1">node scripts/prepare-web-media.mjs 원본폴더 출력폴더</code>로 한꺼번에 바꿀 수 있어요.</li>
          </ul>
          <p>소리가 필요 없는 배경 영상은 위 설정처럼 소리를 빼면 용량을 가장 많이 줄일 수 있어요.</p>
        </div>
      </details>
    {/if}
    <p class="text-muted-foreground text-xs leading-relaxed">장면 추천은 파일 이름(예: <code>#3</code>, <code>moon</code>)과 장면 제목·내용만 바탕으로 정해요. 같은 번호의 파일이 여러 개면 하나만 배정되므로 나머지는 직접 골라 주세요. 영상 내용과 맞는지 직접 확인하고 바꿔 주세요.</p>
    <div class="flex flex-wrap items-center gap-2">
      <Button variant="outline" class="min-h-11" disabled={working || busy || matching} onclick={aiMatch}>{matching ? "AI가 맞춰 보는 중…" : "AI로 장면 추천"}</Button>
      <Button class="min-h-11" disabled={working || busy || !queued.length} onclick={linkAll}>{working ? "올리고 연결하는 중…" : `${queued.length}개 올리고 연결`}</Button>
      <Button variant="ghost" class="min-h-11" disabled={working} onclick={() => (items = items.filter((item) => item.status !== "linked"))}>연결 끝난 항목 지우기</Button>
      {#if items.some((item) => item.status === "linked") && !queued.length}<span class="text-xs font-semibold text-emerald-600">✓ 연결한 영상을 저장했어요</span>{/if}
    </div>
  {/if}
  {#if error}<p role="alert" class="text-destructive text-sm">{error}</p>{/if}
</section>
