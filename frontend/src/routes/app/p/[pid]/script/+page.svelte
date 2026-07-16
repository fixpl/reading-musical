<script lang="ts">
    import { page } from "$app/stores";
  import { toast } from "svelte-sonner";
  import { Badge } from "$lib/components/ui/badge";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import { apiRequest } from "$lib/api/client";

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

  const pid = $derived($page.params.pid ?? "");

  let scripts = $state<ScriptSummary[]>([]);
  let script = $state<ScriptDetail | null>(null);
  let loading = $state(true);

  // 인물별 색 — 대본 앱처럼 화자를 색으로 구분한다.
  const CHARACTER_COLORS = ["#7c3aed", "#2563eb", "#0d9488", "#db2777", "#d97706", "#65a30d", "#dc2626", "#0891b2"];
  const characterColor = $derived.by(() => {
    const map = new Map<string, string>();
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

  async function loadPage() {
    try {
      const list = await apiRequest<ScriptSummary[]>(`/productions/${pid}/scripts`);
      scripts = list;
      if (list.length > 0) {
        await open(list[list.length - 1].id);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "대본을 불러오지 못했습니다");
    } finally {
      loading = false;
    }
  }

  // pid가 바뀌어도(같은 라우트에서 공연 전환·딥링크) 다시 불러온다 — onMount는 재실행되지 않음.
  $effect(() => {
    void pid;
    void loadPage();
  });

  async function open(scriptId: string) {
    loading = true;
    try {
      script = await apiRequest<ScriptDetail>(`/productions/${pid}/scripts/${scriptId}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "대본을 불러오지 못했습니다");
    } finally {
      loading = false;
    }
  }

  function jump(sceneId: string) {
    document.getElementById(`scene-${sceneId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
</script>

<svelte:head>
  <title>대본 — 아트브릿지</title>
</svelte:head>

<div class="mx-auto w-full max-w-5xl">
  <div class="flex flex-wrap items-center gap-2 py-2">
    <div>
      <h1 class="text-xl font-bold tracking-tight">대본</h1>
      {#if script}
        <p class="text-muted-foreground text-sm">{script.title}</p>
      {/if}
    </div>
    {#if scripts.length > 1}
      <div class="bg-muted ms-auto flex flex-wrap rounded-lg p-0.5">
        {#each scripts as item (item.id)}
          <button
            type="button"
            class="max-w-44 truncate rounded-md px-2.5 py-1 text-xs font-medium transition-colors {script?.id === item.id
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

  {#if loading}
    <div class="mt-4 space-y-2">
      {#each Array(6) as _, i (i)}
        <Skeleton class="h-14 w-full rounded-2xl" />
      {/each}
    </div>
  {:else if !script || script.acts.length === 0}
    <div class="bg-card mt-4 rounded-2xl px-6 py-14 text-center">
      <p class="font-semibold">등록된 대본이 없습니다</p>
      <p class="text-muted-foreground mt-1 text-sm">
        큐시트의 "AI 초안"으로 대본을 올리면 장면 구조가 함께 만들어집니다.
      </p>
    </div>
  {:else}
    <div class="mt-2 grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
      <!-- 장면 목록 -->
      <nav class="bg-card sticky top-4 hidden max-h-[calc(100dvh-8rem)] flex-col self-start overflow-y-auto rounded-xl border p-1.5 lg:flex">
        {#each script.acts as act (act.id)}
          <p class="text-muted-foreground/70 px-2 pt-2 pb-0.5 text-[11px] font-bold">{act.title}</p>
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
      <div class="grid gap-6">
        {#each script.acts as act (act.id)}
          <section>
            <h2 class="text-primary text-xs font-bold tracking-[0.14em] uppercase">{act.title}</h2>
            <div class="mt-2 grid gap-4">
              {#each act.scenes as scene (scene.id)}
                <article id={`scene-${scene.id}`} class="bg-card scroll-mt-4 rounded-2xl p-5 sm:p-6">
                  <header class="border-border/60 border-b pb-3">
                    <h3 class="text-lg font-bold tracking-tight">{scene.title}</h3>
                    {#if scene.summary}
                      <p class="text-muted-foreground mt-0.5 text-sm">{scene.summary}</p>
                    {/if}
                  </header>
                  {#if scene.blocks.length === 0}
                    <p class="text-muted-foreground/60 pt-4 text-sm">이 장면에는 아직 내용이 없습니다.</p>
                  {:else}
                    <div class="grid gap-3 pt-4">
                      {#each scene.blocks as block (block.id)}
                        <div class="group">
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
                                class="pt-px text-sm font-bold"
                                style={block.character ? `color:${characterColor.get(block.character.id)};` : ""}
                              >
                                {block.character?.name ?? "—"}
                              </span>
                              <p class="m-0 text-[15px] leading-relaxed whitespace-pre-wrap">{block.text}</p>
                            </div>
                          {:else if block.type === "LYRIC"}
                            <div class="grid gap-0.5 sm:grid-cols-[92px_minmax(0,1fr)] sm:gap-3">
                              <span
                                class="pt-px text-sm font-bold"
                                style={block.character ? `color:${characterColor.get(block.character.id)};` : ""}
                              >
                                {block.character ? `♪ ${block.character.name}` : "♪"}
                              </span>
                              <p class="text-foreground/85 m-0 text-[15px] leading-relaxed whitespace-pre-wrap italic">
                                {block.text}
                              </p>
                            </div>
                          {:else if block.type === "STAGE_DIRECTION"}
                            <p class="text-muted-foreground border-border m-0 border-s-2 ps-3 text-sm whitespace-pre-wrap italic">
                              {block.text}
                            </p>
                          {:else}
                            <p class="text-muted-foreground bg-muted/50 m-0 rounded-lg px-3 py-2 text-xs whitespace-pre-wrap">
                              {block.text}
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
