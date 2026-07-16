import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { PlatformRoles } from "../common/decorators/platform-roles.decorator";
import { ProductionRoles } from "../common/decorators/production-roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RateLimitGuard } from "../common/guards/rate-limit.guard";
import { RateLimit } from "../common/decorators/rate-limit.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import type { RequestUser } from "../common/types/request-user";
import {
  CreateAvailabilityDto,
  CreateScheduleEventDto,
  DeleteScheduleEventDto,
  PutEventMusicCuesDto,
  PutEventScenesDto,
  UpdateAvailabilityDto,
  UpdateScheduleEventDto,
  UpsertAttendanceDto
} from "./dto";
import { ScheduleService } from "./schedule.service";

const ALL_PRODUCTION_ROLES = ["PRODUCER", "DIRECTOR", "MUSIC_DIRECTOR", "STAGE_MANAGER", "ACTOR", "STAFF", "GUEST"] as const;
const SCHEDULE_EDIT_ROLES = ["PRODUCER", "DIRECTOR", "MUSIC_DIRECTOR", "STAGE_MANAGER"] as const;
// 일정 등록은 배우·스태프도 가능 — 공연 멤버 전원과 공유되는 스케줄을 만들 수 있다. 수정·삭제는 제작진만.
const SCHEDULE_CREATE_ROLES = [...SCHEDULE_EDIT_ROLES, "ACTOR", "STAFF"] as const;

@ApiTags("schedule")
@ApiBearerAuth()
@PlatformRoles("SUPER_ADMIN", "ORG_ADMIN")
@ProductionRoles(...ALL_PRODUCTION_ROLES)
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("productions/:pid")
export class ProductionScheduleController {
  constructor(private readonly scheduleService: ScheduleService) {}

  @Get("schedule")
  getWorkspace(
    @Param("pid") productionId: string,
    @Query("from") from: string | undefined,
    @Query("to") to: string | undefined,
    @CurrentUser() user: RequestUser
  ) {
    return this.scheduleService.getWorkspace(productionId, user, from, to);
  }

  @Get("events")
  listEvents(
    @Param("pid") productionId: string,
    @Query("from") from: string | undefined,
    @Query("to") to: string | undefined,
    @CurrentUser() user: RequestUser
  ) {
    return this.scheduleService.listEvents(productionId, user, from, to);
  }

  @Post("events")
  @ProductionRoles(...SCHEDULE_CREATE_ROLES)
  @UseGuards(RateLimitGuard)
  @RateLimit({
    name: "schedule.create-event",
    defaultLimit: 30,
    defaultWindowMs: 60_000,
    limitEnv: "RATE_LIMIT_EVENT_CREATE_LIMIT",
    windowMsEnv: "RATE_LIMIT_EVENT_CREATE_WINDOW_MS",
    keyMode: "user-or-ip"
  })
  createEvent(@Param("pid") productionId: string, @Body() dto: CreateScheduleEventDto, @CurrentUser() user: RequestUser) {
    return this.scheduleService.createEvent(productionId, dto, user);
  }

  @Get("events/:eventId")
  getEvent(@Param("pid") productionId: string, @Param("eventId") eventId: string, @CurrentUser() user: RequestUser) {
    return this.scheduleService.getEvent(productionId, eventId, user);
  }

  @Patch("events/:eventId")
  @ProductionRoles(...SCHEDULE_EDIT_ROLES)
  updateEvent(
    @Param("pid") productionId: string,
    @Param("eventId") eventId: string,
    @Body() dto: UpdateScheduleEventDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.scheduleService.updateEvent(productionId, eventId, dto, user);
  }

  @Delete("events/:eventId")
  @ProductionRoles(...SCHEDULE_EDIT_ROLES)
  deleteEvent(
    @Param("pid") productionId: string,
    @Param("eventId") eventId: string,
    @Query("force") force: string | undefined,
    @Body() dto: DeleteScheduleEventDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.scheduleService.deleteEvent(productionId, eventId, force === "true", dto, user);
  }

  @Put("events/:eventId/scenes")
  @ProductionRoles(...SCHEDULE_EDIT_ROLES)
  putEventScenes(
    @Param("pid") productionId: string,
    @Param("eventId") eventId: string,
    @Body() dto: PutEventScenesDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.scheduleService.putEventScenes(productionId, eventId, dto, user);
  }

  @Put("events/:eventId/music-cues")
  @ProductionRoles(...SCHEDULE_EDIT_ROLES)
  putEventMusicCues(
    @Param("pid") productionId: string,
    @Param("eventId") eventId: string,
    @Body() dto: PutEventMusicCuesDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.scheduleService.putEventMusicCues(productionId, eventId, dto, user);
  }

  @Post("events/:eventId/attendance")
  @ProductionRoles(...ALL_PRODUCTION_ROLES)
  upsertAttendance(
    @Param("pid") productionId: string,
    @Param("eventId") eventId: string,
    @Body() dto: UpsertAttendanceDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.scheduleService.upsertAttendance(productionId, eventId, dto, user);
  }

  @Get("schedule/suggest")
  suggest(
    @Param("pid") productionId: string,
    @Query("sceneIds") sceneIds: string | undefined,
    @Query("musicCueIds") musicCueIds: string | undefined,
    @Query("startAt") startAt: string | undefined,
    @Query("endAt") endAt: string | undefined,
    @CurrentUser() user: RequestUser
  ) {
    return this.scheduleService.suggest(productionId, user, { sceneIds, musicCueIds, startAt, endAt });
  }
}

@ApiTags("my-schedule")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class MyScheduleController {
  constructor(private readonly scheduleService: ScheduleService) {}

  @Get("schedule/me/ics")
  @Header("Content-Type", "text/calendar; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="reading-musical-my-schedule.ics"')
  @ApiOkResponse({
    description: "본인에게 배정된 일정의 iCalendar(.ics) export",
    content: { "text/calendar": { schema: { type: "string" } } }
  })
  exportMyScheduleIcs(@CurrentUser() user: RequestUser) {
    return this.scheduleService.exportMyScheduleIcs(user);
  }

  @Get("schedule/me")
  getMySchedule(@CurrentUser() user: RequestUser) {
    return this.scheduleService.getMySchedule(user);
  }

  @Get("availabilities")
  listAvailabilities(@CurrentUser() user: RequestUser) {
    return this.scheduleService.listAvailabilities(user);
  }

  @Post("availabilities")
  createAvailability(@Body() dto: CreateAvailabilityDto, @CurrentUser() user: RequestUser) {
    return this.scheduleService.createAvailability(user, dto);
  }

  @Patch("availabilities/:availabilityId")
  updateAvailability(
    @Param("availabilityId") availabilityId: string,
    @Body() dto: UpdateAvailabilityDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.scheduleService.updateAvailability(user, availabilityId, dto);
  }

  @Delete("availabilities/:availabilityId")
  deleteAvailability(@Param("availabilityId") availabilityId: string, @CurrentUser() user: RequestUser) {
    return this.scheduleService.deleteAvailability(user, availabilityId);
  }
}
