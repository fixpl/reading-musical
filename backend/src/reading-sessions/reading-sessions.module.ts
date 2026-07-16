import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { RolesGuard } from "../common/guards/roles.guard";
import { NotificationsModule } from "../notifications/notifications.module";
import { PrismaModule } from "../prisma/prisma.module";
import { GuestReadingController, ReadingSessionsController } from "./reading-sessions.controller";
import { ReadingSessionsService } from "./reading-sessions.service";

@Module({
  imports: [PrismaModule, JwtModule.register({}), NotificationsModule],
  controllers: [ReadingSessionsController, GuestReadingController],
  providers: [ReadingSessionsService, RolesGuard]
})
export class ReadingSessionsModule {}
