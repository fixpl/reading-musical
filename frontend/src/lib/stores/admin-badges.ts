import { writable } from "svelte/store";
import { apiRequest } from "$lib/api/client";
import { captureSession, isCurrentSession } from "$lib/api/session";

/**
 * 관리자 사이드바 "공연 신청 문의" 배지에 쓰는 미처리(NEW) 신청 수.
 * 문의 페이지가 목록을 불러오거나 상태를 바꿀 때마다 갱신해, 레이아웃 배지가 최신으로 유지되게 한다.
 * null = 아직 한 번도 안 불러옴.
 */
export const newInquiryCount = writable<number | null>(null);
let refreshSequence = 0;

export function setNewInquiryCount(count: number) {
  refreshSequence += 1;
  newInquiryCount.set(count);
}

export async function refreshInquiryBadge() {
  const session = captureSession();
  const sequence = ++refreshSequence;
  const result = await apiRequest<{ counts: Partial<Record<string, number>> }>("/admin/inquiries?take=1", { session });
  if (sequence === refreshSequence && isCurrentSession(session)) newInquiryCount.set(result.counts.NEW ?? 0);
}
