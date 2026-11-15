import { ApiProperty, ApiPropertyOptional, PartialType } from "@nestjs/swagger";
import { CueFireMode, CueType } from "@prisma/client";
import {
  ArrayMaxSize,
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
  MaxLength,
  Min,
  MinLength
} from "class-validator";

export class CreateMusicTrackDto {
  @ApiProperty()
  @IsUUID()
  assetId!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  @MinLength(1)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  durationMs?: number | null;

  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10000)
  @IsNumber({}, { each: true })
  waveformPeaks?: number[] | null;
}

export class UpdateMusicTrackDto extends PartialType(CreateMusicTrackDto) {}

export class CreateMusicCueDto {
  @ApiProperty()
  @IsString()
  @MaxLength(100)
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
  @Max(2_147_483_647)
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
  @Max(2_147_483_647)
  trackStartMs?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  trackEndMs?: number | null;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2_147_483_647)
  fadeInMs?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2_147_483_647)
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
  @MaxLength(2000)
  note?: string | null;
}

export class UpdateMusicCueDto extends PartialType(CreateMusicCueDto) {}

export class ReorderMusicCuesDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
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
