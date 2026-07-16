import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { ProductionsModule } from "../productions/productions.module";
import { AdminInquiriesController, InquiriesController } from "./inquiries.controller";
import { InquiriesService } from "./inquiries.service";

@Module({
  imports: [JwtModule.register({}), ProductionsModule],
  controllers: [InquiriesController, AdminInquiriesController],
  providers: [InquiriesService]
})
export class InquiriesModule {}
