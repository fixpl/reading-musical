import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { RolesGuard } from "../common/guards/roles.guard";
import { MailModule } from "../mail/mail.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { PrismaModule } from "../prisma/prisma.module";
import { MusicController } from "./music.controller";
import { MusicService } from "./music.service";

@Module({
  imports: [PrismaModule, JwtModule.register({}), NotificationsModule, MailModule],
  controllers: [MusicController],
  providers: [MusicService, RolesGuard]
})
export class MusicModule {}
