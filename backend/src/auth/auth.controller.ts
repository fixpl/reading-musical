import { Body, Controller, Get, Post, Req, Res, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RateLimit } from "../common/decorators/rate-limit.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RateLimitGuard } from "../common/guards/rate-limit.guard";
import type { RequestUser } from "../common/types/request-user";
import { AuthService } from "./auth.service";
import { ForgotPasswordDto, LoginDto, RefreshDto, RegisterDto, ResetPasswordDto } from "./dto";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @UseGuards(RateLimitGuard)
  @RateLimit({
    name: "auth.register",
    defaultLimit: 20,
    defaultWindowMs: 60_000,
    limitEnv: "RATE_LIMIT_REGISTER_LIMIT",
    windowMsEnv: "RATE_LIMIT_REGISTER_WINDOW_MS",
    keyMode: "ip-body"
  })
  @Post("register")
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.authService.register(dto);
    this.authService.attachRefreshCookie(response, result.tokens.refreshToken);
    return result;
  }

  @UseGuards(RateLimitGuard)
  @RateLimit({
    name: "auth.login",
    defaultLimit: 60,
    defaultWindowMs: 60_000,
    limitEnv: "RATE_LIMIT_LOGIN_LIMIT",
    windowMsEnv: "RATE_LIMIT_LOGIN_WINDOW_MS",
    keyMode: "ip-body"
  })
  @Post("login")
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.authService.login(dto);
    this.authService.attachRefreshCookie(response, result.tokens.refreshToken);
    return result;
  }

  @ApiHeader({
    name: "x-reading-musical-csrf",
    required: false,
    description: "HttpOnly refresh cookie만으로 갱신할 때 필요한 CSRF header"
  })
  @Post("refresh")
  async refresh(
    @Body() dto: RefreshDto = {},
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    const cookieRefreshToken = this.authService.readRefreshCookie(request.headers.cookie);
    const refreshToken = dto.refreshToken || cookieRefreshToken;
    if (!dto.refreshToken && cookieRefreshToken) {
      this.authService.assertCookieRefreshCsrf(request.headers.cookie, request.headers["x-reading-musical-csrf"], cookieRefreshToken);
    }
    const result = await this.authService.refresh({ refreshToken });
    this.authService.attachRefreshCookie(response, result.tokens.refreshToken);
    return result;
  }

  @UseGuards(RateLimitGuard)
  @RateLimit({
    name: "auth.password.forgot",
    defaultLimit: 20,
    defaultWindowMs: 60_000,
    limitEnv: "RATE_LIMIT_PASSWORD_RESET_LIMIT",
    windowMsEnv: "RATE_LIMIT_PASSWORD_RESET_WINDOW_MS",
    keyMode: "ip-body"
  })
  @Post("password/forgot")
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @UseGuards(RateLimitGuard)
  @RateLimit({
    name: "auth.password.reset",
    defaultLimit: 20,
    defaultWindowMs: 60_000,
    limitEnv: "RATE_LIMIT_PASSWORD_RESET_LIMIT",
    windowMsEnv: "RATE_LIMIT_PASSWORD_RESET_WINDOW_MS",
    keyMode: "ip-body"
  })
  @Post("password/reset")
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post("logout")
  async logout(@CurrentUser() user: RequestUser, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const refreshToken = this.authService.readRefreshCookie(request.headers.cookie);
    await this.authService.logout(user.id, refreshToken);
    this.authService.clearRefreshCookie(response);
    return { ok: true };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get("me")
  me(@CurrentUser() user: RequestUser) {
    return this.authService.getMe(user.id);
  }
}
