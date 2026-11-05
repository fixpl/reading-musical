import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PlatformRoles } from "../common/decorators/platform-roles.decorator";
import { ProductionRoles } from "../common/decorators/production-roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import type { RequestUser } from "../common/types/request-user";
import {
  ApplyScriptImportDto,
  CreateActDto,
  CreateAnnotationDto,
  CreateBlockDto,
  CreateSceneDto,
  CreateScriptDto,
  CreateScriptImportDto,
  CreateScriptVersionDto,
  ReorderBlocksDto,
  RestoreScriptVersionDto,
  UpdateAnnotationDto,
  UpdateBlockDto
} from "./dto";
import { ScriptImportService } from "./script-import.service";
import { ScriptsService } from "./scripts.service";

const ALL_PRODUCTION_ROLES = ["PRODUCER", "DIRECTOR", "MUSIC_DIRECTOR", "STAGE_MANAGER", "ACTOR", "STAFF", "GUEST"] as const;
const SCRIPT_EDIT_ROLES = ["PRODUCER", "DIRECTOR"] as const;

@ApiTags("scripts")
@ApiBearerAuth()
@PlatformRoles("SUPER_ADMIN", "ORG_ADMIN")
@ProductionRoles(...ALL_PRODUCTION_ROLES)
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("productions/:pid")
export class ScriptsController {
  constructor(
    private readonly scriptsService: ScriptsService,
    private readonly scriptImport: ScriptImportService
  ) {}

  @Get("scripts")
  listScripts(@Param("pid") productionId: string, @CurrentUser() user: RequestUser) {
    return this.scriptsService.listScripts(productionId, user);
  }

  @Post("scripts")
  @ProductionRoles(...SCRIPT_EDIT_ROLES)
  createScript(@Param("pid") productionId: string, @Body() dto: CreateScriptDto, @CurrentUser() user: RequestUser) {
    return this.scriptsService.createScript(productionId, dto, user);
  }

  @Get("scripts-deleted")
  @ProductionRoles(...SCRIPT_EDIT_ROLES)
  listDeletedScripts(@Param("pid") productionId: string, @CurrentUser() user: RequestUser) {
    return this.scriptsService.listDeletedScripts(productionId, user);
  }

  @Delete("scripts/:scriptId")
  @ProductionRoles(...SCRIPT_EDIT_ROLES)
  deleteScript(
    @Param("pid") productionId: string,
    @Param("scriptId") scriptId: string,
    @CurrentUser() user: RequestUser
  ) {
    return this.scriptsService.deleteScript(productionId, scriptId, user);
  }

  @Post("scripts/:scriptId/restore")
  @ProductionRoles(...SCRIPT_EDIT_ROLES)
  restoreScript(
    @Param("pid") productionId: string,
    @Param("scriptId") scriptId: string,
    @CurrentUser() user: RequestUser
  ) {
    return this.scriptsService.restoreScript(productionId, scriptId, user);
  }

  @Get("scripts/:scriptId")
  getScript(@Param("pid") productionId: string, @Param("scriptId") scriptId: string, @CurrentUser() user: RequestUser) {
    return this.scriptsService.getScript(productionId, scriptId, user);
  }

  @Post("scripts/:scriptId/acts")
  @ProductionRoles(...SCRIPT_EDIT_ROLES)
  createAct(
    @Param("pid") productionId: string,
    @Param("scriptId") scriptId: string,
    @Body() dto: CreateActDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.scriptsService.createAct(productionId, scriptId, dto, user);
  }

  @Post("acts/:actId/scenes")
  @ProductionRoles(...SCRIPT_EDIT_ROLES)
  createScene(
    @Param("pid") productionId: string,
    @Param("actId") actId: string,
    @Body() dto: CreateSceneDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.scriptsService.createScene(productionId, actId, dto, user);
  }

  @Post("scenes/:sceneId/blocks")
  @ProductionRoles(...SCRIPT_EDIT_ROLES)
  createBlock(
    @Param("pid") productionId: string,
    @Param("sceneId") sceneId: string,
    @Body() dto: CreateBlockDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.scriptsService.createBlock(productionId, sceneId, dto, user);
  }

  @Post("scenes/:sceneId/blocks/reorder")
  @ProductionRoles(...SCRIPT_EDIT_ROLES)
  reorderBlocks(
    @Param("pid") productionId: string,
    @Param("sceneId") sceneId: string,
    @Body() dto: ReorderBlocksDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.scriptsService.reorderBlocks(productionId, sceneId, dto, user);
  }

  @Patch("blocks/:blockId")
  @ProductionRoles(...SCRIPT_EDIT_ROLES)
  updateBlock(
    @Param("pid") productionId: string,
    @Param("blockId") blockId: string,
    @Body() dto: UpdateBlockDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.scriptsService.updateBlock(productionId, blockId, dto, user);
  }

  @Delete("blocks/:blockId")
  @ProductionRoles(...SCRIPT_EDIT_ROLES)
  deleteBlock(
    @Param("pid") productionId: string,
    @Param("blockId") blockId: string,
    @Query("force") force: string | undefined,
    @CurrentUser() user: RequestUser
  ) {
    return this.scriptsService.deleteBlock(productionId, blockId, force === "true", user);
  }

  @Post("scripts/:scriptId/versions")
  @ProductionRoles(...SCRIPT_EDIT_ROLES)
  createVersion(
    @Param("pid") productionId: string,
    @Param("scriptId") scriptId: string,
    @Body() dto: CreateScriptVersionDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.scriptsService.createVersion(productionId, scriptId, dto, user);
  }

  @Post("scripts/:scriptId/versions/:versionId/restore")
  @ProductionRoles(...SCRIPT_EDIT_ROLES)
  restoreVersion(
    @Param("pid") productionId: string,
    @Param("scriptId") scriptId: string,
    @Param("versionId") versionId: string,
    @Body() dto: RestoreScriptVersionDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.scriptsService.restoreVersion(productionId, scriptId, versionId, dto, user);
  }

  @Post("scripts/:scriptId/imports")
  @ProductionRoles(...SCRIPT_EDIT_ROLES)
  createImport(
    @Param("pid") productionId: string,
    @Param("scriptId") scriptId: string,
    @Body() dto: CreateScriptImportDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.scriptImport.createImport(productionId, scriptId, dto, user);
  }

  @Post("scripts/:scriptId/imports/:importId/apply")
  @ProductionRoles(...SCRIPT_EDIT_ROLES)
  applyImport(
    @Param("pid") productionId: string,
    @Param("scriptId") scriptId: string,
    @Param("importId") importId: string,
    @Body() dto: ApplyScriptImportDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.scriptImport.applyImport(productionId, scriptId, importId, dto, user);
  }

  @Get("blocks/:blockId/annotations")
  listAnnotations(@Param("pid") productionId: string, @Param("blockId") blockId: string, @CurrentUser() user: RequestUser) {
    return this.scriptsService.listAnnotations(productionId, blockId, user);
  }

  @Post("blocks/:blockId/annotations")
  createAnnotation(
    @Param("pid") productionId: string,
    @Param("blockId") blockId: string,
    @Body() dto: CreateAnnotationDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.scriptsService.createAnnotation(productionId, blockId, dto, user);
  }

  @Patch("blocks/:blockId/annotations/:annotationId")
  updateAnnotation(
    @Param("pid") productionId: string,
    @Param("blockId") blockId: string,
    @Param("annotationId") annotationId: string,
    @Body() dto: UpdateAnnotationDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.scriptsService.updateAnnotation(productionId, blockId, annotationId, dto, user);
  }

  @Delete("blocks/:blockId/annotations/:annotationId")
  deleteAnnotation(
    @Param("pid") productionId: string,
    @Param("blockId") blockId: string,
    @Param("annotationId") annotationId: string,
    @CurrentUser() user: RequestUser
  ) {
    return this.scriptsService.deleteAnnotation(productionId, blockId, annotationId, user);
  }
}
