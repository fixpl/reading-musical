import { Controller, Get, Header, NotFoundException, Param, ParseUUIDPipe, UseGuards } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { PlatformRoles } from "../common/decorators/platform-roles.decorator";

// Read-only inspection. This endpoint never mutates a production or removes a file.
@Controller("admin/productions")
@UseGuards(JwtAuthGuard, RolesGuard)
@PlatformRoles("SUPER_ADMIN")
export class ProductionDeletionImpactController {
  constructor(private readonly prisma: PrismaService) {}
  @Get(":id/deletion-impact") @Header("Cache-Control", "no-store")
  async impact(@Param("id", ParseUUIDPipe) id: string) {
    const [production, members, futureEvents, liveSessions, fileBytes, inquiries] = await Promise.all([
      this.prisma.production.findUnique({ where: { id }, select: { id: true, title: true, visibility: true, deletedAt: true, archived: true,
        _count: { select: { scripts: true, sections: true, trackCues: true, musicCues: true, boardPosts: true, assets: true, invitations: true, events: true, personalRehearsals: true, planningMemos: true } } } }),
      this.prisma.membership.findMany({ where: { productionId: id }, select: { id: true, primaryRole: true, roles: { select: { role: true } } } }),
      this.prisma.scheduleEvent.count({ where: { productionId: id, endAt: { gt: new Date() } } }),
      this.prisma.readingSession.count({ where: { productionId: id, startedAt: { not: null }, endedAt: null } }),
      this.prisma.asset.aggregate({ where: { productionId: id }, _sum: { sizeBytes: true } }),
      this.prisma.inquiry.findMany({ where: { productionId: id }, select: { id: true, orgName: true, status: true }, take: 100 })
    ]);
    if (!production) throw new NotFoundException("공연을 찾을 수 없습니다.");
    const has = (member: typeof members[number], role: "ACTOR" | "STAFF") => member.primaryRole === role || member.roles.some((item) => item.role === role);
    return { ...production, counts: { ...production._count, members: members.length, actors: members.filter((item) => has(item, "ACTOR")).length,
      staff: members.filter((item) => has(item, "STAFF")).length, fileBytes: fileBytes._sum.sizeBytes ?? 0, inquiries: inquiries.length },
      futureEvents, liveSessions, inquiries,
      guidance: { accountsPreserved: true, assignmentsPreservedInTrash: true, trashIsReversible: true, runningSessionNeedsAttention: liveSessions > 0,
        permanentDeletionAvailable: false } };
  }
}
