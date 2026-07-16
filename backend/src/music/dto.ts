import { ApiProperty, ApiPropertyOptional, PartialType } from "@nestjs/swagger";
import { CueFireMode, CueType } from "@prisma/client";
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength
} from "class-validator";

export class CreateMusicTrackDto {
  @ApiProperty()
  @IsUUID()
  assetId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  durationMs?: number | null;

  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  waveformPeaks?: number[] | null;
}

export class UpdateMusicTrackDto extends PartialType(CreateMusicTrackDto) {}

export class CreateMusicCueDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  cueNumber!: string;

  @ApiPropertyOptional({ enum: CueType, default: CueType.START })
  @IsOptional()
  @IsEnum(CueType)
  cueType?: CueType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  order?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sceneId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  anchorBlockId?: string | null;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  trackStartMs?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  trackEndMs?: number | null;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  fadeInMs?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  fadeOutMs?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(-60)
  @Max(12)
  volumeDb?: number;

  @ApiPropertyOptional({ enum: CueFireMode, default: CueFireMode.MANUAL })
  @IsOptional()
  @IsEnum(CueFireMode)
  fireMode?: CueFireMode;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string | null;
}

export class UpdateMusicCueDto extends PartialType(CreateMusicCueDto) {}

export class ReorderMusicCuesDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID("4", { each: true })
  cueIds!: string[];
}

export class UpdateCueAnchorDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sceneId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  anchorBlockId?: string | null;
}

export class FireCueDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}
