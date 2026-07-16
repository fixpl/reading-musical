import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { InquiryStatus } from "@prisma/client";
import { IsEmail, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";
import { Type } from "class-transformer";

export class CreateInquiryDto {
  @ApiProperty({ description: "기관·단체명" })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  orgName!: string;

  @ApiProperty({ description: "담당자 성함" })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  contactName!: string;

  @ApiProperty()
  @IsEmail()
  @MaxLength(160)
  email!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @ApiPropertyOptional({ description: "희망 시기" })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  preferredTiming?: string;

  @ApiPropertyOptional({ description: "관람 대상" })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  audience?: string;

  @ApiProperty({ description: "문의 내용" })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message!: string;
}

export class UpdateInquiryDto {
  @ApiPropertyOptional({ enum: InquiryStatus })
  @IsOptional()
  @IsEnum(InquiryStatus)
  status?: InquiryStatus;

  @ApiPropertyOptional({ description: "운영 메모" })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  adminNote?: string;

  @ApiPropertyOptional({ description: "기획 단계 작성 내용(전환 시 공연 기획 메모로 이관)" })
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  planningNote?: string;
}

export class ConvertInquiryDto {
  @ApiPropertyOptional({ description: "생성할 공연 제목. 비우면 기관명 기준으로 만든다." })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string;
}

export class AdminInquiryListQueryDto {
  @ApiPropertyOptional({ enum: InquiryStatus })
  @IsOptional()
  @IsEnum(InquiryStatus)
  status?: InquiryStatus;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  take?: number;
}
