import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { AnchorStatus, Asset, AssetKind, Prisma, ProductionRole, SceneBlockType } from "@prisma/client";
import { randomUUID } from "crypto";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { AssetsService } from "../assets/assets.service";
import type { RequestUser } from "../common/types/request-user";
import { MailService } from "../mail/mail.service";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  ApplyScriptImportDto,
  CreateActDto,
  CreateAnnotationDto,
  CreateBlockDto,
  CreateSceneDto,
  CreateScriptDto,
  CreateScriptImportDto,
  CreateScriptVersionDto,
  ReorderBlocksDto,
  ReviewedImportBlockDto,
  RestoreScriptVersionDto,
  UpdateAnnotationDto,
  UpdateBlockDto
} from "./dto";
import { isProductionAdmin } from "../common/access/is-production-admin";
import { assertProductionMembership } from "../common/access/assert-production-membership";

type ParsedImportBlock = {
  tempId: string;
  type: SceneBlockType;
  text: string;
  speakerName?: string;
  confidence?: number;
};

type ScriptImportPreviewBlock = ParsedImportBlock & {
  actTitle: string;
  sceneTitle: string;
};

type ParsedImportScene = {
  title: string;
  blocks: ParsedImportBlock[];
};

type ParsedImportAct = {
  title: string;
  scenes: ParsedImportScene[];
};

type ParsedImport = {
  sourceType: string;
  acts: ParsedImportAct[];
  warnings: Array<{ code: string; message: string }>;
};

type ScriptImportSourceType = NonNullable<CreateScriptImportDto["sourceType"]>;
type ScriptImportAsset = Pick<Asset, "id" | "productionId" | "kind" | "mime">;

type ScriptWithAnnotations = {
  acts: Array<{
    scenes: Array<{
      blocks: Array<{
        annotations: Array<{ authorId: string; isShared: boolean }>;
      }>;
    }>;
  }>;
};

type SnapshotBlock = {
  id: string;
  order: number;
  type: SceneBlockType;
  characterId: string | null;
  cueLabel: string | null;
  text: string;
};

type SnapshotScene = {
  id: string;
  order: number;
  title: string;
  summary: string | null;
  blocks: SnapshotBlock[];
};

type SnapshotAct = {
  id: string;
  order: number;
  title: string;
  scenes: SnapshotScene[];
};

type ScriptSnapshot = {
  id: string;
  title: string;
  acts: SnapshotAct[];
};

type RestoreImpact = {
  removing: { acts: number; scenes: number; blocks: number };
  blockAnchors: { annotations: number; musicCues: number; total: number };
  sceneLinks: {
    annotations: number;
    sceneRoles: number;
    musicCues: number;
    eventScenes: number;
    stageNotes: number;
    runSheetItems: number;
    total: number;
  };
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
const SCRIPT_IMPORT_MIME_TYPES = [
  "text/plain",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
];

@Injectable()
export class ScriptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assetsService: AssetsService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService
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
      include: this.scriptDetailInclude()
    });
  }

  async getScript(productionId: string, scriptId: string, user: RequestUser) {
    await this.assertMembership(productionId, user, VIEW_ROLES);
    const canSeeAllAnnotations = await this.hasAnyRole(productionId, user, EDIT_ROLES);
    const script = await this.prisma.script.findFirst({
      where: { id: scriptId, productionId, deletedAt: null },
      include: this.scriptDetailInclude()
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
    await this.assertScript(productionId, scriptId);
    const maxOrder = await this.getMaxActOrder(scriptId);
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
    const act = await this.assertAct(productionId, actId);
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
    const scene = await this.assertScene(productionId, sceneId);
    await this.assertCharacterInProduction(productionId, dto.characterId);

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
    await this.assertBlock(productionId, blockId);
    await this.assertCharacterInProduction(productionId, dto.characterId);

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
    const block = await this.assertBlock(productionId, blockId);
    const [annotationCount, musicCueCount] = await Promise.all([
      this.prisma.annotation.count({ where: { anchorBlockId: blockId } }),
      this.prisma.musicCue.count({ where: { anchorBlockId: blockId } })
    ]);
    const impact = { annotations: annotationCount, musicCues: musicCueCount };

    if (!force && (annotationCount > 0 || musicCueCount > 0)) {
      throw this.anchorBrokenException({
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
    await this.assertScene(productionId, sceneId);
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
    await this.assertScript(productionId, scriptId);
    const version = await this.createVersionSnapshot(scriptId, dto.label.trim(), user.id);
    await this.notifyScriptChange(productionId, scriptId, user.id, "script.version_created", {
      versionId: version.id,
      label: version.label
    });
    return version;
  }

  async restoreVersion(
    productionId: string,
    scriptId: string,
    versionId: string,
    dto: RestoreScriptVersionDto,
    user: RequestUser
  ) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    await this.assertScript(productionId, scriptId);
    const version = await this.prisma.scriptVersion.findFirst({
      where: { id: versionId, scriptId, script: { productionId } }
    });
    if (!version) {
      throw new NotFoundException("복원할 대본 버전을 찾을 수 없어요");
    }

    const snapshot = this.normalizeScriptSnapshot(version.snapshot);
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

    const impact = await this.getRestoreImpact(extraActIds, extraSceneIds, extraBlockIds);
    if (impact.sceneLinks.total > 0) {
      throw this.anchorBrokenException({
        message: "복원하면 일정·무대·진행표 등 장면 연결이 끊기는 항목이 있어요. 먼저 연결을 정리한 뒤 다시 시도해 주세요.",
        canForce: false,
        impact
      });
    }
    if (!dto.force && impact.blockAnchors.total > 0) {
      throw this.anchorBrokenException({
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
        const backupSnapshot = await this.buildScriptSnapshot(scriptId, tx);
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
    await this.notifyScriptChange(productionId, scriptId, user.id, "script.version_restored", {
      versionId: version.id,
      label: version.label,
      backupVersionId: result.backupVersionId
    });
    return response;
  }

  async createImport(productionId: string, scriptId: string, dto: CreateScriptImportDto, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    await this.assertScript(productionId, scriptId);
    if (!dto.assetId && !dto.rawText?.trim()) {
      throw new BadRequestException("assetId 또는 rawText 중 하나가 필요해요");
    }

    const importSource = await this.resolveImportSource(productionId, dto, user);
    const parsed = this.parseImportText(importSource.rawText, importSource.sourceType);

    const scriptImport = await this.prisma.scriptImport.create({
      data: {
        scriptId,
        assetId: importSource.assetId,
        status: "DRAFT",
        parsedJson: parsed as unknown as Prisma.InputJsonValue,
        createdById: user.id
      }
    });

    return {
      importId: scriptImport.id,
      status: scriptImport.status,
      detectedActs: parsed.acts.length,
      detectedScenes: parsed.acts.reduce((count, act) => count + act.scenes.length, 0),
      blocks: this.flattenImportPreviewBlocks(parsed),
      warnings: parsed.warnings
    };
  }

  async applyImport(
    productionId: string,
    scriptId: string,
    importId: string,
    dto: ApplyScriptImportDto,
    user: RequestUser
  ) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    await this.assertScript(productionId, scriptId);
    const scriptImport = await this.prisma.scriptImport.findFirst({ where: { id: importId, scriptId } });
    if (!scriptImport) {
      throw new NotFoundException("가져오기 draft를 찾을 수 없어요");
    }
    if (scriptImport.status !== "DRAFT") {
      throw new BadRequestException("DRAFT 상태만 대본에 반영할 수 있어요");
    }

    const parsed = dto.reviewedBlocks?.length
      ? this.parsedFromReviewedBlocks(dto.reviewedBlocks)
      : (scriptImport.parsedJson as unknown as ParsedImport);
    if (!parsed?.acts?.length) {
      throw new BadRequestException("반영할 대본 블록이 없어요");
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const created = { actIds: [] as string[], sceneIds: [] as string[], blockIds: [] as string[] };
      let actOrder = await this.getMaxActOrder(scriptId, tx);

      for (const actDraft of parsed.acts) {
        const act = await tx.act.create({
          data: {
            scriptId,
            order: ++actOrder,
            title: actDraft.title || `가져온 막 ${actOrder}`
          }
        });
        created.actIds.push(act.id);

        for (const [sceneIndex, sceneDraft] of actDraft.scenes.entries()) {
          const scene = await tx.scene.create({
            data: {
              actId: act.id,
              order: sceneIndex + 1,
              title: sceneDraft.title || `가져온 장 ${sceneIndex + 1}`
            }
          });
          created.sceneIds.push(scene.id);

          for (const [blockIndex, blockDraft] of sceneDraft.blocks.entries()) {
            const block = await tx.sceneBlock.create({
              data: {
                sceneId: scene.id,
                order: blockIndex + 1,
                type: blockDraft.type,
                text: blockDraft.text,
                cueLabel: blockDraft.speakerName || null
              }
            });
            created.blockIds.push(block.id);
          }
        }
      }

      await tx.scriptImport.update({
        where: { id: importId },
        data: { status: "APPLIED", appliedAt: new Date() }
      });

      let versionId: string | null = null;
      if (dto.createVersion ?? true) {
        const snapshot = await this.buildScriptSnapshot(scriptId, tx);
        const version = await tx.scriptVersion.create({
          data: {
            scriptId,
            label: dto.versionName?.trim() || "import 반영본",
            snapshot: snapshot as unknown as Prisma.InputJsonValue,
            authorId: user.id
          }
        });
        versionId = version.id;
      }

      return { ...created, versionId };
    });

    if (result.versionId) {
      await this.notifyScriptChange(productionId, scriptId, user.id, "script.version_created", {
        versionId: result.versionId,
        label: dto.versionName?.trim() || "import 반영본",
        importId
      });
    }

    return result;
  }

  async listAnnotations(productionId: string, blockId: string, user: RequestUser) {
    await this.assertMembership(productionId, user, VIEW_ROLES);
    const block = await this.assertBlock(productionId, blockId);
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
    const block = await this.assertBlock(productionId, blockId);
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

  async updateAnnotation(
    productionId: string,
    blockId: string,
    annotationId: string,
    dto: UpdateAnnotationDto,
    user: RequestUser
  ) {
    await this.assertMembership(productionId, user, VIEW_ROLES);
    const annotation = await this.assertAnnotation(productionId, blockId, annotationId);
    const canManageShared = await this.hasAnyRole(productionId, user, EDIT_ROLES);
    this.assertAnnotationEditable(annotation, user, canManageShared);

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
    const annotation = await this.assertAnnotation(productionId, blockId, annotationId);
    const canManageShared = await this.hasAnyRole(productionId, user, EDIT_ROLES);
    this.assertAnnotationEditable(annotation, user, canManageShared);

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

  private async notifyScriptChange(
    productionId: string,
    scriptId: string,
    actorId: string,
    type: "script.version_created" | "script.version_restored",
    payload: Record<string, unknown>
  ) {
    const [script, memberships] = await Promise.all([
      this.prisma.script.findFirst({
        where: { id: scriptId, productionId },
        select: { id: true, title: true, production: { select: { title: true } } }
      }),
      this.prisma.membership.findMany({
        where: { productionId, userId: { not: actorId } },
        select: { userId: true, user: { select: { email: true, name: true } } }
      })
    ]);
    if (!script || memberships.length === 0) return;

    const notificationPayload = {
      scriptId: script.id,
      scriptTitle: script.title,
      ...payload
    } as Prisma.InputJsonValue;
    await Promise.all([
      this.notifications.createNotifications(
        memberships.map((membership) => ({
          productionId,
          userId: membership.userId,
          type,
          payload: notificationPayload
        }))
      ),
      ...memberships.map((membership) =>
        this.mail.queueDigestEmail({
          userId: membership.userId,
          productionId,
          toEmail: membership.user.email,
          templateKey: "script.change_digest",
          subject: `[아트브릿지] ${script.production.title} 대본 변경 요약`,
          bodyText: this.scriptDigestBody({
            recipientName: membership.user.name,
            productionTitle: script.production.title,
            scriptTitle: script.title,
            type,
            payload
          }),
          metadata: {
            scriptId: script.id,
            scriptTitle: script.title,
            notificationType: type,
            ...payload
          }
        })
      )
    ]);
  }

  private scriptDigestBody(input: {
    recipientName: string;
    productionTitle: string;
    scriptTitle: string;
    type: "script.version_created" | "script.version_restored";
    payload: Record<string, unknown>;
  }) {
    const action = input.type === "script.version_created" ? "새 대본 버전이 저장되었습니다." : "대본 버전이 복원되었습니다.";
    const label = typeof input.payload.label === "string" ? input.payload.label : null;
    return [
      `${input.recipientName}님,`,
      "",
      `[${input.productionTitle}] ${input.scriptTitle}`,
      action,
      label ? `버전: ${label}` : null,
      "",
      "대본 뷰어에서 변경된 장면, 본인 대사, 큐 마커를 확인해 주세요."
    ].filter(Boolean).join("\n");
  }

  private async assertScript(productionId: string, scriptId: string) {
    const script = await this.prisma.script.findFirst({ where: { id: scriptId, productionId }, select: { id: true } });
    if (!script) {
      throw new NotFoundException("대본을 찾을 수 없어요");
    }
    return script;
  }

  private async assertAct(productionId: string, actId: string) {
    const act = await this.prisma.act.findFirst({
      where: { id: actId, script: { productionId } },
      select: { id: true, scriptId: true }
    });
    if (!act) {
      throw new NotFoundException("막을 찾을 수 없어요");
    }
    return act;
  }

  private async assertScene(productionId: string, sceneId: string) {
    const scene = await this.prisma.scene.findFirst({
      where: { id: sceneId, act: { script: { productionId } } },
      select: { id: true, actId: true }
    });
    if (!scene) {
      throw new NotFoundException("장을 찾을 수 없어요");
    }
    return scene;
  }

  private async assertBlock(productionId: string, blockId: string) {
    const block = await this.prisma.sceneBlock.findFirst({
      where: { id: blockId, scene: { act: { script: { productionId } } } },
      select: { id: true, sceneId: true, order: true }
    });
    if (!block) {
      throw new NotFoundException("대본 블록을 찾을 수 없어요");
    }
    return block;
  }

  private async assertAnnotation(productionId: string, blockId: string, annotationId: string) {
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

  private assertAnnotationEditable(
    annotation: { authorId: string; isShared: boolean },
    user: RequestUser,
    canManageShared: boolean
  ) {
    if (annotation.authorId === user.id) {
      return;
    }
    if (annotation.isShared && canManageShared) {
      return;
    }
    throw new ForbiddenException("이 주석을 수정하거나 삭제할 수 없어요");
  }

  private async assertCharacterInProduction(productionId: string, characterId?: string | null) {
    if (!characterId) {
      return;
    }
    const role = await this.prisma.role.findFirst({ where: { id: characterId, productionId }, select: { id: true } });
    if (!role) {
      throw new BadRequestException("이 공연의 배역만 대본 블록에 지정할 수 있어요");
    }
  }

  private async getMaxActOrder(scriptId: string, tx: Prisma.TransactionClient | PrismaService = this.prisma) {
    const aggregate = await tx.act.aggregate({
      where: { scriptId },
      _max: { order: true }
    });
    return aggregate._max.order ?? 0;
  }

  private async createInlineImportAsset(productionId: string, dto: CreateScriptImportDto, user: RequestUser) {
    const rawText = dto.rawText ?? "";
    const asset = await this.prisma.asset.create({
      data: {
        ownerId: user.id,
        productionId,
        kind: AssetKind.DOCUMENT,
        storageKey: `inline-script-import/${randomUUID()}.txt`,
        mime: "text/plain",
        sizeBytes: Buffer.byteLength(rawText, "utf8"),
        checksum: null
      },
      select: { id: true }
    });
    return asset.id;
  }

  private async resolveImportSource(productionId: string, dto: CreateScriptImportDto, user: RequestUser) {
    const pastedText = dto.rawText?.trim() ? dto.rawText : undefined;

    if (dto.assetId) {
      if (pastedText) {
        const asset = await this.assertScriptImportAsset(productionId, dto.assetId);
        const sourceType = this.resolveAssetSourceType(asset, dto.sourceType);
        return { assetId: dto.assetId, sourceType, rawText: pastedText };
      }

      const object = await this.assetsService.readMockObject(dto.assetId);
      this.assertScriptImportAssetRecord(productionId, object.asset);
      const sourceType = this.resolveAssetSourceType(object.asset, dto.sourceType);
      return {
        assetId: dto.assetId,
        sourceType,
        rawText: await this.extractImportText(object.body, sourceType)
      };
    }

    if (!pastedText) {
      throw new BadRequestException("assetId 또는 rawText 중 하나가 필요해요");
    }

    return {
      assetId: await this.createInlineImportAsset(productionId, dto, user),
      sourceType: dto.sourceType ?? "PASTE",
      rawText: pastedText
    };
  }

  private async assertScriptImportAsset(productionId: string, assetId: string) {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      select: { id: true, productionId: true, kind: true, mime: true }
    });
    if (!asset) {
      throw new NotFoundException("대본 가져오기 파일을 찾을 수 없어요");
    }
    this.assertScriptImportAssetRecord(productionId, asset);
    return asset;
  }

  private assertScriptImportAssetRecord(productionId: string, asset: ScriptImportAsset) {
    if (asset.productionId !== productionId) {
      throw new BadRequestException("이 공연에 등록된 대본 가져오기 파일만 사용할 수 있어요");
    }
    if (asset.kind !== AssetKind.DOCUMENT || !SCRIPT_IMPORT_MIME_TYPES.includes(asset.mime)) {
      throw new BadRequestException("대본 가져오기는 txt, docx, pdf 파일만 사용할 수 있어요");
    }
  }

  private resolveAssetSourceType(asset: ScriptImportAsset, requested?: ScriptImportSourceType) {
    const inferred = this.sourceTypeFromMime(asset.mime);
    if (requested && requested !== inferred) {
      throw new BadRequestException("sourceType과 업로드 파일 형식이 일치하지 않아요");
    }
    return requested ?? inferred;
  }

  private sourceTypeFromMime(mime: string): ScriptImportSourceType {
    if (mime === "text/plain") {
      return "TXT";
    }
    if (mime === "application/pdf") {
      return "PDF";
    }
    if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      return "DOCX";
    }
    throw new BadRequestException("지원하지 않는 대본 가져오기 파일 형식이에요");
  }

  private async extractImportText(body: Buffer, sourceType: ScriptImportSourceType) {
    let text = "";

    if (sourceType === "TXT" || sourceType === "PASTE") {
      text = body.toString("utf8");
    } else if (sourceType === "DOCX") {
      const result = await mammoth.extractRawText({ buffer: body });
      text = result.value;
    } else if (sourceType === "PDF") {
      const parser = new PDFParse({ data: body });
      try {
        const result = await parser.getText();
        text = result.text ?? "";
      } finally {
        await parser.destroy();
      }
    }

    if (!text.trim()) {
      throw new BadRequestException("파일에서 추출된 대본 텍스트가 없어요");
    }
    return text;
  }

  private parseImportText(rawText: string, sourceType: string): ParsedImport {
    const warnings: ParsedImport["warnings"] = [];
    const acts: ParsedImportAct[] = [];
    const ensureAct = (title = "1막") => {
      let act = acts.at(-1);
      if (!act) {
        act = { title, scenes: [] };
        acts.push(act);
      }
      return act;
    };
    const ensureScene = (title = "1장") => {
      const act = ensureAct();
      let scene = act.scenes.at(-1);
      if (!scene) {
        scene = { title, blocks: [] };
        act.scenes.push(scene);
      }
      return scene;
    };

    rawText.split(/\r?\n/).forEach((line, index) => {
      const text = line.trim();
      if (!text) {
        return;
      }
      if (text.startsWith("# ") && !text.startsWith("## ")) {
        acts.push({ title: text.slice(2).trim() || `${acts.length + 1}막`, scenes: [] });
        return;
      }
      if (text.startsWith("## ")) {
        const act = ensureAct();
        act.scenes.push({ title: text.slice(3).trim() || `${act.scenes.length + 1}장`, blocks: [] });
        return;
      }

      const scene = ensureScene();
      const tempId = `tmp_${index + 1}`;
      const speakerMatch = text.match(/^([^:：]{1,32})[:：]\s*(.+)$/);
      if (speakerMatch) {
        scene.blocks.push({
          tempId,
          type: SceneBlockType.DIALOGUE,
          speakerName: speakerMatch[1].trim(),
          text: speakerMatch[2].trim(),
          confidence: 0.9
        });
        return;
      }
      if (text.startsWith("♪")) {
        scene.blocks.push({ tempId, type: SceneBlockType.LYRIC, text: text.replace(/^♪\s*/, ""), confidence: 0.85 });
        return;
      }
      if (/^\[[^\]]+\]$/.test(text) || /^\([^)]+\)$/.test(text)) {
        scene.blocks.push({
          tempId,
          type: SceneBlockType.STAGE_DIRECTION,
          text: text.replace(/^\[|\]$|^\(|\)$/g, ""),
          confidence: 0.8
        });
        return;
      }
      if (/^(NOTE|메모)\s*[:：]/i.test(text)) {
        scene.blocks.push({
          tempId,
          type: SceneBlockType.NOTE,
          text: text.replace(/^(NOTE|메모)\s*[:：]\s*/i, ""),
          confidence: 0.8
        });
        return;
      }

      scene.blocks.push({ tempId, type: SceneBlockType.DIALOGUE, text, confidence: 0.55 });
      warnings.push({
        code: "LOW_CONFIDENCE_BLOCK_TYPE",
        message: `${index + 1}번째 줄은 타입 추정 신뢰도가 낮아요. 반영 전 확인해 주세요.`
      });
    });

    if (!acts.length || !acts.some((act) => act.scenes.some((scene) => scene.blocks.length))) {
      warnings.push({ code: "EMPTY_IMPORT", message: "인식된 대본 블록이 없어요." });
      ensureScene();
    }

    return { sourceType, acts, warnings };
  }

  private flattenImportPreviewBlocks(parsed: ParsedImport): ScriptImportPreviewBlock[] {
    return parsed.acts.flatMap((act) =>
      act.scenes.flatMap((scene) =>
        scene.blocks.map((block) => ({
          ...block,
          actTitle: act.title,
          sceneTitle: scene.title
        }))
      )
    );
  }

  private parsedFromReviewedBlocks(blocks: ReviewedImportBlockDto[]): ParsedImport {
    const acts: ParsedImportAct[] = [];

    for (const block of blocks) {
      const actTitle = block.actTitle?.trim() || "가져온 대본";
      const sceneTitle = block.sceneTitle?.trim() || "검수 반영";
      let act = acts.find((item) => item.title === actTitle);
      if (!act) {
        act = { title: actTitle, scenes: [] };
        acts.push(act);
      }
      let scene = act.scenes.find((item) => item.title === sceneTitle);
      if (!scene) {
        scene = { title: sceneTitle, blocks: [] };
        act.scenes.push(scene);
      }
      scene.blocks.push({
        tempId: block.tempId,
        type: block.type,
        text: block.text.trim(),
        speakerName: block.speakerName?.trim()
      });
    }

    return {
      sourceType: "REVIEWED",
      acts,
      warnings: []
    };
  }

  private async createVersionSnapshot(scriptId: string, label: string, authorId: string) {
    const snapshot = await this.buildScriptSnapshot(scriptId, this.prisma);
    return this.prisma.scriptVersion.create({
      data: {
        scriptId,
        label,
        authorId,
        snapshot: snapshot as unknown as Prisma.InputJsonValue
      }
    });
  }

  private buildScriptSnapshot(scriptId: string, tx: Prisma.TransactionClient | PrismaService) {
    return tx.script.findUniqueOrThrow({
      where: { id: scriptId },
      include: this.scriptDetailInclude()
    });
  }

  private scriptDetailInclude(): Prisma.ScriptInclude {
    return {
      acts: {
        orderBy: { order: "asc" },
        include: {
          scenes: {
            orderBy: { order: "asc" },
            include: {
              blocks: {
                orderBy: { order: "asc" },
                include: {
                  character: { select: { id: true, name: true } },
                  annotations: true,
                  musicCues: {
                    select: { id: true, cueNumber: true, cueType: true, anchorStatus: true, order: true }
                  }
                }
              }
            }
          }
        }
      },
      versions: { orderBy: { createdAt: "desc" } },
      imports: { orderBy: { createdAt: "desc" } }
    };
  }

  private async getRestoreImpact(extraActIds: string[], extraSceneIds: string[], extraBlockIds: string[]): Promise<RestoreImpact> {
    const [
      blockAnnotationCount,
      blockMusicCueCount,
      sceneAnnotationCount,
      sceneRoleCount,
      sceneMusicCueCount,
      eventSceneCount,
      stageNoteCount,
      runSheetItemCount
    ] = await Promise.all([
      extraBlockIds.length ? this.prisma.annotation.count({ where: { anchorBlockId: { in: extraBlockIds } } }) : 0,
      extraBlockIds.length ? this.prisma.musicCue.count({ where: { anchorBlockId: { in: extraBlockIds } } }) : 0,
      extraSceneIds.length ? this.prisma.annotation.count({ where: { sceneId: { in: extraSceneIds } } }) : 0,
      extraSceneIds.length ? this.prisma.sceneRole.count({ where: { sceneId: { in: extraSceneIds } } }) : 0,
      extraSceneIds.length ? this.prisma.musicCue.count({ where: { sceneId: { in: extraSceneIds } } }) : 0,
      extraSceneIds.length ? this.prisma.eventScene.count({ where: { sceneId: { in: extraSceneIds } } }) : 0,
      extraSceneIds.length ? this.prisma.stageSceneNote.count({ where: { sceneId: { in: extraSceneIds } } }) : 0,
      extraSceneIds.length ? this.prisma.runSheetItem.count({ where: { sceneId: { in: extraSceneIds } } }) : 0
    ]);

    return {
      removing: { acts: extraActIds.length, scenes: extraSceneIds.length, blocks: extraBlockIds.length },
      blockAnchors: {
        annotations: blockAnnotationCount,
        musicCues: blockMusicCueCount,
        total: blockAnnotationCount + blockMusicCueCount
      },
      sceneLinks: {
        annotations: sceneAnnotationCount,
        sceneRoles: sceneRoleCount,
        musicCues: sceneMusicCueCount,
        eventScenes: eventSceneCount,
        stageNotes: stageNoteCount,
        runSheetItems: runSheetItemCount,
        total: sceneAnnotationCount + sceneRoleCount + sceneMusicCueCount + eventSceneCount + stageNoteCount + runSheetItemCount
      }
    };
  }

  private normalizeScriptSnapshot(snapshot: Prisma.JsonValue): ScriptSnapshot {
    const data = this.asRecord(snapshot, "대본 버전 스냅샷이 올바르지 않아요");
    const actsRaw = this.asArray(data.acts, "대본 버전에 막 정보가 없어요");
    if (!actsRaw.length) {
      throw new BadRequestException("대본 버전에 복원할 막이 없어요");
    }

    return {
      id: this.asRequiredString(data.id, "대본 버전의 script id가 올바르지 않아요"),
      title: this.asOptionalString(data.title) || "복원된 대본",
      acts: actsRaw.map((actRaw, actIndex) => {
        const act = this.asRecord(actRaw, "대본 버전의 막 정보가 올바르지 않아요");
        const scenesRaw = this.asArray(act.scenes, "대본 버전의 장 정보가 없어요");
        return {
          id: this.asRequiredString(act.id, "대본 버전의 막 id가 올바르지 않아요"),
          order: this.asPositiveInt(act.order, actIndex + 1),
          title: this.asOptionalString(act.title) || `${actIndex + 1}막`,
          scenes: scenesRaw.map((sceneRaw, sceneIndex) => {
            const scene = this.asRecord(sceneRaw, "대본 버전의 장 정보가 올바르지 않아요");
            const blocksRaw = this.asArray(scene.blocks, "대본 버전의 블록 정보가 없어요");
            return {
              id: this.asRequiredString(scene.id, "대본 버전의 장 id가 올바르지 않아요"),
              order: this.asPositiveInt(scene.order, sceneIndex + 1),
              title: this.asOptionalString(scene.title) || `${sceneIndex + 1}장`,
              summary: this.asOptionalString(scene.summary),
              blocks: blocksRaw.map((blockRaw, blockIndex) => {
                const block = this.asRecord(blockRaw, "대본 버전의 블록 정보가 올바르지 않아요");
                return {
                  id: this.asRequiredString(block.id, "대본 버전의 블록 id가 올바르지 않아요"),
                  order: this.asPositiveInt(block.order, blockIndex + 1),
                  type: this.asSceneBlockType(block.type),
                  characterId: this.asOptionalString(block.characterId),
                  cueLabel: this.asOptionalString(block.cueLabel),
                  text: this.asRequiredString(block.text, "대본 버전의 블록 본문이 올바르지 않아요")
                };
              })
            };
          })
        };
      })
    };
  }

  private asRecord(value: unknown, message: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException(message);
    }
    return value as Record<string, unknown>;
  }

  private asArray(value: unknown, message: string): unknown[] {
    if (!Array.isArray(value)) {
      throw new BadRequestException(message);
    }
    return value;
  }

  private asRequiredString(value: unknown, message: string) {
    if (typeof value !== "string" || !value.trim()) {
      throw new BadRequestException(message);
    }
    return value;
  }

  private asOptionalString(value: unknown) {
    return typeof value === "string" && value.trim() ? value : null;
  }

  private asPositiveInt(value: unknown, fallback: number) {
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
  }

  private asSceneBlockType(value: unknown) {
    if (typeof value === "string" && Object.values(SceneBlockType).includes(value as SceneBlockType)) {
      return value as SceneBlockType;
    }
    throw new BadRequestException("대본 버전의 블록 타입이 올바르지 않아요");
  }

  private anchorBrokenException(payload: { message: string; impact: unknown; canForce?: boolean }) {
    return new ConflictException({
      code: "ANCHOR_BROKEN",
      ...payload
    });
  }

  private filterPrivateAnnotations<T extends ScriptWithAnnotations>(
    script: T,
    userId: string,
    canSeeAll: boolean
  ) {
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
