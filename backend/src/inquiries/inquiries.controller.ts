import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { PlatformRoles } from "../common/decorators/platform-roles.decorator";
import { RateLimit } from "../common/decorators/rate-limit.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RateLimitGuard } from "../common/guards/rate-limit.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import type { RequestUser } from "../common/types/request-user";
import { InquiriesService } from "./inquiries.service";
import { AdminInquiryListQueryDto, ConvertInquiryDto, CreateInquiryDto, LinkInquiryDto, ReplyInquiryDto, UpdateInquiryDto } from "./dto";

@ApiTags("inquiries")
@Controller("inquiries")
export class InquiriesController {
  constructor(private readonly inquiriesService: InquiriesService) {}

  @UseGuards(RateLimitGuard)
  @RateLimit({
    name: "inquiries.create",
    defaultLimit: 10,
    defaultWindowMs: 60_000,
    limitEnv: "RATE_LIMIT_INQUIRY_LIMIT",
    windowMsEnv: "RATE_LIMIT_INQUIRY_WINDOW_MS",
    keyMode: "ip"
  })
  @Post() @Header("Cache-Control", "no-store")
  create(@Body() dto: CreateInquiryDto) {
    return this.inquiriesService.create(dto);
  }
}

@ApiTags("admin")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@PlatformRoles("SUPER_ADMIN")
@Controller("admin/inquiries")
export class AdminInquiriesController {
  constructor(private readonly inquiriesService: InquiriesService) {}

  @Get()
  list(@Query() query: AdminInquiryListQueryDto) {
    return this.inquiriesService.listForAdmin(query);
  }

  @Get(":inquiryId")
  detail(@Param("inquiryId", ParseUUIDPipe) inquiryId: string) {
    return this.inquiriesService.getForAdmin(inquiryId);
  }

  @Patch(":inquiryId")
  update(@Param("inquiryId", ParseUUIDPipe) inquiryId: string, @Body() dto: UpdateInquiryDto, @CurrentUser() user: RequestUser) {
    return this.inquiriesService.update(inquiryId, dto, user);
  }

  @Post(":inquiryId/reply")
  reply(@Param("inquiryId", ParseUUIDPipe) id: string, @Body() dto: ReplyInquiryDto, @CurrentUser() user: RequestUser) { return this.inquiriesService.reply(id, dto, user); }

  @Post(":inquiryId/link")
  link(@Param("inquiryId", ParseUUIDPipe) id: string, @Body() dto: LinkInquiryDto, @CurrentUser() user: RequestUser) { return this.inquiriesService.link(id, dto, user); }

  @Post(":inquiryId/convert")
  convert(@Param("inquiryId", ParseUUIDPipe) inquiryId: string, @Body() dto: ConvertInquiryDto, @CurrentUser() user: RequestUser) {
    return this.inquiriesService.convertToProduction(inquiryId, dto, user);
  }
}
