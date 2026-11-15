import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { SiteModule } from "../site/site.module";
import { PrismaModule } from "../prisma/prisma.module";
import { AssetObjectsController, AssetsController } from "./assets.controller";
import { AssetsService } from "./assets.service";

@Module({
  imports: [PrismaModule, JwtModule.register({}), SiteModule],
  controllers: [AssetsController, AssetObjectsController],
  providers: [AssetsService],
  exports: [AssetsService]
})
export class AssetsModule {}
