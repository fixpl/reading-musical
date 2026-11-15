<script lang="ts">
  import { goto } from "$app/navigation";
  import { onDestroy, tick } from "svelte";
  import { ApiError, apiRequest } from "$lib/api/client";
  import { prepareProductionDraft, type AssistantScheduleConfirmation, type AssistantScheduleEvent, type AssistantSchedulePreview, type ProductionAssistantAnswer } from "$lib/api/production-assistant";
  import { captureSession, isCurrentSession } from "$lib/api/session";
  import { Button } from "$lib/components/ui/button";
  import { Textarea } from "$lib/components/ui/textarea";
  import { readinessStepLink } from "$lib/domain/operations-dashboard";

  const examples = [
    { label: "일정 시간 바꾸기", question: "공연 이름의 연습을 저녁 7시로 바꿔 줘" },
    { label: "공연 준비 상태 보기", question: "준비가 덜 된 공연과 먼저 할 일을 알려줘" },
    { label: "새 공연 초안 만들기", question: "낭독의 밤이라는 이름으로 새 공연을 준비해줘" }
  ];
  const dateFormat = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
  const scheduleDate = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric", weekday: "short" });
  const scheduleClock = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "numeric", minute: "2-digit" });
  const seoulDay = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", dateStyle: "short" });
  const filters: Record<string, string> = { attention: "준비 확인 필요", unregistered_script: "대본 미등록", rehearsal_script: "연습 대본 미준비", schedule: "다음 일정 없음", cues: "큐 미등록" };
  let question = $state("");
  let asked = $state("");
  let answer = $state<ProductionAssistantAnswer | null>(null);
  let busy = $state(false);
  let error = $state("");
  let input = $state<HTMLTextAreaElement | null>(null);
  let resultHeading = $state<HTMLHeadingElement | null>(null);
  let reviewHeading = $state<HTMLHeadingElement | null>(null);
  let focusedEvent = $state<AssistantScheduleEvent | null>(null);
  let previousRequest = $state("");
  let saving = $state(false);
  let scheduleStatus = $state("");
  let saved = $state(false);
  let expired = $state(false);
  let controller: AbortController | null = null;
  const session = captureSession();
  onDestroy(() => controller?.abort());

  async function ask(event: SubmitEvent) {
    event.preventDefault();
    await submitQuestion(question.trim());
  }

  async function submitQuestion(text: string, focus = focusedEvent) {
    if (busy || saving || text.length < 2 || !isCurrentSession(session)) return;
    const previousPreview = answer?.schedule?.preview;
    const canShowReview = !saved;
    const previousExpired = expired;
    const request = new AbortController();
    controller = request;
    busy = true;
    error = "";
    answer = null;
    saved = false;
    expired = false;
    scheduleStatus = "";
    try {
      const value = await apiRequest<ProductionAssistantAnswer>("/admin/production-assistant", {
        method: "POST", body: JSON.stringify({ question: text, eventId: focus?.id, previousRequest: previousRequest || undefined }), signal: request.signal, session
      });
      if (request.signal.aborted || !isCurrentSession(session)) return;
      const requestedReview = value.schedule?.reviewRequested && canShowReview && previousPreview?.event.id === value.schedule.focus?.id
        ? previousPreview : null;
      if (value.schedule?.reviewRequested) {
        value.schedule.preview = requestedReview ?? null;
        if (!requestedReview) value.answer = "바꿀 시간을 알려 주시면 변경 내용을 먼저 보여 드릴게요.";
        expired = Boolean(requestedReview && previousExpired);
      }
      if (!requestedReview) asked = text;
      answer = value;
      question = "";
      focusedEvent = value.schedule?.focus ?? null;
      if (!requestedReview) previousRequest = value.schedule ? text : "";
      await tick();
      resultHeading?.focus();
    } catch (failure) {
      if (!request.signal.aborted && isCurrentSession(session)) {
        error = failure instanceof Error ? failure.message : "공연 정보를 확인하지 못했어요.";
      }
    } finally {
      busy = false;
      controller = null;
    }
  }

  function formatRange({ startAt, endAt }: { startAt: string; endAt: string }) {
    const start = new Date(startAt);
    const end = new Date(endAt);
    const date = scheduleDate.format(start);
    const endDate = seoulDay.format(start) === seoulDay.format(end) ? "" : `${scheduleDate.format(end)} `;
    return { date, time: `${scheduleClock.format(start)} ~ ${endDate}${scheduleClock.format(end)}` };
  }

  async function confirmSchedule(preview: AssistantSchedulePreview) {
    if (!preview.approvalToken || saving || busy || saved || expired || !isCurrentSession(session)) return;
    saving = true;
    scheduleStatus = "";
    try {
      const result = await apiRequest<AssistantScheduleConfirmation>("/admin/production-assistant/schedule-confirm", {
        method: "POST", body: JSON.stringify({ approvalToken: preview.approvalToken }), session
      });
      if (!isCurrentSession(session) || !answer?.schedule) return;
      if (result.status === "review") {
        answer.schedule.preview = result.preview;
        answer.schedule.focus = result.preview.event;
        focusedEvent = result.preview.event;
        scheduleStatus = result.preview.conflicts.length
          ? "새로 겹치는 일정이 생겼어요. 다른 시간을 알려 주세요."
          : "일정이나 참석 응답이 바뀌었어요. 아래에서 최신 내용을 다시 확인해 주세요.";
      } else {
        saved = true;
        scheduleStatus = result.previouslySaved ? "이미 저장한 변경이에요."
          : result.notificationWarning ? "일정을 저장했어요. 일부 알림을 준비하지 못했어요."
          : "일정 변경을 저장했어요.";
      }
    } catch (failure) {
      if (!isCurrentSession(session)) return;
      expired = failure instanceof ApiError && failure.code === "SCHEDULE_PREVIEW_EXPIRED";
      scheduleStatus = failure instanceof Error ? failure.message : "일정을 저장하지 못했어요. 다시 시도해 주세요.";
    } finally {
      saving = false;
      await tick();
      reviewHeading?.focus();
    }
  }

  async function openRegistration() {
    if (!answer?.draft || !isCurrentSession(session)) return;
    prepareProductionDraft(answer.draft, session);
    await goto("/admin/productions?create=1&draft=assistant");
  }
</script>

<div class="mx-auto grid w-full min-w-0 max-w-4xl gap-6">
  <div class="grid gap-2">
    <h1 class="text-2xl font-semibold tracking-tight">공연 도우미</h1>
    <p class="text-muted-foreground max-w-2xl text-sm leading-6">공연 준비 상태를 확인하고, 일정 변경이나 새 공연 등록을 준비할 수 있어요.</p>
  </div>

  <form onsubmit={ask} aria-busy={busy} class="grid gap-4 rounded-xl border bg-card p-4 sm:p-5">
    <div class="grid gap-2">
      <label for="production-question" class="text-sm font-semibold">어떤 공연 업무를 도와드릴까요?</label>
      <Textarea id="production-question" bind:ref={input} bind:value={question} rows={3} maxlength={1000} disabled={busy || saving}
        placeholder={focusedEvent ? "예: 그럼 저녁 7시 반으로 바꿔 줘" : "예: 낭독의 밤 최종 연습을 저녁 7시로 바꿔 줘"}
        aria-describedby={focusedEvent ? "assistant-focused-event" : undefined} />
      {#if focusedEvent}
        <div class="flex min-w-0 flex-wrap items-center gap-x-3">
          <p id="assistant-focused-event" class="text-muted-foreground text-sm [overflow-wrap:anywhere]">이어 묻는 일정 · {focusedEvent.productionTitle} / {focusedEvent.title}</p>
          <Button type="button" variant="ghost" size="touch" disabled={busy || saving} onclick={() => { focusedEvent = null; previousRequest = ""; answer = null; input?.focus(); }}>선택 해제</Button>
        </div>
      {/if}
    </div>
    <div class="flex flex-wrap gap-2" aria-label="질문 예시">
      {#each examples as example (example.label)}
        <Button type="button" variant="outline" class="h-auto min-h-11 max-w-full whitespace-normal text-start" disabled={busy || saving} onclick={() => { question = example.question; input?.focus(); }}>{example.label}</Button>
      {/each}
    </div>
    <div class="flex flex-wrap items-center gap-3">
      <Button type="submit" size="touch" disabled={busy || saving || question.trim().length < 2}>{busy ? "확인 중…" : "공연 도우미에게 묻기"}</Button>
      {#if busy}<Button type="button" variant="ghost" size="touch" onclick={() => controller?.abort()}>중단</Button>{/if}
      {#if busy}<span class="text-muted-foreground text-sm" role="status">요청 내용을 확인하고 있어요.</span>{/if}
    </div>
    {#if error}<p class="text-destructive text-sm" role="alert">{error}</p>{/if}
  </form>

  {#if answer}
    <section class="grid min-w-0 gap-4 rounded-xl border bg-card p-4 sm:p-5" aria-labelledby="assistant-answer">
      <div class="grid gap-2">
        <h2 id="assistant-answer" class="text-lg font-semibold" tabindex="-1" bind:this={resultHeading}>공연 도우미 답변</h2>
        <p class="text-muted-foreground text-sm [overflow-wrap:anywhere]">{asked}</p>
      </div>
      {#if !saved && !scheduleStatus}<p class="whitespace-pre-wrap text-sm leading-7 [overflow-wrap:anywhere]">{answer.answer}</p>{/if}

      {#if answer.schedule?.preview}
        {@const preview = answer.schedule.preview}
        {@const before = formatRange(preview.before)}
        {@const after = formatRange(preview.after)}
        <div class="grid gap-4 border-t pt-4" aria-busy={saving}>
          <div class="grid gap-1">
            <h3 class="font-semibold" tabindex="-1" bind:this={reviewHeading}>{saved ? "저장한 일정" : "일정 변경 확인"}</h3>
            <p class="text-sm [overflow-wrap:anywhere]">{preview.event.productionTitle} · {preview.event.title}</p>
          </div>
          {#if scheduleStatus}<p class="text-sm font-medium" role="status">{scheduleStatus}</p>{/if}
          <dl class="grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label="한국 시간">
            <div class="min-w-0 rounded-lg border p-3">
              <dt class="text-muted-foreground text-sm">변경 전</dt>
              <dd class="mt-1 text-sm">{before.date}<br /><span class="font-medium tabular-nums">{before.time}</span></dd>
            </div>
            <div class="min-w-0 rounded-lg border border-primary/30 bg-primary/5 p-3">
              <dt class="text-sm font-medium text-primary">변경 후</dt>
              <dd class="mt-1 text-sm">{after.date}<br /><span class="font-semibold tabular-nums">{after.time}</span></dd>
            </div>
          </dl>
          {#if preview.conflicts.length}
            <div class="grid gap-2 rounded-lg border border-destructive/30 p-3">
              <h4 class="text-destructive text-sm font-semibold">겹치는 일정 {preview.conflicts.length}건</h4>
              <ul class="grid gap-2 text-sm">
                {#each preview.conflicts as conflict (conflict)}
                  {@const overlap = formatRange(conflict)}
                  <li class="[overflow-wrap:anywhere]">{conflict.userName} · {conflict.reason}<br /><span class="text-muted-foreground">{overlap.date} {overlap.time}</span></li>
                {/each}
              </ul>
            </div>
          {/if}
          {#if preview.timeChanged}
            <div class="grid gap-2">
              <h4 class="text-sm font-semibold">다시 응답할 사람 {preview.reconfirm.length}명</h4>
              {#if preview.reconfirm.length}
                <ul class="divide-y rounded-lg border px-3 text-sm">
                  {#each preview.reconfirm as person (person.id)}
                    <li class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
                      <span class="min-w-0 [overflow-wrap:anywhere]">{person.name}</span>
                      <span class="text-muted-foreground">{person.status === "ACCEPTED" ? "기존 참석" : "기존 미정"}</span>
                    </li>
                  {/each}
                </ul>
              {:else}
                <p class="text-muted-foreground text-sm">다시 응답할 사람이 없어요.</p>
              {/if}
            </div>
          {/if}
          <div class="flex flex-wrap gap-2">
            {#if saved}
              <Button href={`/app/p/${preview.event.productionId}/schedule?date=${seoulDay.format(new Date(preview.after.startAt))}`} variant="outline" size="touch">저장한 일정 보기</Button>
            {:else}
              {#if preview.approvalToken && !expired}
                <Button type="button" size="touch" disabled={saving || busy} onclick={() => confirmSchedule(preview)}>{saving ? "저장 중…" : "이 시간으로 변경하고 알리기"}</Button>
              {/if}
              {#if expired}
                <Button type="button" variant="outline" size="touch" onclick={() => submitQuestion(asked)}>변경 내용 다시 확인</Button>
              {/if}
              <Button type="button" variant="ghost" size="touch" disabled={saving || busy} onclick={() => input?.focus()}>다른 시간 말하기</Button>
            {/if}
          </div>
        </div>
      {:else if answer.schedule?.matches.length && (answer.schedule.matches.length > 1 || answer.schedule.hasMore)}
        <ul class="grid gap-2 border-t pt-4" aria-label="바꿀 일정 후보">
          {#each answer.schedule.matches as candidate (candidate.id)}
            {@const range = formatRange(candidate)}
            <li>
              <Button type="button" variant="outline" class="h-auto min-h-11 w-full justify-start whitespace-normal p-3 text-start [overflow-wrap:anywhere]" onclick={() => submitQuestion(asked, candidate)}>
                <span>{candidate.productionTitle} · {candidate.title}<br /><span class="text-muted-foreground text-sm">{range.date} {range.time}</span></span>
              </Button>
            </li>
          {/each}
          {#if answer.schedule.hasMore}<li class="text-muted-foreground text-sm">찾는 일정이 보이지 않으면 공연 이름이나 날짜를 더 구체적으로 적어 주세요.</li>{/if}
        </ul>
      {/if}

      {#if answer.evidence}
        {@const range = [answer.evidence.scope === "all" ? "전체 공연" : answer.evidence.scope === "archived" ? "보관 공연" : "보관하지 않은 공연", filters[answer.evidence.filter], answer.evidence.query,
          answer.evidence.from || answer.evidence.to ? `${answer.evidence.from ?? ""}~${answer.evidence.to ?? ""}` : ""].filter(Boolean)}
        <div class="grid gap-2 border-t pt-4">
          <h3 class="text-sm font-semibold">조회한 공연</h3>
          <p class="text-muted-foreground break-words text-sm">{range.join(" · ")} · {answer.evidence.total}개{answer.evidence.total > answer.evidence.items.length ? ` 중 ${answer.evidence.items.length}개 표시` : ""}</p>
          {#if answer.evidence.items.length}
            <ul class="divide-y">
              {#each answer.evidence.items as production (production.id)}
                <li class="grid min-w-0 gap-1 py-2">
                  <div class="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1">
                    <div class="min-w-0">
                      <p class="text-sm font-medium [overflow-wrap:anywhere]">{production.title}</p>
                      <p class="text-muted-foreground text-xs">{production.startDate ?? "공연일 미정"} · {production.archived ? "보관" : production.attention.length ? `확인할 일 ${production.attention.length}개` : "준비된 항목 확인 완료"}</p>
                    </div>
                    <Button href={`/app/p/${production.id}`} variant="ghost" size="touch">공연 열기<span class="sr-only"> · {production.title}</span></Button>
                  </div>
                  {#if production.nextEventAt}
                    <p class="text-muted-foreground text-xs">다음 일정 {dateFormat.format(new Date(production.nextEventAt))}</p>
                  {/if}
                  {#if production.attention.length && !production.archived}
                    <div class="flex flex-wrap gap-x-3">
                      {#each production.readiness.filter(step => !step.done && step.detail !== "—") as step (step.key)}
                        <a class="text-primary inline-flex min-h-10 items-center text-sm underline underline-offset-4" href={readinessStepLink(production.id, step.key)}>{step.label} 확인</a>
                      {/each}
                      {#if !production.casting.done && production.casting.detail !== "배역 없음"}
                        <a class="text-primary inline-flex min-h-10 items-center text-sm underline underline-offset-4" href={readinessStepLink(production.id, "casting")}>배역 확인</a>
                      {/if}
                    </div>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}

      {#if answer.draft}
        <div class="grid gap-3 border-t pt-4">
          <h3 class="font-semibold">새 공연 초안</h3>
          <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
            <dt class="text-muted-foreground">공연 이름</dt><dd class="font-medium [overflow-wrap:anywhere]">{answer.draft.title}</dd>
            <dt class="text-muted-foreground">장소</dt><dd class="[overflow-wrap:anywhere]">{answer.draft.venue || "미정"}</dd>
            <dt class="text-muted-foreground">공연일</dt><dd>{answer.draft.startDate || "미정"}</dd>
            {#if answer.draft.synopsis}<dt class="text-muted-foreground">한 줄 소개</dt><dd class="[overflow-wrap:anywhere]">{answer.draft.synopsis}</dd>{/if}
          </dl>
          <p class="text-muted-foreground text-sm">등록 화면에서 내용을 고친 뒤 저장할 수 있어요.</p>
          <Button type="button" size="touch" class="w-fit" onclick={openRegistration}>초안을 등록 화면에서 열기</Button>
        </div>
      {/if}
    </section>
  {/if}
</div>
