import { apiRequest } from "$lib/api/client";
import { publicRequest } from "$lib/api/site";
import type { ClientSession } from "$lib/api/session";

export const CREDIT_NOTICE_VERSION = "2026-10-23";
export type ShowcaseDocument = {
  title: string;
  synopsis: string;
  description: string;
  venue: string;
  startDate: string | null;
  endDate: string | null;
  posterAssetId: string | null;
  officialUrl: string;
  ticketUrl: string;
  videoUrl: string;
  gallery: Array<{ assetId: string; caption: string }>;
};
export type ShowcaseEditor = {
  productionId: string;
  revision: number;
  draft: ShowcaseDocument;
  published: ShowcaseDocument | null;
  publishedAt: string | null;
  hasDraftChanges: boolean;
  publicPath: string;
  posterUrl: string | null;
  gallery: Array<{ assetId: string; url: string; caption: string }>;
};
export type ShowcaseSummary = {
  productionId: string;
  posterUrl: string | null;
  officialUrl: string;
  publishedAt: string | null;
  hasDraftChanges: boolean;
  publicPath: string;
};
export type PublicPerformance = {
  slug: string;
  title: string;
  synopsis: string;
  venue: string;
  startDate: string | null;
  endDate: string | null;
  posterUrl: string | null;
};
export type PublicPerformanceDetail = PublicPerformance & {
  description: string;
  officialUrl: string;
  ticketUrl: string;
  videoUrl: string;
  gallery: Array<{ url: string; caption: string }>;
  cast: Array<{ displayName: string; roles: string[]; photoUrl: string | null }>;
};
export type MyPerformanceCredit = {
  productionId: string;
  productionTitle: string;
  revision: number;
  displayName: string;
  showName: boolean;
  showPhoto: boolean;
  eligible: boolean;
  roles: string[];
  photoUrl: string | null;
  hasProfilePhoto: boolean;
  photoNeedsConfirmation?: boolean;
  photoToken: string | null;
  published: boolean;
  noticeVersion: string;
};
export type CreditUpdate = Pick<MyPerformanceCredit, "displayName" | "showName" | "showPhoto"> & {
  expectedRevision: number;
  noticeVersion: string;
  expectedPhotoToken?: string | null;
};

const editorPath = (productionId: string) => `/productions/${encodeURIComponent(productionId)}/showcase`;
type ShowcaseRequestOptions = { session?: ClientSession };

export function loadShowcaseEditor(productionId: string, options: ShowcaseRequestOptions = {}) {
  return apiRequest<ShowcaseEditor>(editorPath(productionId), options);
}
export function saveShowcaseDraft(productionId: string, expectedRevision: number, draft: ShowcaseDocument, options: ShowcaseRequestOptions = {}) {
  return apiRequest<ShowcaseEditor>(editorPath(productionId), { ...options, method: "PUT", body: JSON.stringify({ expectedRevision, draft }) });
}
export function publishShowcase(productionId: string, expectedRevision: number, options: ShowcaseRequestOptions = {}) {
  return apiRequest<ShowcaseEditor>(`${editorPath(productionId)}/publish`, { ...options, method: "POST", body: JSON.stringify({ expectedRevision }) });
}
export function unpublishShowcase(productionId: string, expectedRevision: number, options: ShowcaseRequestOptions = {}) {
  return apiRequest<ShowcaseEditor>(`${editorPath(productionId)}/unpublish`, { ...options, method: "POST", body: JSON.stringify({ expectedRevision }) });
}

/** 저장 응답을 놓친 뒤 다시 조회할 때 순서를 포함한 문서 내용으로 저장 여부를 판정한다. */
export function showcaseDocumentsEqual(left: ShowcaseDocument, right: ShowcaseDocument) {
  const fields = ["title", "synopsis", "description", "venue", "startDate", "endDate", "posterAssetId", "officialUrl", "ticketUrl", "videoUrl"] as const;
  return fields.every((field) => left[field] === right[field])
    && left.gallery.length === right.gallery.length
    && left.gallery.every((item, index) => item.assetId === right.gallery[index].assetId && item.caption === right.gallery[index].caption);
}
export function loadShowcaseSummaries() {
  return apiRequest<{ items: ShowcaseSummary[] }>("/admin/production-showcases");
}
export function loadMyPerformanceCredits() {
  return apiRequest<{ items: MyPerformanceCredit[] }>("/showcase/me/credits");
}
export function updateMyPerformanceCredit(productionId: string, update: CreditUpdate) {
  return apiRequest<MyPerformanceCredit>(`/showcase/me/credits/${encodeURIComponent(productionId)}`, { method: "PUT", body: JSON.stringify(update) });
}
export type PublicPerformanceList = { items: PublicPerformance[]; total: number; hasMore: boolean; offset: number };
export function loadPublicPerformances(fetcher: typeof fetch = fetch, limit = 6, offset = 0) {
  return publicRequest<PublicPerformanceList>(`/public/performances?limit=${limit}&offset=${offset}`, fetcher);
}
export function loadPublicPerformance(slug: string, fetcher: typeof fetch = fetch) {
  return publicRequest<PublicPerformanceDetail>(`/public/performances/${encodeURIComponent(slug)}`, fetcher);
}

export function performanceDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "미정";
  const [year, month, day] = value.split("-").map(Number);
  return `${year}.${month}.${day}`;
}
export function performancePeriod(startDate: string | null, endDate: string | null) {
  if (!startDate && !endDate) return "공연 날짜 미정";
  if (startDate && startDate === endDate) return performanceDate(startDate);
  return `${performanceDate(startDate)} — ${performanceDate(endDate)}`;
}
export function performanceStatus(performance: Pick<PublicPerformance, "startDate" | "endDate">, today: string) {
  if (performance.endDate && performance.endDate < today) return "종료";
  if (performance.startDate && performance.startDate > today) return "공연 예정";
  if (performance.startDate && performance.endDate && performance.startDate <= today && today <= performance.endDate) return "공연 중";
  return "공연 안내";
}
export function todayInSeoul() {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function safeHttpsLink(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}
