import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from "class-validator";

export class CreatePlanningMemoDto {
  @ApiProperty({ description: "메모 내용" })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;

  @ApiPropertyOptional({ description: "연결할 공연 신청 문의 ID" })
  @IsOptional()
  @IsUUID()
  inquiryId?: string;
}

export class UpdatePlanningMemoDto {
  @ApiProperty({ description: "메모 내용" })
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;
}
