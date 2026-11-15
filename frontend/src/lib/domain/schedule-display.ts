import { formatDateTime } from "./labels";

export type ScheduleConflict = {
  userId: string;
  userName: string;
  type: "AVAILABILITY" | "EVENT";
  reason: string;
  startAt: string;
  endAt: string;
};

export function groupScheduleConflicts(conflicts: readonly ScheduleConflict[]) {
  const groups = new Map<string, { key: string; userName: string; labels: string[]; details: string[] }>();
  for (const conflict of conflicts) {
    const key = conflict.userId;
    const group = groups.get(key) ?? { key, userName: conflict.userName, labels: [], details: [] };
    const label = conflict.type === "AVAILABILITY" ? "개인 일정" : "공연 일정";
    if (!group.labels.includes(label)) group.labels.push(label);
    // 일반 충돌 문구는 유형 라벨과 중복되므로 시간과 실제 사유만 표시해요.
    const reason = conflict.reason.trim();
    const detail = `${formatDateTime(conflict.startAt)} ~ ${formatDateTime(conflict.endAt)}${reason && reason !== `${label}과 겹침` && reason !== "다른 공연 일정과 겹침" && reason !== label ? ` · ${reason}` : ""}`;
    if (!group.details.includes(detail)) group.details.push(detail);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function meetingHttpUrl(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function scheduleAttendanceSummary(attendances: readonly { status: string }[]) {
  const count = (status: string) => attendances.filter((attendance) => attendance.status === status).length;
  return `참석 ${count("ACCEPTED")} · 불참 ${count("DECLINED")} · 미정 ${count("TENTATIVE")} · 미응답 ${count("INVITED")} / ${attendances.length}`;
}
