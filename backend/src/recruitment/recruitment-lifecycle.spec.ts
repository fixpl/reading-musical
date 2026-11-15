import { cancelProductionRecruitments } from "./recruitment-lifecycle";

const productionId = "production";
const actorId = "operator";

function fixture() {
  let state = {
    production: { id: productionId, archived: false },
    rounds: [
      { id: "open", productionId, status: "OPEN", revision: 2 },
      { id: "closed", productionId, status: "CLOSED", revision: 3 },
      { id: "draft", productionId, status: "DRAFT", revision: 1 },
      { id: "cancelled", productionId, status: "CANCELLED", revision: 4 },
      { id: "other-production", productionId: "other", status: "OPEN", revision: 1 }
    ],
    applications: [
      { id: "submitted", roundId: "open", userId: "a", status: "SUBMITTED", revision: 1 },
      { id: "reviewing", roundId: "open", userId: "b", status: "REVIEWING", revision: 2 },
      { id: "on-hold", roundId: "closed", userId: "c", status: "ON_HOLD", revision: 3 },
      { id: "approved", roundId: "open", userId: "d", status: "APPROVED", revision: 4 },
      { id: "not-selected", roundId: "closed", userId: "e", status: "NOT_SELECTED", revision: 5 },
      { id: "withdrawn", roundId: "open", userId: "f", status: "WITHDRAWN", revision: 6 },
      { id: "cancelled-application", roundId: "closed", userId: "g", status: "CANCELLED", revision: 7 },
      { id: "draft-application", roundId: "draft", userId: "h", status: "SUBMITTED", revision: 1 },
      { id: "other-application", roundId: "other-production", userId: "i", status: "SUBMITTED", revision: 1 }
    ],
    events: [] as any[], notifications: [] as any[],
    memberships: [{ id: "approved-membership", userId: "d", productionId, primaryRole: "DIRECTOR" }],
    roles: [{ membershipId: "approved-membership", role: "DIRECTOR" }, { membershipId: "approved-membership", role: "ACTOR" }]
  };
  const untouched = { deleteMany: jest.fn(), updateMany: jest.fn(), create: jest.fn() };
  const tx = {
    recruitmentRound: {
      findMany: jest.fn(async ({ where }: any) => structuredClone(state.rounds.filter((row) => row.productionId === where.productionId && where.status.in.includes(row.status)))),
      update: jest.fn(async ({ where, data }: any) => {
        const row = state.rounds.find((value) => value.id === where.id)!; Object.assign(row, { status: data.status, revision: row.revision + data.revision.increment }); return row;
      })
    },
    recruitmentApplication: {
      findMany: jest.fn(async ({ where }: any) => structuredClone(state.applications.filter((row) => row.roundId === where.roundId && where.status.in.includes(row.status)))),
      update: jest.fn(async ({ where, data }: any) => {
        const row = state.applications.find((value) => value.id === where.id)!; Object.assign(row, { status: data.status, revision: row.revision + data.revision.increment }); return row;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const selected = state.applications.filter((row) => where.id.in.includes(row.id) && where.status.in.includes(row.status));
        selected.forEach((row) => Object.assign(row, { status: data.status, revision: row.revision + data.revision.increment }));
        return { count: selected.length };
      })
    },
    recruitmentApplicationEvent: { createMany: jest.fn(async ({ data }: any) => { data.forEach((row: any) => state.events.push({ id: `event-${state.events.length}`, ...row })); return { count: data.length }; }) },
    notification: { createMany: jest.fn(async ({ data }: any) => { data.forEach((row: any) => state.notifications.push({ id: `notification-${state.notifications.length}`, ...row })); return { count: data.length }; }) },
    membership: untouched, membershipRole: untouched, emailDelivery: untouched,
    $transaction: jest.fn(), $queryRaw: jest.fn()
  };
  // 호출자의 transaction rollback을 모사한다. 실제 PostgreSQL 원자성·잠금은 별도 통합 검증 대상이다.
  const inTransaction = async (callback: () => Promise<unknown>) => {
    const original = structuredClone(state);
    try { return await callback(); } catch (error) { state = original; throw error; }
  };
  const cancel = () => cancelProductionRecruitments(tx as never, productionId, actorId);
  return { tx, cancel, inTransaction, get state() { return state; } };
}

describe("공연 삭제·보관의 모집 종료", () => {
  test("해당 공연 OPEN/CLOSED의 미처리 지원만 종료하고 회차·지원 revision과 이력·인앱 알림을 함께 기록한다", async () => {
    const f = fixture();
    expect(await f.cancel()).toEqual({ rounds: 2, applications: 3 });
    expect(f.state.rounds.filter((row) => ["open", "closed"].includes(row.id))).toEqual([
      expect.objectContaining({ status: "CANCELLED", revision: 3 }), expect.objectContaining({ status: "CANCELLED", revision: 4 })
    ]);
    expect(f.state.applications.slice(0, 3)).toEqual([
      expect.objectContaining({ status: "CANCELLED", revision: 2 }), expect.objectContaining({ status: "CANCELLED", revision: 3 }), expect.objectContaining({ status: "CANCELLED", revision: 4 })
    ]);
    expect(f.state.events.map((row) => ({ fromStatus: row.fromStatus, toStatus: row.toStatus, revision: row.revision, actorId: row.actorId }))).toEqual([
      { fromStatus: "SUBMITTED", toStatus: "CANCELLED", revision: 2, actorId },
      { fromStatus: "REVIEWING", toStatus: "CANCELLED", revision: 3, actorId },
      { fromStatus: "ON_HOLD", toStatus: "CANCELLED", revision: 4, actorId }
    ]);
    expect(f.state.notifications).toHaveLength(3);
    expect(f.state.notifications.map((row) => row.userId).sort()).toEqual(["a", "b", "c"]);
    for (const notification of f.state.notifications) expect(notification).toMatchObject({ productionId, type: "RECRUITMENT_APPLICATION_UPDATED", payload: { title: expect.any(String), body: expect.any(String), href: "/app/applications" } });
    expect(f.tx.$transaction).not.toHaveBeenCalled(); expect(f.tx.$queryRaw).not.toHaveBeenCalled();
    expect(f.tx.emailDelivery.create).not.toHaveBeenCalled();
    expect(f.tx.recruitmentApplication.update).not.toHaveBeenCalled();
    expect(f.tx.recruitmentApplication.updateMany).toHaveBeenCalledTimes(2);
    expect(f.tx.recruitmentApplicationEvent.createMany).toHaveBeenCalledTimes(2);
    expect(f.tx.notification.createMany).toHaveBeenCalledTimes(2);
  });

  test("승인 멤버·기존 역할·종결 지원·초안과 다른 공연 모집을 보존한다", async () => {
    const f = fixture();
    const original = structuredClone({ memberships: f.state.memberships, roles: f.state.roles, applications: f.state.applications.slice(3), rounds: f.state.rounds.slice(2) });
    await f.cancel();
    expect({ memberships: f.state.memberships, roles: f.state.roles, applications: f.state.applications.slice(3), rounds: f.state.rounds.slice(2) }).toEqual(original);
    expect(f.tx.membership.deleteMany).not.toHaveBeenCalled(); expect(f.tx.membershipRole.updateMany).not.toHaveBeenCalled();
  });

  test("같은 공연 종료를 다시 호출해도 이력·알림·revision을 중복 변경하지 않는다", async () => {
    const f = fixture(); await f.cancel(); const original = structuredClone(f.state);
    expect(await f.cancel()).toEqual({ rounds: 0, applications: 0 });
    expect(f.state).toEqual(original);
  });

  test("미처리 지원이 없으면 이력·알림 일괄 쓰기를 생성하지 않는다", async () => {
    const f = fixture(); f.state.applications.forEach((row) => row.status = "APPROVED");
    expect(await f.cancel()).toEqual({ rounds: 2, applications: 0 });
    expect(f.tx.recruitmentApplication.updateMany).not.toHaveBeenCalled();
    expect(f.tx.recruitmentApplicationEvent.createMany).not.toHaveBeenCalled();
    expect(f.tx.notification.createMany).not.toHaveBeenCalled();
  });

  test("일괄 변경 개수가 조회한 미처리 수와 다르면 이력·알림을 만들지 않고 호출자 transaction을 되돌린다", async () => {
    const f = fixture(); const original = structuredClone(f.state);
    f.tx.recruitmentApplication.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(f.inTransaction(f.cancel)).rejects.toMatchObject({ status: 409 });
    expect(f.state).toEqual(original);
    expect(f.tx.recruitmentApplicationEvent.createMany).not.toHaveBeenCalled();
    expect(f.tx.notification.createMany).not.toHaveBeenCalled();
  });

  test.each(["recruitmentApplicationEvent", "notification"] as const)("%s 실패를 삼키지 않아 공연 보관과 모집 변경이 같은 transaction에서 rollback된다", async (model) => {
    const f = fixture(); const original = structuredClone(f.state);
    f.tx[model].createMany.mockRejectedValueOnce(new Error("storage unavailable"));
    await expect(f.inTransaction(async () => { f.state.production.archived = true; await f.cancel(); })).rejects.toThrow("storage unavailable");
    expect(f.state).toEqual(original);
  });
});
