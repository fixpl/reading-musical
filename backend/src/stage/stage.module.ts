import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AssetsModule } from "../assets/assets.module";
import { RolesGuard } from "../common/guards/roles.guard";
import { PrismaModule } from "../prisma/prisma.module";
import { StageController } from "./stage.controller";
import { StageService } from "./stage.service";

@Module({
  imports: [PrismaModule, JwtModule.register({}), AssetsModule],
  controllers: [StageController],
  providers: [StageService, RolesGuard]
})
export class StageModule {}
