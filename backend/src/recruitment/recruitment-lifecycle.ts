import type { Prisma } from "@prisma/client";
import { ConflictException } from "@nestjs/common";
import { recruitmentNotificationData, UNPROCESSED_APPLICATION_STATUSES } from "./recruitment-events";

/** 호출자는 같은 transaction에서 production 행을 먼저 잠가야 한다. */
export async function cancelRoundApplications(tx: Prisma.TransactionClient, roundId: string, productionId: string, actorId: string) {
  const pending = await tx.recruitmentApplication.findMany({
    where: { roundId, status: { in: UNPROCESSED_APPLICATION_STATUSES } },
    select: { id: true, userId: true, status: true, revision: true }
  });
  if (!pending.length) return 0;
  const updated = await tx.recruitmentApplication.updateMany({
    where: { id: { in: pending.map(item => item.id) }, status: { in: UNPROCESSED_APPLICATION_STATUSES } },
    data: { status: "CANCELLED", revision: { increment: 1 } }
  });
  if (updated.count !== pending.length) throw new ConflictException("모집 상태가 바뀌었어요. 최신 상태를 확인해 주세요");
  // 지원자 수만큼 왕복하지 않고 상태·이력·알림을 각각 일괄 기록한다.
  await tx.recruitmentApplicationEvent.createMany({ data: pending.map(item => ({
    applicationId: item.id, actorId, fromStatus: item.status, toStatus: "CANCELLED", revision: item.revision + 1, message: null
  })) });
  await tx.notification.createMany({ data: pending.map(item => recruitmentNotificationData(item.userId, productionId, "CANCELLED")) });
  return pending.length;
}

/** 공연 삭제·보관과 같은 커밋에서 모집만 종료한다. 승인된 멤버와 다른 역할은 유지한다. */
export async function cancelProductionRecruitments(tx: Prisma.TransactionClient, productionId: string, actorId: string): Promise<{ rounds: number; applications: number }> {
  const rounds = await tx.recruitmentRound.findMany({ where: { productionId, status: { in: ["OPEN", "CLOSED"] } }, select: { id: true } });
  let applications = 0;
  for (const round of rounds) {
    await tx.recruitmentRound.update({ where: { id: round.id }, data: { status: "CANCELLED", revision: { increment: 1 } } });
    applications += await cancelRoundApplications(tx, round.id, productionId, actorId);
  }
  return { rounds: rounds.length, applications };
}
