import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PlatformRoles } from "../common/decorators/platform-roles.decorator";
import { ProductionRoles } from "../common/decorators/production-roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import type { RequestUser } from "../common/types/request-user";
import {
  CreateMusicCueDto,
  CreateMusicTrackDto,
  FireCueDto,
  ReorderMusicCuesDto,
  UpdateCueAnchorDto,
  UpdateMusicCueDto,
  UpdateMusicTrackDto
} from "./dto";
import { MusicService } from "./music.service";

const ALL_PRODUCTION_ROLES = ["PRODUCER", "DIRECTOR", "MUSIC_DIRECTOR", "STAGE_MANAGER", "ACTOR", "STAFF", "GUEST"] as const;
const MUSIC_EDIT_ROLES = ["PRODUCER", "MUSIC_DIRECTOR"] as const;
const ANCHOR_EDIT_ROLES = ["PRODUCER", "DIRECTOR", "MUSIC_DIRECTOR"] as const;
const FIRE_ROLES = ["PRODUCER", "DIRECTOR", "MUSIC_DIRECTOR", "STAGE_MANAGER", "STAFF"] as const;

@ApiTags("music")
@ApiBearerAuth()
@PlatformRoles("SUPER_ADMIN", "ORG_ADMIN")
@ProductionRoles(...ALL_PRODUCTION_ROLES)
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("productions/:pid/music")
export class MusicController {
  constructor(private readonly musicService: MusicService) {}

  @Get("tracks")
  listTracks(@Param("pid") productionId: string, @CurrentUser() user: RequestUser) {
    return this.musicService.listTracks(productionId, user);
  }

  @Get("cuesheet")
  getCueSheet(@Param("pid") productionId: string, @CurrentUser() user: RequestUser) {
    return this.musicService.getCueSheet(productionId, user);
  }

  @Post("tracks")
  @ProductionRoles(...MUSIC_EDIT_ROLES)
  createTrack(@Param("pid") productionId: string, @Body() dto: CreateMusicTrackDto, @CurrentUser() user: RequestUser) {
    return this.musicService.createTrack(productionId, dto, user);
  }

  @Patch("tracks/:trackId")
  @ProductionRoles(...MUSIC_EDIT_ROLES)
  updateTrack(
    @Param("pid") productionId: string,
    @Param("trackId") trackId: string,
    @Body() dto: UpdateMusicTrackDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.musicService.updateTrack(productionId, trackId, dto, user);
  }

  @Delete("tracks/:trackId")
  @ProductionRoles(...MUSIC_EDIT_ROLES)
  deleteTrack(
    @Param("pid") productionId: string,
    @Param("trackId") trackId: string,
    @Query("force") force: string | undefined,
    @CurrentUser() user: RequestUser
  ) {
    return this.musicService.deleteTrack(productionId, trackId, force === "true", user);
  }

  @Post("tracks/:trackId/cues")
  @ProductionRoles(...MUSIC_EDIT_ROLES)
  createCue(
    @Param("pid") productionId: string,
    @Param("trackId") trackId: string,
    @Body() dto: CreateMusicCueDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.musicService.createCue(productionId, trackId, dto, user);
  }

  @Post("cues/reorder")
  @ProductionRoles(...MUSIC_EDIT_ROLES)
  reorderCues(@Param("pid") productionId: string, @Body() dto: ReorderMusicCuesDto, @CurrentUser() user: RequestUser) {
    return this.musicService.reorderCues(productionId, dto, user);
  }

  @Patch("cues/:cueId")
  @ProductionRoles(...MUSIC_EDIT_ROLES)
  updateCue(
    @Param("pid") productionId: string,
    @Param("cueId") cueId: string,
    @Body() dto: UpdateMusicCueDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.musicService.updateCue(productionId, cueId, dto, user);
  }

  @Patch("cues/:cueId/anchor")
  @ProductionRoles(...ANCHOR_EDIT_ROLES)
  updateCueAnchor(
    @Param("pid") productionId: string,
    @Param("cueId") cueId: string,
    @Body() dto: UpdateCueAnchorDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.musicService.updateCueAnchor(productionId, cueId, dto, user);
  }

  @Delete("cues/:cueId")
  @ProductionRoles(...MUSIC_EDIT_ROLES)
  deleteCue(
    @Param("pid") productionId: string,
    @Param("cueId") cueId: string,
    @Query("force") force: string | undefined,
    @CurrentUser() user: RequestUser
  ) {
    return this.musicService.deleteCue(productionId, cueId, force === "true", user);
  }

  @Post("cues/:cueId/fire")
  @ProductionRoles(...FIRE_ROLES)
  fireCue(@Param("pid") productionId: string, @Param("cueId") cueId: string, @Body() dto: FireCueDto, @CurrentUser() user: RequestUser) {
    return this.musicService.fireCue(productionId, cueId, dto, user);
  }
}
