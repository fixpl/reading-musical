import { Body, Controller, Get, Patch, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RateLimit } from "../common/decorators/rate-limit.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RateLimitGuard } from "../common/guards/rate-limit.guard";
import type { RequestUser } from "../common/types/request-user";
import { ChangePasswordDto, SearchUsersQueryDto, UpdateProfileDto, UpdateUserSettingsDto } from "./dto";
import { UsersService } from "./users.service";

@ApiTags("users")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RateLimitGuard)
@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @RateLimit({
    name: "users.search",
    defaultLimit: 120,
    defaultWindowMs: 60_000,
    limitEnv: "RATE_LIMIT_USER_SEARCH_LIMIT",
    windowMsEnv: "RATE_LIMIT_USER_SEARCH_WINDOW_MS",
    keyMode: "user-or-ip"
  })
  @Get("search")
  search(@Query() query: SearchUsersQueryDto, @CurrentUser() user: RequestUser) {
    return this.usersService.search(query, user);
  }

  @Patch("me/profile")
  updateMe(@CurrentUser() user: RequestUser, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateMe(user.id, dto);
  }

  @Patch("me/settings")
  updateMySettings(@CurrentUser() user: RequestUser, @Body() dto: UpdateUserSettingsDto) {
    return this.usersService.updateMySettings(user.id, dto);
  }

  @Patch("me/password")
  changeMyPassword(@CurrentUser() user: RequestUser, @Body() dto: ChangePasswordDto) {
    return this.usersService.changeMyPassword(user.id, dto);
  }
}
