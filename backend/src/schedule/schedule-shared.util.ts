import type { Prisma } from "@prisma/client";
import { AttendanceStatus } from "@prisma/client";

/** schedule 모듈 전체(핵심 서비스 + 알림 서비스)가 공유하는 순수 포맷터/유틸. */

export function attendanceStatusLabel(status: AttendanceStatus): string {
  switch (status) {
    case AttendanceStatus.ACCEPTED:
      return "참석";
    case AttendanceStatus.DECLINED:
      return "불참";
    case AttendanceStatus.TENTATIVE:
      return "미정";
    case AttendanceStatus.INVITED:
    default:
      return "응답 대기";
  }
}

export function formatKoreanDateTime(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

export function clampedReminderHours(value: number): number {
  if (!Number.isFinite(value)) {
    return 24;
  }
  return Math.min(168, Math.max(1, Math.floor(value)));
}

export function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
