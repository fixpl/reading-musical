import { Injectable, NotFoundException } from "@nestjs/common";
import { ChecklistStatus, RunSheetStatus, type ProductionRole, type Prisma, type StaffDiscipline } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestUser } from "../common/types/request-user";
import { CHANGE_NOTIFICATION_TYPES } from "../notifications/notification.constants";
import { isProductionAdmin } from "../common/access/is-production-admin";

type TodoSeverity = "info" | "warning" | "danger";
type ReadinessStatus = "ready" | "warning" | "blocked";

type TodoCard = {
  title: string;
  description: string;
  severity: TodoSeverity;
  resourceType: string;
  resourceId: string | null;
  primaryActionLabel: string;
  href: string;
  meta?: Array<{ label: string; value: string }>;
};

type DashboardEvent = {
  id: string;
  productionId: string;
  type: string;
  title: string;
  startAt: Date;
  endAt: Date;
  location: string | null;
  attendances: Array<{ status: string }>;
  runSheets: Array<{ id: string; status: string }>;
};

const STAFF_DISCIPLINE_LABELS: Record<StaffDiscipline, string> = {
  SOUND: "음향",
  LIGHTING: "조명",
  STAGE_CREW: "무대",
  PROPS: "소품",
  COSTUME: "의상",
  MAKEUP: "분장/헤어",
  VIDEO: "영상",
  FRONT_OF_HOUSE: "현장/객석",
  PRODUCTION_ASSISTANT: "제작보조",
  ACCOMPANIST: "반주",
  OTHER: "기타"
};

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getProductionDashboard(productionId: string, user: RequestUser) {
    const membership = await this.prisma.membership.findFirst({
      where: { productionId, userId: user.id },
      include: {
        user: { select: { profileComplete: true } },
        roles: true,
        staffAssignments: true
      }
    });

    if (!membership && !(await isProductionAdmin(this.prisma, user, productionId))) {
      throw new NotFoundException("찾을 수 없어요");
    }

    const production = await this.prisma.production.findUnique({
      where: { id: productionId },
      include: {
        memberships: { include: { roles: true, staffAssignments: true } },
        positionRequirements: true,
        scripts: { select: { id: true } },
        roles: { include: { assignments: { select: { id: true } } } },
        musicTracks: { select: { id: true } },
        musicCues: { select: { id: true, anchorStatus: true } },
        stagePlans: { include: { sceneNotes: { select: { id: true } } } },
        events: {
          select: {
            id: true,
            productionId: true,
            type: true,
            title: true,
            startAt: true,
            endAt: true,
            location: true,
            attendances: {
              select: {
                status: true,
                membership: { select: { userId: true } }
              }
            },
            runSheets: { select: { id: true, status: true } }
          }
        },
        runSheets: { select: { id: true, eventId: true, status: true } },
        checklistPhases: {
          include: {
            items: {
              include: {
                assignments: { select: { membershipId: true } }
              }
            }
          }
        }
      }
    });

    if (!production) {
      throw new NotFoundException("찾을 수 없어요");
    }

    const myRoles = membership?.roles.map((role) => role.role) ?? [];
    const myStaffDisciplines = membership?.staffAssignments.map((assignment) => ({
      discipline: assignment.discipline,
      label:
        assignment.discipline === "OTHER" && assignment.customLabel
          ? assignment.customLabel
          : STAFF_DISCIPLINE_LABELS[assignment.discipline]
    })) ?? [];
    const missingStaffAssignments = production.memberships.filter((item) => {
      const isStaff = item.roles.some((role) => role.role === "STAFF");
      return isStaff && item.staffAssignments.length === 0;
    }).length;
    const brokenCues = production.musicCues.filter((cue) => cue.anchorStatus !== "OK").length;
    const checklistItems = production.checklistPhases.flatMap((phase) => phase.items.map((item) => ({ ...item, phaseCode: phase.phase })));
    const incompleteChecklist = checklistItems.filter((item) => item.status !== "DONE").length;
    const pendingAttendance = production.events.reduce(
      (sum, event) => sum + event.attendances.filter((attendance) => attendance.status === "INVITED").length,
      0
    );
    const myPendingAttendance = production.events.reduce(
      (sum, event) =>
        sum +
        event.attendances.filter((attendance) => attendance.status === "INVITED" && attendance.membership.userId === user.id).length,
      0
    );
    const lockedRunSheetEventIds = new Set(production.runSheets.filter((sheet) => sheet.status === "LOCKED").map((sheet) => sheet.eventId));
    const now = new Date();
    const upcomingEvents = [...production.events]
      .filter((event) => event.startAt >= now)
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
      .slice(0, 4);
    const nextReadingEvent = [...production.events]
      .filter((event) => lockedRunSheetEventIds.has(event.id) && ["READING", "REHEARSAL", "MUSIC_PRACTICE"].includes(event.type))
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())[0];
    const myMembershipId = membership?.id ?? null;
    const myAssignedChecklist = checklistItems.filter((item) =>
      myMembershipId ? item.assignments.some((assignment) => assignment.membershipId === myMembershipId) : false
    );
    const myAssignedChecklistOpenItems = myAssignedChecklist.filter((item) => !this.isChecklistDone(item.status));
    const myRoleChecklistOpenItems = checklistItems.filter((item) => item.assigneeRole && myRoles.includes(item.assigneeRole) && !this.isChecklistDone(item.status));
    const myStaffChecklistOpenItems = checklistItems.filter(
      (item) =>
        item.staffDiscipline &&
        myStaffDisciplines.some((assignment) => assignment.discipline === item.staffDiscipline) &&
        !this.isChecklistDone(item.status)
    );
    const myAssignedChecklistOpen = myAssignedChecklistOpenItems.length;
    const myRoleChecklistOpen = myRoleChecklistOpenItems.length;
    const myStaffChecklistOpen = myStaffChecklistOpenItems.length;
    const myWaitingApproval = myAssignedChecklist.filter((item) => item.status === ChecklistStatus.WAITING_APPROVAL).length;
    const myChecklistTarget =
      this.uniqueChecklistItems([...myAssignedChecklistOpenItems, ...myRoleChecklistOpenItems, ...myStaffChecklistOpenItems])[0] ?? null;
    const runSheetOwnerFilters: Prisma.RunSheetItemWhereInput[] = [
      ...(myMembershipId ? [{ ownerMembershipId: myMembershipId }] : []),
      ...myRoles.map((role) => ({ ownerRole: role as ProductionRole })),
      ...myStaffDisciplines.map((assignment) => ({ staffDiscipline: assignment.discipline }))
    ];
    const myRunSheetItems =
      runSheetOwnerFilters.length > 0
        ? await this.prisma.runSheetItem.findMany({
            where: {
              completedAt: null,
              runSheet: { productionId, status: { in: [RunSheetStatus.DRAFT, RunSheetStatus.LOCKED] } },
              OR: runSheetOwnerFilters
            },
            select: {
              id: true,
              title: true,
              runSheet: { select: { id: true, eventId: true, status: true, createdAt: true } }
            },
            orderBy: [{ runSheet: { createdAt: "desc" } }, { order: "asc" }],
            take: 5
          })
        : [];
    const myCastAssignments = myMembershipId
      ? await this.prisma.castAssignment.findMany({
          where: { membershipId: myMembershipId },
          select: {
            role: {
              select: {
                id: true,
                name: true,
                sceneRoles: { select: { sceneId: true, lineCount: true, songCount: true } },
                dialogueBlocks: { select: { id: true, sceneId: true, order: true, type: true } }
              }
            }
          }
        })
      : [];
    const myCastRoles = this.uniqueCastRoles(myCastAssignments.map((assignment) => assignment.role));
    const mySceneIds = new Set(myCastAssignments.flatMap((assignment) => assignment.role.sceneRoles.map((sceneRole) => sceneRole.sceneId)));
    const myDialogueBlocks = myCastAssignments.reduce((sum, assignment) => sum + assignment.role.dialogueBlocks.length, 0);
    const myLyricBlocks = myCastAssignments.reduce(
      (sum, assignment) => sum + assignment.role.dialogueBlocks.filter((block) => block.type === "LYRIC").length,
      0
    );
    const myScriptTarget =
      myCastAssignments
        .flatMap((assignment) => assignment.role.dialogueBlocks.map((block) => ({ id: block.id, sceneId: block.sceneId, order: block.order })))
        .sort((a, b) => a.order - b.order)[0] ?? null;
    const changeNotificationWhere = {
      userId: user.id,
      productionId,
      readAt: null,
      type: { in: [...CHANGE_NOTIFICATION_TYPES] }
    } satisfies Prisma.NotificationWhereInput;
    const [myUnreadChangeNotifications, myUnreadChangeNotificationCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: changeNotificationWhere,
        select: { id: true, type: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 5
      }),
      this.prisma.notification.count({ where: changeNotificationWhere })
    ]);
    const readinessLanes = this.buildReadinessLanes({
      productionId,
      memberCount: production.memberships.length,
      scriptCount: production.scripts.length,
      cueCount: production.musicCues.length,
      brokenCues,
      eventCount: production.events.length,
      pendingAttendance
    });

    return {
      production: {
        id: production.id,
        title: production.title,
        phase: production.currentPhase,
        visibility: production.visibility
      },
      progress: {
        members: production.memberships.length,
        scripts: production.scripts.length,
        cues: production.musicCues.length,
        events: production.events.length,
        pendingAttendance,
        lockedRunSheets: production.runSheets.filter((sheet) => sheet.status === "LOCKED").length,
        checklistTotal: checklistItems.length,
        checklistDone: checklistItems.length - incompleteChecklist
      },
      nextEvent: this.serializeDashboardEvent(upcomingEvents[0] ?? nextReadingEvent ?? null),
      upcomingEvents: upcomingEvents.map((event) => this.serializeDashboardEvent(event)),
      readiness: {
        score: this.readinessScore(readinessLanes),
        lanes: readinessLanes
      },
      myRoles,
      myStaffDisciplines,
      myCastRoles,
      todoCards: this.buildTodoCards(myRoles, {
        profileComplete: membership?.user.profileComplete ?? true,
        missingStaffAssignments,
        myStaffDisciplines,
        brokenCues,
        hasMusicTrack: production.musicTracks.length > 0,
        hasMusicCue: production.musicCues.length > 0,
        hasStagePlan: production.stagePlans.length > 0,
        stageSceneNotes: production.stagePlans.reduce((sum, plan) => sum + plan.sceneNotes.length, 0),
        incompleteChecklist,
        myAssignedChecklistOpen,
        myRoleChecklistOpen,
        myStaffChecklistOpen,
        myWaitingApproval,
        myChecklistTarget,
        hasEvent: production.events.length > 0,
        pendingAttendance,
        myPendingAttendance,
        hasScript: production.scripts.length > 0,
        hasRoles: production.roles.length > 0,
        unassignedRoles: production.roles.filter((role) => role.assignments.length === 0).length,
        hasRunSheet: production.runSheets.length > 0,
        hasLockedRunSheet: lockedRunSheetEventIds.size > 0,
        nextReadingEventId: nextReadingEvent?.id ?? null,
        myRunSheetItems,
        myRoleNames: myCastRoles.map((role) => role.name),
        mySceneCount: mySceneIds.size,
        myDialogueBlocks,
        myLyricBlocks,
        myScriptTarget,
        productionId,
        myUnreadChangeNotifications,
        myUnreadChangeNotificationCount
      })
    };
  }

  private buildReadinessLanes(input: {
    productionId: string;
    memberCount: number;
    scriptCount: number;
    cueCount: number;
    brokenCues: number;
    eventCount: number;
    pendingAttendance: number;
  }) {
    return [
      {
        key: "script",
        label: "대본",
        status: input.scriptCount > 0 ? "ready" : "blocked",
        value: `${input.scriptCount}개`,
        detail: input.scriptCount > 0 ? "대본 등록 완료" : "대본 입력 또는 import가 필요해요.",
        href: `/app/p/${input.productionId}/script`
      },
      {
        key: "cue",
        label: "음악 큐",
        status: input.cueCount === 0 ? "blocked" : input.brokenCues > 0 ? "warning" : "ready",
        value: `${input.cueCount}개`,
        detail:
          input.cueCount === 0
            ? "음원과 큐 등록이 필요해요."
            : input.brokenCues > 0
              ? `anchor 확인 ${input.brokenCues}개`
              : "대본 anchor 연결 완료",
        href: `/app/p/${input.productionId}/cuesheet`
      },
      {
        key: "schedule",
        label: "일정·출석",
        status: input.eventCount === 0 ? "blocked" : input.pendingAttendance > 0 ? "warning" : "ready",
        value: `${input.eventCount}개`,
        detail:
          input.eventCount === 0
            ? "리딩 일정을 만들어 주세요."
            : input.pendingAttendance > 0
              ? `출석 미응답 ${input.pendingAttendance}건`
              : "참석 응답 정리 완료",
        href: `/app/p/${input.productionId}/schedule`
      }
    ] satisfies Array<{
      key: string;
      label: string;
      status: ReadinessStatus;
      value: string;
      detail: string;
      href: string;
    }>;
  }

  private readinessScore(lanes: Array<{ status: ReadinessStatus }>) {
    if (lanes.length === 0) return 0;
    const weighted = lanes.reduce((sum, lane) => {
      if (lane.status === "ready") return sum + 1;
      if (lane.status === "warning") return sum + 0.5;
      return sum;
    }, 0);
    return Math.round((weighted / lanes.length) * 100);
  }

  private serializeDashboardEvent(event: DashboardEvent | null) {
    if (!event) return null;
    const accepted = event.attendances.filter((attendance) => attendance.status === "ACCEPTED").length;
    const pending = event.attendances.filter((attendance) => attendance.status === "INVITED").length;
    const lockedRunSheet = event.runSheets.find((sheet) => sheet.status === "LOCKED" || sheet.status === "COMPLETED");
    return {
      id: event.id,
      type: event.type,
      title: event.title,
      startAt: event.startAt,
      endAt: event.endAt,
      location: event.location,
      attendance: {
        total: event.attendances.length,
        accepted,
        pending
      },
      hasLockedRunSheet: Boolean(lockedRunSheet),
      readingHref: `/app/p/${event.productionId}/live`
    };
  }

  private buildTodoCards(
    roles: string[],
    state: {
      profileComplete: boolean;
      missingStaffAssignments: number;
      myStaffDisciplines: Array<{ discipline: StaffDiscipline; label: string }>;
      brokenCues: number;
      hasMusicTrack: boolean;
      hasMusicCue: boolean;
      hasStagePlan: boolean;
      stageSceneNotes: number;
      incompleteChecklist: number;
      myAssignedChecklistOpen: number;
      myRoleChecklistOpen: number;
      myStaffChecklistOpen: number;
      myWaitingApproval: number;
      myChecklistTarget: { id: string; phaseCode: string } | null;
      hasEvent: boolean;
      pendingAttendance: number;
      myPendingAttendance: number;
      hasScript: boolean;
      hasRoles: boolean;
      unassignedRoles: number;
      hasRunSheet: boolean;
      hasLockedRunSheet: boolean;
      nextReadingEventId: string | null;
      myRunSheetItems: Array<{ id: string; title: string; runSheet: { id: string; eventId: string; status: string } }>;
      myRoleNames: string[];
      mySceneCount: number;
      myDialogueBlocks: number;
      myLyricBlocks: number;
      myScriptTarget: { id: string; sceneId: string } | null;
      productionId: string;
      myUnreadChangeNotifications: Array<{ id: string; type: string; createdAt: Date }>;
      myUnreadChangeNotificationCount: number;
    }
  ) {
    const cards: TodoCard[] = [];
    if (!state.profileComplete) {
      cards.push({
        title: "프로필 보완이 필요해요",
        description: "연락처와 기본 활동 정보를 입력해야 일정·운영 연락을 안정적으로 받을 수 있어요.",
        severity: "warning",
        resourceType: "profile",
        resourceId: null,
        primaryActionLabel: "프로필 보완",
        href: "/app/profile",
        meta: [{ label: "필수", value: "연락처" }]
      });
    }
    if (state.myUnreadChangeNotificationCount > 0 && state.myUnreadChangeNotifications.length > 0) {
      const latest = state.myUnreadChangeNotifications[0];
      const labels = this.notificationMeta(state.myUnreadChangeNotifications);
      cards.push({
        title: `확인하지 않은 변경 ${state.myUnreadChangeNotificationCount}건이 있어요`,
        description: `${this.notificationLabel(latest.type)} 등 대본·큐·일정·운영 변경을 확인해야 최신 준비 상태를 놓치지 않아요.`,
        severity: "warning",
        resourceType: "notification",
        resourceId: latest.id,
        primaryActionLabel: "변경 확인",
        href: `/app/notifications?${new URLSearchParams({ productionId: state.productionId, status: "UNREAD", category: "CHANGE" }).toString()}`,
        meta: labels
      });
    }
    if (roles.includes("PRODUCER") && state.missingStaffAssignments > 0) {
      cards.push({
        title: "스태프 세부 직무 지정 필요",
        description: "STAFF 역할만 있고 음향·조명·소품 같은 실제 직무가 없는 멤버가 있어요.",
        severity: "warning",
        resourceType: "members",
        resourceId: null,
        primaryActionLabel: "멤버 관리",
        href: "members",
        meta: [{ label: "미지정", value: `${state.missingStaffAssignments}명` }]
      });
    }
    if ((roles.includes("DIRECTOR") || roles.includes("PRODUCER")) && !state.hasScript) {
      cards.push({
        title: "대본 등록이 필요해요",
        description: "직접 입력하거나 txt/docx/pdf import draft를 검수해서 첫 대본을 확정해 주세요.",
        severity: "warning",
        resourceType: "script",
        resourceId: null,
        primaryActionLabel: "대본 추가",
        href: "script"
      });
    }
    if ((roles.includes("DIRECTOR") || roles.includes("PRODUCER")) && state.hasScript && (!state.hasRoles || state.unassignedRoles > 0)) {
      cards.push({
        title: state.hasRoles ? "배우가 배정되지 않은 배역이 있어요" : "배역 등록이 필요해요",
        description: "대본 블록의 등장인물과 실제 배우를 연결해야 본인 장면과 일정 제안이 정확해져요.",
        severity: "warning",
        resourceType: "casting",
        resourceId: null,
        primaryActionLabel: "캐스팅",
        href: "casting",
        meta: state.hasRoles ? [{ label: "미배정", value: `${state.unassignedRoles}개 배역` }] : undefined
      });
    }
    if ((roles.includes("PRODUCER") || roles.includes("DIRECTOR") || roles.includes("STAGE_MANAGER")) && !state.hasEvent) {
      cards.push({
        title: "리딩 또는 연습 일정 생성이 필요해요",
        description: "장면, 음악 큐, 참석 대상자를 연결한 일정을 만들어 출석 응답을 받아야 해요.",
        severity: "warning",
        resourceType: "schedule",
        resourceId: null,
        primaryActionLabel: "일정 만들기",
        href: "schedule"
      });
    }
    if ((roles.includes("PRODUCER") || roles.includes("DIRECTOR") || roles.includes("STAGE_MANAGER")) && state.pendingAttendance > 0) {
      cards.push({
        title: `출석 미응답 ${state.pendingAttendance}건을 확인해 주세요`,
        description: "리딩 전 참석 상태를 확정해야 진행표와 준비물을 믿고 잠글 수 있어요.",
        severity: "warning",
        resourceType: "attendance",
        resourceId: null,
        primaryActionLabel: "출석 확인",
        href: "schedule",
        meta: [{ label: "미응답", value: `${state.pendingAttendance}건` }]
      });
    }
    if (state.myPendingAttendance > 0) {
      cards.push({
        title: "출석 응답이 필요한 일정이 있어요",
        description: "참석 가능 여부를 남겨야 기획자와 무대감독이 리딩 인원을 확정할 수 있어요.",
        severity: "warning",
        resourceType: "attendance",
        resourceId: null,
        primaryActionLabel: "출석 응답",
        href: "schedule",
        meta: [{ label: "내 미응답", value: `${state.myPendingAttendance}건` }]
      });
    }
    if (roles.includes("MUSIC_DIRECTOR") && (!state.hasMusicTrack || !state.hasMusicCue)) {
      cards.push({
        title: state.hasMusicTrack ? "음악 큐 등록이 필요해요" : "음원 트랙 등록이 필요해요",
        description: "v1은 음원을 직접 편집하지 않고 원본 asset과 cue 재생 지시값을 관리해요.",
        severity: "warning",
        resourceType: "music",
        resourceId: null,
        primaryActionLabel: "음악 큐시트",
        href: "music"
      });
    }
    if (roles.includes("MUSIC_DIRECTOR") && state.brokenCues > 0) {
      cards.push({
        title: "대본과 연결되지 않은 음악 큐가 있어요",
        description: "cue marker가 리딩 화면과 진행표에 보이도록 scene 또는 block anchor를 지정해 주세요.",
        severity: "warning",
        resourceType: "music",
        resourceId: null,
        primaryActionLabel: "큐시트 확인",
        href: "music",
        meta: [{ label: "anchor 필요", value: `${state.brokenCues}개` }]
      });
    }
    if (roles.includes("STAGE_MANAGER") && !state.hasStagePlan) {
      cards.push({
        title: "무대 플랜 생성이 필요해요",
        description: "배우 위치, 대본대, 장비, 소품 배치를 장면별 세팅 메모와 연결해 주세요.",
        severity: "warning",
        resourceType: "stage",
        resourceId: null,
        primaryActionLabel: "무대 플랜",
        href: "stage"
      });
    }
    if (roles.includes("STAGE_MANAGER") && state.hasStagePlan && state.stageSceneNotes === 0) {
      cards.push({
        title: "장면별 세팅 메모가 필요해요",
        description: "진행표가 장면별 전환·준비물을 끌어올 수 있도록 StageSceneNote를 남겨 주세요.",
        severity: "info",
        resourceType: "stage",
        resourceId: null,
        primaryActionLabel: "세팅 메모",
        href: "stage"
      });
    }
    if ((roles.includes("DIRECTOR") || roles.includes("STAGE_MANAGER")) && !state.hasRunSheet) {
      cards.push({
        title: "진행표 생성이 필요해요",
        description: "일정, 장면, 음악 큐, 무대 메모, 체크리스트를 실행 순서로 묶어야 해요.",
        severity: "info",
        resourceType: "runSheet",
        resourceId: null,
        primaryActionLabel: "진행표 만들기",
        href: "run-sheets"
      });
    }
    if (
      (roles.includes("PRODUCER") || roles.includes("DIRECTOR") || roles.includes("STAGE_MANAGER") || roles.includes("MUSIC_DIRECTOR")) &&
      state.hasLockedRunSheet &&
      state.nextReadingEventId
    ) {
      cards.push({
        title: "확정 진행표로 리딩을 진행할 수 있어요",
        description: "LOCKED 진행표 기준으로 현재 항목, 다음 항목, cue-fire, 완료 로그를 남길 수 있어요.",
        severity: "info",
        resourceType: "reading",
        resourceId: state.nextReadingEventId,
        primaryActionLabel: "리딩 진행",
        href: `reading/${state.nextReadingEventId}`
      });
    }
    if (state.myAssignedChecklistOpen > 0 || state.myRoleChecklistOpen > 0 || state.myStaffChecklistOpen > 0) {
      const checklistHref = state.myChecklistTarget
        ? `checklist?${new URLSearchParams({ scope: "mine", phase: state.myChecklistTarget.phaseCode, item: state.myChecklistTarget.id }).toString()}`
        : "checklist?scope=mine";
      cards.push({
        title: "내가 처리할 체크리스트가 있어요",
        description: "직접 배정, 역할 배정, 스태프 직무 기준으로 열린 항목을 확인하고 완료 요청을 남겨 주세요.",
        severity: state.myWaitingApproval > 0 ? "info" : "warning",
        resourceType: "checklist",
        resourceId: state.myChecklistTarget?.id ?? null,
        primaryActionLabel: "체크리스트",
        href: checklistHref,
        meta: [
          { label: "직접", value: `${state.myAssignedChecklistOpen}개` },
          { label: "역할/직무", value: `${state.myRoleChecklistOpen + state.myStaffChecklistOpen}개` },
          ...(state.myWaitingApproval > 0 ? [{ label: "승인대기", value: `${state.myWaitingApproval}개` }] : [])
        ]
      });
    }
    if (state.myRunSheetItems.length > 0) {
      const firstItem = state.myRunSheetItems[0];
      cards.push({
        title: "진행표에 내 담당 항목이 있어요",
        description: `${firstItem.title}${state.myRunSheetItems.length > 1 ? ` 외 ${state.myRunSheetItems.length - 1}개 항목` : ""}을 리딩 전 확인해 주세요.`,
        severity: "info",
        resourceType: "runSheetItem",
        resourceId: firstItem.id,
        primaryActionLabel: "진행표",
        href: `run-sheets?${new URLSearchParams({
          scope: "mine",
          event: firstItem.runSheet.eventId,
          sheet: firstItem.runSheet.id,
          item: firstItem.id
        }).toString()}`,
        meta: [{ label: "미완료", value: `${state.myRunSheetItems.length}개` }]
      });
    }
    if (roles.includes("ACTOR")) {
      cards.push({
        title: state.myRoleNames.length > 0 ? "내 장면과 대사를 확인해 주세요" : "아직 배정된 배역이 없어요",
        description:
          state.myRoleNames.length > 0
            ? `${state.myRoleNames.join(", ")} 기준 ${state.mySceneCount}개 장면, 대사/가사 ${state.myDialogueBlocks}개 블록을 확인할 수 있어요.`
            : "배정 후 본인 장면, 대사, 가사, 큐 마커가 대본 뷰어에 강조돼요.",
        severity: "info",
        resourceType: "script",
        resourceId: state.myScriptTarget?.id ?? state.myScriptTarget?.sceneId ?? null,
        primaryActionLabel: "대본 보기",
        href: state.myScriptTarget
          ? `script/read?${new URLSearchParams({ scene: state.myScriptTarget.sceneId, block: state.myScriptTarget.id }).toString()}`
          : "script/read",
        meta:
          state.myRoleNames.length > 0
            ? [
                { label: "장면", value: `${state.mySceneCount}개` },
                { label: "가사", value: `${state.myLyricBlocks}개` }
              ]
            : undefined
      });
    }
    if (roles.includes("STAFF")) {
      if (state.myStaffDisciplines.length === 0) {
        cards.push({
          title: "스태프 세부 직무 지정이 필요해요",
          description: "음향, 조명, 소품 등 실제 담당 직무가 지정되어야 체크리스트와 진행표 담당 항목이 정확히 보입니다.",
          severity: "warning",
          resourceType: "staffAssignment",
          resourceId: null,
          primaryActionLabel: "참여자 확인",
          href: "people"
        });
      } else {
        cards.push({
          title: "내 스태프 직무 기준 업무를 확인해 주세요",
          description: `${state.myStaffDisciplines.map((assignment) => assignment.label).join(", ")} 담당으로 연결된 체크리스트, 일정, 진행표 항목을 확인합니다.`,
          severity: "info",
          resourceType: "staffAssignment",
          resourceId: state.myChecklistTarget?.id ?? null,
          primaryActionLabel: "체크리스트",
          href: state.myChecklistTarget
            ? `checklist?${new URLSearchParams({ scope: "mine", phase: state.myChecklistTarget.phaseCode, item: state.myChecklistTarget.id }).toString()}`
            : "checklist?scope=mine",
          meta: state.myStaffDisciplines.map((assignment) => ({ label: "직무", value: assignment.label }))
        });
      }
    }
    return cards;
  }

  private isChecklistDone(status: ChecklistStatus) {
    return status === ChecklistStatus.DONE;
  }

  private uniqueChecklistItems<T extends { id: string }>(items: T[]) {
    const seen = new Set<string>();
    return items.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }

  private uniqueCastRoles<T extends { id: string; name: string }>(roles: T[]) {
    const seen = new Set<string>();
    return roles
      .filter((role) => {
        if (seen.has(role.id)) return false;
        seen.add(role.id);
        return true;
      })
      .map((role) => ({ id: role.id, name: role.name }));
  }

  private notificationMeta(notifications: Array<{ type: string }>) {
    const counts = notifications.reduce<Record<string, number>>((acc, notification) => {
      const label = this.notificationLabel(notification.type);
      acc[label] = (acc[label] ?? 0) + 1;
      return acc;
    }, {});
    return Object.entries(counts)
      .slice(0, 3)
      .map(([label, count]) => ({ label, value: `${count}건` }));
  }

  private notificationLabel(type: string) {
    if (type.startsWith("schedule.")) return "일정";
    if (type.startsWith("script.")) return "대본";
    if (type.startsWith("music.")) return "음악";
    if (type.startsWith("checklist.")) return "체크";
    if (type.startsWith("READING_SESSION")) return "리딩";
    return "변경";
  }
}
