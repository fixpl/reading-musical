import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PlatformRoles } from "../common/decorators/platform-roles.decorator";
import { ProductionRoles } from "../common/decorators/production-roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import type { RequestUser } from "../common/types/request-user";
import { CreateStageElementDto, CreateStagePlanDto, PutStageSceneNoteDto, UpdateStageElementDto, UpdateStagePlanDto } from "./dto";
import { StageService } from "./stage.service";

const ALL_PRODUCTION_ROLES = ["PRODUCER", "DIRECTOR", "MUSIC_DIRECTOR", "STAGE_MANAGER", "ACTOR", "STAFF", "GUEST"] as const;
const STAGE_EDIT_ROLES = ["PRODUCER", "DIRECTOR", "STAGE_MANAGER"] as const;

@ApiTags("stage")
@ApiBearerAuth()
@PlatformRoles("SUPER_ADMIN", "ORG_ADMIN")
@ProductionRoles(...ALL_PRODUCTION_ROLES)
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("productions/:pid/stage")
export class StageController {
  constructor(private readonly stageService: StageService) {}

  @Get()
  getWorkspace(@Param("pid") productionId: string, @CurrentUser() user: RequestUser) {
    return this.stageService.getWorkspace(productionId, user);
  }

  @Get("plans")
  listPlans(@Param("pid") productionId: string, @CurrentUser() user: RequestUser) {
    return this.stageService.listPlans(productionId, user);
  }

  @Post("plans")
  @ProductionRoles(...STAGE_EDIT_ROLES)
  createPlan(@Param("pid") productionId: string, @Body() dto: CreateStagePlanDto, @CurrentUser() user: RequestUser) {
    return this.stageService.createPlan(productionId, dto, user);
  }

  @Get("plans/:planId")
  getPlan(@Param("pid") productionId: string, @Param("planId") planId: string, @CurrentUser() user: RequestUser) {
    return this.stageService.getPlan(productionId, planId, user);
  }

  @Patch("plans/:planId")
  @ProductionRoles(...STAGE_EDIT_ROLES)
  updatePlan(
    @Param("pid") productionId: string,
    @Param("planId") planId: string,
    @Body() dto: UpdateStagePlanDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.stageService.updatePlan(productionId, planId, dto, user);
  }

  @Delete("plans/:planId")
  @ProductionRoles(...STAGE_EDIT_ROLES)
  deletePlan(
    @Param("pid") productionId: string,
    @Param("planId") planId: string,
    @Query("force") force: string | undefined,
    @CurrentUser() user: RequestUser
  ) {
    return this.stageService.deletePlan(productionId, planId, force === "true", user);
  }

  @Post("plans/:planId/elements")
  @ProductionRoles(...STAGE_EDIT_ROLES)
  createElement(
    @Param("pid") productionId: string,
    @Param("planId") planId: string,
    @Body() dto: CreateStageElementDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.stageService.createElement(productionId, planId, dto, user);
  }

  @Patch("plans/:planId/elements/:elementId")
  @ProductionRoles(...STAGE_EDIT_ROLES)
  updateElement(
    @Param("pid") productionId: string,
    @Param("planId") planId: string,
    @Param("elementId") elementId: string,
    @Body() dto: UpdateStageElementDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.stageService.updateElement(productionId, planId, elementId, dto, user);
  }

  @Delete("plans/:planId/elements/:elementId")
  @ProductionRoles(...STAGE_EDIT_ROLES)
  deleteElement(
    @Param("pid") productionId: string,
    @Param("planId") planId: string,
    @Param("elementId") elementId: string,
    @CurrentUser() user: RequestUser
  ) {
    return this.stageService.deleteElement(productionId, planId, elementId, user);
  }

  @Put("plans/:planId/scenes/:sceneId/note")
  @ProductionRoles(...STAGE_EDIT_ROLES)
  putSceneNote(
    @Param("pid") productionId: string,
    @Param("planId") planId: string,
    @Param("sceneId") sceneId: string,
    @Body() dto: PutStageSceneNoteDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.stageService.putSceneNote(productionId, planId, sceneId, dto, user);
  }

  @Get("plans/:planId/export")
  @ProductionRoles(...STAGE_EDIT_ROLES)
  exportPlan(
    @Param("pid") productionId: string,
    @Param("planId") planId: string,
    @Query("format") format: string | undefined,
    @CurrentUser() user: RequestUser
  ) {
    return this.stageService.exportPlan(productionId, planId, format, user);
  }
}
