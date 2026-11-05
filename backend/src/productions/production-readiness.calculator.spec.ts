import { AnchorStatus, ChecklistStatus, RunSheetStatus } from "@prisma/client";
import { computeProductionReadiness, ProductionReadinessInput } from "./production-readiness.calculator";

function emptyInput(): ProductionReadinessInput {
  return {
    memberships: [],
    scripts: [],
    musicCues: [],
    events: [],
    runSheets: [],
    checklistPhases: []
  };
}

describe("computeProductionReadiness", () => {
  it("아무 데이터도 없으면 모든 항목이 미완료로 집계된다", () => {
    const result = computeProductionReadiness("prod-1", emptyInput());

    expect(result.ready).toBe(false);
    expect(result.summary.readyCount).toBe(0);
    expect(result.checks.find((check) => check.key === "SCRIPT_READY")?.ready).toBe(false);
    expect(result.checks.find((check) => check.key === "MEMBER_MATCHED")?.ready).toBe(false);
  });

  it("모든 기준을 만족하면 ready=true와 함께 모든 체크가 통과한다", () => {
    const input: ProductionReadinessInput = {
      memberships: [
        { roles: [{ role: "PRODUCER" }], staffAssignments: [] },
        { roles: [{ role: "STAFF" }], staffAssignments: [{ id: "sa-1" }] }
      ],
      scripts: [{ versions: [{ id: "v1" }], acts: [{ scenes: [{ blocks: [{ id: "b1" }] }] }] }],
      musicCues: [{ id: "cue-1", anchorStatus: AnchorStatus.OK }],
      events: [{ attendances: [{ status: "ACCEPTED" }] }],
      runSheets: [{ id: "rs-1", status: RunSheetStatus.LOCKED }],
      checklistPhases: [{ items: [{ id: "item-1", status: ChecklistStatus.DONE }] }]
    };

    const result = computeProductionReadiness("prod-1", input);

    expect(result.ready).toBe(true);
    expect(result.summary.blockingCount).toBe(0);
    expect(result.checks.every((check) => check.ready)).toBe(true);
  });

  it("출석 미응답은 경고(warningCount)로만 집계되고 차단하지 않는다", () => {
    const input: ProductionReadinessInput = {
      ...emptyInput(),
      events: [{ attendances: [{ status: "INVITED" }, { status: "ACCEPTED" }] }]
    };

    const result = computeProductionReadiness("prod-1", input);
    const scheduleCheck = result.checks.find((check) => check.key === "SCHEDULE_ATTENDANCE");

    expect(scheduleCheck?.ready).toBe(true);
    expect(scheduleCheck?.warningCount).toBe(1);
    expect(result.summary.warningCount).toBe(1);
  });

  it("anchor가 깨진 음악 큐가 있으면 MUSIC_CUE_ANCHOR가 차단 상태가 된다", () => {
    const input: ProductionReadinessInput = {
      ...emptyInput(),
      musicCues: [
        { id: "cue-1", anchorStatus: AnchorStatus.OK },
        { id: "cue-2", anchorStatus: AnchorStatus.BROKEN }
      ]
    };

    const result = computeProductionReadiness("prod-1", input);
    const musicCheck = result.checks.find((check) => check.key === "MUSIC_CUE_ANCHOR");

    expect(musicCheck?.ready).toBe(false);
    expect(musicCheck?.blockingCount).toBe(1);
  });
});
