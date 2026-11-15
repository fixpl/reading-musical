import { ProductionAccessService } from "./production-access.service";
import { HEADERS_METADATA } from "@nestjs/common/constants";
import type { PlatformRole, ProductionRole } from "@prisma/client";
import type { RequestUser } from "../common/types/request-user";
import { ProductionsController } from "./productions.controller";
import { ProductionDirectoryService } from "./production-directory.service";
import { ProductionReadinessService } from "./production-readiness.service";
import { ProductionsService } from "./productions.service";
import { ScheduleService } from "../schedule/schedule.service";

const viewer = { id: "viewer", platformRole: "MEMBER", name: "확인자" } as RequestUser;
function setup(roles: ProductionRole[] = ["ACTOR"]) {
  const prisma = {
    production: {
      findFirst: jest.fn().mockResolvedValue({ organizationId: "org-production", archived: false }),
      findUnique: jest.fn().mockResolvedValue({ id: "production", title: "공연", organizationId: "org-production" })
    },
    user: { findUnique: jest.fn().mockResolvedValue({ status: "ACTIVE", platformRole: "MEMBER", organizationId: "org-viewer" }) },
    membership: {
      findUnique: jest.fn().mockResolvedValue({ id: "membership-viewer", roles: roles.map((role) => ({ role })) }),
      findMany: jest.fn().mockResolvedValue([])
    }
  };
  const service = new ProductionsService(prisma as never, new ProductionAccessService(prisma as never), {} as never, {} as never, {} as never);
  const access = new ProductionAccessService(prisma as never);
  return {
    prisma, service,
    directory: new ProductionDirectoryService(prisma as never, access),
    readiness: new ProductionReadinessService(prisma as never, access)
  };
}
const person = (id: string) => ({
  id: `membership-${id}`, userId: id, primaryRole: "ACTOR", roles: [{ role: "ACTOR" }],
  user: { id, name: id, email: `${id}@example.test`, phone: "010-private", profileType: "ACTOR", profileComplete: true, status: "ACTIVE", photoAssetId: null,
    profileDetails: { specialties: ["노래"], voiceRange: "A3-C5", address: "비공개 주소", settings: { privateValue: "비공개 설정" } } },
  staffAssignments: [], castAssignments: [],
  attendances: [{ status: "DECLINED", event: { id: `event-${id}`, title: `${id} 참석정보`, type: "READING", startAt: new Date("2026-10-23T01:00:00Z") } }]
});

describe("공연 기능 권한 응답", () => {
  test("현재 DB 등급을 사용해 옛 SUPER_ADMIN 토큰의 관리 기능을 숨긴다", async () => {
    const f = setup();
    const result = await f.service.getCapabilities("production", { ...viewer, platformRole: "SUPER_ADMIN" });
    expect(result).toMatchObject({ canEditProduction: false, canManageMembers: false, canCreateSchedule: true });
  });

  test("현재 같은 조직 관리자는 멤버가 아니어도 권한을 확인한다", async () => {
    const f = setup(); f.prisma.membership.findUnique.mockResolvedValue(null as never);
    f.prisma.user.findUnique.mockResolvedValue({ status: "ACTIVE", platformRole: "ORG_ADMIN", organizationId: "org-production" });
    expect(await f.service.getCapabilities("production", viewer)).toMatchObject({ canEditProduction: true, canEditMusic: true, scheduleEditScope: "ALL" });
  });

  test.each(["MEMBER", "ORG_ADMIN"] as PlatformRole[])("%s 비멤버에게 다른 공연의 기능을 알리지 않는다", async (platformRole) => {
    const f = setup(); f.prisma.membership.findUnique.mockResolvedValue(null as never);
    f.prisma.user.findUnique.mockResolvedValue({ status: "ACTIVE", platformRole, organizationId: "org-viewer" });
    await expect(f.service.getCapabilities("production", viewer)).rejects.toMatchObject({ status: 404 });
  });

  test("공연 역할 없는 멤버도 관리 기능을 얻지 않는다", async () => {
    const f = setup([]); expect(await f.service.getCapabilities("production", viewer)).toMatchObject({ canManageMembers: false, canCreateSchedule: false });
  });

  test.each(["BLOCKED", "INACTIVE"])("현재 %s 회원은 권한을 확인하지 못한다", async (status) => {
    const f = setup(); f.prisma.user.findUnique.mockResolvedValue({ status, platformRole: "SUPER_ADMIN", organizationId: "org-production" });
    await expect(f.service.getCapabilities("production", viewer)).rejects.toMatchObject({ status: 404 });
  });

  test("삭제 공연은 조회하지 않고 결과를 캐시하지 않는다", async () => {
    const f = setup(); f.prisma.production.findFirst.mockResolvedValue(null as never);
    await expect(f.service.getCapabilities("production", viewer)).rejects.toMatchObject({ status: 404 });
    expect(f.prisma.production.findFirst).toHaveBeenCalledWith({ where: { id: "production", deletedAt: null }, select: { organizationId: true, archived: true } });
    expect(Reflect.getMetadata(HEADERS_METADATA, ProductionsController.prototype.getCapabilities)).toEqual([{ name: "Cache-Control", value: "private, no-store" }]);
  });

  test("보관 공연의 기본 정보·일정·권한을 함께 읽어도 기존 일정 화면을 막지 않는다", async () => {
    const f = setup();
    f.prisma.production.findFirst.mockResolvedValue({ organizationId: "org-production", archived: true });
    f.prisma.production.findUnique.mockResolvedValue({ id: "production", title: "보관 공연", organizationId: "org-production", archived: true } as never);
    const scheduleDb = { ...f.prisma,
      membership: { ...f.prisma.membership, findFirst: jest.fn().mockResolvedValue({ id: "membership-viewer", roles: [{ role: "ACTOR" }] }) },
      scheduleEvent: { findMany: jest.fn().mockResolvedValue([{ id: "archived-event", scenes: [], attendances: [] }]) },
      scene: { findMany: jest.fn().mockResolvedValue([]) }, musicCue: { findMany: jest.fn().mockResolvedValue([]) },
      stageSceneNote: { findMany: jest.fn().mockResolvedValue([]) }
    };
    const schedule = new ScheduleService(scheduleDb as never, {} as never);
    const [production, workspace, capabilities] = await Promise.all([
      f.service.findOne("production", viewer), schedule.getWorkspace("production", viewer), f.service.getCapabilities("production", viewer)
    ]);
    expect(production).toMatchObject({ archived: true });
    expect(workspace.events).toEqual([{ id: "archived-event", scenes: [], attendances: [], stageNotes: [] }]);
    expect(capabilities).toMatchObject({ canCreateSchedule: true, canManageRecruitment: false });
  });
});

describe("공연팀 개인정보 응답", () => {
  test("일반 참여자는 타인 프로필 JSON과 참석 기록을 받지 않고 본인의 직무·참석 정보만 받는다", async () => {
    const f = setup(); f.prisma.membership.findMany.mockResolvedValue([person("viewer"), person("other")] as never);
    const result = await f.directory.listPeople("production", viewer);
    const self = result.people.find((item) => item.user.id === "viewer")!;
    const other = result.people.find((item) => item.user.id === "other")!;
    expect(self.user.profileDetails).toEqual({ specialties: ["노래"], voiceRange: "A3-C5" });
    expect(self.recentAttendances).toHaveLength(1);
    expect(other.user).toMatchObject({ profileDetails: null, phone: null, contactVisible: false });
    expect(other.user.email).not.toBe("other@example.test");
    expect(other.attendanceSummary).toEqual({}); expect(other.recentAttendances).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("비공개 주소"); expect(JSON.stringify(result)).not.toContain("비공개 설정");
    expect(f.prisma.membership.findMany).toHaveBeenCalledWith(expect.objectContaining({ include: expect.objectContaining({
      attendances: expect.objectContaining({ where: { membership: { userId: "viewer" } } })
    }) }));
  });

  test.each(["PRODUCER", "DIRECTOR", "STAGE_MANAGER"] as const)("%s도 임의 프로필 JSON을 받지 않고 허용된 직무·참석 정보만 받는다", async (role) => {
    const f = setup([role]); f.prisma.membership.findMany.mockResolvedValue([person("other")] as never);
    const other = (await f.directory.listPeople("production", viewer)).people[0];
    expect(other.user).toMatchObject({ phone: "010-private", email: "other@example.test", contactVisible: true,
      profileDetails: { specialties: ["노래"], voiceRange: "A3-C5" } });
    expect(other.attendanceSummary).toEqual({ DECLINED: 1 }); expect(other.recentAttendances).toHaveLength(1);
  });

  test("타 조직 ORG_ADMIN은 공연의 ACTOR 역할만으로 연락처나 참석정보를 읽지 못한다", async () => {
    const f = setup(); f.prisma.user.findUnique.mockResolvedValue({ status: "ACTIVE", platformRole: "ORG_ADMIN", organizationId: "org-viewer" });
    f.prisma.membership.findMany.mockResolvedValue([person("other")] as never);
    const other = (await f.directory.listPeople("production", { ...viewer, platformRole: "ORG_ADMIN" })).people[0];
    expect(other.user.contactVisible).toBe(false); expect(other.recentAttendances).toEqual([]);
  });

  test("공연에 접근할 수 없으면 개인정보나 준비 상태를 조회하지 않는다", async () => {
    const f = setup(); f.prisma.membership.findUnique.mockResolvedValue(null as never);
    await expect(f.directory.listPeople("production", viewer)).rejects.toMatchObject({ status: 404 });
    expect(f.prisma.membership.findMany).not.toHaveBeenCalled();
    f.prisma.production.findUnique.mockClear();
    await expect(f.readiness.getReadiness("production", viewer)).rejects.toMatchObject({ status: 404 });
    expect(f.prisma.production.findUnique).toHaveBeenCalledTimes(1);
    expect(f.prisma.production.findUnique).not.toHaveBeenCalledWith(expect.objectContaining({ include: expect.anything() }));
  });
});
