<script lang="ts">
  import { page } from "$app/stores";
  import { tick } from "svelte";
  import { Badge } from "$lib/components/ui/badge";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import { apiRequest } from "$lib/api/client";
  import { Button } from "$lib/components/ui/button";
  import { formatTime, sectionOrder, type CompositionBoard } from "$lib/domain/composition";

  type Block = {
    id: string;
    order: number;
    type: "DIALOGUE" | "LYRIC" | "STAGE_DIRECTION" | "NOTE";
    text: string;
    cueLabel: string | null;
    character: { id: string; name: string } | null;
    musicCues: Array<{ id: string; cueNumber: string; cueType: string }>;
  };

  type Scene = { id: string; order: number; title: string; summary: string | null; blocks: Block[] };
  type Act = { id: string; order: number; title: string; scenes: Scene[] };
  type ScriptDetail = { id: string; title: string; acts: Act[] };
  type ScriptSummary = { id: string; title: string; createdAt: string };
  type ReadingViewer = { characters?: Array<{ id: string; name: string }>; viewer: { myCharacterIds: string[] } };

  const pid = $derived($page.params.pid ?? "");

  let scripts = $state<ScriptSummary[]>([]);
  let script = $state<ScriptDetail | null>(null);
  let loading = $state(true);
  let composition = $state<CompositionBoard | null>(null);
  let showComposition = $state(true);
  let loadError = $state("");
  let requestVersion = 0;
  let reloadKey = $state(0);
  let failedScriptId = $state<string | null>(null);
  let searchQuery = $state("");
  let onlyMine = $state(false);
  const query = $derived(searchQuery.trim().toLocaleLowerCase());

  // 인물별 색 — 대본 앱처럼 화자를 색으로 구분한다.
  const CHARACTER_COLORS = [
    ["#6d28d9", "#c4b5fd"], ["#1d4ed8", "#93c5fd"], ["#0f766e", "#5eead4"], ["#be185d", "#f9a8d4"],
    ["#92400e", "#fcd34d"], ["#3f6212", "#bef264"], ["#b91c1c", "#fca5a5"], ["#155e75", "#67e8f9"]
  ];
  const characterColor = $derived.by(() => {
    const map = new Map<string, string[]>();
    if (!script) return map;
    for (const act of script.acts) {
      for (const scene of act.scenes) {
        for (const block of scene.blocks) {
          if (block.character && !map.has(block.character.id)) {
            map.set(block.character.id, CHARACTER_COLORS[map.size % CHARACTER_COLORS.length]);
          }
        }
      }
    }
    return map;
  });

  async function loadPage(productionId: string, signal: AbortSignal, version: number) {
    const active = () => !signal.aborted && productionId === pid && version === requestVersion;
    try {
      const [list, board, viewer] = await Promise.all([
        apiRequest<ScriptSummary[]>(`/productions/${productionId}/scripts`, { signal }),
        apiRequest<CompositionBoard>(`/productions/${productionId}/composition`, { signal }).catch((cause: unknown) => {
          if (active()) loadError = cause instanceof Error ? cause.message : "장·막 구성을 읽지 못했어요.";
          return null;
        }),
        apiRequest<ReadingViewer>(`/productions/${productionId}/cue-sheet`, { signal }).catch(() => null)
      ]);
      if (!active()) return;
      scripts = list;
      composition = board;
      selectInitialRole(viewer);
      showComposition = Boolean(board?.sections.length);
      if (!showComposition && list.length > 0) {
        await open(list[list.length - 1].id);
      }
    } catch (error) {
      if (active()) loadError = error instanceof Error ? error.message : "대본을 불러오지 못했어요.";
    } finally {
      // 첫 대본 열기가 시작되면 이후 상태는 그 선택 요청이 책임져요.
      if (active()) loading = false;
    }
  }

  // pid가 바뀌어도(같은 라우트에서 공연 전환·딥링크) 다시 불러온다 — onMount는 재실행되지 않음.
  $effect(() => {
    const productionId = pid, controller = new AbortController();
    reloadKey;
    const version = ++requestVersion;
    loading = true; script = null; scripts = []; composition = null; loadError = ""; failedScriptId = null;
    restoreReadingPreferences(productionId);
    void loadPage(productionId, controller.signal, version);
    return () => controller.abort();
  });

  async function open(scriptId: string) {
    const productionId = pid, version = ++requestVersion;
    showComposition = false;
    loading = true;
    script = null;
    loadError = "";
    failedScriptId = null;
    try {
      const result = await apiRequest<ScriptDetail>(`/productions/${productionId}/scripts/${scriptId}`);
      if (version === requestVersion && productionId === pid) script = result;
    } catch (error) {
      if (version === requestVersion && productionId === pid) {
        loadError = error instanceof Error ? error.message : "대본을 불러오지 못했어요.";
        failedScriptId = scriptId;
      }
    } finally {
      if (version === requestVersion && productionId === pid) loading = false;
    }
  }

  // 제작진용 메모(※) 표시 여부.
  let showNotes = $state(true);
  const readingSections = $derived(composition ? sectionOrder(composition.sections) : []);
  // "화자: 대사" / "[ 지문 ]" 형식의 구간 텍스트를 읽기 좋게 나눈다.
  function readLines(text: string) {
    return text.split(/\r?\n/).map((raw) => raw.trim()).filter(Boolean).map((raw) => {
      const note = raw.match(/^※\s*(.*)$/);
      if (note) return { kind: "note" as const, speaker: null, text: note[1] };
      const direction = raw.match(/^[\[(（【]\s*(.*?)\s*[\])）】]$/);
      if (direction) return { kind: "direction" as const, speaker: null, text: direction[1] };
      const spoken = raw.match(/^([^:：\n]{1,40}?)\s*[:：]\s*(.*)$/);
      return spoken ? { kind: "line" as const, speaker: spoken[1], text: spoken[2] } : { kind: "line" as const, speaker: null, text: raw };
    });
  }
  function colorStyle(colors: string[] | undefined) {
    return colors ? `--speaker-light:${colors[0]};--speaker-dark:${colors[1]}` : "";
  }
  function speakerColor(name: string) {
    let hash = 0;
    for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return colorStyle(CHARACTER_COLORS[hash % CHARACTER_COLORS.length]);
  }
  // 글자 크기와 "내 대사 강조" — 읽는 사람마다 편한 설정을 이 기기에 기억해 둔다.
  const SIZES = [0.95, 1.1, 1.3, 1.55];
  let sizeIndex = $state(1);
  let mine = $state("");
  let looseLines = $state(true);
  let minePreferenceSaved = false;
  function restoreReadingPreferences(productionId: string) {
    sizeIndex = 1; mine = ""; looseLines = true; minePreferenceSaved = false;
    try {
      const savedSize = localStorage.getItem("artbridge-read-size");
      const parsedSize = savedSize === null || !savedSize.trim() ? null : Number(savedSize);
      if (parsedSize !== null && Number.isInteger(parsedSize) && parsedSize >= 0 && parsedSize < SIZES.length) sizeIndex = parsedSize;
      const savedMine = localStorage.getItem(`artbridge-read-mine-${productionId}`);
      mine = savedMine ?? "";
      minePreferenceSaved = savedMine !== null;
      looseLines = localStorage.getItem("artbridge-read-spacing") !== "compact";
    } catch { /* 저장소를 못 쓰면 기본값을 쓴다 */ }
  }
  function selectInitialRole(viewer: ReadingViewer | null) {
    if (minePreferenceSaved || !viewer) return;
    mine = viewer.characters?.find((character) => viewer.viewer.myCharacterIds.includes(character.id))?.name ?? "";
  }
  function remember(size: number, role: string) {
    minePreferenceSaved = true;
    try { localStorage.setItem("artbridge-read-size", String(size)); localStorage.setItem(`artbridge-read-mine-${pid}`, role); localStorage.setItem("artbridge-read-spacing", looseLines ? "loose" : "compact"); } catch { /* 무시 */ }
  }
  const speakers = $derived.by(() => {
    const names = new Map<string, number>();
    if (showComposition) {
      for (const section of readingSections) for (const line of [...readLines(section.scriptText), ...readLines(section.lyrics)]) if (line.speaker) names.set(line.speaker, (names.get(line.speaker) ?? 0) + 1);
    } else if (script) {
      for (const act of script.acts) for (const scene of act.scenes) for (const block of scene.blocks) if (block.character) names.set(block.character.name, (names.get(block.character.name) ?? 0) + 1);
    }
    return [...names].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  });
  const isMine = (speaker: string | null) => Boolean(mine) && Boolean(speaker) && (speaker === mine || speaker!.split(/[·,]/).map((part) => part.trim()).includes(mine));
  const mineCharacterIds = $derived(new Set(script?.acts.flatMap((act) => act.scenes.flatMap((scene) => scene.blocks.filter((block) => block.character && isMine(block.character.name)).map((block) => block.character!.id))) ?? []));
  const isMyBlock = (block: Block) => Boolean(block.character && mineCharacterIds.has(block.character.id));
  const matchesSearch = (speaker: string | null, text: string) => !query || `${speaker ?? ""} ${text}`.toLocaleLowerCase().includes(query);
  function visibleLines(text: string) {
    return readLines(text).filter((line) => (showNotes || line.kind !== "note") && (!onlyMine || isMine(line.speaker)) && matchesSearch(line.speaker, line.text));
  }
  const filteredSections = $derived(readingSections.filter((section) => (!query && !onlyMine) || visibleLines(section.scriptText).length || visibleLines(section.lyrics).length));
  const filteredActs = $derived(script?.acts.map((act) => ({ ...act, scenes: act.scenes.map((scene) => ({ ...scene, blocks: scene.blocks.filter((block) => (showNotes || block.type !== "NOTE") && (!onlyMine || isMyBlock(block)) && matchesSearch(block.character?.name ?? null, block.text)) })).filter((scene) => (!query && !onlyMine) || scene.blocks.length) })).filter((act) => act.scenes.length) ?? []);
  const noMatches = $derived(Boolean(query || onlyMine) && (showComposition ? filteredSections.length === 0 : filteredActs.length === 0));
  function highlightParts(text: string) {
    if (!query) return [{ text, match: false }];
    const parts: Array<{ text: string; match: boolean }> = [];
    const lower = text.toLocaleLowerCase();
    let from = 0, index = lower.indexOf(query);
    while (index !== -1) {
      if (index > from) parts.push({ text: text.slice(from, index), match: false });
      parts.push({ text: text.slice(index, index + query.length), match: true });
      from = index + query.length;
      index = lower.indexOf(query, from);
    }
    if (from < text.length) parts.push({ text: text.slice(from), match: false });
    return parts;
  }
  // 대본 데이터가 그려진 뒤 큐시트의 장면 링크를 최신 구성의 구간으로 연결한다.
  $effect(() => {
    const hash = $page.url.hash;
    if (loading || !hash) return;
    let target = hash.slice(1);
    try { target = decodeURIComponent(target); } catch { /* 잘못된 해시는 원문으로 찾는다 */ }
    if (showComposition && target.startsWith("scene-")) {
      const section = composition?.sections.find((item) => item.sourceSceneId === target.slice(6));
      if (section) target = `section-${section.id}`;
    }
    const version = requestVersion;
    void tick().then(() => { if (version === requestVersion) document.getElementById(target)?.scrollIntoView({ block: "start" }); });
  });
  function jump(sceneId: string) {
    document.getElementById(`scene-${sceneId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
</script>

<svelte:head>
  <title>대본 읽기 — 아트브릿지</title>
</svelte:head>

{#snippet highlighted(text: string)}
  {#each highlightParts(text) as part, index (index)}{#if part.match}<mark class="rounded-sm bg-yellow-200 text-neutral-950 dark:bg-yellow-300">{part.text}</mark>{:else}{part.text}{/if}{/each}
{/snippet}

<div class="reader-shell mx-auto w-full max-w-5xl" style={`--read-leading:${looseLines ? 1.9 : 1.6}`}>
  <div class="flex flex-wrap items-center gap-2 py-2">
    <div>
      <h1 class="text-xl font-bold tracking-tight">대본 읽기</h1>
      {#if showComposition && composition}
        <p class="text-muted-foreground text-sm">{composition.production.title} · 최신 장·막 대본</p>
      {:else if script}
        <p class="text-muted-foreground text-sm">{script.title}</p>
      {/if}
    </div>
    <Button href={`/app/p/${pid}/live`} class="reader-controls ms-auto min-h-11">연습하기</Button>
    {#if scripts.length > 1 || composition?.sections.length}
      <div class="reader-tabs bg-muted flex w-full flex-nowrap overflow-x-auto rounded-lg p-0.5">
        {#if composition?.sections.length}<Button size="sm" variant={showComposition ? "default" : "ghost"} onclick={() => { requestVersion += 1; showComposition = true; loading = false; loadError = ""; failedScriptId = null; }}>최신 장·막 구성</Button>{/if}
        {#each scripts as item (item.id)}
          <button
            type="button"
            class="max-w-44 truncate rounded-md px-2.5 py-1 text-xs font-medium transition-colors {!showComposition && script?.id === item.id
              ? 'bg-background shadow-sm'
              : 'text-muted-foreground hover:text-foreground'}"
            onclick={() => open(item.id)}
          >
            {item.title}
          </button>
        {/each}
      </div>
    {/if}
  </div>
  {#if loadError}
    <div role="alert" class="reader-controls text-destructive my-3 flex flex-wrap items-center gap-3 rounded-xl border p-3 text-sm">
      <p class="min-w-0 flex-1">{loadError}</p>
      <Button variant="outline" size="sm" disabled={loading} onclick={() => failedScriptId ? open(failedScriptId) : reloadKey += 1}>다시 시도</Button>
    </div>
  {/if}
  {#if !loading && ((showComposition && composition) || script)}
    <div class="reader-controls bg-card mt-3 space-y-3 rounded-2xl border p-3 text-sm">
      <div class="flex items-end gap-2" role="search" aria-label="대본 검색">
        <label class="grid min-w-0 flex-1 gap-1 text-xs font-medium">대사 검색
          <input type="search" class="bg-background text-foreground focus-visible:ring-primary/40 min-h-11 w-full rounded-lg border px-3 text-base outline-none focus-visible:ring-2" placeholder="화자나 대사를 찾아요" bind:value={searchQuery} onkeydown={(event) => { if (event.key === "Escape") searchQuery = ""; }} />
        </label>
        {#if searchQuery}<Button variant="outline" class="min-h-11 shrink-0" onclick={() => searchQuery = ""}>검색 지우기</Button>{/if}
      </div>
      <div class="flex flex-wrap items-end gap-x-4 gap-y-2">
        {#if speakers.length}
          <label class="grid min-w-0 flex-1 gap-1 text-xs font-medium">내 배역
            <select class="bg-background text-foreground min-h-11 w-full rounded-lg border px-3 text-sm" value={mine} onchange={(event) => { mine = event.currentTarget.value; if (!mine) onlyMine = false; remember(sizeIndex, mine); }}>
              <option value="">선택 안 함</option>
              {#each speakers as name (name)}<option value={name}>{name}</option>{/each}
            </select>
          </label>
        {/if}
        <label class="flex min-h-11 shrink-0 items-center gap-2 text-sm"><input class="accent-primary size-4" type="checkbox" bind:checked={onlyMine} disabled={!mine} />내 대사만</label>
      </div>
      <details class="border-t pt-1">
        <summary class="text-muted-foreground min-h-11 cursor-pointer py-3 text-xs font-medium">읽기 설정 · 글자 크기와 줄 간격</summary>
        <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div class="flex items-center gap-2" role="group" aria-label="글자 크기">
            <Button variant="outline" size="sm" class="min-h-11 min-w-11" disabled={sizeIndex === 0} aria-label="글자 작게" onclick={() => { sizeIndex -= 1; remember(sizeIndex, mine); }}>가−</Button>
            <span class="text-muted-foreground min-w-10 text-center text-xs">{Math.round(SIZES[sizeIndex] * 100)}%</span>
            <Button variant="outline" size="sm" class="min-h-11 min-w-11" disabled={sizeIndex === SIZES.length - 1} aria-label="글자 크게" onclick={() => { sizeIndex += 1; remember(sizeIndex, mine); }}>가+</Button>
          </div>
          <label class="flex min-h-11 items-center gap-2 text-sm"><input class="accent-primary size-4" type="checkbox" checked={looseLines} onchange={(event) => { looseLines = event.currentTarget.checked; remember(sizeIndex, mine); }} />줄 간격 넓게</label>
          <label class="flex min-h-11 items-center gap-2 text-sm"><input class="accent-primary size-4" type="checkbox" bind:checked={showNotes} />제작 메모 보기</label>
          <Button variant="outline" class="min-h-11" onclick={() => window.print()}>대본 인쇄</Button>
        </div>
      </details>
    </div>
    {#if noMatches}<p role="status" class="text-muted-foreground py-8 text-center text-sm">조건에 맞는 대사가 없어요.</p>{/if}
  {/if}

  {#if loading}
    <div class="mt-4 space-y-2">
      {#each Array(6) as _, i (i)}
        <Skeleton class="h-14 w-full rounded-2xl" />
      {/each}
    </div>
  {:else if showComposition && composition}
    <!-- 읽기 전용 본문. 영상·시간 미리보기는 연습 화면에서 합쳐서 제공한다. -->
    <p class="reader-controls text-muted-foreground mt-3 text-sm">영상과 시간에 맞춰 보려면 연습 화면을 이용해요.</p>
    <div class="reading-layout mt-3 grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
      <nav class="reader-nav bg-card sticky top-4 hidden max-h-[calc(100dvh-8rem)] flex-col self-start overflow-y-auto rounded-xl border p-1.5 lg:flex" aria-label="구간 목록">
        {#each filteredSections as section (section.id)}
          <button type="button" class={["hover:bg-accent/60 w-full truncate rounded-lg px-2 py-1.5 text-start text-xs transition-colors", !section.parentId && "text-primary pt-2.5 font-bold"]} onclick={() => document.getElementById(`section-${section.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}>{section.title}</button>
        {/each}
      </nav>
      <div class="grid gap-4" style={`--read:${SIZES[sizeIndex]}rem`}>
        {#each filteredSections as section (section.id)}
          {#if !section.parentId && !section.scriptText.trim() && !section.lyrics.trim()}
            <h2 id={`section-${section.id}`} class="text-primary scroll-mt-4 pt-2 text-xs font-bold tracking-[0.14em] uppercase">{section.title}</h2>
          {:else}
            <article id={`section-${section.id}`} class="reader-scene bg-card scroll-mt-4 rounded-2xl border p-5 sm:p-6">
              <header class="flex flex-wrap items-baseline gap-x-3 border-b pb-3">
                <h3 class="text-lg font-bold tracking-tight">{section.title}</h3>
                <span class="text-muted-foreground font-mono text-xs tabular-nums">{formatTime(section.timing.startMs)} · {formatTime(section.timing.durationMs)}</span>
                <a class="reader-link text-primary ms-auto text-sm underline underline-offset-2" href={`/app/p/${pid}/live?section=${section.id}`}>연습에서 보기</a>
              </header>
              <div class="grid gap-2 pt-4">
                {#each visibleLines(section.scriptText) as line, index (index)}
                  {#if line.kind === "note"}
                    {#if showNotes}<p class="m-0 rounded-lg bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:text-amber-200"><span class="me-1.5 font-semibold"><span aria-hidden="true">📝</span> 제작 메모</span>{@render highlighted(line.text)}</p>{/if}
                  {:else if line.kind === "direction"}
                    <p class="text-muted-foreground border-border m-0 border-s-2 ps-3 text-sm italic">{@render highlighted(line.text)}</p>
                  {:else if line.speaker}
                    <p class={["text-[length:var(--read)] leading-[var(--read-leading)]", isMine(line.speaker) && "bg-primary/10 border-primary -mx-3 rounded-lg border-s-4 px-3 py-1.5", mine && !isMine(line.speaker) && "text-muted-foreground"]}><span class="speaker me-2 text-sm font-bold" style={speakerColor(line.speaker)}>{@render highlighted(line.speaker)}</span>{@render highlighted(line.text)}</p>
                  {:else}
                    <p class="text-[length:var(--read)] leading-[var(--read-leading)]">{@render highlighted(line.text)}</p>
                  {/if}
                {/each}
                {#if visibleLines(section.lyrics).length}
                  <div class="bg-muted/40 mt-2 grid gap-1 rounded-xl p-4">
                    <p class="text-muted-foreground text-xs font-semibold">♪ 가사</p>
                    {#each visibleLines(section.lyrics) as line, index (index)}
                      <p class={["text-[length:var(--read)] leading-[var(--read-leading)]", isMine(line.speaker) && "bg-primary/10 border-primary -mx-2 rounded-lg border-s-4 px-2 py-1", mine && !isMine(line.speaker) && "text-muted-foreground"]}>{#if line.speaker}<span class="speaker me-2 text-sm font-bold" style={speakerColor(line.speaker)}>{@render highlighted(line.speaker)}</span>{/if}{@render highlighted(line.text)}</p>
                    {/each}
                  </div>
                {/if}
              </div>
            </article>
          {/if}
        {/each}
      </div>
    </div>
  {:else if loadError && !script}
    <p class="text-muted-foreground py-8 text-center text-sm">대본을 다시 불러와 주세요.</p>
  {:else if !script || script.acts.length === 0}
    <div class="bg-card mt-4 rounded-2xl px-6 py-14 text-center">
      <p class="font-semibold">등록된 대본이 없어요</p>
      <p class="text-muted-foreground mt-1 text-sm">
        장·막 구성에서 대본을 입력하거나 큐시트에서 기존 대본을 등록하면 확인할 수 있어요.
      </p>
    </div>
  {:else}
    <label class="reader-controls mt-3 grid gap-1 text-sm lg:hidden">장면으로 이동<select class="bg-background min-h-11 w-full rounded-lg border px-3" value="" onchange={(event) => { if (event.currentTarget.value) jump(event.currentTarget.value); }}><option value="" disabled>장면 선택</option>{#each filteredActs as act (act.id)}{#each act.scenes as scene (scene.id)}<option value={scene.id}>{act.title} · {scene.title}</option>{/each}{/each}</select></label>
    <div class="reading-layout mt-2 grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
      <!-- 장면 목록 -->
      <nav class="reader-nav bg-card sticky top-4 hidden max-h-[calc(100dvh-8rem)] flex-col self-start overflow-y-auto rounded-xl border p-1.5 lg:flex" aria-label="장면 목록">
        {#each filteredActs as act (act.id)}
          <p class="text-muted-foreground px-2 pt-2 pb-0.5 text-[11px] font-bold">{act.title}</p>
          {#each act.scenes as scene (scene.id)}
            <button
              type="button"
              class="hover:bg-accent/60 w-full truncate rounded-lg px-2 py-1.5 text-start text-xs transition-colors"
              onclick={() => jump(scene.id)}
            >
              {scene.title}
            </button>
          {/each}
        {/each}
      </nav>

      <!-- 본문 -->
      <div class="grid gap-6" style={`--read:${SIZES[sizeIndex]}rem`}>
        {#each filteredActs as act (act.id)}
          <section>
            <h2 class="text-primary text-xs font-bold tracking-[0.14em] uppercase">{act.title}</h2>
            <div class="mt-2 grid gap-4">
              {#each act.scenes as scene (scene.id)}
                <article id={`scene-${scene.id}`} class="reader-scene bg-card scroll-mt-4 rounded-2xl p-5 sm:p-6">
                  <header class="border-border/60 border-b pb-3">
                    <h3 class="text-lg font-bold tracking-tight">{scene.title}</h3>
                    {#if scene.summary}
                      <p class="text-muted-foreground mt-0.5 text-sm">{scene.summary}</p>
                    {/if}
                  </header>
                  {#if scene.blocks.length === 0}
                    <p class="text-muted-foreground pt-4 text-sm">이 장면에는 아직 내용이 없어요.</p>
                  {:else}
                    <div class="grid gap-3 pt-4">
                      {#each scene.blocks as block (block.id)}
                        <div class={["group", isMyBlock(block) && "bg-primary/10 border-primary -mx-3 rounded-lg border-s-4 px-3 py-1.5", mine && !isMyBlock(block) && "text-muted-foreground"]}>
                          {#if block.cueLabel || block.musicCues.length > 0}
                            <div class="mb-1 flex flex-wrap items-center gap-1">
                              {#if block.cueLabel}
                                <Badge variant="secondary" class="px-1.5 py-0 font-mono text-[10.5px] font-bold">
                                  {block.cueLabel}
                                </Badge>
                              {/if}
                              {#each block.musicCues as cue (cue.id)}
                                <Badge variant="outline" class="text-primary px-1.5 py-0 font-mono text-[10.5px] font-bold">
                                  ♪ {cue.cueNumber}
                                </Badge>
                              {/each}
                            </div>
                          {/if}
                          {#if block.type === "DIALOGUE"}
                            <div class="grid gap-0.5 sm:grid-cols-[92px_minmax(0,1fr)] sm:gap-3">
                              <span
                                class="speaker pt-px text-sm font-bold"
                                style={block.character ? colorStyle(characterColor.get(block.character.id)) : ""}
                              >
                                {@render highlighted(block.character?.name ?? "—")}
                              </span>
                              <p class="m-0 text-[length:var(--read)] leading-[var(--read-leading)] whitespace-pre-wrap">{@render highlighted(block.text)}</p>
                            </div>
                          {:else if block.type === "LYRIC"}
                            <div class="grid gap-0.5 sm:grid-cols-[92px_minmax(0,1fr)] sm:gap-3">
                              <span
                                class="speaker pt-px text-sm font-bold"
                                style={block.character ? colorStyle(characterColor.get(block.character.id)) : ""}
                              >
                                {@render highlighted(block.character ? `♪ ${block.character.name}` : "♪")}
                              </span>
                              <p class="m-0 text-[length:var(--read)] leading-[var(--read-leading)] whitespace-pre-wrap italic">
                                {@render highlighted(block.text)}
                              </p>
                            </div>
                          {:else if block.type === "STAGE_DIRECTION"}
                            <p class="text-muted-foreground border-border m-0 border-s-2 ps-3 text-sm whitespace-pre-wrap italic">
                              {@render highlighted(block.text)}
                            </p>
                          {:else}
                            <p class="m-0 rounded-lg bg-amber-500/10 px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap text-amber-900 dark:text-amber-200">
                              <span class="me-1.5 font-semibold"><span aria-hidden="true">📝</span> 제작 메모</span>{@render highlighted(block.text)}
                            </p>
                          {/if}
                        </div>
                      {/each}
                    </div>
                  {/if}
                </article>
              {/each}
            </div>
          </section>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .speaker { color: var(--speaker-light); }
  :global(.dark) .speaker { color: var(--speaker-dark); }

  @media print {
    /* 이 읽기 화면이 있는 app shell만 풀어서 사이드바·상단·빠른 메뉴의 인쇄 여백을 없애요. */
    :global(body:has(.reader-shell)) { background: #fff; }
    :global([data-slot="sidebar-wrapper"]:has(.reader-shell)),
    :global([data-slot="sidebar-inset"]:has(.reader-shell)) {
      display: block !important; width: 100% !important; min-height: 0 !important;
      margin: 0 !important; border-radius: 0; box-shadow: none; background: #fff;
    }
    :global([data-slot="sidebar-wrapper"]:has(.reader-shell) > :not([data-slot="sidebar-inset"])),
    :global([data-slot="sidebar-inset"]:has(.reader-shell) > :not(:has(.reader-shell))) { display: none !important; }
    :global([data-slot="sidebar-inset"] > :is(div, main):has(.reader-shell)) { display: block; padding: 0 !important; }
    .reader-controls, .reader-nav, .reader-tabs, .reader-link { display: none !important; }
    .reader-shell { max-width: none; }
    .reading-layout { display: block; }
    .reader-scene { break-after: page; box-shadow: none; border: 0; padding: 0; }
    .reader-scene header { break-after: avoid; }
    .reader-shell :global(*) { background: transparent !important; color: #000 !important; }
  }
</style>
