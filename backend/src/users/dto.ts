import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Gender, ProfileType, UserStatus } from "@prisma/client";
import { Transform, Type } from "class-transformer";
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  MinLength
} from "class-validator";

const PASSWORD_POLICY_REGEX = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
const PASSWORD_POLICY_MESSAGE = "비밀번호는 8자 이상이며 영문과 숫자를 모두 포함해야 해요";

function toOptionalBoolean({ value }: { value: unknown }) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  return String(value).toLowerCase() === "true";
}

export class SearchUsersQueryDto {
  @ApiPropertyOptional({ description: "이름, 이메일, 전화번호 검색어. 필터 없이 검색어만 사용할 때는 2자 이상." })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ enum: ProfileType })
  @IsOptional()
  @IsEnum(ProfileType)
  profileType?: ProfileType;

  @ApiPropertyOptional({ enum: Gender })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  profileComplete?: boolean;

  @ApiPropertyOptional({ description: "주소/지역 부분 검색" })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiPropertyOptional({ description: "profileDetails JSON 문자열 검색. 예: 음역, 악기, 전문분야" })
  @IsOptional()
  @IsString()
  specialty?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 120 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(120)
  minAge?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 120 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(120)
  maxAge?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minParticipationCount?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxParticipationCount?: number;

  @ApiPropertyOptional({ description: "이 공연에 이미 매칭된 사용자를 제외할 때 사용" })
  @IsOptional()
  @IsUUID()
  productionId?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  excludeAlreadyMembers?: boolean;

  @ApiPropertyOptional({ description: "가용성 충돌 제외 시작 시각" })
  @IsOptional()
  @IsDateString()
  availableStartAt?: string;

  @ApiPropertyOptional({ description: "가용성 충돌 제외 종료 시각" })
  @IsOptional()
  @IsDateString()
  availableEndAt?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  take?: number;
}

export class UpdateProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ enum: ProfileType })
  @IsOptional()
  @IsEnum(ProfileType)
  profileType?: ProfileType;

  @ApiPropertyOptional({ enum: Gender })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  birthDate?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  profileDetails?: Record<string, unknown> | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  photoAssetId?: string | null;
}

export class UpdateUserSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  emailNotify?: boolean;

  @ApiPropertyOptional({ enum: ["ko", "en"] })
  @IsOptional()
  @IsIn(["ko", "en"])
  locale?: "ko" | "en";

  @ApiPropertyOptional({ enum: ["system", "light", "dark"] })
  @IsOptional()
  @IsIn(["system", "light", "dark"])
  theme?: "system" | "light" | "dark";
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  currentPassword!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @Matches(PASSWORD_POLICY_REGEX, { message: PASSWORD_POLICY_MESSAGE })
  newPassword!: string;
}
