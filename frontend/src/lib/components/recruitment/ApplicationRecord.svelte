<script lang="ts">
  import type { RecruitmentApplication } from "$lib/api/recruitment";
  import { RECRUITMENT_APPLICATION_LABELS, recruitmentDateTime } from "$lib/domain/recruitment";
  let { application }: { application: RecruitmentApplication } = $props();
</script>

<details class="mt-4 border-t pt-2">
  <summary class="focus-visible:outline-ring inline-flex min-h-11 cursor-pointer items-center rounded-md text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-2">보낸 지원서와 처리 내역</summary>
  <div class="mt-2 grid gap-4 pb-2 text-sm leading-7">
    <div><h4 class="font-medium">지원 내용</h4><p class="text-muted-foreground mt-1 whitespace-pre-wrap break-words">{application.message}</p></div>
    {#if application.availability}<div><h4 class="font-medium">직접 적은 참여 가능 시간</h4><p class="text-muted-foreground mt-1 whitespace-pre-wrap break-words">{application.availability}</p></div>{/if}
    {#if application.reviewMessage}<div class="rounded-lg bg-muted/50 p-3"><h4 class="font-medium">공연팀 안내</h4><p class="mt-1 whitespace-pre-wrap break-words">{application.reviewMessage}</p></div>{/if}
    {#if application.events.length}<div><h4 class="font-medium">처리 내역</h4><ol class="mt-2 space-y-3 border-s ps-4">{#each application.events as event (event.id)}<li><p class="font-medium">{RECRUITMENT_APPLICATION_LABELS[event.toStatus]}</p><p class="text-muted-foreground text-xs leading-6">{recruitmentDateTime(event.createdAt)}</p>{#if event.message}<p class="text-muted-foreground mt-1 whitespace-pre-wrap break-words">{event.message}</p>{/if}</li>{/each}</ol></div>{/if}
  </div>
</details>
