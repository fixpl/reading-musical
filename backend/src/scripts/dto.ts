import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { AnnotationType, SceneBlockType } from "@prisma/client";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsISO8601,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested
} from "class-validator";

export class CreateScriptDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @Matches(/\S/)
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({ default: "1막" })
  @IsOptional()
  @IsString()
  @Matches(/\S|^(?![\s\S])/)
  @MaxLength(200)
  initialActTitle?: string;

  @ApiPropertyOptional({ default: "1장" })
  @IsOptional()
  @IsString()
  @Matches(/\S|^(?![\s\S])/)
  @MaxLength(200)
  initialSceneTitle?: string;
}

export class CreateActDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @Matches(/\S/)
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({ default: "1장" })
  @IsOptional()
  @IsString()
  @Matches(/\S|^(?![\s\S])/)
  @MaxLength(200)
  initialSceneTitle?: string;
}

export class CreateSceneDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @Matches(/\S/)
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/\S|^(?![\s\S])/)
  @MaxLength(5000)
  summary?: string;
}

export class CreateBlockDto {
  @ApiProperty({ enum: SceneBlockType })
  @IsEnum(SceneBlockType)
  type!: SceneBlockType;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @Matches(/\S/)
  @MaxLength(20000)
  text!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  characterId?: string | null;

  @ApiPropertyOptional({ description: "import 화자명 또는 큐 표시 라벨" })
  @IsOptional()
  @IsString()
  @Matches(/\S|^(?![\s\S])/)
  @MaxLength(100)
  cueLabel?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  order?: number;
}

export class UpdateBlockDto {
  @ApiPropertyOptional({ description: "화면에서 읽은 줄의 updatedAt — 동시 편집 충돌 검사" })
  @IsOptional()
  @IsISO8601()
  expectedUpdatedAt?: string;

  @ApiPropertyOptional({ enum: SceneBlockType })
  @IsOptional()
  @IsEnum(SceneBlockType)
  type?: SceneBlockType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @Matches(/\S/)
  @MaxLength(20000)
  text?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  characterId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/\S|^(?![\s\S])/)
  @MaxLength(100)
  cueLabel?: string | null;

  @ApiPropertyOptional({ description: "타임라인 시작 위치(ms) — null이면 자동 흐름 배치" })
  @IsOptional()
  @IsInt()
  @Min(0)
  startMs?: number | null;

  @ApiPropertyOptional({ description: "타임라인 표시 길이(ms) — null이면 자동" })
  @IsOptional()
  @IsInt()
  @Min(1)
  durationMs?: number | null;
}

export class ReorderBlocksDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @IsUUID("4", { each: true })
  blockIds!: string[];
}

export class CreateScriptVersionDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @Matches(/\S/)
  @MaxLength(100)
  label!: string;
}

export class RestoreScriptVersionDto {
  @ApiPropertyOptional({ default: true, description: "복원 전 현재 대본을 백업 버전으로 저장할지 여부" })
  @IsOptional()
  @IsBoolean()
  createBackupVersion?: boolean;

  @ApiPropertyOptional({ description: "복원 전 백업 버전 라벨" })
  @IsOptional()
  @IsString()
  @Matches(/\S|^(?![\s\S])/)
  @MaxLength(100)
  backupLabel?: string;

  @ApiPropertyOptional({ default: false, description: "삭제될 블록의 주석/음악 큐 anchor를 BROKEN 처리하고 복원할지 여부" })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export class CreateScriptImportDto {
  @ApiPropertyOptional({ description: "업로드된 txt/docx/pdf Asset ID. assetId만 있으면 서버가 파일 본문에서 텍스트를 추출한다." })
  @IsOptional()
  @IsUUID()
  assetId?: string;

  @ApiPropertyOptional({ description: "txt/docx/pdf에서 추출된 원문 텍스트 또는 수동 붙여넣기" })
  @IsOptional()
  @IsString()
  @Matches(/\S|^(?![\s\S])/)
  @MaxLength(200000)
  rawText?: string;

  @ApiPropertyOptional({ enum: ["TXT", "DOCX", "PDF", "PASTE"] })
  @IsOptional()
  @IsIn(["TXT", "DOCX", "PDF", "PASTE"])
  sourceType?: "TXT" | "DOCX" | "PDF" | "PASTE";

  @ApiPropertyOptional({ enum: ["BLOCK_DRAFT"], default: "BLOCK_DRAFT" })
  @IsOptional()
  @IsIn(["BLOCK_DRAFT"])
  parseMode?: "BLOCK_DRAFT";
}

export class ReviewedImportBlockDto {
  @ApiProperty()
  @IsString()
  @Matches(/\S/)
  @MaxLength(100)
  tempId!: string;

  @ApiProperty({ enum: SceneBlockType })
  @IsEnum(SceneBlockType)
  type!: SceneBlockType;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @Matches(/\S/)
  @MaxLength(20000)
  text!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/\S|^(?![\s\S])/)
  @MaxLength(100)
  speakerName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/\S|^(?![\s\S])/)
  @MaxLength(200)
  actTitle?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/\S|^(?![\s\S])/)
  @MaxLength(200)
  sceneTitle?: string;
}

export class ApplyScriptImportDto {
  @ApiPropertyOptional({ enum: ["APPEND"], default: "APPEND" })
  @IsOptional()
  @IsIn(["APPEND"])
  mode?: "APPEND";

  @ApiPropertyOptional({ type: [ReviewedImportBlockDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => ReviewedImportBlockDto)
  reviewedBlocks?: ReviewedImportBlockDto[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  createVersion?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/\S|^(?![\s\S])/)
  @MaxLength(100)
  versionName?: string;
}

export class CreateAnnotationDto {
  @ApiProperty({ enum: AnnotationType })
  @IsEnum(AnnotationType)
  type!: AnnotationType;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @Matches(/\S/)
  @MaxLength(5000)
  content!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isShared?: boolean;
}

export class UpdateAnnotationDto {
  @ApiPropertyOptional({ enum: AnnotationType })
  @IsOptional()
  @IsEnum(AnnotationType)
  type?: AnnotationType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @Matches(/\S/)
  @MaxLength(5000)
  content?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isShared?: boolean;
}
