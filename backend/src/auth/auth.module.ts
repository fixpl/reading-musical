import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { RateLimitGuard } from "../common/guards/rate-limit.guard";
import { MailModule } from "../mail/mail.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";

@Module({
  imports: [JwtModule.register({}), MailModule],
  controllers: [AuthController],
  providers: [AuthService, RateLimitGuard],
  exports: [JwtModule, AuthService]
})
export class AuthModule {}
