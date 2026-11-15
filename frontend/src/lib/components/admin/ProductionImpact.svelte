<script lang="ts">
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  export interface DeletionImpact {
    id: string; title: string; visibility: string; deletedAt: string | null; archived: boolean;
    counts: Record<string, number>; futureEvents: number; liveSessions: number;
    inquiries: Array<{ id: string; orgName: string; status: string }>;
    guidance: { permanentDeletionAvailable: boolean };
  }
  let { impact }: { impact: DeletionImpact } = $props();
  const labels: Record<string, string> = { members: "참여자", actors: "배우", staff: "스태프", scripts: "대본", sections: "장·막", assets: "첨부 자료", events: "일정", boardPosts: "공유 게시물", personalRehearsals: "개인 연습 기록", inquiries: "연결 신청" };
</script>
<div class="space-y-4 text-sm [word-break:keep-all] [overflow-wrap:anywhere]">
  <dl class="grid grid-cols-2 gap-3 rounded-xl bg-muted/30 p-4 sm:grid-cols-3">{#each Object.entries(labels) as [key, label] (key)}<div><dt class="text-xs text-muted-foreground">{label}</dt><dd class="mt-1 font-semibold">{(impact.counts[key] ?? 0).toLocaleString()}건</dd></div>{/each}</dl>
  {#if impact.futureEvents > 0}<p class="rounded-lg border p-3 leading-6">앞으로 진행할 일정이 <strong>{impact.futureEvents}개</strong> 있어요. 참여자와 신청자에게 일정 변경·취소 내용을 먼저 안내해 주세요.</p>{/if}
  {#if impact.liveSessions > 0}<p role="alert" class="rounded-lg border border-destructive/30 p-3 leading-6 text-destructive">진행 중인 리딩이 있어요. 리딩을 먼저 종료해야 공연을 휴지통으로 옮길 수 있어요.</p>{/if}
  <p class="leading-7">공연을 휴지통으로 옮겨도 배정·대본·파일·기록은 남아 있어요. <strong>배우·스태프의 회원 계정과 다른 공연 배정은 삭제하지 않아요.</strong></p>
  {#if impact.deletedAt}<p class="text-xs leading-6 text-muted-foreground">복구하면 기존 참여자 연결과 공개 설정도 돌아와요. 복구 전에 일정과 참여자 안내를 확인해 주세요.</p>{/if}
  {#if impact.inquiries.length}<section class="space-y-2 border-t pt-4"><h3 class="font-semibold">연결된 공연 신청</h3><p class="text-xs leading-6 text-muted-foreground">공연을 휴지통으로 옮겨도 신청 원본과 상담 기록은 삭제되지 않아요.</p>{#each impact.inquiries as inquiry (inquiry.id)}<Button href={`/admin/inquiries/${inquiry.id}`} variant="outline" size="sm" class="mr-2">{inquiry.orgName} 신청</Button>{/each}</section>{/if}
</div>
