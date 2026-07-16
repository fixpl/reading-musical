import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PlatformRoles } from "../common/decorators/platform-roles.decorator";
import { ProductionRoles } from "../common/decorators/production-roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import type { RequestUser } from "../common/types/request-user";
import { CastingService } from "./casting.service";
import { CreateRoleDto, MergeRoleDto, PutSceneRolesDto, UpdateRoleDto, UpsertCastAssignmentDto } from "./dto";

const ALL_PRODUCTION_ROLES = ["PRODUCER", "DIRECTOR", "MUSIC_DIRECTOR", "STAGE_MANAGER", "ACTOR", "STAFF", "GUEST"] as const;
const CASTING_EDIT_ROLES = ["PRODUCER", "DIRECTOR"] as const;

@ApiTags("casting")
@ApiBearerAuth()
@PlatformRoles("SUPER_ADMIN", "ORG_ADMIN")
@ProductionRoles(...ALL_PRODUCTION_ROLES)
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("productions/:pid")
export class CastingController {
  constructor(private readonly castingService: CastingService) {}

  @Get("roles")
  listRoles(@Param("pid") productionId: string, @CurrentUser() user: RequestUser) {
    return this.castingService.listRoles(productionId, user);
  }

  @Post("roles")
  @ProductionRoles(...CASTING_EDIT_ROLES)
  createRole(@Param("pid") productionId: string, @Body() dto: CreateRoleDto, @CurrentUser() user: RequestUser) {
    return this.castingService.createRole(productionId, dto, user);
  }

  @Patch("roles/:roleId")
  @ProductionRoles(...CASTING_EDIT_ROLES)
  updateRole(
    @Param("pid") productionId: string,
    @Param("roleId") roleId: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.castingService.updateRole(productionId, roleId, dto, user);
  }

  @Delete("roles/:roleId")
  @ProductionRoles(...CASTING_EDIT_ROLES)
  deleteRole(
    @Param("pid") productionId: string,
    @Param("roleId") roleId: string,
    @Query("force") force: string | undefined,
    @CurrentUser() user: RequestUser
  ) {
    return this.castingService.deleteRole(productionId, roleId, force === "true", user);
  }

  @Post("roles/:roleId/merge")
  @ProductionRoles(...CASTING_EDIT_ROLES)
  mergeRole(
    @Param("pid") productionId: string,
    @Param("roleId") roleId: string,
    @Body() dto: MergeRoleDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.castingService.mergeRole(productionId, roleId, dto, user);
  }

  @Post("roles/:roleId/assignments")
  @ProductionRoles(...CASTING_EDIT_ROLES)
  upsertAssignment(
    @Param("pid") productionId: string,
    @Param("roleId") roleId: string,
    @Body() dto: UpsertCastAssignmentDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.castingService.upsertAssignment(productionId, roleId, dto, user);
  }

  @Delete("roles/:roleId/assignments/:assignmentId")
  @ProductionRoles(...CASTING_EDIT_ROLES)
  deleteAssignment(
    @Param("pid") productionId: string,
    @Param("roleId") roleId: string,
    @Param("assignmentId") assignmentId: string,
    @CurrentUser() user: RequestUser
  ) {
    return this.castingService.deleteAssignment(productionId, roleId, assignmentId, user);
  }

  @Put("scenes/:sceneId/roles")
  @ProductionRoles(...CASTING_EDIT_ROLES)
  putSceneRoles(
    @Param("pid") productionId: string,
    @Param("sceneId") sceneId: string,
    @Body() dto: PutSceneRolesDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.castingService.putSceneRoles(productionId, sceneId, dto, user);
  }

  @Get("casting/workload")
  getWorkload(@Param("pid") productionId: string, @CurrentUser() user: RequestUser) {
    return this.castingService.getWorkload(productionId, user);
  }
}
