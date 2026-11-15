<script lang="ts">
  import { ArrowUpRight } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button";
  import { Label } from "$lib/components/ui/label";
  import { Textarea } from "$lib/components/ui/textarea";
  import type { RecruitmentApplication, RecruitmentReviewStatus, RecruitmentRoundStatus } from "$lib/api/recruitment";
  import { RECRUITMENT_ROLE_LABELS, RECRUITMENT_APPLICATION_LABELS, recruitmentDateTime, recruitmentTone, isPendingRecruitmentApplication } from "$lib/domain/recruitment";

  // 상태 변경·revision·재조회는 부모가 관리하고, 이 컴포넌트는 입력과 선택을 전달한다.
  let { application, pid, roundStatus, full, busy, reviewsStale, applicationsLoading, note, onNoteChange, onReview }: {
    application: RecruitmentApplication;
    pid: string;
    roundStatus: RecruitmentRoundStatus;
    full: boolean;
    busy: string;
    reviewsStale: boolean;
    applicationsLoading: boolean;
    note: string;
    onNoteChange: (value: string) => void;
    onReview: (status: RecruitmentReviewStatus) => void;
  } = $props();
  const pending = $derived(isPendingRecruitmentApplication(application.status));
</script>

<article class="min-w-0 rounded-xl border p-4" aria-labelledby={`applicant-${application.id}`}>
  <header class="flex flex-wrap items-start justify-between gap-3"><div class="min-w-0"><h3 id={`applicant-${application.id}`} class="break-words font-semibold">{application.applicantName}</h3><p class="text-muted-foreground mt-1 break-words text-sm">{RECRUITMENT_ROLE_LABELS[application.position.role]} · {application.position.label}</p><p class="text-muted-foreground mt-1 text-xs">접수 {recruitmentDateTime(application.createdAt)}</p></div><span class="inline-flex rounded-full border px-2 py-1 text-xs {recruitmentTone(application.status)}">{RECRUITMENT_APPLICATION_LABELS[application.status]}</span></header>
  <div class="mt-4"><h4 class="text-muted-foreground text-xs font-medium">지원 내용</h4><p class="mt-1 whitespace-pre-wrap break-words text-sm leading-7">{application.message}</p></div>
  {#if application.availability}<div class="mt-3"><h4 class="text-muted-foreground text-xs font-medium">참여 가능한 시간·일정</h4><p class="mt-1 whitespace-pre-wrap break-words text-sm leading-7">{application.availability}</p></div>{/if}
  {#if application.reviewMessage}<div class="mt-3 rounded-lg bg-muted/40 p-3"><h4 class="text-muted-foreground text-xs font-medium">마지막으로 전한 말</h4><p class="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{application.reviewMessage}</p></div>{/if}
  {#if application.status === "ON_HOLD"}<p class="text-muted-foreground mt-3 text-xs leading-5">추가 검토 중이며 아직 참여가 확정되지 않았어요.</p>{/if}
  {#if pending && roundStatus !== "CANCELLED"}
    <div class="mt-4 grid gap-2 border-t pt-4"><Label for={`review-note-${application.id}`}>지원자에게 전할 말 <span class="text-muted-foreground text-xs">선택</span></Label><Textarea id={`review-note-${application.id}`} maxlength={1000} rows={2} value={note} oninput={(event) => onNoteChange(event.currentTarget.value)} disabled={Boolean(busy)} placeholder="다음 일정이나 확인할 내용을 적어 주세요." class="min-h-20" /><p class="text-muted-foreground text-xs leading-5">상태를 바꿀 때 지원자에게 보여요. 관리자만 보는 메모가 아니에요.</p></div>
    <div class="mt-3 flex flex-wrap gap-2"><Button size="touch" variant="outline" disabled={Boolean(busy) || reviewsStale || applicationsLoading || application.status === "REVIEWING"} onclick={() => onReview("REVIEWING")}>검토 중</Button><Button size="touch" variant="outline" disabled={Boolean(busy) || reviewsStale || applicationsLoading || application.status === "ON_HOLD"} onclick={() => onReview("ON_HOLD")}>추가 검토</Button><Button size="touch" variant="outline" disabled={Boolean(busy) || reviewsStale || applicationsLoading} onclick={() => onReview("NOT_SELECTED")}>미선정 안내</Button><Button size="touch" disabled={Boolean(busy) || reviewsStale || applicationsLoading || full} onclick={() => onReview("APPROVED")}>{busy === `review:${application.id}` ? "변경 중…" : full ? "정원 마감" : "참여 승인"}</Button></div>
  {:else if application.status === "APPROVED"}<div class="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 p-3">{#if application.membershipId}<p class="text-sm leading-6">{RECRUITMENT_ROLE_LABELS[application.position.role]}로 공연팀에 연결됐어요. {application.position.role === "ACTOR" ? "배역은 따로 배정해 주세요." : "담당 직무는 따로 지정해 주세요."}</p><Button size="touch" variant="outline" href={`/app/p/${pid}/manage/${application.position.role === "ACTOR" ? "casting" : "members"}`}>{application.position.role === "ACTOR" ? "배역 배정" : "멤버 관리"}<ArrowUpRight class="size-4" /></Button>{:else}<p class="text-sm leading-6">참여 승인 이력이 남아 있어요. 현재 공연팀에는 연결되어 있지 않아요.</p>{/if}</div>{/if}
  {#if !pending && note.trim()}<p class="text-muted-foreground mt-3 whitespace-pre-wrap break-words rounded-lg border p-3 text-sm leading-6">아직 보내지 않은 내용: {note}</p>{/if}
  {#if application.events.length > 0}<details class="mt-4 border-t pt-3"><summary class="text-muted-foreground min-h-11 cursor-pointer py-3 text-xs">지원 상태 기록 {application.events.length}건</summary><ol class="grid gap-3 pb-1">{#each application.events as event (event.id)}<li class="border-l-2 border-muted pl-3 text-xs leading-5"><p class="font-medium">{RECRUITMENT_APPLICATION_LABELS[event.toStatus]}</p><p class="text-muted-foreground">{recruitmentDateTime(event.createdAt)}</p>{#if event.message}<p class="mt-1 whitespace-pre-wrap break-words">{event.message}</p>{/if}</li>{/each}</ol></details>{/if}
</article>
