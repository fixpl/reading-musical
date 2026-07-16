import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { RolesGuard } from "../common/guards/roles.guard";
import { MailModule } from "../mail/mail.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { PrismaModule } from "../prisma/prisma.module";
import { AdminController, OrgController } from "./admin.controller";
import { AdminService } from "./admin.service";

@Module({
  imports: [PrismaModule, JwtModule.register({}), NotificationsModule, MailModule],
  controllers: [AdminController, OrgController],
  providers: [AdminService, RolesGuard]
})
export class AdminModule {}
