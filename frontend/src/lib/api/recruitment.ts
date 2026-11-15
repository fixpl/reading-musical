import { apiRequest } from "$lib/api/client";

export type RecruitmentRole = "ACTOR" | "STAFF";
export type RecruitmentRoundStatus = "DRAFT" | "OPEN" | "CLOSED" | "CANCELLED";
export type RecruitmentApplicationStatus = "SUBMITTED" | "REVIEWING" | "ON_HOLD" | "APPROVED" | "NOT_SELECTED" | "WITHDRAWN" | "CANCELLED";
export type RecruitmentReviewStatus = "REVIEWING" | "ON_HOLD" | "APPROVED" | "NOT_SELECTED";
export type RecruitmentPosition = { id: string; role: RecruitmentRole; label: string; capacity: number; approvedCount: number };
export type RecruitmentRoundDocument = {
  title: string; summary: string; description: string; region: string;
  activityStartDate: string | null; activityEndDate: string | null;
  conditions: string; deadlineAt: string | null;
  positions: Array<{ role: RecruitmentRole; label: string; capacity: number }>;
};
export type RecruitmentRound = Omit<RecruitmentRoundDocument, "positions"> & {
  id: string; productionId: string; productionTitle: string;
  status: RecruitmentRoundStatus; effectiveStatus: RecruitmentRoundStatus;
  revision: number; createdAt: string; publishedAt: string | null;
  positions: RecruitmentPosition[];
};
export type RecruitmentApplicationEvent = {
  id: string; fromStatus: RecruitmentApplicationStatus | null; toStatus: RecruitmentApplicationStatus;
  message: string | null; createdAt: string;
};
export type RecruitmentApplication = {
  id: string; roundId: string; positionId: string; userId: string; applicantName: string;
  status: RecruitmentApplicationStatus; revision: number; message: string; availability: string;
  reviewMessage: string | null; membershipId: string | null; createdAt: string; updatedAt: string;
  position: RecruitmentPosition; round: RecruitmentRound; events: RecruitmentApplicationEvent[];
};
export type RecruitmentPage<T> = { items: T[]; total: number; offset: number; hasMore: boolean };
export type RecruitmentAccess = { canManageRecruitment: boolean; canManageSchedule: boolean };
export type RecruitmentOpportunityDetail = { round: RecruitmentRound; myApplication: RecruitmentApplication | null; eligiblePositionIds: string[] };
export type RecruitmentPagination = { limit?: number; offset?: number };
export type RecruitmentApplicationInput = { positionId: string; message: string; availability: string; expectedRevision: number };
export type RecruitmentReviewInput = { status: RecruitmentReviewStatus; expectedRevision: number; reviewMessage?: string };

type OpportunityQuery = RecruitmentPagination & { q?: string; role?: RecruitmentRole | "" };
function queryString(params: OpportunityQuery = {}) {
  const query = new URLSearchParams();
  if (params.q?.trim()) query.set("q", params.q.trim());
  if (params.role) query.set("role", params.role);
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.offset !== undefined) query.set("offset", String(params.offset));
  return query.size ? `?${query}` : "";
}
const roundPath = (pid: string) => `/productions/${encodeURIComponent(pid)}/recruitment/rounds`;
const revisionBody = (expectedRevision: number): RequestInit => ({ method: "POST", body: JSON.stringify({ expectedRevision }) });

export function listRecruitmentOpportunities(params: OpportunityQuery = {}, signal?: AbortSignal) {
  return apiRequest<RecruitmentPage<RecruitmentRound>>(`/recruitment/opportunities${queryString(params)}`, { signal });
}
export function getRecruitmentOpportunity(id: string, signal?: AbortSignal) {
  return apiRequest<RecruitmentOpportunityDetail>(`/recruitment/opportunities/${encodeURIComponent(id)}`, { signal });
}
export function submitRecruitmentApplication(id: string, input: RecruitmentApplicationInput) {
  return apiRequest<RecruitmentApplication>(`/recruitment/opportunities/${encodeURIComponent(id)}/applications`, { method: "POST", body: JSON.stringify(input) });
}
export function listMyRecruitmentApplications(params: RecruitmentPagination = {}, signal?: AbortSignal) {
  return apiRequest<RecruitmentPage<RecruitmentApplication>>(`/recruitment/applications/me${queryString(params)}`, { signal });
}
export function withdrawRecruitmentApplication(id: string, expectedRevision: number) {
  return apiRequest<RecruitmentApplication>(`/recruitment/applications/${encodeURIComponent(id)}/withdraw`, revisionBody(expectedRevision));
}
export function getRecruitmentAccess(pid: string) {
  return apiRequest<RecruitmentAccess>(`/productions/${encodeURIComponent(pid)}/recruitment/access`);
}
export function listRecruitmentRounds(pid: string, params: RecruitmentPagination = {}) {
  return apiRequest<RecruitmentPage<RecruitmentRound>>(`${roundPath(pid)}${queryString(params)}`);
}
export function createRecruitmentRound(pid: string, document: RecruitmentRoundDocument) {
  return apiRequest<RecruitmentRound>(roundPath(pid), { method: "POST", body: JSON.stringify(document) });
}
export function updateRecruitmentRound(pid: string, rid: string, expectedRevision: number, document: RecruitmentRoundDocument) {
  return apiRequest<RecruitmentRound>(`${roundPath(pid)}/${encodeURIComponent(rid)}`, { method: "PUT", body: JSON.stringify({ ...document, expectedRevision }) });
}
export function publishRecruitmentRound(pid: string, rid: string, expectedRevision: number) {
  return apiRequest<RecruitmentRound>(`${roundPath(pid)}/${encodeURIComponent(rid)}/publish`, revisionBody(expectedRevision));
}
export function closeRecruitmentRound(pid: string, rid: string, expectedRevision: number) {
  return apiRequest<RecruitmentRound>(`${roundPath(pid)}/${encodeURIComponent(rid)}/close`, revisionBody(expectedRevision));
}
export function cancelRecruitmentRound(pid: string, rid: string, expectedRevision: number) {
  return apiRequest<RecruitmentRound>(`${roundPath(pid)}/${encodeURIComponent(rid)}/cancel`, revisionBody(expectedRevision));
}
export function listRoundApplications(pid: string, rid: string, params: RecruitmentPagination = {}) {
  return apiRequest<RecruitmentPage<RecruitmentApplication>>(`${roundPath(pid)}/${encodeURIComponent(rid)}/applications${queryString(params)}`);
}
export function reviewRecruitmentApplication(pid: string, rid: string, aid: string, input: RecruitmentReviewInput) {
  return apiRequest<RecruitmentApplication>(`${roundPath(pid)}/${encodeURIComponent(rid)}/applications/${encodeURIComponent(aid)}/review`, { method: "POST", body: JSON.stringify(input) });
}
