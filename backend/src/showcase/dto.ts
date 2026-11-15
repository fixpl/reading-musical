import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsBoolean, IsDefined, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from "class-validator";

export const CREDIT_NOTICE_VERSION = "2026-10-23";

export class ShowcaseGalleryItemDto {
  @IsUUID() assetId!: string;
  @IsString() @MaxLength(200) caption!: string;
}

export class ShowcaseDocumentDto {
  @IsString() @MinLength(1) @MaxLength(120) title!: string;
  @IsString() @MaxLength(200) synopsis!: string;
  @IsString() @MaxLength(10000) description!: string;
  @IsString() @MaxLength(200) venue!: string;
  @IsOptional() @IsString() @MaxLength(10) startDate!: string | null;
  @IsOptional() @IsString() @MaxLength(10) endDate!: string | null;
  @IsOptional() @IsUUID() posterAssetId!: string | null;
  @IsString() @MaxLength(2048) officialUrl!: string;
  @IsString() @MaxLength(2048) ticketUrl!: string;
  @IsString() @MaxLength(2048) videoUrl!: string;
  @IsArray() @ArrayMaxSize(8) @ValidateNested({ each: true }) @Type(() => ShowcaseGalleryItemDto) gallery!: ShowcaseGalleryItemDto[];
}

export class ShowcaseRevisionDto {
  @IsInt() @Min(0) expectedRevision!: number;
}
export class SaveShowcaseDto extends ShowcaseRevisionDto {
  @IsDefined() @ValidateNested() @Type(() => ShowcaseDocumentDto) draft!: ShowcaseDocumentDto;
}
export class SavePerformanceCreditDto extends ShowcaseRevisionDto {
  @IsString() @MaxLength(80) displayName!: string;
  @IsBoolean() showName!: boolean;
  @IsBoolean() showPhoto!: boolean;
  @IsString() @MaxLength(40) noticeVersion!: string;
  @IsOptional() @IsString() @MaxLength(128) expectedPhotoToken?: string | null;
}
export class PublicPerformanceQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(60) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100000) offset?: number;
}

export type ShowcaseDocument = {
  title: string; synopsis: string; description: string; venue: string;
  startDate: string | null; endDate: string | null; posterAssetId: string | null;
  officialUrl: string; ticketUrl: string; videoUrl: string;
  gallery: Array<{ assetId: string; caption: string }>;
};
