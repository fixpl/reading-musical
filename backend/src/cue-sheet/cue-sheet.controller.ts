import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { PlatformRoles } from "../common/decorators/platform-roles.decorator";
import { ProductionRoles } from "../common/decorators/production-roles.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import type { RequestUser } from "../common/types/request-user";
import { CueSheetService } from "./cue-sheet.service";
import { CreateCueTrackDto, CreateTrackCueDto, ReorderTrackCueDto, UpdateCueTrackDto, UpdateTrackCueDto } from "./dto";

@ApiTags("cue-sheet")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@PlatformRoles("SUPER_ADMIN", "ORG_ADMIN")
@ProductionRoles("PRODUCER", "DIRECTOR", "MUSIC_DIRECTOR", "STAGE_MANAGER", "ACTOR", "STAFF", "GUEST")
@Controller("productions/:productionId/cue-sheet")
export class CueSheetController {
  constructor(private readonly cueSheetService: CueSheetService) {}

  @Get()
  getBoard(@Param("productionId") productionId: string, @CurrentUser() user: RequestUser) {
    return this.cueSheetService.getBoard(productionId, user);
  }

  @Post("tracks")
  createTrack(
    @Param("productionId") productionId: string,
    @Body() dto: CreateCueTrackDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.cueSheetService.createTrack(productionId, dto, user);
  }

  @Post("tracks/defaults")
  createDefaults(@Param("productionId") productionId: string, @CurrentUser() user: RequestUser) {
    return this.cueSheetService.createDefaultTracks(productionId, user);
  }

  @Post("tracks/import-music")
  importMusic(@Param("productionId") productionId: string, @CurrentUser() user: RequestUser) {
    return this.cueSheetService.importMusicCues(productionId, user);
  }

  @Patch("tracks/:trackId")
  updateTrack(
    @Param("productionId") productionId: string,
    @Param("trackId") trackId: string,
    @Body() dto: UpdateCueTrackDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.cueSheetService.updateTrack(productionId, trackId, dto, user);
  }

  @Delete("tracks/:trackId")
  removeTrack(
    @Param("productionId") productionId: string,
    @Param("trackId") trackId: string,
    @CurrentUser() user: RequestUser
  ) {
    return this.cueSheetService.removeTrack(productionId, trackId, user);
  }

  @Post("tracks/:trackId/cues")
  createCue(
    @Param("productionId") productionId: string,
    @Param("trackId") trackId: string,
    @Body() dto: CreateTrackCueDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.cueSheetService.createCue(productionId, trackId, dto, user);
  }

  @Patch("cues/:cueId")
  updateCue(
    @Param("productionId") productionId: string,
    @Param("cueId") cueId: string,
    @Body() dto: UpdateTrackCueDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.cueSheetService.updateCue(productionId, cueId, dto, user);
  }

  @Patch("cues/:cueId/reorder")
  reorderCue(
    @Param("productionId") productionId: string,
    @Param("cueId") cueId: string,
    @Body() dto: ReorderTrackCueDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.cueSheetService.reorderCue(productionId, cueId, dto, user);
  }

  @Delete("cues/:cueId")
  removeCue(
    @Param("productionId") productionId: string,
    @Param("cueId") cueId: string,
    @CurrentUser() user: RequestUser
  ) {
    return this.cueSheetService.removeCue(productionId, cueId, user);
  }

  @Post("reset")
  resetCueSheet(@Param("productionId") productionId: string, @CurrentUser() user: RequestUser) {
    return this.cueSheetService.resetCueSheet(productionId, user);
  }

  @Post("restore")
  restoreCues(@Param("productionId") productionId: string, @CurrentUser() user: RequestUser) {
    return this.cueSheetService.restoreCues(productionId, user);
  }

  @Post("autotag-actors")
  autotagActors(@Param("productionId") productionId: string, @CurrentUser() user: RequestUser) {
    return this.cueSheetService.autotagActorCues(productionId, user);
  }

  @Post("actor-cues-from-script")
  generateActorCues(@Param("productionId") productionId: string, @CurrentUser() user: RequestUser) {
    return this.cueSheetService.generateActorCuesFromScript(productionId, user);
  }
}
