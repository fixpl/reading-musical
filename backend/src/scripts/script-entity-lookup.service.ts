import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { RequestUser } from "../common/types/request-user";
import { PrismaService } from "../prisma/prisma.service";

/** 대본 하위 엔티티(막/장/블록/주석) 존재 확인 — scripts.service.ts와 script-import.service.ts가 공유. */
@Injectable()
export class ScriptEntityLookupService {
  constructor(private readonly prisma: PrismaService) {}

  async assertScript(productionId: string, scriptId: string) {
    const script = await this.prisma.script.findFirst({ where: { id: scriptId, productionId }, select: { id: true } });
    if (!script) {
      throw new NotFoundException("대본을 찾을 수 없어요");
    }
    return script;
  }

  async assertAct(productionId: string, actId: string) {
    const act = await this.prisma.act.findFirst({
      where: { id: actId, script: { productionId } },
      select: { id: true, scriptId: true }
    });
    if (!act) {
      throw new NotFoundException("막을 찾을 수 없어요");
    }
    return act;
  }

  async assertScene(productionId: string, sceneId: string) {
    const scene = await this.prisma.scene.findFirst({
      where: { id: sceneId, act: { script: { productionId } } },
      select: { id: true, actId: true }
    });
    if (!scene) {
      throw new NotFoundException("장을 찾을 수 없어요");
    }
    return scene;
  }

  async assertBlock(productionId: string, blockId: string) {
    const block = await this.prisma.sceneBlock.findFirst({
      where: { id: blockId, scene: { act: { script: { productionId } } } },
      select: { id: true, sceneId: true, order: true }
    });
    if (!block) {
      throw new NotFoundException("대본 블록을 찾을 수 없어요");
    }
    return block;
  }

  async assertAnnotation(productionId: string, blockId: string, annotationId: string) {
    const annotation = await this.prisma.annotation.findFirst({
      where: {
        id: annotationId,
        anchorBlockId: blockId,
        anchorBlock: { scene: { act: { script: { productionId } } } }
      },
      select: { id: true, authorId: true, isShared: true }
    });
    if (!annotation) {
      throw new NotFoundException("주석을 찾을 수 없어요");
    }
    return annotation;
  }

  assertAnnotationEditable(annotation: { authorId: string; isShared: boolean }, user: RequestUser, canManageShared: boolean) {
    if (annotation.authorId === user.id) {
      return;
    }
    if (annotation.isShared && canManageShared) {
      return;
    }
    throw new ForbiddenException("이 주석을 수정하거나 삭제할 수 없어요");
  }

  async assertCharacterInProduction(productionId: string, characterId?: string | null) {
    if (!characterId) {
      return;
    }
    const role = await this.prisma.role.findFirst({ where: { id: characterId, productionId }, select: { id: true } });
    if (!role) {
      throw new BadRequestException("이 공연의 배역만 대본 블록에 지정할 수 있어요");
    }
  }

  async getMaxActOrder(scriptId: string, tx: Prisma.TransactionClient | PrismaService = this.prisma) {
    const aggregate = await tx.act.aggregate({
      where: { scriptId },
      _max: { order: true }
    });
    return aggregate._max.order ?? 0;
  }
}
