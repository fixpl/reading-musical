import { BadRequestException, ConflictException, ServiceUnavailableException } from "@nestjs/common";
import type { LegalDocument } from "@prisma/client";

export const LEGAL_KINDS = ["TERMS", "PRIVACY_POLICY", "SIGNUP_PRIVACY", "OPTIONAL_PROFILE", "PROFILE_PRIVACY", "MARKETING_PRIVACY", "MARKETING_EMAIL", "INQUIRY_PRIVACY"] as const;
export type LegalKind = (typeof LEGAL_KINDS)[number];
export const CONSENT_KINDS = ["SIGNUP_PRIVACY", "OPTIONAL_PROFILE", "PROFILE_PRIVACY", "MARKETING_PRIVACY", "MARKETING_EMAIL", "INQUIRY_PRIVACY"];
export const SITE_SETTING_KEY = "site.public";
export const SITE_TEXT_FIELDS = ["siteName", "siteDescription", "companyName", "representative", "businessNumber", "onlineSalesNumber", "address", "supportEmail", "supportPhone", "supportHours", "privacyOfficer", "privacyEmail", "copyrightHolder"] as const;
export type SiteInfo = Record<(typeof SITE_TEXT_FIELDS)[number], string> & { copyrightStartYear: number; supportRetentionDays: number };
export const DEFAULT_SITE_INFO: SiteInfo = {
  siteName: "아트브릿지", siteDescription: "리딩뮤지컬 공연 운영·참여 플랫폼", companyName: "", representative: "", businessNumber: "", onlineSalesNumber: "", address: "", supportEmail: "", supportPhone: "", supportHours: "", privacyOfficer: "", privacyEmail: "", copyrightHolder: "", copyrightStartYear: 2026, supportRetentionDays: 365
};
export function publicSiteInfo(raw: unknown): SiteInfo {
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const result = { ...DEFAULT_SITE_INFO };
  for (const key of SITE_TEXT_FIELDS) if (typeof value[key] === "string") result[key] = (value[key] as string).trim().slice(0, 1000);
  if (!result.siteName) result.siteName = DEFAULT_SITE_INFO.siteName;
  if (Number.isInteger(value.copyrightStartYear) && Number(value.copyrightStartYear) >= 1900 && Number(value.copyrightStartYear) <= 2100) result.copyrightStartYear = Number(value.copyrightStartYear);
  if (Number.isInteger(value.supportRetentionDays) && Number(value.supportRetentionDays) >= 1 && Number(value.supportRetentionDays) <= 3650) result.supportRetentionDays = Number(value.supportRetentionDays);
  return result;
}
export function requireCurrentDocument(documents: LegalDocument[], kind: LegalKind, suppliedId?: string): LegalDocument {
  const doc = documents.find((item) => item.kind === kind);
  if (!doc) throw new ServiceUnavailableException({ code: "POLICY_NOT_READY", message: "운영자가 필수 약관을 준비 중입니다. 잠시 후 다시 이용해 주세요." });
  if (suppliedId !== doc.id) throw new ConflictException({ code: "POLICY_CHANGED", message: "약관이 변경되었습니다. 새 내용을 확인하고 다시 동의해 주세요." });
  return doc;
}
export function assertMarketingSelection(privacy: boolean, email: boolean) {
  if (email && !privacy) throw new BadRequestException("이메일 광고 수신을 선택하려면 마케팅 목적 개인정보 이용에도 별도로 동의해 주세요.");
}
export function assertPublishable(input: { kind: string; body: string; purpose?: string; items?: string; retention?: string; refusal?: string }) {
  if (!input.body.trim()) throw new BadRequestException("공개할 문서 본문을 입력해 주세요.");
  const text = [input.body, input.purpose, input.items, input.retention, input.refusal].filter(Boolean).join("\n");
  if (/\[검토용 기본안\]|\[운영자 확인[^\]]*\]|\{\{(?:site|company|privacy_email|support_days)\}\}/.test(text)) {
    throw new BadRequestException("기본안의 ‘검토용 기본안’ 및 ‘운영자 확인’ 표시를 실제 운영 내용으로 검토·수정한 뒤 공개해 주세요. 초안 저장은 가능합니다.");
  }
  if (CONSENT_KINDS.includes(input.kind) && [input.purpose, input.items, input.retention, input.refusal].some((value) => !value?.trim())) {
    throw new BadRequestException("동의 문서는 목적·항목·보유기간·동의 거부권 안내를 모두 입력해야 공개할 수 있습니다.");
  }
}
