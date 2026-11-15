import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { BoardCategory } from "@prisma/client";
import { Transform, Type } from "class-transformer";
import { IsBoolean, IsEnum, IsIn, IsInt, ValidateIf, IsString, IsUUID, Max, MaxLength, Min, MinLength } from "class-validator";

export const BOARD_CHANNELS = ["GENERAL", "REHEARSAL", "TECH", "NOTICE", "MATERIAL"] as const;
export type BoardChannel = typeof BOARD_CHANNELS[number];
export type BoardVisibility = "TEAM" | "PRIVATE";
const supplied = (_object: unknown, value: unknown) => value !== undefined;
const trim = ({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value;

export class ListBoardPostsDto {
  @ValidateIf(supplied) @IsEnum(BoardCategory) category?: BoardCategory;
  @ValidateIf(supplied) @IsIn(BOARD_CHANNELS) channel?: BoardChannel;
  // ALL includes team posts and this caller's private notes only.
  @ValidateIf(supplied) @IsIn(["TEAM", "PRIVATE", "ALL"]) visibility?: BoardVisibility | "ALL";
  @ValidateIf(supplied) @IsString() @MaxLength(80) source?: string;
  @ValidateIf(supplied) @IsIn(["OPEN", "RESOLVED"]) status?: "OPEN" | "RESOLVED";
  @ValidateIf(supplied) @IsUUID() cursor?: string;
  @ValidateIf(supplied) @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class CreateBoardPostDto {
  @ApiPropertyOptional({ enum: BoardCategory, default: BoardCategory.QUESTION })
  @ValidateIf(supplied) @IsEnum(BoardCategory) category?: BoardCategory;
  @ApiPropertyOptional() @ValidateIf(supplied) @IsIn(BOARD_CHANNELS) channel?: BoardChannel;
  @ApiPropertyOptional() @ValidateIf(supplied) @IsIn(["TEAM", "PRIVATE"]) visibility?: BoardVisibility;
  @ApiPropertyOptional() @ValidateIf(supplied) @Transform(trim) @IsString() @MinLength(1) @MaxLength(120) title?: string;
  @ApiProperty() @Transform(trim) @IsString() @MinLength(1) @MaxLength(4000) body!: string;
  @ApiPropertyOptional() @ValidateIf(supplied) @IsString() @MinLength(1) @MaxLength(80) source?: string;
  @ApiPropertyOptional() @ValidateIf(supplied) @IsString() @MinLength(1) @MaxLength(100) unitKey?: string;
  @ApiPropertyOptional() @ValidateIf(supplied) @IsInt() @Min(0) @Max(86400000) positionMs?: number;
  @ApiPropertyOptional() @ValidateIf(supplied) @Transform(trim) @IsString() @MinLength(1) @MaxLength(120) contextLabel?: string;
}

export class UpdateBoardPostDto {
  @ApiPropertyOptional() @ValidateIf(supplied) @Transform(trim) @IsString() @MinLength(1) @MaxLength(120) title?: string;
  @ApiPropertyOptional() @ValidateIf(supplied) @Transform(trim) @IsString() @MinLength(1) @MaxLength(4000) body?: string;
  @ApiPropertyOptional() @ValidateIf(supplied) @IsBoolean() pinned?: boolean;
  @ApiPropertyOptional() @ValidateIf(supplied) @IsIn(["TEAM", "PRIVATE"]) visibility?: BoardVisibility;
  @ApiPropertyOptional() @ValidateIf(supplied) @IsIn(["OPEN", "RESOLVED"]) status?: "OPEN" | "RESOLVED";
  @ApiPropertyOptional() @ValidateIf(supplied) @IsInt() @Min(1) expectedRevision?: number;
}

export class CreateBoardCommentDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(1) @MaxLength(2000) body!: string;
}
