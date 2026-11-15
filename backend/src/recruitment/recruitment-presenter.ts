import type { RecruitmentApplication, RecruitmentApplicationEvent, RecruitmentApplicationStatus, RecruitmentPosition, RecruitmentRound } from "@prisma/client";
import { UNPROCESSED_APPLICATION_STATUSES } from "./recruitment-events";

type PositionView = Pick<RecruitmentPosition, "id" | "role" | "label" | "capacity"> & { _count: { applications: number } };
type RoundView = Pick<RecruitmentRound,
  "id" | "productionId" | "title" | "summary" | "description" | "region" | "activityStartDate" | "activityEndDate" |
  "conditions" | "deadlineAt" | "status" | "revision" | "createdAt" | "publishedAt"
> & { production: { title: string }; positions: PositionView[] };
type ApplicationView = Pick<RecruitmentApplication,
  "id" | "roundId" | "positionId" | "userId" | "status" | "revision" | "message" | "availability" |
  "reviewMessage" | "membershipId" | "createdAt" | "updatedAt"
> & { user: { name: string }; position: PositionView; round: RoundView;
  events: Array<Pick<RecruitmentApplicationEvent, "id" | "fromStatus" | "toStatus" | "message" | "createdAt">> };

/** 한 응답의 지원 가능 여부와 표시 상태는 호출자가 전달한 같은 시각으로 계산한다. */
export function isRecruitmentOpen(round: Pick<RecruitmentRound, "status" | "deadlineAt">, now: Date) {
  return round.status === "OPEN" && (!round.deadlineAt || round.deadlineAt.getTime() > now.getTime());
}

export function isRecruitmentApplicationPending(status: RecruitmentApplicationStatus) {
  return UNPROCESSED_APPLICATION_STATUSES.includes(status);
}

export function presentRecruitmentPosition(position: PositionView) {
  return { id: position.id, role: position.role, label: position.label, capacity: position.capacity, approvedCount: position._count.applications };
}

/** DB 행을 펼치지 않고 모집 화면에 필요한 필드만 응답한다. */
export function presentRecruitmentRound(round: RoundView, now: Date) {
  return { id: round.id, productionId: round.productionId, productionTitle: round.production.title,
    title: round.title, summary: round.summary, description: round.description, region: round.region,
    activityStartDate: round.activityStartDate?.toISOString().slice(0, 10) ?? null, activityEndDate: round.activityEndDate?.toISOString().slice(0, 10) ?? null,
    conditions: round.conditions, deadlineAt: round.deadlineAt?.toISOString() ?? null, status: round.status,
    effectiveStatus: round.status === "OPEN" && !isRecruitmentOpen(round, now) ? "CLOSED" : round.status,
    revision: round.revision, createdAt: round.createdAt.toISOString(), publishedAt: round.publishedAt?.toISOString() ?? null,
    positions: round.positions.map(presentRecruitmentPosition) };
}

/** 지원자 연락처와 심사자 식별자는 모집 응답에 포함하지 않는다. */
export function presentRecruitmentApplication(application: ApplicationView, now: Date) {
  return { id: application.id, roundId: application.roundId, positionId: application.positionId, userId: application.userId,
    applicantName: application.user.name, status: application.status, revision: application.revision,
    message: application.message, availability: application.availability, reviewMessage: application.reviewMessage,
    membershipId: application.membershipId, createdAt: application.createdAt.toISOString(), updatedAt: application.updatedAt.toISOString(),
    position: presentRecruitmentPosition(application.position), round: presentRecruitmentRound(application.round, now),
    events: application.events.map(event => ({ id: event.id, fromStatus: event.fromStatus, toStatus: event.toStatus, message: event.message, createdAt: event.createdAt.toISOString() })) };
}
