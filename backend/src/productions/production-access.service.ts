import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PlatformRole, Prisma, ProductionRole } from "@prisma/client";
import type { RequestUser } from "../common/types/request-user";
import { isProductionAdmin } from "../common/access/is-production-admin";
import { PrismaService } from "../prisma/prisma.service";

const PEOPLE_SENSITIVE_ROLES: readonly ProductionRole[] = [
  ProductionRole.PRODUCER,
  ProductionRole.DIRECTOR,
  ProductionRole.STAGE_MANAGER
];

export type ProductionAccess = Awaited<ReturnType<ProductionAccessService["getAccess"]>>;

/**
 * productions 모듈에서 반복되던 "이 공연에 대한 내 권한은 무엇인가" 판별과
 * 그 판별이 쓰는 공통 include 모양을 한곳에 모은다.
 * position-requirements / staff-assignments / readiness / members / directory
 * 서비스가 모두 이 서비스에 의존한다.
 */
@Injectable()
export class ProductionAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async getAccess(productionId: string, user: RequestUser) {
    const production = await this.prisma.production.findUnique({
      where: { id: productionId },
      select: { id: true, title: true, organizationId: true }
    });
    if (!production) {
      throw new NotFoundException("찾을 수 없어요");
    }

    if (user.platformRole === PlatformRole.SUPER_ADMIN) {
      return { production, viewerMembership: null, canViewSensitive: true };
    }

    const [dbUser, membership] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: user.id },
        select: { organizationId: true }
      }),
      this.prisma.membership.findUnique({
        where: { userId_productionId: { userId: user.id, productionId } },
        include: { roles: { select: { role: true } } }
      })
    ]);

    if (user.platformRole === PlatformRole.ORG_ADMIN && dbUser?.organizationId === production.organizationId) {
      return { production, viewerMembership: membership, canViewSensitive: true };
    }

    if (!membership) {
      throw new NotFoundException("찾을 수 없어요");
    }

    const canViewSensitive = membership.roles.some((role) => PEOPLE_SENSITIVE_ROLES.includes(role.role));
    return { production, viewerMembership: membership, canViewSensitive };
  }

  async assertMemberOrAdmin(productionId: string, user: RequestUser): Promise<void> {
    await this.getAccess(productionId, user);
  }

  /** 멤버 지정·수정·삭제 권한: 운영자(SUPER_ADMIN 전역 / ORG_ADMIN 소속 조직) 또는 그 공연의 기획자. */
  async assertCanManageMembers(productionId: string, user: RequestUser): Promise<void> {
    if (await isProductionAdmin(this.prisma, user, productionId)) {
      return;
    }
    const membership = await this.prisma.membership.findFirst({
      where: { productionId, userId: user.id, roles: { some: { role: ProductionRole.PRODUCER } } },
      select: { id: true }
    });
    if (!membership) {
      throw new ForbiddenException("멤버를 관리할 권한이 없어요");
    }
  }

  async assertProducerRemains(
    tx: Prisma.TransactionClient,
    productionId: string,
    membershipId: string,
    nextRoles: ProductionRole[]
  ): Promise<void> {
    if (nextRoles.includes(ProductionRole.PRODUCER)) {
      return;
    }
    const anotherProducer = await tx.membershipRole.findFirst({
      where: {
        role: ProductionRole.PRODUCER,
        membership: {
          productionId,
          id: { not: membershipId }
        }
      },
      select: { id: true }
    });
    if (!anotherProducer) {
      throw new BadRequestException("마지막 기획자 권한은 해제할 수 없어요");
    }
  }

  productionListInclude(): Prisma.ProductionInclude {
    return {
      organization: { select: { id: true, name: true } },
      positionRequirements: true,
      memberships: { select: { id: true } },
      scripts: { select: { id: true } },
      musicCues: { select: { id: true, anchorStatus: true } },
      events: { select: { id: true } },
      runSheets: { select: { id: true, status: true } },
      checklistPhases: { include: { items: true } }
    };
  }

  memberInclude(): Prisma.MembershipInclude {
    return {
      user: { select: { id: true, email: true, name: true, phone: true, profileType: true, profileDetails: true, profileComplete: true } },
      roles: { select: { role: true } },
      staffAssignments: true
    };
  }
}
