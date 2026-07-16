import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { CastAssignmentKind } from "@prisma/client";
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MinLength
} from "class-validator";

export class CreateRoleDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string | null;
}

export class UpdateRoleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string | null;
}

export class UpsertCastAssignmentDto {
  @ApiProperty()
  @IsUUID()
  membershipId!: string;

  @ApiPropertyOptional({ enum: CastAssignmentKind, default: CastAssignmentKind.MAIN })
  @IsOptional()
  @IsEnum(CastAssignmentKind)
  kind?: CastAssignmentKind;
}

export class PutSceneRolesDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsUUID("4", { each: true })
  roleIds!: string[];

  @ApiPropertyOptional({ default: true, description: "화자 라벨이 배역명과 일치하는 대본 블록 characterId를 자동 연결한다." })
  @IsOptional()
  @IsBoolean()
  syncMatchingBlocks?: boolean;
}

export class MergeRoleDto {
  @ApiProperty({ description: "합칠 대상(살아남을) 배역 ID" })
  @IsUUID("4")
  targetRoleId!: string;
}
