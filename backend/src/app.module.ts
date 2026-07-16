import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AdminModule } from "./admin/admin.module";
import { AuthModule } from "./auth/auth.module";
import { AssetsModule } from "./assets/assets.module";
import { AiModule } from "./ai/ai.module";
import { BoardModule } from "./board/board.module";
import { CastingModule } from "./casting/casting.module";
import { ChecklistModule } from "./checklist/checklist.module";
import { CueSheetModule } from "./cue-sheet/cue-sheet.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { HealthModule } from "./health/health.module";
import { InquiriesModule } from "./inquiries/inquiries.module";
import { MusicModule } from "./music/music.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { PlanningMemosModule } from "./planning-memos/planning-memos.module";
import { PrismaModule } from "./prisma/prisma.module";
import { ProductionsModule } from "./productions/productions.module";
import { ReadingSessionsModule } from "./reading-sessions/reading-sessions.module";
import { RunSheetsModule } from "./run-sheets/run-sheets.module";
import { ScheduleModule } from "./schedule/schedule.module";
import { ScriptsModule } from "./scripts/scripts.module";
import { StageModule } from "./stage/stage.module";
import { UsersModule } from "./users/users.module";
import { validateEnvironment } from "./config/env.validation";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    PrismaModule,
    HealthModule,
    AdminModule,
    AuthModule,
    AssetsModule,
    UsersModule,
    ProductionsModule,
    ScriptsModule,
    CastingModule,
    ChecklistModule,
    MusicModule,
    NotificationsModule,
    StageModule,
    ScheduleModule,
    RunSheetsModule,
    ReadingSessionsModule,
    DashboardModule,
    InquiriesModule,
    PlanningMemosModule,
    BoardModule,
    AiModule,
    CueSheetModule
  ]
})
export class AppModule {}
