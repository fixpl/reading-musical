import { AnchorStatus, ChecklistStatus, RunSheetStatus } from "@prisma/client";

export type ReadinessCheck = {
  key: string;
  label: string;
  ready: boolean;
  detail: string;
  href: string;
  readyCount?: number;
  totalCount?: number;
  blockingCount?: number;
  warningCount?: number;
};

export type ProductionReadinessInput = {
  memberships: { roles: { role: string }[]; staffAssignments: { id: string }[] }[];
  scripts: { versions: { id: string }[]; acts: { scenes: { blocks: { id: string }[] }[] }[] }[];
  musicCues: { id: string; anchorStatus: AnchorStatus }[];
  events: { attendances: { status: string }[] }[];
  runSheets: { id: string; status: RunSheetStatus }[];
  checklistPhases: { items: { id: string; status: ChecklistStatus }[] }[];
};

/**
 * 공개 준비 점검(readiness) 계산 — DB 접근 없는 순수 함수.
 * productions.service.ts의 getReadiness(186줄)에서 "조회"와 "계산"을 분리한 결과,
 * 계산 부분만 이 함수로 옮겨 DB 없이 단위 테스트할 수 있게 한다.
 */
export function computeProductionReadiness(productionId: string, production: ProductionReadinessInput) {
  const staffMemberships = production.memberships.filter((membership) => membership.roles.some((role) => role.role === "STAFF"));
  const staffWithoutDiscipline = staffMemberships.filter((membership) => membership.staffAssignments.length === 0).length;
  const scriptSummaries = production.scripts.map((script) => ({
    hasVersion: script.versions.length > 0,
    blockCount: script.acts.reduce(
      (actTotal, act) => actTotal + act.scenes.reduce((sceneTotal, scene) => sceneTotal + scene.blocks.length, 0),
      0
    )
  }));
  const confirmedScripts = scriptSummaries.filter((script) => script.hasVersion && script.blockCount > 0).length;
  const scriptBlockCount = scriptSummaries.reduce((total, script) => total + script.blockCount, 0);
  const scriptsWithVersion = scriptSummaries.filter((script) => script.hasVersion).length;
  const scriptsWithBlocks = scriptSummaries.filter((script) => script.blockCount > 0).length;
  const brokenCues = production.musicCues.filter((cue) => cue.anchorStatus !== AnchorStatus.OK).length;
  const attendances = production.events.flatMap((event) => event.attendances);
  const pendingAttendances = attendances.filter((attendance) => attendance.status === "INVITED").length;
  const checklistItems = production.checklistPhases.flatMap((phase) => phase.items);
  const doneChecklist = checklistItems.filter((item) => item.status === ChecklistStatus.DONE).length;
  const blockedChecklist = checklistItems.filter((item) => item.status === ChecklistStatus.BLOCKED).length;
  const waitingApprovalChecklist = checklistItems.filter((item) => item.status === ChecklistStatus.WAITING_APPROVAL).length;
  const incompleteChecklist = checklistItems.length - doneChecklist;
  const lockedRunSheets = production.runSheets.filter(
    (sheet) => sheet.status === RunSheetStatus.LOCKED || sheet.status === RunSheetStatus.COMPLETED
  ).length;

  const checks: ReadinessCheck[] = [
    {
      key: "SCRIPT_READY",
      label: "대본 확정",
      ready: confirmedScripts > 0,
      detail:
        confirmedScripts > 0
          ? `확정 버전과 장면 블록이 있는 대본 ${confirmedScripts}개, 총 블록 ${scriptBlockCount}개`
          : production.scripts.length === 0
            ? "대본 에디터에서 첫 대본을 등록해 주세요."
            : scriptsWithBlocks === 0
              ? "장면/대사 블록을 먼저 입력하거나 파일 import를 반영해 주세요."
              : scriptsWithVersion === 0
                ? "대본 버전을 생성해 공개 기준 확정본을 남겨 주세요."
                : "확정 버전과 장면 블록을 모두 가진 대본이 필요해요.",
      href: "script",
      readyCount: confirmedScripts,
      totalCount: Math.max(production.scripts.length, 1),
      blockingCount: confirmedScripts > 0 ? 0 : 1
    },
    {
      key: "MEMBER_MATCHED",
      label: "멤버 매칭",
      ready: production.memberships.length > 1,
      detail:
        production.memberships.length > 1
          ? `${production.memberships.length}명 연결`
          : "기획자 외 배우·스태프·음악감독을 연결해 주세요.",
      href: "members",
      readyCount: production.memberships.length > 1 ? 1 : 0,
      totalCount: 1,
      blockingCount: production.memberships.length > 1 ? 0 : 1
    },
    {
      key: "STAFF_DISCIPLINE",
      label: "스태프 직무 지정",
      ready: staffMemberships.length > 0 && staffWithoutDiscipline === 0,
      detail:
        staffMemberships.length === 0
          ? "STAFF 역할 멤버가 필요해요."
          : staffWithoutDiscipline > 0
            ? `직무 미지정 STAFF ${staffWithoutDiscipline}명`
            : "모든 STAFF에 세부 직무가 지정됐어요.",
      href: "members",
      readyCount: staffMemberships.length - staffWithoutDiscipline,
      totalCount: Math.max(staffMemberships.length, 1),
      blockingCount: staffMemberships.length === 0 ? 1 : staffWithoutDiscipline
    },
    {
      key: "MUSIC_CUE_ANCHOR",
      label: "음악 큐 anchor",
      ready: production.musicCues.length > 0 && brokenCues === 0,
      detail:
        production.musicCues.length === 0
          ? "음악 큐시트에 최소 1개 cue를 등록해 주세요."
          : brokenCues > 0
            ? `대본 anchor가 필요한 cue ${brokenCues}개`
            : "모든 음악 cue가 대본에 연결됐어요.",
      href: "music",
      readyCount: production.musicCues.length - brokenCues,
      totalCount: Math.max(production.musicCues.length, 1),
      blockingCount: production.musicCues.length === 0 ? 1 : brokenCues
    },
    {
      key: "SCHEDULE_ATTENDANCE",
      label: "일정·출석",
      ready: production.events.length > 0 && attendances.length > 0,
      detail:
        production.events.length === 0
          ? "리딩 또는 리허설 일정을 만들어 주세요."
          : attendances.length === 0
            ? "일정 참석자를 연결해 주세요."
            : pendingAttendances > 0
              ? `출석 미응답 ${pendingAttendances}건이 남아 있어요. 공개는 가능하지만 확인이 필요합니다.`
              : "일정과 참석자가 연결됐어요.",
      href: "schedule",
      readyCount: attendances.length - pendingAttendances,
      totalCount: Math.max(attendances.length, 1),
      blockingCount: production.events.length === 0 || attendances.length === 0 ? 1 : 0,
      warningCount: pendingAttendances
    },
    {
      key: "RUN_SHEET_LOCKED",
      label: "진행표 확정",
      ready: lockedRunSheets > 0,
      detail: lockedRunSheets > 0
        ? "확정된 진행표가 있어요."
        : "일정 기반 진행표를 생성하고 확정해 주세요.",
      href: "run-sheets",
      readyCount: lockedRunSheets,
      totalCount: Math.max(production.runSheets.length, 1),
      blockingCount: lockedRunSheets > 0 ? 0 : 1
    },
    {
      key: "CHECKLIST_REQUIRED",
      label: "필수 체크리스트",
      ready: checklistItems.length > 0 && incompleteChecklist === 0,
      detail:
        checklistItems.length === 0
          ? "체크리스트 단계가 필요해요."
          : blockedChecklist > 0
            ? `차단 항목 ${blockedChecklist}개를 먼저 해결해 주세요.`
            : waitingApprovalChecklist > 0
              ? `승인 대기 항목 ${waitingApprovalChecklist}개가 남아 있어요.`
              : incompleteChecklist > 0
                ? `완료되지 않은 체크리스트 ${incompleteChecklist}개가 남아 있어요.`
                : "필수 체크리스트가 모두 완료됐어요.",
      href: "checklist",
      readyCount: doneChecklist,
      totalCount: Math.max(checklistItems.length, 1),
      blockingCount: checklistItems.length === 0 ? 1 : incompleteChecklist,
      warningCount: waitingApprovalChecklist
    }
  ];

  const ready = checks.every((check) => check.ready);
  return {
    productionId,
    ready,
    summary: {
      readyCount: checks.filter((check) => check.ready).length,
      totalCount: checks.length,
      blockingCount: checks.filter((check) => !check.ready).length,
      warningCount: checks.reduce((total, check) => total + (check.warningCount ?? 0), 0)
    },
    checks
  };
}
