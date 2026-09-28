import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { PlatformRoles } from "../common/decorators/platform-roles.decorator";
import { ProductionRoles } from "../common/decorators/production-roles.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import type { RequestUser } from "../common/types/request-user";
import { AttachReferenceFilesDto, ApplyCompositionImportDto, CompositionRevisionDto, PreviewCompositionImportDto, ReorderSectionsDto, WriteCompositionMediaDto, WriteSectionDto } from "./composition.dto";
import { CompositionService } from "./composition.service";

@ApiTags("performance-composition")
@ApiBearerAuth()
@PlatformRoles("SUPER_ADMIN", "ORG_ADMIN")
@ProductionRoles("PRODUCER", "DIRECTOR", "MUSIC_DIRECTOR", "STAGE_MANAGER", "ACTOR", "STAFF", "GUEST")
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("productions/:pid/composition")
export class CompositionController {
  constructor(private readonly service: CompositionService) {}

  @Get()
  board(@Param("pid") pid: string, @CurrentUser() user: RequestUser) { return this.service.board(pid, user); }

  @Get("library")
  library(@Param("pid") pid: string, @CurrentUser() user: RequestUser, @Query("q") q?: string) { return this.service.library(pid, user, q); }

  @Post("sections") @ProductionRoles("PRODUCER", "DIRECTOR")
  create(@Param("pid") pid: string, @Body() dto: WriteSectionDto, @CurrentUser() user: RequestUser) { return this.service.create(pid, dto, user); }

  @Patch("sections/:sid") @ProductionRoles("PRODUCER", "DIRECTOR")
  update(@Param("pid") pid: string, @Param("sid") sid: string, @Body() dto: WriteSectionDto, @CurrentUser() user: RequestUser) { return this.service.update(pid, sid, dto, user); }

  @Post("reorder") @ProductionRoles("PRODUCER", "DIRECTOR")
  reorder(@Param("pid") pid: string, @Body() dto: ReorderSectionsDto, @CurrentUser() user: RequestUser) { return this.service.reorder(pid, dto, user); }

  @Post("sections/:sid/archive") @ProductionRoles("PRODUCER", "DIRECTOR")
  archive(@Param("pid") pid: string, @Param("sid") sid: string, @Body() dto: CompositionRevisionDto, @CurrentUser() user: RequestUser) { return this.service.archive(pid, sid, dto, user); }

  @Post("sections/:sid/restore") @ProductionRoles("PRODUCER", "DIRECTOR")
  restore(@Param("pid") pid: string, @Param("sid") sid: string, @Body() dto: CompositionRevisionDto, @CurrentUser() user: RequestUser) { return this.service.restore(pid, sid, dto, user); }

  @Post("sections/:sid/duplicate") @ProductionRoles("PRODUCER", "DIRECTOR")
  duplicate(@Param("pid") pid: string, @Param("sid") sid: string, @Body() dto: CompositionRevisionDto, @CurrentUser() user: RequestUser) { return this.service.duplicate(pid, sid, dto, user); }

  @Post("sections/:sid/attachments") @ProductionRoles("PRODUCER", "DIRECTOR")
  attachReferences(@Param("pid") pid: string, @Param("sid") sid: string, @Body() dto: AttachReferenceFilesDto, @CurrentUser() user: RequestUser) { return this.service.attachReferences(pid, sid, dto, user); }

  @Post("sections/:sid/media") @ProductionRoles("PRODUCER", "DIRECTOR")
  addMedia(@Param("pid") pid: string, @Param("sid") sid: string, @Body() dto: WriteCompositionMediaDto, @CurrentUser() user: RequestUser) { return this.service.saveMedia(pid, sid, null, dto, user); }

  @Patch("sections/:sid/media/:mid") @ProductionRoles("PRODUCER", "DIRECTOR")
  updateMedia(@Param("pid") pid: string, @Param("sid") sid: string, @Param("mid") mid: string, @Body() dto: WriteCompositionMediaDto, @CurrentUser() user: RequestUser) { return this.service.saveMedia(pid, sid, mid, dto, user); }

  @Delete("sections/:sid/media/:mid") @ProductionRoles("PRODUCER", "DIRECTOR")
  unlinkMedia(@Param("pid") pid: string, @Param("sid") sid: string, @Param("mid") mid: string, @Body() dto: CompositionRevisionDto, @CurrentUser() user: RequestUser) { return this.service.unlinkMedia(pid, sid, mid, dto, user); }

  @Post("imports/preview") @ProductionRoles("PRODUCER", "DIRECTOR")
  previewImport(@Param("pid") pid: string, @Body() dto: PreviewCompositionImportDto, @CurrentUser() user: RequestUser) { return this.service.previewImport(pid, dto, user); }

  @Post("imports/apply") @ProductionRoles("PRODUCER", "DIRECTOR")
  applyImport(@Param("pid") pid: string, @Body() dto: ApplyCompositionImportDto, @CurrentUser() user: RequestUser) { return this.service.applyImport(pid, dto, user); }
}
