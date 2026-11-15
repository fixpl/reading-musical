import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { PlatformRoles } from "../common/decorators/platform-roles.decorator";
import { RateLimit } from "../common/decorators/rate-limit.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RateLimitGuard } from "../common/guards/rate-limit.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import type { RequestUser } from "../common/types/request-user";
import { CreateSupportDto, FaqCategoryDto, FaqQuestionDto, GuestSupportLookupDto, MarketingConsentDto, SaveLegalDocumentDto, SaveSiteSettingsDto, SupportListDto, UpdateSupportDto } from "./site.dto";
import { SiteService } from "./site.service";
import { SupportService } from "./support.service";

@ApiTags("site")
@Controller("site")
export class SiteController {
  constructor(private readonly site: SiteService, private readonly support: SupportService) {}
  @Get("public") @Header("Cache-Control", "no-store") publicInfo() { return this.site.publicInfo(); }
  @Get("policies/:kind") @Header("Cache-Control", "no-store") document(@Param("kind") kind: string, @Query("id") id?: string, @Query("preview") preview?: string) { return this.site.publicDocument(kind, id, preview === "1"); }
  @Get("faq") @Header("Cache-Control", "no-store") faq() { return this.site.faqs(); }

  @Post("support") @Header("Cache-Control", "no-store") @UseGuards(RateLimitGuard)
  @RateLimit({ name: "site.support.create", defaultLimit: 5, defaultWindowMs: 600000, keyMode: "ip" })
  create(@Body() dto: CreateSupportDto) { return this.support.create(dto); }

  @Post("support/lookup") @Header("Cache-Control", "no-store") @UseGuards(RateLimitGuard)
  @RateLimit({ name: "site.support.lookup", defaultLimit: 20, defaultWindowMs: 60000, keyMode: "ip" })
  lookup(@Body() dto: GuestSupportLookupDto) { return this.support.lookup(dto); }

  @Post("support/member") @Header("Cache-Control", "no-store") @UseGuards(JwtAuthGuard, RateLimitGuard)
  @RateLimit({ name: "site.support.member", defaultLimit: 5, defaultWindowMs: 600000, keyMode: "ip" })
  createMember(@Body() dto: CreateSupportDto, @CurrentUser() user: RequestUser) { return this.support.create(dto, user.id); }

  @Get("support/mine") @Header("Cache-Control", "no-store") @UseGuards(JwtAuthGuard)
  mine(@CurrentUser() user: RequestUser, @Query() query: SupportListDto) { return this.support.mine(user.id, query); }

  @Get("consents") @Header("Cache-Control", "no-store") @UseGuards(JwtAuthGuard)
  consents(@CurrentUser() user: RequestUser) { return this.site.myConsents(user.id); }
  @Put("consents/marketing") @Header("Cache-Control", "no-store") @UseGuards(JwtAuthGuard)
  marketing(@CurrentUser() user: RequestUser, @Body() dto: MarketingConsentDto) { return this.site.updateMarketing(user.id, dto); }
}

@ApiTags("admin/site")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@PlatformRoles("SUPER_ADMIN")
@Controller("admin/site")
export class AdminSiteController {
  constructor(private readonly site: SiteService, private readonly support: SupportService) {}
  @Get("settings") settings() { return this.site.settings(); }
  @Put("settings") saveSettings(@Body() dto: SaveSiteSettingsDto, @CurrentUser() user: RequestUser) { return this.site.saveSettings(dto, user.id); }
  @Get("policies") policies(@Query("kind") kind: string) { return this.site.adminDocuments(kind); }
  @Get("policies/:id") document(@Param("id", ParseUUIDPipe) id: string) { return this.site.adminDocument(id); }
  @Post("policies") savePolicy(@Body() dto: SaveLegalDocumentDto, @CurrentUser() user: RequestUser) { return this.site.saveDocument(dto, user.id); }
  @Get("faq") faq() { return this.site.faqs(true); }
  @Post("faq/categories") createCategory(@Body() dto: FaqCategoryDto, @CurrentUser() user: RequestUser) { return this.site.saveCategory(dto, user.id); }
  @Patch("faq/categories/:id") saveCategory(@Param("id", ParseUUIDPipe) id: string, @Body() dto: FaqCategoryDto, @CurrentUser() user: RequestUser) { return this.site.saveCategory(dto, user.id, id); }
  @Post("faq/questions") createQuestion(@Body() dto: FaqQuestionDto, @CurrentUser() user: RequestUser) { return this.site.saveQuestion(dto, user.id); }
  @Patch("faq/questions/:id") saveQuestion(@Param("id", ParseUUIDPipe) id: string, @Body() dto: FaqQuestionDto, @CurrentUser() user: RequestUser) { return this.site.saveQuestion(dto, user.id, id); }
  @Get("support") supportList(@Query() query: SupportListDto) { return this.support.list(query); }
  @Get("support/:id") supportDetail(@Param("id", ParseUUIDPipe) id: string) { return this.support.detail(id); }
  @Patch("support/:id") supportUpdate(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateSupportDto, @CurrentUser() user: RequestUser) { return this.support.update(id, dto, user.id); }
}
