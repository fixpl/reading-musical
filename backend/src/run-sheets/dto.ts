import { ApiProperty, ApiPropertyOptional, PartialType } from "@nestjs/swagger";
import { ProductionRole, RunSheetItemType, StaffDiscipline } from "@prisma/client";
import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Min, MinLength } from "class-validator";

export class CreateRunSheetDto {
  @ApiProperty()
  @IsUUID()
  eventId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string | null;
}

export class GenerateRunSheetDto {
  @ApiProperty()
  @IsUUID()
  eventId!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  includeMusicCues?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  includeStageNotes?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  includeChecklistItems?: boolean;
}

export class LockRunSheetDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  versionName?: string | null;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  confirmMissingAnchors?: boolean;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  reason!: string;
}

export class ReviseRunSheetDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string | null;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  reason!: string;
}

export class CompleteRunSheetDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  reason!: string;
}

export class CreateRunSheetItemDto {
  @ApiProperty({ enum: RunSheetItemType })
  @IsEnum(RunSheetItemType)
  itemType!: RunSheetItemType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  order?: number;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sceneId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  cueId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  stageSceneNoteId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  checklistItemId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  estimatedDurationMin?: number | null;

  @ApiPropertyOptional({ enum: ProductionRole })
  @IsOptional()
  @IsEnum(ProductionRole)
  ownerRole?: ProductionRole | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  ownerMembershipId?: string | null;

  @ApiPropertyOptional({ enum: StaffDiscipline })
  @IsOptional()
  @IsEnum(StaffDiscipline)
  staffDiscipline?: StaffDiscipline | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string | null;
}

export class UpdateRunSheetItemDto extends PartialType(CreateRunSheetItemDto) {}

export class ReorderRunSheetItemsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsUUID(undefined, { each: true })
  itemIds!: string[];
}

export class DeleteRunSheetItemDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  reason!: string;
}

export class CompleteRunSheetItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  done?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string | null;
}
