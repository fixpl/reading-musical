import { ForbiddenException } from "@nestjs/common";
import type { Prisma, ProductionRole } from "@prisma/client";
import type { PrismaService } from "../../prisma/prisma.service";
import type { RequestUser } from "../types/request-user";
import { ERR_FORBIDDEN_DEFAULT } from "../constants/error-messages";
import { isProductionAdmin } from "./is-production-admin";

/**
 * 공연 멤버십 + 역할 검사의 공통 본체.
 * 운영자(SUPER_ADMIN/소속 조직 ORG_ADMIN)는 멤버십 없이도 통과하고,
 * 그 외에는 지정된 역할을 가진 멤버십이 있어야 한다.
 * 9개 모듈(assets/casting/checklist/music/reading-sessions/run-sheets/
 * schedule/scripts/stage)에 거의 동일하게 중복돼 있던 private assertMembership들을
 * 이 함수로 통합한다. include/select는 호출부 타입에 맞춰 그대로 전달한다.
 */
export async function assertProductionMembership<T extends Prisma.MembershipInclude>(
  prisma: PrismaService,
  user: RequestUser,
  productionId: string,
  roles: ProductionRole[],
  options: { include: T; forbiddenMessage?: string }
): Promise<Prisma.MembershipGetPayload<{ include: T }> | null>;
export async function assertProductionMembership<T extends Prisma.MembershipSelect>(
  prisma: PrismaService,
  user: RequestUser,
  productionId: string,
  roles: ProductionRole[],
  options: { select: T; forbiddenMessage?: string }
): Promise<Prisma.MembershipGetPayload<{ select: T }> | null>;
export async function assertProductionMembership(
  prisma: PrismaService,
  user: RequestUser,
  productionId: string,
  roles: ProductionRole[],
  options?: { forbiddenMessage?: string }
): Promise<{ id: string } | null>;
export async function assertProductionMembership(
  prisma: PrismaService,
  user: RequestUser,
  productionId: string,
  roles: ProductionRole[],
  options: {
    include?: Prisma.MembershipInclude;
    select?: Prisma.MembershipSelect;
    forbiddenMessage?: string;
  } = {}
): Promise<unknown> {
  if (await isProductionAdmin(prisma, user, productionId)) {
    return null;
  }
  const membership = await prisma.membership.findFirst({
    where: { productionId, userId: user.id, roles: { some: { role: { in: roles } } } },
    ...(options.include ? { include: options.include } : {}),
    ...(options.select ? { select: options.select } : {})
  });
  if (!membership) {
    throw new ForbiddenException(options.forbiddenMessage ?? ERR_FORBIDDEN_DEFAULT);
  }
  return membership;
}
