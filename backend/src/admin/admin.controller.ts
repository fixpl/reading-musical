import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards, Delete } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PlatformRoles } from "../common/decorators/platform-roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import type { RequestUser } from "../common/types/request-user";
import { AdminService } from "./admin.service";
import {
  AdminListQueryDto,
  AdminAttendanceStatusDto, AdminAvailabilityDto, ChangeUserStatusDto,
  CreateChecklistTemplateDto,
  CreateOrganizationDto,
  ProfileRequestDto,
  UpdateChecklistTemplateDto,
  UpdateOrganizationDto,
  UpdateSystemSettingDto
} from "./dto";

@ApiTags("admin")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@PlatformRoles("SUPER_ADMIN")
@Controller("admin")
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

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

  @Post("users/:userId/profile-request")
  requestProfile(@Param("userId") userId: string, @Body() dto: ProfileRequestDto, @CurrentUser() user: RequestUser) {
    return this.adminService.requestProfile(userId, dto, user);
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
