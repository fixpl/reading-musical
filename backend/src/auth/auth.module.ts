import { Module } from "@nestjs/common";
import { SiteModule } from "../site/site.module";
import { JwtModule } from "@nestjs/jwt";
import { RateLimitGuard } from "../common/guards/rate-limit.guard";
import { MailModule } from "../mail/mail.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { RegistrationEmailService } from "./registration-email.service";
import { RegistrationEmailRetentionService } from "./registration-email-retention.service";

@Module({
  imports: [JwtModule.register({}), MailModule, SiteModule],
  controllers: [AuthController],
  providers: [AuthService, RegistrationEmailService, RegistrationEmailRetentionService, RateLimitGuard],
  exports: [JwtModule, AuthService]
})
export class AuthModule {}
