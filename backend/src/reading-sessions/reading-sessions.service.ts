import { BadRequestException, ConflictException, ForbiddenException, GoneException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomBytes } from "node:crypto";
import {
  ChecklistStatus,
  LinkedResourceType,
  Phase,
  Prisma,
  ProductionRole,
  RunSheetStatus,
  StaffDiscipline
} from "@prisma/client";
import type { RequestUser } from "../common/types/request-user";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateGuestReadingAccessDto,
  EndReadingSessionDto,
  FireReadingCueDto,
  RevokeGuestReadingAccessDto,
  StartReadingSessionDto,
  UpdateReadingSessionDto
} from "./dto";
import { isPlatformAdmin } from "../common/access/is-production-admin";
import { assertProductionMembership } from "../common/access/assert-production-membership";

const VIEW_ROLES: ProductionRole[] = [
  ProductionRole.PRODUCER,
  ProductionRole.DIRECTOR,
  ProductionRole.MUSIC_DIRECTOR,
  ProductionRole.STAGE_MANAGER,
  ProductionRole.ACTOR,
  ProductionRole.STAFF,
  ProductionRole.GUEST
];
const OPERATOR_ROLES: ProductionRole[] = [
  ProductionRole.PRODUCER,
  ProductionRole.DIRECTOR,
  ProductionRole.MUSIC_DIRECTOR,
  ProductionRole.STAGE_MANAGER
];
const START_END_ROLES: ProductionRole[] = [ProductionRole.PRODUCER, ProductionRole.DIRECTOR, ProductionRole.STAGE_MANAGER];
const PAGE_SYNC_ROLES: ProductionRole[] = [ProductionRole.PRODUCER, ProductionRole.DIRECTOR];
const CUE_FIRE_ROLES: ProductionRole[] = [ProductionRole.PRODUCER, ProductionRole.DIRECTOR, ProductionRole.MUSIC_DIRECTOR];
const CUE_FIRE_GATE_ROLES: ProductionRole[] = [...CUE_FIRE_ROLES, ProductionRole.STAFF];
const CUE_FIRE_STAFF_DISCIPLINES: StaffDiscipline[] = [StaffDiscipline.SOUND, StaffDiscipline.ACCOMPANIST];
const READING_LIVE_TRANSPORT = "socket.io+polling";
const READING_LIVE_EVENTS = ["session-started", "page-sync", "cue-fire", "session-ended"];

type MembershipContext = Prisma.MembershipGetPayload<{ include: { roles: true; staffAssignments: true } }>;
type RunSheetForReading = Prisma.RunSheetGetPayload<{ include: ReturnType<ReadingSessionsService["runSheetInclude"]> }>;
type RunSheetItemForReading = RunSheetForReading["items"][number];
type GuestAccessRecord = {
  id: string;
  productionId: string;
  eventId: string;
  token: string;
  label: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
  createdById: string;
  lastViewedAt: Date | null;
  createdAt: Date;
};
type PositionSourceItem = {
  sceneId?: string | null;
  cue?: { sceneId?: string | null; anchorBlockId?: string | null } | null;
  stageSceneNote?: { sceneId?: string | null } | null;
};

@Injectable()
export class ReadingSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService
  ) {}

  async listGuestLinks(productionId: string, eventId: string, user: RequestUser) {
    await this.assertMembership(productionId, user, START_END_ROLES);
    await this.assertEvent(productionId, eventId);
    const links = await this.prisma.guestReadingAccess.findMany({
      where: { productionId, eventId },
      orderBy: { createdAt: "desc" },
      select: this.guestAccessSelect()
    });
    return links.map((link) => this.toGuestAccessResponse(link));
  }

  async createGuestLink(productionId: string, eventId: string, dto: CreateGuestReadingAccessDto, user: RequestUser) {
    await this.assertMembership(productionId, user, START_END_ROLES);
    const event = await this.assertEvent(productionId, eventId);
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : new Date(Math.max(event.endAt.getTime(), Date.now()) + 1000 * 60 * 60 * 24);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException("게스트 링크 만료 시각은 현재 이후여야 해요");
    }

    const access = await this.prisma.guestReadingAccess.create({
      data: {
        productionId,
        eventId,
        token: randomBytes(32).toString("base64url"),
        label: dto.label?.trim() || null,
        expiresAt,
        createdById: user.id
      },
      select: this.guestAccessSelect()
    });
    await this.prisma.activityLog.create({
      data: {
        productionId,
        actorId: user.id,
        action: "GUEST_READING_LINK_CREATED",
        entity: "GuestReadingAccess",
        entityId: access.id,
        reason: access.label || "게스트 리딩 링크 생성",
        afterJson: { eventId, expiresAt: expiresAt.toISOString(), label: access.label } as Prisma.InputJsonValue
      }
    });
    return this.toGuestAccessResponse(access);
  }

  async revokeGuestLink(productionId: string, eventId: string, guestAccessId: string, dto: RevokeGuestReadingAccessDto, user: RequestUser) {
    await this.assertMembership(productionId, user, START_END_ROLES);
    await this.assertEvent(productionId, eventId);
    const revokeReason = dto.reason?.trim();
    if (!revokeReason) {
      throw new BadRequestException("게스트 링크 회수 사유를 입력해 주세요");
    }

    const current = await this.prisma.guestReadingAccess.findFirst({
      where: { id: guestAccessId, productionId, eventId },
      select: this.guestAccessSelect()
    });
    if (!current) {
      throw new NotFoundException("게스트 리딩 링크를 찾을 수 없어요");
    }
    if (current.revokedAt) {
      return this.toGuestAccessResponse(current);
    }

    const revoked = await this.prisma.guestReadingAccess.update({
      where: { id: current.id },
      data: { revokedAt: new Date() },
      select: this.guestAccessSelect()
    });
    await this.prisma.activityLog.create({
      data: {
        productionId,
        actorId: user.id,
        action: "GUEST_READING_LINK_REVOKED",
        entity: "GuestReadingAccess",
        entityId: revoked.id,
        reason: revokeReason,
        beforeJson: { expiresAt: current.expiresAt.toISOString(), revokedAt: current.revokedAt, label: current.label } as Prisma.InputJsonValue,
        afterJson: { revokedAt: revoked.revokedAt?.toISOString() ?? null, label: revoked.label } as Prisma.InputJsonValue
      }
    });
    return this.toGuestAccessResponse(revoked);
  }

  async getGuestWorkspace(token: string) {
    const access = await this.prisma.guestReadingAccess.findUnique({
      where: { token },
      select: {
        ...this.guestAccessSelect(),
        production: { select: { id: true, title: true, currentPhase: true, visibility: true } },
        event: { select: { id: true, title: true, startAt: true, endAt: true } }
      }
    });
    if (!access) {
      throw new NotFoundException("게스트 리딩 링크를 찾을 수 없어요");
    }
    if (access.revokedAt) {
      throw new GoneException("게스트 리딩 링크가 회수됐어요");
    }
    if (access.expiresAt.getTime() <= Date.now()) {
      throw new GoneException("게스트 리딩 링크가 만료됐어요");
    }

    await this.prisma.guestReadingAccess.update({
      where: { id: access.id },
      data: { lastViewedAt: new Date() }
    });

    const [event, runSheets, activeSession, endedSessions, scenes, cueFireLogs] = await Promise.all([
      this.prisma.scheduleEvent.findFirst({
        where: { id: access.eventId, productionId: access.productionId },
        include: this.guestEventInclude()
      }),
      this.prisma.runSheet.findMany({
        where: { productionId: access.productionId, eventId: access.eventId },
        orderBy: [{ status: "asc" }, { version: "desc" }],
        include: this.guestRunSheetInclude()
      }),
      this.prisma.readingSession.findFirst({
        where: { productionId: access.productionId, eventId: access.eventId, endedAt: null },
        orderBy: { createdAt: "desc" },
        include: this.guestSessionInclude()
      }),
      this.prisma.readingSession.findMany({
        where: { productionId: access.productionId, eventId: access.eventId, endedAt: { not: null } },
        orderBy: { endedAt: "desc" },
        take: 5,
        include: this.guestSessionInclude()
      }),
      this.getProductionScenes(access.productionId),
      this.prisma.cueFireLog.findMany({
        where: { session: { productionId: access.productionId, eventId: access.eventId } },
        orderBy: { firedAt: "desc" },
        take: 50,
        include: { cue: { include: this.cueInclude() } }
      })
    ]);
    if (!event) {
      throw new NotFoundException("게스트 리딩 일정을 찾을 수 없어요");
    }

    const lockedRunSheets = runSheets.filter((sheet) => sheet.status === RunSheetStatus.LOCKED);
    const preferredRunSheet = activeSession?.runSheet ?? lockedRunSheets[0] ?? null;

    return {
      guestAccess: this.toGuestAccessResponse(access),
      production: access.production,
      event: { ...event, attendances: [] },
      myMembershipId: null,
      myRoles: [ProductionRole.GUEST],
      isEventParticipant: true,
      isGuestToken: true,
      permissions: this.buildGuestPermissions(),
      activeSession,
      endedSessions,
      runSheets,
      preferredRunSheet,
      scenes,
      cueFireLogs,
      liveContract: {
        room: `reading-session:${access.eventId}`,
        transport: READING_LIVE_TRANSPORT,
        events: READING_LIVE_EVENTS,
        participantAutoplay: false
      },
      fallbackWarning:
        lockedRunSheets.length === 0
          ? "잠긴 진행표가 없어 장면·큐 목록 기준으로 관람합니다. 진행자는 실제 리딩 전 진행표를 생성하고 잠글 수 있어요."
          : null
    };
  }

  async getEventWorkspace(productionId: string, eventId: string, user: RequestUser) {
    const membership = await this.assertMembership(productionId, user, VIEW_ROLES);
    const event = await this.assertEvent(productionId, eventId);
    await this.assertEventVisibility(event.id, membership, user);

    const [production, runSheets, activeSession, endedSessions, scenes, cueFireLogs] = await Promise.all([
      this.prisma.production.findUnique({
        where: { id: productionId },
        select: { id: true, title: true, currentPhase: true, visibility: true }
      }),
      this.prisma.runSheet.findMany({
        where: { productionId, eventId },
        orderBy: [{ status: "asc" }, { version: "desc" }],
        include: this.runSheetInclude()
      }),
      this.prisma.readingSession.findFirst({
        where: { productionId, eventId, endedAt: null },
        orderBy: { createdAt: "desc" },
        include: this.sessionInclude()
      }),
      this.prisma.readingSession.findMany({
        where: { productionId, eventId, endedAt: { not: null } },
        orderBy: { endedAt: "desc" },
        take: 5,
        include: this.sessionInclude()
      }),
      this.getProductionScenes(productionId),
      this.prisma.cueFireLog.findMany({
        where: { session: { productionId, eventId } },
        orderBy: { firedAt: "desc" },
        take: 50,
        include: { cue: { include: this.cueInclude() } }
      })
    ]);

    if (!production) {
      throw new NotFoundException("공연을 찾을 수 없어요");
    }

    const myRoles = this.rolesOf(membership);
    const lockedRunSheets = runSheets.filter((sheet) => sheet.status === RunSheetStatus.LOCKED);
    const preferredRunSheet = activeSession?.runSheet ?? lockedRunSheets[0] ?? null;
    const attended = event.attendances.some((attendance) => attendance.membershipId === membership?.id);

    return {
      production,
      event,
      myMembershipId: membership?.id ?? null,
      myRoles,
      isEventParticipant: isPlatformAdmin(user) || attended || this.hasAnyRole(myRoles, OPERATOR_ROLES),
      permissions: this.buildPermissions(user, membership),
      activeSession,
      endedSessions,
      runSheets,
      preferredRunSheet,
      scenes,
      cueFireLogs,
      liveContract: {
        room: `reading-session:${eventId}`,
        transport: READING_LIVE_TRANSPORT,
        events: READING_LIVE_EVENTS,
        participantAutoplay: false
      },
      fallbackWarning:
        lockedRunSheets.length === 0
          ? "잠긴 진행표가 없어 장면·큐 목록 기준으로 진행합니다. 실제 리딩 전 진행표를 생성하고 잠그는 것을 권장합니다."
          : null
    };
  }

  async getSession(productionId: string, sessionId: string, user: RequestUser) {
    const membership = await this.assertMembership(productionId, user, VIEW_ROLES);
    const session = await this.assertSession(productionId, sessionId);
    if (session.eventId) {
      await this.assertEventVisibility(session.eventId, membership, user);
    }
    return {
      session,
      permissions: this.buildPermissions(user, membership),
      liveContract: {
        room: session.eventId ? `reading-session:${session.eventId}` : `reading-session:${session.id}`,
        transport: READING_LIVE_TRANSPORT,
        events: READING_LIVE_EVENTS,
        participantAutoplay: false
      }
    };
  }

  async startSession(productionId: string, dto: StartReadingSessionDto, user: RequestUser) {
    await this.assertMembership(productionId, user, START_END_ROLES);
    const event = await this.assertEvent(productionId, dto.eventId);
    const activeSession = await this.prisma.readingSession.findFirst({
      where: { productionId, eventId: event.id, endedAt: null },
      orderBy: { createdAt: "desc" },
      include: this.sessionInclude()
    });

    if (activeSession) {
      return { session: activeSession, reusedActive: true };
    }

    const runSheet = await this.resolveRunSheet(productionId, event.id, dto.runSheetId);
    const initialPosition = await this.resolveInitialPosition(productionId, runSheet, dto.currentSceneId, dto.currentBlockId);
    const session = await this.prisma.readingSession.create({
      data: {
        productionId,
        eventId: event.id,
        runSheetId: runSheet?.id ?? null,
        startedAt: new Date(),
        currentSceneId: initialPosition.currentSceneId,
        currentBlockId: initialPosition.currentBlockId,
        progressNote: dto.progressNote?.trim() || null
      },
      include: this.sessionInclude()
    });

    await this.createNotificationsForEvent(event.id, productionId, user.id, "READING_SESSION_STARTED", {
      eventId: event.id,
      sessionId: session.id,
      runSheetId: session.runSheetId,
      title: event.title
    });
    const liveEvent = {
      type: "session-started",
      sessionId: session.id,
      eventId: event.id,
      productionId,
      runSheetId: session.runSheetId,
      currentSceneId: session.currentSceneId,
      currentBlockId: session.currentBlockId,
      participantAutoplay: false
    };
    this.notifications.emitReadingSessionEvent(event.id, liveEvent);

    return { session, reusedActive: false, liveEvent };
  }

  async updateSession(productionId: string, sessionId: string, dto: UpdateReadingSessionDto, user: RequestUser) {
    await this.assertMembership(productionId, user, PAGE_SYNC_ROLES);
    const session = await this.assertActiveSession(productionId, sessionId);
    const position = await this.resolveUpdatePosition(productionId, session.runSheetId, dto);

    const updated = await this.prisma.readingSession.update({
      where: { id: session.id },
      data: {
        currentSceneId: position.currentSceneId,
        currentBlockId: position.currentBlockId,
        progressNote: dto.progressNote === undefined ? undefined : dto.progressNote?.trim() || null
      },
      include: this.sessionInclude()
    });

    const liveEvent = {
      type: "page-sync",
      sessionId: updated.id,
      eventId: updated.eventId,
      productionId,
      currentSceneId: updated.currentSceneId,
      currentBlockId: updated.currentBlockId,
      syncedRunSheetItemId: dto.runSheetItemId ?? null,
      progressNote: updated.progressNote,
      participantAutoplay: false
    };
    this.notifications.emitReadingSessionEvent(updated.eventId, liveEvent);

    return {
      session: updated,
      syncedRunSheetItemId: dto.runSheetItemId ?? null,
      liveEvent
    };
  }

  async fireCue(productionId: string, sessionId: string, dto: FireReadingCueDto, user: RequestUser) {
    const membership = await this.assertMembership(productionId, user, CUE_FIRE_GATE_ROLES);
    this.assertCanFireCue(user, membership);
    const [session, cue] = await Promise.all([this.assertActiveSession(productionId, sessionId), this.assertCue(productionId, dto.cueId)]);
    if (dto.runSheetItemId) {
      await this.assertRunSheetItemForCue(session.runSheetId, dto.runSheetItemId, cue.id);
    }

    const payload = {
      cueNumber: cue.cueNumber,
      cueType: cue.cueType,
      trackStartMs: cue.trackStartMs,
      trackEndMs: cue.trackEndMs,
      fireMode: cue.fireMode,
      runSheetItemId: dto.runSheetItemId ?? null,
      note: dto.note?.trim() || null,
      clientTimeMs: dto.clientTimeMs ?? null,
      participantAutoplay: false,
      ...(dto.payload ?? {})
    } satisfies Prisma.InputJsonObject;

    const [log, updated] = await this.prisma.$transaction([
      this.prisma.cueFireLog.create({
        data: {
          sessionId: session.id,
          cueId: cue.id,
          firedById: user.id,
          payload
        },
        include: { cue: { include: this.cueInclude() } }
      }),
      this.prisma.readingSession.update({
        where: { id: session.id },
        data: {
          currentSceneId: cue.sceneId ?? session.currentSceneId,
          currentBlockId: cue.anchorBlockId ?? session.currentBlockId
        },
        include: this.sessionInclude()
      })
    ]);

    const liveEvent = {
      type: "cue-fire",
      sessionId: updated.id,
      eventId: updated.eventId,
      productionId,
      cueId: cue.id,
      cueFireLogId: log.id,
      currentSceneId: updated.currentSceneId,
      currentBlockId: updated.currentBlockId,
      participantAutoplay: false
    };
    this.notifications.emitReadingSessionEvent(updated.eventId, liveEvent);

    return {
      session: updated,
      cueFireLog: log,
      liveEvent
    };
  }

  async endSession(productionId: string, sessionId: string, dto: EndReadingSessionDto, user: RequestUser) {
    await this.assertMembership(productionId, user, START_END_ROLES);
    const session = await this.assertSession(productionId, sessionId);
    const note = dto.progressNote?.trim() || session.progressNote || null;

    if (!session.endedAt) {
      await this.prisma.readingSession.update({
        where: { id: session.id },
        data: { endedAt: new Date(), progressNote: note }
      });
    }

    const ended = await this.assertSession(productionId, sessionId);
    const endedRunSheet = ended.runSheet as RunSheetForReading | null;
    const incompleteItems = endedRunSheet?.items.filter((item) => !item.completedAt) ?? [];
    const followUpItems =
      dto.createFollowUpChecklist ?? true
        ? await this.createFollowUpChecklistItems(productionId, ended.eventId, incompleteItems, note)
        : [];

    if (ended.eventId) {
      await this.createNotificationsForEvent(ended.eventId, productionId, user.id, "READING_SESSION_ENDED", {
        eventId: ended.eventId,
        sessionId: ended.id,
        incompleteRunSheetItems: incompleteItems.length,
        followUpChecklistItems: followUpItems.length
      });
    }

    const finalSession = await this.assertSession(productionId, sessionId);
    const liveEvent = {
      type: "session-ended",
      sessionId: ended.id,
      eventId: ended.eventId,
      productionId,
      incompleteRunSheetItems: incompleteItems.length,
      followUpChecklistItems: followUpItems.length,
      participantAutoplay: false
    };
    this.notifications.emitReadingSessionEvent(ended.eventId, liveEvent);

    return {
      session: finalSession,
      incompleteRunSheetItems: incompleteItems.map((item) => ({
        id: item.id,
        order: item.order,
        itemType: item.itemType,
        title: item.title,
        ownerRole: item.ownerRole,
        staffDiscipline: item.staffDiscipline
      })),
      followUpChecklistItems: followUpItems,
      liveEvent
    };
  }

  private async assertMembership(productionId: string, user: RequestUser, roles: ProductionRole[]) {
    return assertProductionMembership(this.prisma, user, productionId, roles, {
      include: { roles: true, staffAssignments: true }
    });
  }

  private async assertEvent(productionId: string, eventId: string) {
    const event = await this.prisma.scheduleEvent.findFirst({
      where: { id: eventId, productionId },
      include: this.eventInclude()
    });
    if (!event) {
      throw new NotFoundException("일정을 찾을 수 없어요");
    }
    return event;
  }

  private async assertEventVisibility(eventId: string, membership: MembershipContext | null, user: RequestUser) {
    if (isPlatformAdmin(user)) return;
    if (!membership) {
      throw new ForbiddenException("이 리딩 일정에 접근할 권한이 없어요");
    }
    const roles = this.rolesOf(membership);
    if (this.hasAnyRole(roles, OPERATOR_ROLES)) return;
    const count = await this.prisma.attendance.count({ where: { eventId, membershipId: membership.id } });
    if (!count) {
      throw new ForbiddenException("참석자로 등록된 리딩 일정만 볼 수 있어요");
    }
  }

  private async assertSession(productionId: string, sessionId: string) {
    const session = await this.prisma.readingSession.findFirst({
      where: { id: sessionId, productionId },
      include: this.sessionInclude()
    });
    if (!session) {
      throw new NotFoundException("리딩 세션을 찾을 수 없어요");
    }
    return session;
  }

  private async assertActiveSession(productionId: string, sessionId: string) {
    const session = await this.assertSession(productionId, sessionId);
    if (session.endedAt) {
      throw new ConflictException("이미 종료된 리딩 세션이에요");
    }
    return session;
  }

  private async assertCue(productionId: string, cueId: string) {
    const cue = await this.prisma.musicCue.findFirst({ where: { id: cueId, productionId }, include: this.cueInclude() });
    if (!cue) {
      throw new NotFoundException("음악 큐를 찾을 수 없어요");
    }
    return cue;
  }

  private async assertRunSheetItemForCue(runSheetId: string | null, itemId: string, cueId: string) {
    if (!runSheetId) {
      throw new BadRequestException("진행표가 연결되지 않은 세션에서는 진행표 항목 cue-fire를 사용할 수 없어요");
    }
    const item = await this.prisma.runSheetItem.findFirst({ where: { id: itemId, runSheetId }, select: { id: true, cueId: true } });
    if (!item) {
      throw new NotFoundException("진행표 항목을 찾을 수 없어요");
    }
    if (item.cueId !== cueId) {
      throw new BadRequestException("진행표 항목과 cue-fire 대상 큐가 달라요");
    }
  }

  private async resolveRunSheet(productionId: string, eventId: string, runSheetId?: string | null) {
    const where = runSheetId ? { id: runSheetId, productionId, eventId } : { productionId, eventId, status: RunSheetStatus.LOCKED };
    const runSheet = await this.prisma.runSheet.findFirst({
      where,
      orderBy: runSheetId ? undefined : { version: "desc" },
      include: this.runSheetInclude()
    });

    if (runSheetId && !runSheet) {
      throw new NotFoundException("리딩에 사용할 진행표를 찾을 수 없어요");
    }
    if (runSheet && runSheet.status !== RunSheetStatus.LOCKED) {
      throw new ConflictException("LOCKED 진행표만 리딩 진행에 연결할 수 있어요");
    }
    return runSheet;
  }

  private async resolveInitialPosition(productionId: string, runSheet: RunSheetForReading | null, sceneId?: string | null, blockId?: string | null) {
    if (sceneId || blockId) {
      return this.resolveExplicitPosition(productionId, sceneId, blockId);
    }
    const firstItem = runSheet?.items[0] ?? null;
    if (firstItem) {
      return this.positionFromRunSheetItem(firstItem);
    }
    const firstScene = await this.prisma.scene.findFirst({
      where: { act: { script: { productionId } } },
      orderBy: [{ act: { order: "asc" } }, { order: "asc" }],
      select: { id: true, blocks: { orderBy: { order: "asc" }, take: 1, select: { id: true } } }
    });
    return {
      currentSceneId: firstScene?.id ?? null,
      currentBlockId: firstScene?.blocks[0]?.id ?? null
    };
  }

  private async resolveUpdatePosition(productionId: string, runSheetId: string | null, dto: UpdateReadingSessionDto) {
    if (dto.runSheetItemId) {
      if (!runSheetId) {
        throw new BadRequestException("진행표가 연결되지 않은 세션이에요");
      }
      const item = await this.prisma.runSheetItem.findFirst({
        where: { id: dto.runSheetItemId, runSheetId },
        include: this.itemInclude()
      });
      if (!item) {
        throw new NotFoundException("진행표 항목을 찾을 수 없어요");
      }
      return this.positionFromRunSheetItem(item);
    }
    if (dto.currentSceneId !== undefined || dto.currentBlockId !== undefined) {
      return this.resolveExplicitPosition(productionId, dto.currentSceneId, dto.currentBlockId);
    }
    return { currentSceneId: undefined, currentBlockId: undefined };
  }

  private async resolveExplicitPosition(productionId: string, sceneId?: string | null, blockId?: string | null) {
    let currentSceneId = sceneId || null;
    let currentBlockId = blockId || null;
    if (currentBlockId) {
      const block = await this.prisma.sceneBlock.findFirst({
        where: { id: currentBlockId, scene: { act: { script: { productionId } } } },
        select: { id: true, sceneId: true }
      });
      if (!block) {
        throw new BadRequestException("이 공연에 속하지 않는 대본 블록이에요");
      }
      if (currentSceneId && currentSceneId !== block.sceneId) {
        throw new BadRequestException("현재 장면과 대본 블록의 장면이 달라요");
      }
      currentSceneId = block.sceneId;
      currentBlockId = block.id;
    }
    if (currentSceneId) {
      const scene = await this.prisma.scene.findFirst({
        where: { id: currentSceneId, act: { script: { productionId } } },
        select: { id: true }
      });
      if (!scene) {
        throw new BadRequestException("이 공연에 속하지 않는 장면이에요");
      }
    }
    return { currentSceneId, currentBlockId };
  }

  private positionFromRunSheetItem(item: PositionSourceItem) {
    return {
      currentSceneId: item.sceneId ?? item.cue?.sceneId ?? item.stageSceneNote?.sceneId ?? null,
      currentBlockId: item.cue?.anchorBlockId ?? null
    };
  }

  private async createFollowUpChecklistItems(
    productionId: string,
    eventId: string | null,
    items: RunSheetItemForReading[],
    progressNote: string | null
  ) {
    if (items.length === 0) return [];
    const phase = await this.prisma.checklistPhase.upsert({
      where: { productionId_phase: { productionId, phase: Phase.READING } },
      update: {},
      create: { productionId, phase: Phase.READING }
    });
    const aggregate = await this.prisma.checklistItem.aggregate({
      where: { phaseId: phase.id },
      _max: { order: true }
    });
    let order = aggregate._max.order ?? 0;
    const created = [];

    for (const item of items) {
      const existing = await this.prisma.checklistItem.findFirst({
        where: { phaseId: phase.id, linkedResourceType: LinkedResourceType.RUN_SHEET_ITEM, linkedResourceId: item.id },
        include: this.checklistItemInclude()
      });
      if (existing) {
        created.push(await this.ensureFollowUpChecklistAssignment(existing.id, item.ownerMembershipId));
        continue;
      }
      order += 1;
      created.push(
        await this.prisma.checklistItem.create({
          data: {
            phaseId: phase.id,
            eventId,
            order,
            label: `리딩 후속: ${item.title}`,
            description: [item.note, progressNote ? `리딩 메모: ${progressNote}` : null].filter(Boolean).join("\n") || null,
            status: ChecklistStatus.TODO,
            assigneeRole: item.ownerRole,
            staffDiscipline: item.staffDiscipline,
            linkedResourceType: LinkedResourceType.RUN_SHEET_ITEM,
            linkedResourceId: item.id,
            assignments: item.ownerMembershipId ? { create: { membershipId: item.ownerMembershipId } } : undefined
          },
          include: this.checklistItemInclude()
        })
      );
    }
    return created;
  }

  private async ensureFollowUpChecklistAssignment(itemId: string, membershipId: string | null) {
    if (membershipId) {
      await this.prisma.checklistAssignment.upsert({
        where: { itemId_membershipId: { itemId, membershipId } },
        update: {},
        create: { itemId, membershipId }
      });
    }
    const item = await this.prisma.checklistItem.findUnique({
      where: { id: itemId },
      include: this.checklistItemInclude()
    });
    if (!item) {
      throw new NotFoundException("후속 체크리스트 항목을 찾을 수 없어요");
    }
    return item;
  }

  private async createNotificationsForEvent(
    eventId: string,
    productionId: string,
    actorId: string,
    type: string,
    payload: Record<string, unknown>
  ) {
    const attendances = await this.prisma.attendance.findMany({
      where: { eventId },
      select: { membership: { select: { userId: true } } }
    });
    const userIds = [...new Set(attendances.map((attendance) => attendance.membership.userId).filter((userId) => userId !== actorId))];
    if (userIds.length === 0) return;
    await this.notifications.createNotifications(
      userIds.map((userId) => ({
        productionId,
        userId,
        type,
        payload: payload as Prisma.InputJsonValue
      }))
    );
  }

  private buildPermissions(user: RequestUser, membership: MembershipContext | null) {
    const roles = this.rolesOf(membership);
    const isSuperAdmin = isPlatformAdmin(user);
    return {
      canStart: isSuperAdmin || this.hasAnyRole(roles, START_END_ROLES),
      canEnd: isSuperAdmin || this.hasAnyRole(roles, START_END_ROLES),
      canSyncPage: isSuperAdmin || this.hasAnyRole(roles, PAGE_SYNC_ROLES),
      canFireCue: this.canFireCue(user, membership),
      canCompleteRunSheetItems: isSuperAdmin || roles.some((role) => role !== ProductionRole.GUEST),
      participantAutoplay: false
    };
  }

  private buildGuestPermissions() {
    return {
      canStart: false,
      canEnd: false,
      canSyncPage: false,
      canFireCue: false,
      canCompleteRunSheetItems: false,
      participantAutoplay: false
    };
  }

  private rolesOf(membership: MembershipContext | null) {
    return membership?.roles.map((role) => role.role) ?? [];
  }

  private assertCanFireCue(user: RequestUser, membership: MembershipContext | null) {
    if (this.canFireCue(user, membership)) return;
    throw new ForbiddenException("음악 큐를 발동할 권한이 없어요");
  }

  private canFireCue(user: RequestUser, membership: MembershipContext | null) {
    if (isPlatformAdmin(user)) return true;
    const roles = this.rolesOf(membership);
    return this.hasAnyRole(roles, CUE_FIRE_ROLES) || this.hasAnyStaffDiscipline(membership, CUE_FIRE_STAFF_DISCIPLINES);
  }

  private hasAnyStaffDiscipline(membership: MembershipContext | null, allowed: StaffDiscipline[]) {
    return !!membership?.staffAssignments.some((assignment) => allowed.includes(assignment.discipline));
  }

  private hasAnyRole(roles: ProductionRole[], allowed: ProductionRole[]) {
    return roles.some((role) => allowed.includes(role));
  }

  private getProductionScenes(productionId: string) {
    return this.prisma.scene.findMany({
      where: { act: { script: { productionId } } },
      orderBy: [{ act: { order: "asc" } }, { order: "asc" }],
      include: {
        act: { select: { id: true, title: true, order: true } },
        blocks: {
          orderBy: { order: "asc" },
          select: {
            id: true,
            order: true,
            type: true,
            character: { select: { id: true, name: true } },
            cueLabel: true,
            text: true
          }
        }
      }
    });
  }

  private sessionInclude(): Prisma.ReadingSessionInclude {
    return {
      event: { include: this.eventInclude() },
      runSheet: { include: this.runSheetInclude() },
      cueFireLogs: {
        orderBy: { firedAt: "desc" },
        take: 100,
        include: { cue: { include: this.cueInclude() } }
      }
    };
  }

  private runSheetInclude(): Prisma.RunSheetInclude {
    return {
      event: { include: this.eventInclude() },
      items: { orderBy: [{ order: "asc" }, { id: "asc" }], include: this.itemInclude() }
    };
  }

  private itemInclude(): Prisma.RunSheetItemInclude {
    return {
      scene: { select: { id: true, title: true, order: true, act: { select: { id: true, title: true, order: true } } } },
      cue: { include: this.cueInclude() },
      stageSceneNote: {
        select: {
          id: true,
          sceneId: true,
          note: true,
          scene: { select: { id: true, title: true, order: true, act: { select: { id: true, title: true, order: true } } } },
          stagePlan: {
            select: {
              id: true,
              name: true,
              layout: true,
              elements: { orderBy: [{ kind: "asc" }, { label: "asc" }], select: { id: true, kind: true, label: true, x: true, y: true, note: true } }
            }
          }
        }
      },
      checklistItem: { include: this.checklistItemInclude() },
      ownerMembership: { include: this.membershipInclude() }
    };
  }

  private eventInclude(): Prisma.ScheduleEventInclude {
    return {
      scenes: { include: { scene: { include: { act: { select: { id: true, title: true, order: true } } } } } },
      musicCues: { include: { cue: { include: this.cueInclude() } } },
      attendances: { include: { membership: { include: this.membershipInclude() } } },
      runSheets: { select: { id: true, title: true, version: true, status: true } },
      checklistItems: { select: { id: true, label: true, status: true } }
    };
  }

  private cueInclude(): Prisma.MusicCueInclude {
    return {
      track: { select: { id: true, title: true, durationMs: true, assetId: true } },
      scene: { select: { id: true, title: true, order: true, act: { select: { id: true, title: true, order: true } } } },
      anchorBlock: { select: { id: true, order: true, type: true, cueLabel: true, text: true } }
    };
  }

  private guestAccessSelect(): Prisma.GuestReadingAccessSelect {
    return {
      id: true,
      productionId: true,
      eventId: true,
      token: true,
      label: true,
      expiresAt: true,
      revokedAt: true,
      createdById: true,
      lastViewedAt: true,
      createdAt: true
    };
  }

  private toGuestAccessResponse(access: GuestAccessRecord) {
    return {
      id: access.id,
      productionId: access.productionId,
      eventId: access.eventId,
      token: access.token,
      label: access.label,
      expiresAt: access.expiresAt,
      revokedAt: access.revokedAt,
      createdById: access.createdById,
      lastViewedAt: access.lastViewedAt,
      createdAt: access.createdAt,
      path: `/r/${access.token}`,
      url: `${this.appPublicUrl()}/r/${access.token}`,
      active: !access.revokedAt && access.expiresAt.getTime() > Date.now()
    };
  }

  private appPublicUrl() {
    return (this.config.get<string>("APP_PUBLIC_URL") || "http://localhost:5173").replace(/\/$/, "");
  }

  private guestEventInclude(): Prisma.ScheduleEventInclude {
    return {
      scenes: { include: { scene: { include: { act: { select: { id: true, title: true, order: true } } } } } },
      musicCues: { include: { cue: { include: this.cueInclude() } } },
      runSheets: { select: { id: true, title: true, version: true, status: true } },
      checklistItems: { select: { id: true, label: true, status: true } }
    };
  }

  private guestSessionInclude(): Prisma.ReadingSessionInclude {
    return {
      event: { include: this.guestEventInclude() },
      runSheet: { include: this.guestRunSheetInclude() },
      cueFireLogs: {
        orderBy: { firedAt: "desc" },
        take: 100,
        include: { cue: { include: this.cueInclude() } }
      }
    };
  }

  private guestRunSheetInclude(): Prisma.RunSheetInclude {
    return {
      event: { include: this.guestEventInclude() },
      items: { orderBy: [{ order: "asc" }, { id: "asc" }], include: this.guestItemInclude() }
    };
  }

  private guestItemInclude(): Prisma.RunSheetItemInclude {
    return {
      scene: { select: { id: true, title: true, order: true, act: { select: { id: true, title: true, order: true } } } },
      cue: { include: this.cueInclude() },
      stageSceneNote: {
        select: {
          id: true,
          sceneId: true,
          note: true,
          scene: { select: { id: true, title: true, order: true, act: { select: { id: true, title: true, order: true } } } },
          stagePlan: {
            select: {
              id: true,
              name: true,
              layout: true,
              elements: { orderBy: [{ kind: "asc" }, { label: "asc" }], select: { id: true, kind: true, label: true, x: true, y: true, note: true } }
            }
          }
        }
      },
      checklistItem: { select: { id: true, label: true, status: true, description: true } }
    };
  }

  private checklistItemInclude(): Prisma.ChecklistItemInclude {
    return {
      phase: { select: { id: true, phase: true, productionId: true } },
      assignments: { include: { membership: { include: this.membershipInclude() } } }
    };
  }

  private membershipInclude(): Prisma.MembershipInclude {
    return {
      user: { select: { id: true, email: true, name: true, profileType: true, profileComplete: true } },
      roles: { select: { role: true } },
      staffAssignments: true
    };
  }
}
