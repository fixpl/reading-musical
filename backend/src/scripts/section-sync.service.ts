import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { AnchorStatus, Prisma, SceneBlockType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { estimateLineMs } from "./duration-estimate";
import { blocksToText, planSync, sameText, textToLines, type BlockLike, type ParsedLine } from "./section-text";

type Db = Prisma.TransactionClient | PrismaService;
export type SyncState = "SYNCED" | "DIVERGED";
type SyncSnapshot = { id: string; sourceSceneId: string | null; scriptText: string; lyrics: string };

const BLOCK_SELECT = { id: true, order: true, type: true, text: true, characterId: true, cueLabel: true, character: { select: { name: true } } } as const;
function toBlockLike(row: { id: string; order: number; type: string; text: string; characterId: string | null; cueLabel: string | null; character: { name: string } | null }): BlockLike {
  return { id: row.id, order: row.order, type: row.type, text: row.text, characterId: row.characterId, characterName: row.character?.name ?? null, cueLabel: row.cueLabel };
}

/**
 * 큐시트(대본 장면의 줄)와 장·막 구성(구간 텍스트)을 같은 글로 유지한다.
 * - 한쪽을 고칠 때 두 쪽이 같은 상태였다면 다른 쪽도 자동으로 따라간다.
 * - 이미 달라진 상태(DIVERGED)는 자동으로 덮어쓰지 않고, 사용자가 방향을 골라 맞춘다.
 */
@Injectable()
export class SectionSyncService {
  private readonly logger = new Logger(SectionSyncService.name);
  constructor(private readonly prisma: PrismaService) {}

  /** 구간별 상태. 장면과 연결되지 않은 구간은 포함하지 않는다. */
  async states(db: Db, sections: Array<{ id: string; sourceSceneId: string | null; scriptText: string; lyrics: string }>): Promise<Map<string, SyncState>> {
    const linked = sections.filter((section) => section.sourceSceneId);
    const result = new Map<string, SyncState>();
    if (!linked.length) return result;
    const rows = await db.sceneBlock.findMany({ where: { sceneId: { in: [...new Set(linked.map((s) => s.sourceSceneId!))] } }, select: { ...BLOCK_SELECT, sceneId: true } });
    const byScene = new Map<string, BlockLike[]>();
    for (const row of rows) byScene.set(row.sceneId, [...(byScene.get(row.sceneId) ?? []), toBlockLike(row)]);
    for (const section of linked) {
      const blocks = byScene.get(section.sourceSceneId!) ?? [];
      result.set(section.id, sameText(section, blocksToText(blocks)) ? "SYNCED" : "DIVERGED");
    }
    return result;
  }

  /** 편집 전 같은 글이었던 구간의 값까지 보존한다. ID만 기억하면 동시 편집을 덮어쓸 수 있다. */
  async syncedSections(productionId: string, sceneId: string): Promise<SyncSnapshot[]> {
    const sections = await this.prisma.performanceSection.findMany({ where: { productionId, sourceSceneId: sceneId, deletedAt: null }, select: { id: true, sourceSceneId: true, scriptText: true, lyrics: true } });
    const states = await this.states(this.prisma, sections);
    return sections.filter((section) => states.get(section.id) === "SYNCED");
  }

  /** 장면 블록의 현재 글을 (고치기 전에 같은 글이었던) 구간들에 반영한다. 반영한 구간 수를 돌려준다. */
  async pullSections(productionId: string, sceneId: string, snapshots: SyncSnapshot[]): Promise<number> {
    if (!snapshots.length) return 0;
    return this.prisma.$transaction(async (tx) => {
      // 구성 저장과 같은 잠금 순서(공연 → 구간)를 지킨다.
      await tx.production.update({ where: { id: productionId }, data: { compositionRevision: { increment: 0 } } });
      const blocks = (await tx.sceneBlock.findMany({ where: { sceneId }, select: BLOCK_SELECT })).map(toBlockLike);
      const text = blocksToText(blocks);
      let count = 0;
      for (const before of snapshots) {
        const updated = await tx.performanceSection.updateMany({
          where: { id: before.id, productionId, sourceSceneId: sceneId, deletedAt: null, scriptText: before.scriptText, lyrics: before.lyrics },
          data: { scriptText: text.scriptText, lyrics: text.lyrics }
        });
        count += updated.count;
      }
      if (count) await tx.production.update({ where: { id: productionId }, data: { compositionRevision: { increment: 1 } } });
      if (count < snapshots.length) this.logger.warn("다른 사용자가 구간 글을 수정하여 자동 동기화를 건너뛰었습니다. 두 글을 확인하여 직접 맞추세요.");
      return count;
    });
  }

  /** 대본 줄을 만들거나 고치는 작업 앞뒤로 구간 글을 같이 맞춘다. 맞추기에 실패해도 본 작업은 실패시키지 않는다. */
  async keepInSync<T>(productionId: string, sceneId: string, work: () => Promise<T>): Promise<T> {
    let before: SyncSnapshot[] = [];
    try { before = await this.syncedSections(productionId, sceneId); }
    catch (error) { this.logger.warn(`구간 동기화 상태 확인 실패: ${error instanceof Error ? error.message : error}`); }
    const result = await work();
    if (before.length) {
      try { await this.pullSections(productionId, sceneId, before); }
      catch (error) { this.logger.warn(`구간 글 갱신 실패: ${error instanceof Error ? error.message : error}`); }
    }
    return result;
  }

  async isSectionSynced(productionId: string, sectionId: string): Promise<boolean> {
    const section = await this.prisma.performanceSection.findFirst({ where: { id: sectionId, productionId, deletedAt: null }, select: { id: true, sourceSceneId: true, scriptText: true, lyrics: true } });
    if (!section?.sourceSceneId) return false;
    return (await this.states(this.prisma, [section])).get(section.id) === "SYNCED";
  }

  /** 대본 → 구간: 구간의 글을 장면 블록의 글로 바꾼다(구성 revision은 호출한 쪽에서 올린다). */
  async pull(tx: Prisma.TransactionClient, productionId: string, sectionId: string): Promise<{ changed: boolean }> {
    const section = await this.linkedSection(tx, productionId, sectionId);
    const blocks = (await tx.sceneBlock.findMany({ where: { sceneId: section.sourceSceneId! }, select: BLOCK_SELECT })).map(toBlockLike);
    const text = blocksToText(blocks);
    const changed = !sameText(section, text);
    if (changed) await tx.performanceSection.update({ where: { id: sectionId }, data: { scriptText: text.scriptText, lyrics: text.lyrics } });
    return { changed };
  }

  /**
   * 구간 → 대본: 장면 블록을 구간의 글에 맞춘다. 그대로인 줄은 같은 블록으로 남겨 시간·주석·음악 큐 연결을 지키고,
   * 사라진 줄만 지운다(그 줄에 걸린 주석·음악 큐는 "연결 끊김"으로 표시). 끝나면 구간 글도 같은 표기로 정리한다.
   */
  async push(tx: Prisma.TransactionClient, productionId: string, sectionId: string): Promise<{ created: number; updated: number; deleted: number }> {
    const section = await this.linkedSection(tx, productionId, sectionId);
    const sceneId = section.sourceSceneId!;
    const [rows, roles] = await Promise.all([
      tx.sceneBlock.findMany({ where: { sceneId }, select: BLOCK_SELECT }),
      tx.role.findMany({ where: { productionId }, select: { id: true, name: true } })
    ]);
    const roleByName = new Map(roles.map((role) => [role.name, role.id]));
    // 등록된 배역 이름만 화자로 읽는다. "배경 영상: …"처럼 모르는 접두는 본문으로 두어 엉뚱한 배역이 생기지 않게 한다.
    const lines: ParsedLine[] = textToLines(section.scriptText, section.lyrics).map((line) =>
      line.names.every((name) => roleByName.has(name)) ? line : { ...line, names: [], text: `${line.names.join("·")}: ${line.text}` });
    const plan = planSync(rows.map(toBlockLike), lines);

    const resolve = (names: string[]) => names.length
      ? { characterId: roleByName.get(names[0])!, cueLabel: names.length > 1 ? names.join("·") : null }
      : { characterId: null, cueLabel: null };
    let created = 0, updated = 0;
    for (const block of plan.deleted) {
      await tx.annotation.updateMany({ where: { anchorBlockId: block.id }, data: { anchorBlockId: null, anchorStatus: AnchorStatus.BROKEN } });
      await tx.musicCue.updateMany({ where: { anchorBlockId: block.id }, data: { anchorBlockId: null, anchorStatus: AnchorStatus.BROKEN } });
      await tx.sceneBlock.delete({ where: { id: block.id } });
    }
    for (const [index, entry] of plan.entries.entries()) {
      const order = index + 1;
      if (entry.kind === "keep") {
        if (entry.block.order !== order) await tx.sceneBlock.update({ where: { id: entry.block.id }, data: { order } });
        continue;
      }
      const { characterId, cueLabel } = resolve(entry.line.names);
      const type = entry.line.type as SceneBlockType;
      if (entry.kind === "update") {
        // 종류가 바뀌어도 시간(startMs·durationMs)은 그대로 둔다.
        await tx.sceneBlock.update({ where: { id: entry.block.id }, data: { order, type, text: entry.line.text, characterId, cueLabel } });
        updated += 1;
      } else {
        await tx.sceneBlock.create({ data: { sceneId, order, type, text: entry.line.text, characterId, cueLabel, durationMs: entry.line.type === "NOTE" ? 1 : estimateLineMs(entry.line.type, entry.line.text) } });
        created += 1;
      }
    }
    // 구간 글도 같은 표기로 정리한다("(조명)"처럼 직접 쓴 지문 → "[ 조명 ]").
    const after = (await tx.sceneBlock.findMany({ where: { sceneId }, select: BLOCK_SELECT })).map(toBlockLike);
    const canonical = blocksToText(after);
    if (canonical.scriptText !== section.scriptText || canonical.lyrics !== section.lyrics) {
      await tx.performanceSection.update({ where: { id: sectionId }, data: { scriptText: canonical.scriptText, lyrics: canonical.lyrics } });
    }
    return { created, updated, deleted: plan.deleted.length };
  }

  private async linkedSection(tx: Db, productionId: string, sectionId: string) {
    const section = await tx.performanceSection.findFirst({ where: { id: sectionId, productionId, deletedAt: null }, select: { id: true, sourceSceneId: true, scriptText: true, lyrics: true } });
    if (!section) throw new NotFoundException("구간을 찾을 수 없습니다.");
    if (!section.sourceSceneId) throw new BadRequestException("대본 장면과 연결되지 않은 구간입니다. 대본 등록으로 만든 구간만 동기화할 수 있습니다.");
    const scene = await tx.scene.findFirst({ where: { id: section.sourceSceneId, act: { script: { productionId, deletedAt: null } } }, select: { id: true } });
    if (!scene) throw new BadRequestException("연결된 대본 장면을 찾을 수 없습니다.");
    return section;
  }
}
