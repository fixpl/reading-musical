import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AnchorStatus, Prisma, ProductionRole } from "@prisma/client";
import { assertProductionMembership } from "../common/access/assert-production-membership";
import { isProductionAdmin } from "../common/access/is-production-admin";
import type { RequestUser } from "../common/types/request-user";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateActDto,
  CreateAnnotationDto,
  CreateBlockDto,
  CreateSceneDto,
  CreateScriptDto,
  CreateScriptVersionDto,
  ReorderBlocksDto,
  RestoreScriptVersionDto,
  UpdateAnnotationDto,
  UpdateBlockDto
} from "./dto";
import { ScriptEntityLookupService } from "./script-entity-lookup.service";
import { ScriptNotificationsService } from "./script-notifications.service";
import { anchorBrokenException } from "./script-shared.util";
import { ScriptSnapshotService } from "./script-snapshot.service";

type ScriptWithAnnotations = {
  acts: Array<{
    scenes: Array<{
      blocks: Array<{
        annotations: Array<{ authorId: string; isShared: boolean }>;
      }>;
    }>;
  }>;
};

const VIEW_ROLES: ProductionRole[] = [
  ProductionRole.PRODUCER,
  ProductionRole.DIRECTOR,
  ProductionRole.MUSIC_DIRECTOR,
  ProductionRole.STAGE_MANAGER,
  ProductionRole.ACTOR,
  ProductionRole.STAFF,
  ProductionRole.GUEST
];

const EDIT_ROLES = [ProductionRole.PRODUCER, ProductionRole.DIRECTOR];

/**
 * 대본 핵심 CRUD(막/장/블록/버전/주석)만 담당한다.
 * 파일/붙여넣기 가져오기는 script-import.service.ts,
 * 버전 스냅샷 생성·복원 계산은 script-snapshot.service.ts,
 * 변경 알림·다이제스트 메일은 script-notifications.service.ts로 분리되어 있다.
 */
@Injectable()
export class ScriptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entities: ScriptEntityLookupService,
    private readonly snapshot: ScriptSnapshotService,
    private readonly scriptNotifications: ScriptNotificationsService
  ) {}

  async listScripts(productionId: string, user: RequestUser) {
    await this.assertMembership(productionId, user, VIEW_ROLES);
    return this.prisma.script.findMany({
      where: { productionId, deletedAt: null },
      orderBy: { createdAt: "asc" },
      include: {
        acts: {
          orderBy: { order: "asc" },
          include: {
            scenes: {
              orderBy: { order: "asc" },
              include: { blocks: { select: { id: true } } }
            }
          }
        },
        versions: { orderBy: { createdAt: "desc" }, take: 5 },
        imports: { orderBy: { createdAt: "desc" }, take: 5 }
      }
    });
  }

  async createScript(productionId: string, dto: CreateScriptDto, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    return this.prisma.script.create({
      data: {
        productionId,
        title: dto.title.trim(),
        acts: {
          create: {
            order: 1,
            title: dto.initialActTitle?.trim() || "1막",
            scenes: {
              create: {
                order: 1,
                title: dto.initialSceneTitle?.trim() || "1장"
              }
            }
          }
        }
      },
      include: this.snapshot.scriptDetailInclude()
    });
  }

  async getScript(productionId: string, scriptId: string, user: RequestUser) {
    await this.assertMembership(productionId, user, VIEW_ROLES);
    const canSeeAllAnnotations = await this.hasAnyRole(productionId, user, EDIT_ROLES);
    const script = await this.prisma.script.findFirst({
      where: { id: scriptId, productionId, deletedAt: null },
      include: this.snapshot.scriptDetailInclude()
    });
    if (!script) {
      throw new NotFoundException("대본을 찾을 수 없어요");
    }
    return this.filterPrivateAnnotations(script as unknown as ScriptWithAnnotations, user.id, canSeeAllAnnotations);
  }

  /**
   * 대본 소프트 삭제(휴지통) — 실제 데이터(막·장·대사·큐 등)는 지우지 않고 deletedAt만 찍어
   * 대본 목록·큐시트에서 감춘다. restoreScript로 되돌릴 수 있다.
   */
  async deleteScript(productionId: string, scriptId: string, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    const script = await this.prisma.script.findFirst({
      where: { id: scriptId, productionId, deletedAt: null },
      select: { id: true, title: true }
    });
    if (!script) {
      throw new NotFoundException("대본을 찾을 수 없어요");
    }
    await this.prisma.script.update({ where: { id: scriptId }, data: { deletedAt: new Date() } });
    return { deletedId: scriptId, title: script.title };
  }

  /** 삭제(휴지통)된 대본을 복구한다. */
  async restoreScript(productionId: string, scriptId: string, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    const script = await this.prisma.script.findFirst({
      where: { id: scriptId, productionId, deletedAt: { not: null } },
      select: { id: true, title: true }
    });
    if (!script) {
      throw new NotFoundException("복구할 대본을 찾을 수 없어요");
    }
    await this.prisma.script.update({ where: { id: scriptId }, data: { deletedAt: null } });
    return { restoredId: scriptId, title: script.title };
  }

  /** 삭제(휴지통)된 대본 목록 — 복구 UI용. */
  async listDeletedScripts(productionId: string, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    return this.prisma.script.findMany({
      where: { productionId, deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
      select: { id: true, title: true, deletedAt: true }
    });
  }

  async createAct(productionId: string, scriptId: string, dto: CreateActDto, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    await this.entities.assertScript(productionId, scriptId);
    const maxOrder = await this.entities.getMaxActOrder(scriptId);
    return this.prisma.act.create({
      data: {
        scriptId,
        order: maxOrder + 1,
        title: dto.title.trim(),
        scenes: {
          create: {
            order: 1,
            title: dto.initialSceneTitle?.trim() || "1장"
          }
        }
      },
      include: { scenes: { orderBy: { order: "asc" }, include: { blocks: { orderBy: { order: "asc" } } } } }
    });
  }

  async createScene(productionId: string, actId: string, dto: CreateSceneDto, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    const act = await this.entities.assertAct(productionId, actId);
    const aggregate = await this.prisma.scene.aggregate({
      where: { actId },
      _max: { order: true }
    });
    return this.prisma.scene.create({
      data: {
        actId: act.id,
        order: (aggregate._max.order ?? 0) + 1,
        title: dto.title.trim(),
        summary: dto.summary?.trim() || null
      },
      include: { blocks: { orderBy: { order: "asc" } } }
    });
  }

  async createBlock(productionId: string, sceneId: string, dto: CreateBlockDto, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    const scene = await this.entities.assertScene(productionId, sceneId);
    await this.entities.assertCharacterInProduction(productionId, dto.characterId);

    const aggregate = await this.prisma.sceneBlock.aggregate({
      where: { sceneId },
      _max: { order: true }
    });
    const maxOrder = aggregate._max.order ?? 0;
    const nextOrder = Math.min(Math.max(dto.order ?? maxOrder + 1, 1), maxOrder + 1);

    return this.prisma.$transaction(async (tx) => {
      if (nextOrder <= maxOrder) {
        await tx.sceneBlock.updateMany({
          where: { sceneId, order: { gte: nextOrder } },
          data: { order: { increment: 1 } }
        });
      }

      return tx.sceneBlock.create({
        data: {
          sceneId: scene.id,
          order: nextOrder,
          type: dto.type,
          characterId: dto.characterId || null,
          cueLabel: dto.cueLabel?.trim() || null,
          text: dto.text.trim()
        }
      });
    });
  }

  async updateBlock(productionId: string, blockId: string, dto: UpdateBlockDto, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    await this.entities.assertBlock(productionId, blockId);
    await this.entities.assertCharacterInProduction(productionId, dto.characterId);

    return this.prisma.sceneBlock.update({
      where: { id: blockId },
      data: {
        type: dto.type,
        text: dto.text?.trim(),
        characterId: dto.characterId === undefined ? undefined : dto.characterId || null,
        cueLabel: dto.cueLabel === undefined ? undefined : dto.cueLabel?.trim() || null,
        startMs: dto.startMs === undefined ? undefined : dto.startMs,
        durationMs: dto.durationMs === undefined ? undefined : dto.durationMs
      }
    });
  }

  async deleteBlock(productionId: string, blockId: string, force: boolean, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    const block = await this.entities.assertBlock(productionId, blockId);
    const [annotationCount, musicCueCount] = await Promise.all([
      this.prisma.annotation.count({ where: { anchorBlockId: blockId } }),
      this.prisma.musicCue.count({ where: { anchorBlockId: blockId } })
    ]);
    const impact = { annotations: annotationCount, musicCues: musicCueCount };

    if (!force && (annotationCount > 0 || musicCueCount > 0)) {
      throw anchorBrokenException({
        message: "연결된 주석 또는 음악 큐가 있어요. 영향 내용을 확인한 뒤 다시 삭제해 주세요.",
        impact
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.annotation.updateMany({
        where: { anchorBlockId: blockId },
        data: { anchorBlockId: null, anchorStatus: AnchorStatus.BROKEN }
      });
      await tx.musicCue.updateMany({
        where: { anchorBlockId: blockId },
        data: { anchorBlockId: null, anchorStatus: AnchorStatus.BROKEN }
      });
      await tx.sceneBlock.delete({ where: { id: blockId } });

      const remaining = await tx.sceneBlock.findMany({
        where: { sceneId: block.sceneId },
        orderBy: { order: "asc" },
        select: { id: true }
      });
      for (const [index, item] of remaining.entries()) {
        await tx.sceneBlock.update({ where: { id: item.id }, data: { order: index + 1 } });
      }
    });

    return { deletedId: blockId, impact };
  }

  async reorderBlocks(productionId: string, sceneId: string, dto: ReorderBlocksDto, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    await this.entities.assertScene(productionId, sceneId);
    const blocks = await this.prisma.sceneBlock.findMany({
      where: { sceneId },
      select: { id: true }
    });
    const currentIds = new Set(blocks.map((block) => block.id));
    if (currentIds.size !== dto.blockIds.length || dto.blockIds.some((id) => !currentIds.has(id))) {
      throw new BadRequestException("장면의 모든 블록을 정확히 포함해야 순서를 저장할 수 있어요");
    }

    await this.prisma.$transaction(
      dto.blockIds.map((id, index) => this.prisma.sceneBlock.update({ where: { id }, data: { order: index + 1 } }))
    );
    return { blockIds: dto.blockIds };
  }

  async createVersion(productionId: string, scriptId: string, dto: CreateScriptVersionDto, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    await this.entities.assertScript(productionId, scriptId);
    const version = await this.snapshot.createVersionSnapshot(scriptId, dto.label.trim(), user.id);
    await this.scriptNotifications.notifyScriptChange(productionId, scriptId, user.id, "script.version_created", {
      versionId: version.id,
      label: version.label
    });
    return version;
  }

  async restoreVersion(productionId: string, scriptId: string, versionId: string, dto: RestoreScriptVersionDto, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    await this.entities.assertScript(productionId, scriptId);
    const version = await this.prisma.scriptVersion.findFirst({
      where: { id: versionId, scriptId, script: { productionId } }
    });
    if (!version) {
      throw new NotFoundException("복원할 대본 버전을 찾을 수 없어요");
    }

    const snapshot = this.snapshot.normalizeScriptSnapshot(version.snapshot);
    const targetActIds = new Set(snapshot.acts.map((act) => act.id));
    const targetSceneIds = new Set(snapshot.acts.flatMap((act) => act.scenes.map((scene) => scene.id)));
    const targetBlockIds = new Set(
      snapshot.acts.flatMap((act) => act.scenes.flatMap((scene) => scene.blocks.map((block) => block.id)))
    );

    const current = await this.prisma.script.findFirst({
      where: { id: scriptId, productionId },
      include: {
        acts: {
          include: {
            scenes: {
              include: { blocks: true }
            }
          }
        }
      }
    });
    if (!current) {
      throw new NotFoundException("대본을 찾을 수 없어요");
    }

    const extraActIds = current.acts.filter((act) => !targetActIds.has(act.id)).map((act) => act.id);
    const extraSceneIds = current.acts.flatMap((act) =>
      act.scenes.filter((scene) => !targetSceneIds.has(scene.id)).map((scene) => scene.id)
    );
    const extraBlockIds = current.acts.flatMap((act) =>
      act.scenes.flatMap((scene) => scene.blocks.filter((block) => !targetBlockIds.has(block.id)).map((block) => block.id))
    );

    const impact = await this.snapshot.getRestoreImpact(extraActIds, extraSceneIds, extraBlockIds);
    if (impact.sceneLinks.total > 0) {
      throw anchorBrokenException({
        message: "복원하면 일정·무대·진행표 등 장면 연결이 끊기는 항목이 있어요. 먼저 연결을 정리한 뒤 다시 시도해 주세요.",
        canForce: false,
        impact
      });
    }
    if (!dto.force && impact.blockAnchors.total > 0) {
      throw anchorBrokenException({
        message: "복원하면 현재 블록에 연결된 주석 또는 음악 큐 anchor가 끊겨요. 영향 내용을 확인한 뒤 force=true로 다시 시도해 주세요.",
        canForce: true,
        impact
      });
    }

    const targetCharacterIds = Array.from(
      new Set(
        snapshot.acts.flatMap((act) =>
          act.scenes.flatMap((scene) => scene.blocks.map((block) => block.characterId).filter(Boolean))
        ) as string[]
      )
    );
    const validCharacterIds = new Set(
      (
        await this.prisma.role.findMany({
          where: { productionId, id: { in: targetCharacterIds } },
          select: { id: true }
        })
      ).map((role) => role.id)
    );

    const result = await this.prisma.$transaction(async (tx) => {
      let backupVersionId: string | null = null;
      if (dto.createBackupVersion ?? true) {
        const backupSnapshot = await this.snapshot.buildScriptSnapshot(scriptId, tx);
        const backup = await tx.scriptVersion.create({
          data: {
            scriptId,
            label: dto.backupLabel?.trim() || `복원 전 백업 - ${new Date().toISOString()}`,
            snapshot: backupSnapshot as unknown as Prisma.InputJsonValue,
            authorId: user.id
          },
          select: { id: true }
        });
        backupVersionId = backup.id;
      }

      if (extraBlockIds.length) {
        await tx.annotation.updateMany({
          where: { anchorBlockId: { in: extraBlockIds } },
          data: { anchorBlockId: null, anchorStatus: AnchorStatus.BROKEN }
        });
        await tx.musicCue.updateMany({
          where: { anchorBlockId: { in: extraBlockIds } },
          data: { anchorBlockId: null, anchorStatus: AnchorStatus.BROKEN }
        });
        await tx.sceneBlock.deleteMany({ where: { id: { in: extraBlockIds } } });
      }
      if (extraSceneIds.length) {
        await tx.scene.deleteMany({ where: { id: { in: extraSceneIds } } });
      }
      if (extraActIds.length) {
        await tx.act.deleteMany({ where: { id: { in: extraActIds } } });
      }

      await tx.script.update({ where: { id: scriptId }, data: { title: snapshot.title } });

      for (const act of snapshot.acts) {
        await tx.act.upsert({
          where: { id: act.id },
          update: { order: act.order, title: act.title },
          create: { id: act.id, scriptId, order: act.order, title: act.title }
        });

        for (const scene of act.scenes) {
          await tx.scene.upsert({
            where: { id: scene.id },
            update: { actId: act.id, order: scene.order, title: scene.title, summary: scene.summary },
            create: { id: scene.id, actId: act.id, order: scene.order, title: scene.title, summary: scene.summary }
          });

          for (const block of scene.blocks) {
            const characterId = block.characterId && validCharacterIds.has(block.characterId) ? block.characterId : null;
            await tx.sceneBlock.upsert({
              where: { id: block.id },
              update: {
                sceneId: scene.id,
                order: block.order,
                type: block.type,
                text: block.text,
                cueLabel: block.cueLabel,
                characterId
              },
              create: {
                id: block.id,
                sceneId: scene.id,
                order: block.order,
                type: block.type,
                text: block.text,
                cueLabel: block.cueLabel,
                characterId
              }
            });
          }
        }
      }

      return { backupVersionId };
    });

    const response = {
      restoredVersionId: version.id,
      restoredLabel: version.label,
      backupVersionId: result.backupVersionId,
      counts: {
        acts: snapshot.acts.length,
        scenes: snapshot.acts.reduce((sum, act) => sum + act.scenes.length, 0),
        blocks: snapshot.acts.reduce((sum, act) => sum + act.scenes.reduce((sceneSum, scene) => sceneSum + scene.blocks.length, 0), 0)
      },
      removed: impact.removing,
      brokenAnchors: impact.blockAnchors
    };
    await this.scriptNotifications.notifyScriptChange(productionId, scriptId, user.id, "script.version_restored", {
      versionId: version.id,
      label: version.label,
      backupVersionId: result.backupVersionId
    });
    return response;
  }

  async listAnnotations(productionId: string, blockId: string, user: RequestUser) {
    await this.assertMembership(productionId, user, VIEW_ROLES);
    const block = await this.entities.assertBlock(productionId, blockId);
    const canSeeAll = await this.hasAnyRole(productionId, user, EDIT_ROLES);
    return this.prisma.annotation.findMany({
      where: {
        anchorBlockId: block.id,
        OR: canSeeAll ? undefined : [{ isShared: true }, { authorId: user.id }]
      },
      orderBy: { createdAt: "asc" }
    });
  }

  async createAnnotation(productionId: string, blockId: string, dto: CreateAnnotationDto, user: RequestUser) {
    await this.assertMembership(productionId, user, VIEW_ROLES);
    const block = await this.entities.assertBlock(productionId, blockId);
    if (dto.isShared && !(await this.hasAnyRole(productionId, user, EDIT_ROLES))) {
      throw new ForbiddenException("공유 주석은 기획자 또는 연출자만 만들 수 있어요");
    }

    return this.prisma.annotation.create({
      data: {
        sceneId: block.sceneId,
        anchorBlockId: block.id,
        authorId: user.id,
        type: dto.type,
        content: dto.content.trim(),
        isShared: dto.isShared ?? false,
        anchorStatus: AnchorStatus.OK
      }
    });
  }

  async updateAnnotation(productionId: string, blockId: string, annotationId: string, dto: UpdateAnnotationDto, user: RequestUser) {
    await this.assertMembership(productionId, user, VIEW_ROLES);
    const annotation = await this.entities.assertAnnotation(productionId, blockId, annotationId);
    const canManageShared = await this.hasAnyRole(productionId, user, EDIT_ROLES);
    this.entities.assertAnnotationEditable(annotation, user, canManageShared);

    if ((dto.isShared || annotation.isShared) && !canManageShared) {
      throw new ForbiddenException("공유 주석은 기획자 또는 연출자만 수정할 수 있어요");
    }

    if (dto.content !== undefined && !dto.content.trim()) {
      throw new BadRequestException("주석 내용을 입력해 주세요");
    }

    return this.prisma.annotation.update({
      where: { id: annotation.id },
      data: {
        type: dto.type,
        content: dto.content === undefined ? undefined : dto.content.trim(),
        isShared: dto.isShared
      }
    });
  }

  async deleteAnnotation(productionId: string, blockId: string, annotationId: string, user: RequestUser) {
    await this.assertMembership(productionId, user, VIEW_ROLES);
    const annotation = await this.entities.assertAnnotation(productionId, blockId, annotationId);
    const canManageShared = await this.hasAnyRole(productionId, user, EDIT_ROLES);
    this.entities.assertAnnotationEditable(annotation, user, canManageShared);

    await this.prisma.annotation.delete({ where: { id: annotation.id } });
    return { deletedId: annotation.id };
  }

  private async assertMembership(productionId: string, user: RequestUser, roles: ProductionRole[]) {
    await assertProductionMembership(this.prisma, user, productionId, roles);
  }

  private async hasAnyRole(productionId: string, user: RequestUser, roles: ProductionRole[]) {
    if (await isProductionAdmin(this.prisma, user, productionId)) {
      return true;
    }
    const count = await this.prisma.membership.count({
      where: { productionId, userId: user.id, roles: { some: { role: { in: roles } } } }
    });
    return count > 0;
  }

  private filterPrivateAnnotations<T extends ScriptWithAnnotations>(script: T, userId: string, canSeeAll: boolean) {
    if (canSeeAll) {
      return script;
    }
    return {
      ...script,
      acts: script.acts.map((act) => ({
        ...act,
        scenes: act.scenes.map((scene) => ({
          ...scene,
          blocks: scene.blocks.map((block) => ({
            ...block,
            annotations: block.annotations.filter((annotation) => annotation.isShared || annotation.authorId === userId)
          }))
        }))
      }))
    };
  }
}
