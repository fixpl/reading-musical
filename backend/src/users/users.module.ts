import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { RateLimitGuard } from "../common/guards/rate-limit.guard";
import { SiteModule } from "../site/site.module";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

@Module({
  imports: [JwtModule.register({}), SiteModule],
  controllers: [UsersController],
  providers: [UsersService, RateLimitGuard]
})
export class UsersModule {}
