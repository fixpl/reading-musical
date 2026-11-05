import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import {
  AnchorStatus,
  ChecklistStatus,
  Prisma,
  ProductionRole,
  RunSheetItemType,
  RunSheetStatus,
  StaffDiscipline
} from "@prisma/client";
import { createHash } from "node:crypto";
import { AssetPurpose } from "../assets/dto";
import { AssetsService } from "../assets/assets.service";
import type { RequestUser } from "../common/types/request-user";
import { PrismaService } from "../prisma/prisma.service";
import { buildRunSheetExportHtml, buildRunSheetExportPdf, type ExportableRunSheet } from "./run-sheet-export.renderer";
import {
  CompleteRunSheetDto,
  CompleteRunSheetItemDto,
  CreateRunSheetDto,
  CreateRunSheetItemDto,
  DeleteRunSheetItemDto,
  GenerateRunSheetDto,
  LockRunSheetDto,
  ReorderRunSheetItemsDto,
  ReviseRunSheetDto,
  UpdateRunSheetItemDto
} from "./dto";
import { isPlatformAdmin } from "../common/access/is-production-admin";
import { assertProductionMembership } from "../common/access/assert-production-membership";
import { RunSheetAuditService } from "./run-sheet-audit.service";

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
const COMPLETE_ROLES: ProductionRole[] = [
  ProductionRole.PRODUCER,
  ProductionRole.DIRECTOR,
  ProductionRole.MUSIC_DIRECTOR,
  ProductionRole.STAGE_MANAGER,
  ProductionRole.ACTOR,
  ProductionRole.STAFF
];

type GeneratedRunSheetItem = {
  order: number;
  itemType: RunSheetItemType;
  title: string;
  estimatedDurationMin?: number | null;
  sceneId?: string | null;
  cueId?: string | null;
  stageSceneNoteId?: string | null;
  checklistItemId?: string | null;
  ownerRole?: ProductionRole | null;
  staffDiscipline?: StaffDiscipline | null;
  note?: string | null;
};

type MembershipForPolicy = Prisma.MembershipGetPayload<{ include: { roles: true; staffAssignments: true } }>;
export type RunSheetItemForPolicy = {
  id: string;
  order: number;
  itemType: RunSheetItemType;
  title: string;
  sceneId?: string | null;
  cueId?: string | null;
  stageSceneNoteId?: string | null;
  checklistItemId?: string | null;
  estimatedDurationMin?: number | null;
  ownerRole: ProductionRole | null;
  ownerMembershipId: string | null;
  staffDiscipline: StaffDiscipline | null;
  note?: string | null;
  completedAt?: Date | null;
  completedById?: string | null;
  cue?: { anchorStatus: AnchorStatus } | null;
};

export type RunSheetAuditSnapshotInput = {
  id: string;
  productionId: string;
  eventId: string;
  title: string;
  version: number;
  status: RunSheetStatus;
  createdById: string;
  lockedAt?: Date | null;
  completedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
  event?: { id: string; title: string; startAt?: Date; endAt?: Date } | null;
  items: RunSheetItemForPolicy[];
};

@Injectable()
export class RunSheetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assetsService: AssetsService,
    private readonly audit: RunSheetAuditService
  ) {}

  async getWorkspace(productionId: string, user: RequestUser) {
    const membership = await this.assertMembership(productionId, user, VIEW_ROLES);
    const [production, events, runSheets, scenes, musicCues, stageNotes, checklistItems, memberships] = await Promise.all([
      this.prisma.production.findUnique({
        where: { id: productionId },
        select: { id: true, title: true, currentPhase: true, visibility: true }
      }),
      this.prisma.scheduleEvent.findMany({
        where: { productionId },
        orderBy: [{ startAt: "asc" }, { createdAt: "asc" }],
        include: this.eventInclude()
      }),
      this.prisma.runSheet.findMany({
        where: { productionId },
        orderBy: [{ event: { startAt: "asc" } }, { version: "desc" }],
        include: this.runSheetInclude()
      }),
      this.getProductionScenes(productionId),
      this.getProductionCues(productionId),
      this.getProductionStageNotes(productionId),
      this.getProductionChecklistItems(productionId),
      this.getProductionMemberships(productionId)
    ]);

    if (!production) {
      throw new NotFoundException("공연을 찾을 수 없어요");
    }

    const myRoles = membership?.roles.map((role) => role.role) ?? [];
    const myMembershipId = membership?.id ?? null;
    const runSheetItems = runSheets.flatMap((sheet) => sheet.items);

    return {
      production,
      myMembershipId,
      myRoles,
      canEdit: this.hasAnyRole(myRoles, EDIT_ROLES) || isPlatformAdmin(user),
      events,
      runSheets,
      scenes,
      musicCues,
      stageNotes,
      checklistItems,
      memberships,
      totals: {
        events: events.length,
        runSheets: runSheets.length,
        locked: runSheets.filter((sheet) => sheet.status === RunSheetStatus.LOCKED).length,
        completed: runSheets.filter((sheet) => sheet.status === RunSheetStatus.COMPLETED).length,
        items: runSheetItems.length,
        itemDone: runSheetItems.filter((item) => item.completedAt).length,
        myAssigned: runSheetItems.filter((item) => this.isAssignedItem(item, myMembershipId, myRoles, membership?.staffAssignments ?? [])).length
      }
    };
  }

  async getRunSheet(productionId: string, runSheetId: string, user: RequestUser) {
    await this.assertMembership(productionId, user, VIEW_ROLES);
    return this.assertRunSheet(productionId, runSheetId);
  }

  async createRunSheet(productionId: string, dto: CreateRunSheetDto, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    const event = await this.assertEvent(productionId, dto.eventId);
    const version = await this.nextVersion(dto.eventId);
    const created = await this.prisma.runSheet.create({
      data: {
        productionId,
        eventId: dto.eventId,
        title: dto.title?.trim() || `${event.title} 진행표 v${version}`,
        version,
        createdById: user.id
      },
      include: this.runSheetInclude()
    });
    await this.audit.writeActivityLog(productionId, user, {
      action: "run_sheet.created",
      entity: "RunSheet",
      entityId: created.id,
      reason: "진행표 초안 생성",
      afterJson: this.audit.runSheetAuditSnapshot(created)
    });
    return created;
  }

  async generateRunSheet(productionId: string, dto: GenerateRunSheetDto, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    const event = await this.assertEvent(productionId, dto.eventId);
    const version = await this.nextVersion(event.id);
    const items = await this.buildGeneratedItems(productionId, event.id, dto);
    const created = await this.prisma.runSheet.create({
      data: {
        productionId,
        eventId: event.id,
        title: `${event.title} 진행표 v${version}`,
        version,
        createdById: user.id,
        items: { create: items }
      },
      include: this.runSheetInclude()
    });
    await this.audit.writeActivityLog(productionId, user, {
      action: "run_sheet.generated",
      entity: "RunSheet",
      entityId: created.id,
      reason: "일정 기준 진행표 자동 생성",
      afterJson: this.audit.runSheetAuditSnapshot(created)
    });
    return created;
  }

  async regenerateRunSheet(productionId: string, runSheetId: string, dto: GenerateRunSheetDto, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    const runSheet = await this.assertRunSheet(productionId, runSheetId);
    this.assertDraft(runSheet.status);
    if (dto.eventId !== runSheet.eventId) {
      throw new BadRequestException("진행표의 일정과 generate eventId가 달라요");
    }
    const items = await this.buildGeneratedItems(productionId, runSheet.eventId, dto);
    const beforeJson = this.audit.runSheetAuditSnapshot(runSheet);
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.runSheetItem.deleteMany({ where: { runSheetId } });
      await tx.runSheetItem.createMany({
        data: items.map((item) => ({ ...item, runSheetId }))
      });
      return tx.runSheet.update({ where: { id: runSheetId }, data: {}, include: this.runSheetInclude() });
    });
    await this.audit.writeActivityLog(productionId, user, {
      action: "run_sheet.regenerated",
      entity: "RunSheet",
      entityId: runSheetId,
      reason: "진행표 항목 재생성",
      beforeJson,
      afterJson: this.audit.runSheetAuditSnapshot(updated)
    });
    return updated;
  }

  async lockRunSheet(productionId: string, runSheetId: string, dto: LockRunSheetDto | undefined, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    const reason = this.normalizeRequiredReason(dto?.reason, "진행표 확정 사유를 입력해 주세요");
    const runSheet = await this.assertRunSheet(productionId, runSheetId);
    this.assertDraft(runSheet.status);
    if (runSheet.items.length === 0) {
      throw new BadRequestException("잠글 진행표 항목이 없어요");
    }
    const warnings = this.buildLockWarnings(runSheet);
    if (warnings.length && !dto?.confirmMissingAnchors) {
      throw new ConflictException({
        message: "담당자나 큐 anchor가 누락된 항목이 있어요. 확인 후 잠금해 주세요.",
        warnings
      });
    }
    const beforeJson = this.audit.runSheetAuditSnapshot(runSheet);
    const updated = await this.prisma.runSheet.update({
      where: { id: runSheetId },
      data: {
        title: dto?.versionName?.trim() || runSheet.title,
        status: RunSheetStatus.LOCKED,
        lockedAt: new Date()
      },
      include: this.runSheetInclude()
    });
    await this.audit.writeActivityLog(productionId, user, {
      action: "run_sheet.locked",
      entity: "RunSheet",
      entityId: runSheetId,
      reason,
      beforeJson,
      afterJson: this.audit.runSheetAuditSnapshot(updated)
    });
    return updated;
  }

  async reviseRunSheet(productionId: string, runSheetId: string, dto: ReviseRunSheetDto | undefined, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    const reason = this.normalizeRequiredReason(dto?.reason, "진행표 새 버전 사유를 입력해 주세요");
    const runSheet = await this.assertRunSheet(productionId, runSheetId);
    if (runSheet.status === RunSheetStatus.DRAFT) {
      throw new ConflictException("초안 진행표는 바로 수정할 수 있어요");
    }
    const version = await this.nextVersion(runSheet.eventId);
    const created = await this.prisma.runSheet.create({
      data: {
        productionId,
        eventId: runSheet.eventId,
        title: dto?.title?.trim() || `${runSheet.event.title} 진행표 v${version}`,
        version,
        createdById: user.id,
        items: {
          create: runSheet.items.map((item) => ({
            order: item.order,
            itemType: item.itemType,
            sceneId: item.sceneId,
            cueId: item.cueId,
            stageSceneNoteId: item.stageSceneNoteId,
            checklistItemId: item.checklistItemId,
            title: item.title,
            estimatedDurationMin: item.estimatedDurationMin,
            ownerRole: item.ownerRole,
            ownerMembershipId: item.ownerMembershipId,
            staffDiscipline: item.staffDiscipline,
            note: item.note
          }))
        }
      },
      include: this.runSheetInclude()
    });
    await this.audit.writeActivityLog(productionId, user, {
      action: "run_sheet.revised",
      entity: "RunSheet",
      entityId: created.id,
      reason,
      beforeJson: this.audit.runSheetAuditSnapshot(runSheet),
      afterJson: this.audit.runSheetAuditSnapshot(created)
    });
    return created;
  }

  async completeRunSheet(productionId: string, runSheetId: string, dto: CompleteRunSheetDto | undefined, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    const reason = this.normalizeRequiredReason(dto?.reason, "진행표 완료 사유를 입력해 주세요");
    const runSheet = await this.assertRunSheet(productionId, runSheetId);
    if (runSheet.status !== RunSheetStatus.LOCKED) {
      throw new ConflictException("LOCKED 진행표만 완료 처리할 수 있어요");
    }
    const incomplete = runSheet.items.filter((item) => !item.completedAt);
    if (incomplete.length) {
      throw new ConflictException({
        message: "미완료 진행표 항목이 있어요. 항목을 완료한 뒤 진행표를 종료해 주세요.",
        incomplete: incomplete.map((item) => ({ id: item.id, title: item.title, order: item.order }))
      });
    }
    const beforeJson = this.audit.runSheetAuditSnapshot(runSheet);
    const updated = await this.prisma.runSheet.update({
      where: { id: runSheetId },
      data: { status: RunSheetStatus.COMPLETED, completedAt: new Date() },
      include: this.runSheetInclude()
    });
    await this.audit.writeActivityLog(productionId, user, {
      action: "run_sheet.completed",
      entity: "RunSheet",
      entityId: runSheetId,
      reason,
      beforeJson,
      afterJson: this.audit.runSheetAuditSnapshot(updated)
    });
    return updated;
  }

  async createItem(productionId: string, runSheetId: string, dto: CreateRunSheetItemDto, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    const runSheet = await this.assertRunSheet(productionId, runSheetId);
    this.assertDraft(runSheet.status);
    const data = await this.buildItemData(productionId, dto);
    const maxOrder = runSheet.items.reduce((max, item) => Math.max(max, item.order), 0);
    const order = Math.min(Math.max(dto.order ?? maxOrder + 1, 1), maxOrder + 1);
    const created = await this.prisma.$transaction(async (tx) => {
      if (order <= maxOrder) {
        await tx.runSheetItem.updateMany({ where: { runSheetId, order: { gte: order } }, data: { order: { increment: 1 } } });
      }
      return tx.runSheetItem.create({
        data: { runSheetId, order, ...data },
        include: this.itemInclude()
      });
    });
    await this.audit.writeActivityLog(productionId, user, {
      action: "run_sheet.item_created",
      entity: "RunSheetItem",
      entityId: created.id,
      reason: "진행표 항목 생성",
      afterJson: this.audit.runSheetItemAuditSnapshot(created)
    });
    return created;
  }

  async updateItem(productionId: string, runSheetId: string, itemId: string, dto: UpdateRunSheetItemDto, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    const runSheet = await this.assertRunSheet(productionId, runSheetId);
    this.assertDraft(runSheet.status);
    const item = this.assertItemInRunSheet(runSheet, itemId);
    const merged: CreateRunSheetItemDto = {
      itemType: dto.itemType ?? item.itemType,
      title: dto.title ?? item.title,
      sceneId: dto.sceneId === undefined ? item.sceneId : dto.sceneId,
      cueId: dto.cueId === undefined ? item.cueId : dto.cueId,
      stageSceneNoteId: dto.stageSceneNoteId === undefined ? item.stageSceneNoteId : dto.stageSceneNoteId,
      checklistItemId: dto.checklistItemId === undefined ? item.checklistItemId : dto.checklistItemId,
      estimatedDurationMin: dto.estimatedDurationMin === undefined ? item.estimatedDurationMin : dto.estimatedDurationMin,
      ownerRole: dto.ownerRole === undefined ? item.ownerRole : dto.ownerRole,
      ownerMembershipId: dto.ownerMembershipId === undefined ? item.ownerMembershipId : dto.ownerMembershipId,
      staffDiscipline: dto.staffDiscipline === undefined ? item.staffDiscipline : dto.staffDiscipline,
      note: dto.note === undefined ? item.note : dto.note
    };
    const data = await this.buildItemData(productionId, merged);
    const updated = await this.prisma.runSheetItem.update({
      where: { id: itemId },
      data: {
        ...data,
        order: dto.order
      },
      include: this.itemInclude()
    });
    await this.audit.writeActivityLog(productionId, user, {
      action: "run_sheet.item_updated",
      entity: "RunSheetItem",
      entityId: itemId,
      reason: "진행표 항목 수정",
      beforeJson: this.audit.runSheetItemAuditSnapshot(item),
      afterJson: this.audit.runSheetItemAuditSnapshot(updated)
    });
    return updated;
  }

  async deleteItem(productionId: string, runSheetId: string, itemId: string, dto: DeleteRunSheetItemDto | undefined, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    const reason = this.normalizeRequiredReason(dto?.reason, "진행표 항목 삭제 사유를 입력해 주세요");
    const runSheet = await this.assertRunSheet(productionId, runSheetId);
    this.assertDraft(runSheet.status);
    const item = this.assertItemInRunSheet(runSheet, itemId);
    const auditScope = await this.audit.getProductionAuditScope(productionId);
    await this.prisma.$transaction([
      this.prisma.activityLog.create({
        data: {
          ...auditScope,
          actorId: user.id,
          action: "run_sheet.item_deleted",
          entity: "RunSheetItem",
          entityId: itemId,
          reason,
          beforeJson: this.audit.toJson(this.audit.runSheetItemAuditSnapshot(item)),
          afterJson: this.audit.toJson({ deletedId: itemId, deletedAt: new Date().toISOString() })
        }
      }),
      this.prisma.runSheetItem.delete({ where: { id: itemId } })
    ]);
    await this.normalizeOrder(runSheetId);
    return { deletedId: itemId };
  }

  async reorderItems(productionId: string, runSheetId: string, dto: ReorderRunSheetItemsDto, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    const runSheet = await this.assertRunSheet(productionId, runSheetId);
    this.assertDraft(runSheet.status);
    const currentIds = runSheet.items.map((item) => item.id).sort();
    const incomingIds = [...dto.itemIds].sort();
    if (currentIds.length !== incomingIds.length || currentIds.some((id, index) => id !== incomingIds[index])) {
      throw new BadRequestException("현재 진행표 항목 전체 순서를 보내야 해요");
    }
    const beforeJson = this.audit.runSheetAuditSnapshot(runSheet);
    await this.prisma.$transaction(
      dto.itemIds.map((id, index) => this.prisma.runSheetItem.update({ where: { id }, data: { order: index + 1 } }))
    );
    const updated = await this.assertRunSheet(productionId, runSheetId);
    await this.audit.writeActivityLog(productionId, user, {
      action: "run_sheet.items_reordered",
      entity: "RunSheet",
      entityId: runSheetId,
      reason: "진행표 항목 순서 변경",
      beforeJson,
      afterJson: this.audit.runSheetAuditSnapshot(updated)
    });
    return updated;
  }

  async completeItem(productionId: string, runSheetId: string, itemId: string, dto: CompleteRunSheetItemDto, user: RequestUser) {
    const membership = await this.assertMembership(productionId, user, COMPLETE_ROLES);
    const runSheet = await this.assertRunSheet(productionId, runSheetId);
    if (runSheet.status !== RunSheetStatus.LOCKED) {
      throw new ConflictException("잠긴 진행표의 항목만 완료 처리할 수 있어요");
    }
    const item = this.assertItemInRunSheet(runSheet, itemId);
    if (!this.canCompleteItem(item, membership, user)) {
      throw new ForbiddenException("이 진행표 항목을 완료할 권한이 없어요");
    }
    const done = dto.done ?? true;
    const updated = await this.prisma.runSheetItem.update({
      where: { id: itemId },
      data: {
        completedAt: done ? new Date() : null,
        completedById: done ? user.id : null,
        note: dto.note === undefined ? undefined : dto.note?.trim() || null
      },
      include: this.itemInclude()
    });
    await this.audit.writeActivityLog(productionId, user, {
      action: done ? "run_sheet.item_completed" : "run_sheet.item_completion_cleared",
      entity: "RunSheetItem",
      entityId: itemId,
      reason: dto.note?.trim() || (done ? "진행표 항목 완료" : "진행표 항목 완료 해제"),
      beforeJson: this.audit.runSheetItemAuditSnapshot(item),
      afterJson: this.audit.runSheetItemAuditSnapshot(updated)
    });
    return updated;
  }

  async exportRunSheet(productionId: string, runSheetId: string, format: string | undefined, user: RequestUser) {
    await this.assertMembership(productionId, user, VIEW_ROLES);
    const runSheet = await this.assertRunSheet(productionId, runSheetId);
    const normalizedFormat = format === "pdf" ? "pdf" : "html";
    const mimeType = normalizedFormat === "pdf" ? "application/pdf" : "text/html";
    const exportableRunSheet = runSheet as unknown as ExportableRunSheet;
    const body = normalizedFormat === "pdf" ? buildRunSheetExportPdf(exportableRunSheet) : buildRunSheetExportHtml(exportableRunSheet);
    const checksum = `sha256:${createHash("sha256").update(body).digest("hex")}`;
    const asset = await this.assetsService.createAsset(
      {
        purpose: AssetPurpose.RUN_SHEET_EXPORT,
        productionId,
        fileName: `${runSheet.title}.${normalizedFormat}`,
        mimeType,
        size: body.length,
        checksum
      },
      user
    );
    await this.assetsService.storeMockObject(asset.asset.id, body);

    return {
      runSheetId,
      format: normalizedFormat,
      fileName: `${runSheet.title}.${normalizedFormat}`,
      asset,
      file: {
        stored: true,
        sizeBytes: body.length,
        checksum
      },
      snapshot: {
        title: runSheet.title,
        status: runSheet.status,
        version: runSheet.version,
        event: runSheet.event,
        items: runSheet.items.map((item) => ({
          order: item.order,
          itemType: item.itemType,
          title: item.title,
          estimatedDurationMin: item.estimatedDurationMin,
          ownerRole: item.ownerRole,
          staffDiscipline: item.staffDiscipline,
          completedAt: item.completedAt,
          note: item.note
        }))
      }
    };
  }

  private async buildGeneratedItems(productionId: string, eventId: string, dto: GenerateRunSheetDto) {
    await this.assertEvent(productionId, eventId);
    const includeMusicCues = dto.includeMusicCues ?? true;
    const includeStageNotes = dto.includeStageNotes ?? true;
    const includeChecklistItems = dto.includeChecklistItems ?? true;
    const eventScenes = await this.prisma.eventScene.findMany({
      where: { eventId },
      orderBy: [{ scene: { act: { order: "asc" } } }, { scene: { order: "asc" } }],
      include: { scene: { include: { act: { select: { title: true, order: true } } } } }
    });
    const eventCues = includeMusicCues
      ? await this.prisma.eventMusicCue.findMany({
          where: { eventId },
          orderBy: [{ cue: { order: "asc" } }],
          include: { cue: { include: { track: { select: { title: true } }, scene: { select: { id: true, title: true } } } } }
        })
      : [];
    const stageNotes = includeStageNotes
      ? await this.prisma.stageSceneNote.findMany({
          where: { stagePlan: { productionId } },
          orderBy: [{ scene: { act: { order: "asc" } } }, { scene: { order: "asc" } }, { createdAt: "asc" }],
          include: { scene: { select: { id: true, title: true } }, stagePlan: { select: { name: true } } }
        })
      : [];
    const checklistItems = includeChecklistItems
      ? await this.prisma.checklistItem.findMany({
          where: { phase: { productionId }, eventId, status: { not: ChecklistStatus.DONE } },
          orderBy: [{ phase: { phase: "asc" } }, { order: "asc" }],
          include: { phase: { select: { phase: true } } }
        })
      : [];

    const sceneIds = eventScenes.map((eventScene) => eventScene.sceneId);
    const sceneSet = new Set(sceneIds);
    const relatedStageNotes = stageNotes.filter((note) => sceneSet.size === 0 || sceneSet.has(note.sceneId));
    const cuesByScene = new Map<string, typeof eventCues>();
    const unscenedCues: typeof eventCues = [];
    for (const eventCue of eventCues) {
      const sceneId = eventCue.cue.sceneId;
      if (!sceneId) {
        unscenedCues.push(eventCue);
        continue;
      }
      if (!cuesByScene.has(sceneId)) cuesByScene.set(sceneId, []);
      cuesByScene.get(sceneId)?.push(eventCue);
    }
    const stageNotesByScene = new Map<string, typeof relatedStageNotes>();
    for (const note of relatedStageNotes) {
      if (!stageNotesByScene.has(note.sceneId)) stageNotesByScene.set(note.sceneId, []);
      stageNotesByScene.get(note.sceneId)?.push(note);
    }

    const generated: Omit<GeneratedRunSheetItem, "order">[] = [];
    for (const eventScene of eventScenes) {
      generated.push({
        itemType: RunSheetItemType.SCENE,
        title: `${eventScene.scene.act.title} / ${eventScene.scene.title}`,
        sceneId: eventScene.sceneId,
        estimatedDurationMin: 8,
        ownerRole: ProductionRole.DIRECTOR
      });
      for (const cue of cuesByScene.get(eventScene.sceneId) ?? []) {
        generated.push(this.buildCueItem(cue));
      }
      for (const note of stageNotesByScene.get(eventScene.sceneId) ?? []) {
        generated.push({
          itemType: RunSheetItemType.STAGE_NOTE,
          title: `${note.scene.title} 세팅: ${note.stagePlan.name}`,
          sceneId: note.sceneId,
          stageSceneNoteId: note.id,
          estimatedDurationMin: 3,
          ownerRole: ProductionRole.STAGE_MANAGER,
          staffDiscipline: StaffDiscipline.STAGE_CREW,
          note: note.note
        });
      }
    }

    if (eventScenes.length === 0) {
      const fallbackScenes = await this.getProductionScenes(productionId);
      for (const scene of fallbackScenes) {
        generated.push({
          itemType: RunSheetItemType.SCENE,
          title: `${scene.act.title} / ${scene.title}`,
          sceneId: scene.id,
          estimatedDurationMin: 8,
          ownerRole: ProductionRole.DIRECTOR
        });
      }
    }

    for (const cue of unscenedCues) {
      generated.push(this.buildCueItem(cue));
    }
    for (const checklistItem of checklistItems) {
      generated.push({
        itemType: RunSheetItemType.CHECK,
        title: `체크: ${checklistItem.label}`,
        checklistItemId: checklistItem.id,
        estimatedDurationMin: 2,
        ownerRole: checklistItem.assigneeRole,
        staffDiscipline: checklistItem.staffDiscipline,
        note: checklistItem.description
      });
    }
    if (generated.length === 0) {
      generated.push({
        itemType: RunSheetItemType.ANNOUNCEMENT,
        title: "오프닝 및 출석 확인",
        estimatedDurationMin: 5,
        ownerRole: ProductionRole.STAGE_MANAGER,
        note: "장면/큐 연결이 없는 일정에서 기본 생성된 항목"
      });
    }
    return generated.map((item, index) => ({ order: index + 1, ...item }));
  }

  private buildCueItem(eventCue: {
    cueId: string;
    cue: { cueNumber: string; cueType: string; track: { title: string }; sceneId?: string | null; scene?: { title: string } | null };
  }): Omit<GeneratedRunSheetItem, "order"> {
    return {
      itemType: RunSheetItemType.CUE,
      title: `${eventCue.cue.cueNumber} ${eventCue.cue.track.title}`,
      cueId: eventCue.cueId,
      sceneId: eventCue.cue.sceneId ?? null,
      estimatedDurationMin: 1,
      ownerRole: ProductionRole.MUSIC_DIRECTOR,
      staffDiscipline: StaffDiscipline.SOUND,
      note: eventCue.cue.scene?.title ? `${eventCue.cue.scene.title} 연결 큐` : `${eventCue.cue.cueType} 큐`
    };
  }

  private async buildItemData(productionId: string, dto: CreateRunSheetItemDto) {
    if (!dto.title?.trim()) {
      throw new BadRequestException("진행표 항목 제목이 필요해요");
    }
    await Promise.all([
      dto.sceneId ? this.assertScene(productionId, dto.sceneId) : Promise.resolve(),
      dto.cueId ? this.assertCue(productionId, dto.cueId) : Promise.resolve(),
      dto.stageSceneNoteId ? this.assertStageSceneNote(productionId, dto.stageSceneNoteId) : Promise.resolve(),
      dto.checklistItemId ? this.assertChecklistItem(productionId, dto.checklistItemId) : Promise.resolve(),
      dto.ownerMembershipId ? this.assertMembershipId(productionId, dto.ownerMembershipId) : Promise.resolve()
    ]);
    return {
      itemType: dto.itemType,
      title: dto.title.trim(),
      sceneId: dto.sceneId || null,
      cueId: dto.cueId || null,
      stageSceneNoteId: dto.stageSceneNoteId || null,
      checklistItemId: dto.checklistItemId || null,
      estimatedDurationMin: dto.estimatedDurationMin ?? null,
      ownerRole: dto.ownerRole ?? null,
      ownerMembershipId: dto.ownerMembershipId || null,
      staffDiscipline: dto.staffDiscipline ?? null,
      note: dto.note?.trim() || null
    };
  }

  private buildLockWarnings(runSheet: { items: RunSheetItemForPolicy[] }) {
    const warnings = [];
    for (const item of runSheet.items) {
      if (!item.ownerRole && !item.ownerMembershipId && !item.staffDiscipline) {
        warnings.push({ itemId: item.id, order: item.order, title: item.title, type: "MISSING_OWNER" });
      }
      if (item.itemType === RunSheetItemType.CUE && item.cue && item.cue.anchorStatus !== AnchorStatus.OK) {
        warnings.push({ itemId: item.id, order: item.order, title: item.title, type: "CUE_ANCHOR_NOT_OK" });
      }
    }
    return warnings;
  }

  private async normalizeOrder(runSheetId: string) {
    const items = await this.prisma.runSheetItem.findMany({ where: { runSheetId }, orderBy: [{ order: "asc" }, { id: "asc" }] });
    await this.prisma.$transaction(items.map((item, index) => this.prisma.runSheetItem.update({ where: { id: item.id }, data: { order: index + 1 } })));
  }

  private async nextVersion(eventId: string) {
    const aggregate = await this.prisma.runSheet.aggregate({
      where: { eventId },
      _max: { version: true }
    });
    return (aggregate._max.version ?? 0) + 1;
  }

  private assertDraft(status: RunSheetStatus) {
    if (status !== RunSheetStatus.DRAFT) {
      throw new ConflictException("LOCKED 진행표는 구조를 직접 수정할 수 없어요. 새 버전을 만들어 수정해 주세요.");
    }
  }

  private assertItemInRunSheet(runSheet: { items: RunSheetItemForPolicy[] }, itemId: string) {
    const item = runSheet.items.find((candidate) => candidate.id === itemId);
    if (!item) {
      throw new NotFoundException("진행표 항목을 찾을 수 없어요");
    }
    return item;
  }

  private canCompleteItem(
    item: RunSheetItemForPolicy,
    membership: MembershipForPolicy | null,
    user: RequestUser
  ) {
    if (isPlatformAdmin(user)) return true;
    if (!membership) return false;
    const roles = membership.roles.map((role) => role.role);
    if (this.hasAnyRole(roles, EDIT_ROLES)) return true;
    if (item.ownerMembershipId && item.ownerMembershipId === membership.id) return true;
    if (item.ownerRole && roles.includes(item.ownerRole)) return true;
    if (item.staffDiscipline && membership.staffAssignments.some((assignment) => assignment.discipline === item.staffDiscipline)) return true;
    return false;
  }

  private isAssignedItem(
    item: RunSheetItemForPolicy,
    myMembershipId: string | null,
    myRoles: ProductionRole[],
    staffAssignments: Array<{ discipline: StaffDiscipline }>
  ) {
    if (item.ownerMembershipId && item.ownerMembershipId === myMembershipId) return true;
    if (item.ownerRole && myRoles.includes(item.ownerRole)) return true;
    if (item.staffDiscipline && staffAssignments.some((assignment) => assignment.discipline === item.staffDiscipline)) return true;
    return false;
  }

  private hasAnyRole(roles: ProductionRole[], allowed: ProductionRole[]) {
    return roles.some((role) => allowed.includes(role));
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

  private async assertRunSheet(productionId: string, runSheetId: string) {
    const runSheet = await this.prisma.runSheet.findFirst({
      where: { id: runSheetId, productionId },
      include: this.runSheetInclude()
    });
    if (!runSheet) {
      throw new NotFoundException("진행표를 찾을 수 없어요");
    }
    return runSheet;
  }

  private async assertScene(productionId: string, sceneId: string) {
    const count = await this.prisma.scene.count({ where: { id: sceneId, act: { script: { productionId } } } });
    if (!count) throw new BadRequestException("이 공연에 속하지 않는 장면이에요");
  }

  private async assertCue(productionId: string, cueId: string) {
    const count = await this.prisma.musicCue.count({ where: { id: cueId, productionId } });
    if (!count) throw new BadRequestException("이 공연에 속하지 않는 음악 큐예요");
  }

  private async assertStageSceneNote(productionId: string, stageSceneNoteId: string) {
    const count = await this.prisma.stageSceneNote.count({ where: { id: stageSceneNoteId, stagePlan: { productionId } } });
    if (!count) throw new BadRequestException("이 공연에 속하지 않는 무대 세팅 메모예요");
  }

  private async assertChecklistItem(productionId: string, checklistItemId: string) {
    const count = await this.prisma.checklistItem.count({ where: { id: checklistItemId, phase: { productionId } } });
    if (!count) throw new BadRequestException("이 공연에 속하지 않는 체크리스트 항목이에요");
  }

  private async assertMembershipId(productionId: string, membershipId: string) {
    const count = await this.prisma.membership.count({ where: { id: membershipId, productionId } });
    if (!count) throw new BadRequestException("이 공연에 속하지 않는 담당자예요");
  }

  private normalizeRequiredReason(reason: string | null | undefined, message: string) {
    const normalized = reason?.trim();
    if (!normalized) {
      throw new BadRequestException(message);
    }
    return normalized;
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
      include: this.cueInclude()
    });
  }

  private getProductionStageNotes(productionId: string) {
    return this.prisma.stageSceneNote.findMany({
      where: { stagePlan: { productionId } },
      orderBy: [{ scene: { act: { order: "asc" } } }, { scene: { order: "asc" } }, { createdAt: "asc" }],
      include: this.stageNoteInclude()
    });
  }

  private getProductionChecklistItems(productionId: string) {
    return this.prisma.checklistItem.findMany({
      where: { phase: { productionId } },
      orderBy: [{ phase: { phase: "asc" } }, { order: "asc" }],
      include: this.checklistItemInclude()
    });
  }

  private getProductionMemberships(productionId: string) {
    return this.prisma.membership.findMany({
      where: { productionId },
      orderBy: { createdAt: "asc" },
      include: this.membershipInclude()
    });
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
      stageSceneNote: { include: this.stageNoteInclude() },
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

  private stageNoteInclude(): Prisma.StageSceneNoteInclude {
    return {
      scene: { select: { id: true, title: true, order: true, act: { select: { id: true, title: true, order: true } } } },
      stagePlan: { select: { id: true, name: true } }
    };
  }

  private checklistItemInclude(): Prisma.ChecklistItemInclude {
    return {
      phase: { select: { phase: true } },
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
