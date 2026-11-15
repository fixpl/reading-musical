import { BadRequestException, ConflictException } from "@nestjs/common";

export function inquirySource(input: { sourcePage?: string; sourceCampaign?: string; referrerHost?: string }) {
  // Never persist arbitrary URL queries, access tokens, or purported tracking identities.
  const page = input.sourcePage?.split(/[?#]/, 1)[0] ?? "";
  const safePage = /^\/(?!\/)[A-Za-z0-9/_%.-]{0,299}$/.test(page) && !page.includes("..") ? page : null;
  const campaign = input.sourceCampaign?.trim();
  const host = input.referrerHost?.toLowerCase();
  return { channel: "WEB", page: safePage, campaign: campaign && /^[A-Za-z0-9_-]{1,80}$/.test(campaign) ? campaign : null,
    referrerHost: host && /^[a-z0-9.-]{1,200}$/.test(host) ? host : null, verified: false };
}
export function assertInquiryRevision(actual: number, expected: number) {
  if (!Number.isInteger(expected) || actual !== expected) throw new ConflictException("다른 작업에서 신청이 변경되었습니다. 최신 내용을 불러온 뒤 다시 저장해 주세요.");
}
export function requireInquiryText(text: string | undefined, name: string) {
  if (!text?.trim()) throw new BadRequestException(`${name}을 입력해 주세요.`);
  return text.trim();
}
export const APPLICANT_STATUS_LABELS: Record<string, string> = {
  NEW: "접수 완료", IN_REVIEW: "상담 중", REPLIED: "운영팀 답변 등록", CONVERTED: "공연 준비 중", CLOSED: "상담 종료"
};
