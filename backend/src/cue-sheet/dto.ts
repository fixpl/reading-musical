import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from "class-validator";

export class CreateCueTrackDto {
  @ApiProperty({ description: "트랙 이름 — 부서 또는 사람" })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name!: string;

  @ApiPropertyOptional({ description: "담당 멤버십 ID — 지정하면 그 사람이 이 트랙을 직접 작성한다" })
  @IsOptional()
  @IsUUID()
  ownerMembershipId?: string | null;
}

export class UpdateCueTrackDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  ownerMembershipId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}

export class CreateTrackCueDto {
  @ApiPropertyOptional({ description: "큐 번호 — 비우면 자동 부여" })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  cueNumber?: string;

  @ApiPropertyOptional({ description: "계기 — 신호를 주는 트리거 대사·타이밍" })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  trigger?: string;

  @ApiProperty({ description: "내용 — 실행할 동작·지시" })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  content!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sceneId?: string | null;

  @ApiPropertyOptional({ description: "인물(배역) ID — 배우 큐를 인물별로 묶어 본다" })
  @IsOptional()
  @IsUUID()
  characterId?: string | null;

  @ApiPropertyOptional({ description: "예상 소요 초 (1~3600)" })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3600)
  durationSec?: number | null;

  @ApiPropertyOptional({ description: "공연 시작 기준 시각(ms), null이면 자동 배치" })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(86_400_000)
  startMs?: number | null;

  @ApiPropertyOptional({ description: "첨부 미디어(영상·음원) Asset ID" })
  @IsOptional()
  @IsUUID()
  assetId?: string | null;
}

export class UpdateTrackCueDto {
  @ApiPropertyOptional({ description: "조회한 큐의 수정 시각 — 동시 편집 충돌 확인" })
  @IsOptional()
  @IsISO8601()
  expectedUpdatedAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  cueNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  trigger?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  content?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sceneId?: string | null;

  @ApiPropertyOptional({ description: "인물(배역) ID — null이면 해제" })
  @IsOptional()
  @IsUUID()
  characterId?: string | null;

  @ApiPropertyOptional({ description: "예상 소요 초 — null이면 해제" })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3600)
  durationSec?: number | null;

  @ApiPropertyOptional({ description: "공연 시작 기준 시각(ms), null이면 자동 배치" })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(86_400_000)
  startMs?: number | null;

  @ApiPropertyOptional({ description: "첨부 미디어(영상·음원) Asset ID — null이면 해제" })
  @IsOptional()
  @IsUUID()
  assetId?: string | null;
}

export class ReorderTrackCueDto {
  @ApiPropertyOptional({ description: "옮길 장면 ID — 생략하면 현재 장면 유지" })
  @IsOptional()
  @IsUUID()
  sceneId?: string | null;

  @ApiProperty({ description: "이 큐가 속한 트랙의 큐 ID를 새 순서대로 나열" })
  @IsArray()
  @ArrayMaxSize(4000)
  @ArrayUnique()
  @IsUUID("4", { each: true })
  orderedTrackCueIds!: string[];
}

export class ImportCueRowDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) cueNumber?: string;
  @ApiProperty({ description: "부서(트랙) 이름 — 없으면 새 트랙으로 만든다" }) @IsString() @MinLength(1) @MaxLength(40) track!: string;
  @ApiPropertyOptional({ description: "장면 제목 — 대본의 장면 제목과 맞으면 연결" }) @IsOptional() @IsString() @MaxLength(200) scene?: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(500) content!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) trigger?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) note?: string;
  @ApiPropertyOptional({ description: "출연(배역) 이름" }) @IsOptional() @IsString() @MaxLength(60) character?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(3600) durationSec?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(86_400_000) startMs?: number | null;
}

export class ImportCuesDto {
  @ApiProperty({ type: [ImportCueRowDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ImportCueRowDto)
  rows!: ImportCueRowDto[];

  @ApiPropertyOptional({ description: "미리보기만 하고 저장하지 않는다" })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
