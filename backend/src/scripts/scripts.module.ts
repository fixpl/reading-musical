import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AssetsModule } from "../assets/assets.module";
import { RolesGuard } from "../common/guards/roles.guard";
import { MailModule } from "../mail/mail.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { PrismaModule } from "../prisma/prisma.module";
import { ScriptsController } from "./scripts.controller";
import { ScriptsService } from "./scripts.service";

@Module({
  imports: [PrismaModule, JwtModule.register({}), AssetsModule, NotificationsModule, MailModule],
  controllers: [ScriptsController],
  providers: [ScriptsService, RolesGuard]
})
export class ScriptsModule {}
