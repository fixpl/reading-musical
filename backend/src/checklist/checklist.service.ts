import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import {
  ChecklistStatus,
  LinkedResourceType,
  Phase,
  Prisma,
  ProductionRole,
  StaffDiscipline
} from "@prisma/client";
import type { RequestUser } from "../common/types/request-user";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  ApproveChecklistItemDto,
  CreateChecklistItemDto,
  DeleteChecklistItemDto,
  PutChecklistAssignmentsDto,
  UpdateChecklistItemDto,
  UpdateChecklistStatusDto
} from "./dto";
import { activeChecklistTemplateSeeds, CHECKLIST_PHASE_ORDER } from "./checklist-template-seed";
import { isPlatformAdmin } from "../common/access/is-production-admin";
import { assertProductionMembership } from "../common/access/assert-production-membership";

const PHASE_ORDER = [...CHECKLIST_PHASE_ORDER];
const VIEW_ROLES: ProductionRole[] = [
  ProductionRole.PRODUCER,
  ProductionRole.DIRECTOR,
  ProductionRole.MUSIC_DIRECTOR,
  ProductionRole.STAGE_MANAGER,
  ProductionRole.ACTOR,
  ProductionRole.STAFF,
  ProductionRole.GUEST
];
const EDIT_ROLES: ProductionRole[] = [ProductionRole.PRODUCER, ProductionRole.DIRECTOR, ProductionRole.STAGE_MANAGER];
const APPROVER_BASE_ROLES: ProductionRole[] = [ProductionRole.PRODUCER, ProductionRole.DIRECTOR, ProductionRole.STAGE_MANAGER];
const NON_APPROVER_ROLES: ProductionRole[] = [ProductionRole.ACTOR, ProductionRole.STAFF, ProductionRole.GUEST];

const CHECKLIST_ITEM_INCLUDE = {
  phase: { select: { id: true, phase: true, productionId: true } },
  event: { select: { id: true, title: true, type: true, startAt: true, endAt: true } },
  assignments: {
    include: {
      membership: {
        include: {
          user: { select: { id: true, email: true, name: true, profileType: true, profileComplete: true } },
          roles: { select: { role: true } },
          staffAssignments: true
        }
      }
    }
  },
  runSheetItems: { select: { id: true, title: true, completedAt: true } }
} satisfies Prisma.ChecklistItemInclude;

type MembershipContext = Prisma.MembershipGetPayload<{ include: { roles: true; staffAssignments: true } }>;
type ChecklistItemDetail = Prisma.ChecklistItemGetPayload<{ include: typeof CHECKLIST_ITEM_INCLUDE }>;

@Injectable()
export class ChecklistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService
  ) {}

  async getWorkspace(productionId: string, user: RequestUser) {
    const membership = await this.assertMembership(productionId, user, VIEW_ROLES);
    await this.ensureDefaultChecklist(productionId);

    const [production, phases, memberships, events] = await Promise.all([
      this.prisma.production.findUnique({
        where: { id: productionId },
        select: { id: true, title: true, currentPhase: true, visibility: true }
      }),
      this.prisma.checklistPhase.findMany({
        where: { productionId },
        include: { items: { orderBy: [{ order: "asc" }, { label: "asc" }], include: this.itemInclude() } }
      }),
      this.prisma.membership.findMany({
        where: { productionId },
        orderBy: { createdAt: "asc" },
        include: {
          user: { select: { id: true, email: true, name: true, profileType: true, profileComplete: true } },
          roles: { select: { role: true } },
          staffAssignments: true
        }
      }),
      this.prisma.scheduleEvent.findMany({
        where: { productionId },
        orderBy: { startAt: "asc" },
        select: { id: true, title: true, type: true, startAt: true, endAt: true }
      })
    ]);

    if (!production) {
      throw new NotFoundException("공연을 찾을 수 없어요");
    }

    const sortedPhases = phases.sort((a, b) => PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase));
    const items = sortedPhases.flatMap((phase) => phase.items);
    const myMembershipId = membership?.id ?? null;

    return {
      production,
      myMembershipId,
      myRoles: this.rolesOf(membership),
      canEdit: this.isEditor(user, membership),
      phases: sortedPhases,
      memberships,
      events,
      totals: {
        items: items.length,
        done: items.filter((item) => item.status === ChecklistStatus.DONE).length,
        waitingApproval: items.filter((item) => item.status === ChecklistStatus.WAITING_APPROVAL).length,
        blocked: items.filter((item) => item.status === ChecklistStatus.BLOCKED).length,
        myAssigned: items.filter((item) => this.isAssignedToItem(item, membership)).length
      }
    };
  }

  async createItem(productionId: string, dto: CreateChecklistItemDto, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    const phase = await this.assertPhase(productionId, dto.phase);
    await this.assertEventIfNeeded(productionId, dto.eventId);
    await this.assertLinkedResourceIfNeeded(productionId, dto.linkedResourceType, dto.linkedResourceId);
    const membershipIds = dto.assignmentMembershipIds ?? [];
    if (membershipIds.length) {
      await this.assertMembershipIds(productionId, membershipIds);
    }

    const maxOrder = await this.prisma.checklistItem.aggregate({
      where: { phaseId: phase.id },
      _max: { order: true }
    });
    const order = dto.order ?? (maxOrder._max.order ?? 0) + 1;

    const created = await this.prisma.checklistItem.create({
      data: {
        phaseId: phase.id,
        order,
        label: dto.label.trim(),
        description: dto.description?.trim() || null,
        assigneeRole: dto.assigneeRole ?? null,
        staffDiscipline: dto.staffDiscipline ?? null,
        requiresApproval: dto.requiresApproval ?? false,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
        eventId: dto.eventId ?? null,
        linkedResourceType: dto.linkedResourceType ?? null,
        linkedResourceId: dto.linkedResourceId?.trim() || null,
        assignments: { create: membershipIds.map((membershipId) => ({ membershipId })) }
      },
      include: this.itemInclude()
    });

    await this.writeActivityLog(productionId, user, {
      action: "checklist.item_created",
      entityId: created.id,
      reason: "체크리스트 항목 생성",
      afterJson: this.checklistItemAuditSnapshot(created)
    });

    return created;
  }

  async updateItem(productionId: string, itemId: string, dto: UpdateChecklistItemDto, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    const existing = await this.assertItem(productionId, itemId);
    const phase = dto.phase ? await this.assertPhase(productionId, dto.phase) : null;
    await this.assertEventIfNeeded(productionId, dto.eventId);
    await this.assertLinkedResourceIfNeeded(productionId, dto.linkedResourceType, dto.linkedResourceId);

    const updated = await this.prisma.checklistItem.update({
      where: { id: itemId },
      data: {
        phaseId: phase?.id,
        order: dto.order,
        label: dto.label?.trim(),
        description: dto.description === undefined ? undefined : dto.description?.trim() || null,
        assigneeRole: dto.assigneeRole === undefined ? undefined : dto.assigneeRole,
        staffDiscipline: dto.staffDiscipline === undefined ? undefined : dto.staffDiscipline,
        requiresApproval: dto.requiresApproval,
        dueAt: dto.dueAt === undefined ? undefined : dto.dueAt ? new Date(dto.dueAt) : null,
        eventId: dto.eventId === undefined ? undefined : dto.eventId,
        linkedResourceType: dto.linkedResourceType === undefined ? undefined : dto.linkedResourceType,
        linkedResourceId: dto.linkedResourceId === undefined ? undefined : dto.linkedResourceId?.trim() || null
      },
      include: this.itemInclude()
    });

    await this.writeActivityLog(productionId, user, {
      action: "checklist.item_updated",
      entityId: itemId,
      reason: "체크리스트 항목 수정",
      beforeJson: this.checklistItemAuditSnapshot(existing),
      afterJson: this.checklistItemAuditSnapshot(updated)
    });

    return updated;
  }

  async deleteItem(productionId: string, itemId: string, force: boolean, dto: DeleteChecklistItemDto, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    const deleteReason = dto?.reason?.trim();
    if (!deleteReason) {
      throw new BadRequestException("체크리스트 삭제 사유를 입력해 주세요");
    }
    const existing = await this.assertItem(productionId, itemId);
    const impact = {
      assignments: await this.prisma.checklistAssignment.count({ where: { itemId } }),
      runSheetItems: await this.prisma.runSheetItem.count({ where: { checklistItemId: itemId } })
    };
    if (!force && impact.runSheetItems > 0) {
      throw new ConflictException({
        message: "진행표에 연결된 체크리스트 항목이에요. 영향 내용을 확인한 뒤 삭제해 주세요.",
        impact
      });
    }

    const auditScope = await this.getProductionAuditScope(productionId);
    await this.prisma.$transaction([
      this.prisma.activityLog.create({
        data: {
          ...auditScope,
          actorId: user.id,
          action: "checklist.item_deleted",
          entity: "ChecklistItem",
          entityId: itemId,
          reason: deleteReason,
          beforeJson: this.toJson({ ...this.checklistItemAuditSnapshot(existing), impact }),
          afterJson: this.toJson({ deletedId: itemId, deletedAt: new Date().toISOString() })
        }
      }),
      this.prisma.runSheetItem.updateMany({ where: { checklistItemId: itemId }, data: { checklistItemId: null } }),
      this.prisma.checklistAssignment.deleteMany({ where: { itemId } }),
      this.prisma.checklistItem.delete({ where: { id: itemId } })
    ]);

    return { deletedId: itemId, impact };
  }

  async putAssignments(productionId: string, itemId: string, dto: PutChecklistAssignmentsDto, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    const existing = await this.assertItem(productionId, itemId);
    await this.assertMembershipIds(productionId, dto.membershipIds);

    await this.prisma.$transaction([
      this.prisma.checklistAssignment.deleteMany({ where: { itemId } }),
      ...dto.membershipIds.map((membershipId) => this.prisma.checklistAssignment.create({ data: { itemId, membershipId } }))
    ]);

    const updated = await this.assertItem(productionId, itemId);
    await this.writeActivityLog(productionId, user, {
      action: "checklist.assignments_updated",
      entityId: itemId,
      reason: "체크리스트 담당자 변경",
      beforeJson: this.checklistItemAuditSnapshot(existing),
      afterJson: this.checklistItemAuditSnapshot(updated)
    });

    return updated;
  }

  async updateStatus(productionId: string, itemId: string, dto: UpdateChecklistStatusDto, user: RequestUser) {
    const membership = await this.assertMembership(productionId, user, VIEW_ROLES);
    const item = await this.assertItem(productionId, itemId);
    if (!this.canWorkOnItem(user, membership, item)) {
      throw new ForbiddenException("담당 항목만 상태를 변경할 수 있어요");
    }
    if (item.status === ChecklistStatus.WAITING_APPROVAL && dto.status === ChecklistStatus.DONE) {
      throw new BadRequestException("승인이 필요한 항목은 승인 버튼으로 완료해 주세요");
    }
    if (dto.evidenceAssetIds?.length) {
      await this.assertAssetIds(productionId, dto.evidenceAssetIds);
    }

    const nextStatus = this.resolveNextStatus(item, dto.status);
    const completed = nextStatus === ChecklistStatus.DONE || nextStatus === ChecklistStatus.WAITING_APPROVAL;
    const resetApproval = nextStatus !== ChecklistStatus.DONE;
    const updated = await this.prisma.checklistItem.update({
      where: { id: itemId },
      data: {
        status: nextStatus,
        done: nextStatus === ChecklistStatus.DONE,
        doneAt: completed ? new Date() : null,
        doneBy: completed ? user.id : null,
        completionNote: dto.completionNote === undefined ? undefined : dto.completionNote?.trim() || null,
        evidenceAssetIds: dto.evidenceAssetIds === undefined ? undefined : (dto.evidenceAssetIds as Prisma.InputJsonValue),
        approvedById: resetApproval ? null : undefined,
        approvedAt: resetApproval ? null : undefined,
        reviewNote: resetApproval ? null : undefined
      },
      include: this.itemInclude()
    });

    await this.writeActivityLog(productionId, user, {
      action: "checklist.status_changed",
      entityId: itemId,
      reason: dto.completionNote?.trim() || "체크리스트 상태 변경",
      beforeJson: this.checklistItemAuditSnapshot(item),
      afterJson: this.checklistItemAuditSnapshot(updated)
    });

    if (nextStatus === ChecklistStatus.WAITING_APPROVAL) {
      await this.notifyApprovers(productionId, updated, user.id);
    }

    return updated;
  }

  async approveItem(productionId: string, itemId: string, dto: ApproveChecklistItemDto, user: RequestUser) {
    const membership = await this.assertMembership(productionId, user, VIEW_ROLES);
    const item = await this.assertItem(productionId, itemId);
    if (item.status !== ChecklistStatus.WAITING_APPROVAL) {
      throw new BadRequestException("승인 대기 상태의 항목만 승인할 수 있어요");
    }
    if (!this.canApproveItem(user, membership, item)) {
      throw new ForbiddenException("이 항목을 승인할 권한이 없어요");
    }
    if (dto.decision === "REJECTED" && !dto.reviewNote?.trim()) {
      throw new BadRequestException("반려 사유를 입력해 주세요");
    }

    const approved = dto.decision === "APPROVED";
    const updated = await this.prisma.checklistItem.update({
      where: { id: itemId },
      data: {
        status: approved ? ChecklistStatus.DONE : ChecklistStatus.IN_PROGRESS,
        done: approved,
        approvedById: approved ? user.id : null,
        approvedAt: approved ? new Date() : null,
        reviewNote: dto.reviewNote?.trim() || null
      },
      include: this.itemInclude()
    });

    await this.writeActivityLog(productionId, user, {
      action: approved ? "checklist.item_approved" : "checklist.item_rejected",
      entityId: itemId,
      reason: dto.reviewNote?.trim() || (approved ? "체크리스트 승인" : "체크리스트 반려"),
      beforeJson: this.checklistItemAuditSnapshot(item),
      afterJson: this.checklistItemAuditSnapshot(updated)
    });

    await this.notifyAssignedUsers(productionId, updated, approved ? "checklist.approved" : "checklist.rejected", user.id);
    return updated;
  }

  private async ensureDefaultChecklist(productionId: string) {
    const existingItems = await this.prisma.checklistItem.count({ where: { phase: { productionId } } });
    if (existingItems > 0) {
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      const seedsByPhase = await activeChecklistTemplateSeeds(tx);
      for (const phase of PHASE_ORDER) {
        const checklistPhase = await tx.checklistPhase.upsert({
          where: { productionId_phase: { productionId, phase } },
          update: {},
          create: { productionId, phase }
        });
        const seeds = seedsByPhase.get(phase) ?? [];
        if (seeds.length === 0) {
          continue;
        }
        await tx.checklistItem.createMany({
          data: seeds.map((item) => ({ ...item, phaseId: checklistPhase.id }))
        });
      }
    });
  }

  private async assertMembership(productionId: string, user: RequestUser, roles: ProductionRole[]) {
    return assertProductionMembership(this.prisma, user, productionId, roles, {
      include: { roles: true, staffAssignments: true }
    });
  }

  private async assertPhase(productionId: string, phase: Phase) {
    return this.prisma.checklistPhase.upsert({
      where: { productionId_phase: { productionId, phase } },
      update: {},
      create: { productionId, phase }
    });
  }

  private async assertItem(productionId: string, itemId: string) {
    const item = await this.prisma.checklistItem.findFirst({
      where: { id: itemId, phase: { productionId } },
      include: this.itemInclude()
    });
    if (!item) {
      throw new NotFoundException("체크리스트 항목을 찾을 수 없어요");
    }
    return item;
  }

  private async assertMembershipIds(productionId: string, membershipIds: string[]) {
    if (!membershipIds.length) {
      return;
    }
    const uniqueIds = [...new Set(membershipIds)];
    if (uniqueIds.length !== membershipIds.length) {
      throw new ConflictException("중복 담당자가 있어요");
    }
    const count = await this.prisma.membership.count({ where: { productionId, id: { in: uniqueIds } } });
    if (count !== uniqueIds.length) {
      throw new BadRequestException("이 공연에 속하지 않는 담당자가 포함되어 있어요");
    }
  }

  private async assertEventIfNeeded(productionId: string, eventId?: string | null) {
    if (!eventId) {
      return;
    }
    const event = await this.prisma.scheduleEvent.findFirst({ where: { id: eventId, productionId }, select: { id: true } });
    if (!event) {
      throw new BadRequestException("이 공연에 속하지 않는 일정이에요");
    }
  }

  private async assertLinkedResourceIfNeeded(productionId: string, type?: LinkedResourceType | null, id?: string | null) {
    if (!type && !id) {
      return;
    }
    if (!type || !id) {
      throw new BadRequestException("연결 리소스는 타입과 id를 함께 입력해 주세요");
    }
    const exists = await this.linkedResourceExists(productionId, type, id);
    if (!exists) {
      throw new BadRequestException("이 공연에 속하지 않는 연결 리소스예요");
    }
  }

  private async linkedResourceExists(productionId: string, type: LinkedResourceType, id: string) {
    switch (type) {
      case LinkedResourceType.SCRIPT:
        return Boolean(await this.prisma.script.findFirst({ where: { id, productionId }, select: { id: true } }));
      case LinkedResourceType.SCENE:
        return Boolean(await this.prisma.scene.findFirst({ where: { id, act: { script: { productionId } } }, select: { id: true } }));
      case LinkedResourceType.SCENE_BLOCK:
        return Boolean(await this.prisma.sceneBlock.findFirst({ where: { id, scene: { act: { script: { productionId } } } }, select: { id: true } }));
      case LinkedResourceType.MUSIC_CUE:
        return Boolean(await this.prisma.musicCue.findFirst({ where: { id, productionId }, select: { id: true } }));
      case LinkedResourceType.STAGE_PLAN:
        return Boolean(await this.prisma.stagePlan.findFirst({ where: { id, productionId }, select: { id: true } }));
      case LinkedResourceType.EVENT:
        return Boolean(await this.prisma.scheduleEvent.findFirst({ where: { id, productionId }, select: { id: true } }));
      case LinkedResourceType.ASSET:
        return Boolean(await this.prisma.asset.findFirst({ where: { id, productionId }, select: { id: true } }));
      case LinkedResourceType.RUN_SHEET:
        return Boolean(await this.prisma.runSheet.findFirst({ where: { id, productionId }, select: { id: true } }));
      case LinkedResourceType.RUN_SHEET_ITEM:
        return Boolean(await this.prisma.runSheetItem.findFirst({ where: { id, runSheet: { productionId } }, select: { id: true } }));
      default:
        return false;
    }
  }

  private async assertAssetIds(productionId: string, assetIds: string[]) {
    const uniqueIds = [...new Set(assetIds)];
    const count = await this.prisma.asset.count({ where: { id: { in: uniqueIds }, productionId } });
    if (count !== uniqueIds.length) {
      throw new BadRequestException("이 공연에 속하지 않는 증빙 파일이 포함되어 있어요");
    }
  }

  private resolveNextStatus(item: ChecklistItemDetail, requested: ChecklistStatus) {
    if (requested === ChecklistStatus.DONE || requested === ChecklistStatus.WAITING_APPROVAL) {
      return item.requiresApproval ? ChecklistStatus.WAITING_APPROVAL : ChecklistStatus.DONE;
    }
    return requested;
  }

  private canWorkOnItem(user: RequestUser, membership: MembershipContext | null, item: ChecklistItemDetail) {
    return isPlatformAdmin(user) || this.isEditor(user, membership) || this.isAssignedToItem(item, membership);
  }

  private canApproveItem(user: RequestUser, membership: MembershipContext | null, item: ChecklistItemDetail) {
    if (isPlatformAdmin(user) || this.isEditor(user, membership)) {
      return true;
    }
    const roles = this.rolesOf(membership);
    if (item.linkedResourceType === LinkedResourceType.MUSIC_CUE && roles.includes(ProductionRole.MUSIC_DIRECTOR)) {
      return true;
    }
    if (item.assigneeRole && this.moduleOwnerRoles(item).some((role) => roles.includes(role))) {
      return true;
    }
    return false;
  }

  private isEditor(user: RequestUser, membership: MembershipContext | null) {
    return isPlatformAdmin(user) || this.rolesOf(membership).some((role) => EDIT_ROLES.includes(role));
  }

  private isAssignedToItem(item: ChecklistItemDetail, membership: MembershipContext | null) {
    if (!membership) {
      return false;
    }
    if (item.assignments.some((assignment) => assignment.membershipId === membership.id)) {
      return true;
    }
    const roles = this.rolesOf(membership);
    if (item.assigneeRole && roles.includes(item.assigneeRole)) {
      if (item.staffDiscipline && item.assigneeRole === ProductionRole.STAFF) {
        return this.hasStaffDiscipline(membership, item.staffDiscipline);
      }
      return true;
    }
    return Boolean(item.staffDiscipline && this.hasStaffDiscipline(membership, item.staffDiscipline));
  }

  private hasStaffDiscipline(membership: MembershipContext, discipline: StaffDiscipline) {
    return membership.staffAssignments.some((assignment) => assignment.discipline === discipline);
  }

  private rolesOf(membership: MembershipContext | null) {
    return membership?.roles.map((role) => role.role) ?? [];
  }

  private moduleOwnerRoles(item: ChecklistItemDetail) {
    const roles = new Set<ProductionRole>(APPROVER_BASE_ROLES);
    if (item.assigneeRole && !NON_APPROVER_ROLES.includes(item.assigneeRole)) {
      roles.add(item.assigneeRole);
    }
    if (item.staffDiscipline) {
      roles.add(ProductionRole.STAGE_MANAGER);
    }
    if (item.linkedResourceType === LinkedResourceType.MUSIC_CUE) {
      roles.add(ProductionRole.MUSIC_DIRECTOR);
    }
    return [...roles];
  }

  private async notifyApprovers(productionId: string, item: ChecklistItemDetail, actorId: string) {
    const roles = this.moduleOwnerRoles(item);
    const memberships = await this.prisma.membership.findMany({
      where: { productionId, userId: { not: actorId }, roles: { some: { role: { in: roles } } } },
      select: { userId: true }
    });
    await this.createNotifications(productionId, memberships.map((membership) => membership.userId), "checklist.waiting_approval", item.id);
  }

  private async notifyAssignedUsers(productionId: string, item: ChecklistItemDetail, type: string, actorId: string) {
    const explicitUserIds = item.assignments.map((assignment) => assignment.membership.userId);
    const roleUserIds = item.assigneeRole
      ? (
          await this.prisma.membership.findMany({
            where: { productionId, roles: { some: { role: item.assigneeRole } } },
            select: { userId: true }
          })
        ).map((membership) => membership.userId)
      : [];
    await this.createNotifications(
      productionId,
      [...new Set([...explicitUserIds, ...roleUserIds])].filter((userId) => userId !== actorId),
      type,
      item.id
    );
  }

  private async createNotifications(productionId: string, userIds: string[], type: string, itemId: string) {
    if (!userIds.length) {
      return;
    }
    await this.notifications.createNotifications(
      [...new Set(userIds)].map((userId) => ({
        productionId,
        userId,
        type,
        payload: { checklistItemId: itemId } as Prisma.InputJsonValue
      }))
    );
  }

  private async writeActivityLog(
    productionId: string,
    user: RequestUser,
    input: {
      action: string;
      entityId: string;
      reason?: string | null;
      beforeJson?: unknown;
      afterJson?: unknown;
    }
  ) {
    const auditScope = await this.getProductionAuditScope(productionId);
    await this.prisma.activityLog.create({
      data: {
        ...auditScope,
        actorId: user.id,
        action: input.action,
        entity: "ChecklistItem",
        entityId: input.entityId,
        reason: input.reason?.trim() || null,
        beforeJson: input.beforeJson === undefined ? undefined : this.toJson(input.beforeJson),
        afterJson: input.afterJson === undefined ? undefined : this.toJson(input.afterJson)
      }
    });
  }

  private async getProductionAuditScope(productionId: string) {
    const production = await this.prisma.production.findUnique({
      where: { id: productionId },
      select: { id: true, organizationId: true }
    });
    if (!production) {
      throw new NotFoundException("공연을 찾을 수 없어요");
    }
    return { productionId: production.id, organizationId: production.organizationId };
  }

  private checklistItemAuditSnapshot(item: ChecklistItemDetail) {
    return {
      id: item.id,
      productionId: item.phase.productionId,
      phase: item.phase.phase,
      eventId: item.eventId,
      order: item.order,
      label: item.label,
      description: item.description,
      status: item.status,
      assigneeRole: item.assigneeRole,
      staffDiscipline: item.staffDiscipline,
      assignmentMembershipIds: item.assignments.map((assignment) => assignment.membershipId).sort(),
      assignmentUsers: item.assignments
        .map((assignment) => ({
          membershipId: assignment.membershipId,
          userId: assignment.membership.user.id,
          userName: assignment.membership.user.name,
          roles: assignment.membership.roles.map((role) => role.role).sort(),
          staffDisciplines: assignment.membership.staffAssignments.map((staff) => staff.discipline).sort()
        }))
        .sort((a, b) => a.membershipId.localeCompare(b.membershipId)),
      requiresApproval: item.requiresApproval,
      dueAt: item.dueAt?.toISOString() ?? null,
      linkedResourceType: item.linkedResourceType,
      linkedResourceId: item.linkedResourceId,
      done: item.done,
      doneAt: item.doneAt?.toISOString() ?? null,
      doneBy: item.doneBy,
      completionNote: item.completionNote,
      evidenceAssetIds: item.evidenceAssetIds,
      approvedById: item.approvedById,
      approvedAt: item.approvedAt?.toISOString() ?? null,
      reviewNote: item.reviewNote,
      runSheetItemIds: item.runSheetItems.map((item) => item.id).sort()
    };
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private itemInclude() {
    return CHECKLIST_ITEM_INCLUDE;
  }
}
