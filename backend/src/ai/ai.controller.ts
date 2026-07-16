import { Body, Controller, Param, Post, Res, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { PlatformRoles } from "../common/decorators/platform-roles.decorator";
import { ProductionRoles } from "../common/decorators/production-roles.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RateLimitGuard } from "../common/guards/rate-limit.guard";
import { RateLimit } from "../common/decorators/rate-limit.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import type { RequestUser } from "../common/types/request-user";
import { AiService } from "./ai.service";
import { ApplyCueDraftDto, GenerateCueDraftDto } from "./dto";

type UploadedScriptFile = { buffer: Buffer; originalname: string; mimetype: string; size: number };

@ApiTags("ai")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@PlatformRoles("SUPER_ADMIN", "ORG_ADMIN")
@ProductionRoles("PRODUCER", "DIRECTOR", "MUSIC_DIRECTOR", "STAGE_MANAGER")
@Controller("productions/:productionId/ai")
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post("cue-draft")
  @UseGuards(RateLimitGuard)
  @RateLimit({
    name: "ai.cue-draft",
    defaultLimit: 5,
    defaultWindowMs: 60_000,
    limitEnv: "RATE_LIMIT_AI_DRAFT_LIMIT",
    windowMsEnv: "RATE_LIMIT_AI_DRAFT_WINDOW_MS",
    keyMode: "user-or-ip"
  })
  generate(
    @Param("productionId") productionId: string,
    @Body() dto: GenerateCueDraftDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.aiService.generateCueDraft(productionId, dto, user);
  }

  // 진행 상황을 NDJSON으로 흘려보낸다. 조각마다 progress, 마지막에 result(또는 error).
  @Post("cue-draft/stream")
  @UseGuards(RateLimitGuard)
  @RateLimit({
    name: "ai.cue-draft",
    defaultLimit: 5,
    defaultWindowMs: 60_000,
    limitEnv: "RATE_LIMIT_AI_DRAFT_LIMIT",
    windowMsEnv: "RATE_LIMIT_AI_DRAFT_WINDOW_MS",
    keyMode: "user-or-ip"
  })
  async generateStream(
    @Param("productionId") productionId: string,
    @Body() dto: GenerateCueDraftDto,
    @CurrentUser() user: RequestUser,
    @Res() res: Response
  ) {
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    const write = (obj: unknown) => res.write(`${JSON.stringify(obj)}\n`);
    try {
      const result = await this.aiService.generateCueDraft(productionId, dto, user, (done, total) =>
        write({ type: "progress", done, total })
      );
      write({ type: "result", ...result });
    } catch (error) {
      const status = typeof (error as { getStatus?: () => number }).getStatus === "function"
        ? (error as { getStatus: () => number }).getStatus()
        : 500;
      write({ type: "error", status, message: error instanceof Error ? error.message : "초안을 만들지 못했습니다" });
    } finally {
      res.end();
    }
  }

  @Post("extract")
  @UseGuards(RateLimitGuard)
  @RateLimit({
    name: "ai.extract",
    defaultLimit: 20,
    defaultWindowMs: 60_000,
    limitEnv: "RATE_LIMIT_AI_EXTRACT_LIMIT",
    windowMsEnv: "RATE_LIMIT_AI_EXTRACT_WINDOW_MS",
    keyMode: "user-or-ip"
  })
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 15 * 1024 * 1024 } }))
  extract(
    @Param("productionId") productionId: string,
    @UploadedFile() file: UploadedScriptFile | undefined,
    @CurrentUser() user: RequestUser
  ) {
    return this.aiService.extractTextFromUpload(productionId, user, file);
  }

  @Post("cue-draft/apply")
  @UseGuards(RateLimitGuard)
  @RateLimit({
    name: "ai.cue-draft-apply",
    defaultLimit: 10,
    defaultWindowMs: 60_000,
    limitEnv: "RATE_LIMIT_AI_APPLY_LIMIT",
    windowMsEnv: "RATE_LIMIT_AI_APPLY_WINDOW_MS",
    keyMode: "user-or-ip"
  })
  apply(
    @Param("productionId") productionId: string,
    @Body() dto: ApplyCueDraftDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.aiService.applyCueDraft(productionId, dto, user);
  }
}
