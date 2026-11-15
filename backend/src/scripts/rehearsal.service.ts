import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { isProductionAdmin } from "../common/access/is-production-admin";
import type { RequestUser } from "../common/types/request-user";
import { PrismaService } from "../prisma/prisma.service";
import { SaveRehearsalDto } from "./rehearsal.dto";

@Injectable()
export class RehearsalService {
  constructor(private readonly prisma: PrismaService) {}

  async list(productionId: string, user: RequestUser) {
    await this.assertAccess(productionId, user);
    return this.prisma.personalRehearsal.findMany({ where: { productionId, userId: user.id } });
  }

  async save(productionId: string, dto: SaveRehearsalDto, user: RequestUser) {
    await this.assertAccess(productionId, user);
    const composition = dto.source === "composition";
    if (!composition && !await this.prisma.script.findFirst({ where: { id: dto.source, productionId, deletedAt: null }, select: { id: true } })) {
      throw new BadRequestException("이 공연의 연습 대본을 선택하세요.");
    }
    const [sections, scenes, cues] = await Promise.all([
      composition ? this.prisma.performanceSection.findMany({ where: { productionId }, select: { id: true } }) : [],
      composition ? [] : this.prisma.scene.findMany({ where: { act: { scriptId: dto.source, script: { deletedAt: null } } }, select: { id: true } }),
      this.prisma.trackCue.findMany({ where: { productionId }, select: { id: true } })
    ]);
    const allowed = new Set(["overview", ...sections.map((s) => `section:${s.id}`), ...scenes.map((s) => `scene:${s.id}`), ...cues.map((c) => `cue:${c.id}`)]);
    const noteEntries = Object.entries(dto.notes);
    if (noteEntries.length > 2000 || dto.completedKeys.some((key) => !allowed.has(key)) || noteEntries.some(([key, value]) => !allowed.has(key) || typeof value !== "string" || value.length > 5000) || noteEntries.reduce((size, [, value]) => size + value.length, 0) > 200000) {
      throw new BadRequestException("현재 공연의 구간별 메모만 저장할 수 있습니다. 메모는 구간당 5,000자, 총 20만 자 이내로 입력하세요.");
    }
    const identity = { userId: user.id, productionId, source: dto.source };
    const data = { positionMs: dto.positionMs, completedKeys: dto.completedKeys, notes: dto.notes as Prisma.InputJsonObject };
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.personalRehearsal.findUnique({ where: { userId_productionId_source: identity } });
        if (!existing) {
          if (dto.expectedRevision !== 0) throw this.conflict();
          return tx.personalRehearsal.create({ data: { ...identity, ...data, revision: 1 } });
        }
        const result = await tx.personalRehearsal.updateMany({ where: { id: existing.id, userId: user.id, revision: dto.expectedRevision }, data: { ...data, revision: { increment: 1 } } });
        if (result.count !== 1) throw this.conflict();
        return tx.personalRehearsal.findUniqueOrThrow({ where: { id: existing.id } });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw this.conflict();
      throw error;
    }
  }

  private conflict() { return new ConflictException("다른 기기에서 연습 기록이 변경되었습니다. 메모를 복사한 뒤 최신 기록을 불러오세요."); }

  private async assertAccess(productionId: string, user: RequestUser) {
    const production = await this.prisma.production.findFirst({ where: { id: productionId, deletedAt: null }, select: { id: true } });
    if (!production) throw new NotFoundException("공연을 찾을 수 없습니다.");
    if (await isProductionAdmin(this.prisma, user, productionId)) return;
    if (!await this.prisma.membership.findUnique({ where: { userId_productionId: { userId: user.id, productionId } }, select: { id: true } })) {
      throw new ForbiddenException("배정된 공연에서만 연습할 수 있습니다.");
    }
  }
}
