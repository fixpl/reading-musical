import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { AssetKind } from "@prisma/client";
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Min, MinLength } from "class-validator";

export enum AssetPurpose {
  MUSIC_TRACK = "MUSIC_TRACK",
  SCRIPT_IMPORT = "SCRIPT_IMPORT",
  STAGE_EXPORT = "STAGE_EXPORT",
  RUN_SHEET_EXPORT = "RUN_SHEET_EXPORT",
  PROFILE_PHOTO = "PROFILE_PHOTO",
  CHECKLIST_EVIDENCE = "CHECKLIST_EVIDENCE",
  BACKGROUND_VIDEO = "BACKGROUND_VIDEO",
  CUE_MEDIA = "CUE_MEDIA"
}

export class CreateAssetDto {
  @ApiProperty({ enum: AssetPurpose })
  @IsEnum(AssetPurpose)
  purpose!: AssetPurpose;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  productionId?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  fileName!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  mimeType!: string;

  @ApiProperty({
    minimum: 1,
    maximum: 200 * 1024 * 1024,
    description: "파일 byte 크기. 실제 제한은 AssetPurpose별 정책(MUSIC 200MB, SCRIPT/CHECKLIST 50MB, IMAGE/EXPORT 10MB)을 적용한다."
  })
  @IsInt()
  @Min(1)
  size!: number;

  @ApiPropertyOptional({ example: "sha256:6a09e667f3bcc908b2fb1366ea957d3e3adec17512775099da2f590b0667322a" })
  @IsOptional()
  @IsString()
  checksum?: string | null;
}

export type AssetPolicy = {
  kind: AssetKind;
  maxBytes: number;
  allowedMimeTypes: string[];
  allowedExtensionsByMime: Record<string, string[]>;
  storagePrefix: string;
};
