import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PlatformRoles } from "../common/decorators/platform-roles.decorator";
import { ProductionRoles } from "../common/decorators/production-roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import type { RequestUser } from "../common/types/request-user";
import { ChecklistService } from "./checklist.service";
import {
  ApproveChecklistItemDto,
  CreateChecklistItemDto,
  DeleteChecklistItemDto,
  PutChecklistAssignmentsDto,
  UpdateChecklistItemDto,
  UpdateChecklistStatusDto
} from "./dto";

const ALL_PRODUCTION_ROLES = ["PRODUCER", "DIRECTOR", "MUSIC_DIRECTOR", "STAGE_MANAGER", "ACTOR", "STAFF", "GUEST"] as const;
const CHECKLIST_EDIT_ROLES = ["PRODUCER", "DIRECTOR", "STAGE_MANAGER"] as const;

@ApiTags("checklist")
@ApiBearerAuth()
@PlatformRoles("SUPER_ADMIN", "ORG_ADMIN")
@ProductionRoles(...ALL_PRODUCTION_ROLES)
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("productions/:pid/checklist")
export class ChecklistController {
  constructor(private readonly checklistService: ChecklistService) {}

  @Get()
  getWorkspace(@Param("pid") productionId: string, @CurrentUser() user: RequestUser) {
    return this.checklistService.getWorkspace(productionId, user);
  }

  @Post("items")
  @ProductionRoles(...CHECKLIST_EDIT_ROLES)
  createItem(@Param("pid") productionId: string, @Body() dto: CreateChecklistItemDto, @CurrentUser() user: RequestUser) {
    return this.checklistService.createItem(productionId, dto, user);
  }

  @Patch("items/:itemId")
  @ProductionRoles(...CHECKLIST_EDIT_ROLES)
  updateItem(
    @Param("pid") productionId: string,
    @Param("itemId") itemId: string,
    @Body() dto: UpdateChecklistItemDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.checklistService.updateItem(productionId, itemId, dto, user);
  }

  @Delete("items/:itemId")
  @ProductionRoles(...CHECKLIST_EDIT_ROLES)
  deleteItem(
    @Param("pid") productionId: string,
    @Param("itemId") itemId: string,
    @Query("force") force: string | undefined,
    @Body() dto: DeleteChecklistItemDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.checklistService.deleteItem(productionId, itemId, force === "true", dto, user);
  }

  @Post("items/:itemId/assignments")
  @ProductionRoles(...CHECKLIST_EDIT_ROLES)
  putAssignments(
    @Param("pid") productionId: string,
    @Param("itemId") itemId: string,
    @Body() dto: PutChecklistAssignmentsDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.checklistService.putAssignments(productionId, itemId, dto, user);
  }

  @Patch("items/:itemId/status")
  @ProductionRoles(...ALL_PRODUCTION_ROLES)
  updateStatus(
    @Param("pid") productionId: string,
    @Param("itemId") itemId: string,
    @Body() dto: UpdateChecklistStatusDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.checklistService.updateStatus(productionId, itemId, dto, user);
  }

  @Post("items/:itemId/approve")
  @ProductionRoles(...ALL_PRODUCTION_ROLES)
  approveItem(
    @Param("pid") productionId: string,
    @Param("itemId") itemId: string,
    @Body() dto: ApproveChecklistItemDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.checklistService.approveItem(productionId, itemId, dto, user);
  }
}
