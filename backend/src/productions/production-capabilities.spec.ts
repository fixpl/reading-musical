import type { ProductionRole } from "@prisma/client";
import { productionCapabilities } from "./production-capabilities";

const context = { platformRole: "MEMBER" as const, organizationId: "org-a", productionOrganizationId: "org-b", archived: false, roles: [] as ProductionRole[] };
const forRoles = (...roles: ProductionRole[]) => productionCapabilities({ ...context, roles });

describe("공연 기능별 권한", () => {
  test.each(["SUPER_ADMIN", "ORG_ADMIN"] as const)("범위가 확인된 %s는 멤버십 없이 기능을 관리한다", (platformRole) => {
    const capabilities = productionCapabilities({ ...context, platformRole, productionOrganizationId: "org-a" });
    expect(capabilities.scheduleEditScope).toBe("ALL");
    expect(Object.entries(capabilities).filter(([key]) => key !== "scheduleEditScope").every(([, value]) => value === true)).toBe(true);
  });

  test("타 조직 관리자와 양쪽 조직이 누락된 관리자는 공연 역할만 사용한다", () => {
    for (const organizationId of ["org-a", null]) {
      const result = productionCapabilities({ ...context, platformRole: "ORG_ADMIN", organizationId,
        productionOrganizationId: organizationId === null ? null : "org-b", roles: ["ACTOR"] });
      expect(result).toMatchObject({ canEditProduction: false, canManageMembers: false, canManageRecruitment: false,
        canViewMembers: false, canViewSensitive: false, canManageTracks: false, canEditSchedule: false,
        canCreateSchedule: true, scheduleEditScope: "NONE" });
    }
  });

  test.each(["ACTOR", "STAFF", "GUEST"] as const)("%s에게 관리 기능을 부여하지 않는다", (role) => {
    const result = forRoles(role);
    expect(result.canCreateSchedule).toBe(role !== "GUEST");
    expect(Object.entries(result).filter(([key]) => !["canCreateSchedule", "scheduleEditScope"].includes(key)).every(([, value]) => value === false)).toBe(true);
  });

  test("기획자는 모든 기능을 관리한다", () => {
    expect(Object.values(forRoles("PRODUCER")).every((value) => value === true || value === "ALL")).toBe(true);
  });

  test("연출자는 캐스팅·큐시트를 편집하지만 멤버 역할·음악 자료는 편집하지 않는다", () => {
    expect(forRoles("DIRECTOR")).toEqual({
      canEditProduction: false, canManageMembers: false, canViewMembers: true, canManageStaffAssignments: false,
      canEditCasting: true, canEditPlanning: true, canViewReadiness: true, canEditChecklist: true,
      canManageTracks: true, canEditMusic: false, canManageRecruitment: false,
      canEditSchedule: true, canCreateSchedule: true, scheduleEditScope: "ALL", canViewSensitive: true
    });
  });

  test("음악감독은 준비 점검·멤버 연락처를 읽지 않고 음악연습 일정만 편집한다", () => {
    expect(forRoles("MUSIC_DIRECTOR")).toMatchObject({ canEditMusic: true, canManageTracks: true,
      canViewMembers: false, canViewSensitive: false, canViewReadiness: false, canEditChecklist: false,
      canEditCasting: false, canEditPlanning: true, canEditSchedule: true, scheduleEditScope: "MUSIC_PRACTICE" });
  });

  test("무대감독은 직무를 관리하지만 멤버 역할·캐스팅·음악 자료는 편집하지 않는다", () => {
    expect(forRoles("STAGE_MANAGER")).toMatchObject({ canManageStaffAssignments: true, canViewMembers: true,
      canManageMembers: false, canEditCasting: false, canEditMusic: false, canManageRecruitment: false,
      canManageTracks: true, canViewReadiness: true, canEditChecklist: true, scheduleEditScope: "ALL" });
  });

  test("다중 역할의 합집합을 사용하고 게스트 단독 권한은 확대하지 않는다", () => {
    expect(forRoles("STAFF", "MUSIC_DIRECTOR", "DIRECTOR")).toEqual(forRoles("MUSIC_DIRECTOR", "DIRECTOR"));
    expect(forRoles("GUEST").canCreateSchedule).toBe(false);
  });

  test("보관 공연은 기존 작업 권한을 유지하고 모집만 관리하지 않는다", () => {
    expect(productionCapabilities({ ...context, archived: true, roles: ["PRODUCER"] })).toEqual({
      ...forRoles("PRODUCER"), canManageRecruitment: false
    });
  });
});
