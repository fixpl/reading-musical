import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { RolesGuard } from "../common/guards/roles.guard";
import { MailModule } from "../mail/mail.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { InvitationsController, ProductionsController } from "./productions.controller";
import { PositionRequirementsService } from "./position-requirements.service";
import { ProductionAccessService } from "./production-access.service";
import { ProductionActivityLogService } from "./production-activity-log.service";
import { ProductionDirectoryService } from "./production-directory.service";
import { ProductionMembersService } from "./production-members.service";
import { ProductionNotificationsService } from "./production-notifications.service";
import { ProductionReadinessService } from "./production-readiness.service";
import { ProductionsService } from "./productions.service";
import { StaffAssignmentsService } from "./staff-assignments.service";

@Module({
  imports: [JwtModule.register({}), MailModule, NotificationsModule],
  controllers: [ProductionsController, InvitationsController],
  providers: [
    ProductionsService,
    ProductionAccessService,
    ProductionActivityLogService,
    ProductionNotificationsService,
    PositionRequirementsService,
    StaffAssignmentsService,
    ProductionReadinessService,
    ProductionMembersService,
    ProductionDirectoryService,
    RolesGuard
  ],
  exports: [ProductionsService]
})
export class ProductionsModule {}
