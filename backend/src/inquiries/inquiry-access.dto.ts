import { IsEmail, IsString, IsUUID, Length, Matches, MaxLength } from "class-validator";
import { Transform } from "class-transformer";
export class RequestInquiryAccessDto {
  @IsUUID() inquiryId!: string;
  @Transform(({ value }) => typeof value === "string" ? value.trim().toLowerCase() : value) @IsEmail() @MaxLength(160) email!: string;
}
export class VerifyInquiryAccessDto { @IsUUID() challengeId!: string; @IsString() @Matches(/^\d{6}$/) code!: string; }
export class ReadInquiryAccessDto { @IsString() @Matches(/^[a-f0-9]{64}$/) accessToken!: string; }
export class ApplicantMessageDto extends ReadInquiryAccessDto {
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value) @IsString() @Length(1, 5000) body!: string;
}
