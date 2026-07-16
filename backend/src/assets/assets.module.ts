import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PrismaModule } from "../prisma/prisma.module";
import { AssetObjectsController, AssetsController } from "./assets.controller";
import { AssetsService } from "./assets.service";

@Module({
  imports: [PrismaModule, JwtModule.register({})],
  controllers: [AssetsController, AssetObjectsController],
  providers: [AssetsService],
  exports: [AssetsService]
})
export class AssetsModule {}
