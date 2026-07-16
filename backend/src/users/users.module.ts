import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { RateLimitGuard } from "../common/guards/rate-limit.guard";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

@Module({
  imports: [JwtModule.register({})],
  controllers: [UsersController],
  providers: [UsersService, RateLimitGuard]
})
export class UsersModule {}
