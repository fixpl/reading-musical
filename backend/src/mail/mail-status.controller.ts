import { Controller, Get, Header, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { PlatformRoles } from "../common/decorators/platform-roles.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { MailService } from "./mail.service";

@Controller("admin/mail")
@UseGuards(JwtAuthGuard, RolesGuard)
@PlatformRoles("SUPER_ADMIN")
export class MailStatusController {
  constructor(private readonly mail: MailService, private readonly prisma: PrismaService) {}
  @Get("readiness") @Header("Cache-Control", "no-store")
  async readiness() {
    const [counts, oldest] = await Promise.all([
      this.prisma.emailDelivery.groupBy({ by: ["status"], _count: { _all: true } }),
      this.prisma.emailDelivery.findFirst({ where: { status: "QUEUED" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } })
    ]);
    return { ...this.mail.deliveryReadiness(), configurationOnly: true,
      counts: Object.fromEntries(counts.map((item) => [item.status, item._count._all])), oldestQueuedAt: oldest?.createdAt ?? null };
  }
}
