import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { AttendanceStatus, EventType, Prisma, ProductionRole, StaffDiscipline } from "@prisma/client";
import type { RequestUser } from "../common/types/request-user";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateAvailabilityDto,
  CreateScheduleEventDto,
  DeleteScheduleEventDto,
  PutEventMusicCuesDto,
  PutEventScenesDto,
  UpdateAvailabilityDto,
  UpdateScheduleEventDto,
  UpsertAttendanceDto
} from "./dto";
import { isProductionAdmin } from "../common/access/is-production-admin";
import { assertProductionMembership } from "../common/access/assert-production-membership";
import { MEMBERSHIP_BASE_INCLUDE } from "../common/prisma-includes/membership.include";
import { escapeIcsText, foldIcsLines, formatIcsDate } from "./schedule-ics.util";
import { ScheduleNotificationsService } from "./schedule-notifications.service";
import { attendanceStatusLabel, toJson } from "./schedule-shared.util";

const VIEW_ROLES: ProductionRole[] = [
  ProductionRole.PRODUCER,
  ProductionRole.DIRECTOR,
  ProductionRole.MUSIC_DIRECTOR,
  ProductionRole.STAGE_MANAGER,
  ProductionRole.ACTOR,
  ProductionRole.STAFF,
  ProductionRole.GUEST
];

const FULL_EDIT_ROLES: ProductionRole[] = [ProductionRole.PRODUCER, ProductionRole.DIRECTOR, ProductionRole.STAGE_MANAGER];
const EDIT_ROLES: ProductionRole[] = [...FULL_EDIT_ROLES, ProductionRole.MUSIC_DIRECTOR];
// 일정 "등록"은 배우·스태프도 가능 — 공연 멤버 전원과 공유되는 스케줄을 만들 수 있다.
const CREATE_ROLES: ProductionRole[] = [...EDIT_ROLES, ProductionRole.ACTOR, ProductionRole.STAFF];
const STAGE_NOTE_STAFF_DISCIPLINES: StaffDiscipline[] = [
  StaffDiscipline.STAGE_CREW,
  StaffDiscipline.PROPS,
  StaffDiscipline.SOUND,
  StaffDiscipline.LIGHTING,
  StaffDiscipline.VIDEO
];

type TimeRange = { startAt: Date; endAt: Date };
export type ConflictItem = {
  membershipId: string;
  userId: string;
  userName: string;
  type: "AVAILABILITY" | "EVENT";
  reason: string;
  startAt: Date;
  endAt: Date;
  resourceId: string;
};
type StageSceneNoteForSchedule = Prisma.StageSceneNoteGetPayload<{
  include: {
    stagePlan: { select: { id: true; name: true } };
    scene: { select: { id: true; title: true; order: true; act: { select: { id: true; title: true; order: true } } } };
  };
}>;

@Injectable()
export class ScheduleService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
    private readonly scheduleNotifications: ScheduleNotificationsService
  ) {}

  async getWorkspace(productionId: string, user: RequestUser, from?: string, to?: string) {
    await this.assertMembership(productionId, user, VIEW_ROLES);
    const [events, scenes, musicCues, memberships, stageNotes] = await Promise.all([
      this.listEvents(productionId, user, from, to),
      this.getProductionScenes(productionId),
      this.getProductionCues(productionId),
      this.getProductionMemberships(productionId),
      this.getProductionStageNotes(productionId)
    ]);

    return {
      events: this.attachStageNotesToEvents(events, stageNotes),
      scenes,
      musicCues,
      stageNotes,
      memberships,
      totals: {
        events: events.length,
        scenes: scenes.length,
        musicCues: musicCues.length,
        stageNotes: stageNotes.length,
        members: memberships.length,
        pendingAttendance: events.reduce(
          (sum, event) => sum + event.attendances.filter((attendance) => attendance.status === AttendanceStatus.INVITED).length,
          0
        )
      }
    };
  }

  async listEvents(productionId: string, user: RequestUser, from?: string, to?: string) {
    await this.assertMembership(productionId, user, VIEW_ROLES);
    const where: Prisma.ScheduleEventWhereInput = { productionId };
    const fromDate = this.parseOptionalDate(from, "from");
    const toDate = this.parseOptionalDate(to, "to");
    if (fromDate && toDate && fromDate >= toDate) {
      throw new BadRequestException("조회 종료 시각은 시작 시각보다 뒤여야 해요");
    }
    if (fromDate || toDate) {
      // Calendar and conflict checks both use the half-open interval [from, to).
      where.AND = [
        fromDate ? { endAt: { gt: fromDate } } : {},
        toDate ? { startAt: { lt: toDate } } : {}
      ];
    }
    return this.prisma.scheduleEvent.findMany({
      where,
      orderBy: [{ startAt: "asc" }, { createdAt: "asc" }],
      include: this.eventInclude()
    });
  }

  async getEvent(productionId: string, eventId: string, user: RequestUser) {
    await this.assertMembership(productionId, user, VIEW_ROLES);
    return this.assertEvent(productionId, eventId);
  }

  async createEvent(productionId: string, dto: CreateScheduleEventDto, user: RequestUser) {
    const eventType = this.resolveEventType(dto.type, dto.eventType);
    await this.assertCreatePermission(productionId, user);
    const range = this.parseRange(dto.startAt, dto.endAt);
    const sceneIds = dto.sceneIds ?? [];
    const musicCueIds = dto.musicCueIds ?? [];
    // 참석자를 지정하지 않으면 공연 멤버 전원에게 공유하고 출석을 요청한다.
    let attendeeMembershipIds = dto.attendeeMembershipIds ?? [];
    if (attendeeMembershipIds.length === 0) {
      const members = await this.prisma.membership.findMany({ where: { productionId }, select: { id: true } });
      attendeeMembershipIds = members.map((member) => member.id);
    }
    await Promise.all([
      this.assertScenes(productionId, sceneIds),
      this.assertMusicCues(productionId, musicCueIds),
      this.assertMembershipIds(productionId, attendeeMembershipIds)
    ]);
    const conflicts = await this.findConflicts(productionId, attendeeMembershipIds, range);
    const canOverride = await this.canOverrideConflicts(productionId, user, eventType);
    if (dto.overrideReason?.trim() && !canOverride) {
      throw new ForbiddenException("충돌 강행 등록은 제작진만 할 수 있어요");
    }
    this.assertNoConflictsWithoutOverride(conflicts, dto.overrideReason, canOverride);

    const event = await this.prisma.scheduleEvent.create({
      data: {
        productionId,
        type: eventType,
        title: dto.title.trim(),
        startAt: range.startAt,
        endAt: range.endAt,
        location: dto.location?.trim() || dto.venue?.trim() || null,
        meetingUrl: dto.meetingUrl?.trim() || null,
        scenes: { create: sceneIds.map((sceneId) => ({ sceneId })) },
        musicCues: { create: musicCueIds.map((cueId) => ({ cueId })) },
        attendances: {
          create: attendeeMembershipIds.map((membershipId) => ({
            membershipId,
            status: AttendanceStatus.INVITED,
            forced: conflicts.some((conflict) => conflict.membershipId === membershipId),
            forcedReason: conflicts.some((conflict) => conflict.membershipId === membershipId) ? dto.overrideReason?.trim() || null : null
          }))
        }
      },
      include: this.eventInclude()
    });
    if (dto.notifyMembers !== false) {
      await this.scheduleNotifications.createScheduleEventNotifications(event, user, "created", event.type === EventType.READING);
    }
    await this.scheduleNotifications.handleForcedAttendances({
      productionId,
      eventId: event.id,
      eventTitle: event.title,
      actor: user,
      attendances: event.attendances,
      conflicts,
      reason: dto.overrideReason?.trim() || ""
    });
    return event;
  }

  async updateEvent(productionId: string, eventId: string, dto: UpdateScheduleEventDto, user: RequestUser) {
    const event = await this.assertEvent(productionId, eventId);
    const eventType = this.resolveEventType(dto.type, dto.eventType, event.type);
    // Check the existing event too: changing its type must not grant edit access.
    await this.assertEditPermission(productionId, user, event.type);
    if (eventType !== event.type) await this.assertEditPermission(productionId, user, eventType);
    const range =
      dto.startAt || dto.endAt
        ? this.parseRange(dto.startAt ?? event.startAt.toISOString(), dto.endAt ?? event.endAt.toISOString())
        : { startAt: event.startAt, endAt: event.endAt };
    const sceneIds = dto.sceneIds;
    const musicCueIds = dto.musicCueIds;
    const attendeeMembershipIds = dto.attendeeMembershipIds;
    await Promise.all([
      sceneIds ? this.assertScenes(productionId, sceneIds) : Promise.resolve(),
      musicCueIds ? this.assertMusicCues(productionId, musicCueIds) : Promise.resolve(),
      attendeeMembershipIds ? this.assertMembershipIds(productionId, attendeeMembershipIds) : Promise.resolve()
    ]);
    const targetAttendanceIds = attendeeMembershipIds ?? event.attendances.map((attendance) => attendance.membershipId);
    const conflicts = await this.findConflicts(productionId, targetAttendanceIds, range, eventId);
    this.assertNoConflictsWithoutOverride(conflicts, dto.overrideReason);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (sceneIds) {
        await tx.eventScene.deleteMany({ where: { eventId } });
        if (sceneIds.length) {
          await tx.eventScene.createMany({ data: sceneIds.map((sceneId) => ({ eventId, sceneId })), skipDuplicates: true });
        }
      }
      if (musicCueIds) {
        await tx.eventMusicCue.deleteMany({ where: { eventId } });
        if (musicCueIds.length) {
          await tx.eventMusicCue.createMany({ data: musicCueIds.map((cueId) => ({ eventId, cueId })), skipDuplicates: true });
        }
      }
      if (attendeeMembershipIds) {
        await tx.attendance.deleteMany({ where: { eventId, membershipId: { notIn: attendeeMembershipIds } } });
        for (const membershipId of attendeeMembershipIds) {
          const hasConflict = conflicts.some((conflict) => conflict.membershipId === membershipId);
          await tx.attendance.upsert({
            where: { eventId_membershipId: { eventId, membershipId } },
            update: {
              forced: hasConflict,
              forcedReason: hasConflict ? dto.overrideReason?.trim() || null : null
            },
            create: {
              eventId,
              membershipId,
              status: AttendanceStatus.INVITED,
              forced: hasConflict,
              forcedReason: hasConflict ? dto.overrideReason?.trim() || null : null
            }
          });
        }
      } else {
        const timeChanged =
          range.startAt.getTime() !== event.startAt.getTime() || range.endAt.getTime() !== event.endAt.getTime();
        if (timeChanged) {
          // 시간이 바뀌어 충돌이 해소된 참석자의 강제 배정 표시를 정리한다.
          const conflictedIds = [...new Set(conflicts.map((conflict) => conflict.membershipId))];
          await tx.attendance.updateMany({
            where: { eventId, forced: true, membershipId: { notIn: conflictedIds } },
            data: { forced: false, forcedReason: null }
          });
        }
        if (dto.overrideReason && conflicts.length) {
          for (const membershipId of new Set(conflicts.map((conflict) => conflict.membershipId))) {
            await tx.attendance.updateMany({
              where: { eventId, membershipId },
              data: { forced: true, forcedReason: dto.overrideReason.trim() }
            });
          }
        }
      }

      return tx.scheduleEvent.update({
        where: { id: eventId },
        data: {
          type: eventType,
          title: dto.title?.trim(),
          startAt: range.startAt,
          endAt: range.endAt,
          location: dto.location === undefined && dto.venue === undefined ? undefined : dto.location?.trim() || dto.venue?.trim() || null,
          meetingUrl: dto.meetingUrl === undefined ? undefined : dto.meetingUrl?.trim() || null
        },
        include: this.eventInclude()
      });
    });
    if (dto.notifyMembers !== false) {
      await this.scheduleNotifications.createScheduleEventNotifications(updated, user, "updated", true);
    }
    if (conflicts.length && dto.overrideReason?.trim()) {
      await this.scheduleNotifications.handleForcedAttendances({
        productionId,
        eventId: updated.id,
        eventTitle: updated.title,
        actor: user,
        attendances: updated.attendances,
        conflicts,
        reason: dto.overrideReason.trim()
      });
    }
    return updated;
  }

  async deleteEvent(productionId: string, eventId: string, force: boolean, dto: DeleteScheduleEventDto, user: RequestUser) {
    const cancelReason = dto?.reason?.trim();
    if (!cancelReason) {
      throw new BadRequestException("일정 취소 사유를 입력해 주세요");
    }
    const event = await this.assertEvent(productionId, eventId);
    await this.assertEditPermission(productionId, user, event.type);
    const impact = {
      attendances: event.attendances.length,
      scenes: event.scenes.length,
      musicCues: event.musicCues.length,
      checklistItems: await this.prisma.checklistItem.count({ where: { eventId } }),
      runSheets: await this.prisma.runSheet.count({ where: { eventId } }),
      readingSessions: await this.prisma.readingSession.count({ where: { eventId } }),
      guestLinks: await this.prisma.guestReadingAccess.count({ where: { eventId } })
    };
    if (!force && Object.values(impact).some((count) => count > 0)) {
      throw new ConflictException({
        message: "참석자, 장면, 큐, 체크리스트 또는 진행표가 연결된 일정이에요. 영향 내용을 확인한 뒤 삭제해 주세요.",
        impact
      });
    }
    if (force && (impact.runSheets > 0 || impact.readingSessions > 0)) {
      throw new ConflictException({
        message: "진행표 또는 리딩 세션이 연결된 일정은 먼저 진행표/세션을 정리해야 삭제할 수 있어요.",
        impact
      });
    }

    await this.prisma.$transaction([
      this.prisma.activityLog.create({
        data: {
          productionId,
          organizationId: event.production.organizationId,
          actorId: user.id,
          action: "schedule.event_canceled",
          entity: "ScheduleEvent",
          entityId: event.id,
          reason: cancelReason,
          beforeJson: toJson({
            id: event.id,
            title: event.title,
            type: event.type,
            startAt: event.startAt.toISOString(),
            endAt: event.endAt.toISOString(),
            location: event.location,
            meetingUrl: event.meetingUrl,
            attendances: event.attendances.map((attendance) => ({
              id: attendance.id,
              membershipId: attendance.membershipId,
              userId: attendance.membership.user.id,
              userName: attendance.membership.user.name,
              status: attendance.status,
              forced: attendance.forced,
              forcedReason: attendance.forcedReason
            })),
            sceneIds: event.scenes.map((item) => item.sceneId),
            musicCueIds: event.musicCues.map((item) => item.cueId),
            impact
          }),
          afterJson: toJson({ deletedId: event.id, canceledAt: new Date().toISOString() })
        }
      }),
      this.prisma.checklistItem.updateMany({ where: { eventId }, data: { eventId: null } }),
      this.prisma.guestReadingAccess.deleteMany({ where: { eventId } }),
      this.prisma.eventMusicCue.deleteMany({ where: { eventId } }),
      this.prisma.eventScene.deleteMany({ where: { eventId } }),
      this.prisma.attendance.deleteMany({ where: { eventId } }),
      this.prisma.scheduleEvent.delete({ where: { id: eventId } })
    ]);
    await this.scheduleNotifications.createScheduleEventNotifications(event, user, "canceled", true, cancelReason);
    return { deletedId: eventId, impact };
  }

  async putEventScenes(productionId: string, eventId: string, dto: PutEventScenesDto, user: RequestUser) {
    const event = await this.assertEvent(productionId, eventId);
    await this.assertEditPermission(productionId, user, event.type);
    await this.assertScenes(productionId, dto.sceneIds);
    await this.prisma.$transaction([
      this.prisma.eventScene.deleteMany({ where: { eventId } }),
      ...dto.sceneIds.map((sceneId) => this.prisma.eventScene.create({ data: { eventId, sceneId } }))
    ]);
    return this.assertEvent(productionId, eventId);
  }

  async putEventMusicCues(productionId: string, eventId: string, dto: PutEventMusicCuesDto, user: RequestUser) {
    const event = await this.assertEvent(productionId, eventId);
    await this.assertEditPermission(productionId, user, event.type);
    await this.assertMusicCues(productionId, dto.musicCueIds);
    await this.prisma.$transaction([
      this.prisma.eventMusicCue.deleteMany({ where: { eventId } }),
      ...dto.musicCueIds.map((cueId) => this.prisma.eventMusicCue.create({ data: { eventId, cueId } }))
    ]);
    return this.assertEvent(productionId, eventId);
  }

  async upsertAttendance(productionId: string, eventId: string, dto: UpsertAttendanceDto, user: RequestUser) {
    const event = await this.assertEvent(productionId, eventId);
    const ownMembership = await this.getUserMembership(productionId, user.id);
    const isSelfOnly = !dto.membershipId && !dto.membershipIds?.length && !dto.attendances?.length;
    if (isSelfOnly) {
      if (!ownMembership || !event.attendances.some((attendance) => attendance.membershipId === ownMembership.id)) {
        throw new ForbiddenException("이 일정의 출석 대상자가 아니에요");
      }
      const status = dto.status ?? AttendanceStatus.ACCEPTED;
      return this.prisma.attendance.upsert({
        where: { eventId_membershipId: { eventId, membershipId: ownMembership.id } },
        update: { status },
        create: { eventId, membershipId: ownMembership.id, status },
        include: this.attendanceInclude()
      });
    }

    await this.assertEditPermission(productionId, user, event.type);
    const entries = this.normalizeAttendanceEntries(dto);
    await this.assertMembershipIds(productionId, entries.map((entry) => entry.membershipId));
    const conflicts = await this.findConflicts(productionId, entries.map((entry) => entry.membershipId), {
      startAt: event.startAt,
      endAt: event.endAt
    }, eventId);
    this.assertNoConflictsWithoutOverride(conflicts, dto.overrideReason);

    const results = [];
    for (const entry of entries) {
      const hasConflict = conflicts.some((conflict) => conflict.membershipId === entry.membershipId);
      results.push(
        await this.prisma.attendance.upsert({
          where: { eventId_membershipId: { eventId, membershipId: entry.membershipId } },
          update: {
            status: entry.status ?? dto.status ?? AttendanceStatus.INVITED,
            forced: hasConflict,
            forcedReason: hasConflict ? dto.overrideReason?.trim() || null : null
          },
          create: {
            eventId,
            membershipId: entry.membershipId,
            status: entry.status ?? dto.status ?? AttendanceStatus.INVITED,
            forced: hasConflict,
            forcedReason: hasConflict ? dto.overrideReason?.trim() || null : null
          },
          include: this.attendanceInclude()
        })
      );
    }
    await this.scheduleNotifications.handleForcedAttendances({
      productionId,
      eventId: event.id,
      eventTitle: event.title,
      actor: user,
      attendances: results,
      conflicts,
      reason: dto.overrideReason?.trim() || ""
    });
    return { count: results.length, attendances: results, conflicts };
  }

  async suggest(productionId: string, user: RequestUser, query: { sceneIds?: string; musicCueIds?: string; startAt?: string; endAt?: string }) {
    await this.assertMembership(productionId, user, VIEW_ROLES);
    const sceneIds = this.splitIds(query.sceneIds);
    const musicCueIds = this.splitIds(query.musicCueIds);
    await Promise.all([this.assertScenes(productionId, sceneIds), this.assertMusicCues(productionId, musicCueIds)]);

    const reasons = new Map<string, Set<string>>();
    const addReason = (membershipId: string, reason: string) => {
      if (!reasons.has(membershipId)) reasons.set(membershipId, new Set());
      reasons.get(membershipId)?.add(reason);
    };

    const [sceneRoles, musicDirectorMemberships, coreMemberships, stageMemberships, stageStaffMemberships, stageNoteCount] = await Promise.all([
      this.prisma.sceneRole.findMany({
        where: { sceneId: { in: sceneIds } },
        include: { role: { include: { assignments: true } }, scene: { select: { title: true } } }
      }),
      this.findMembershipsByRoles(productionId, [ProductionRole.MUSIC_DIRECTOR]),
      this.findMembershipsByRoles(productionId, [ProductionRole.PRODUCER, ProductionRole.DIRECTOR]),
      this.findMembershipsByRoles(productionId, [ProductionRole.STAGE_MANAGER]),
      this.findMembershipsByStaffDisciplines(productionId, STAGE_NOTE_STAFF_DISCIPLINES),
      sceneIds.length
        ? this.prisma.stageSceneNote.count({
            where: { sceneId: { in: sceneIds }, stagePlan: { productionId } }
          })
        : Promise.resolve(0)
    ]);

    for (const sceneRole of sceneRoles) {
      for (const assignment of sceneRole.role.assignments) {
        addReason(assignment.membershipId, `${sceneRole.scene.title} 등장 배역`);
      }
    }
    if (musicCueIds.length) {
      for (const membership of musicDirectorMemberships) addReason(membership.id, "음악 큐 담당");
    }
    if (sceneIds.length) {
      for (const membership of stageMemberships) addReason(membership.id, "장면 세팅 확인");
    }
    if (stageNoteCount > 0) {
      for (const membership of stageStaffMemberships) {
        const disciplines = membership.staffAssignments
          .filter((assignment) => STAGE_NOTE_STAFF_DISCIPLINES.includes(assignment.discipline))
          .map((assignment) => this.staffDisciplineLabel(assignment.discipline));
        addReason(membership.id, `무대 세팅 직무 담당${disciplines.length ? `(${[...new Set(disciplines)].join(", ")})` : ""}`);
      }
    }
    for (const membership of coreMemberships) addReason(membership.id, "진행/운영 확인");

    const memberships = await this.prisma.membership.findMany({
      where: { id: { in: [...reasons.keys()] }, productionId },
      include: this.membershipInclude()
    });
    const range = query.startAt && query.endAt ? this.parseRange(query.startAt, query.endAt) : null;
    const conflicts = range ? await this.findConflicts(productionId, memberships.map((membership) => membership.id), range) : [];
    const conflictMembershipIds = new Set(conflicts.map((conflict) => conflict.membershipId));

    return {
      suggestedAttendees: memberships.map((membership) => ({
        membership,
        reasons: [...(reasons.get(membership.id) ?? [])],
        conflicted: conflictMembershipIds.has(membership.id)
      })),
      defaultAttendeeIds: memberships.filter((membership) => !conflictMembershipIds.has(membership.id)).map((membership) => membership.id),
      excludedByConflict: memberships.filter((membership) => conflictMembershipIds.has(membership.id)).map((membership) => membership.id),
      conflicts
    };
  }

  async getMySchedule(user: RequestUser) {
    const [attendances, availabilities] = await Promise.all([
      this.prisma.attendance.findMany({
        where: { membership: { userId: user.id } },
        orderBy: { event: { startAt: "asc" } },
        include: {
          event: { include: this.eventInclude() },
          membership: { include: this.membershipInclude() }
        }
      }),
      this.listAvailabilities(user)
    ]);
    return {
      attendances,
      events: attendances.map((attendance) => attendance.event),
      availabilities,
      totals: {
        events: attendances.length,
        pending: attendances.filter((attendance) => attendance.status === AttendanceStatus.INVITED).length,
        availabilities: availabilities.length
      }
    };
  }

  async exportMyScheduleIcs(user: RequestUser) {
    const [attendances, personalSchedules] = await Promise.all([
      this.prisma.attendance.findMany({
        where: { membership: { userId: user.id } },
        orderBy: { event: { startAt: "asc" } },
        include: {
          event: { include: { production: { select: { id: true, title: true } } } },
          membership: { include: { user: { select: { id: true, name: true, email: true } } } }
        }
      }),
      this.prisma.availability.findMany({
        where: { userId: user.id, isAvailable: false },
        orderBy: { startAt: "asc" }
      })
    ]);
    const generatedAt = new Date();
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Reading Musical//Personal Schedule//KO",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:Reading Musical 내 스케줄",
      "X-WR-TIMEZONE:Asia/Seoul"
    ];

    for (const attendance of attendances) {
      const event = attendance.event;
      const productionTitle = event.production?.title ?? "아트브릿지";
      const description = [
        `공연: ${productionTitle}`,
        `일정 유형: ${event.type}`,
        `출석 상태: ${attendanceStatusLabel(attendance.status)}`,
        attendance.forced ? `강제 배정: ${attendance.forcedReason || "사유 없음"}` : null,
        event.meetingUrl ? `회의 링크: ${event.meetingUrl}` : null
      ].filter(Boolean);

      lines.push(
        "BEGIN:VEVENT",
        `UID:${attendance.id}@reading-musical`,
        `DTSTAMP:${formatIcsDate(generatedAt)}`,
        `DTSTART:${formatIcsDate(event.startAt)}`,
        `DTEND:${formatIcsDate(event.endAt)}`,
        `SUMMARY:${escapeIcsText(`${productionTitle} - ${event.title}`)}`,
        `DESCRIPTION:${escapeIcsText(description.join("\n"))}`,
        `STATUS:CONFIRMED`,
        `TRANSP:${attendance.status === AttendanceStatus.DECLINED ? "TRANSPARENT" : "OPAQUE"}`,
        `X-READING-MUSICAL-ATTENDANCE:${attendance.status}`
      );
      if (event.location) {
        lines.push(`LOCATION:${escapeIcsText(event.location)}`);
      }
      if (event.meetingUrl) {
        lines.push(`URL:${event.meetingUrl}`);
      }
      lines.push("END:VEVENT");
    }

    for (const personal of personalSchedules) {
      lines.push(
        "BEGIN:VEVENT",
        `UID:personal-${personal.id}@reading-musical`,
        `DTSTAMP:${formatIcsDate(generatedAt)}`,
        `DTSTART:${formatIcsDate(personal.startAt)}`,
        `DTEND:${formatIcsDate(personal.endAt)}`,
        `SUMMARY:${escapeIcsText(personal.title || "개인 일정")}`,
        personal.reason ? `DESCRIPTION:${escapeIcsText(personal.reason)}` : "DESCRIPTION:아트브릿지 개인 일정",
        "STATUS:CONFIRMED",
        "TRANSP:OPAQUE",
        "CLASS:PRIVATE",
        "X-READING-MUSICAL-TYPE:PERSONAL",
        "END:VEVENT"
      );
    }

    lines.push("END:VCALENDAR");
    return foldIcsLines(lines);
  }

  listAvailabilities(user: RequestUser) {
    return this.prisma.availability.findMany({
      where: { userId: user.id },
      orderBy: { startAt: "asc" }
    });
  }

  async createAvailability(user: RequestUser, dto: CreateAvailabilityDto) {
    const range = this.parseRange(dto.startAt, dto.endAt);
    return this.prisma.availability.create({
      data: {
        userId: user.id,
        title: dto.title?.trim() || null,
        startAt: range.startAt,
        endAt: range.endAt,
        isAvailable: dto.isAvailable ?? false,
        reason: dto.reason?.trim() || null
      }
    });
  }

  async updateAvailability(user: RequestUser, availabilityId: string, dto: UpdateAvailabilityDto) {
    const current = await this.assertAvailability(user.id, availabilityId);
    const range =
      dto.startAt || dto.endAt
        ? this.parseRange(dto.startAt ?? current.startAt.toISOString(), dto.endAt ?? current.endAt.toISOString())
        : { startAt: current.startAt, endAt: current.endAt };
    return this.prisma.availability.update({
      where: { id: availabilityId },
      data: {
        title: dto.title === undefined ? undefined : dto.title?.trim() || null,
        startAt: range.startAt,
        endAt: range.endAt,
        isAvailable: dto.isAvailable,
        reason: dto.reason === undefined ? undefined : dto.reason?.trim() || null
      }
    });
  }

  async deleteAvailability(user: RequestUser, availabilityId: string) {
    await this.assertAvailability(user.id, availabilityId);
    await this.prisma.availability.delete({ where: { id: availabilityId } });
    return { deletedId: availabilityId };
  }

  private parseRange(startAtValue: string, endAtValue: string): TimeRange {
    const startAt = new Date(startAtValue);
    const endAt = new Date(endAtValue);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      throw new BadRequestException("일정 날짜 형식이 올바르지 않아요");
    }
    if (endAt <= startAt) {
      throw new BadRequestException("종료 시각은 시작 시각보다 뒤여야 해요");
    }
    return { startAt, endAt };
  }

  private resolveEventType(type?: EventType, eventType?: EventType, fallback: EventType = EventType.READING) {
    return type ?? eventType ?? fallback;
  }

  private parseOptionalDate(value: string | undefined, label: string) {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${label} 날짜 형식이 올바르지 않아요`);
    }
    return parsed;
  }

  private assertNoConflictsWithoutOverride(conflicts: ConflictItem[], overrideReason?: string | null, canOverride = true) {
    if (conflicts.length && (!canOverride || !overrideReason?.trim())) {
      throw new ConflictException({
        message: canOverride
          ? "참석자 중 개인 일정 또는 다른 공연 일정과 겹치는 사람이 있어요. 강제 배정하려면 사유를 입력해 주세요."
          : "참석자 중 개인 일정 또는 다른 공연 일정과 겹치는 사람이 있어요. 다른 시간으로 등록해 주세요.",
        conflicts,
        canOverride
      });
    }
  }

  // 강행(충돌 무시 배정)은 제작진·운영자만 — 배우·스텝은 충돌 시 시간을 바꿔야 한다.
  private async canOverrideConflicts(productionId: string, user: RequestUser, eventType: EventType) {
    try {
      await this.assertEditPermission(productionId, user, eventType);
      return true;
    } catch {
      return false;
    }
  }

  private normalizeAttendanceEntries(dto: UpsertAttendanceDto) {
    if (dto.attendances?.length) {
      return dto.attendances;
    }
    if (dto.membershipIds?.length) {
      return dto.membershipIds.map((membershipId) => ({ membershipId, status: dto.status }));
    }
    if (dto.membershipId) {
      return [{ membershipId: dto.membershipId, status: dto.status }];
    }
    throw new BadRequestException("출석 대상 멤버가 필요해요");
  }

  private splitIds(value?: string) {
    return (value ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private async findConflicts(productionId: string, membershipIds: string[], range: TimeRange, ignoreEventId?: string): Promise<ConflictItem[]> {
    const uniqueMembershipIds = [...new Set(membershipIds)];
    if (!uniqueMembershipIds.length) return [];
    const memberships = await this.prisma.membership.findMany({
      where: { id: { in: uniqueMembershipIds }, productionId },
      include: { user: { select: { id: true, name: true } } }
    });
    const userIds = memberships.map((membership) => membership.userId);
    const [blockedAvailabilities, overlappingAttendances] = await Promise.all([
      this.prisma.availability.findMany({
        where: {
          userId: { in: userIds },
          isAvailable: false,
          startAt: { lt: range.endAt },
          endAt: { gt: range.startAt }
        }
      }),
      this.prisma.attendance.findMany({
        where: {
          // Membership IDs differ by production. Match the person across productions.
          membership: { userId: { in: userIds } },
          status: { not: AttendanceStatus.DECLINED },
          eventId: ignoreEventId ? { not: ignoreEventId } : undefined,
          event: {
            production: { deletedAt: null },
            startAt: { lt: range.endAt },
            endAt: { gt: range.startAt }
          }
        },
        include: {
          membership: { select: { userId: true } },
          event: { select: { id: true, productionId: true, title: true, startAt: true, endAt: true } }
        }
      })
    ]);
    const byUser = new Map(memberships.map((membership) => [membership.userId, membership]));
    const availabilityConflicts = blockedAvailabilities.flatMap((availability) => {
      const membership = byUser.get(availability.userId);
      if (!membership) return [];
      return [
        {
          membershipId: membership.id,
          userId: membership.userId,
          userName: membership.user.name,
          type: "AVAILABILITY" as const,
          // 개인 일정 제목·메모는 본인 정보이므로 배정자에게 노출하지 않는다.
          reason: "개인 일정과 겹침",
          startAt: availability.startAt,
          endAt: availability.endAt,
          resourceId: availability.id
        }
      ];
    });
    const eventConflicts = overlappingAttendances.flatMap((attendance) => {
      const membership = byUser.get(attendance.membership.userId);
      if (!membership) return [];
      const sameProduction = attendance.event.productionId === productionId;
      return [
        {
          membershipId: membership.id,
          userId: membership.userId,
          userName: membership.user.name,
          type: "EVENT" as const,
          // Expose the busy interval, not another production's private title or ID.
          reason: sameProduction ? attendance.event.title : "다른 공연 일정과 겹침",
          startAt: attendance.event.startAt,
          endAt: attendance.event.endAt,
          resourceId: sameProduction ? attendance.event.id : ""
        }
      ];
    });
    return [...availabilityConflicts, ...eventConflicts];
  }

  private async assertMembership(productionId: string, user: RequestUser, roles: ProductionRole[]) {
    return assertProductionMembership(this.prisma, user, productionId, roles, {
      include: { roles: true }
    });
  }

  // 등록은 공연 멤버(게스트 제외) 누구나 — 수정·삭제는 아래 assertEditPermission 규칙 유지.
  private async assertCreatePermission(productionId: string, user: RequestUser) {
    if (await isProductionAdmin(this.prisma, user, productionId)) return;
    await this.assertMembership(productionId, user, CREATE_ROLES);
  }

  private async assertEditPermission(productionId: string, user: RequestUser, eventType: EventType) {
    if (await isProductionAdmin(this.prisma, user, productionId)) return;
    const membership = await this.assertMembership(productionId, user, EDIT_ROLES);
    const roles = membership?.roles.map((role) => role.role) ?? [];
    if (roles.some((role) => FULL_EDIT_ROLES.includes(role))) return;
    if (roles.includes(ProductionRole.MUSIC_DIRECTOR) && eventType === EventType.MUSIC_PRACTICE) return;
    throw new ForbiddenException("음악감독은 음악연습 일정만 편집할 수 있어요");
  }

  private async getUserMembership(productionId: string, userId: string) {
    return this.prisma.membership.findUnique({ where: { userId_productionId: { userId, productionId } } });
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

  private async assertScenes(productionId: string, sceneIds: string[]) {
    const uniqueIds = [...new Set(sceneIds)];
    if (!uniqueIds.length) return;
    const count = await this.prisma.scene.count({ where: { id: { in: uniqueIds }, act: { script: { productionId } } } });
    if (count !== uniqueIds.length) {
      throw new BadRequestException("이 공연에 속하지 않는 장면이 포함되어 있어요");
    }
  }

  private async assertMusicCues(productionId: string, cueIds: string[]) {
    const uniqueIds = [...new Set(cueIds)];
    if (!uniqueIds.length) return;
    const count = await this.prisma.musicCue.count({ where: { id: { in: uniqueIds }, productionId } });
    if (count !== uniqueIds.length) {
      throw new BadRequestException("이 공연에 속하지 않는 음악 큐가 포함되어 있어요");
    }
  }

  private async assertMembershipIds(productionId: string, membershipIds: string[]) {
    const uniqueIds = [...new Set(membershipIds)];
    if (!uniqueIds.length) return;
    const count = await this.prisma.membership.count({ where: { id: { in: uniqueIds }, productionId } });
    if (count !== uniqueIds.length) {
      throw new BadRequestException("이 공연에 속하지 않는 참석자가 포함되어 있어요");
    }
  }

  private async assertAvailability(userId: string, availabilityId: string) {
    const availability = await this.prisma.availability.findFirst({ where: { id: availabilityId, userId } });
    if (!availability) {
      throw new NotFoundException("가용성 정보를 찾을 수 없어요");
    }
    return availability;
  }

  private findMembershipsByRoles(productionId: string, roles: ProductionRole[]) {
    return this.prisma.membership.findMany({
      where: { productionId, roles: { some: { role: { in: roles } } } },
      include: this.membershipInclude()
    });
  }

  private findMembershipsByStaffDisciplines(productionId: string, disciplines: StaffDiscipline[]) {
    return this.prisma.membership.findMany({
      where: { productionId, staffAssignments: { some: { discipline: { in: disciplines } } } },
      include: this.membershipInclude()
    });
  }

  private staffDisciplineLabel(discipline: StaffDiscipline) {
    const labels: Record<StaffDiscipline, string> = {
      SOUND: "음향",
      LIGHTING: "조명",
      STAGE_CREW: "무대",
      PROPS: "소품",
      COSTUME: "의상",
      MAKEUP: "분장",
      VIDEO: "영상",
      FRONT_OF_HOUSE: "객석운영",
      PRODUCTION_ASSISTANT: "제작보조",
      ACCOMPANIST: "반주",
      OTHER: "기타"
    };
    return labels[discipline] ?? discipline;
  }

  private getProductionScenes(productionId: string) {
    return this.prisma.scene.findMany({
      where: { act: { script: { productionId } } },
      orderBy: [{ act: { order: "asc" } }, { order: "asc" }],
      include: { act: { select: { id: true, title: true, order: true, script: { select: { id: true, title: true } } } } }
    });
  }

  private getProductionCues(productionId: string) {
    return this.prisma.musicCue.findMany({
      where: { productionId },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      include: {
        track: { select: { id: true, title: true } },
        scene: { select: { id: true, title: true, act: { select: { title: true } } } }
      }
    });
  }

  private async getProductionStageNotes(productionId: string): Promise<StageSceneNoteForSchedule[]> {
    const stageNotes = await this.prisma.stageSceneNote.findMany({
      where: { stagePlan: { productionId } },
      orderBy: [{ scene: { act: { order: "asc" } } }, { scene: { order: "asc" } }, { createdAt: "asc" }],
      include: {
        stagePlan: { select: { id: true, name: true } },
        scene: { select: { id: true, title: true, order: true, act: { select: { id: true, title: true, order: true } } } }
      }
    });
    return stageNotes;
  }

  private attachStageNotesToEvents<
    T extends {
      scenes: Array<{ sceneId: string }>;
    }
  >(events: T[], stageNotes: StageSceneNoteForSchedule[]) {
    const notesByScene = new Map<string, StageSceneNoteForSchedule[]>();
    for (const note of stageNotes) {
      if (!notesByScene.has(note.sceneId)) {
        notesByScene.set(note.sceneId, []);
      }
      notesByScene.get(note.sceneId)?.push(note);
    }

    return events.map((event) => {
      const seen = new Set<string>();
      const linkedStageNotes = event.scenes.flatMap((eventScene) => notesByScene.get(eventScene.sceneId) ?? []).filter((note) => {
        if (seen.has(note.id)) {
          return false;
        }
        seen.add(note.id);
        return true;
      });
      return { ...event, stageNotes: linkedStageNotes };
    });
  }

  private getProductionMemberships(productionId: string) {
    return this.prisma.membership.findMany({
      where: { productionId },
      orderBy: { createdAt: "asc" },
      include: this.membershipInclude()
    });
  }

  private eventInclude() {
    return {
      production: { select: { id: true, title: true, organizationId: true } },
      scenes: {
        include: {
          scene: { include: { act: { select: { id: true, title: true, order: true, script: { select: { id: true, title: true } } } } } }
        },
        orderBy: { scene: { order: "asc" } }
      },
      musicCues: {
        include: {
          cue: {
            include: {
              track: { select: { id: true, title: true } },
              scene: { select: { id: true, title: true, act: { select: { title: true } } } }
            }
          }
        }
      },
      attendances: {
        include: this.attendanceInclude(),
        orderBy: { membership: { createdAt: "asc" } }
      },
      runSheets: { select: { id: true, title: true, status: true } },
      checklistItems: { select: { id: true, label: true, status: true } }
    } satisfies Prisma.ScheduleEventInclude;
  }

  private attendanceInclude() {
    return {
      membership: { include: this.membershipInclude() }
    } satisfies Prisma.AttendanceInclude;
  }

  private membershipInclude() {
    return {
      ...MEMBERSHIP_BASE_INCLUDE,
      production: { select: { id: true, title: true } },
      castAssignments: { include: { role: { select: { id: true, name: true } } } }
    } satisfies Prisma.MembershipInclude;
  }
}
