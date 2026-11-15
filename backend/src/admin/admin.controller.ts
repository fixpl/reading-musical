import { Body, Controller, Get, Param, Patch, Post, Query, Res, UseGuards, Delete } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { PlatformRoles } from "../common/decorators/platform-roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { RateLimitGuard } from "../common/guards/rate-limit.guard";
import { RateLimit } from "../common/decorators/rate-limit.decorator";
import type { RequestUser } from "../common/types/request-user";
import { AdminOpsService } from "./admin-ops.service";
import { AdminService } from "./admin.service";
import { AssistantScheduleService } from "./assistant-schedule.service";
import { ProductionAssistantService } from "./production-assistant.service";
import {
  AdminListQueryDto,
  AdminAttendanceStatusDto, AdminAvailabilityDto, ChangeUserStatusDto,
  ConfirmAssistantScheduleDto,
  CreateChecklistTemplateDto,
  CreateOrganizationDto,
  ProductionAssistantDto,
  ProfileRequestDto,
  SetUserPasswordDto,
  UpdateChecklistTemplateDto,
  UpdateOrganizationDto,
  UpdateSystemSettingDto,
  UpdateUserProfileDto
} from "./dto";

@ApiTags("admin")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@PlatformRoles("SUPER_ADMIN")
@Controller("admin")
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly ops: AdminOpsService,
    private readonly assistant: ProductionAssistantService,
    private readonly assistantSchedule: AssistantScheduleService
  ) {}

  // 공연별 준비 현황(참여자·대본·영상·큐·일정)과 확인이 필요한 일.
  @Get("overview")
  overview() {
    return this.ops.overview();
  }

  @Post("production-assistant")
  @UseGuards(RateLimitGuard)
  @RateLimit({ name: "admin.production-assistant", defaultLimit: 10, defaultWindowMs: 60_000, keyMode: "user-or-ip" })
  async askProductionAssistant(
    @Body() dto: ProductionAssistantDto,
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) res: Response
  ) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    res.once("close", abort);
    try {
      return await this.assistant.ask(dto.question.trim(), user, controller.signal, dto.eventId, dto.previousRequest?.trim());
    } finally {
      res.off("close", abort);
    }
  }

  @Post("production-assistant/schedule-confirm")
  confirmAssistantSchedule(@Body() dto: ConfirmAssistantScheduleDto, @CurrentUser() user: RequestUser) {
    return this.assistantSchedule.confirm(dto.approvalToken, user);
  }

  // AI·저장소(R2 CORS 포함)·메일·DB 상태 점검. refresh=1이면 캐시를 쓰지 않는다.
  @Get("system-health")
  systemHealth(@Query("refresh") refresh?: string) {
    return this.ops.health(refresh === "1");
  }

  @Get()
  getConsole(@CurrentUser() user: RequestUser) {
    return this.adminService.getConsole(user);
  }

  @Get("stats")
  getStats() {
    return this.adminService.getStats();
  }

  @Get("organizations")
  listOrganizations(@Query() query: AdminListQueryDto) {
    return this.adminService.listOrganizations(query);
  }

  @Post("organizations")
  createOrganization(@Body() dto: CreateOrganizationDto, @CurrentUser() user: RequestUser) {
    return this.adminService.createOrganization(dto, user);
  }

  @Patch("organizations/:organizationId")
  updateOrganization(
    @Param("organizationId") organizationId: string,
    @Body() dto: UpdateOrganizationDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.adminService.updateOrganization(organizationId, dto, user);
  }

  @Get("users")
  listUsers(@Query() query: AdminListQueryDto) {
    return this.adminService.listUsers(query);
  }

  @Get("members/search")
  searchMembers(@Query() query: AdminListQueryDto) {
    return this.adminService.searchMembers(query);
  }

  @Get("members")
  listMembers(@Query() query: AdminListQueryDto) {
    return this.adminService.listUsers(query);
  }

  @Get("users/:userId/overview")
  getUserOverview(@Param("userId") userId: string) {
    return this.adminService.getUserOverview(userId);
  }

  @Post("users/:userId/availabilities")
  createUserAvailability(@Param("userId") userId: string, @Body() dto: AdminAvailabilityDto) {
    return this.adminService.createUserAvailability(userId, dto);
  }

  @Delete("users/:userId/availabilities/:availabilityId")
  deleteUserAvailability(@Param("userId") userId: string, @Param("availabilityId") availabilityId: string) {
    return this.adminService.deleteUserAvailability(userId, availabilityId);
  }

  @Patch("attendances/:attendanceId")
  setAttendanceStatus(
    @Param("attendanceId") attendanceId: string,
    @Body() dto: AdminAttendanceStatusDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.adminService.setAttendanceStatus(attendanceId, dto.status, user);
  }

  @Patch("users/:userId/status")
  changeUserStatus(@Param("userId") userId: string, @Body() dto: ChangeUserStatusDto, @CurrentUser() user: RequestUser) {
    return this.adminService.changeUserStatus(userId, dto, user);
  }

  @Patch("users/:userId")
  updateUserProfile(@Param("userId") userId: string, @Body() dto: UpdateUserProfileDto, @CurrentUser() user: RequestUser) {
    return this.adminService.updateUserProfile(userId, dto, user);
  }

  @Post("users/:userId/password")
  setUserPassword(@Param("userId") userId: string, @Body() dto: SetUserPasswordDto, @CurrentUser() user: RequestUser) {
    return this.adminService.setUserPassword(userId, dto, user);
  }

  @Post("users/:userId/profile-request")
  requestProfile(@Param("userId") userId: string, @Body() dto: ProfileRequestDto, @CurrentUser() user: RequestUser) {
    return this.adminService.requestProfile(userId, dto, user);
  }

  @Get("activity-logs/search")
  searchActivityLogs(@Query() query: AdminListQueryDto) {
    return this.adminService.searchActivityLogs(query);
  }

  @Get("activity-logs")
  listActivityLogs(@Query() query: AdminListQueryDto) {
    return this.adminService.listActivityLogs(query);
  }

  @Get("checklist-templates")
  listChecklistTemplates() {
    return this.adminService.listChecklistTemplates();
  }

  @Post("checklist-templates")
  createChecklistTemplate(@Body() dto: CreateChecklistTemplateDto, @CurrentUser() user: RequestUser) {
    return this.adminService.createChecklistTemplate(dto, user);
  }

  @Patch("checklist-templates/:templateId")
  updateChecklistTemplate(
    @Param("templateId") templateId: string,
    @Body() dto: UpdateChecklistTemplateDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.adminService.updateChecklistTemplate(templateId, dto, user);
  }

  @Get("settings")
  listSettings() {
    return this.adminService.listSettings();
  }

  @Patch("settings/:key")
  updateSetting(@Param("key") key: string, @Body() dto: UpdateSystemSettingDto, @CurrentUser() user: RequestUser) {
    return this.adminService.updateSetting(key, dto, user);
  }
}

@ApiTags("org")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@PlatformRoles("SUPER_ADMIN", "ORG_ADMIN")
@Controller("org")
export class OrgController {
  constructor(private readonly adminService: AdminService) {}

  @Get("members")
  listOrgMembers(@Query() query: AdminListQueryDto, @CurrentUser() user: RequestUser) {
    return this.adminService.listOrgMembers(query, user);
  }

  @Patch("members/:userId/status")
  changeOrgMemberStatus(@Param("userId") userId: string, @Body() dto: ChangeUserStatusDto, @CurrentUser() user: RequestUser) {
    return this.adminService.changeOrgMemberStatus(userId, dto, user);
  }

  @Post("members/:userId/profile-request")
  requestOrgMemberProfile(@Param("userId") userId: string, @Body() dto: ProfileRequestDto, @CurrentUser() user: RequestUser) {
    return this.adminService.requestOrgMemberProfile(userId, dto, user);
  }

  @Get("activity-logs")
  listOrgActivityLogs(@Query() query: AdminListQueryDto, @CurrentUser() user: RequestUser) {
    return this.adminService.listOrgActivityLogs(query, user);
  }
}
