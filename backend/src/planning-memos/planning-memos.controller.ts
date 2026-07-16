import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { PlatformRoles } from "../common/decorators/platform-roles.decorator";
import { ProductionRoles } from "../common/decorators/production-roles.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import type { RequestUser } from "../common/types/request-user";
import { PlanningMemosService } from "./planning-memos.service";
import { CreatePlanningMemoDto, UpdatePlanningMemoDto } from "./dto";

@ApiTags("planning-memos")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@PlatformRoles("SUPER_ADMIN", "ORG_ADMIN")
@ProductionRoles("PRODUCER", "DIRECTOR", "MUSIC_DIRECTOR", "STAGE_MANAGER")
@Controller("productions/:productionId/planning-memos")
export class PlanningMemosController {
  constructor(private readonly planningMemosService: PlanningMemosService) {}

  @Get()
  list(@Param("productionId") productionId: string) {
    return this.planningMemosService.list(productionId);
  }

  @Post()
  create(
    @Param("productionId") productionId: string,
    @Body() dto: CreatePlanningMemoDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.planningMemosService.create(productionId, dto, user);
  }

  @Patch(":memoId")
  update(
    @Param("productionId") productionId: string,
    @Param("memoId") memoId: string,
    @Body() dto: UpdatePlanningMemoDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.planningMemosService.update(productionId, memoId, dto, user);
  }

  @Delete(":memoId")
  remove(
    @Param("productionId") productionId: string,
    @Param("memoId") memoId: string,
    @CurrentUser() user: RequestUser
  ) {
    return this.planningMemosService.remove(productionId, memoId, user);
  }
}
