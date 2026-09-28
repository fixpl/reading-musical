import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from "class-validator";

export const SECTION_KINDS = ["CHAPTER", "ACT", "SCENE", "SECTION"] as const;
export const MEDIA_MODES = ["INHERIT", "OWN", "NONE"] as const;
export const MEDIA_SLOTS = ["SCORE", "BACKGROUND", "MUSIC", "SOURCE"] as const;
export const MAX_COMPOSITION_MS = 86_400_000;
export type SectionKind = typeof SECTION_KINDS[number];
export type MediaMode = typeof MEDIA_MODES[number];
export type MediaSlot = typeof MEDIA_SLOTS[number];

export class CompositionRevisionDto {
  @IsInt() @Min(0) @Max(2147483646)
  expectedRevision!: number;
}

// null은 시간 자동 배치와 최상위 부모에만 허용한다. 본문/모드의 null은 거부한다.
export class WriteSectionDto extends CompositionRevisionDto {
  @ValidateIf((_o, v) => v !== undefined) @IsString() @MinLength(1) @MaxLength(200)
  title?: string;
  @ValidateIf((_o, v) => v !== undefined) @IsIn(SECTION_KINDS)
  kind?: SectionKind;
  @IsOptional() @IsUUID()
  parentId?: string | null;
  @ValidateIf((_o, v) => v !== undefined) @IsString() @MaxLength(200000)
  scriptText?: string;
  @ValidateIf((_o, v) => v !== undefined) @IsString() @MaxLength(200000)
  lyrics?: string;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_COMPOSITION_MS)
  startMs?: number | null;
  @IsOptional() @IsInt() @Min(1000) @Max(MAX_COMPOSITION_MS)
  durationMs?: number | null;
  @ValidateIf((_o, v) => v !== undefined) @IsIn(MEDIA_MODES)
  backgroundMode?: MediaMode;
  @ValidateIf((_o, v) => v !== undefined) @IsIn(MEDIA_MODES)
  musicMode?: MediaMode;
  @ValidateIf((_o, v) => v !== undefined) @IsIn(MEDIA_MODES)
  scoreMode?: MediaMode;
}

export class ReorderSectionsDto extends CompositionRevisionDto {
  @IsOptional() @IsUUID()
  parentId?: string | null;
  @IsArray() @ArrayUnique() @ArrayMinSize(1) @ArrayMaxSize(1000) @IsUUID(undefined, { each: true })
  sectionIds!: string[];
}

// 참고 첨부는 재생 설정 없이 등록한다. 파일 업로드 후 한 번에 연결한다.
export class AttachReferenceFilesDto extends CompositionRevisionDto {
  @IsArray() @ArrayUnique() @ArrayMinSize(1) @ArrayMaxSize(10) @IsUUID(undefined, { each: true })
  assetIds!: string[];
}

export class WriteCompositionMediaDto extends CompositionRevisionDto {
  @IsUUID() assetId!: string;
  @IsIn(MEDIA_SLOTS) slot!: MediaSlot;
  @ValidateIf((_o, v) => v !== undefined) @IsString() @MaxLength(255)
  label?: string;
  @ValidateIf((_o, v) => v !== undefined) @IsInt() @Min(0) @Max(MAX_COMPOSITION_MS)
  offsetMs?: number;
  @IsOptional() @IsInt() @Min(1000) @Max(MAX_COMPOSITION_MS)
  durationMs?: number | null;
  @ValidateIf((_o, v) => v !== undefined) @IsInt() @Min(0) @Max(MAX_COMPOSITION_MS)
  sourceStartMs?: number;
  @ValidateIf((_o, v) => v !== undefined) @IsInt() @Min(1) @Max(10000)
  page?: number;
  @ValidateIf((_o, v) => v !== undefined) @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0) @Max(1)
  volume?: number;
  @ValidateIf((_o, v) => v !== undefined) @IsBoolean()
  loop?: boolean;
}

export class PreviewCompositionImportDto {
  @IsOptional() @IsString() @MaxLength(200000)
  rawText?: string;
  @IsOptional() @IsUUID()
  assetId?: string;
  @IsOptional() @IsUUID()
  scriptId?: string;
}

export class ReviewedSectionDto {
  @IsString() @MinLength(1) @MaxLength(80) key!: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) parentKey?: string | null;
  @IsString() @MinLength(1) @MaxLength(200) title!: string;
  @IsIn(SECTION_KINDS) kind!: SectionKind;
  @IsString() @MaxLength(200000) scriptText!: string;
  @IsString() @MaxLength(200000) lyrics!: string;
  @IsOptional() @IsUUID() sourceScriptId?: string | null;
  @IsOptional() @IsUUID() sourceSceneId?: string | null;
}

export class ApplyCompositionImportDto extends CompositionRevisionDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => ReviewedSectionDto)
  sections!: ReviewedSectionDto[];
  @IsOptional() @IsUUID() sourceAssetId?: string;
}
