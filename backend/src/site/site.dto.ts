import { Type, Transform } from "class-transformer";
import { IsBoolean, IsDateString, IsEmail, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from "class-validator";
import { LEGAL_KINDS } from "./site-policy";
const trim = ({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value;

export class SiteInfoDto {
  @Transform(trim) @IsString() @Length(1, 100) siteName!: string;
  @IsString() @MaxLength(500) siteDescription!: string;
  @IsString() @MaxLength(150) companyName!: string;
  @IsString() @MaxLength(100) representative!: string;
  @IsString() @MaxLength(30) businessNumber!: string;
  @IsString() @MaxLength(100) onlineSalesNumber!: string;
  @IsString() @MaxLength(500) address!: string;
  @IsString() @MaxLength(254) @ValidateIf((o) => o.supportEmail !== "") @IsEmail() supportEmail!: string;
  @IsString() @MaxLength(40) supportPhone!: string;
  @IsString() @MaxLength(300) supportHours!: string;
  @IsString() @MaxLength(100) privacyOfficer!: string;
  @IsString() @MaxLength(254) @ValidateIf((o) => o.privacyEmail !== "") @IsEmail() privacyEmail!: string;
  @IsString() @MaxLength(150) copyrightHolder!: string;
  @IsInt() @Min(1900) @Max(2100) copyrightStartYear!: number;
  @IsInt() @Min(1) @Max(3650) supportRetentionDays!: number;
}
export class SaveSiteSettingsDto {
  @IsInt() @Min(0) revision!: number;
  @IsObject() @ValidateNested() @Type(() => SiteInfoDto) info!: SiteInfoDto;
}
export class SaveLegalDocumentDto {
  @IsIn(LEGAL_KINDS) kind!: (typeof LEGAL_KINDS)[number];
  @IsInt() @Min(0) expectedVersion!: number;
  @Transform(trim) @IsString() @Length(1, 200) title!: string;
  @IsString() @MaxLength(100000) body!: string;
  @IsString() @MaxLength(4000) purpose!: string;
  @IsString() @MaxLength(4000) items!: string;
  @IsString() @MaxLength(4000) retention!: string;
  @IsString() @MaxLength(4000) refusal!: string;
  @IsDateString() effectiveAt!: string;
  @IsBoolean() publish!: boolean;
}
export class PolicyVersionsDto {
  @IsOptional() @IsUUID() termsDocumentId?: string;
  @IsOptional() @IsUUID() privacyDocumentId?: string;
  @IsOptional() @IsUUID() optionalProfileDocumentId?: string;
  @IsOptional() @IsUUID() marketingPrivacyDocumentId?: string;
  @IsOptional() @IsUUID() marketingEmailDocumentId?: string;
}
export class RegistrationConsentDto extends PolicyVersionsDto {
  @IsOptional() @IsIn(["published"]) mode?: "published";
  @IsBoolean() terms!: boolean;
  @IsBoolean() privacy!: boolean;
  @IsBoolean() age14!: boolean;
  @IsOptional() @IsBoolean() optionalProfile?: boolean;
  @IsOptional() @IsBoolean() marketingPrivacy?: boolean;
  @IsOptional() @IsBoolean() marketing?: boolean;
}
export class MarketingConsentDto extends PolicyVersionsDto {
  @IsInt() @Min(0) revision!: number;
  @IsBoolean() marketingPrivacy!: boolean;
  @IsBoolean() marketing!: boolean;
}
export class FaqCategoryDto {
  @Transform(trim) @IsString() @Length(1, 60) name!: string;
  @IsInt() @Min(0) @Max(100000) order!: number;
  @IsBoolean() active!: boolean;
  @IsOptional() @IsInt() @Min(1) revision?: number;
}
export class FaqQuestionDto {
  @IsUUID() categoryId!: string;
  @Transform(trim) @IsString() @Length(1, 200) title!: string;
  @Transform(trim) @IsString() @Length(1, 20000) body!: string;
  @IsInt() @Min(0) @Max(100000) order!: number;
  @IsBoolean() active!: boolean;
  @IsOptional() @IsInt() @Min(1) revision?: number;
}
export class InquiryConsentDto {
  @IsBoolean() privacyConsent!: boolean;
  @IsUUID() privacyDocumentId!: string;
  @IsBoolean() age14!: boolean;
  @IsOptional() @IsString() @MaxLength(200) website?: string;
}
export class CreateSupportDto extends InquiryConsentDto {
  @Transform(trim) @IsString() @Length(1, 60) contactName!: string;
  @Transform(trim) @IsEmail() @MaxLength(160) email!: string;
  @IsIn(["GENERAL", "ACCOUNT", "TECHNICAL", "PRIVACY", "OTHER"]) category!: string;
  @Transform(trim) @IsString() @Length(1, 150) subject!: string;
  @Transform(trim) @IsString() @Length(1, 5000) message!: string;
}
export class GuestSupportLookupDto {
  @IsUUID() ticketId!: string;
  @IsString() @Length(64, 64) key!: string;
}
export class SupportListDto {
  @IsOptional() @IsIn(["OPEN", "IN_PROGRESS", "ANSWERED", "CLOSED"]) status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5000) page?: number;
}
export class UpdateSupportDto {
  @IsInt() @Min(1) revision!: number;
  @IsIn(["OPEN", "IN_PROGRESS", "ANSWERED", "CLOSED"]) status!: string;
  @IsString() @MaxLength(10000) answer!: string;
  @IsString() @MaxLength(5000) internalNote!: string;
}
