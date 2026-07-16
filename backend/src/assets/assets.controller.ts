import { Body, Controller, Get, Param, Post, Put, Query, Req, Res, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import type { RequestUser } from "../common/types/request-user";
import { AssetsService } from "./assets.service";
import { CreateAssetDto } from "./dto";

@ApiTags("assets")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("assets")
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Post()
  createAsset(@Body() dto: CreateAssetDto, @CurrentUser() user: RequestUser) {
    return this.assetsService.createAsset(dto, user);
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
    @Res() response: Response
  ) {
    await this.assetsService.assertMockObjectAccess(assetId, "download", { action, expires, signature });
    const object = await this.assetsService.readMockObject(assetId);
    response.setHeader("x-reading-musical-asset-id", assetId);
    response.setHeader("content-type", object.asset.mime);
    response.setHeader("content-length", String(object.sizeBytes));
    response.status(200).send(object.body);
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
