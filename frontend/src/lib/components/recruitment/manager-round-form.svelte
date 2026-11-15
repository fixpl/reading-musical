<script lang="ts">
  import { untrack } from "svelte";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import TrashIcon from "@lucide/svelte/icons/trash-2";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Textarea } from "$lib/components/ui/textarea";
  import * as Select from "$lib/components/ui/select";
  import { ConfirmDialog } from "$lib/components/ui/confirm-dialog";
  import { RECRUITMENT_ROLE_LABELS } from "$lib/domain/recruitment";
  import type { RecruitmentRole, RecruitmentRoundDocument } from "$lib/api/recruitment";

  let { document, busy = false, error = "", onsubmit, ondirty }: {
    document: RecruitmentRoundDocument;
    busy?: boolean;
    error?: string;
    onsubmit: (document: RecruitmentRoundDocument) => void;
    ondirty?: (dirty: boolean) => void;
  } = $props();

  type FormPosition = { key: number; role: RecruitmentRole; label: string; capacity: number | undefined };
  type Form = Omit<RecruitmentRoundDocument, "activityStartDate" | "activityEndDate" | "deadlineAt" | "positions"> & {
    activityStartDate: string; activityEndDate: string; deadlineLocal: string; positions: FormPosition[];
  };
  const uid = $props.id();
  const roles: RecruitmentRole[] = ["ACTOR", "STAFF"];
  let positionSequence = 0;
  let sourceDocument = untrack(() => document);
  let confirmation: ConfirmDialog;
  let form = $state<Form>(makeForm(sourceDocument));
  let baseline = $state(untrack(() => serialize(form)));
  let validation = $state<{ field: string; message: string } | null>(null);
  const dirty = $derived(serialize(form) !== baseline);

  function localDeadline(value: string | null) {
    if (!value) return "";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    const pad = (number: number) => String(number).padStart(2, "0");
    return `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  function makeForm(value: RecruitmentRoundDocument): Form {
    return {
      title: value.title, summary: value.summary, description: value.description, region: value.region,
      activityStartDate: value.activityStartDate ?? "", activityEndDate: value.activityEndDate ?? "",
      conditions: value.conditions, deadlineLocal: localDeadline(value.deadlineAt),
      positions: (value.positions.length ? value.positions : [{ role: "ACTOR" as const, label: "", capacity: 1 }])
        .map((position) => ({ ...position, key: positionSequence++ })),
    };
  }
  function serialize(value: Form) {
    return JSON.stringify({ ...value, positions: value.positions.map(({ role, label, capacity }) => ({ role, label, capacity })) });
  }

  // 수정이유: 저장 대기·오류 갱신에는 작성 중인 입력을 유지하고, 외부에서 초안을 교체할 때만 초기화해요.
  $effect(() => {
    const nextDocument = document;
    untrack(() => {
      if (nextDocument === sourceDocument) return;
      sourceDocument = nextDocument;
      form = makeForm(nextDocument);
      baseline = serialize(form);
      validation = null;
    });
  });
  $effect(() => {
    const changed = dirty;
    untrack(() => ondirty?.(changed));
  });

  function validDate(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    if (year < 1 || month < 1 || month > 12 || day < 1) return false;
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  }
  function deadlineIso(value: string) {
    if (!value) return null;
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(value);
    if (!match || !validDate(match[1]) || Number(match[2]) > 23 || Number(match[3]) > 59) return undefined;
    const date = new Date(`${value}:00`);
    // 수정이유: 일부 지역의 서머타임으로 존재하지 않는 현지 시각이 다음 시각으로 자동 보정되는 것을 막아요.
    if (!Number.isFinite(date.getTime()) || localDeadline(date.toISOString()) !== value) return undefined;
    return date.toISOString();
  }
  function reject(formElement: HTMLFormElement, field: string, message: string) {
    validation = { field, message };
    const element = formElement.elements.namedItem(field);
    if (element instanceof HTMLElement) element.focus();
  }
  function save(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    validation = null;
    const formElement = event.currentTarget as HTMLFormElement;
    if (!form.title.trim() || form.title.length > 120) return reject(formElement, "title", "모집 이름을 120자 이내로 입력해 주세요.");
    for (const [field, limit, label] of [["summary", 200, "한 줄 소개"], ["description", 5000, "모집 소개"], ["region", 120, "활동 지역"], ["conditions", 2000, "참여 조건"]] as const) {
      if (form[field].length > limit) return reject(formElement, field, `${label}는 ${limit.toLocaleString("ko-KR")}자 이내로 입력해 주세요.`);
    }
    if (form.activityStartDate && !validDate(form.activityStartDate)) return reject(formElement, "activityStartDate", "활동 시작일을 올바른 날짜로 입력해 주세요.");
    if (form.activityEndDate && !validDate(form.activityEndDate)) return reject(formElement, "activityEndDate", "활동 종료일을 올바른 날짜로 입력해 주세요.");
    if (form.activityStartDate && form.activityEndDate && form.activityEndDate < form.activityStartDate) return reject(formElement, "activityEndDate", "활동 종료일은 시작일과 같거나 뒤여야 해요.");
    const deadlineAt = deadlineIso(form.deadlineLocal);
    if (deadlineAt === undefined) return reject(formElement, "deadlineLocal", "지원 마감 시각을 올바르게 입력해 주세요.");
    if (form.positions.length < 1 || form.positions.length > 20) return reject(formElement, "title", "모집 자리는 1개부터 20개까지 등록할 수 있어요.");
    for (const position of form.positions) {
      if (!roles.includes(position.role)) return reject(formElement, `position-role-${position.key}`, "배우 또는 스태프를 선택해 주세요.");
      if (!position.label.trim() || position.label.length > 100) return reject(formElement, `position-label-${position.key}`, "모집 자리 이름을 100자 이내로 입력해 주세요.");
      if (position.capacity === undefined || !Number.isInteger(position.capacity) || position.capacity < 1 || position.capacity > 1000) return reject(formElement, `position-capacity-${position.key}`, "모집 인원은 1명부터 1,000명까지 정수로 입력해 주세요.");
    }
    onsubmit({
      title: form.title.trim(), summary: form.summary.trim(), description: form.description.trim(), region: form.region.trim(),
      activityStartDate: form.activityStartDate || null, activityEndDate: form.activityEndDate || null, conditions: form.conditions.trim(),
      deadlineAt: form.deadlineLocal === localDeadline(sourceDocument.deadlineAt) ? sourceDocument.deadlineAt : deadlineAt,
      positions: form.positions.map(({ role, label, capacity }) => ({ role, label: label.trim(), capacity: capacity as number })),
    });
  }
  function addPosition() {
    if (busy || form.positions.length >= 20) return;
    form.positions.push({ key: positionSequence++, role: "ACTOR", label: "", capacity: 1 });
    validation = null;
  }
  async function removePosition(position: FormPosition) {
    if (busy || form.positions.length <= 1) return;
    const originalDocument = sourceDocument;
    const result = await confirmation.ask({
      title: "모집 자리를 지울까요?", description: `‘${position.label.trim() || "이름을 입력하지 않은 자리"}’의 입력 내용이 초안에서 지워져요.`,
      confirmLabel: "자리 지우기", destructive: true,
    });
    if (!result.confirmed || busy || originalDocument !== sourceDocument || form.positions.length <= 1) return;
    form.positions = form.positions.filter((item) => item.key !== position.key);
    validation = null;
  }
  function invalid(field: string) { return validation?.field === field; }
  function description(field: string, help?: string) { return [help, invalid(field) ? `${uid}-validation` : ""].filter(Boolean).join(" ") || undefined; }
</script>

<form onsubmit={save} oninput={() => validation = null} novalidate class="min-w-0 space-y-6" aria-busy={busy}>
  <p class="text-sm leading-6 text-muted-foreground">모집 이름과 모집 자리 이름·인원은 필수예요. 나머지는 정해진 내용부터 적어 주세요.</p>
  <fieldset disabled={busy} class="min-w-0 space-y-5 disabled:opacity-75">
    <div class="grid gap-2">
      <label for={`${uid}-title`} class="text-sm font-medium">모집 이름 <span class="text-xs text-muted-foreground">필수</span></label>
      <Input id={`${uid}-title`} name="title" bind:value={form.title} maxlength={120} required aria-invalid={invalid("title")} aria-describedby={description("title")} placeholder="예: 봄 정기공연 배우·스태프 모집" class="min-h-11" />
    </div>
    <div class="grid gap-2">
      <label for={`${uid}-summary`} class="text-sm font-medium">한 줄 소개 <span class="text-xs text-muted-foreground">선택</span></label>
      <Input id={`${uid}-summary`} name="summary" bind:value={form.summary} maxlength={200} aria-invalid={invalid("summary")} aria-describedby={description("summary")} placeholder="공연과 함께할 사람에게 전할 짧은 소개" class="min-h-11" />
    </div>
    <div class="grid gap-2">
      <label for={`${uid}-description`} class="text-sm font-medium">모집 소개 <span class="text-xs text-muted-foreground">선택</span></label>
      <Textarea id={`${uid}-description`} name="description" bind:value={form.description} maxlength={5000} rows={6} aria-invalid={invalid("description")} aria-describedby={description("description")} placeholder="어떤 공연인지, 어떤 사람과 함께하고 싶은지 알려 주세요." />
    </div>
    <div class="grid gap-4 sm:grid-cols-2">
      <div class="grid gap-2">
        <label for={`${uid}-region`} class="text-sm font-medium">활동 지역 <span class="text-xs text-muted-foreground">선택</span></label>
        <Input id={`${uid}-region`} name="region" bind:value={form.region} maxlength={120} aria-invalid={invalid("region")} aria-describedby={description("region")} placeholder="예: 서울 마포구" class="min-h-11" />
      </div>
      <div class="grid gap-2">
        <label for={`${uid}-deadline`} class="text-sm font-medium">지원 마감 시각 <span class="text-xs text-muted-foreground">선택</span></label>
        <Input id={`${uid}-deadline`} name="deadlineLocal" type="datetime-local" step={60} bind:value={form.deadlineLocal} aria-invalid={invalid("deadlineLocal")} aria-describedby={description("deadlineLocal", `${uid}-deadline-help`)} class="min-h-11" />
        <p id={`${uid}-deadline-help`} class="text-xs leading-5 text-muted-foreground">현재 기기의 현지 시각으로 입력해요. 비워두면 직접 접수를 마감할 때까지 지원받아요.</p>
      </div>
      <div class="grid gap-2">
        <label for={`${uid}-activity-start`} class="text-sm font-medium">활동 시작일 <span class="text-xs text-muted-foreground">선택</span></label>
        <Input id={`${uid}-activity-start`} name="activityStartDate" type="date" bind:value={form.activityStartDate} aria-invalid={invalid("activityStartDate")} aria-describedby={description("activityStartDate", `${uid}-activity-help`)} class="min-h-11" />
      </div>
      <div class="grid gap-2">
        <label for={`${uid}-activity-end`} class="text-sm font-medium">활동 종료일 <span class="text-xs text-muted-foreground">선택</span></label>
        <Input id={`${uid}-activity-end`} name="activityEndDate" type="date" min={form.activityStartDate || undefined} bind:value={form.activityEndDate} aria-invalid={invalid("activityEndDate")} aria-describedby={description("activityEndDate", `${uid}-activity-help`)} class="min-h-11" />
      </div>
    </div>
    <p id={`${uid}-activity-help`} class="text-xs leading-5 text-muted-foreground">연습부터 공연까지 함께하는 기간이에요. 미정인 날짜는 비워둘 수 있어요.</p>
    <div class="grid gap-2">
      <label for={`${uid}-conditions`} class="text-sm font-medium">참여 조건 <span class="text-xs text-muted-foreground">선택</span></label>
      <Textarea id={`${uid}-conditions`} name="conditions" bind:value={form.conditions} maxlength={2000} rows={4} aria-invalid={invalid("conditions")} aria-describedby={description("conditions")} placeholder="연습 요일, 필요한 경험, 보수·참가비 등 지원 전에 알아야 할 내용을 적어 주세요." />
    </div>

    <section aria-labelledby={`${uid}-positions-heading`} class="min-w-0 space-y-3 border-t pt-5">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${uid}-positions-heading`} class="text-base font-semibold">모집 자리 <span class="text-sm font-normal text-muted-foreground">{form.positions.length}/20개</span></h3>
        <Button type="button" variant="outline" size="touch" disabled={busy || form.positions.length >= 20} onclick={addPosition}><PlusIcon />자리 추가</Button>
      </div>
      <p id={`${uid}-positions-help`} class="text-xs leading-5 text-muted-foreground">배우·스태프는 공연팀 참여 권한을 구분해요. 배역이나 담당 직무는 참여 확정 뒤 따로 배정해요.</p>
      {#each form.positions as position, index (position.key)}
        <div class="min-w-0 space-y-3 rounded-xl border bg-muted/20 p-4">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="text-sm font-semibold">모집 자리 {index + 1}</p>
            <Button type="button" variant="ghost" size="touch" disabled={busy || form.positions.length <= 1} aria-label={`모집 자리 ${index + 1} 지우기`} onclick={() => removePosition(position)}><TrashIcon />지우기</Button>
          </div>
          <div class="grid min-w-0 gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]">
            <div class="grid min-w-0 gap-2">
              <label for={`${uid}-position-role-${position.key}`} class="text-sm font-medium">참여 구분 <span class="text-xs text-muted-foreground">필수</span></label>
              <Select.Root type="single" name={`position-role-${position.key}`} bind:value={position.role} disabled={busy} required>
                <Select.Trigger id={`${uid}-position-role-${position.key}`} class="min-h-11 w-full" aria-invalid={invalid(`position-role-${position.key}`)} aria-describedby={description(`position-role-${position.key}`, `${uid}-positions-help`)}>{RECRUITMENT_ROLE_LABELS[position.role]}</Select.Trigger>
                <Select.Content>{#each roles as role (role)}<Select.Item value={role} label={RECRUITMENT_ROLE_LABELS[role]} />{/each}</Select.Content>
              </Select.Root>
            </div>
            <div class="grid min-w-0 gap-2">
              <label for={`${uid}-position-label-${position.key}`} class="text-sm font-medium">자리 이름 <span class="text-xs text-muted-foreground">필수</span></label>
              <Input id={`${uid}-position-label-${position.key}`} name={`position-label-${position.key}`} bind:value={position.label} maxlength={100} required aria-invalid={invalid(`position-label-${position.key}`)} aria-describedby={description(`position-label-${position.key}`)} placeholder={position.role === "ACTOR" ? "예: 앙상블 배우" : "예: 조명 스태프"} class="min-h-11" />
            </div>
            <div class="grid min-w-0 gap-2">
              <label for={`${uid}-position-capacity-${position.key}`} class="text-sm font-medium">모집 인원 <span class="text-xs text-muted-foreground">필수</span></label>
              <div class="flex items-center gap-2">
                <Input id={`${uid}-position-capacity-${position.key}`} name={`position-capacity-${position.key}`} type="number" min={1} max={1000} step={1} bind:value={position.capacity} required aria-invalid={invalid(`position-capacity-${position.key}`)} aria-describedby={description(`position-capacity-${position.key}`)} class="min-h-11" /><span class="shrink-0 text-sm">명</span>
              </div>
            </div>
          </div>
        </div>
      {/each}
      <p class="text-xs text-muted-foreground">모집 자리는 최소 1개, 최대 20개까지 등록할 수 있어요.</p>
    </section>
  </fieldset>
  {#if validation}<p id={`${uid}-validation`} role="alert" class="text-sm leading-6 text-destructive">{validation.message}</p>{/if}
  {#if error}<p role="alert" class="text-sm leading-6 text-destructive">{error}</p>{/if}
  <div class="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
    <p class="text-xs leading-5 text-muted-foreground">초안 저장 후 내용을 확인하고 따로 게시해요.<br />{dirty ? "아직 저장하지 않은 변경이 있어요." : "작성한 내용을 초안으로 저장해 주세요."}</p>
    <Button type="submit" size="touch" disabled={busy} class="max-sm:w-full">{busy ? "처리 중…" : "모집 초안 저장"}</Button>
  </div>
</form>
<ConfirmDialog bind:this={confirmation} />
