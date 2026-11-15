import { Module } from "@nestjs/common";
import { SiteModule } from "../site/site.module";
import { JwtModule } from "@nestjs/jwt";
import { ProductionsModule } from "../productions/productions.module";
import { AdminInquiriesController, InquiriesController } from "./inquiries.controller";
import { InquiriesService } from "./inquiries.service";
import { InquiryAccessController } from "./inquiry-access.controller";
import { InquiryAccessService } from "./inquiry-access.service";
import { RateLimitGuard } from "../common/guards/rate-limit.guard";

@Module({
  imports: [JwtModule.register({}), ProductionsModule, SiteModule],
  controllers: [InquiriesController, AdminInquiriesController, InquiryAccessController],
  providers: [InquiriesService, InquiryAccessService, RateLimitGuard]
})
export class InquiriesModule {}
