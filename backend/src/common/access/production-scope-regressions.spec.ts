import { ForbiddenException } from "@nestjs/common";
import { ProductionRole, StaffDiscipline } from "@prisma/client";
import type { RequestUser } from "../types/request-user";
import { ChecklistService } from "../../checklist/checklist.service";
import { RunSheetAuditService } from "../../run-sheets/run-sheet-audit.service";
import { RunSheetsService } from "../../run-sheets/run-sheets.service";
import { MusicService } from "../../music/music.service";
import { ReadingSessionsService } from "../../reading-sessions/reading-sessions.service";

const productionId = "production-b";
const user = { id: "user-a", name: "참여자", platformRole: "ORG_ADMIN" } as RequestUser;

// 조직 권한과 공연 배정을 실제 서비스에서 따로 검사하도록 Prisma만 대체한다.
function fixture(options: { role?: ProductionRole; discipline?: StaffDiscipline; ownOrganization?: boolean; attending?: boolean } = {}) {
  const role = options.role ?? ProductionRole.ACTOR;
  const member = {
    id: "member-a", userId: user.id, productionId,
    user: { id: user.id, name: user.name }, roles: [{ role }],
    staffAssignments: options.discipline ? [{ discipline: options.discipline }] : []
  };
  const production = { id: productionId, organizationId: options.ownOrganization ? "org-a" : "org-b", title: "공연", currentPhase: "REHEARSAL", visibility: "DRAFT" };
  const checklistItem = {
    id: "checklist-item", phase: { productionId, phase: "REHEARSAL" },
    status: "WAITING_APPROVAL", requiresApproval: true, assignments: [],
    assigneeRole: null, staffDiscipline: null, linkedResourceType: null, runSheetItems: []
  };
  const runSheetItem = { id: "run-sheet-item", ownerMembershipId: "someone-else", ownerRole: null, staffDiscipline: null };
  const session = { id: "session", eventId: "event", runSheetId: null, endedAt: null, currentSceneId: null, currentBlockId: null };
  const cue = { id: "cue", cueNumber: "Q1", cueType: "MUSIC", trackStartMs: 0, trackEndMs: 1000, fireMode: "MANUAL", sceneId: null, anchorBlockId: null };
  const prisma = {
    production: { findUnique: jest.fn().mockResolvedValue(production) },
    user: { findUnique: jest.fn().mockResolvedValue({ organizationId: "org-a" }) },
    membership: {
      findFirst: jest.fn().mockImplementation(async ({ where }) => where.roles.some.role.in.includes(role) ? member : null),
      findMany: jest.fn().mockResolvedValue([])
    },
    checklistItem: {
      count: jest.fn().mockResolvedValue(1), findFirst: jest.fn().mockResolvedValue(checklistItem),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockImplementation(async ({ data }) => ({ ...checklistItem, ...data }))
    },
    checklistPhase: { findMany: jest.fn().mockResolvedValue([]) },
    runSheet: { findFirst: jest.fn().mockResolvedValue({ id: "sheet", status: "LOCKED", items: [runSheetItem] }), findMany: jest.fn().mockResolvedValue([]) },
    runSheetItem: { update: jest.fn().mockImplementation(async ({ data }) => ({ ...runSheetItem, ...data })) },
    musicCue: { findFirst: jest.fn().mockResolvedValue(cue), findMany: jest.fn().mockResolvedValue([]) },
    scene: { findMany: jest.fn().mockResolvedValue([]) },
    stageSceneNote: { findMany: jest.fn().mockResolvedValue([]) },
    scheduleEvent: {
      findFirst: jest.fn().mockResolvedValue({ id: "event", attendances: options.attending ? [{ membershipId: member.id }] : [] }),
      findMany: jest.fn().mockResolvedValue([])
    },
    readingSession: { findFirst: jest.fn().mockResolvedValue(session), findMany: jest.fn().mockResolvedValue([]), update: jest.fn().mockResolvedValue(session) },
    attendance: { count: jest.fn().mockResolvedValue(options.attending ? 1 : 0) },
    cueFireLog: { create: jest.fn().mockResolvedValue({ id: "fire-log", cue }), findMany: jest.fn().mockResolvedValue([]) },
    activityLog: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(async (operations: Promise<unknown>[]) => Promise.all(operations))
  };
  const notifications = { createNotifications: jest.fn(), emitReadingSessionEvent: jest.fn() };
  return {
    prisma, member, checklistItem, runSheetItem,
    checklist: new ChecklistService(prisma as never, notifications as never),
    runSheets: new RunSheetsService(prisma as never, {} as never, new RunSheetAuditService(prisma as never)),
    music: new MusicService(prisma as never, notifications as never, {} as never),
    reading: new ReadingSessionsService(prisma as never, {} as never, notifications as never, {} as never)
  };
}

describe("다른 조직의 운영자가 배우·스태프로 참여하는 공연", () => {
  it.each([ProductionRole.ACTOR, ProductionRole.STAFF])("%s에게 담당 밖 체크리스트 수정·승인 권한을 주지 않는다", async (role) => {
    const { checklist, prisma } = fixture({ role });
    await expect(checklist.updateStatus(productionId, "checklist-item", { status: "IN_PROGRESS" }, user)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(checklist.approveItem(productionId, "checklist-item", { decision: "APPROVED" }, user)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.checklistItem.update).not.toHaveBeenCalled();
  });

  it("본인 배역 담당 체크리스트 상태 변경은 유지한다", async () => {
    const { checklist, checklistItem, prisma } = fixture();
    prisma.checklistItem.findFirst.mockResolvedValue({ ...checklistItem, assigneeRole: ProductionRole.ACTOR });
    await checklist.updateStatus(productionId, "checklist-item", { status: "IN_PROGRESS" }, user);
    expect(prisma.checklistItem.update).toHaveBeenCalled();
  });

  it("공연 소속 조직 운영자의 체크리스트 승인은 유지한다", async () => {
    const { checklist, prisma } = fixture({ ownOrganization: true });
    await checklist.approveItem(productionId, "checklist-item", { decision: "APPROVED" }, user);
    expect(prisma.checklistItem.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "DONE" }) }));
  });

  it.each([ProductionRole.ACTOR, ProductionRole.STAFF])("%s에게 담당 밖 진행표 완료·해제 권한을 주지 않는다", async (role) => {
    const { runSheets, prisma } = fixture({ role });
    for (const done of [true, false]) {
      await expect(runSheets.completeItem(productionId, "sheet", "run-sheet-item", { done }, user)).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(prisma.runSheetItem.update).not.toHaveBeenCalled();
  });

  it("본인에게 지정된 진행표 항목의 완료는 유지한다", async () => {
    const { runSheets, prisma, runSheetItem, member } = fixture();
    prisma.runSheet.findFirst.mockResolvedValue({ id: "sheet", status: "LOCKED", items: [{ ...runSheetItem, ownerMembershipId: member.id }] });
    await runSheets.completeItem(productionId, "sheet", "run-sheet-item", { done: true }, user);
    expect(prisma.runSheetItem.update).toHaveBeenCalled();
  });

  it("공연 소속 조직 운영자의 진행표 완료는 유지한다", async () => {
    const { runSheets, prisma } = fixture({ ownOrganization: true });
    await runSheets.completeItem(productionId, "sheet", "run-sheet-item", { done: true }, user);
    expect(prisma.runSheetItem.update).toHaveBeenCalled();
  });

  it("배우·스태프의 체크리스트와 진행표 편집 capability를 올리지 않는다", async () => {
    const { checklist, runSheets } = fixture();
    expect((await checklist.getWorkspace(productionId, user)).canEdit).toBe(false);
    expect((await runSheets.getWorkspace(productionId, user)).canEdit).toBe(false);
  });

  it("공연 소속 조직 운영자의 편집 capability는 유지한다", async () => {
    const { checklist, runSheets } = fixture({ ownOrganization: true });
    expect((await checklist.getWorkspace(productionId, user)).canEdit).toBe(true);
    expect((await runSheets.getWorkspace(productionId, user)).canEdit).toBe(true);
  });

  it.each([undefined, StaffDiscipline.LIGHTING])("음향 담당이 아닌 스태프(%s)의 음악·리딩 큐 실행을 거절한다", async (discipline) => {
    const { music, reading, prisma } = fixture({ role: ProductionRole.STAFF, discipline });
    await expect(music.fireCue(productionId, "cue", { sessionId: "session" }, user)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(reading.fireCue(productionId, "session", { cueId: "cue" }, user)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.cueFireLog.create).not.toHaveBeenCalled();
    expect(prisma.readingSession.update).not.toHaveBeenCalled();
  });

  it.each([StaffDiscipline.SOUND, StaffDiscipline.ACCOMPANIST])("실제 %s 담당 스태프의 큐 실행은 유지한다", async (discipline) => {
    const { music, reading, prisma } = fixture({ role: ProductionRole.STAFF, discipline });
    await music.fireCue(productionId, "cue", { sessionId: "session" }, user);
    await reading.fireCue(productionId, "session", { cueId: "cue" }, user);
    expect(prisma.cueFireLog.create).toHaveBeenCalledTimes(2);
  });

  it("공연 소속 조직 운영자의 큐 실행은 유지한다", async () => {
    const { music, reading, prisma } = fixture({ ownOrganization: true });
    await music.fireCue(productionId, "cue", { sessionId: "session" }, user);
    await reading.fireCue(productionId, "session", { cueId: "cue" }, user);
    expect(prisma.cueFireLog.create).toHaveBeenCalledTimes(2);
  });

  it.each([ProductionRole.ACTOR, ProductionRole.STAFF])("%s의 미참석 리딩 일정·세션 조회를 거절한다", async (role) => {
    const { reading, prisma } = fixture({ role });
    await expect(reading.getEventWorkspace(productionId, "event", user)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(reading.getSession(productionId, "session", user)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.attendance.count).toHaveBeenCalledWith({ where: { eventId: "event", membershipId: "member-a" } });
  });

  it("참석자로 등록된 배우는 조회하되 제작진 capability를 받지 않는다", async () => {
    const { reading } = fixture({ attending: true });
    const workspace = await reading.getEventWorkspace(productionId, "event", user);
    expect(workspace.isEventParticipant).toBe(true);
    expect(workspace.permissions).toMatchObject({ canStart: false, canEnd: false, canSyncPage: false, canFireCue: false });
    expect((await reading.getSession(productionId, "session", user)).permissions).toMatchObject({ canStart: false, canSyncPage: false });
  });

  it("실제 음향 스태프의 응답에서는 큐 실행만 허용한다", async () => {
    const { reading } = fixture({ role: ProductionRole.STAFF, discipline: StaffDiscipline.SOUND, attending: true });
    expect((await reading.getSession(productionId, "session", user)).permissions).toMatchObject({ canStart: false, canEnd: false, canSyncPage: false, canFireCue: true });
  });

  it("공연 소속 조직 운영자는 미참석 일정도 조회하고 관리한다", async () => {
    const { reading, prisma } = fixture({ ownOrganization: true });
    expect((await reading.getEventWorkspace(productionId, "event", user)).permissions).toMatchObject({ canStart: true, canSyncPage: true, canFireCue: true });
    await reading.getSession(productionId, "session", user);
    expect(prisma.attendance.count).not.toHaveBeenCalled();
  });
});
