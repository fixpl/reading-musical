<script lang="ts">
  import { CalendarDays, Users, Layers, Play, Pause, RotateCcw, Check } from "@lucide/svelte";

  type View = "timeline" | "schedule" | "team";
  let view = $state<View>("timeline");
  let position = $state(6);
  let playing = $state(false);
  const duration = 40;
  const views = [
    { id: "timeline" as const, label: "타임라인", icon: Layers },
    { id: "schedule" as const, label: "공동 일정", icon: CalendarDays },
    { id: "team" as const, label: "참여자", icon: Users }
  ];
  const tracks = [
    { name: "대사", color: "bg-emerald-100 text-emerald-950 dark:bg-emerald-950 dark:text-emerald-100", clips: [{ start: 0, end: 12, label: "해설 · 첫 인사" }, { start: 12, end: 27, label: "배우 A · 우리의 이야기" }, { start: 27, end: 40, label: "함께 · 마지막 인사" }] },
    { name: "음향", color: "bg-sky-100 text-sky-950 dark:bg-sky-950 dark:text-sky-100", clips: [{ start: 0, end: 23, label: "BGM · 피아노" }, { start: 27, end: 40, label: "엔딩 음악" }] },
    { name: "조명", color: "bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-100", clips: [{ start: 0, end: 12, label: "따뜻한 빛" }, { start: 12, end: 35, label: "무대 전체" }, { start: 35, end: 40, label: "암전" }] },
    { name: "배경", color: "bg-violet-100 text-violet-950 dark:bg-violet-950 dark:text-violet-100", clips: [{ start: 0, end: 27, label: "이미지 · 작은 연습실" }, { start: 27, end: 40, label: "엔딩 배경" }] }
  ];
  const events = [
    { day: "화", time: "19:00–21:00", title: "1막 대본 리딩", description: "연습실 A · 배우와 연출", status: "참석 응답" },
    { day: "목", time: "18:00–20:00", title: "음악과 동선 맞추기", description: "연습실 B · 배우와 스태프", status: "일정 확인" },
    { day: "토", time: "14:00–17:00", title: "전체 리허설", description: "소극장 · 전체 참여자", status: "큐시트 확인" }
  ];
  const members = [
    { name: "운영자", role: "공연 생성 · 회원 배정", initial: "운", detail: "공연 전체 관리" },
    { name: "배우 A", role: "해설 · 주연", initial: "A", detail: "내 대사 · 개인 연습" },
    { name: "배우 B", role: "조연 · 앙상블", initial: "B", detail: "대본 · 출석 응답" },
    { name: "스태프 A", role: "음향 담당", initial: "S", detail: "담당 트랙 큐 편집" }
  ];
  const subtitle = $derived(position < 12 ? "오늘의 이야기를 함께 시작합니다." : position < 27 ? "서로 다른 목소리가 하나의 장면이 됩니다." : "우리의 다음 장면에서 다시 만나요.");
  const timeLabel = $derived(`00:${Math.floor(position).toString().padStart(2, "0")}`);

  // This public demo never loads a real production, media, or shared session.
  // Playback begins only after a click and stops when leaving the timeline.
  $effect(() => {
    if (!playing || view !== "timeline") return;
    let previous = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      position = Math.min(duration, position + (now - previous) / 1000);
      previous = now;
      if (position >= duration) playing = false;
    }, 100);
    return () => clearInterval(timer);
  });

  function selectView(next: View) {
    playing = false;
    view = next;
  }
</script>

<div class="bg-card overflow-hidden rounded-2xl border shadow-xl shadow-black/5 sm:rounded-3xl">
  <div class="bg-muted/40 flex flex-wrap items-center justify-between gap-3 border-b px-4 py-4 sm:px-6">
    <div class="flex min-w-0 items-center gap-3">
      <div class="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-xl"><Layers size={18} aria-hidden="true" /></div>
      <div><h3 class="text-sm font-semibold">우리의 첫 장면</h3><p class="text-muted-foreground mt-0.5 text-xs">기능을 둘러보는 예시 프로젝트</p></div>
    </div>
    <span class="text-muted-foreground rounded-full border px-2.5 py-1 text-[11px]">예시 데이터</span>
  </div>
  <div class="flex gap-1 overflow-x-auto border-b px-3 py-2 sm:px-5" aria-label="제품 미리보기 화면 선택">
    {#each views as item (item.id)}
      <button type="button" aria-pressed={view === item.id} onclick={() => selectView(item.id)} class={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:text-sm ${view === item.id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
        <item.icon size={15} aria-hidden="true" />{item.label}
      </button>
    {/each}
  </div>
  <div class="p-4 sm:p-6">
    {#if view === "timeline"}
      <div class="relative flex min-h-44 flex-col justify-end overflow-hidden rounded-xl bg-stone-900 px-5 py-6 text-white sm:min-h-52 sm:px-8">
        <div class="pointer-events-none absolute inset-0 opacity-40" aria-hidden="true" style="background: radial-gradient(ellipse at 20% 0%, #c19264, transparent 65%), radial-gradient(ellipse at 85% 0%, #606d79, transparent 60%);"></div>
        <div class="relative"><span class="text-xs text-stone-300">개인 연습 · 대사 표시 예시</span><p class="mt-4 max-w-xl text-balance text-lg font-medium leading-relaxed sm:text-2xl">{subtitle}</p></div>
      </div>
      <div class="my-4 flex flex-wrap items-center gap-3">
        <button type="button" class="bg-primary text-primary-foreground flex min-h-10 items-center gap-2 rounded-lg px-4 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" onclick={() => { if (position >= duration) position = 0; playing = !playing; }} aria-label={playing ? "예시 재생 일시정지" : "예시 타임라인 재생"}>
          {#if playing}<Pause size={14} aria-hidden="true" />일시정지{:else}<Play size={14} aria-hidden="true" />예시 재생{/if}
        </button>
        <button type="button" class="text-muted-foreground hover:bg-muted flex size-10 items-center justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-ring" aria-label="예시 처음으로" onclick={() => { playing = false; position = 0; }}><RotateCcw size={15} aria-hidden="true" /></button>
        <span class="text-muted-foreground ml-auto font-mono text-xs tabular-nums">{timeLabel} / 00:40</span>
      </div>
      <label class="sr-only" for="landing-playhead">예시 타임라인 재생 위치</label>
      <input id="landing-playhead" class="accent-primary mb-4 h-6 w-full cursor-pointer" type="range" min="0" max={duration} step="0.1" bind:value={position} aria-valuetext={`${position.toFixed(1)}초`} />
      <div class="space-y-2" aria-label="대사, 음향, 조명, 배경의 시간 배치 예시">
        <div class="grid grid-cols-[42px_minmax(0,1fr)] gap-2 sm:grid-cols-[58px_minmax(0,1fr)]"><span></span><div class="text-muted-foreground flex justify-between font-mono text-[10px]"><span>00:00</span><span>00:10</span><span>00:20</span><span>00:30</span><span>00:40</span></div></div>
        {#each tracks as track (track.name)}
          <div class="grid grid-cols-[42px_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[58px_minmax(0,1fr)]">
            <span class="text-muted-foreground text-[11px] sm:text-xs">{track.name}</span>
            <div class="bg-muted/50 relative h-10 overflow-hidden rounded-lg">
              {#each track.clips as clip (clip.start)}
                <div class={`absolute inset-y-1 overflow-hidden text-ellipsis whitespace-nowrap rounded-md border border-background px-2 py-2 text-[10px] font-medium sm:text-[11px] ${track.color}`} style:left={`${clip.start / duration * 100}%`} style:width={`${(clip.end - clip.start) / duration * 100}%`} title={`${clip.label} (${clip.start}–${clip.end}초)`}>{clip.label}</div>
              {/each}
              <div class="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-foreground/75" style:left={`${Math.min(99.8, position / duration * 100)}%`} aria-hidden="true"></div>
            </div>
          </div>
        {/each}
      </div>
    {:else if view === "schedule"}
      <div class="mb-5 flex items-center justify-between gap-3"><div><h4 class="font-semibold">이번 주, 함께 맞출 일정</h4><p class="text-muted-foreground mt-1 text-xs">공연 일정과 개인 일정을 한곳에서 확인합니다.</p></div><span class="text-muted-foreground hidden text-xs sm:inline">예시 주간 일정</span></div>
      <div class="mb-5 grid grid-cols-7 gap-1.5 text-center text-xs">
        {#each ["월", "화", "수", "목", "금", "토", "일"] as day (day)}<div class={`rounded-xl border px-1 py-4 ${['화', '목', '토'].includes(day) ? 'border-primary/20 bg-primary/5 text-primary' : 'text-muted-foreground'}`}>{day}<span class={`mx-auto mt-3 block size-1 rounded-full ${['화', '목', '토'].includes(day) ? 'bg-primary' : 'bg-border'}`}></span></div>{/each}
      </div>
      <div class="space-y-3">
        {#each events as event (event.day)}<div class="flex items-start gap-3 rounded-xl border p-4"><span class="bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-medium">{event.day}</span><div class="min-w-0 flex-1"><p class="text-muted-foreground font-mono text-xs">{event.time}</p><h5 class="mt-1 text-sm font-semibold">{event.title}</h5><p class="text-muted-foreground mt-1 text-xs leading-relaxed">{event.description}</p></div><span class="bg-primary/5 text-primary hidden rounded-full px-2.5 py-1 text-[11px] sm:inline">{event.status}</span></div>{/each}
      </div>
      <p class="text-muted-foreground mt-4 rounded-lg bg-muted/50 p-3 text-xs leading-relaxed">개인 일정의 제목과 메모는 본인만 확인합니다. 공연 배정 시에는 시간이 겹치는지만 알려줍니다.</p>
    {:else}
      <h4 class="font-semibold">한 공연, 서로 다른 역할</h4><p class="text-muted-foreground mt-1 text-xs">공연별 배역과 담당 업무에 맞춰 함께 준비합니다.</p>
      <div class="mt-5 grid gap-3 sm:grid-cols-2">
        {#each members as member (member.name)}<div class="rounded-xl border p-5"><div class="flex items-center gap-3"><span class="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold">{member.initial}</span><div><h5 class="text-sm font-semibold">{member.name}</h5><p class="text-muted-foreground mt-1 text-xs">{member.role}</p></div></div><p class="text-muted-foreground mt-5 flex items-center gap-2 text-xs"><Check size={14} aria-hidden="true" />{member.detail}</p></div>{/each}
      </div>
      <div class="bg-muted/40 mt-5 rounded-xl p-5"><p class="text-sm font-medium">관리자가 공연을 만들고, 참여자를 배정합니다.</p><p class="text-muted-foreground mt-2 text-xs leading-relaxed">회원의 기본 프로필과 공연 안에서 맡은 역할을 구분합니다. 참여자는 자신에게 배정된 공연의 일정·대본·소통 공간을 이용합니다.</p></div>
    {/if}
  </div>
  <div class="text-muted-foreground bg-muted/20 border-t px-4 py-3 text-[11px] leading-relaxed sm:px-6">기능 설명을 위한 예시입니다. 실제 데이터 저장·공유 세션 제어·미디어 재생은 하지 않습니다. 내 공연은 로그인 후 이용하세요.</div>
</div>
