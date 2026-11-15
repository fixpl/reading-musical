import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PATH_METADATA } from "@nestjs/common/constants";
import { ALLOW_DELETED_PRODUCTION } from "../decorators/allow-deleted-production.decorator";
import type { PlatformRole, ProductionRole } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { ERR_FORBIDDEN_DEFAULT } from "../constants/error-messages";
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

    const request = context.switchToHttp().getRequest<RequestLike>();
    const controllerPath = this.reflector.get<string>(PATH_METADATA, context.getClass());
    const scopedId = request.params?.productionId ?? request.params?.pid
      ?? ((controllerPath === "productions" || productionRoles?.length) ? request.params?.id : undefined);
    const allowDeleted = this.reflector.getAllAndOverride<boolean>(ALLOW_DELETED_PRODUCTION, [context.getHandler(), context.getClass()]);
    if (scopedId && !allowDeleted) {
      const production = await this.prisma.production.findUnique({ where: { id: scopedId }, select: { deletedAt: true } });
      if (production?.deletedAt) throw new NotFoundException("공연을 찾을 수 없습니다.");
    }

    if (!platformRoles?.length && !productionRoles?.length) {
      return true;
    }

    const user = request.user;
    if (!user) {
      throw new ForbiddenException(ERR_FORBIDDEN_DEFAULT);
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
        if (caller?.organizationId && production?.organizationId === caller.organizationId) return true;
        // 타 조직에서는 전역 운영자 등급 대신 이 공연에 배정된 역할만 검사한다.
      } else {
        return true;
      }
    }

    if (!productionRoles?.length) {
      throw new ForbiddenException(ERR_FORBIDDEN_DEFAULT);
    }

    const productionId = this.getProductionId(request);
    if (!productionId) {
      throw new ForbiddenException(ERR_FORBIDDEN_DEFAULT);
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
      throw new ForbiddenException(ERR_FORBIDDEN_DEFAULT);
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
