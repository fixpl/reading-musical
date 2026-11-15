import { computeProductionReadiness as buildProductionReadiness, type ProductionReadinessInput as ProductionReadinessSnapshot } from "./production-readiness.calculator";

const empty = (): ProductionReadinessSnapshot => ({ memberships: [], scripts: [], musicCues: [], events: [], runSheets: [], checklistPhases: [] });
const ready = (): ProductionReadinessSnapshot => ({
  memberships: [{ roles: [{ role: "PRODUCER" }], staffAssignments: [] }, { roles: [{ role: "STAFF" }], staffAssignments: [{}] }],
  scripts: [{ versions: [{}], acts: [{ scenes: [{ blocks: [{}] }] }] }],
  musicCues: [{ anchorStatus: "OK" }], events: [{ attendances: [{ status: "ACCEPTED" }] }],
  runSheets: [{ status: "LOCKED" }], checklistPhases: [{ items: [{ status: "DONE" }] }]
});
const check = (snapshot: ProductionReadinessSnapshot, key: string) => buildProductionReadiness("production", snapshot).checks.find((item) => item.key === key)!;

describe("공연 준비 상태 집계", () => {
  test("빈 공연은 기존 7개 점검 순서와 차단 수를 유지한다", () => {
    const result = buildProductionReadiness("production", empty());
    expect(result).toMatchObject({ productionId: "production", ready: false,
      summary: { readyCount: 0, totalCount: 7, blockingCount: 7, warningCount: 0 } });
    expect(result.checks.map((item) => item.key)).toEqual(["SCRIPT_READY", "MEMBER_MATCHED", "STAFF_DISCIPLINE", "MUSIC_CUE_ANCHOR", "SCHEDULE_ATTENDANCE", "RUN_SHEET_LOCKED", "CHECKLIST_REQUIRED"]);
  });

  test("모든 준비 상태를 충족한 입력과 원본 배열을 변경하지 않는다", () => {
    const snapshot = ready(); const previous = structuredClone(snapshot);
    expect(buildProductionReadiness("production", snapshot)).toMatchObject({ ready: true,
      summary: { readyCount: 7, totalCount: 7, blockingCount: 0, warningCount: 0 } });
    expect(snapshot).toEqual(previous);
  });

  test("확정 버전과 블록은 같은 대본에 있어야 한다", () => {
    const snapshot = ready();
    snapshot.scripts = [{ versions: [{}], acts: [] }, { versions: [], acts: [{ scenes: [{ blocks: [{}] }] }] }];
    expect(check(snapshot, "SCRIPT_READY")).toMatchObject({ ready: false, readyCount: 0, totalCount: 2, blockingCount: 1 });
  });

  test("직무 없는 STAFF와 STAFF 부재를 준비 미완료로 계산한다", () => {
    const snapshot = ready(); snapshot.memberships[1].staffAssignments = [];
    expect(check(snapshot, "STAFF_DISCIPLINE")).toMatchObject({ ready: false, readyCount: 0, totalCount: 1, blockingCount: 1 });
    snapshot.memberships.pop();
    expect(check(snapshot, "STAFF_DISCIPLINE")).toMatchObject({ ready: false, totalCount: 1, blockingCount: 1 });
  });

  test("초대 미응답은 일정 준비를 차단하지 않고 경고에만 반영한다", () => {
    const snapshot = ready(); snapshot.events[0].attendances.push({ status: "INVITED" });
    expect(check(snapshot, "SCHEDULE_ATTENDANCE")).toMatchObject({ ready: true, readyCount: 1, totalCount: 2, blockingCount: 0, warningCount: 1 });
    expect(buildProductionReadiness("production", snapshot)).toMatchObject({ ready: true, summary: { warningCount: 1 } });
    snapshot.events[0].attendances = [];
    expect(check(snapshot, "SCHEDULE_ATTENDANCE").ready).toBe(false);
  });

  test.each(["LOCKED", "COMPLETED"] as const)("%s 진행표는 확정된 것으로 계산한다", (status) => {
    const snapshot = ready(); snapshot.runSheets[0].status = status;
    expect(check(snapshot, "RUN_SHEET_LOCKED").ready).toBe(true);
  });

  test("승인 대기와 차단 항목은 완료율과 공개 준비에서 제외한다", () => {
    const snapshot = ready(); snapshot.checklistPhases[0].items.push({ status: "WAITING_APPROVAL" }, { status: "BLOCKED" });
    expect(check(snapshot, "CHECKLIST_REQUIRED")).toMatchObject({ ready: false, readyCount: 1, totalCount: 3, blockingCount: 2, warningCount: 1 });
    expect(buildProductionReadiness("production", snapshot).summary).toMatchObject({ blockingCount: 1, warningCount: 1 });
  });
});
