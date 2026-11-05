import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Asset, AssetKind, Prisma, ProductionRole, SceneBlockType } from "@prisma/client";
import { randomUUID } from "crypto";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { AssetsService } from "../assets/assets.service";
import { assertProductionMembership } from "../common/access/assert-production-membership";
import type { RequestUser } from "../common/types/request-user";
import { PrismaService } from "../prisma/prisma.service";
import { ApplyScriptImportDto, CreateScriptImportDto, ReviewedImportBlockDto } from "./dto";
import { ScriptEntityLookupService } from "./script-entity-lookup.service";
import { ScriptNotificationsService } from "./script-notifications.service";
import { ScriptSnapshotService } from "./script-snapshot.service";

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

const EDIT_ROLES = [ProductionRole.PRODUCER, ProductionRole.DIRECTOR];
const SCRIPT_IMPORT_MIME_TYPES = [
  "text/plain",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
];

/**
 * 대본 파일/붙여넣기 가져오기(import) 전담 — scripts.service.ts에서 분리.
 * 파일 파싱(mammoth/pdf-parse)과 import draft → 대본 반영 로직을 한곳에 모은다.
 */
@Injectable()
export class ScriptImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assetsService: AssetsService,
    private readonly entities: ScriptEntityLookupService,
    private readonly snapshot: ScriptSnapshotService,
    private readonly scriptNotifications: ScriptNotificationsService
  ) {}

  async createImport(productionId: string, scriptId: string, dto: CreateScriptImportDto, user: RequestUser) {
    await this.assertMembership(productionId, user);
    await this.entities.assertScript(productionId, scriptId);
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

  async applyImport(productionId: string, scriptId: string, importId: string, dto: ApplyScriptImportDto, user: RequestUser) {
    await this.assertMembership(productionId, user);
    await this.entities.assertScript(productionId, scriptId);
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
      let actOrder = await this.entities.getMaxActOrder(scriptId, tx);

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
        const snapshot = await this.snapshot.buildScriptSnapshot(scriptId, tx);
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
      await this.scriptNotifications.notifyScriptChange(productionId, scriptId, user.id, "script.version_created", {
        versionId: result.versionId,
        label: dto.versionName?.trim() || "import 반영본",
        importId
      });
    }

    return result;
  }

  private async assertMembership(productionId: string, user: RequestUser) {
    await assertProductionMembership(this.prisma, user, productionId, EDIT_ROLES);
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
}
