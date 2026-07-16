import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AssetsModule } from "../assets/assets.module";
import { RolesGuard } from "../common/guards/roles.guard";
import { PrismaModule } from "../prisma/prisma.module";
import { RunSheetsController } from "./run-sheets.controller";
import { RunSheetsService } from "./run-sheets.service";

@Module({
  imports: [PrismaModule, AssetsModule, JwtModule.register({})],
  controllers: [RunSheetsController],
  providers: [RunSheetsService, RolesGuard]
})
export class RunSheetsModule {}
