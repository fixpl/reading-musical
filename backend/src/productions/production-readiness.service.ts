import { Injectable, NotFoundException } from "@nestjs/common";
import type { RequestUser } from "../common/types/request-user";
import { PrismaService } from "../prisma/prisma.service";
import { ProductionAccessService } from "./production-access.service";
import { computeProductionReadiness } from "./production-readiness.calculator";

/** 공개 준비 점검 조회 — 데이터 조회만 담당, 계산은 production-readiness.calculator.ts로 분리. */
@Injectable()
export class ProductionReadinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProductionAccessService
  ) {}

  async getReadiness(productionId: string, user: RequestUser) {
    await this.access.getAccess(productionId, user);
    const production = await this.prisma.production.findUnique({
      where: { id: productionId },
      include: {
        memberships: { include: { roles: true, staffAssignments: true } },
        scripts: {
          select: {
            id: true,
            versions: { select: { id: true }, take: 1 },
            acts: {
              select: {
                scenes: {
                  select: {
                    blocks: { select: { id: true } }
                  }
                }
              }
            }
          }
        },
        musicCues: { select: { id: true, anchorStatus: true } },
        events: { include: { attendances: { select: { status: true } } } },
        runSheets: { select: { id: true, status: true } },
        checklistPhases: { include: { items: { select: { id: true, status: true } } } }
      }
    });
    if (!production) {
      throw new NotFoundException("찾을 수 없어요");
    }

    return computeProductionReadiness(productionId, production);
  }
}
