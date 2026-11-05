import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export type ProductionActivityLogEntry = {
  productionId: string;
  organizationId: string;
  actorId: string;
  action: string;
  entity: string;
  entityId: string;
  reason: string;
  beforeJson?: Prisma.InputJsonValue;
  afterJson?: Prisma.InputJsonValue;
};

/** 공연 범위 활동 로그 기록 — 트랜잭션 밖에서 단발로 남기는 로그 전용(트랜잭션 내부는 tx.activityLog.create를 직접 쓴다). */
@Injectable()
export class ProductionActivityLogService {
  constructor(private readonly prisma: PrismaService) {}

  async log(data: ProductionActivityLogEntry): Promise<void> {
    await this.prisma.activityLog.create({ data });
  }
}
