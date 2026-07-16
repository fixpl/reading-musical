import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from "class-validator";

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
}

export class UpdateTrackCueDto {
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
}

export class ReorderTrackCueDto {
  @ApiPropertyOptional({ description: "옮길 장면 ID — 생략하면 현재 장면 유지" })
  @IsOptional()
  @IsUUID()
  sceneId?: string;

  @ApiProperty({ description: "이 큐가 속한 트랙의 큐 ID를 새 순서대로 나열" })
  @IsArray()
  @ArrayMaxSize(4000)
  @IsUUID("4", { each: true })
  orderedTrackCueIds!: string[];
}
