import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import type { RequestUser } from "../common/types/request-user";
import { OpportunityQueryDto, RecruitmentPageDto, RecruitmentRevisionDto, ReviewRecruitmentApplicationDto, RoundDocumentDto, SubmitRecruitmentApplicationDto, UpdateRecruitmentRoundDto } from "./dto";
import { RecruitmentService } from "./recruitment.service";

@ApiTags("recruitment")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("recruitment")
export class RecruitmentMemberController {
  constructor(private readonly recruitment: RecruitmentService) {}
  @Get("opportunities") @Header("Cache-Control", "private, no-store")
  opportunities(@Query() query: OpportunityQueryDto, @CurrentUser() user: RequestUser) { return this.recruitment.opportunities(query, user); }
  @Get("opportunities/:id") @Header("Cache-Control", "private, no-store")
  opportunity(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser) { return this.recruitment.opportunity(id, user); }
  @Post("opportunities/:id/applications") @Header("Cache-Control", "private, no-store")
  submit(@Param("id", ParseUUIDPipe) id: string, @Body() dto: SubmitRecruitmentApplicationDto, @CurrentUser() user: RequestUser) { return this.recruitment.submit(id, dto, user); }
  @Get("applications/me") @Header("Cache-Control", "private, no-store")
  mine(@Query() query: RecruitmentPageDto, @CurrentUser() user: RequestUser) { return this.recruitment.myApplications(query, user); }
  @Post("applications/:id/withdraw") @Header("Cache-Control", "private, no-store")
  withdraw(@Param("id", ParseUUIDPipe) id: string, @Body() dto: RecruitmentRevisionDto, @CurrentUser() user: RequestUser) { return this.recruitment.withdraw(id, dto.expectedRevision, user); }
}

@ApiTags("productions/recruitment")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("productions/:pid/recruitment")
export class RecruitmentManagerController {
  constructor(private readonly recruitment: RecruitmentService) {}
  @Get("access") @Header("Cache-Control", "private, no-store")
  access(@Param("pid", ParseUUIDPipe) pid: string, @CurrentUser() user: RequestUser) { return this.recruitment.access(pid, user); }
  @Get("rounds") @Header("Cache-Control", "private, no-store")
  rounds(@Param("pid", ParseUUIDPipe) pid: string, @Query() query: RecruitmentPageDto, @CurrentUser() user: RequestUser) { return this.recruitment.rounds(pid, query, user); }
  @Post("rounds") @Header("Cache-Control", "private, no-store")
  create(@Param("pid", ParseUUIDPipe) pid: string, @Body() dto: RoundDocumentDto, @CurrentUser() user: RequestUser) { return this.recruitment.createRound(pid, dto, user); }
  @Put("rounds/:rid") @Header("Cache-Control", "private, no-store")
  update(@Param("pid", ParseUUIDPipe) pid: string, @Param("rid", ParseUUIDPipe) rid: string, @Body() dto: UpdateRecruitmentRoundDto, @CurrentUser() user: RequestUser) { return this.recruitment.updateRound(pid, rid, dto, user); }
  @Post("rounds/:rid/publish") @Header("Cache-Control", "private, no-store")
  publish(@Param("pid", ParseUUIDPipe) pid: string, @Param("rid", ParseUUIDPipe) rid: string, @Body() dto: RecruitmentRevisionDto, @CurrentUser() user: RequestUser) { return this.recruitment.publishRound(pid, rid, dto.expectedRevision, user); }
  @Post("rounds/:rid/close") @Header("Cache-Control", "private, no-store")
  close(@Param("pid", ParseUUIDPipe) pid: string, @Param("rid", ParseUUIDPipe) rid: string, @Body() dto: RecruitmentRevisionDto, @CurrentUser() user: RequestUser) { return this.recruitment.closeRound(pid, rid, dto.expectedRevision, user); }
  @Post("rounds/:rid/cancel") @Header("Cache-Control", "private, no-store")
  cancel(@Param("pid", ParseUUIDPipe) pid: string, @Param("rid", ParseUUIDPipe) rid: string, @Body() dto: RecruitmentRevisionDto, @CurrentUser() user: RequestUser) { return this.recruitment.cancelRound(pid, rid, dto.expectedRevision, user); }
  @Get("rounds/:rid/applications") @Header("Cache-Control", "private, no-store")
  applications(@Param("pid", ParseUUIDPipe) pid: string, @Param("rid", ParseUUIDPipe) rid: string, @Query() query: RecruitmentPageDto, @CurrentUser() user: RequestUser) { return this.recruitment.applications(pid, rid, query, user); }
  @Post("rounds/:rid/applications/:aid/review") @Header("Cache-Control", "private, no-store")
  review(@Param("pid", ParseUUIDPipe) pid: string, @Param("rid", ParseUUIDPipe) rid: string, @Param("aid", ParseUUIDPipe) aid: string, @Body() dto: ReviewRecruitmentApplicationDto, @CurrentUser() user: RequestUser) { return this.recruitment.review(pid, rid, aid, dto, user); }
}
