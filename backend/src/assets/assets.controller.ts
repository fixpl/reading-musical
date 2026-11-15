import { Body, Controller, Get, Param, Post, Put, Query, Req, Res, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { createReadStream } from "node:fs";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import type { RequestUser } from "../common/types/request-user";
import { AssetsService } from "./assets.service";
import { AssetPurpose, CreateAssetDto } from "./dto";
import { SiteService } from "../site/site.service";
import { attachmentDisposition } from "./attachment-response";
import { parseByteRange } from "./asset-byte-range";

@ApiTags("assets")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("assets")
export class AssetsController {
  constructor(private readonly assetsService: AssetsService, private readonly site: SiteService) {}

  @Post()
  async createAsset(@Body() dto: CreateAssetDto, @CurrentUser() user: RequestUser) {
    // Consent is checked before issuing upload authorization, not only when linking the photo.
    if (dto.purpose === AssetPurpose.PROFILE_PHOTO) await this.site.recordProfileConsent(user.id, dto, "PROFILE_PHOTO");
    return this.assetsService.createAsset(dto, user);
  }

  @Get()
  listProductionMedia(@Query("productionId") productionId: string | undefined, @CurrentUser() user: RequestUser) {
    if (!productionId) {
      return [];
    }
    return this.assetsService.listProductionMedia(productionId, user);
  }

  @Get(":assetId/url")
  getSignedUrl(@Param("assetId") assetId: string, @CurrentUser() user: RequestUser) {
    return this.assetsService.getSignedUrl(assetId, user);
  }
}

@ApiTags("assets")
@Controller("assets")
export class AssetObjectsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Put(":assetId/mock-object")
  async putMockObject(
    @Param("assetId") assetId: string,
    @Query("action") action: string | undefined,
    @Query("expires") expires: string | undefined,
    @Query("signature") signature: string | undefined,
    @Req() request: Request
  ) {
    await this.assetsService.assertMockObjectAccess(assetId, "upload", { action, expires, signature });
    return this.assetsService.storeMockObject(assetId, await this.readRequestBody(request));
  }

  @Get(":assetId/mock-object")
  async getMockObject(
    @Param("assetId") assetId: string,
    @Query("action") action: string | undefined,
    @Query("expires") expires: string | undefined,
    @Query("signature") signature: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
    @Query("download") download?: string
  ) {
    await this.assetsService.assertMockObjectAccess(assetId, "download", { action, expires, signature });
    const object = await this.assetsService.getMockObjectInfo(assetId);
    response.setHeader("x-reading-musical-asset-id", assetId);
    response.setHeader("content-type", object.asset.mime === "text/plain" ? "text/plain; charset=utf-8" : object.asset.mime);
    response.setHeader("content-disposition", attachmentDisposition(object.asset, download === "1"));
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("cache-control", "private, no-store");
    response.setHeader("accept-ranges", "bytes");
    const range = parseByteRange(request.headers["if-range"] ? undefined : request.headers.range, object.sizeBytes);
    if (range === "unsatisfiable") {
      response.setHeader("content-range", `bytes */${object.sizeBytes}`);
      response.status(416).end();
      return;
    }
    if (range) response.setHeader("content-range", `bytes ${range.start}-${range.end}/${object.sizeBytes}`);
    response.setHeader("content-length", String(range ? range.end - range.start + 1 : object.sizeBytes));
    response.status(range ? 206 : 200);
    const stream = createReadStream(object.filePath, range ?? undefined);
    stream.on("error", (error) => response.destroy(error));
    response.on("close", () => stream.destroy());
    stream.pipe(response);
  }

  private async readRequestBody(request: Request) {
    const parsedBody = (request as Request & { body?: unknown }).body;
    if (Buffer.isBuffer(parsedBody)) {
      return parsedBody;
    }
    if (typeof parsedBody === "string") {
      return Buffer.from(parsedBody);
    }
    if (parsedBody && typeof parsedBody === "object" && Object.keys(parsedBody).length > 0) {
      return Buffer.from(JSON.stringify(parsedBody));
    }

    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
}
