import { CanActivate, ConflictException, ExecutionContext, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

// Additional read-only preconditions. Existing authorization and mutation stay in their services.
@Injectable()
export class NoRunningReadingGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ params: { id?: string } }>();
    const id = request.params.id;
    if (!id) throw new NotFoundException("공연을 찾을 수 없습니다.");
    const count = await this.prisma.readingSession.count({ where: { productionId: id, startedAt: { not: null }, endedAt: null } });
    if (count) throw new ConflictException("진행 중인 리딩을 종료한 뒤 휴지통으로 이동해 주세요.");
    return true;
  }
}

@Injectable()
export class ActiveInvitationProductionGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ params: { token?: string } }>();
    if (!request.params.token) throw new NotFoundException("초대 정보를 확인할 수 없습니다.");
    const invitation = await this.prisma.invitation.findUnique({ where: { token: request.params.token }, select: { production: { select: { deletedAt: true, archived: true } } } });
    if (!invitation || invitation.production.deletedAt || invitation.production.archived) throw new NotFoundException("초대 정보를 확인할 수 없습니다.");
    return true;
  }
}
