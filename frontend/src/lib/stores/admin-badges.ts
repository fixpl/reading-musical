import { writable } from "svelte/store";

/**
 * 관리자 사이드바 "공연 신청 문의" 배지에 쓰는 미처리(NEW) 신청 수.
 * 문의 페이지가 목록을 불러오거나 상태를 바꿀 때마다 갱신해, 레이아웃 배지가 최신으로 유지되게 한다.
 * null = 아직 한 번도 안 불러옴.
 */
export const newInquiryCount = writable<number | null>(null);
