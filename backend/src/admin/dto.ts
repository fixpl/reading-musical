import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { AdminSettingValueType, AttendanceStatus, Gender, OrganizationStatus, Phase, ProductionRole, ProfileType, StaffDiscipline, UserStatus } from "@prisma/client";
import { Transform, Type } from "class-transformer";
import { IsBoolean, IsDateString, IsEnum, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from "class-validator";
import { PASSWORD_POLICY_MESSAGE, PASSWORD_POLICY_REGEX } from "../auth/dto";

export class ProductionAssistantDto {
  @IsString()
  @MinLength(2)
  @MaxLength(1_000)
  @Matches(/\S/, { message: "공연에 대해 물어볼 내용을 적어 주세요." })
  question!: string;

  @IsOptional()
  @IsUUID()
  eventId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  previousRequest?: string;
}

export class ConfirmAssistantScheduleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2_000)
  approvalToken!: string;
}

function toOptionalBoolean({ value }: { value: unknown }) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  return String(value).toLowerCase() === "true";
}

export class AdminListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  organizationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  productionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  userId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  actorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  entity?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  entityId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  status?: string;

  @ApiPropertyOptional({ enum: ProfileType })
  @IsOptional()
  @IsEnum(ProfileType)
  profileType?: ProfileType;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  profileComplete?: boolean;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  take?: number;

  @ApiPropertyOptional({ description: "yes=공연에 배정된 회원, no=아직 배정 안 된 회원" })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  assigned?: string;

  @ApiPropertyOptional({ description: "건너뛸 개수(페이지 이동용)" })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2_147_483_647)
  skip?: number;

  @ApiPropertyOptional({ description: "이 시각 이후(ISO 날짜)" })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  from?: string;

  @ApiPropertyOptional({ description: "이 시각 이전(ISO 날짜)" })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  to?: string;
}

export class AdminReasonDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}

export class CreateOrganizationDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ enum: OrganizationStatus })
  @IsOptional()
  @IsEnum(OrganizationStatus)
  status?: OrganizationStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}

export class UpdateOrganizationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ enum: OrganizationStatus })
  @IsOptional()
  @IsEnum(OrganizationStatus)
  status?: OrganizationStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}

export class ChangeUserStatusDto {
  @ApiProperty({ enum: UserStatus })
  @IsEnum(UserStatus)
  status!: UserStatus;

  @ApiProperty()
  @IsString()
  @MaxLength(2000)
  reason!: string;
}

export class UpdateUserProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;

  @ApiPropertyOptional({ enum: Gender })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiPropertyOptional({ enum: ProfileType })
  @IsOptional()
  @IsEnum(ProfileType)
  profileType?: ProfileType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  profileDetails?: Record<string, unknown>;
}

export class SetUserPasswordDto {
  @ApiPropertyOptional({ description: "비워두면 임시 비밀번호를 자동 발급합니다" })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  @MinLength(8)
  @Matches(PASSWORD_POLICY_REGEX, { message: PASSWORD_POLICY_MESSAGE })
  password?: string;
}

export class ProfileRequestDto {
  @ApiProperty()
  @IsString()
  @MaxLength(2000)
  reason!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;
}

export class CreateChecklistTemplateDto {
  @ApiProperty({ enum: Phase })
  @IsEnum(Phase)
  phase!: Phase;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  label!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @ApiPropertyOptional({ enum: ProductionRole })
  @IsOptional()
  @IsEnum(ProductionRole)
  assigneeRole?: ProductionRole | null;

  @ApiPropertyOptional({ enum: StaffDiscipline })
  @IsOptional()
  @IsEnum(StaffDiscipline)
  staffDiscipline?: StaffDiscipline | null;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  order?: number;

  @ApiProperty()
  @IsString()
  @MaxLength(2000)
  reason!: string;
}

export class UpdateChecklistTemplateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @ApiPropertyOptional({ enum: ProductionRole })
  @IsOptional()
  @IsEnum(ProductionRole)
  assigneeRole?: ProductionRole | null;

  @ApiPropertyOptional({ enum: StaffDiscipline })
  @IsOptional()
  @IsEnum(StaffDiscipline)
  staffDiscipline?: StaffDiscipline | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  order?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}

export class UpdateSystemSettingDto {
  @ApiPropertyOptional()
  @IsOptional()
  value?: unknown;

  @ApiPropertyOptional({ enum: AdminSettingValueType })
  @IsOptional()
  @IsEnum(AdminSettingValueType)
  valueType?: AdminSettingValueType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @ApiProperty()
  @IsString()
  @MaxLength(2000)
  reason!: string;
}

export class AdminAvailabilityDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiProperty()
  @IsDateString()
  startAt!: string;

  @ApiProperty()
  @IsDateString()
  endAt!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}

export class AdminAttendanceStatusDto {
  @ApiProperty({ enum: AttendanceStatus })
  @IsEnum(AttendanceStatus)
  status!: AttendanceStatus;
}
