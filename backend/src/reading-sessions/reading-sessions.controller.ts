import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { PlatformRoles } from "../common/decorators/platform-roles.decorator";
import { ProductionRoles } from "../common/decorators/production-roles.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import type { RequestUser } from "../common/types/request-user";
import {
  CreateGuestReadingAccessDto,
  EndReadingSessionDto,
  FireReadingCueDto,
  RevokeGuestReadingAccessDto,
  StartReadingSessionDto,
  UpdateReadingSessionDto
} from "./dto";
import { ReadingSessionsService } from "./reading-sessions.service";

const ALL_PRODUCTION_ROLES = ["PRODUCER", "DIRECTOR", "MUSIC_DIRECTOR", "STAGE_MANAGER", "ACTOR", "STAFF", "GUEST"] as const;
const START_END_ROLES = ["PRODUCER", "DIRECTOR", "STAGE_MANAGER"] as const;
const PAGE_SYNC_ROLES = ["PRODUCER", "DIRECTOR"] as const;
const CUE_FIRE_ROLES = ["PRODUCER", "DIRECTOR", "MUSIC_DIRECTOR", "STAFF"] as const;

@ApiTags("reading-sessions")
@ApiBearerAuth()
@PlatformRoles("SUPER_ADMIN", "ORG_ADMIN")
@ProductionRoles(...ALL_PRODUCTION_ROLES)
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("productions/:pid/reading-sessions")
export class ReadingSessionsController {
  constructor(private readonly readingSessionsService: ReadingSessionsService) {}

  @Get("event/:eventId/guest-links")
  @ProductionRoles(...START_END_ROLES)
  listGuestLinks(@Param("pid") productionId: string, @Param("eventId") eventId: string, @CurrentUser() user: RequestUser) {
    return this.readingSessionsService.listGuestLinks(productionId, eventId, user);
  }

  @Post("event/:eventId/guest-links")
  @ProductionRoles(...START_END_ROLES)
  createGuestLink(
    @Param("pid") productionId: string,
    @Param("eventId") eventId: string,
    @Body() dto: CreateGuestReadingAccessDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.readingSessionsService.createGuestLink(productionId, eventId, dto, user);
  }

  @Patch("event/:eventId/guest-links/:guestAccessId/revoke")
  @ProductionRoles(...START_END_ROLES)
  revokeGuestLink(
    @Param("pid") productionId: string,
    @Param("eventId") eventId: string,
    @Param("guestAccessId") guestAccessId: string,
    @Body() dto: RevokeGuestReadingAccessDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.readingSessionsService.revokeGuestLink(productionId, eventId, guestAccessId, dto, user);
  }

  @Get("event/:eventId")
  getEventWorkspace(@Param("pid") productionId: string, @Param("eventId") eventId: string, @CurrentUser() user: RequestUser) {
    return this.readingSessionsService.getEventWorkspace(productionId, eventId, user);
  }

  @Get(":sessionId")
  getSession(@Param("pid") productionId: string, @Param("sessionId") sessionId: string, @CurrentUser() user: RequestUser) {
    return this.readingSessionsService.getSession(productionId, sessionId, user);
  }

  @Post()
  @ProductionRoles(...START_END_ROLES)
  startSession(@Param("pid") productionId: string, @Body() dto: StartReadingSessionDto, @CurrentUser() user: RequestUser) {
    return this.readingSessionsService.startSession(productionId, dto, user);
  }

  @Patch(":sessionId")
  @ProductionRoles(...PAGE_SYNC_ROLES)
  updateSession(
    @Param("pid") productionId: string,
    @Param("sessionId") sessionId: string,
    @Body() dto: UpdateReadingSessionDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.readingSessionsService.updateSession(productionId, sessionId, dto, user);
  }

  @Post(":sessionId/cue-fire")
  @ProductionRoles(...CUE_FIRE_ROLES)
  fireCue(
    @Param("pid") productionId: string,
    @Param("sessionId") sessionId: string,
    @Body() dto: FireReadingCueDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.readingSessionsService.fireCue(productionId, sessionId, dto, user);
  }

  @Post(":sessionId/end")
  @ProductionRoles(...START_END_ROLES)
  endSession(
    @Param("pid") productionId: string,
    @Param("sessionId") sessionId: string,
    @Body() dto: EndReadingSessionDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.readingSessionsService.endSession(productionId, sessionId, dto, user);
  }
}

@ApiTags("guest-reading")
@Controller("guest-reading")
export class GuestReadingController {
  constructor(private readonly readingSessionsService: ReadingSessionsService) {}

  @Get(":token")
  getGuestWorkspace(@Param("token") token: string) {
    return this.readingSessionsService.getGuestWorkspace(token);
  }
}
