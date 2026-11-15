import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Put, Query, Res, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { PlatformRoles } from "../common/decorators/platform-roles.decorator";
import { ProductionRoles } from "../common/decorators/production-roles.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import type { RequestUser } from "../common/types/request-user";
import { PublicPerformanceQueryDto, SavePerformanceCreditDto, SaveShowcaseDto, ShowcaseRevisionDto } from "./dto";
import { ShowcaseService } from "./showcase.service";

@ApiTags("showcase")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@PlatformRoles("SUPER_ADMIN", "ORG_ADMIN")
@ProductionRoles("PRODUCER")
@Controller("productions/:pid/showcase")
export class ShowcaseEditorController {
  constructor(private readonly showcase: ShowcaseService) {}
  @Get() @Header("Cache-Control", "private, no-store")
  editor(@Param("pid", ParseUUIDPipe) pid: string, @CurrentUser() user: RequestUser) { return this.showcase.editor(pid, user); }
  @Put() @Header("Cache-Control", "private, no-store")
  save(@Param("pid", ParseUUIDPipe) pid: string, @Body() dto: SaveShowcaseDto, @CurrentUser() user: RequestUser) { return this.showcase.save(pid, dto, user); }
  @Post("publish") @Header("Cache-Control", "private, no-store")
  publish(@Param("pid", ParseUUIDPipe) pid: string, @Body() dto: ShowcaseRevisionDto, @CurrentUser() user: RequestUser) { return this.showcase.publish(pid, dto.expectedRevision, user); }
  @Post("unpublish") @Header("Cache-Control", "private, no-store")
  unpublish(@Param("pid", ParseUUIDPipe) pid: string, @Body() dto: ShowcaseRevisionDto, @CurrentUser() user: RequestUser) { return this.showcase.unpublish(pid, dto.expectedRevision, user); }
}

@ApiTags("admin/showcase")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@PlatformRoles("SUPER_ADMIN")
@Controller("admin/production-showcases")
export class AdminShowcaseController {
  constructor(private readonly showcase: ShowcaseService) {}
  @Get() @Header("Cache-Control", "private, no-store")
  summaries(@CurrentUser() user: RequestUser) { return this.showcase.summaries(user); }
}

@ApiTags("showcase/credits")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("showcase/me/credits")
export class MyPerformanceCreditController {
  constructor(private readonly showcase: ShowcaseService) {}
  @Get() @Header("Cache-Control", "private, no-store")
  list(@CurrentUser() user: RequestUser) { return this.showcase.myCredits(user); }
  @Put(":productionId") @Header("Cache-Control", "private, no-store")
  save(@Param("productionId", ParseUUIDPipe) productionId: string, @Body() dto: SavePerformanceCreditDto, @CurrentUser() user: RequestUser) { return this.showcase.saveCredit(productionId, dto, user); }
}

@ApiTags("public/performances")
@Controller("public/performances")
export class PublicPerformanceController {
  constructor(private readonly showcase: ShowcaseService) {}
  @Get() @Header("Cache-Control", "no-store")
  list(@Query() query: PublicPerformanceQueryDto) { return this.showcase.listPublic(query.limit, query.offset); }
  @Get(":slug") @Header("Cache-Control", "no-store")
  detail(@Param("slug", ParseUUIDPipe) slug: string) { return this.showcase.detailPublic(slug); }
  @Get(":slug/poster") @Header("Cache-Control", "no-store, max-age=0")
  async poster(@Param("slug", ParseUUIDPipe) slug: string, @Res() response: Response) { return this.sendImage(response, await this.showcase.publicImage(slug, "poster")); }
  @Get(":slug/gallery/:index") @Header("Cache-Control", "no-store, max-age=0")
  async gallery(@Param("slug", ParseUUIDPipe) slug: string, @Param("index") index: string, @Res() response: Response) { return this.sendImage(response, await this.showcase.publicImage(slug, "gallery", index)); }
  @Get(":slug/credits/:creditId/photo") @Header("Cache-Control", "no-store, max-age=0")
  async photo(@Param("slug", ParseUUIDPipe) slug: string, @Param("creditId", ParseUUIDPipe) creditId: string, @Res() response: Response) { return this.sendImage(response, await this.showcase.publicImage(slug, "credit", creditId)); }
  private sendImage(response: Response, image: { body: Buffer; mime: string }) {
    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Type", image.mime);
    response.setHeader("Content-Length", image.body.length);
    return response.end(image.body);
  }
}
