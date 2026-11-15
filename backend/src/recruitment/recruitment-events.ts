import type { Prisma, RecruitmentApplicationStatus } from "@prisma/client";

export const UNPROCESSED_APPLICATION_STATUSES: RecruitmentApplicationStatus[] = ["SUBMITTED", "REVIEWING", "ON_HOLD"];
const PRESENTATION: Record<RecruitmentApplicationStatus, { title: string; body: string }> = {
  SUBMITTED: { title: "지원이 접수됐어요", body: "제작진이 지원 내용을 확인해요. 내 지원 현황에서 진행 상황을 볼 수 있어요." },
  REVIEWING: { title: "지원을 검토하고 있어요", body: "제작진이 지원 내용을 검토 중이에요." },
  ON_HOLD: { title: "추가 검토 중이에요", body: "아직 참여가 확정되지 않았어요. 내 지원 현황에서 안내를 확인해 주세요." },
  APPROVED: { title: "공연 참여가 확정됐어요", body: "공연팀에 연결됐어요. 배역과 담당 업무는 제작진과 별도로 확인해 주세요." },
  NOT_SELECTED: { title: "이번 모집 결과를 확인해 주세요", body: "이번 모집에서는 참여가 확정되지 않았어요. 내 지원 현황에서 안내를 확인해 주세요." },
  WITHDRAWN: { title: "지원을 취소했어요", body: "접수 중인 모집에는 다시 지원할 수 있어요." },
  CANCELLED: { title: "모집이 취소됐어요", body: "지원한 모집이 취소되어 지원 검토를 종료했어요." }
};

export function recruitmentNotificationData(userId: string, productionId: string, status: RecruitmentApplicationStatus) {
  return { userId, productionId, type: "RECRUITMENT_APPLICATION_UPDATED", payload: {
    ...PRESENTATION[status], href: status === "APPROVED" ? `/app/p/${productionId}` : "/app/applications"
  } };
}

export async function recordRecruitmentTransition(tx: Prisma.TransactionClient, input: {
  applicationId: string; productionId: string; userId: string; actorId: string;
  fromStatus: RecruitmentApplicationStatus | null; toStatus: RecruitmentApplicationStatus;
  revision: number; message?: string | null;
}) {
  await tx.recruitmentApplicationEvent.create({ data: {
    applicationId: input.applicationId, actorId: input.actorId, fromStatus: input.fromStatus,
    toStatus: input.toStatus, revision: input.revision, message: input.message ?? null
  } });
  // 메일이나 transaction 밖의 알림 생성 없이 지원 상태와 같은 커밋에 기록한다.
  await tx.notification.create({ data: recruitmentNotificationData(input.userId, input.productionId, input.toStatus) });
}
