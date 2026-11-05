import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, ProductionRole } from "@prisma/client";
import type { RequestUser } from "../common/types/request-user";
import { PrismaService } from "../prisma/prisma.service";
import {
  PositionRequirementDto,
  ReplacePositionRequirementsDto,
  UpdatePositionRequirementDto
} from "./dto";
import { ProductionAccessService } from "./production-access.service";
import { ProductionActivityLogService } from "./production-activity-log.service";
import { requiredText } from "./production-shared.util";

type PositionRequirementRecord = { id: string; role: ProductionRole; label: string; requiredCount: number };

/** 공연별 필요 정원(PositionRequirement) CRUD — productions.service.ts에서 분리. */
@Injectable()
export class PositionRequirementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProductionAccessService,
    private readonly activityLog: ProductionActivityLogService
  ) {}

  async listPositionRequirements(productionId: string, user: RequestUser) {
    await this.access.assertMemberOrAdmin(productionId, user);
    return this.findPositionRequirements(productionId);
  }

  async createPositionRequirement(productionId: string, dto: PositionRequirementDto, user: RequestUser) {
    const access = await this.access.getAccess(productionId, user);
    const data = this.normalizePositionRequirement(productionId, dto);
    const position = await this.prisma.positionRequirement.create({ data });
    await this.activityLog.log({
      productionId,
      organizationId: access.production.organizationId,
      actorId: user.id,
      action: "production.position.create",
      entity: "PositionRequirement",
      entityId: position.id,
      reason: "필요 정원 추가",
      afterJson: this.serializePositionRequirement(position)
    });
    return position;
  }

  async replacePositionRequirements(productionId: string, dto: ReplacePositionRequirementsDto, user: RequestUser) {
    const access = await this.access.getAccess(productionId, user);
    const before = await this.findPositionRequirements(productionId);
    const normalized = dto.positions.map((position) => this.normalizePositionRequirement(productionId, position));

    const after = await this.prisma.$transaction(async (tx) => {
      await tx.positionRequirement.deleteMany({ where: { productionId } });
      await tx.positionRequirement.createMany({ data: normalized });
      return tx.positionRequirement.findMany({ where: { productionId }, orderBy: this.positionRequirementOrderBy() });
    });

    await this.activityLog.log({
      productionId,
      organizationId: access.production.organizationId,
      actorId: user.id,
      action: "production.position.replace",
      entity: "Production",
      entityId: productionId,
      reason: "필요 정원 전체 교체",
      beforeJson: this.serializePositionRequirements(before),
      afterJson: this.serializePositionRequirements(after)
    });
    return after;
  }

  async updatePositionRequirement(productionId: string, positionId: string, dto: UpdatePositionRequirementDto, user: RequestUser) {
    const access = await this.access.getAccess(productionId, user);
    const position = await this.assertPositionRequirement(productionId, positionId);
    const data: Prisma.PositionRequirementUpdateInput = {};
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.label !== undefined) data.label = requiredText(dto.label, "필요 정원 라벨을 입력해 주세요");
    if (dto.requiredCount !== undefined) data.requiredCount = dto.requiredCount;
    if (Object.keys(data).length === 0) {
      throw new BadRequestException("수정할 필요 정원 항목을 입력해 주세요");
    }

    const updated = await this.prisma.positionRequirement.update({ where: { id: positionId }, data });
    await this.activityLog.log({
      productionId,
      organizationId: access.production.organizationId,
      actorId: user.id,
      action: "production.position.update",
      entity: "PositionRequirement",
      entityId: positionId,
      reason: "필요 정원 수정",
      beforeJson: this.serializePositionRequirement(position),
      afterJson: this.serializePositionRequirement(updated)
    });
    return updated;
  }

  async deletePositionRequirement(productionId: string, positionId: string, user: RequestUser) {
    const access = await this.access.getAccess(productionId, user);
    const position = await this.assertPositionRequirement(productionId, positionId);
    const count = await this.prisma.positionRequirement.count({ where: { productionId } });
    if (count <= 1) {
      throw new BadRequestException("필요 정원은 최소 1개 이상 유지해야 해요");
    }

    await this.prisma.positionRequirement.delete({ where: { id: positionId } });
    await this.activityLog.log({
      productionId,
      organizationId: access.production.organizationId,
      actorId: user.id,
      action: "production.position.delete",
      entity: "PositionRequirement",
      entityId: positionId,
      reason: "필요 정원 삭제",
      beforeJson: this.serializePositionRequirement(position)
    });
    return { deletedId: positionId };
  }

  private findPositionRequirements(productionId: string) {
    return this.prisma.positionRequirement.findMany({
      where: { productionId },
      orderBy: this.positionRequirementOrderBy()
    });
  }

  private positionRequirementOrderBy(): Prisma.PositionRequirementOrderByWithRelationInput[] {
    return [{ role: "asc" }, { label: "asc" }];
  }

  private normalizePositionRequirement(productionId: string, dto: PositionRequirementDto) {
    return {
      productionId,
      role: dto.role,
      label: requiredText(dto.label, "필요 정원 라벨을 입력해 주세요"),
      requiredCount: dto.requiredCount ?? 1
    };
  }

  private serializePositionRequirement(position: PositionRequirementRecord) {
    return {
      id: position.id,
      role: position.role,
      label: position.label,
      requiredCount: position.requiredCount
    };
  }

  private serializePositionRequirements(positions: PositionRequirementRecord[]) {
    return positions.map((position) => this.serializePositionRequirement(position));
  }

  private async assertPositionRequirement(productionId: string, positionId: string) {
    const position = await this.prisma.positionRequirement.findUnique({ where: { id: positionId } });
    if (!position || position.productionId !== productionId) {
      throw new NotFoundException("찾을 수 없어요");
    }
    return position;
  }
}
