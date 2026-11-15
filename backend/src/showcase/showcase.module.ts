import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AssetsModule } from "../assets/assets.module";
import { PrismaModule } from "../prisma/prisma.module";
import { AdminShowcaseController, MyPerformanceCreditController, PublicPerformanceController, ShowcaseEditorController } from "./showcase.controller";
import { ShowcaseService } from "./showcase.service";

@Module({
  imports: [PrismaModule, AssetsModule, JwtModule.register({})],
  controllers: [ShowcaseEditorController, AdminShowcaseController, MyPerformanceCreditController, PublicPerformanceController],
  providers: [ShowcaseService]
})
export class ShowcaseModule {}
