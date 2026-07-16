import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { BoardCategory } from "@prisma/client";
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class CreateBoardPostDto {
  @ApiPropertyOptional({ enum: BoardCategory, default: BoardCategory.QUESTION })
  @IsOptional()
  @IsEnum(BoardCategory)
  category?: BoardCategory;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;
}

export class UpdateBoardPostDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body?: string;

  @ApiPropertyOptional({ description: "상단 고정 여부 — 제작진만 변경 가능" })
  @IsOptional()
  @IsBoolean()
  pinned?: boolean;
}

export class CreateBoardCommentDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body!: string;
}
