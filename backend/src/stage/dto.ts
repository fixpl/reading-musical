import { ApiProperty, ApiPropertyOptional, PartialType } from "@nestjs/swagger";
import { IsEnum, IsNumber, IsObject, IsOptional, IsString, Max, Min, MinLength } from "class-validator";

export enum StageElementKind {
  ACTOR_SEAT = "ACTOR_SEAT",
  MUSIC_STAND = "MUSIC_STAND",
  LIGHT = "LIGHT",
  SOUND = "SOUND",
  PROP = "PROP",
  TABLE = "TABLE",
  CHAIR = "CHAIR",
  ENTRANCE = "ENTRANCE",
  OTHER = "OTHER"
}

export class CreateStagePlanDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  layout?: Record<string, unknown>;
}

export class UpdateStagePlanDto extends PartialType(CreateStagePlanDto) {}

export class CreateStageElementDto {
  @ApiProperty({ enum: StageElementKind })
  @IsEnum(StageElementKind)
  kind!: StageElementKind;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  label!: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  @Max(100)
  x!: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  @Max(100)
  y!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string | null;
}

export class UpdateStageElementDto extends PartialType(CreateStageElementDto) {}

export class PutStageSceneNoteDto {
  @ApiProperty()
  @IsString()
  note!: string;
}
