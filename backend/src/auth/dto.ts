import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { ProfileType } from "@prisma/client";
import { RegistrationConsentDto } from "../site/site.dto";

export const PASSWORD_POLICY_REGEX = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
export const PASSWORD_POLICY_MESSAGE = "비밀번호는 8자 이상이며 영문과 숫자를 모두 포함해야 해요";

class RegisterAgreementsDto extends RegistrationConsentDto {}

export class RequestRegistrationEmailDto {
  @ApiProperty()
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class VerifyRegistrationEmailDto extends RequestRegistrationEmailDto {
  @ApiProperty()
  @IsUUID()
  challengeId!: string;

  @ApiProperty()
  @IsString()
  @Matches(/^\d{6}$/, { message: "인증번호 6자리를 입력해 주세요" })
  code!: string;
}

export class RegisterDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @Matches(/^[a-f0-9]{64}$/, { message: "이메일 인증을 먼저 완료해 주세요" })
  emailVerificationToken!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(128)
  @MinLength(8)
  @Matches(PASSWORD_POLICY_REGEX, { message: PASSWORD_POLICY_MESSAGE })
  password!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @ApiProperty({ enum: ProfileType })
  @IsEnum(ProfileType)
  profileType!: ProfileType;

  @ApiProperty()
  @ValidateNested()
  @Type(() => RegisterAgreementsDto)
  agreements!: RegisterAgreementsDto;
}

export class LoginDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(1024)
  password!: string;
}

export class RefreshDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  refreshToken?: string;
}

export class ForgotPasswordDto {
  @ApiProperty()
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  @MaxLength(2048)
  token!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(128)
  @MinLength(8)
  @Matches(PASSWORD_POLICY_REGEX, { message: PASSWORD_POLICY_MESSAGE })
  newPassword!: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MaxLength(1024)
  currentPassword!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(128)
  @MinLength(8)
  @Matches(PASSWORD_POLICY_REGEX, { message: PASSWORD_POLICY_MESSAGE })
  newPassword!: string;
}
