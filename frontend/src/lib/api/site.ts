import { getApiBaseUrl } from "$lib/api/client";
export const POLICY_LABELS = { TERMS: "이용약관", PRIVACY_POLICY: "개인정보 처리방침", SIGNUP_PRIVACY: "회원가입 개인정보 수집·이용", OPTIONAL_PROFILE: "가입 시 선택 연락처 수집·이용", PROFILE_PRIVACY: "선택 프로필 개인정보 수집·이용", MARKETING_PRIVACY: "마케팅 목적 개인정보 이용", MARKETING_EMAIL: "이메일 광고성 정보 수신", INQUIRY_PRIVACY: "문의 개인정보 수집·이용" } as const;
export type LegalKind = keyof typeof POLICY_LABELS;
export const POLICY_SLUGS: Record<LegalKind, string> = { TERMS: "terms", PRIVACY_POLICY: "privacy", SIGNUP_PRIVACY: "signup", OPTIONAL_PROFILE: "profile", PROFILE_PRIVACY: "profile-details", MARKETING_PRIVACY: "marketing-privacy", MARKETING_EMAIL: "marketing-email", INQUIRY_PRIVACY: "inquiry" };
export interface PolicySummary { id: string; kind: LegalKind; version: number; title: string; effectiveAt: string; publishedAt: string | null; purpose: string; items: string; retention: string; refusal: string }
export interface LegalDocument extends PolicySummary { body: string }
export interface SiteInfo { siteName: string; siteDescription: string; companyName: string; representative: string; businessNumber: string; onlineSalesNumber: string; address: string; supportEmail: string; supportPhone: string; supportHours: string; privacyOfficer: string; privacyEmail: string; copyrightHolder: string; copyrightStartYear: number; supportRetentionDays: number }
export interface RegistrationCatalog { policies: PolicySummary[]; ready: { signup: boolean; optionalProfile: boolean; marketing: boolean } }
export interface PublicSite { registration?: RegistrationCatalog; info: SiteInfo; policies: PolicySummary[]; setupRequired?: boolean; ready: { signup: boolean; inquiry: boolean; optionalProfile: boolean; marketing: boolean } }
export interface FaqQuestion { id: string; categoryId: string; title: string; body: string; order: number; active: boolean; revision: number }
export interface FaqCategory { id: string; name: string; order: number; active: boolean; revision: number; questions: FaqQuestion[] }
export interface SupportTicket { id: string; category: string; subject: string; message: string; answer: string | null; status: string; createdAt: string; answeredAt: string | null; expiresAt: string; userId?: string | null; contactName?: string; email?: string; internalNote?: string | null; revision?: number; privacyConsentedAt?: string; privacyDocument?: { id: string; title: string; version: number } }
export const SUPPORT_CATEGORIES: Record<string, string> = { GENERAL: "이용 문의", ACCOUNT: "회원·계정", TECHNICAL: "오류·기술 지원", PRIVACY: "개인정보·권리 행사", OTHER: "기타" };
export const SUPPORT_STATUSES: Record<string, string> = { OPEN: "접수", IN_PROGRESS: "확인 중", ANSWERED: "답변 완료", CLOSED: "종료" };
export function policyHref(doc: Pick<PolicySummary, "kind" | "id">) { return `/legal/${POLICY_SLUGS[doc.kind]}?id=${encodeURIComponent(doc.id)}`; }
export function displayPolicy(site: PublicSite | null | undefined, kind: LegalKind): PolicySummary | undefined {
  return site?.policies.find((doc) => doc.kind === kind);
}
export function koreanDate(value: string) { return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(value)); }
export class PublicApiError extends Error { constructor(public status: number) { super("공개 정보를 불러오지 못했어요."); } }
export async function publicRequest<T>(path: string, fetcher: typeof fetch = fetch): Promise<T> {
  const response = await fetcher(`${getApiBaseUrl()}${path}`, { credentials: "omit", headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new PublicApiError(response.status);
  return response.json() as Promise<T>;
}
export async function loadFaq(fetcher: typeof fetch) {
  try { return { faq: await publicRequest<FaqCategory[]>("/site/faq", fetcher), faqError: "" }; }
  catch { return { faq: [] as FaqCategory[], faqError: "자주 묻는 질문을 불러오지 못했어요. 다시 시도해 주세요." }; }
}
