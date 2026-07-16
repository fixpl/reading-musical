import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { RolesGuard } from "../common/guards/roles.guard";
import { PrismaModule } from "../prisma/prisma.module";
import { CastingController } from "./casting.controller";
import { CastingService } from "./casting.service";

@Module({
  imports: [PrismaModule, JwtModule.register({})],
  controllers: [CastingController],
  providers: [CastingService, RolesGuard]
})
export class CastingModule {}
