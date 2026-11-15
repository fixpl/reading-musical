import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { MailService } from "./mail.service";
import { JwtModule } from "@nestjs/jwt";
import { RolesGuard } from "../common/guards/roles.guard";
import { MailStatusController } from "./mail-status.controller";

@Module({
  imports: [ConfigModule, JwtModule.register({})],
  controllers: [MailStatusController],
  providers: [MailService, RolesGuard],
  exports: [MailService]
})
export class MailModule {}
