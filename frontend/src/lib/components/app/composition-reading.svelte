<script lang="ts">
  import { onMount } from "svelte";
  import { apiRequest } from "$lib/api/client";
  import { Button } from "$lib/components/ui/button";
  import { syncMedia } from "$lib/actions/sync-media";
  import {
    activeSection,
    assetName,
    formatTime,
    mediaAt,
    sourceTimeSeconds,
    SLOT_LABELS,
    type CompositionSection,
    type ResolvedMedia
  } from "$lib/domain/composition";

  let { pid, sections, durationMs, selectedId }: { pid: string; sections: CompositionSection[]; durationMs: number; selectedId: string } =
    $props();

  let timeMs = $state(0);
  let playing = $state(false);
  let onlySelected = $state(false);
  let sound = $state(false);
  let mediaError = $state("");

  const selected = $derived(sections.find((s) => s.id === selectedId));
  const rangeStart = $derived(onlySelected && selected ? selected.timing.startMs : 0);
  const rangeEnd = $derived(onlySelected && selected ? selected.timing.startMs + selected.timing.durationMs : durationMs);
  const current = $derived(activeSection(sections, Math.min(timeMs, Math.max(rangeStart, rangeEnd - 1))));
  const parent = $derived(sections.find((s) => s.id === current?.parentId));

  const backgroundClip = $derived(mediaAt(sections, current, "BACKGROUND", timeMs));
  const musicClip = $derived(mediaAt(sections, current, "MUSIC", timeMs));
  const scoreClip = $derived(mediaAt(sections, current, "SCORE", timeMs));

  const IMAGE_MIME = ["image/png", "image/jpeg", "image/webp"];
  const VIDEO_MIME = ["video/mp4", "video/webm", "video/quicktime"];

  type Signed = { url: string; expiresAt?: string };
  let signed = $state<Record<string, Signed>>({});
  const signing = new Map<string, Promise<void>>();

  async function ensureSigned(assetId: string) {
    const existing = signed[assetId];
    if (existing && (!existing.expiresAt || Date.parse(existing.expiresAt) > Date.now() + 30_000)) return;
    if (signing.has(assetId)) return signing.get(assetId);
    const promise = apiRequest<Signed>(`/assets/${assetId}/url`)
      .then((result) => {
        signed = { ...signed, [assetId]: result };
      })
      .catch((cause) => {
        mediaError = cause instanceof Error ? cause.message : "미디어 주소를 불러오지 못했습니다";
      })
      .finally(() => signing.delete(assetId));
    signing.set(assetId, promise);
    await promise;
  }

  $effect(() => {
    const ids = [backgroundClip?.media.assetId, musicClip?.media.assetId, scoreClip?.media.assetId].filter(
      (id): id is string => Boolean(id)
    );
    for (const id of ids) void ensureSigned(id);
  });

  function onMediaError(message: string) {
    playing = false;
    mediaError = message;
  }

  function clipTime(clip: ResolvedMedia) {
    // 실제 파일 길이는 로드돼야 알 수 있어 무한대로 두고, syncMedia가 엘리먼트 자체 길이로 다시 잘라낸다.
    return sourceTimeSeconds(clip, timeMs, Infinity);
  }

  function start(selectedOnly: boolean) {
    onlySelected = selectedOnly;
    timeMs = selectedOnly && selected ? selected.timing.startMs : 0;
    playing = rangeEnd > timeMs;
    mediaError = "";
  }
  onMount(() => {
    let frame = 0;
    let last = performance.now();
    function tick(now: number) {
      const elapsed = now - last;
      last = now;
      if (playing) {
        timeMs = Math.min(rangeEnd, timeMs + elapsed);
        if (timeMs >= rangeEnd) playing = false;
      }
      frame = requestAnimationFrame(tick);
    }
    const hide = () => {
      if (document.hidden) playing = false;
    };
    document.addEventListener("visibilitychange", hide);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", hide);
    };
  });
</script>

<section class="space-y-4" aria-label="대본 흐름 미리보기">
  <div>
    <h2 class="text-lg font-semibold">대본 흐름 미리보기</h2>
    <p class="text-muted-foreground mt-1 text-sm leading-relaxed">
      저장된 구간 시간에 맞춰 배경 영상·음악·악보를 실제로 재생합니다. 서명 URL 발급 직후이거나 파일이 없는 구간은 화면이 비어 있을 수 있어요.
    </p>
  </div>
  <div class="bg-muted/20 rounded-xl border p-4">
    <div class="flex flex-wrap items-center gap-2">
      <Button disabled={!durationMs} onclick={() => start(false)}>전체 흐름 재생</Button>
      <Button variant="outline" disabled={!selected} onclick={() => start(true)}>선택 구간만</Button>
      <Button
        variant="outline"
        disabled={!durationMs}
        onclick={() => {
          if (timeMs >= rangeEnd) timeMs = rangeStart;
          playing = !playing;
          mediaError = "";
        }}
      >
        {playing ? "일시정지" : "이어서"}
      </Button>
      <Button
        variant="ghost"
        onclick={() => {
          playing = false;
          timeMs = rangeStart;
        }}
      >
        처음으로
      </Button>
      <label class="ms-auto flex items-center gap-1.5 text-xs"><input type="checkbox" bind:checked={sound} />소리</label>
    </div>
    <label class="mt-4 grid gap-2 text-xs">
      <span class="flex justify-between">
        <span>{onlySelected ? "선택 구간" : "전체 공연"} · {playing ? "진행 중" : "정지"}</span>
        <span class="font-mono tabular-nums">{formatTime(timeMs)} / {formatTime(rangeEnd)}</span>
      </span>
      <input
        type="range"
        min={rangeStart}
        max={Math.max(rangeStart + 1, rangeEnd)}
        step={100}
        value={timeMs}
        oninput={(e) => {
          playing = false;
          timeMs = Number(e.currentTarget.value);
        }}
        aria-label="대본 미리보기 위치"
        class="accent-primary w-full"
      />
    </label>
  </div>

  {#if mediaError}
    <p role="alert" class="border-destructive/40 bg-destructive/5 text-destructive rounded-xl border p-3 text-sm">{mediaError}</p>
  {/if}

  <!-- 무대 화면: 배경 영상·이미지 위에 가사를 자막처럼 겹친다 -->
  <div class="relative flex aspect-video w-full items-end overflow-hidden rounded-2xl bg-black p-4 text-white sm:p-6">
    {#if backgroundClip && signed[backgroundClip.media.assetId]}
      {#key `${backgroundClip.media.id}:${signed[backgroundClip.media.assetId].url}`}
        {#if IMAGE_MIME.includes(backgroundClip.media.asset.mime)}
          <img src={signed[backgroundClip.media.assetId].url} alt="배경" class="absolute inset-0 h-full w-full object-contain" />
        {:else if VIDEO_MIME.includes(backgroundClip.media.asset.mime)}
          <video
            src={signed[backgroundClip.media.assetId].url}
            playsinline
            preload="auto"
            class="absolute inset-0 h-full w-full object-contain"
            use:syncMedia={{ time: clipTime(backgroundClip), play: playing, rate: 1, muted: !sound, onError: onMediaError }}
            ><track kind="captions" /></video
          >
        {/if}
      {/key}
    {/if}
    {#if current?.lyrics}
      <p class="relative z-10 w-full rounded-xl bg-black/85 px-3 py-2 text-center text-base leading-relaxed whitespace-pre-wrap sm:text-xl">
        {current.lyrics}
      </p>
    {/if}
  </div>
  {#if musicClip && signed[musicClip.media.assetId]}
    {#key musicClip.media.id}
      <audio
        src={signed[musicClip.media.assetId].url}
        preload="auto"
        use:syncMedia={{ time: clipTime(musicClip), play: playing, rate: 1, muted: !sound, onError: onMediaError }}
      ></audio>
    {/key}
  {/if}

  {#if current}
    <div class="rounded-xl border p-4 sm:p-6">
      <p class="text-muted-foreground text-xs">{parent ? `${parent.title} / ` : ""}현재 구간</p>
      <h3 class="mt-1 text-xl font-semibold">{current.title}</h3>
      <div class="mt-5 grid gap-6">
        {#if parent?.scriptText}
          <details class="bg-muted/30 rounded-lg p-3">
            <summary class="cursor-pointer text-sm font-medium">상위 장·막의 대본</summary>
            <p class="mt-3 text-sm leading-7 whitespace-pre-wrap break-words">{parent.scriptText}</p>
          </details>
        {/if}
        <div>
          <h4 class="text-muted-foreground text-sm font-semibold">대본 · 대사 · 지문</h4>
          <p class="mt-3 text-base leading-8 whitespace-pre-wrap break-words">
            {current.scriptText || "입력된 대본이 없습니다. 악보만 사용하는 구간일 수 있습니다."}
          </p>
        </div>
      </div>
    </div>

    <!-- 악보: 이미지는 그대로, PDF는 지정한 쪽으로 보여준다 -->
    <div class="rounded-xl border p-3 sm:p-4">
      <p class="text-muted-foreground text-xs">{SLOT_LABELS.SCORE}</p>
      {#if scoreClip && signed[scoreClip.media.assetId]}
        {#key scoreClip.media.id}
          {#if IMAGE_MIME.includes(scoreClip.media.asset.mime)}
            <img
              src={signed[scoreClip.media.assetId].url}
              alt="악보 {scoreClip.media.page}쪽"
              class="mt-2 max-h-[70vh] w-full rounded-lg border object-contain"
            />
          {:else}
            <iframe
              title="악보 PDF"
              src={`${signed[scoreClip.media.assetId].url}#page=${scoreClip.media.page}`}
              class="mt-2 h-[70vh] w-full rounded-lg border"
            ></iframe>
          {/if}
        {/key}
        <p class="text-muted-foreground mt-1 text-xs">{assetName(scoreClip.media.asset)} · {scoreClip.media.page}쪽</p>
      {:else}
        <p class="text-muted-foreground mt-2 text-sm">현재 시점에 지정된 악보가 없습니다.</p>
      {/if}
    </div>
  {:else}
    <p class="text-muted-foreground rounded-xl border border-dashed px-4 py-12 text-center text-sm">
      {sections.length ? "현재는 구간 사이의 대기 시간입니다." : "구간을 등록하면 대본 흐름을 확인할 수 있습니다."}
    </p>
  {/if}
</section>
