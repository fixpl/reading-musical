import type { PrismaService } from "../../prisma/prisma.service";
import type { RequestUser } from "../types/request-user";

/**
 * 플랫폼 운영자(관리자) 여부 — 조직 스코프는 보지 않는 빠른 판별.
 * 컨트롤러 가드가 이미 통과시킨 요청의 서비스 레벨 분기용으로만 쓰고,
 * 실제 접근 허용은 공연 조직까지 확인하는 isProductionAdmin을 쓴다.
 */
export function isPlatformAdmin(user: RequestUser): boolean {
  return user.platformRole === "SUPER_ADMIN" || user.platformRole === "ORG_ADMIN";
}

/**
 * 이 공연에 대해 관리자 전권을 갖는가.
 * - SUPER_ADMIN: 모든 공연에 대해 항상 true (전역 운영자)
 * - ORG_ADMIN: 공연이 자신의 조직에 속할 때만 true (조직 운영자)
 * - 그 외(MEMBER): false → 호출부가 공연 멤버십 검사로 폴백
 *
 * 운영자는 공연 멤버로 지정돼 있지 않아도 워크스페이스 전 기능(멤버 지정·일정·큐시트 등)을
 * 쓸 수 있어야 한다는 정책을 한곳에서 보장한다.
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
  return Boolean(production && dbUser && production.organizationId === dbUser.organizationId);
}
