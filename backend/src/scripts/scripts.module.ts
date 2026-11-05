import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AssetsModule } from "../assets/assets.module";
import { RolesGuard } from "../common/guards/roles.guard";
import { MailModule } from "../mail/mail.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { PrismaModule } from "../prisma/prisma.module";
import { ScriptsController } from "./scripts.controller";
import { ScriptsService } from "./scripts.service";
import { ScriptEntityLookupService } from "./script-entity-lookup.service";
import { ScriptImportService } from "./script-import.service";
import { ScriptNotificationsService } from "./script-notifications.service";
import { ScriptSnapshotService } from "./script-snapshot.service";
import { CompositionController } from "./composition.controller";
import { CompositionService } from "./composition.service";

@Module({
  imports: [PrismaModule, JwtModule.register({}), AssetsModule, NotificationsModule, MailModule],
  controllers: [ScriptsController, CompositionController],
  providers: [
    ScriptsService,
    ScriptEntityLookupService,
    ScriptSnapshotService,
    ScriptNotificationsService,
    ScriptImportService,
    CompositionService,
    RolesGuard
  ]
})
export class ScriptsModule {}
