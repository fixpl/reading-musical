import type { PrismaService } from "../../prisma/prisma.service";
import type { RequestUser } from "../types/request-user";

/**
 * 공연 조직까지 확인한 관리자 권한을 반환한다. false이면 공연별 역할을 별도로 검사한다.
 * 타 조직 ORG_ADMIN의 배정 역할을 관리자 전권으로 확대하지 않는다.
 * 삭제 공연·사용자 활성 상태는 호출부의 접근 검증에서 확인한다.
 */
export async function isProductionAdmin(
  prisma: PrismaService,
  user: RequestUser,
  productionId: string
): Promise<boolean> {
  if (user.platformRole === "SUPER_ADMIN") {
    return true;
  }
  if (user.platformRole !== "ORG_ADMIN") {
    return false;
  }
  const [production, dbUser] = await Promise.all([
    prisma.production.findUnique({ where: { id: productionId }, select: { organizationId: true } }),
    prisma.user.findUnique({ where: { id: user.id }, select: { organizationId: true } })
  ]);
  return Boolean(dbUser?.organizationId && production?.organizationId === dbUser.organizationId);
}
