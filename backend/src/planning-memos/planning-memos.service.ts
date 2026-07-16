import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestUser } from "../common/types/request-user";
import { CreatePlanningMemoDto, UpdatePlanningMemoDto } from "./dto";
import { isPlatformAdmin } from "../common/access/is-production-admin";

const MEMO_INCLUDE = {
  author: { select: { id: true, name: true } },
  inquiry: { select: { id: true, orgName: true, status: true } }
} satisfies Prisma.PlanningMemoInclude;

@Injectable()
export class PlanningMemosService {
  constructor(private readonly prisma: PrismaService) {}

  async list(productionId: string) {
    return this.prisma.planningMemo.findMany({
      where: { productionId },
      orderBy: { createdAt: "desc" },
      include: MEMO_INCLUDE
    });
  }

  async create(productionId: string, dto: CreatePlanningMemoDto, user: RequestUser) {
    const production = await this.prisma.production.findUnique({
      where: { id: productionId },
      select: { id: true }
    });
    if (!production) {
      throw new NotFoundException("공연을 찾을 수 없습니다");
    }

    return this.prisma.planningMemo.create({
      data: {
        productionId,
        authorId: user.id,
        body: dto.body.trim(),
        inquiryId: dto.inquiryId ?? null
      },
      include: MEMO_INCLUDE
    });
  }

  async update(productionId: string, memoId: string, dto: UpdatePlanningMemoDto, user: RequestUser) {
    const memo = await this.findOrThrow(productionId, memoId);
    this.assertCanModify(memo.authorId, user);

    return this.prisma.planningMemo.update({
      where: { id: memo.id },
      data: { body: dto.body.trim() },
      include: MEMO_INCLUDE
    });
  }

  async remove(productionId: string, memoId: string, user: RequestUser) {
    const memo = await this.findOrThrow(productionId, memoId);
    this.assertCanModify(memo.authorId, user);

    await this.prisma.planningMemo.delete({ where: { id: memo.id } });
    return { ok: true };
  }

  private async findOrThrow(productionId: string, memoId: string) {
    const memo = await this.prisma.planningMemo.findFirst({
      where: { id: memoId, productionId }
    });
    if (!memo) {
      throw new NotFoundException("메모를 찾을 수 없습니다");
    }
    return memo;
  }

  private assertCanModify(authorId: string, user: RequestUser) {
    if (authorId !== user.id && !isPlatformAdmin(user)) {
      throw new ForbiddenException("작성자만 수정하거나 삭제할 수 있습니다");
    }
  }
}
