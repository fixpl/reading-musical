import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { PlatformRoles } from "../common/decorators/platform-roles.decorator";
import { ProductionRoles } from "../common/decorators/production-roles.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import type { RequestUser } from "../common/types/request-user";
import {
  CompleteRunSheetDto,
  CompleteRunSheetItemDto,
  CreateRunSheetDto,
  CreateRunSheetItemDto,
  DeleteRunSheetItemDto,
  GenerateRunSheetDto,
  LockRunSheetDto,
  ReorderRunSheetItemsDto,
  ReviseRunSheetDto,
  UpdateRunSheetItemDto
} from "./dto";
import { RunSheetsService } from "./run-sheets.service";

const ALL_PRODUCTION_ROLES = ["PRODUCER", "DIRECTOR", "MUSIC_DIRECTOR", "STAGE_MANAGER", "ACTOR", "STAFF", "GUEST"] as const;
const RUN_SHEET_EDIT_ROLES = ["PRODUCER", "DIRECTOR", "STAGE_MANAGER"] as const;

@ApiTags("run-sheets")
@ApiBearerAuth()
@PlatformRoles("SUPER_ADMIN", "ORG_ADMIN")
@ProductionRoles(...ALL_PRODUCTION_ROLES)
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("productions/:pid/run-sheets")
export class RunSheetsController {
  constructor(private readonly runSheetsService: RunSheetsService) {}

  @Get()
  getWorkspace(@Param("pid") productionId: string, @CurrentUser() user: RequestUser) {
    return this.runSheetsService.getWorkspace(productionId, user);
  }

  @Post()
  @ProductionRoles(...RUN_SHEET_EDIT_ROLES)
  createRunSheet(@Param("pid") productionId: string, @Body() dto: CreateRunSheetDto, @CurrentUser() user: RequestUser) {
    return this.runSheetsService.createRunSheet(productionId, dto, user);
  }

  @Post("generate")
  @ProductionRoles(...RUN_SHEET_EDIT_ROLES)
  generateFromEvent(@Param("pid") productionId: string, @Body() dto: GenerateRunSheetDto, @CurrentUser() user: RequestUser) {
    return this.runSheetsService.generateRunSheet(productionId, dto, user);
  }

  @Get(":runSheetId")
  getRunSheet(@Param("pid") productionId: string, @Param("runSheetId") runSheetId: string, @CurrentUser() user: RequestUser) {
    return this.runSheetsService.getRunSheet(productionId, runSheetId, user);
  }

  @Post(":runSheetId/generate")
  @ProductionRoles(...RUN_SHEET_EDIT_ROLES)
  regenerateRunSheet(
    @Param("pid") productionId: string,
    @Param("runSheetId") runSheetId: string,
    @Body() dto: GenerateRunSheetDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.runSheetsService.regenerateRunSheet(productionId, runSheetId, dto, user);
  }

  @Post(":runSheetId/lock")
  @ProductionRoles(...RUN_SHEET_EDIT_ROLES)
  lockRunSheet(
    @Param("pid") productionId: string,
    @Param("runSheetId") runSheetId: string,
    @Body() dto: LockRunSheetDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.runSheetsService.lockRunSheet(productionId, runSheetId, dto, user);
  }

  @Post(":runSheetId/revise")
  @ProductionRoles(...RUN_SHEET_EDIT_ROLES)
  reviseRunSheet(
    @Param("pid") productionId: string,
    @Param("runSheetId") runSheetId: string,
    @Body() dto: ReviseRunSheetDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.runSheetsService.reviseRunSheet(productionId, runSheetId, dto, user);
  }

  @Post(":runSheetId/complete")
  @ProductionRoles(...RUN_SHEET_EDIT_ROLES)
  completeRunSheet(
    @Param("pid") productionId: string,
    @Param("runSheetId") runSheetId: string,
    @Body() dto: CompleteRunSheetDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.runSheetsService.completeRunSheet(productionId, runSheetId, dto, user);
  }

  @Post(":runSheetId/items")
  @ProductionRoles(...RUN_SHEET_EDIT_ROLES)
  createItem(
    @Param("pid") productionId: string,
    @Param("runSheetId") runSheetId: string,
    @Body() dto: CreateRunSheetItemDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.runSheetsService.createItem(productionId, runSheetId, dto, user);
  }

  @Patch(":runSheetId/items/:itemId")
  @ProductionRoles(...RUN_SHEET_EDIT_ROLES)
  updateItem(
    @Param("pid") productionId: string,
    @Param("runSheetId") runSheetId: string,
    @Param("itemId") itemId: string,
    @Body() dto: UpdateRunSheetItemDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.runSheetsService.updateItem(productionId, runSheetId, itemId, dto, user);
  }

  @Delete(":runSheetId/items/:itemId")
  @ProductionRoles(...RUN_SHEET_EDIT_ROLES)
  deleteItem(
    @Param("pid") productionId: string,
    @Param("runSheetId") runSheetId: string,
    @Param("itemId") itemId: string,
    @Body() dto: DeleteRunSheetItemDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.runSheetsService.deleteItem(productionId, runSheetId, itemId, dto, user);
  }

  @Post(":runSheetId/items/reorder")
  @ProductionRoles(...RUN_SHEET_EDIT_ROLES)
  reorderItems(
    @Param("pid") productionId: string,
    @Param("runSheetId") runSheetId: string,
    @Body() dto: ReorderRunSheetItemsDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.runSheetsService.reorderItems(productionId, runSheetId, dto, user);
  }

  @Post(":runSheetId/items/:itemId/complete")
  @ProductionRoles(...ALL_PRODUCTION_ROLES)
  completeItem(
    @Param("pid") productionId: string,
    @Param("runSheetId") runSheetId: string,
    @Param("itemId") itemId: string,
    @Body() dto: CompleteRunSheetItemDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.runSheetsService.completeItem(productionId, runSheetId, itemId, dto, user);
  }

  @Get(":runSheetId/export")
  getExport(
    @Param("pid") productionId: string,
    @Param("runSheetId") runSheetId: string,
    @Query("format") format: string | undefined,
    @CurrentUser() user: RequestUser
  ) {
    return this.runSheetsService.exportRunSheet(productionId, runSheetId, format, user);
  }
}
