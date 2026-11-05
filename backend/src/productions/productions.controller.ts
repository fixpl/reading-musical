import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PlatformRoles } from "../common/decorators/platform-roles.decorator";
import { ProductionRoles } from "../common/decorators/production-roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import type { RequestUser } from "../common/types/request-user";
import {
  AddMembersDto,
  CheckProductionTitleQueryDto,
  CreateInvitationDto,
  CreateProductionDto,
  DuplicateProductionDto,
  PositionRequirementDto,
  PutStaffAssignmentsDto,
  ReplacePositionRequirementsDto,
  SearchProductionQueryDto,
  SetBackgroundVideoDto,
  UpdateMemberDto,
  UpdatePositionRequirementDto,
  UpdateProductionDto
} from "./dto";
import { ProductionsService } from "./productions.service";
import { PositionRequirementsService } from "./position-requirements.service";
import { ProductionDirectoryService } from "./production-directory.service";
import { ProductionMembersService } from "./production-members.service";
import { ProductionReadinessService } from "./production-readiness.service";
import { StaffAssignmentsService } from "./staff-assignments.service";

@ApiTags("productions")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("productions")
export class ProductionsController {
  constructor(
    private readonly productionsService: ProductionsService,
    private readonly positionRequirements: PositionRequirementsService,
    private readonly staffAssignments: StaffAssignmentsService,
    private readonly readiness: ProductionReadinessService,
    private readonly members: ProductionMembersService,
    private readonly directory: ProductionDirectoryService
  ) {}

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.productionsService.listForUser(user);
  }

  @Get("check-title")
  checkTitle(@Query() query: CheckProductionTitleQueryDto, @CurrentUser() user: RequestUser) {
    return this.productionsService.checkTitle(query, user);
  }

  @Post()
  create(@Body() dto: CreateProductionDto, @CurrentUser() user: RequestUser) {
    return this.productionsService.create(dto, user);
  }

  @Get("deleted")
  @PlatformRoles("SUPER_ADMIN", "ORG_ADMIN")
  listDeleted(@CurrentUser() user: RequestUser) {
    return this.productionsService.listDeleted(user);
  }

  @Get(":id")
  findOne(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    return this.productionsService.findOne(id, user);
  }

  @Get(":id/readiness")
  @PlatformRoles("SUPER_ADMIN", "ORG_ADMIN")
  @ProductionRoles("PRODUCER", "DIRECTOR", "STAGE_MANAGER")
  getReadiness(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    return this.readiness.getReadiness(id, user);
  }

  @Get(":id/search")
  search(@Param("id") id: string, @Query() query: SearchProductionQueryDto, @CurrentUser() user: RequestUser) {
    return this.directory.search(id, query, user);
  }

  @Get(":id/people")
  listPeople(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    return this.directory.listPeople(id, user);
  }

  @Get(":id/positions")
  listPositions(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    return this.positionRequirements.listPositionRequirements(id, user);
  }

  @Post(":id/positions")
  @PlatformRoles("SUPER_ADMIN", "ORG_ADMIN")
  @ProductionRoles("PRODUCER")
  createPosition(@Param("id") id: string, @Body() dto: PositionRequirementDto, @CurrentUser() user: RequestUser) {
    return this.positionRequirements.createPositionRequirement(id, dto, user);
  }

  @Put(":id/positions")
  @PlatformRoles("SUPER_ADMIN", "ORG_ADMIN")
  @ProductionRoles("PRODUCER")
  replacePositions(@Param("id") id: string, @Body() dto: ReplacePositionRequirementsDto, @CurrentUser() user: RequestUser) {
    return this.positionRequirements.replacePositionRequirements(id, dto, user);
  }

  @Patch(":id/positions/:positionId")
  @PlatformRoles("SUPER_ADMIN", "ORG_ADMIN")
  @ProductionRoles("PRODUCER")
  updatePosition(
    @Param("id") id: string,
    @Param("positionId") positionId: string,
    @Body() dto: UpdatePositionRequirementDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.positionRequirements.updatePositionRequirement(id, positionId, dto, user);
  }

  @Delete(":id/positions/:positionId")
  @PlatformRoles("SUPER_ADMIN", "ORG_ADMIN")
  @ProductionRoles("PRODUCER")
  deletePosition(@Param("id") id: string, @Param("positionId") positionId: string, @CurrentUser() user: RequestUser) {
    return this.positionRequirements.deletePositionRequirement(id, positionId, user);
  }

  @Patch(":id/background-video")
  @PlatformRoles("SUPER_ADMIN", "ORG_ADMIN")
  @ProductionRoles("PRODUCER", "DIRECTOR", "STAGE_MANAGER")
  setBackgroundVideo(@Param("id") id: string, @Body() dto: SetBackgroundVideoDto, @CurrentUser() user: RequestUser) {
    return this.productionsService.setBackgroundVideo(id, dto, user);
  }

  @Patch(":id")
  @PlatformRoles("SUPER_ADMIN", "ORG_ADMIN")
  @ProductionRoles("PRODUCER")
  update(@Param("id") id: string, @Body() dto: UpdateProductionDto, @CurrentUser() user: RequestUser) {
    return this.productionsService.update(id, dto, user);
  }

  @Post(":id/archive")
  @PlatformRoles("SUPER_ADMIN", "ORG_ADMIN")
  @ProductionRoles("PRODUCER")
  archive(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    return this.productionsService.archive(id, user);
  }

  @Delete(":id")
  @PlatformRoles("SUPER_ADMIN", "ORG_ADMIN")
  @ProductionRoles("PRODUCER")
  softDelete(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    return this.productionsService.softDelete(id, user);
  }

  @Post(":id/restore")
  @PlatformRoles("SUPER_ADMIN", "ORG_ADMIN")
  @ProductionRoles("PRODUCER")
  restore(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    return this.productionsService.restore(id, user);
  }

  @Post(":id/duplicate")
  @PlatformRoles("SUPER_ADMIN", "ORG_ADMIN")
  @ProductionRoles("PRODUCER")
  duplicate(@Param("id") id: string, @Body() dto: DuplicateProductionDto, @CurrentUser() user: RequestUser) {
    return this.productionsService.duplicate(id, dto, user);
  }

  @Get(":id/members")
  @PlatformRoles("SUPER_ADMIN", "ORG_ADMIN")
  @ProductionRoles("PRODUCER", "DIRECTOR", "STAGE_MANAGER")
  listMembers(@Param("id") id: string) {
    return this.members.listMembers(id);
  }

  @Post(":id/members")
  @PlatformRoles("SUPER_ADMIN", "ORG_ADMIN")
  @ProductionRoles("PRODUCER")
  addMembers(@Param("id") id: string, @Body() dto: AddMembersDto, @CurrentUser() user: RequestUser) {
    return this.members.addMembers(id, dto, user);
  }

  @Patch(":id/members/:membershipId")
  @PlatformRoles("SUPER_ADMIN", "ORG_ADMIN")
  @ProductionRoles("PRODUCER")
  updateMember(
    @Param("id") id: string,
    @Param("membershipId") membershipId: string,
    @Body() dto: UpdateMemberDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.members.updateMember(id, membershipId, dto, user);
  }

  @Delete(":id/members/:membershipId")
  @PlatformRoles("SUPER_ADMIN", "ORG_ADMIN")
  @ProductionRoles("PRODUCER")
  removeMember(@Param("id") id: string, @Param("membershipId") membershipId: string, @CurrentUser() user: RequestUser) {
    return this.members.removeMember(id, membershipId, user);
  }

  @Post(":id/invitations")
  @PlatformRoles("SUPER_ADMIN", "ORG_ADMIN")
  @ProductionRoles("PRODUCER")
  createInvitation(@Param("id") id: string, @Body() dto: CreateInvitationDto) {
    return this.members.createInvitation(id, dto);
  }

  @Get(":id/members/:membershipId/staff-assignments")
  @PlatformRoles("SUPER_ADMIN", "ORG_ADMIN")
  @ProductionRoles("PRODUCER", "STAGE_MANAGER")
  getStaffAssignments(@Param("id") id: string, @Param("membershipId") membershipId: string) {
    return this.staffAssignments.getStaffAssignments(id, membershipId);
  }

  @Put(":id/members/:membershipId/staff-assignments")
  @PlatformRoles("SUPER_ADMIN", "ORG_ADMIN")
  @ProductionRoles("PRODUCER", "STAGE_MANAGER")
  putStaffAssignments(
    @Param("id") id: string,
    @Param("membershipId") membershipId: string,
    @Body() dto: PutStaffAssignmentsDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.staffAssignments.putStaffAssignments(id, membershipId, dto, user);
  }

  @Post(":id/members/:membershipId/staff-assignments")
  @PlatformRoles("SUPER_ADMIN", "ORG_ADMIN")
  @ProductionRoles("PRODUCER", "STAGE_MANAGER")
  postStaffAssignments(
    @Param("id") id: string,
    @Param("membershipId") membershipId: string,
    @Body() dto: PutStaffAssignmentsDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.staffAssignments.putStaffAssignments(id, membershipId, dto, user);
  }
}

@ApiTags("invitations")
@Controller("invitations")
export class InvitationsController {
  constructor(private readonly members: ProductionMembersService) {}

  @Get(":token")
  getInvitation(@Param("token") token: string) {
    return this.members.getInvitation(token);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post(":token/accept")
  acceptInvitation(@Param("token") token: string, @CurrentUser() user: RequestUser) {
    return this.members.acceptInvitation(token, user);
  }
}
