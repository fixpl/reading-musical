import { apiRequest } from "./client";

/** 공연별 서버 권한. 플랫폼 등급이나 대표 역할로 클라이언트에서 재계산하지 않는다. */
export type ProductionAccess = {
  canEditProduction: boolean;
  canManageMembers: boolean;
  canViewMembers: boolean;
  canManageStaffAssignments: boolean;
  canEditCasting: boolean;
  canEditPlanning: boolean;
  canViewReadiness: boolean;
  canEditChecklist: boolean;
  canManageTracks: boolean;
  canEditMusic: boolean;
  canManageRecruitment: boolean;
  canEditSchedule: boolean;
  canCreateSchedule: boolean;
  scheduleEditScope: "ALL" | "MUSIC_PRACTICE" | "NONE";
  canViewSensitive: boolean;
};

export const EMPTY_PRODUCTION_ACCESS: Readonly<ProductionAccess> = Object.freeze({
  canEditProduction: false, canManageMembers: false, canViewMembers: false,
  canManageStaffAssignments: false, canEditCasting: false, canEditPlanning: false,
  canViewReadiness: false, canEditChecklist: false, canManageTracks: false,
  canEditMusic: false, canManageRecruitment: false, canEditSchedule: false,
  canCreateSchedule: false, scheduleEditScope: "NONE", canViewSensitive: false
});

export function getProductionAccess(productionId: string, signal?: AbortSignal) {
  return apiRequest<ProductionAccess>(`/productions/${encodeURIComponent(productionId)}/access`, { signal });
}
