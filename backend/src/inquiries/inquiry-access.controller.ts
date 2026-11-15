import { Body, Controller, Header, Post, UseGuards } from "@nestjs/common";
import { RateLimit } from "../common/decorators/rate-limit.decorator";
import { RateLimitGuard } from "../common/guards/rate-limit.guard";
import { InquiryAccessService } from "./inquiry-access.service";
import { ApplicantMessageDto, ReadInquiryAccessDto, RequestInquiryAccessDto, VerifyInquiryAccessDto } from "./inquiry-access.dto";

@Controller("inquiries/lookup")
@UseGuards(RateLimitGuard)
export class InquiryAccessController {
  constructor(private readonly access: InquiryAccessService) {}
  @Post("request") @Header("Cache-Control", "no-store")
  @RateLimit({ name: "inquiry.lookup.request", defaultLimit: 5, defaultWindowMs: 600000, keyMode: "ip" })
  request(@Body() dto: RequestInquiryAccessDto) { return this.access.request(dto); }
  @Post("verify") @Header("Cache-Control", "no-store")
  @RateLimit({ name: "inquiry.lookup.verify", defaultLimit: 15, defaultWindowMs: 600000, keyMode: "ip" })
  verify(@Body() dto: VerifyInquiryAccessDto) { return this.access.verify(dto); }
  @Post("detail") @Header("Cache-Control", "no-store")
  @RateLimit({ name: "inquiry.lookup.read", defaultLimit: 30, defaultWindowMs: 60000, keyMode: "ip" })
  detail(@Body() dto: ReadInquiryAccessDto) { return this.access.read(dto.accessToken); }
  @Post("messages") @Header("Cache-Control", "no-store")
  @RateLimit({ name: "inquiry.lookup.message", defaultLimit: 10, defaultWindowMs: 600000, keyMode: "ip" })
  message(@Body() dto: ApplicantMessageDto) { return this.access.message(dto); }
  @Post("logout") @Header("Cache-Control", "no-store")
  @RateLimit({ name: "inquiry.lookup.logout", defaultLimit: 30, defaultWindowMs: 60000, keyMode: "ip" })
  logout(@Body() dto: ReadInquiryAccessDto) { return this.access.logout(dto.accessToken); }
}
