import { anonymousJsonPost } from "./client";
export const INQUIRY_LABELS: Record<string, string> = { NEW: "접수", IN_REVIEW: "상담 중", REPLIED: "답변 완료", CONVERTED: "공연 연결", CLOSED: "종료" };
export interface InquiryMessage { id: string; authorKind: string; body: string; public?: boolean; createdAt: string }
export interface InquirySource { channel: string; page?: string | null; campaign?: string | null; referrerHost?: string | null }
export interface ManagedInquiry {
  id: string; revision: number; orgName: string; contactName: string; email: string; phone: string | null;
  preferredTiming: string | null; audience: string | null; message: string; status: string; adminNote: string | null; planningNote: string | null;
  source?: InquirySource | null; createdAt: string; updatedAt: string; messages: InquiryMessage[];
  handledBy: { id: string; name: string } | null;
  production: { id: string; title: string; deletedAt: string | null; archived: boolean } | null;
}
export interface ApplicantInquiry { id: string; orgName: string; contactName: string; email: string; phone: string | null; preferredTiming: string | null; audience: string | null; message: string; status: string; statusLabel: string; createdAt: string; updatedAt: string; messages: InquiryMessage[]; sessionExpiresAt: string }
export class InquiryLookupError extends Error { constructor(message: string, public status: number) { super(message); } }
// 문의 전용 토큰은 회원 token과 분리하고 URL·cookie·브라우저 저장소에 남기지 않는다.
export async function inquiryLookup<T>(action: string, body: Record<string, unknown>): Promise<T> {
  const response = await anonymousJsonPost(`/inquiries/lookup/${action}`, body, { signal: AbortSignal.timeout(20000) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new InquiryLookupError(typeof data?.message === "string" ? data.message : "요청을 처리하지 못했어요. 다시 시도해 주세요.", response.status);
  return data as T;
}
