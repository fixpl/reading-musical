import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AttendanceStatus,
  AdminSettingValueType,
  OrganizationStatus,
  Phase,
  Prisma,
  UserStatus
} from "@prisma/client";
import { ensureGlobalChecklistTemplates } from "../checklist/checklist-template-seed";
import type { RequestUser } from "../common/types/request-user";
import { MailService } from "../mail/mail.service";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  AdminListQueryDto,
  ChangeUserStatusDto,
  CreateChecklistTemplateDto,
  CreateOrganizationDto,
  ProfileRequestDto,
  UpdateChecklistTemplateDto,
  UpdateOrganizationDto,
  UpdateSystemSettingDto
} from "./dto";

const DEFAULT_SETTINGS: Array<{
  key: string;
  value: Prisma.InputJsonValue;
  valueType: AdminSettingValueType;
  description: string;
}> = [
  { key: "file.audio.maxMb", value: 200, valueType: AdminSettingValueType.NUMBER, description: "음원 업로드 최대 용량(MB)" },
  { key: "file.document.maxMb", value: 50, valueType: AdminSettingValueType.NUMBER, description: "문서 업로드 최대 용량(MB)" },
  { key: "file.image.maxMb", value: 10, valueType: AdminSettingValueType.NUMBER, description: "이미지 업로드 최대 용량(MB)" },
  { key: "signedUrl.ttlSeconds", value: 600, valueType: AdminSettingValueType.NUMBER, description: "signed URL 유효 시간(초)" },
  { key: "notification.emailDigestPerHour", value: 1, valueType: AdminSettingValueType.NUMBER, description: "이메일 digest 시간당 발송 횟수" },
  { key: "maintenance.notice", value: "", valueType: AdminSettingValueType.STRING, description: "전체 운영 공지" }
];

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
    private readonly config: ConfigService
  ) {}

  async getConsole(user: RequestUser) {
    const [
      stats,
      organizations,
      users,
      templates,
      settings,
      activityLogs,
      profileDistribution,
      roleDistribution,
      productionPhaseDistribution,
      productionVisibilityDistribution,
      monthlyEvents
    ] = await Promise.all([
      this.getStats(),
      this.listOrganizations({ take: 10 }),
      this.listUsers({ take: 10 }),
      this.listChecklistTemplates(),
      this.listSettings(),
      this.listActivityLogs({ take: 20 }),
      this.getProfileDistribution(),
      this.getRoleDistribution(),
      this.getProductionPhaseDistribution(),
      this.getProductionVisibilityDistribution(),
      this.listCurrentMonthEvents()
    ]);

    return {
      user,
      stats,
      organizations,
      users,
      templates,
      settings,
      activityLogs,
      profileDistribution,
      roleDistribution,
      productionPhaseDistribution,
      productionVisibilityDistribution,
      monthlyEvents
    };
  }

  async getStats() {
    const [
      organizations,
      inactiveOrganizations,
      users,
      blockedUsers,
      profileIncompleteUsers,
      productions,
      publishedProductions,
      thisMonthEvents,
      assets,
      templates,
      settings,
      recentLogs
    ] =
      await Promise.all([
        this.prisma.organization.count(),
        this.prisma.organization.count({ where: { status: OrganizationStatus.INACTIVE } }),
        this.prisma.user.count(),
        this.prisma.user.count({ where: { status: UserStatus.BLOCKED } }),
        this.prisma.user.count({ where: { profileComplete: false } }),
        this.prisma.production.count(),
        this.prisma.production.count({ where: { visibility: "PUBLISHED" } }),
        this.prisma.scheduleEvent.count({ where: { startAt: this.currentMonthFilter() } }),
        this.prisma.asset.aggregate({ _sum: { sizeBytes: true }, _count: true }),
        this.prisma.checklistTemplate.count({ where: { active: true } }),
        this.prisma.systemSetting.count(),
        this.prisma.activityLog.count({ where: { createdAt: { gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7) } } })
      ]);

    return {
      organizations,
      inactiveOrganizations,
      users,
      blockedUsers,
      profileIncompleteUsers,
      productions,
      publishedProductions,
      thisMonthEvents,
      activeChecklistTemplates: templates,
      systemSettings: settings,
      uploadedAssets: assets._count,
      uploadedBytes: assets._sum.sizeBytes ?? 0,
      recentAuditLogs: recentLogs,
      trackedErrors: 0
    };
  }

  async getProfileDistribution() {
    const rows = await this.prisma.user.groupBy({
      by: ["profileType"],
      _count: { _all: true },
      orderBy: { profileType: "asc" }
    });

    return rows.map((row) => ({
      profileType: row.profileType,
      count: row._count._all
    }));
  }

  async getRoleDistribution() {
    const rows = await this.prisma.membershipRole.groupBy({
      by: ["role"],
      _count: { _all: true },
      orderBy: { role: "asc" }
    });

    return rows.map((row) => ({
      role: row.role,
      count: row._count._all
    }));
  }

  async getProductionPhaseDistribution() {
    const rows = await this.prisma.production.groupBy({
      by: ["currentPhase"],
      _count: { _all: true },
      orderBy: { currentPhase: "asc" }
    });

    return rows.map((row) => ({
      phase: row.currentPhase,
      count: row._count._all
    }));
  }

  async getProductionVisibilityDistribution() {
    const rows = await this.prisma.production.groupBy({
      by: ["visibility"],
      _count: { _all: true },
      orderBy: { visibility: "asc" }
    });

    return rows.map((row) => ({
      visibility: row.visibility,
      count: row._count._all
    }));
  }

  async listCurrentMonthEvents() {
    return this.prisma.scheduleEvent.findMany({
      where: { startAt: this.currentMonthFilter() },
      orderBy: { startAt: "asc" },
      take: 80,
      select: {
        id: true,
        type: true,
        title: true,
        startAt: true,
        endAt: true,
        location: true,
        production: {
          select: {
            id: true,
            title: true,
            currentPhase: true,
            visibility: true,
            organization: { select: { id: true, name: true } }
          }
        },
        attendances: { select: { status: true } },
        runSheets: { select: { id: true, status: true } }
      }
    });
  }

  async listOrganizations(query: AdminListQueryDto = {}) {
    const q = query.q?.trim();
    return this.prisma.organization.findMany({
      where: {
        status: this.parseOrganizationStatus(query.status),
        ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {})
      },
      orderBy: { createdAt: "desc" },
      take: this.take(query.take),
      include: {
        _count: {
          select: {
            users: true,
            productions: true,
            activityLogs: true
          }
        }
      }
    });
  }

  async createOrganization(dto: CreateOrganizationDto, user: RequestUser) {
    const name = dto.name.trim();
    if (!name) {
      throw new BadRequestException("단체명을 입력해 주세요");
    }

    const organization = await this.prisma.organization.create({
      data: {
        name,
        status: dto.status ?? OrganizationStatus.ACTIVE
      }
    });

    await this.log({
      actorId: user.id,
      action: "admin.organization.create",
      entity: "Organization",
      entityId: organization.id,
      organizationId: organization.id,
      reason: dto.reason || "단체 생성",
      after: organization
    });

    return organization;
  }

  async updateOrganization(organizationId: string, dto: UpdateOrganizationDto, user: RequestUser) {
    const before = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!before) {
      throw new NotFoundException("단체를 찾을 수 없어요");
    }

    const changingStatus = dto.status !== undefined && dto.status !== before.status;
    if (changingStatus) {
      this.requireReason(dto.reason, "단체 상태 변경 사유를 입력해 주세요");
    }

    const data: Prisma.OrganizationUpdateInput = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) {
        throw new BadRequestException("단체명을 입력해 주세요");
      }
      data.name = name;
    }
    if (dto.status !== undefined) {
      data.status = dto.status;
    }

    const after = await this.prisma.organization.update({
      where: { id: organizationId },
      data
    });

    await this.log({
      actorId: user.id,
      action: changingStatus ? "admin.organization.status" : "admin.organization.update",
      entity: "Organization",
      entityId: organizationId,
      organizationId,
      reason: dto.reason || "단체 정보 수정",
      before,
      after
    });

    return after;
  }

  // 회원 상세 — 프로필 전체 + 참여 공연 + 다가오는 일정(출석 상태 포함)을 한 번에 준다.
  async getUserOverview(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        birthDate: true,
        address: true,
        gender: true,
        profileType: true,
        profileComplete: true,
        profileDetails: true,
        status: true,
        platformRole: true,
        createdAt: true
      }
    });
    if (!user) {
      throw new NotFoundException("회원을 찾을 수 없어요");
    }

    const memberships = await this.prisma.membership.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: {
        production: { select: { id: true, title: true, currentPhase: true, visibility: true } },
        roles: { select: { role: true } }
      }
    });

    const upcomingEvents = await this.prisma.scheduleEvent.findMany({
      where: { endAt: { gte: new Date() }, attendances: { some: { membership: { userId } } } },
      orderBy: { startAt: "asc" },
      take: 20,
      select: {
        id: true,
        title: true,
        type: true,
        startAt: true,
        endAt: true,
        location: true,
        production: { select: { id: true, title: true } },
        attendances: { where: { membership: { userId } }, select: { id: true, status: true } }
      }
    });

    const availabilities = await this.prisma.availability.findMany({
      where: { userId, endAt: { gte: new Date() } },
      orderBy: { startAt: "asc" },
      take: 20
    });

    return {
      user,
      memberships,
      availabilities,
      upcomingEvents: upcomingEvents.map((event) => ({
        id: event.id,
        title: event.title,
        type: event.type,
        startAt: event.startAt,
        endAt: event.endAt,
        location: event.location,
        production: event.production,
        myStatus: event.attendances[0]?.status ?? null,
        myAttendanceId: event.attendances[0]?.id ?? null
      }))
    };
  }

  async createUserAvailability(userId: string, dto: { title?: string; startAt: string; endAt: string; reason?: string }) {
    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    if (!(startAt < endAt)) {
      throw new BadRequestException("시작이 종료보다 빨라야 합니다");
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new NotFoundException("회원을 찾을 수 없어요");
    return this.prisma.availability.create({
      data: { userId, title: dto.title?.trim() || "운영자 등록 일정", startAt, endAt, isAvailable: false, reason: dto.reason?.trim() || null }
    });
  }

  async deleteUserAvailability(userId: string, availabilityId: string) {
    const availability = await this.prisma.availability.findFirst({ where: { id: availabilityId, userId } });
    if (!availability) throw new NotFoundException("불가 시간을 찾을 수 없어요");
    await this.prisma.availability.delete({ where: { id: availabilityId } });
    return { deletedId: availabilityId };
  }

  // 운영자가 회원 대신 출석 상태를 바꾼다 — forced로 기록해 본인 응답과 구분한다.
  async setAttendanceStatus(attendanceId: string, status: AttendanceStatus, actor: RequestUser) {
    const attendance = await this.prisma.attendance.findUnique({ where: { id: attendanceId }, select: { id: true } });
    if (!attendance) throw new NotFoundException("출석 정보를 찾을 수 없어요");
    return this.prisma.attendance.update({
      where: { id: attendanceId },
      data: { status, forced: true, forcedReason: `운영자(${actor.name}) 변경` }
    });
  }

  async listUsers(query: AdminListQueryDto = {}) {
    const q = query.q?.trim();
    return this.prisma.user.findMany({
      where: {
        organizationId: query.organizationId || undefined,
        status: this.parseUserStatus(query.status),
        profileType: query.profileType,
        profileComplete: query.profileComplete,
        ...(q
          ? {
              OR: [
                { email: { contains: q, mode: "insensitive" as const } },
                { name: { contains: q, mode: "insensitive" as const } },
                { phone: { contains: q, mode: "insensitive" as const } }
              ]
            }
          : {})
      },
      orderBy: { createdAt: "desc" },
      take: this.take(query.take),
      select: {
        id: true,
        organizationId: true,
        organization: { select: { id: true, name: true, status: true } },
        email: true,
        name: true,
        phone: true,
        profileType: true,
        profileDetails: true,
        profileComplete: true,
        status: true,
        platformRole: true,
        emailNotify: true,
        createdAt: true,
        updatedAt: true,
        memberships: {
          select: {
            id: true,
            primaryRole: true,
            production: { select: { id: true, title: true, organizationId: true } },
            roles: { select: { role: true } },
            staffAssignments: { select: { discipline: true, customLabel: true, isLead: true } }
          },
          orderBy: { createdAt: "desc" }
        },
        _count: { select: { memberships: true, assets: true } }
      }
    });
  }

  async listOrgMembers(query: AdminListQueryDto, user: RequestUser) {
    if (user.platformRole === "SUPER_ADMIN") {
      return this.listUsers(query);
    }

    const organizationId = await this.getActorOrganizationId(user);

    return this.listUsers({ ...query, organizationId });
  }

  async changeUserStatus(userId: string, dto: ChangeUserStatusDto, actor: RequestUser) {
    return this.changeUserStatusInternal(userId, dto, actor, "admin.user.status");
  }

  async changeOrgMemberStatus(userId: string, dto: ChangeUserStatusDto, actor: RequestUser) {
    await this.assertOrgMemberAccess(userId, actor);
    return this.changeUserStatusInternal(userId, dto, actor, "org.user.status");
  }

  private async changeUserStatusInternal(userId: string, dto: ChangeUserStatusDto, actor: RequestUser, action: string) {
    this.requireReason(dto.reason, "상태 변경 사유를 입력해 주세요");
    if (userId === actor.id && dto.status !== UserStatus.ACTIVE) {
      throw new BadRequestException("본인 계정은 차단하거나 비활성화할 수 없어요");
    }

    const before = await this.prisma.user.findUnique({
      where: { id: userId },
      select: this.userAuditSelect()
    });
    if (!before) {
      throw new NotFoundException("회원을 찾을 수 없어요");
    }

    const after = await this.prisma.user.update({
      where: { id: userId },
      data:
        dto.status === UserStatus.ACTIVE
          ? { status: dto.status, failedLoginCount: 0, lockedUntil: null }
          : { status: dto.status },
      select: this.userAuditSelect()
    });

    await this.log({
      actorId: actor.id,
      action,
      entity: "User",
      entityId: userId,
      organizationId: after.organizationId ?? undefined,
      reason: dto.reason,
      before,
      after
    });

    return after;
  }

  async requestProfile(userId: string, dto: ProfileRequestDto, actor: RequestUser) {
    return this.requestProfileInternal(userId, dto, actor, "admin.user.profile_request");
  }

  async requestOrgMemberProfile(userId: string, dto: ProfileRequestDto, actor: RequestUser) {
    await this.assertOrgMemberAccess(userId, actor);
    return this.requestProfileInternal(userId, dto, actor, "org.user.profile_request");
  }

  private async requestProfileInternal(userId: string, dto: ProfileRequestDto, actor: RequestUser, action: string) {
    this.requireReason(dto.reason, "프로필 보완 요청 사유를 입력해 주세요");
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: this.userAuditSelect()
    });
    if (!target) {
      throw new NotFoundException("회원을 찾을 수 없어요");
    }

    const notification = await this.notifications.createNotification({
      userId,
      type: "profile.request",
      payload: {
        reason: dto.reason,
        message: dto.message || "프로필 정보를 보완해 주세요",
        requestedById: actor.id
      }
    });
    const emailDelivery = await this.mail.queueEmail({
      userId,
      toEmail: target.email,
      subject: "[아트브릿지] 프로필 보완 요청",
      templateKey: "profile.request",
      bodyText: this.profileRequestEmailBody({
        recipientName: target.name,
        reason: dto.reason,
        message: dto.message,
        actorName: actor.name,
        settingsUrl: `${this.appPublicUrl()}/settings`
      }),
      metadata: {
        reason: dto.reason,
        message: dto.message ?? null,
        requestedById: actor.id,
        requestedByName: actor.name,
        notificationId: notification.id,
        fromEmail: this.mail.fromEmail()
      }
    });

    await this.log({
      actorId: actor.id,
      action,
      entity: "User",
      entityId: userId,
      organizationId: target.organizationId ?? undefined,
      reason: dto.reason,
      after: { notificationId: notification.id, emailDeliveryId: emailDelivery.id, message: dto.message ?? null }
    });

    return { ok: true, notificationId: notification.id, emailDeliveryId: emailDelivery.id, emailDeliveryStatus: emailDelivery.status };
  }

  async listActivityLogs(query: AdminListQueryDto = {}) {
    const q = query.q?.trim();
    const andFilters: Prisma.ActivityLogWhereInput[] = [];
    if (query.userId) {
      andFilters.push({
        OR: [
          { actorId: query.userId },
          { entity: "User", entityId: query.userId }
        ]
      });
    }
    const logs = await this.prisma.activityLog.findMany({
      where: {
        organizationId: query.organizationId || undefined,
        productionId: query.productionId || undefined,
        actorId: query.actorId || undefined,
        action: query.action ? { contains: query.action.trim(), mode: "insensitive" as const } : undefined,
        entity: query.entity ? { contains: query.entity.trim(), mode: "insensitive" as const } : undefined,
        entityId: query.entityId || undefined,
        ...(andFilters.length ? { AND: andFilters } : {}),
        ...(q
          ? {
              OR: [
                { action: { contains: q, mode: "insensitive" as const } },
                { entity: { contains: q, mode: "insensitive" as const } },
                { entityId: { contains: q, mode: "insensitive" as const } },
                { reason: { contains: q, mode: "insensitive" as const } }
              ]
            }
          : {})
      },
      orderBy: { createdAt: "desc" },
      take: this.take(query.take)
    });

    const actorIds = [...new Set(logs.map((log) => log.actorId))];
    const organizationIds = [...new Set(logs.map((log) => log.organizationId).filter(Boolean))] as string[];
    const productionIds = [...new Set(logs.map((log) => log.productionId).filter(Boolean))] as string[];
    const [actors, organizations, productions] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true } }),
      this.prisma.organization.findMany({ where: { id: { in: organizationIds } }, select: { id: true, name: true } }),
      this.prisma.production.findMany({ where: { id: { in: productionIds } }, select: { id: true, title: true } })
    ]);
    const actorMap = new Map(actors.map((actor) => [actor.id, actor]));
    const organizationMap = new Map(organizations.map((organization) => [organization.id, organization]));
    const productionMap = new Map(productions.map((production) => [production.id, production]));

    return logs.map((log) => ({
      ...log,
      actor: actorMap.get(log.actorId) ?? null,
      organization: log.organizationId ? (organizationMap.get(log.organizationId) ?? null) : null,
      production: log.productionId ? (productionMap.get(log.productionId) ?? null) : null
    }));
  }

  async listOrgActivityLogs(query: AdminListQueryDto = {}, user: RequestUser) {
    if (user.platformRole === "SUPER_ADMIN") {
      return this.listActivityLogs(query);
    }

    const organizationId = await this.getActorOrganizationId(user);
    return this.listActivityLogs({ ...query, organizationId });
  }

  async listChecklistTemplates() {
    await this.ensureChecklistTemplates();
    return this.prisma.checklistTemplate.findMany({
      orderBy: [{ phase: "asc" }, { order: "asc" }, { createdAt: "asc" }]
    });
  }

  async createChecklistTemplate(dto: CreateChecklistTemplateDto, user: RequestUser) {
    this.requireReason(dto.reason, "템플릿 변경 사유를 입력해 주세요");
    const label = dto.label.trim();
    if (!label) {
      throw new BadRequestException("템플릿 항목명을 입력해 주세요");
    }

    const order =
      dto.order ??
      ((await this.prisma.checklistTemplate.count({
        where: { phase: dto.phase }
      })) + 1);
    const template = await this.prisma.checklistTemplate.create({
      data: {
        phase: dto.phase,
        order,
        label,
        description: dto.description?.trim() || null,
        assigneeRole: dto.assigneeRole ?? null,
        staffDiscipline: dto.staffDiscipline ?? null,
        requiresApproval: dto.requiresApproval ?? false,
        active: dto.active ?? true,
        createdById: user.id,
        updatedById: user.id
      }
    });

    await this.log({
      actorId: user.id,
      action: "admin.checklist_template.create",
      entity: "ChecklistTemplate",
      entityId: template.id,
      reason: dto.reason,
      after: template
    });

    return template;
  }

  async updateChecklistTemplate(templateId: string, dto: UpdateChecklistTemplateDto, user: RequestUser) {
    this.requireReason(dto.reason, "템플릿 변경 사유를 입력해 주세요");
    const before = await this.prisma.checklistTemplate.findUnique({ where: { id: templateId } });
    if (!before) {
      throw new NotFoundException("템플릿을 찾을 수 없어요");
    }

    const data: Prisma.ChecklistTemplateUpdateInput = {
      description: dto.description === undefined ? undefined : dto.description?.trim() || null,
      assigneeRole: dto.assigneeRole === undefined ? undefined : dto.assigneeRole,
      staffDiscipline: dto.staffDiscipline === undefined ? undefined : dto.staffDiscipline,
      requiresApproval: dto.requiresApproval,
      active: dto.active,
      order: dto.order,
      updatedById: user.id
    };

    if (dto.label !== undefined) {
      const label = dto.label.trim();
      if (!label) {
        throw new BadRequestException("템플릿 항목명을 입력해 주세요");
      }
      data.label = label;
    }

    const after = await this.prisma.checklistTemplate.update({
      where: { id: templateId },
      data
    });

    await this.log({
      actorId: user.id,
      action: "admin.checklist_template.update",
      entity: "ChecklistTemplate",
      entityId: templateId,
      reason: dto.reason,
      before,
      after
    });

    return after;
  }

  async listSettings() {
    await this.ensureSystemSettings();
    return this.prisma.systemSetting.findMany({ orderBy: { key: "asc" } });
  }

  async updateSetting(key: string, dto: UpdateSystemSettingDto, user: RequestUser) {
    this.requireReason(dto.reason, "시스템 설정 변경 사유를 입력해 주세요");
    const before = await this.prisma.systemSetting.findUnique({ where: { key } });
    const valueType = dto.valueType ?? before?.valueType ?? AdminSettingValueType.JSON;
    const value = this.normalizeSettingValue(dto.value, valueType);

    const after = await this.prisma.systemSetting.upsert({
      where: { key },
      update: {
        value,
        valueType,
        description: dto.description === undefined ? undefined : dto.description?.trim() || null,
        updatedById: user.id
      },
      create: {
        key,
        value,
        valueType,
        description: dto.description?.trim() || null,
        updatedById: user.id
      }
    });

    await this.log({
      actorId: user.id,
      action: "admin.system_setting.update",
      entity: "SystemSetting",
      entityId: key,
      reason: dto.reason,
      before,
      after
    });

    return after;
  }

  private async ensureChecklistTemplates() {
    await ensureGlobalChecklistTemplates(this.prisma);
  }

  private async ensureSystemSettings() {
    for (const setting of DEFAULT_SETTINGS) {
      await this.prisma.systemSetting.upsert({
        where: { key: setting.key },
        update: {},
        create: setting
      });
    }
  }

  private async log(input: {
    actorId: string;
    action: string;
    entity: string;
    entityId: string;
    productionId?: string;
    organizationId?: string;
    reason?: string | null;
    before?: unknown;
    after?: unknown;
  }) {
    return this.prisma.activityLog.create({
      data: {
        actorId: input.actorId,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
        productionId: input.productionId,
        organizationId: input.organizationId,
        reason: input.reason?.trim() || null,
        beforeJson: input.before === undefined ? undefined : this.toJson(input.before),
        afterJson: input.after === undefined ? undefined : this.toJson(input.after)
      }
    });
  }

  private requireReason(reason: string | undefined | null, message: string) {
    if (!reason?.trim()) {
      throw new BadRequestException(message);
    }
  }

  private profileRequestEmailBody(input: {
    recipientName: string;
    reason: string;
    message?: string;
    actorName: string;
    settingsUrl: string;
  }) {
    return [
      `${input.recipientName}님, 프로필 보완 요청이 도착했습니다.`,
      "",
      `요청 사유: ${input.reason}`,
      input.message ? `메시지: ${input.message}` : null,
      `요청자: ${input.actorName}`,
      "",
      "프로필 정보는 공연 매칭, 배역 검토, 스태프 직무 배정에 사용됩니다.",
      "설정 화면에서 연락처와 직군별 상세정보를 확인해 주세요.",
      input.settingsUrl
    ].filter(Boolean).join("\n");
  }

  private appPublicUrl() {
    return (this.config.get<string>("APP_PUBLIC_URL") || "http://localhost:5173").replace(/\/+$/, "");
  }

  private async getActorOrganizationId(actor: RequestUser) {
    const dbUser = await this.prisma.user.findUnique({
      where: { id: actor.id },
      select: { organizationId: true }
    });
    if (!dbUser?.organizationId) {
      throw new ForbiddenException("단체 관리자 소속 단체가 없어요");
    }
    return dbUser.organizationId;
  }

  private async assertOrgMemberAccess(userId: string, actor: RequestUser) {
    if (actor.platformRole === "SUPER_ADMIN") {
      return;
    }

    const [organizationId, target] = await Promise.all([
      this.getActorOrganizationId(actor),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { organizationId: true }
      })
    ]);

    if (!target) {
      throw new NotFoundException("회원을 찾을 수 없어요");
    }
    if (target.organizationId !== organizationId) {
      throw new ForbiddenException("다른 단체 회원은 관리할 수 없어요");
    }
  }

  private take(value: number | undefined) {
    return Math.min(Math.max(value ?? 50, 1), 100);
  }

  private currentMonthFilter(base = new Date()): Prisma.DateTimeFilter {
    const start = new Date(base);
    start.setDate(1);
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);

    return { gte: start, lt: end };
  }

  private parseUserStatus(status: string | undefined) {
    return status && Object.values(UserStatus).includes(status as UserStatus) ? (status as UserStatus) : undefined;
  }

  private parseOrganizationStatus(status: string | undefined) {
    return status && Object.values(OrganizationStatus).includes(status as OrganizationStatus)
      ? (status as OrganizationStatus)
      : undefined;
  }

  private normalizeSettingValue(value: unknown, valueType: AdminSettingValueType): Prisma.InputJsonValue {
    if (valueType === AdminSettingValueType.NUMBER) {
      const numberValue = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(numberValue)) {
        throw new BadRequestException("숫자 설정값을 입력해 주세요");
      }
      return numberValue;
    }
    if (valueType === AdminSettingValueType.BOOLEAN) {
      return value === true || value === "true";
    }
    if (valueType === AdminSettingValueType.STRING) {
      return String(value ?? "");
    }
    return this.toJson(value ?? null);
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private userAuditSelect(): Prisma.UserSelect {
    return {
      id: true,
      organizationId: true,
      email: true,
      name: true,
      status: true,
      failedLoginCount: true,
      lockedUntil: true,
      profileType: true,
      profileComplete: true,
      platformRole: true
    };
  }
}
