import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { RolesGuard } from "../common/guards/roles.guard";
import { NotificationsModule } from "../notifications/notifications.module";
import { PrismaModule } from "../prisma/prisma.module";
import { ChecklistController } from "./checklist.controller";
import { ChecklistService } from "./checklist.service";

@Module({
  imports: [PrismaModule, JwtModule.register({}), NotificationsModule],
  controllers: [ChecklistController],
  providers: [ChecklistService, RolesGuard]
})
export class ChecklistModule {}
