import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { PlatformRole, ProductionRole } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { PLATFORM_ROLES_KEY } from "../decorators/platform-roles.decorator";
import { PRODUCTION_ROLES_KEY } from "../decorators/production-roles.decorator";
import type { RequestUser } from "../types/request-user";

type RequestLike = {
  user?: RequestUser;
  params: Record<string, string | undefined>;
  body?: Record<string, unknown>;
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const platformRoles = this.reflector.getAllAndOverride<PlatformRole[]>(PLATFORM_ROLES_KEY, [
      context.getHandler(),
      context.getClass()
    ]);
    const productionRoles = this.reflector.getAllAndOverride<ProductionRole[]>(PRODUCTION_ROLES_KEY, [
      context.getHandler(),
      context.getClass()
    ]);

    if (!platformRoles?.length && !productionRoles?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestLike>();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException("이 작업을 할 권한이 없어요");
    }

    if (platformRoles?.includes(user.platformRole)) {
      // A platform role is not a cross-organization production grant.
      // Only production-scoped handlers have productionRoles metadata; an
      // /admin/users/:id parameter must never be treated as a production ID.
      if (user.platformRole === "ORG_ADMIN" && productionRoles?.length) {
        const productionId = this.getProductionId(request);
        if (!productionId) throw new ForbiddenException("공연을 확인할 수 없습니다");
        const [production, caller] = await Promise.all([
          this.prisma.production.findUnique({ where: { id: productionId }, select: { organizationId: true } }),
          this.prisma.user.findUnique({ where: { id: user.id }, select: { organizationId: true } })
        ]);
        if (!caller?.organizationId || production?.organizationId !== caller.organizationId) {
          throw new ForbiddenException("소속 조직의 공연만 관리할 수 있습니다");
        }
      }
      return true;
    }

    if (!productionRoles?.length) {
      throw new ForbiddenException("이 작업을 할 권한이 없어요");
    }

    const productionId = this.getProductionId(request);
    if (!productionId) {
      throw new ForbiddenException("이 작업을 할 권한이 없어요");
    }

    const membership = await this.prisma.membership.findFirst({
      where: {
        userId: user.id,
        productionId,
        roles: { some: { role: { in: productionRoles } } }
      },
      select: { id: true }
    });

    if (!membership) {
      throw new ForbiddenException("이 작업을 할 권한이 없어요");
    }

    return true;
  }

  private getProductionId(request: RequestLike): string | null {
    const params = request.params ?? {};
    const body = request.body ?? {};
    const bodyProductionId = typeof body.productionId === "string" ? body.productionId : undefined;
    return params.pid ?? params.productionId ?? params.id ?? bodyProductionId ?? null;
  }
}
