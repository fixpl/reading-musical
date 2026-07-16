import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import type { RequestUser } from "../common/types/request-user";
import { DashboardService } from "./dashboard.service";

@ApiTags("dashboard")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("productions")
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get(":id/dashboard")
  getProductionDashboard(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    return this.dashboardService.getProductionDashboard(id, user);
  }
}
