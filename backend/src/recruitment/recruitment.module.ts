import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PrismaModule } from "../prisma/prisma.module";
import { RecruitmentManagerController, RecruitmentMemberController } from "./recruitment.controller";
import { RecruitmentService } from "./recruitment.service";

@Module({ imports: [PrismaModule, JwtModule.register({})], controllers: [RecruitmentMemberController, RecruitmentManagerController], providers: [RecruitmentService] })
export class RecruitmentModule {}
