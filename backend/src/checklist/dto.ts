import { ApiProperty, ApiPropertyOptional, PartialType } from "@nestjs/swagger";
import { ChecklistStatus, LinkedResourceType, Phase, ProductionRole, StaffDiscipline } from "@prisma/client";
import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength
} from "class-validator";

export class CreateChecklistItemDto {
  @ApiProperty({ enum: Phase })
  @IsEnum(Phase)
  phase!: Phase;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  order?: number;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  label!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
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
  @IsDateString()
  dueAt?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  eventId?: string | null;

  @ApiPropertyOptional({ enum: LinkedResourceType })
  @IsOptional()
  @IsEnum(LinkedResourceType)
  linkedResourceType?: LinkedResourceType | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  linkedResourceId?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  assignmentMembershipIds?: string[];
}

export class UpdateChecklistItemDto extends PartialType(CreateChecklistItemDto) {}

export class PutChecklistAssignmentsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsUUID(undefined, { each: true })
  membershipIds!: string[];
}

export class DeleteChecklistItemDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  reason!: string;
}

export class UpdateChecklistStatusDto {
  @ApiProperty({ enum: ChecklistStatus })
  @IsEnum(ChecklistStatus)
  status!: ChecklistStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  completionNote?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID(undefined, { each: true })
  evidenceAssetIds?: string[];
}

export class ApproveChecklistItemDto {
  @ApiProperty({ enum: ["APPROVED", "REJECTED"] })
  @IsIn(["APPROVED", "REJECTED"])
  decision!: "APPROVED" | "REJECTED";

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reviewNote?: string | null;
}
