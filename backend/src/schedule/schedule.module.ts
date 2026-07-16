import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { RolesGuard } from "../common/guards/roles.guard";
import { MailModule } from "../mail/mail.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { PrismaModule } from "../prisma/prisma.module";
import { MyScheduleController, ProductionScheduleController } from "./schedule.controller";
import { ScheduleService } from "./schedule.service";

@Module({
  imports: [PrismaModule, JwtModule.register({}), MailModule, NotificationsModule],
  controllers: [ProductionScheduleController, MyScheduleController],
  providers: [ScheduleService, RolesGuard]
})
export class ScheduleModule {}
