import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, ProductionRole } from "@prisma/client";
import { createHash } from "node:crypto";
import { AssetPurpose } from "../assets/dto";
import { AssetsService } from "../assets/assets.service";
import type { RequestUser } from "../common/types/request-user";
import { PrismaService } from "../prisma/prisma.service";
import { CreateStageElementDto, CreateStagePlanDto, PutStageSceneNoteDto, UpdateStageElementDto, UpdateStagePlanDto } from "./dto";
import { buildStageExportPdf, buildStageExportPng, type ExportableStagePlan } from "./stage-export.renderer";
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

const EDIT_ROLES = [ProductionRole.PRODUCER, ProductionRole.DIRECTOR, ProductionRole.STAGE_MANAGER];

@Injectable()
export class StageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assetsService: AssetsService
  ) {}

  async getWorkspace(productionId: string, user: RequestUser) {
    await this.assertMembership(productionId, user, VIEW_ROLES);
    const [plans, scenes] = await Promise.all([
      this.prisma.stagePlan.findMany({
        where: { productionId },
        orderBy: { name: "asc" },
        include: this.planInclude()
      }),
      this.getProductionScenes(productionId)
    ]);

    return {
      plans,
      scenes,
      totals: {
        plans: plans.length,
        elements: plans.reduce((sum, plan) => sum + plan.elements.length, 0),
        sceneNotes: plans.reduce((sum, plan) => sum + plan.sceneNotes.length, 0),
        scenes: scenes.length
      }
    };
  }

  async listPlans(productionId: string, user: RequestUser) {
    await this.assertMembership(productionId, user, VIEW_ROLES);
    return this.prisma.stagePlan.findMany({
      where: { productionId },
      orderBy: { name: "asc" },
      include: this.planInclude()
    });
  }

  async getPlan(productionId: string, planId: string, user: RequestUser) {
    await this.assertMembership(productionId, user, VIEW_ROLES);
    return this.assertPlan(productionId, planId, true);
  }

  async createPlan(productionId: string, dto: CreateStagePlanDto, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    return this.prisma.stagePlan.create({
      data: {
        productionId,
        name: dto.name.trim(),
        layout: (dto.layout ?? this.defaultLayout()) as Prisma.InputJsonValue
      },
      include: this.planInclude()
    });
  }

  async updatePlan(productionId: string, planId: string, dto: UpdateStagePlanDto, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    await this.assertPlan(productionId, planId);
    return this.prisma.stagePlan.update({
      where: { id: planId },
      data: {
        name: dto.name?.trim(),
        layout: dto.layout === undefined ? undefined : (dto.layout as Prisma.InputJsonValue)
      },
      include: this.planInclude()
    });
  }

  async deletePlan(productionId: string, planId: string, force: boolean, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    await this.assertPlan(productionId, planId);
    const sceneNotes = await this.prisma.stageSceneNote.findMany({ where: { stagePlanId: planId }, select: { id: true } });
    const sceneNoteIds = sceneNotes.map((note) => note.id);
    const impact = {
      elements: await this.prisma.stageElement.count({ where: { stagePlanId: planId } }),
      sceneNotes: sceneNoteIds.length,
      runSheetItems: await this.prisma.runSheetItem.count({ where: { stageSceneNoteId: { in: sceneNoteIds } } })
    };
    if (!force && (impact.sceneNotes > 0 || impact.runSheetItems > 0)) {
      throw new ConflictException({
        message: "장면 세팅 메모 또는 진행표 항목이 연결된 무대 플랜이에요. 영향 내용을 확인한 뒤 삭제해 주세요.",
        impact
      });
    }

    await this.prisma.$transaction([
      this.prisma.runSheetItem.updateMany({ where: { stageSceneNoteId: { in: sceneNoteIds } }, data: { stageSceneNoteId: null } }),
      this.prisma.stageSceneNote.deleteMany({ where: { stagePlanId: planId } }),
      this.prisma.stageElement.deleteMany({ where: { stagePlanId: planId } }),
      this.prisma.stagePlan.delete({ where: { id: planId } })
    ]);

    return { deletedId: planId, impact };
  }

  async createElement(productionId: string, planId: string, dto: CreateStageElementDto, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    await this.assertPlan(productionId, planId);
    return this.prisma.stageElement.create({
      data: {
        stagePlanId: planId,
        kind: dto.kind,
        label: dto.label.trim(),
        x: dto.x,
        y: dto.y,
        note: dto.note?.trim() || null
      }
    });
  }

  async updateElement(productionId: string, planId: string, elementId: string, dto: UpdateStageElementDto, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    await this.assertElement(productionId, planId, elementId);
    return this.prisma.stageElement.update({
      where: { id: elementId },
      data: {
        kind: dto.kind,
        label: dto.label?.trim(),
        x: dto.x,
        y: dto.y,
        note: dto.note === undefined ? undefined : dto.note?.trim() || null
      }
    });
  }

  async deleteElement(productionId: string, planId: string, elementId: string, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    await this.assertElement(productionId, planId, elementId);
    await this.prisma.stageElement.delete({ where: { id: elementId } });
    return { deletedId: elementId };
  }

  async putSceneNote(productionId: string, planId: string, sceneId: string, dto: PutStageSceneNoteDto, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    await this.assertPlan(productionId, planId);
    await this.assertScene(productionId, sceneId);
    const note = dto.note.trim();
    if (!note) {
      await this.prisma.runSheetItem.updateMany({ where: { stageSceneNote: { stagePlanId: planId, sceneId } }, data: { stageSceneNoteId: null } });
      await this.prisma.stageSceneNote.deleteMany({ where: { stagePlanId: planId, sceneId } });
      return { stagePlanId: planId, sceneId, note: null };
    }

    return this.prisma.stageSceneNote.upsert({
      where: { stagePlanId_sceneId: { stagePlanId: planId, sceneId } },
      update: { note },
      create: { stagePlanId: planId, sceneId, note },
      include: this.sceneNoteInclude()
    });
  }

  async exportPlan(productionId: string, planId: string, format: string | undefined, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    const plan = await this.assertPlanDetail(productionId, planId);
    const exportPlan = plan as unknown as ExportableStagePlan;
    const normalizedFormat = format === "pdf" ? "pdf" : "png";
    const mimeType = normalizedFormat === "pdf" ? "application/pdf" : "image/png";
    const body = normalizedFormat === "pdf" ? buildStageExportPdf(exportPlan) : buildStageExportPng(exportPlan);
    const checksum = `sha256:${createHash("sha256").update(body).digest("hex")}`;
    const asset = await this.assetsService.createAsset(
      {
        purpose: AssetPurpose.STAGE_EXPORT,
        productionId,
        fileName: `${plan.name}.${normalizedFormat}`,
        mimeType,
        size: body.length,
        checksum
      },
      user
    );
    await this.assetsService.storeMockObject(asset.asset.id, body);
    return {
      planId,
      format: normalizedFormat,
      asset,
      file: {
        stored: true,
        sizeBytes: body.length,
        checksum
      },
      snapshot: {
        name: plan.name,
        layout: plan.layout,
        elementCount: plan.elements.length,
        sceneNoteCount: plan.sceneNotes.length
      }
    };
  }

  private async assertMembership(productionId: string, user: RequestUser, roles: ProductionRole[]) {
    await assertProductionMembership(this.prisma, user, productionId, roles);
  }

  private async assertPlan(productionId: string, planId: string, includeDetail = false) {
    const plan = await this.prisma.stagePlan.findFirst({
      where: { id: planId, productionId },
      include: includeDetail ? this.planInclude() : undefined
    });
    if (!plan) {
      throw new NotFoundException("무대 플랜을 찾을 수 없어요");
    }
    return plan;
  }

  private async assertPlanDetail(productionId: string, planId: string) {
    const plan = await this.prisma.stagePlan.findFirst({
      where: { id: planId, productionId },
      include: this.planInclude()
    });
    if (!plan) {
      throw new NotFoundException("무대 플랜을 찾을 수 없어요");
    }
    return plan;
  }

  private async assertElement(productionId: string, planId: string, elementId: string) {
    await this.assertPlan(productionId, planId);
    const element = await this.prisma.stageElement.findFirst({ where: { id: elementId, stagePlanId: planId } });
    if (!element) {
      throw new NotFoundException("무대 요소를 찾을 수 없어요");
    }
    return element;
  }

  private async assertScene(productionId: string, sceneId: string) {
    const scene = await this.prisma.scene.findFirst({
      where: { id: sceneId, act: { script: { productionId } } },
      select: { id: true }
    });
    if (!scene) {
      throw new BadRequestException("이 공연에 속하지 않는 장면이에요");
    }
    return scene;
  }

  private getProductionScenes(productionId: string) {
    return this.prisma.scene.findMany({
      where: { act: { script: { productionId } } },
      orderBy: [{ act: { order: "asc" } }, { order: "asc" }],
      include: { act: { select: { id: true, title: true, order: true, script: { select: { id: true, title: true } } } } }
    });
  }

  private planInclude(): Prisma.StagePlanInclude {
    return {
      elements: { orderBy: [{ kind: "asc" }, { label: "asc" }] },
      sceneNotes: {
        orderBy: { createdAt: "asc" },
        include: this.sceneNoteInclude()
      }
    };
  }

  private sceneNoteInclude(): Prisma.StageSceneNoteInclude {
    return {
      scene: { select: { id: true, title: true, order: true, act: { select: { id: true, title: true, order: true } } } },
      runSheetItems: { select: { id: true, title: true, completedAt: true } }
    };
  }

  private defaultLayout() {
    return {
      width: 100,
      height: 100,
      unit: "percent",
      orientation: "audience-bottom",
      zones: ["upstage", "center", "downstage"]
    };
  }
}
