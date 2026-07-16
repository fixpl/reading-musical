import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Phase, ProductionRole, StaffDiscipline, Visibility } from "@prisma/client";
import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested
} from "class-validator";

export class PositionRequirementDto {
  @ApiProperty({ enum: ProductionRole })
  @IsEnum(ProductionRole)
  role!: ProductionRole;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  label!: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  requiredCount?: number;
}

export class ReplacePositionRequirementsDto {
  @ApiProperty({ type: [PositionRequirementDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PositionRequirementDto)
  positions!: PositionRequirementDto[];
}

export class UpdatePositionRequirementDto {
  @ApiPropertyOptional({ enum: ProductionRole })
  @IsOptional()
  @IsEnum(ProductionRole)
  role?: ProductionRole;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  label?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  requiredCount?: number;
}

export class CreateProductionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  organizationId?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  slug?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  synopsis?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  venue?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ enum: Visibility })
  @IsOptional()
  @IsEnum(Visibility)
  visibility?: Visibility;

  @ApiPropertyOptional({ type: [PositionRequirementDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PositionRequirementDto)
  positionRequirements?: PositionRequirementDto[];
}

export class CheckProductionTitleQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  organizationId?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  excludeProductionId?: string;
}

export class UpdateProductionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  slug?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  synopsis?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  venue?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string | null;

  @ApiPropertyOptional({ enum: Visibility })
  @IsOptional()
  @IsEnum(Visibility)
  visibility?: Visibility;

  @ApiPropertyOptional({ enum: Phase })
  @IsOptional()
  @IsEnum(Phase)
  currentPhase?: Phase;

  @ApiPropertyOptional({ type: [PositionRequirementDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PositionRequirementDto)
  positionRequirements?: PositionRequirementDto[];
}

export class DuplicateProductionDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  slug?: string;
}

export class AddMembersDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  userIds!: string[];

  @ApiProperty({ enum: ProductionRole, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(ProductionRole, { each: true })
  roles!: ProductionRole[];

  @ApiProperty({ enum: ProductionRole })
  @IsEnum(ProductionRole)
  primaryRole!: ProductionRole;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  sendNotification?: boolean;
}

export class UpdateMemberDto {
  @ApiPropertyOptional({ enum: ProductionRole, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(ProductionRole, { each: true })
  roles?: ProductionRole[];

  @ApiPropertyOptional({ enum: ProductionRole })
  @IsOptional()
  @IsEnum(ProductionRole)
  primaryRole?: ProductionRole;
}

export class StaffAssignmentDto {
  @ApiProperty({ enum: StaffDiscipline })
  @IsEnum(StaffDiscipline)
  discipline!: StaffDiscipline;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customLabel?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isLead?: boolean;
}

export class PutStaffAssignmentsDto {
  @ApiProperty({ type: [StaffAssignmentDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StaffAssignmentDto)
  assignments!: StaffAssignmentDto[];
}

export class CreateInvitationDto {
  @ApiProperty()
  @IsString()
  email!: string;

  @ApiProperty({ enum: ProductionRole })
  @IsEnum(ProductionRole)
  role!: ProductionRole;
}

export class SearchProductionQueryDto {
  @ApiPropertyOptional({ description: "검색어. 2자 미만이면 빈 결과를 반환한다." })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  take?: number;
}
