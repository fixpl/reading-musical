import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma, SceneBlockType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export type SnapshotBlock = {
  id: string;
  order: number;
  type: SceneBlockType;
  characterId: string | null;
  cueLabel: string | null;
  text: string;
};

export type SnapshotScene = {
  id: string;
  order: number;
  title: string;
  summary: string | null;
  blocks: SnapshotBlock[];
};

export type SnapshotAct = {
  id: string;
  order: number;
  title: string;
  scenes: SnapshotScene[];
};

export type ScriptSnapshot = {
  id: string;
  title: string;
  acts: SnapshotAct[];
};

export type RestoreImpact = {
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

/**
 * 대본 버전 스냅샷 생성/복원 관련 로직 — scripts.service.ts에서 분리.
 * createVersion/restoreVersion(core)과 applyImport(script-import.service.ts)가 공유한다.
 */
@Injectable()
export class ScriptSnapshotService {
  constructor(private readonly prisma: PrismaService) {}

  scriptDetailInclude(): Prisma.ScriptInclude {
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

  buildScriptSnapshot(scriptId: string, tx: Prisma.TransactionClient | PrismaService) {
    return tx.script.findUniqueOrThrow({
      where: { id: scriptId },
      include: this.scriptDetailInclude()
    });
  }

  async createVersionSnapshot(scriptId: string, label: string, authorId: string) {
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

  async getRestoreImpact(extraActIds: string[], extraSceneIds: string[], extraBlockIds: string[]): Promise<RestoreImpact> {
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

  normalizeScriptSnapshot(snapshot: Prisma.JsonValue): ScriptSnapshot {
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
}
