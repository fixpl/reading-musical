import { Type } from "class-transformer";
import { RecruitmentApplicationStatus, RecruitmentPositionRole } from "@prisma/client";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDefined, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from "class-validator";

export class RecruitmentPageDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100000) offset?: number;
}
export class OpportunityQueryDto extends RecruitmentPageDto {
  @IsOptional() @IsString() @MaxLength(120) q?: string;
  @IsOptional() @IsEnum(RecruitmentPositionRole) role?: RecruitmentPositionRole;
}
export class RecruitmentPositionDto {
  @IsEnum(RecruitmentPositionRole) role!: RecruitmentPositionRole;
  @IsString() @MinLength(1) @MaxLength(100) label!: string;
  @IsInt() @Min(1) @Max(1000) capacity!: number;
}
export class RoundDocumentDto {
  @IsString() @MinLength(1) @MaxLength(120) title!: string;
  @IsString() @MaxLength(200) summary!: string;
  @IsString() @MaxLength(5000) description!: string;
  @IsString() @MaxLength(120) region!: string;
  @IsDefined() @IsOptional() @IsString() @MaxLength(10) activityStartDate!: string | null;
  @IsDefined() @IsOptional() @IsString() @MaxLength(10) activityEndDate!: string | null;
  @IsString() @MaxLength(2000) conditions!: string;
  @IsOptional() @IsString() @MaxLength(40) deadlineAt!: string | null;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => RecruitmentPositionDto) positions!: RecruitmentPositionDto[];
}
export class RecruitmentRevisionDto {
  @IsInt() @Min(0) expectedRevision!: number;
}
export class UpdateRecruitmentRoundDto extends RoundDocumentDto {
  @IsInt() @Min(1) expectedRevision!: number;
}
export class SubmitRecruitmentApplicationDto extends RecruitmentRevisionDto {
  @IsUUID() positionId!: string;
  @IsString() @MinLength(1) @MaxLength(2000) message!: string;
  @IsOptional() @IsString() @MaxLength(1000) availability?: string;
}
export class ReviewRecruitmentApplicationDto extends RecruitmentRevisionDto {
  @IsIn([RecruitmentApplicationStatus.REVIEWING, RecruitmentApplicationStatus.ON_HOLD, RecruitmentApplicationStatus.APPROVED, RecruitmentApplicationStatus.NOT_SELECTED]) status!: RecruitmentApplicationStatus;
  @IsOptional() @IsString() @MaxLength(1000) reviewMessage?: string;
}
