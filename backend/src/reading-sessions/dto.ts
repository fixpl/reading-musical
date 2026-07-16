import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsBoolean, IsDateString, IsInt, IsObject, IsOptional, IsString, IsUUID, MaxLength, Min } from "class-validator";

export class StartReadingSessionDto {
  @ApiProperty()
  @IsUUID()
  eventId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  runSheetId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  currentSceneId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  currentBlockId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  progressNote?: string | null;
}

export class UpdateReadingSessionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  currentSceneId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  currentBlockId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  runSheetItemId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  progressNote?: string | null;
}

export class FireReadingCueDto {
  @ApiProperty()
  @IsUUID()
  cueId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  runSheetItemId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  clientTimeMs?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}

export class EndReadingSessionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  progressNote?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  createFollowUpChecklist?: boolean;
}

export class CreateGuestReadingAccessDto {
  @ApiPropertyOptional({ description: "운영자가 구분하기 위한 링크 라벨" })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string | null;

  @ApiPropertyOptional({ description: "미지정 시 일정 종료 후 24시간" })
  @IsOptional()
  @IsDateString()
  expiresAt?: string | null;
}

export class RevokeGuestReadingAccessDto {
  @ApiProperty({ description: "회수 사유. 감사 로그에 저장" })
  @IsString()
  @MaxLength(240)
  reason!: string;
}
