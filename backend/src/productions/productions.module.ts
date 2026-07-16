import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { RolesGuard } from "../common/guards/roles.guard";
import { MailModule } from "../mail/mail.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { InvitationsController, ProductionsController } from "./productions.controller";
import { ProductionsService } from "./productions.service";

@Module({
  imports: [JwtModule.register({}), MailModule, NotificationsModule],
  controllers: [ProductionsController, InvitationsController],
  providers: [ProductionsService, RolesGuard],
  exports: [ProductionsService]
})
export class ProductionsModule {}
