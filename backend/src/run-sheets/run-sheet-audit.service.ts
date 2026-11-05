import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { RequestUser } from "../common/types/request-user";
import { PrismaService } from "../prisma/prisma.service";
import type { RunSheetAuditSnapshotInput, RunSheetItemForPolicy } from "./run-sheets.service";

/** 진행표/진행표 항목 변경에 대한 감사 로그 기록 — run-sheets.service.ts에서 분리. */
@Injectable()
export class RunSheetAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async writeActivityLog(
    productionId: string,
    user: RequestUser,
    input: {
      action: string;
      entity: "RunSheet" | "RunSheetItem";
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
        entity: input.entity,
        entityId: input.entityId,
        reason: input.reason?.trim() || null,
        beforeJson: input.beforeJson === undefined ? undefined : this.toJson(input.beforeJson),
        afterJson: input.afterJson === undefined ? undefined : this.toJson(input.afterJson)
      }
    });
  }

  runSheetAuditSnapshot(runSheet: RunSheetAuditSnapshotInput) {
    return {
      id: runSheet.id,
      productionId: runSheet.productionId,
      eventId: runSheet.eventId,
      eventTitle: runSheet.event?.title ?? null,
      title: runSheet.title,
      version: runSheet.version,
      status: runSheet.status,
      createdById: runSheet.createdById,
      lockedAt: runSheet.lockedAt?.toISOString() ?? null,
      completedAt: runSheet.completedAt?.toISOString() ?? null,
      createdAt: runSheet.createdAt?.toISOString() ?? null,
      updatedAt: runSheet.updatedAt?.toISOString() ?? null,
      itemCount: runSheet.items.length,
      items: runSheet.items.map((item) => this.runSheetItemAuditSnapshot(item))
    };
  }

  runSheetItemAuditSnapshot(item: RunSheetItemForPolicy) {
    return {
      id: item.id,
      order: item.order,
      itemType: item.itemType,
      title: item.title,
      sceneId: item.sceneId ?? null,
      cueId: item.cueId ?? null,
      stageSceneNoteId: item.stageSceneNoteId ?? null,
      checklistItemId: item.checklistItemId ?? null,
      estimatedDurationMin: item.estimatedDurationMin ?? null,
      ownerRole: item.ownerRole ?? null,
      ownerMembershipId: item.ownerMembershipId ?? null,
      staffDiscipline: item.staffDiscipline ?? null,
      note: item.note ?? null,
      completedAt: item.completedAt?.toISOString() ?? null,
      completedById: item.completedById ?? null,
      cueAnchorStatus: item.cue?.anchorStatus ?? null
    };
  }

  async getProductionAuditScope(productionId: string) {
    const production = await this.prisma.production.findUnique({
      where: { id: productionId },
      select: { id: true, organizationId: true }
    });
    if (!production) {
      throw new NotFoundException("공연을 찾을 수 없어요");
    }
    return { productionId: production.id, organizationId: production.organizationId };
  }

  toJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
