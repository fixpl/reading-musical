import type { RecruitmentApplicationStatus, RecruitmentRole, RecruitmentRoundStatus } from "$lib/api/recruitment";

export const RECRUITMENT_ROLE_LABELS: Record<RecruitmentRole, string> = { ACTOR: "배우", STAFF: "스태프" };
export const RECRUITMENT_ROUND_LABELS: Record<RecruitmentRoundStatus, string> = { DRAFT: "모집 준비", OPEN: "접수 중", CLOSED: "접수 마감", CANCELLED: "모집 취소" };
export const RECRUITMENT_APPLICATION_LABELS: Record<RecruitmentApplicationStatus, string> = {
  SUBMITTED: "지원 접수됨", REVIEWING: "검토 중", ON_HOLD: "추가 검토 중", APPROVED: "참여 확정",
  NOT_SELECTED: "이번 모집 미선정", WITHDRAWN: "지원 취소", CANCELLED: "모집 취소"
};
export function isPendingRecruitmentApplication(status: RecruitmentApplicationStatus) {
  return status === "SUBMITTED" || status === "REVIEWING" || status === "ON_HOLD";
}
export function recruitmentDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "미정";
  const [year, month, day] = value.split("-").map(Number);
  return `${year}.${month}.${day}`;
}
export function recruitmentPeriod(start: string | null, end: string | null) {
  if (!start && !end) return "참여 기간 미정";
  if (start && start === end) return recruitmentDate(start);
  return `${recruitmentDate(start)} ~ ${recruitmentDate(end)}`;
}
export function recruitmentDateTime(value: string | null) {
  if (!value) return "마감일 미정";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "날짜 확인 필요";
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", hour12: false }).format(date);
}
export function recruitmentApplicationGuidance(status: RecruitmentApplicationStatus, membershipId?: string | null) {
  switch (status) {
    case "SUBMITTED": return "지원서를 보냈어요. 공연팀이 확인한 뒤 결과를 알려드려요.";
    case "REVIEWING": return "공연팀이 지원서를 확인하고 있어요. 아직 참여가 확정되지 않았어요.";
    case "ON_HOLD": return "공연팀이 추가로 검토하고 있어요. 아직 참여가 확정되지 않았어요.";
    case "APPROVED": return membershipId === null ? "참여 승인 내역은 남아 있어요. 현재 참여 상태는 공연팀에 확인해 주세요." : "공연팀에 연결됐어요. 배역이나 담당 직무는 공연팀에서 따로 안내해요.";
    case "NOT_SELECTED": return "이번 모집에서는 함께하지 못하게 됐어요. 다른 모집에 지원할 수 있어요.";
    case "WITHDRAWN": return "지원이 취소됐어요. 접수 중인 모집에는 다시 지원할 수 있어요.";
    case "CANCELLED": return "모집이 취소되어 지원 검토가 종료됐어요.";
  }
}
export function recruitmentTone(status: RecruitmentApplicationStatus | RecruitmentRoundStatus) {
  if (status === "APPROVED" || status === "OPEN") return "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300";
  if (status === "SUBMITTED" || status === "REVIEWING" || status === "ON_HOLD") return "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300";
  return "border-border bg-muted text-muted-foreground";
}
