import type { PlatformRole, ProductionRole } from "@prisma/client";

type ProductionCapabilityContext = {
  platformRole: PlatformRole;
  organizationId: string | null;
  productionOrganizationId: string | null;
  archived: boolean;
  roles: readonly ProductionRole[];
};

/** 현재 조직과 공연 역할로 화면 기능을 판별한다. 대표 역할은 권한 근거로 사용하지 않는다. */
export function productionCapabilities(context: ProductionCapabilityContext) {
  const admin = context.platformRole === "SUPER_ADMIN" ||
    context.platformRole === "ORG_ADMIN" && Boolean(context.organizationId && context.organizationId === context.productionOrganizationId);
  const allows = (...roles: ProductionRole[]) => admin || roles.some((role) => context.roles.includes(role));
  const fullSchedule = allows("PRODUCER", "DIRECTOR", "STAGE_MANAGER");
  const musicSchedule = allows("MUSIC_DIRECTOR");

  return {
    canEditProduction: allows("PRODUCER"),
    canManageMembers: allows("PRODUCER"),
    canViewMembers: allows("PRODUCER", "DIRECTOR", "STAGE_MANAGER"),
    canManageStaffAssignments: allows("PRODUCER", "STAGE_MANAGER"),
    canEditCasting: allows("PRODUCER", "DIRECTOR"),
    canEditPlanning: allows("PRODUCER", "DIRECTOR", "MUSIC_DIRECTOR", "STAGE_MANAGER"),
    canViewReadiness: allows("PRODUCER", "DIRECTOR", "STAGE_MANAGER"),
    canEditChecklist: allows("PRODUCER", "DIRECTOR", "STAGE_MANAGER"),
    // 큐시트 트랙 관리와 음악 자료 편집은 서로 다른 API 권한을 따른다.
    canManageTracks: allows("PRODUCER", "DIRECTOR", "MUSIC_DIRECTOR", "STAGE_MANAGER"),
    canEditMusic: allows("PRODUCER", "MUSIC_DIRECTOR"),
    // 보관은 모집을 종료하지만 기존 공연 자료·일정의 접근 권한은 바꾸지 않는다.
    canManageRecruitment: !context.archived && allows("PRODUCER"),
    canEditSchedule: fullSchedule || musicSchedule,
    canCreateSchedule: allows("PRODUCER", "DIRECTOR", "MUSIC_DIRECTOR", "STAGE_MANAGER", "ACTOR", "STAFF"),
    scheduleEditScope: fullSchedule ? "ALL" as const : musicSchedule ? "MUSIC_PRACTICE" as const : "NONE" as const,
    canViewSensitive: allows("PRODUCER", "DIRECTOR", "STAGE_MANAGER")
  };
}

export type ProductionCapabilities = ReturnType<typeof productionCapabilities>;
