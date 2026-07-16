import { ApiProperty, ApiPropertyOptional, PartialType } from "@nestjs/swagger";
import { AttendanceStatus, EventType } from "@prisma/client";
import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MinLength,
  ValidateNested
} from "class-validator";

export class CreateScheduleEventDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  title!: string;

  @ApiPropertyOptional({ enum: EventType })
  @IsOptional()
  @IsEnum(EventType)
  type?: EventType;

  @ApiPropertyOptional({ enum: EventType, description: "PRD payload compatibility alias for type" })
  @IsOptional()
  @IsEnum(EventType)
  eventType?: EventType;

  @ApiProperty()
  @IsDateString()
  startAt!: string;

  @ApiProperty()
  @IsDateString()
  endAt!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  location?: string | null;

  @ApiPropertyOptional({ description: "PRD payload compatibility alias for location" })
  @IsOptional()
  @IsString()
  venue?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_tld: false })
  meetingUrl?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  sceneIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  musicCueIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  attendeeMembershipIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  overrideReason?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  notifyMembers?: boolean;
}

export class UpdateScheduleEventDto extends PartialType(CreateScheduleEventDto) {}

export class DeleteScheduleEventDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  reason!: string;
}

export class PutEventScenesDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsUUID(undefined, { each: true })
  sceneIds!: string[];
}

export class PutEventMusicCuesDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsUUID(undefined, { each: true })
  musicCueIds!: string[];
}

export class AttendanceEntryDto {
  @ApiProperty()
  @IsUUID()
  membershipId!: string;

  @ApiPropertyOptional({ enum: AttendanceStatus, default: AttendanceStatus.INVITED })
  @IsOptional()
  @IsEnum(AttendanceStatus)
  status?: AttendanceStatus;
}

export class UpsertAttendanceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  membershipId?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID(undefined, { each: true })
  membershipIds?: string[];

  @ApiPropertyOptional({ enum: AttendanceStatus })
  @IsOptional()
  @IsEnum(AttendanceStatus)
  status?: AttendanceStatus;

  @ApiPropertyOptional({ type: [AttendanceEntryDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttendanceEntryDto)
  attendances?: AttendanceEntryDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  overrideReason?: string | null;
}

export class CreateAvailabilityDto {
  @ApiPropertyOptional({ description: "본인에게만 보이는 개인 일정 제목" })
  @IsOptional()
  @IsString()
  title?: string | null;

  @ApiProperty()
  @IsDateString()
  startAt!: string;

  @ApiProperty()
  @IsDateString()
  endAt!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;

  @ApiPropertyOptional({ description: "본인에게만 보이는 개인 메모" })
  @IsOptional()
  @IsString()
  reason?: string | null;
}

export class UpdateAvailabilityDto extends PartialType(CreateAvailabilityDto) {}
