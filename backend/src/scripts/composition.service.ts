import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma, ProductionRole } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { AssetsService } from "../assets/assets.service";
import { isProductionAdmin } from "../common/access/is-production-admin";
import type { RequestUser } from "../common/types/request-user";
import { PrismaService } from "../prisma/prisma.service";
import { AttachReferenceFilesDto, ApplyCompositionImportDto, CompositionRevisionDto, PreviewCompositionImportDto, ReorderSectionsDto, ReviewedSectionDto, WriteCompositionMediaDto, WriteSectionDto, type MediaSlot, type SectionKind } from "./composition.dto";
import { parseCompositionText } from "./composition-parser";
import { CompositionLayoutError, resolveComposition } from "./composition-timing";

const EDIT_ROLES: ProductionRole[] = [ProductionRole.PRODUCER, ProductionRole.DIRECTOR];
const IMAGES = ["image/png", "image/jpeg", "image/webp"];
const AUDIO = ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/mp4", "audio/aac", "audio/x-m4a"];
const VIDEO = ["video/mp4", "video/webm", "video/quicktime"];
const DOCUMENTS = ["application/pdf", "text/plain", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
const ASSET_SELECT = { id: true, kind: true, mime: true, fileName: true, storageKey: true, sizeBytes: true } as const;
const SECTION_INCLUDE = { media: { orderBy: [{ order: "asc" }, { id: "asc" }], include: { asset: { select: ASSET_SELECT } } } } satisfies Prisma.PerformanceSectionInclude;
const MODE_FIELD = { BACKGROUND: "backgroundMode", MUSIC: "musicMode", SCORE: "scoreMode" } as const;
type Tx = Prisma.TransactionClient;

@Injectable()
export class CompositionService {
  constructor(private readonly prisma: PrismaService, private readonly assets: AssetsService) {}

  async board(productionId: string, user: RequestUser) {
    const canEdit = await this.assertAccess(productionId, user);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const production = await tx.production.findFirstOrThrow({
          where: { id: productionId, deletedAt: null },
          select: { id: true, title: true, compositionRevision: true }
        });
        const sections = await this.activeSections(tx, productionId);
        const layout = this.layout(sections);
        const timing = new Map(layout.entries.map((entry) => [entry.id, entry]));
        const scripts = await tx.script.findMany({ where: { productionId, deletedAt: null }, select: { id: true, title: true }, orderBy: { createdAt: "asc" } });
        const archived = canEdit ? await tx.performanceSection.findMany({
          where: { productionId, deletedAt: { not: null } },
          select: { id: true, title: true, parentId: true, deletedAt: true }, orderBy: { deletedAt: "desc" }
        }) : [];
        return { production, revision: production.compositionRevision, canEdit, durationMs: layout.durationMs,
          sections: sections.map((section) => ({ ...section, timing: timing.get(section.id)! })), scripts, archived };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2021", "P2022"].includes(error.code)) {
        throw new ServiceUnavailableException("장·막 구성 DB 업데이트가 필요합니다. 서버의 Prisma 마이그레이션 적용 후 다시 열어 주세요.");
      }
      throw error;
    }
  }

  async library(productionId: string, user: RequestUser, query?: string) {
    await this.assertAccess(productionId, user);
    const q = typeof query === "string" ? query.trim().slice(0, 100) : "";
    const rows = await this.prisma.asset.findMany({
      where: {
        productionId, mime: { in: [...IMAGES, ...AUDIO, ...VIDEO, ...DOCUMENTS] },
        NOT: { storageKey: { startsWith: "inline-script-import/" } },
        ...(q ? { OR: [{ fileName: { contains: q, mode: "insensitive" as const } }, { storageKey: { contains: q, mode: "insensitive" as const } }] } : {})
      },
      select: ASSET_SELECT, orderBy: { createdAt: "desc" }, take: 201
    });
    return { assets: rows.slice(0, 200), hasMore: rows.length > 200 };
  }

  async create(productionId: string, dto: WriteSectionDto, user: RequestUser) {
    if (!dto.title?.trim()) throw new BadRequestException("구간 제목을 입력하세요.");
    return this.mutate(productionId, dto.expectedRevision, user, "section.created", async (tx) => {
      const parentId = dto.parentId ?? null;
      await this.assertParent(tx, productionId, parentId);
      const section = await tx.performanceSection.create({ data: {
        productionId, parentId, order: await this.nextOrder(tx, productionId, parentId),
        title: dto.title!.trim(), kind: dto.kind ?? (parentId ? "ACT" : "CHAPTER"),
        scriptText: dto.scriptText ?? "", lyrics: dto.lyrics ?? "", startMs: dto.startMs ?? null, durationMs: dto.durationMs ?? null,
        backgroundMode: dto.backgroundMode ?? "INHERIT", musicMode: dto.musicMode ?? "INHERIT", scoreMode: dto.scoreMode ?? "INHERIT"
      } });
      return { id: section.id };
    });
  }

  async update(productionId: string, sectionId: string, dto: WriteSectionDto, user: RequestUser) {
    if (dto.title !== undefined && !dto.title.trim()) throw new BadRequestException("구간 제목을 입력하세요.");
    return this.mutate(productionId, dto.expectedRevision, user, "section.updated", async (tx) => {
      const current = await this.assertSection(tx, productionId, sectionId);
      const changedParent = dto.parentId !== undefined && dto.parentId !== current.parentId;
      if (changedParent) {
        await this.assertParent(tx, productionId, dto.parentId ?? null, sectionId);
        if (dto.parentId && await tx.performanceSection.count({ where: { parentId: sectionId } })) {
          throw new BadRequestException("하위 구간이 있는 장·막은 다른 장·막 안으로 이동할 수 없습니다.");
        }
      }
      await tx.performanceSection.update({ where: { id: sectionId }, data: {
        title: dto.title?.trim(), kind: dto.kind, scriptText: dto.scriptText, lyrics: dto.lyrics,
        parentId: dto.parentId, order: changedParent ? await this.nextOrder(tx, productionId, dto.parentId ?? null) : undefined,
        startMs: changedParent ? dto.startMs ?? null : dto.startMs, durationMs: dto.durationMs,
        backgroundMode: dto.backgroundMode, musicMode: dto.musicMode, scoreMode: dto.scoreMode
      } });
      return { id: sectionId };
    });
  }

  async reorder(productionId: string, dto: ReorderSectionsDto, user: RequestUser) {
    return this.mutate(productionId, dto.expectedRevision, user, "sections.reordered", async (tx) => {
      const parentId = dto.parentId ?? null;
      await this.assertParent(tx, productionId, parentId);
      const siblings = await tx.performanceSection.findMany({ where: { productionId, parentId, deletedAt: null }, select: { id: true } });
      const ids = new Set(dto.sectionIds);
      if (ids.size !== dto.sectionIds.length || siblings.length !== ids.size || siblings.some((s) => !ids.has(s.id))) {
        throw new BadRequestException("같은 상위 구간에 속한 모든 항목을 중복 없이 포함해야 합니다.");
      }
      // Reordering is a deliberate ripple operation; reset only these siblings' fixed starts.
      for (const [order, id] of dto.sectionIds.entries()) {
        await tx.performanceSection.update({ where: { id }, data: { order, startMs: null } });
      }
      return { ids: dto.sectionIds };
    });
  }

  async archive(productionId: string, sectionId: string, dto: CompositionRevisionDto, user: RequestUser) {
    return this.mutate(productionId, dto.expectedRevision, user, "section.archived", async (tx) => {
      await this.assertSection(tx, productionId, sectionId);
      await tx.performanceSection.updateMany({
        where: { productionId, deletedAt: null, OR: [{ id: sectionId }, { parentId: sectionId }] },
        data: { deletedAt: new Date(), archiveBatchId: randomUUID() }
      });
      return { id: sectionId };
    });
  }

  async restore(productionId: string, sectionId: string, dto: CompositionRevisionDto, user: RequestUser) {
    return this.mutate(productionId, dto.expectedRevision, user, "section.restored", async (tx) => {
      const section = await tx.performanceSection.findFirst({ where: { id: sectionId, productionId, deletedAt: { not: null } } });
      if (!section) throw new NotFoundException("복원할 구간을 찾을 수 없습니다.");
      await this.assertParent(tx, productionId, section.parentId);
      await tx.performanceSection.updateMany({
        where: { productionId, ...(section.archiveBatchId ? { archiveBatchId: section.archiveBatchId } : { id: sectionId }) },
        // Preserve child-relative offsets when restoring the whole family.
        data: { deletedAt: null, archiveBatchId: null }
      });
      // Only the selected subtree is appended at its new automatic start.
      await tx.performanceSection.update({ where: { id: sectionId }, data: { order: await this.nextOrder(tx, productionId, section.parentId), startMs: null } });
      return { id: sectionId };
    });
  }

  async duplicate(productionId: string, sectionId: string, dto: CompositionRevisionDto, user: RequestUser) {
    return this.mutate(productionId, dto.expectedRevision, user, "section.duplicated", async (tx) => {
      const original = await tx.performanceSection.findFirst({ where: { id: sectionId, productionId, deletedAt: null }, include: SECTION_INCLUDE });
      if (!original) throw new NotFoundException("복제할 구간을 찾을 수 없습니다.");
      const children = await tx.performanceSection.findMany({ where: { productionId, parentId: sectionId, deletedAt: null }, include: SECTION_INCLUDE, orderBy: { order: "asc" } });
      const copy = async (source: typeof original, parentId: string | null, order: number, keepRelativeStart = false) => {
        const { title, kind, scriptText, lyrics, durationMs, backgroundMode, musicMode, scoreMode, sourceScriptId, sourceSceneId } = source;
        return tx.performanceSection.create({ data: {
          productionId, parentId, order, title, kind, scriptText, lyrics, durationMs, backgroundMode, musicMode, scoreMode, sourceScriptId, sourceSceneId,
          startMs: keepRelativeStart ? source.startMs : null,
          media: { create: source.media.map(({ assetId, slot, label, order: mediaOrder, offsetMs, durationMs: mediaDuration, sourceStartMs, page, volume, loop }) =>
            ({ assetId, slot, label, order: mediaOrder, offsetMs, durationMs: mediaDuration, sourceStartMs, page, volume, loop })) }
        } });
      };
      const result = await copy(original, original.parentId, await this.nextOrder(tx, productionId, original.parentId));
      for (const child of children) await copy(child, result.id, child.order, true);
      return { id: result.id };
    });
  }

  async attachReferences(productionId: string, sectionId: string, dto: AttachReferenceFilesDto, user: RequestUser) {
    if (!Array.isArray(dto.assetIds) || !dto.assetIds.length || dto.assetIds.length > 10 || new Set(dto.assetIds).size !== dto.assetIds.length) {
      throw new BadRequestException("참고 첨부는 한 번에 1~10개의 파일을 중복 없이 선택하세요.");
    }
    return this.mutate(productionId, dto.expectedRevision, user, "references.attached", async (tx) => {
      await this.assertSection(tx, productionId, sectionId);
      // Validate every file before linking any. Only this production's stored originals qualify.
      const assets = [];
      for (const assetId of dto.assetIds) {
        const asset = await this.assertAsset(tx, productionId, assetId, "SOURCE");
        if (asset.sizeBytes > 50 * 1024 * 1024) throw new BadRequestException("참고 첨부는 파일당 50MB까지 가능합니다.");
        await this.assets.assertStoredObject(asset);
        assets.push(asset);
      }
      const current = await tx.performanceMedia.findMany({ where: { sectionId, slot: "SOURCE", assetId: { in: dto.assetIds } }, select: { id: true, assetId: true } });
      const linked = new Set(current.map((item) => item.assetId));
      const pending = assets.filter((asset) => !linked.has(asset.id));
      const count = await tx.performanceMedia.count({ where: { sectionId } });
      if (count + pending.length > 200) throw new BadRequestException("구간별 자료는 참고 첨부를 포함해 최대 200개입니다.");
      const maxOrder = await tx.performanceMedia.aggregate({ where: { sectionId }, _max: { order: true } });
      let order = (maxOrder._max.order ?? -1) + 1;
      const ids = current.map((item) => item.id);
      for (const asset of pending) {
        const media = await tx.performanceMedia.create({ data: {
          sectionId, assetId: asset.id, slot: "SOURCE", label: asset.fileName || "참고 첨부파일", order: order++,
          offsetMs: 0, durationMs: null, sourceStartMs: 0, page: 1, volume: 0, loop: false
        }, select: { id: true } });
        ids.push(media.id);
      }
      // SOURCE is reference-only: no background/music/score modes or section duration are changed.
      return { sectionId, ids, addedCount: pending.length };
    });
  }

  async saveMedia(productionId: string, sectionId: string, mediaId: string | null, dto: WriteCompositionMediaDto, user: RequestUser) {
    return this.mutate(productionId, dto.expectedRevision, user, mediaId ? "media.updated" : "media.linked", async (tx) => {
      await this.assertSection(tx, productionId, sectionId);
      const asset = await this.assertAsset(tx, productionId, dto.assetId, dto.slot);
      const current = mediaId ? await tx.performanceMedia.findFirst({ where: { id: mediaId, sectionId } }) : null;
      if (mediaId && !current) throw new NotFoundException("연결 자료를 찾을 수 없습니다.");
      if (current && current.slot !== dto.slot) throw new BadRequestException("자료 종류를 바꾸려면 기존 연결을 해제하고 다시 등록하세요.");
      if (dto.slot === "BACKGROUND" || dto.slot === "MUSIC") {
        const other = await tx.performanceMedia.count({ where: { sectionId, slot: dto.slot, ...(mediaId ? { id: { not: mediaId } } : {}) } });
        if (other) throw new BadRequestException("이 구간의 기존 배경·음악 자료를 수정하거나 교체하세요. 여러 곡은 하위 구간으로 나눌 수 있습니다.");
      }
      if (!mediaId && await tx.performanceMedia.count({ where: { sectionId } }) >= 200) throw new BadRequestException("구간별 자료는 최대 200개입니다.");
      if (asset.mime !== "application/pdf" && (dto.page ?? 1) !== 1) throw new BadRequestException("페이지 번호는 PDF 악보에만 지정할 수 있습니다.");
      const fields = {
        assetId: asset.id, slot: dto.slot, label: dto.label?.trim() || asset.fileName || "공연 자료",
        offsetMs: dto.offsetMs ?? current?.offsetMs ?? 0,
        durationMs: dto.durationMs === undefined ? current?.durationMs ?? null : dto.durationMs,
        sourceStartMs: dto.sourceStartMs ?? current?.sourceStartMs ?? 0,
        page: dto.page ?? current?.page ?? 1, volume: dto.volume ?? current?.volume ?? (dto.slot === "BACKGROUND" ? 0 : 1), loop: dto.loop ?? current?.loop ?? false
      };
      const media = current
        ? await tx.performanceMedia.update({ where: { id: current.id }, data: fields })
        : await tx.performanceMedia.create({ data: { ...fields, sectionId, order: ((await tx.performanceMedia.aggregate({ where: { sectionId }, _max: { order: true } }))._max.order ?? -1) + 1 } });
      if (!mediaId && dto.slot !== "SOURCE") {
        await tx.performanceSection.update({ where: { id: sectionId }, data: { [MODE_FIELD[dto.slot]]: "OWN" } });
      }
      return { id: media.id, sectionId };
    });
  }

  async unlinkMedia(productionId: string, sectionId: string, mediaId: string, dto: CompositionRevisionDto, user: RequestUser) {
    return this.mutate(productionId, dto.expectedRevision, user, "media.unlinked", async (tx) => {
      await this.assertSection(tx, productionId, sectionId);
      const media = await tx.performanceMedia.findFirst({ where: { id: mediaId, sectionId } });
      if (!media) throw new NotFoundException("연결 자료를 찾을 수 없습니다.");
      // Only unlink. Shared Asset records and uploaded originals are never deleted here.
      await tx.performanceMedia.delete({ where: { id: mediaId } });
      return { id: mediaId, sectionId };
    });
  }

  async previewImport(productionId: string, dto: PreviewCompositionImportDto, user: RequestUser) {
    await this.assertAccess(productionId, user, true);
    if ([Boolean(dto.rawText?.trim()), Boolean(dto.assetId), Boolean(dto.scriptId)].filter(Boolean).length !== 1) {
      throw new BadRequestException("직접 입력, 파일, 기존 대본 중 하나를 선택하세요.");
    }
    if (dto.scriptId) {
      const script = await this.prisma.script.findFirst({
        where: { id: dto.scriptId, productionId, deletedAt: null },
        include: { acts: { orderBy: { order: "asc" }, include: { scenes: { orderBy: { order: "asc" }, include: { blocks: { orderBy: { order: "asc" }, include: { character: { select: { name: true } } } } } } } } }
      });
      if (!script) throw new NotFoundException("가져올 대본을 찾을 수 없습니다.");
      const sections: ReviewedSectionDto[] = [];
      const detect = (title: string, fallback: SectionKind): SectionKind => {
        const unit = title.match(/^(?:제\s*)?[0-9]+\s*(장|막)/)?.[1];
        return unit === "장" ? "CHAPTER" : unit === "막" ? "ACT" : fallback;
      };
      for (const act of script.acts) {
        const key = `act-${act.id}`;
        sections.push({ key, parentKey: null, title: act.title, kind: detect(act.title, "ACT"), scriptText: "", lyrics: "", sourceScriptId: script.id });
        for (const scene of act.scenes) {
          const format = (block: typeof scene.blocks[number]) => `${block.character?.name || block.cueLabel ? `${block.character?.name || block.cueLabel}: ` : ""}${block.text}`;
          sections.push({ key: `scene-${scene.id}`, parentKey: key, title: scene.title, kind: detect(scene.title, "SCENE"),
            scriptText: scene.blocks.filter((b) => b.type !== "LYRIC").map(format).join("\n"),
            lyrics: scene.blocks.filter((b) => b.type === "LYRIC").map(format).join("\n"), sourceScriptId: script.id, sourceSceneId: scene.id });
        }
      }
      this.assertImportSize(sections);
      return { sections, warnings: ["기존 대본의 검수용 사본입니다. 원본·일정·주석·기존 큐는 그대로 유지되며, 새 구성과 자동 동기화되지 않습니다. 음악·영상의 구간별 재생 시간은 새 구성에서 지정하세요."] };
    }
    let text = dto.rawText ?? "";
    if (dto.assetId) {
      const asset = await this.assertAsset(this.prisma, productionId, dto.assetId, "SOURCE");
      if (!DOCUMENTS.includes(asset.mime)) throw new BadRequestException("텍스트 추출은 TXT·DOCX·PDF만 가능합니다. 이미지 악보는 구간에 직접 등록하세요.");
      const { body } = await this.assets.readMockObject(asset.id);
      if (asset.mime === "text/plain") text = body.toString("utf8");
      else if (asset.mime === "application/pdf") {
        const { PDFParse } = await import("pdf-parse");
        const parser = new PDFParse({ data: body });
        try { text = (await parser.getText()).text ?? ""; }
        catch { throw new BadRequestException("PDF 텍스트를 읽지 못했습니다. 원본 악보로 등록하거나 대사·가사를 직접 입력하세요."); }
        finally { await parser.destroy(); }
      } else {
        const mammoth = await import("mammoth");
        try { text = (await mammoth.extractRawText({ buffer: body })).value; }
        catch { throw new BadRequestException("DOCX를 읽지 못했습니다. 파일 형식을 확인하거나 내용을 직접 입력하세요."); }
      }
    }
    if (text.length > 200000) throw new BadRequestException("한 번에 가져올 수 있는 텍스트는 20만 자입니다. 장·막별로 나누어 등록하세요.");
    const parsed = parseCompositionText(text);
    this.assertImportSize(parsed.sections);
    return { ...parsed, sourceAssetId: dto.assetId };
  }

  async applyImport(productionId: string, dto: ApplyCompositionImportDto, user: RequestUser) {
    this.assertImportSize(dto.sections);
    if (!dto.sections.length) throw new BadRequestException("반영할 구간이 없습니다.");
    const drafts = new Map(dto.sections.map((s) => [s.key, s]));
    if (drafts.size !== dto.sections.length) throw new BadRequestException("구간 키가 중복되었습니다.");
    for (const section of dto.sections) {
      if (!section.title.trim()) throw new BadRequestException("모든 구간의 제목을 입력하세요.");
      if (section.parentKey) {
        const parent = drafts.get(section.parentKey);
        if (!parent || parent.key === section.key || parent.parentKey) throw new BadRequestException("검수 화면의 상위 구간 연결을 확인하세요. 최대 2단계로 구성합니다.");
      }
    }
    return this.mutate(productionId, dto.expectedRevision, user, "composition.imported", async (tx) => {
      const sourceAsset = dto.sourceAssetId ? await this.assertAsset(tx, productionId, dto.sourceAssetId, "SOURCE") : null;
      const scriptIds = [...new Set(dto.sections.flatMap((s) => s.sourceScriptId ? [s.sourceScriptId] : []))];
      const sceneIds = [...new Set(dto.sections.flatMap((s) => s.sourceSceneId ? [s.sourceSceneId] : []))];
      const validScripts = await tx.script.findMany({ where: { id: { in: scriptIds }, productionId, deletedAt: null }, select: { id: true } });
      const validScenes = await tx.scene.findMany({ where: { id: { in: sceneIds }, act: { script: { productionId, deletedAt: null } } }, select: { id: true, act: { select: { scriptId: true } } } });
      if (validScripts.length !== scriptIds.length || validScenes.length !== sceneIds.length) throw new BadRequestException("이 공연의 대본·장면만 가져올 수 있습니다.");
      const scenes = new Map(validScenes.map((scene) => [scene.id, scene]));
      for (const section of dto.sections) {
        if (section.sourceSceneId && section.sourceScriptId && scenes.get(section.sourceSceneId)?.act.scriptId !== section.sourceScriptId) {
          throw new BadRequestException("원본 장면과 대본의 연결이 일치하지 않습니다.");
        }
      }
      const ids = new Map(dto.sections.map((section) => [section.key, randomUUID()]));
      const roots = dto.sections.filter((s) => !s.parentKey);
      let order = await this.nextOrder(tx, productionId, null);
      for (const root of roots) {
        const family = [root, ...dto.sections.filter((s) => s.parentKey === root.key)];
        for (const [index, section] of family.entries()) {
          const isRoot = index === 0;
          const isScore = sourceAsset && (sourceAsset.mime === "application/pdf" || IMAGES.includes(sourceAsset.mime));
          await tx.performanceSection.create({ data: {
            id: ids.get(section.key)!, productionId, parentId: isRoot ? null : ids.get(root.key)!, order: isRoot ? order++ : index - 1,
            title: section.title.trim(), kind: section.kind, scriptText: section.scriptText, lyrics: section.lyrics,
            sourceScriptId: section.sourceScriptId ?? (section.sourceSceneId ? scenes.get(section.sourceSceneId)?.act.scriptId : null), sourceSceneId: section.sourceSceneId ?? null,
            scoreMode: isRoot && isScore ? "OWN" : "INHERIT",
            ...(isRoot && sourceAsset ? { media: { create: { assetId: sourceAsset.id, slot: isScore ? "SCORE" : "SOURCE", label: sourceAsset.fileName || "가져오기 원본", order: 0 } } } : {})
          } });
        }
      }
      return { ids: [...ids.values()] };
    });
  }

  private assertImportSize(sections: ReviewedSectionDto[]) {
    if (sections.length > 500 || sections.reduce((sum, s) => sum + s.scriptText.length + s.lyrics.length, 0) > 1000000) {
      throw new BadRequestException("한 번에 500개 구간, 총 100만 자 이내로 나누어 등록하세요.");
    }
  }

  private async assertAccess(productionId: string, user: RequestUser, editing = false) {
    const production = await this.prisma.production.findFirst({ where: { id: productionId, deletedAt: null }, select: { id: true, visibility: true } });
    if (!production) throw new NotFoundException("공연을 찾을 수 없습니다.");
    if (await isProductionAdmin(this.prisma, user, productionId)) return true;
    const membership = await this.prisma.membership.findFirst({ where: { productionId, userId: user.id }, select: { roles: { select: { role: true } } } });
    if (!membership || production.visibility !== "PUBLISHED") throw new ForbiddenException("배정된 공개 공연의 자료만 볼 수 있습니다.");
    const canEdit = membership.roles.some(({ role }) => EDIT_ROLES.includes(role));
    if (editing && !canEdit) throw new ForbiddenException("장·막 구성은 운영자·기획자·연출자만 수정할 수 있습니다.");
    return canEdit;
  }

  private async mutate<T extends Record<string, unknown>>(productionId: string, expectedRevision: number, user: RequestUser, action: string, work: (tx: Tx) => Promise<T>) {
    await this.assertAccess(productionId, user, true);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new BadRequestException("현재 구성 버전이 필요합니다.");
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.production.updateMany({ where: { id: productionId, deletedAt: null, compositionRevision: expectedRevision }, data: { compositionRevision: { increment: 1 } } });
      if (locked.count !== 1) throw new ConflictException({ code: "COMPOSITION_CONFLICT", message: "다른 변경이 먼저 저장되었습니다. 입력 내용을 보존한 뒤 새로고침하여 다시 적용하세요." });
      const result = await work(tx);
      this.layout(await this.activeSections(tx, productionId));
      await tx.activityLog.create({ data: { productionId, actorId: user.id, action, entity: "performance_composition", entityId: productionId, afterJson: { revision: expectedRevision + 1 } } });
      return { ...result, revision: expectedRevision + 1 };
    }, { timeout: 20000 });
  }

  private activeSections(tx: Tx, productionId: string) {
    return tx.performanceSection.findMany({ where: { productionId, deletedAt: null }, include: SECTION_INCLUDE, orderBy: [{ order: "asc" }, { id: "asc" }] });
  }
  private layout(sections: Parameters<typeof resolveComposition>[0]) {
    try { return resolveComposition(sections); }
    catch (error) { if (error instanceof CompositionLayoutError) throw new BadRequestException(error.message); throw error; }
  }
  private async assertSection(tx: Tx, productionId: string, id: string) {
    const section = await tx.performanceSection.findFirst({ where: { id, productionId, deletedAt: null } });
    if (!section) throw new NotFoundException("이 공연의 구간을 찾을 수 없습니다.");
    return section;
  }
  private async assertParent(tx: Tx, productionId: string, parentId: string | null, selfId?: string) {
    if (!parentId) return;
    if (parentId === selfId) throw new BadRequestException("자신을 상위 구간으로 선택할 수 없습니다.");
    const parent = await tx.performanceSection.findFirst({ where: { id: parentId, productionId, deletedAt: null, parentId: null }, select: { id: true } });
    if (!parent) throw new BadRequestException("같은 공연의 최상위 구간을 상위 항목으로 선택하세요.");
  }
  private async nextOrder(tx: Tx, productionId: string, parentId: string | null) {
    const result = await tx.performanceSection.aggregate({ where: { productionId, parentId, deletedAt: null }, _max: { order: true } });
    return (result._max.order ?? -1) + 1;
  }
  private async assertAsset(tx: Tx, productionId: string, assetId: string, slot: MediaSlot) {
    const asset = await tx.asset.findFirst({ where: { id: assetId, productionId }, select: ASSET_SELECT });
    if (!asset) throw new BadRequestException("이 공연에 등록된 파일만 연결할 수 있습니다.");
    const allowed = slot === "SCORE" ? [...IMAGES, "application/pdf"] : slot === "BACKGROUND" ? [...IMAGES, ...VIDEO] : slot === "MUSIC" ? AUDIO : [...IMAGES, ...DOCUMENTS];
    if (!allowed.includes(asset.mime)) throw new BadRequestException("선택한 자료 종류와 파일 형식이 맞지 않습니다. 악보는 PDF·이미지, 음악은 음원, 배경은 영상·이미지를 선택하세요.");
    return asset;
  }
}
