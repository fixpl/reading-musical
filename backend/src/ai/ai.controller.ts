import { Body, Controller, Get, Param, Post, Res, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
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
import { ApplyCueDraftDto, GenerateCueDraftDto, MatchMediaDto } from "./dto";

type UploadedScriptFile = { buffer: Buffer; originalname: string; mimetype: string; size: number };

@ApiTags("ai")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@PlatformRoles("SUPER_ADMIN", "ORG_ADMIN")
@ProductionRoles("PRODUCER", "DIRECTOR", "MUSIC_DIRECTOR", "STAGE_MANAGER")
@Controller("productions/:productionId/ai")
export class AiController {
  constructor(private readonly aiService: AiService) {}

  // 대본 등록 마법사가 열릴 때 AI 모델이 응답하는지 미리 알려 준다(결과는 1분 동안 재사용).
  @Get("status")
  status(@Param("productionId") productionId: string, @CurrentUser() user: RequestUser) {
    return this.aiService.status(productionId, user);
  }

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
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) res: Response
  ) {
    return this.whileConnected(res, (signal) => this.aiService.generateCueDraft(productionId, dto, user, undefined, signal));
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
    const controller = new AbortController();
    const onClose = () => controller.abort();
    res.on("close", onClose);
    const write = (obj: unknown) => {
      if (!res.destroyed && !res.writableEnded) res.write(`${JSON.stringify(obj)}\n`);
    };
    try {
      const result = await this.aiService.generateCueDraft(productionId, dto, user,
        (done, total, stage) => write({ type: "progress", done, total, ...(stage ? { stage } : {}) }), controller.signal
      );
      write({ type: "result", ...result });
    } catch (error) {
      const status = typeof (error as { getStatus?: () => number }).getStatus === "function"
        ? (error as { getStatus: () => number }).getStatus()
        : 500;
      write({ type: "error", status, message: error instanceof Error ? error.message : "초안을 만들지 못했습니다" });
    } finally {
      res.off("close", onClose);
      if (!res.destroyed && !res.writableEnded) res.end();
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

  @Post("cue-sheet/extract")
  @UseGuards(RateLimitGuard)
  @RateLimit({ name: "ai.extract-cue-sheet", defaultLimit: 12, defaultWindowMs: 60_000, keyMode: "user-or-ip" })
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 2 * 1024 * 1024, files: 1 } }))
  extractCueSheet(
    @Param("productionId") productionId: string,
    @UploadedFile() file: UploadedScriptFile | undefined,
    @CurrentUser() user: RequestUser
  ) {
    return this.aiService.extractCueSheet(productionId, user, file);
  }

  // 영상·음원 파일 이름과 장면 제목·내용으로 어느 장면에 쓸지 추천한다(내용은 보지 않는다).
  @Post("match-media")
  @UseGuards(RateLimitGuard)
  @RateLimit({
    name: "ai.match-media",
    defaultLimit: 10,
    defaultWindowMs: 60_000,
    limitEnv: "RATE_LIMIT_AI_MATCH_LIMIT",
    windowMsEnv: "RATE_LIMIT_AI_MATCH_WINDOW_MS",
    keyMode: "user-or-ip"
  })
  matchMedia(
    @Param("productionId") productionId: string,
    @Body() dto: MatchMediaDto,
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) res: Response
  ) {
    return this.whileConnected(res, (signal) => this.aiService.matchMedia(productionId, dto.fileNames, user, signal));
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

  private async whileConnected<T>(res: Response, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const onClose = () => controller.abort();
    res.once("close", onClose);
    try {
      return await work(controller.signal);
    } finally {
      res.off("close", onClose);
    }
  }
}
