export const PROFILE_TYPE_LABELS: Record<string, string> = {
  ACTOR: "배우",
  STAFF: "스태프",
  DIRECTOR: "연출",
  MUSIC_DIRECTOR: "음악감독",
  STAGE_MANAGER: "무대감독",
  PLANNER: "기획",
  OTHER: "기타"
};

export const PHASE_LABELS: Record<string, string> = {
  PLANNING: "기획",
  READING: "리딩",
  REHEARSAL: "리허설",
  PERFORMANCE: "공연"
};

export const VISIBILITY_LABELS: Record<string, string> = {
  DRAFT: "준비중",
  PUBLISHED: "공개"
};

export const USER_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "활성",
  INACTIVE: "휴면",
  BLOCKED: "차단"
};

export const INQUIRY_STATUS_LABELS: Record<string, string> = {
  NEW: "신규",
  IN_REVIEW: "검토중",
  REPLIED: "회신완료",
  CONVERTED: "공연 전환",
  CLOSED: "종료"
};

export const PRODUCTION_ROLE_LABELS: Record<string, string> = {
  PRODUCER: "기획",
  DIRECTOR: "연출",
  MUSIC_DIRECTOR: "음악감독",
  STAGE_MANAGER: "무대감독",
  ACTOR: "배우",
  STAFF: "스태프",
  GUEST: "게스트"
};

export const STAFF_DISCIPLINE_LABELS: Record<string, string> = {
  SOUND: "음향",
  LIGHTING: "조명",
  STAGE_CREW: "무대",
  PROPS: "소품",
  COSTUME: "의상",
  MAKEUP: "분장",
  VIDEO: "영상",
  FRONT_OF_HOUSE: "프론트",
  PRODUCTION_ASSISTANT: "진행",
  ACCOMPANIST: "반주",
  OTHER: "기타"
};

export const CAST_ASSIGNMENT_KIND_LABELS: Record<string, string> = {
  MAIN: "주연",
  DOUBLE: "더블",
  UNDERSTUDY: "언더"
};

export const EVENT_TYPE_LABELS: Record<string, string> = {
  READING: "리딩",
  MUSIC_PRACTICE: "음악연습",
  REHEARSAL: "리허설",
  ENSEMBLE: "전체연습",
  PERFORMANCE: "공연"
};

export function formatDate(value: string | Date | null | undefined) {
  if (!value) return "-";
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
}

export function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return "-";
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleString("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function formatRelative(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일 전`;
  return formatDate(date);
}
