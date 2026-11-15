import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from "class-validator";
import { MAX_TIMELINE_MS } from "./ai-contract";
import { cueTracks, type CueTrackName } from "./cue-sheet-document";

class DirectorActionDto {
  @IsIn(cueTracks)
  track!: CueTrackName;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  content!: string;
}

class DirectorCueFieldsDto {
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  number!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_TIMELINE_MS)
  startMs!: number | null;

  @IsString()
  @MaxLength(300)
  note!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => DirectorActionDto)
  actions!: DirectorActionDto[];
}

export class DirectorCueDto extends DirectorCueFieldsDto {
  @IsString()
  @MinLength(1)
  @MaxLength(12)
  id!: string;

  @IsInt()
  @Min(2)
  @Max(1_000)
  row!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  section!: string;
}

export class ReviewedDirectorCueDto extends DirectorCueFieldsDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(19)
  actIndex!: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(99)
  sceneIndex!: number | null;
}

export class GenerateCueDraftDto {
  @IsString()
  @MinLength(80, { message: "대본 내용이 너무 짧습니다 (80자 이상)" })
  @MaxLength(120_000, { message: "대본이 너무 깁니다 (12만 자 이내)" })
  text!: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => DirectorCueDto)
  cueSheet?: DirectorCueDto[];
}

export class ApplyCueDraftDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  scriptTitle?: string;

  // 지정하면 새 대본을 만들지 않고 이 대본에 막을 이어붙인다.
  @IsOptional()
  @IsString()
  targetScriptId?: string;

  @IsObject({ message: "적용할 초안이 없습니다" })
  draft!: unknown;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ReviewedDirectorCueDto)
  directorCues?: ReviewedDirectorCueDto[];
}

export class MatchMediaDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(60)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  fileNames!: string[];
}
