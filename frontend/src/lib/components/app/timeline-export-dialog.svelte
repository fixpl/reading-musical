<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import { apiRequest } from "$lib/api/client";
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { syncMedia } from "$lib/actions/sync-media";
  import { formatTime, secondsInput } from "$lib/domain/composition";
  import {
    assetsInRange, CORS_HINT, estimateExport, exportFileName, exportRange, frameAt, mediaInRange, pickRecorderMime, RESOLUTIONS, WEBM_FALLBACK_NOTICE, wrapLines,
    type ExportCaption, type ExportFrame, type ExportMedia, type ExportScope, type ExportSource, type ResolutionKey
  } from "$lib/domain/timeline-export";

  // 연습 화면에서 보이는 것(배경 영상·이미지, 자막, 장면 제목, 음악)을 이 탭에서 실시간으로 그려 MP4로 녹화한다.
  // 서버에서 렌더링하지 않으므로 선택한 길이만큼 시간이 걸린다.
  let { source, nowMs, productionTitle, onClose }: { source: ExportSource; nowMs: number; productionTitle: string; onClose: () => void } = $props();

  type Signed = { url: string; expiresAt?: string };
  type Slot = { key: string; assetId: string; el: HTMLImageElement | HTMLMediaElement; handle: ReturnType<typeof syncMedia> | null; node: MediaElementAudioSourceNode | null; gain: GainNode | null; dispose: () => void; lastUsed: number; ready: boolean };

  const SCOPES: Array<{ id: ExportScope; label: string }> = [
    { id: "SCENE", label: "현재 장면" }, { id: "ACT", label: "현재 막" }, { id: "ALL", label: "전체" }, { id: "CUSTOM", label: "시작·끝 지정" }
  ];
  const FONT = '"Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif';
  const FPS = 30;

  const openedAt = untrack(() => nowMs);
  let scope = $state<ExportScope>("SCENE");
  let resolution = $state<ResolutionKey>("720");
  let withCaptions = $state(true);
  let startInput = $state("0");
  let endInput = $state(String(Math.floor(untrack(() => source.totalMs) / 1000)));
  let phase = $state<"setup" | "preparing" | "recording" | "done">("setup");
  let error = $state("");
  let warning = $state("");
  let elapsedMs = $state(0);
  let savedName = $state("");
  let savedFallback = $state(false);
  let downloadUrl = "";

  const customRange = $derived.by(() => {
    try { return { startMs: secondsInput(startInput, false) ?? 0, endMs: secondsInput(endInput, false) ?? 0 }; } catch { return null; }
  });
  const resolved = $derived(scope === "CUSTOM" && !customRange
    ? { error: "시작·끝 시각은 초(210) 또는 분:초(3:30)로 입력해 주세요." }
    : exportRange(source, scope, openedAt, customRange ?? undefined));
  const range = $derived("range" in resolved ? resolved.range : null);
  const estimate = $derived(range ? estimateExport(range, resolution) : null);
  const mime = $derived(typeof MediaRecorder === "undefined" ? null : pickRecorderMime((candidate) => MediaRecorder.isTypeSupported(candidate)));
  const busy = $derived(phase === "preparing" || phase === "recording");
  const duration = (seconds: number) => seconds >= 60 ? `${Math.floor(seconds / 60)}분 ${seconds % 60}초` : `${seconds}초`;
  const size = (bytes: number) => bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)}GB` : `${Math.max(1, Math.round(bytes / 1e6))}MB`;

  // 녹화 한 번에 필요한 자원. cleanup()이 전부 되돌린다.
  let cancelled = false;
  let attempt = 0;
  let requests: AbortController | null = null;
  let finishing = false;
  let raf = 0;
  let host: HTMLDivElement | null = null;
  let audioContext: AudioContext | null = null;
  let recorder: MediaRecorder | null = null;
  let streams: MediaStream[] = [];
  let intervals: number[] = [];
  let stopTimer = 0;
  const slots = new Map<string, Slot>();
  const signed = new Map<string, Signed>();
  const pending = new Map<string, Promise<void>>();

  async function ensureSigned(assetId: string) {
    const existing = signed.get(assetId);
    if (existing && (!existing.expiresAt || Date.parse(existing.expiresAt) > Date.now() + 60_000)) return;
    if (!pending.has(assetId)) {
      const run = attempt;
      const request = apiRequest<Signed>(`/assets/${assetId}/url`, { signal: requests?.signal }).then((result) => { if (run === attempt) signed.set(assetId, result); }).finally(() => { if (pending.get(assetId) === request) pending.delete(assetId); });
      pending.set(assetId, request);
    }
    await pending.get(assetId);
  }

  function fail(message: string, run = attempt) {
    if (cancelled || run !== attempt) return;
    cleanup();
    error = message;
    phase = "setup";
  }

  function destroySlot(slot: Slot) {
    slot.dispose();
    slot.handle?.destroy();
    slot.node?.disconnect();
    slot.gain?.disconnect();
    slot.el.removeAttribute("src");
    if (slot.el instanceof HTMLMediaElement) slot.el.load();
    slot.el.remove();
    slots.delete(slot.key);
  }

  function cleanup() {
    cancelled = true;
    attempt += 1;
    requests?.abort();
    requests = null;
    pending.clear();
    cancelAnimationFrame(raf);
    clearTimeout(stopTimer);
    for (const id of intervals) clearInterval(id);
    intervals = [];
    document.removeEventListener("visibilitychange", onVisibility);
    if (recorder) { recorder.ondataavailable = null; recorder.onstop = null; recorder.onerror = null; if (recorder.state !== "inactive") try { recorder.stop(); } catch { /* 이미 멈춤 */ } }
    recorder = null;
    for (const slot of [...slots.values()]) destroySlot(slot);
    for (const stream of streams) for (const track of stream.getTracks()) track.stop();
    streams = [];
    void audioContext?.close().catch(() => {});
    audioContext = null;
    destination = null;
    active = null;
    host?.remove();
    host = null;
  }

  onDestroy(() => {
    cleanup();
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  });

  function getSlot(media: ExportMedia, running: boolean): Slot | null {
    const run = attempt;
    const existing = slots.get(media.key);
    if (existing) { existing.lastUsed = performance.now(); return existing; }
    const url = signed.get(media.assetId)?.url;
    if (!url) { void ensureSigned(media.assetId).catch((cause: unknown) => fail(cause instanceof Error ? cause.message : "자료 주소를 불러오지 못했어요.", run)); return null; }
    const loadFailed = () => fail(`자료를 불러오지 못했어요. ${CORS_HINT}`, run);
    let slot: Slot;
    if (media.kind === "IMAGE") {
      const image = new Image();
      image.crossOrigin = "anonymous";
      const loaded = () => { slot.ready = true; };
      image.addEventListener("load", loaded);
      image.addEventListener("error", loadFailed);
      image.src = url;
      slot = { key: media.key, assetId: media.assetId, el: image, handle: null, node: null, gain: null, dispose: () => { image.removeEventListener("load", loaded); image.removeEventListener("error", loadFailed); }, lastUsed: performance.now(), ready: false };
    } else {
      const element = document.createElement(media.kind === "VIDEO" ? "video" : "audio");
      element.crossOrigin = "anonymous";
      element.preload = "auto";
      if (element instanceof HTMLVideoElement) element.playsInline = true;
      const loaded = () => { slot.ready = true; };
      element.addEventListener("loadeddata", loaded);
      element.addEventListener("error", loadFailed);
      element.src = url;
      host?.append(element);
      slot = { key: media.key, assetId: media.assetId, el: element, handle: null, node: null, gain: null, dispose: () => { element.removeEventListener("loadeddata", loaded); element.removeEventListener("error", loadFailed); }, lastUsed: performance.now(), ready: false };
      // 소리는 화면 스피커가 아니라 녹화용 출력으로만 보낸다.
      if (audioContext && destination) {
        slot.node = audioContext.createMediaElementSource(element);
        slot.gain = audioContext.createGain();
        slot.gain.gain.value = Math.max(0, Math.min(1, media.volume));
        slot.node.connect(slot.gain).connect(destination);
      }
      slot.handle = syncMedia(element, { time: media.timeSec, play: running, rate: 1, muted: false, loop: media.loop, sourceStart: media.sourceStartSec, onError: (message) => fail(message, run) });
    }
    slots.set(media.key, slot);
    return slot;
  }

  let destination: MediaStreamAudioDestinationNode | null = null;

  function sync(frame: ExportFrame, running: boolean) {
    const run = attempt;
    const used = new Set<string>();
    for (const media of [...(frame.background ? [frame.background] : []), ...frame.audio]) {
      const slot = getSlot(media, running);
      if (!slot) continue;
      used.add(slot.key);
      slot.handle?.update({ time: media.timeSec, play: running, rate: 1, muted: false, loop: media.loop, sourceStart: media.sourceStartSec, onError: (message) => fail(message, run) });
    }
    const now = performance.now();
    for (const slot of [...slots.values()]) {
      if (used.has(slot.key)) continue;
      slot.handle?.update({ time: slot.el instanceof HTMLMediaElement ? slot.el.currentTime : 0, play: false, rate: 1, muted: false, onError: (message) => fail(message, run) });
      if (now - slot.lastUsed > 15_000) destroySlot(slot);
    }
  }

  function roundedBox(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number) {
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, radius); else ctx.rect(x, y, w, h);
    ctx.fill();
  }

  function drawCaptions(ctx: CanvasRenderingContext2D, width: number, height: number, frame: ExportFrame) {
    const text = Math.round(height * 0.042);
    const label = Math.round(text * 0.7);
    const pad = Math.round(text * 0.6);
    const boxWidth = width * 0.84;
    const items: Array<{ speaker: string; text: string }> = frame.captions.length ? frame.captions.map((caption: ExportCaption) => ({ speaker: (caption.lyric ? "♪ " : "") + caption.speaker, text: caption.text })) : frame.note ? [{ speaker: frame.note.label, text: frame.note.text }] : [];
    ctx.textBaseline = "top";
    ctx.textAlign = "center";
    let bottom = height - height * 0.05;
    for (const item of items.reverse()) {
      ctx.font = `${text}px ${FONT}`;
      const lines = wrapLines(item.text, boxWidth - pad * 2, (value) => ctx.measureText(value).width);
      const lineHeight = Math.round(text * 1.4);
      const boxHeight = pad * 2 + label * 1.4 + lines.length * lineHeight;
      const top = bottom - boxHeight;
      if (top < height * 0.1) break;
      ctx.fillStyle = "rgba(0, 0, 0, 0.82)";
      roundedBox(ctx, (width - boxWidth) / 2, top, boxWidth, boxHeight, text * 0.5);
      ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
      ctx.font = `700 ${label}px ${FONT}`;
      ctx.fillText(item.speaker, width / 2, top + pad);
      ctx.fillStyle = "#fff";
      ctx.font = `${text}px ${FONT}`;
      lines.forEach((line, index) => ctx.fillText(line, width / 2, top + pad + label * 1.4 + index * lineHeight));
      bottom = top - text * 0.4;
    }
  }

  function drawSceneTitle(ctx: CanvasRenderingContext2D, height: number, frame: ExportFrame) {
    if (frame.sceneTitle) {
      const size = Math.round(height * 0.03);
      ctx.font = `600 ${size}px ${FONT}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      const w = ctx.measureText(frame.sceneTitle).width + size * 1.6;
      ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
      roundedBox(ctx, size, size, w, size * 2, size * 0.5);
      ctx.fillStyle = "#fff";
      ctx.fillText(frame.sceneTitle, size * 1.8, size * 1.5 - size * 0.05);
    }
  }

  function draw(ctx: CanvasRenderingContext2D, width: number, height: number, frame: ExportFrame) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
    const slot = frame.background ? slots.get(frame.background.key) : null;
    if (slot?.ready) {
      const el = slot.el;
      const sw = el instanceof HTMLVideoElement ? el.videoWidth : (el as HTMLImageElement).naturalWidth;
      const sh = el instanceof HTMLVideoElement ? el.videoHeight : (el as HTMLImageElement).naturalHeight;
      if (sw && sh && (!(el instanceof HTMLVideoElement) || el.readyState >= 2)) {
        const scale = Math.min(width / sw, height / sh);
        ctx.drawImage(el as CanvasImageSource, (width - sw * scale) / 2, (height - sh * scale) / 2, sw * scale, sh * scale);
      }
    }
    if (withCaptions) drawCaptions(ctx, width, height, frame);
    drawSceneTitle(ctx, height, frame);
  }

  // 녹화 시계: 탭이 숨겨진 동안은 멈추고, 돌아오면 이어서 진행한다.
  let clockBase = 0;
  let clockStart = 0;
  let hiddenPause = false;
  let buffering = false;
  let active: { duration: number; frameSource: () => ExportFrame } | null = null;
  function onVisibility() {
    if (phase !== "recording" || !recorder) return;
    if (document.hidden && !hiddenPause) {
      if (!buffering) clockBase += performance.now() - clockStart;
      hiddenPause = true;
      if (recorder.state === "recording") recorder.pause();
      if (active) sync(active.frameSource(), false);
      warning = "다른 탭으로 옮겨져서 녹화를 잠시 멈췄어요. 이 탭으로 돌아오면 이어서 녹화해요.";
    } else if (!document.hidden && hiddenPause) {
      clockStart = performance.now();
      hiddenPause = false;
      if (!buffering && recorder.state === "paused") recorder.resume();
      warning = "";
    }
  }

  async function start() {
    if (!range || !mime || busy) return;
    const picked = mime;
    const chosen = range;
    const { width, height, videoBps } = RESOLUTIONS[resolution];
    const run = ++attempt;
    const current = () => !cancelled && run === attempt;
    requests = new AbortController();
    error = ""; warning = ""; elapsedMs = 0; cancelled = false; finishing = false; hiddenPause = false; buffering = false; phase = "preparing";
    try {
      host = document.createElement("div");
      host.setAttribute("aria-hidden", "true");
      host.style.cssText = "position:fixed;left:-10000px;top:0;width:2px;height:2px;overflow:hidden;opacity:0;pointer-events:none";
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      host.append(canvas);
      document.body.append(host);
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) throw new Error("이 브라우저에서는 영상을 그릴 수 없어요.");

      audioContext = new AudioContext();
      await audioContext.resume();
      if (!current()) return;
      destination = audioContext.createMediaStreamDestination();
      const stream = canvas.captureStream(FPS);
      for (const track of destination.stream.getAudioTracks()) stream.addTrack(track);
      streams = [stream, destination.stream];

      const frameSource = () => frameAt(source, chosen.startMs + Math.min(chosen.endMs - chosen.startMs, clockBase + (hiddenPause || buffering ? 0 : performance.now() - clockStart)));
      active = { duration: chosen.endMs - chosen.startMs, frameSource };

      // 시작 전에 구간 안의 자료 주소를 받고, 첫 화면의 자료가 준비될 때까지 기다린다.
      await Promise.all(assetsInRange(source, chosen).map((id) => ensureSigned(id)));
      if (!current()) return;
      const first = frameAt(source, chosen.startMs);
      const preload = (startMs: number) => { for (const media of mediaInRange(source, { ...chosen, startMs, endMs: Math.min(chosen.endMs, startMs + 5000) })) getSlot(media, false); };
      preload(chosen.startMs);
      sync(first, false);
      const ready = (frame: ExportFrame) => [frame.background, ...frame.audio].every((media) => {
        if (!media) return true;
        const slot = slots.get(media.key);
        return slot?.ready && (!(slot.el instanceof HTMLMediaElement) || (slot.el.readyState >= 2 && !slot.el.seeking));
      });
      const deadline = performance.now() + 15_000;
      while (current() && !ready(first) && performance.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
      if (!current()) return;
      if (!ready(first)) throw new Error(`자료를 준비하지 못했어요. ${CORS_HINT}`);
      draw(ctx, width, height, first);
      try { ctx.getImageData(0, 0, 1, 1); } catch (cause) { throw cause instanceof DOMException && cause.name === "SecurityError" ? new Error(CORS_HINT) : cause; }

      const chunks: Blob[] = [];
      const output = new MediaRecorder(stream, { mimeType: picked.mime, videoBitsPerSecond: videoBps, audioBitsPerSecond: 128_000 });
      recorder = output;
      output.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      output.onerror = () => fail("녹화 중 오류가 생겼어요. 다시 시도해 주세요.", run);
      output.onstop = () => {
        if (!current()) return;
        const blob = new Blob(chunks, { type: picked.mime.split(";")[0] });
        const name = exportFileName(productionTitle, chosen.label, picked.extension);
        cleanup();
        if (!blob.size) { error = "녹화된 내용이 비어 있어요. 다시 시도해 주세요."; phase = "setup"; return; }
        downloadUrl = URL.createObjectURL(blob);
        savedName = name; savedFallback = picked.fallback;
        triggerDownload();
        phase = "done";
      };
      document.addEventListener("visibilitychange", onVisibility);
      // 서명 주소가 만료되기 전에 갱신한다(긴 녹화).
      intervals.push(window.setInterval(() => { for (const slot of slots.values()) void ensureSigned(slot.assetId).then(() => { if (!current() || slots.get(slot.key) !== slot) return; const url = signed.get(slot.assetId)?.url; if (url && slot.el instanceof HTMLMediaElement && slot.el.src !== url && !slot.el.ended) slot.el.src = url; }).catch(() => {}); }, 20_000));

      clockBase = 0;
      clockStart = performance.now();
      output.start(1000);
      phase = "recording";
      onVisibility();
      let lastDraw = 0;
      let lastCheck = 0;
      let lastLookahead = 0;
      let waitingSince = 0;
      const total = chosen.endMs - chosen.startMs;
      const tick = (timestamp: number) => {
        if (!current()) return;
        try { if (!hiddenPause) {
          const elapsed = clockBase + (buffering ? 0 : performance.now() - clockStart);
          if (elapsed >= total) { elapsedMs = total; stopRecording(ctx, width, height, chosen.endMs); return; }
          if (timestamp - lastDraw >= 1000 / FPS - 3) {
            lastDraw = timestamp;
            const frame = frameAt(source, chosen.startMs + elapsed);
            sync(frame, !buffering);
            if (!current()) return;
            if (!ready(frame)) {
              if (!buffering) { clockBase = elapsed; buffering = true; waitingSince = performance.now(); if (output.state === "recording") output.pause(); }
              sync(frame, false);
              warning = "자료를 준비하느라 녹화를 잠시 멈췄어요. 준비되면 이어서 녹화해요.";
              if (performance.now() - waitingSince > 15_000) { fail(`자료를 준비하지 못했어요. ${CORS_HINT}`, run); return; }
              raf = requestAnimationFrame(tick);
              return;
            }
            if (buffering) { buffering = false; clockStart = performance.now(); if (output.state === "paused") output.resume(); sync(frame, true); warning = ""; }
            draw(ctx, width, height, frame);
            if (timestamp - lastCheck > 1000) {
              lastCheck = timestamp;
              elapsedMs = elapsed;
              try { ctx.getImageData(0, 0, 1, 1); } catch { fail(CORS_HINT); return; }
            }
            // 곧 나올 자료를 미리 받아 둔다.
            if (timestamp - lastLookahead > 1000) {
              lastLookahead = timestamp;
              preload(chosen.startMs + elapsed);
            }
          }
        } } catch (cause) { fail(cause instanceof DOMException && cause.name === "SecurityError" ? CORS_HINT : cause instanceof Error ? cause.message : "녹화 중 오류가 생겼어요.", run); return; }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    } catch (cause) {
      if (!current()) return;
      const message = cause instanceof DOMException && cause.name === "SecurityError" ? CORS_HINT : cause instanceof Error ? cause.message : "녹화를 시작하지 못했어요.";
      fail(message);
    }
  }

  function stopRecording(ctx: CanvasRenderingContext2D, width: number, height: number, endMs: number) {
    if (finishing || !recorder) return;
    finishing = true;
    cancelAnimationFrame(raf);
    const last = frameAt(source, Math.max(0, endMs - 1));
    sync(last, false);
    draw(ctx, width, height, last);
    // 마지막 화면이 담기도록 잠깐 두었다가 멈춘다.
    stopTimer = window.setTimeout(() => { if (recorder && recorder.state !== "inactive") recorder.stop(); }, 1000 / FPS);
  }

  function triggerDownload() {
    if (!downloadUrl) return;
    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.download = savedName;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }

  function cancelRecording() {
    cleanup();
    phase = "setup";
    warning = "";
    elapsedMs = 0;
  }
</script>

<Dialog.Root open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
  <Dialog.Content class="max-h-[90dvh] overflow-y-auto sm:max-w-lg" showCloseButton={!busy} interactOutsideBehavior={busy ? "ignore" : "close"} escapeKeydownBehavior={busy ? "ignore" : "close"}>
    <Dialog.Header>
      <Dialog.Title>연습 영상 MP4로 저장</Dialog.Title>
      <Dialog.Description>선택한 길이만큼 실시간으로 녹화해요. 녹화하는 동안 이 탭을 앞에 둬 주세요.</Dialog.Description>
    </Dialog.Header>

    {#if phase === "setup"}
      <div class="space-y-4 text-sm">
        <fieldset class="space-y-2">
          <legend class="font-semibold">범위</legend>
          <div class="grid grid-cols-2 gap-2">
            {#each SCOPES as item (item.id)}
              <label class={["flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3", scope === item.id && "border-primary bg-primary/10"]}><input type="radio" name="export-scope" value={item.id} bind:group={scope} />{item.label}</label>
            {/each}
          </div>
          {#if scope === "CUSTOM"}
            <div class="grid grid-cols-2 gap-2">
              <label class="grid gap-1 text-xs font-medium">시작<input class="bg-background min-h-11 rounded-lg border px-3 text-sm" type="text" inputmode="decimal" placeholder="예: 1:30" bind:value={startInput} /></label>
              <label class="grid gap-1 text-xs font-medium">끝<input class="bg-background min-h-11 rounded-lg border px-3 text-sm" type="text" inputmode="decimal" placeholder="예: 3:00" bind:value={endInput} /></label>
            </div>
          {/if}
          {#if range}
            <p class="text-muted-foreground text-xs">{range.label} · {formatTime(range.startMs)} ~ {formatTime(range.endMs)}</p>
          {:else if "error" in resolved}
            <p role="alert" class="text-destructive text-xs">{resolved.error}</p>
          {/if}
        </fieldset>
        <label class="grid gap-1 font-semibold">화면 크기
          <select class="bg-background min-h-11 rounded-lg border px-3 font-normal" bind:value={resolution}>
            <option value="720">{RESOLUTIONS["720"].label} (기본)</option>
            <option value="1080">{RESOLUTIONS["1080"].label}</option>
          </select>
        </label>
        <label class="flex min-h-11 items-center gap-2"><input type="checkbox" bind:checked={withCaptions} />자막(화자·대사) 넣기</label>
        {#if estimate}
          <p class="bg-muted/40 rounded-lg p-3 text-xs leading-relaxed">예상 소요 시간 약 <strong>{duration(estimate.seconds)}</strong> · 파일 크기 약 {size(estimate.bytes)}. 소리는 장면 음악과 영상 속 소리가 함께 담겨요.{#if estimate.bytes > 1.5e9} 파일이 커서 기기 메모리가 부족할 수 있으니 구간을 나눠 저장하는 것을 권해요.{/if}</p>
        {/if}
        {#if !mime}
          <p role="alert" class="text-destructive text-xs">이 브라우저는 영상 녹화를 지원하지 않아요. Chrome·Edge 최신 버전이나 Safari에서 열어 주세요.</p>
        {:else if mime.fallback}
          <p class="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs">{WEBM_FALLBACK_NOTICE}</p>
        {/if}
        {#if error}<p role="alert" class="text-destructive text-sm">{error}</p>{/if}
      </div>
      <Dialog.Footer class="gap-2">
        <Button variant="ghost" class="min-h-10" onclick={onClose}>닫기</Button>
        <Button class="min-h-10" disabled={!range || !mime} onclick={start}>녹화 시작</Button>
      </Dialog.Footer>
    {:else if busy}
      <div class="space-y-3 text-sm" role="status">
        {#if phase === "preparing"}
          <p>자료를 준비하고 있어요…</p>
        {:else if range}
          {@const total = range.endMs - range.startMs}
          <p class="font-semibold">녹화 중 · {formatTime(elapsedMs)} / {formatTime(total)}</p>
          <div class="bg-muted h-2 overflow-hidden rounded-full"><div class="bg-primary h-full transition-[width]" style:width={`${Math.min(100, (elapsedMs / total) * 100)}%`}></div></div>
          <p class="text-muted-foreground text-xs">녹화가 끝날 때까지 이 탭을 앞에 둬 주세요.</p>
        {/if}
        {#if warning}<p role="alert" class="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs">{warning}</p>{/if}
      </div>
      <Dialog.Footer class="gap-2">
        <Button variant="outline" class="min-h-10" onclick={cancelRecording}>녹화 취소</Button>
      </Dialog.Footer>
    {:else}
      <div class="space-y-3 text-sm" role="status">
        <p class="font-semibold">{savedName} 파일을 저장했어요.</p>
        {#if savedFallback}<p class="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs">{WEBM_FALLBACK_NOTICE}</p>{/if}
      </div>
      <Dialog.Footer class="gap-2">
        <Button variant="outline" class="min-h-10" onclick={triggerDownload}>다시 내려받기</Button>
        <Button class="min-h-10" onclick={onClose}>닫기</Button>
      </Dialog.Footer>
    {/if}
  </Dialog.Content>
</Dialog.Root>
