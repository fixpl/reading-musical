import { BadRequestException, ConflictException } from "@nestjs/common";
import { inquirySource, assertInquiryRevision, requireInquiryText, APPLICANT_STATUS_LABELS } from "./inquiry-domain";

describe("performance inquiry input rules", () => {
  it("keeps page and campaign without URL queries or access tokens", () => {
    expect(inquirySource({ sourcePage: "/inquiries/new?token=secret#private", sourceCampaign: "partner_2026", referrerHost: "EXAMPLE.ORG" })).toEqual({ channel: "WEB", page: "/inquiries/new", campaign: "partner_2026", referrerHost: "example.org", verified: false });
  });
  it.each(["//outside.invalid", "https://outside.invalid", "/../admin", "/path with spaces"])("does not trust arbitrary source pages %s", (sourcePage) => {
    expect(inquirySource({ sourcePage }).page).toBeNull();
  });
  it("does not mistake attribution for authorization or collect a whole referrer URL", () => {
    const value = inquirySource({ sourceCampaign: "name@example.org", referrerHost: "https://example.org/?email=person" });
    expect(value.campaign).toBeNull(); expect(value.referrerHost).toBeNull(); expect(value.verified).toBe(false);
  });
  it("rejects stale or absent revisions", () => {
    expect(() => assertInquiryRevision(3, 2)).toThrow(ConflictException);
    expect(() => assertInquiryRevision(3, undefined as unknown as number)).toThrow(ConflictException);
    expect(() => assertInquiryRevision(3, 3)).not.toThrow();
  });
  it("trims required text and rejects whitespace-only values", () => {
    expect(requireInquiryText(" 문의 내용 ", "문의 내용")).toBe("문의 내용");
    expect(() => requireInquiryText("  ", "기관명")).toThrow(BadRequestException);
  });
  it("does not describe an internal production link as a confirmed contract", () => {
    expect(APPLICANT_STATUS_LABELS.CONVERTED).toBe("공연 준비 중");
  });
});
