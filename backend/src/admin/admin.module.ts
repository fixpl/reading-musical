import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { RolesGuard } from "../common/guards/roles.guard";
import { MailModule } from "../mail/mail.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { PrismaModule } from "../prisma/prisma.module";
import { ScheduleModule } from "../schedule/schedule.module";
import { AdminController, OrgController } from "./admin.controller";
import { AdminOpsService } from "./admin-ops.service";
import { AdminService } from "./admin.service";
import { AssistantScheduleService } from "./assistant-schedule.service";
import { ProductionAssistantService } from "./production-assistant.service";

@Module({
  imports: [PrismaModule, JwtModule.register({}), NotificationsModule, MailModule, ScheduleModule],
  controllers: [AdminController, OrgController],
  providers: [AdminService, AdminOpsService, AssistantScheduleService, ProductionAssistantService, RolesGuard]
})
export class AdminModule {}
