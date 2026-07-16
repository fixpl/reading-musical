import { IsObject, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class GenerateCueDraftDto {
  @IsString()
  @MinLength(80, { message: "대본 내용이 너무 짧습니다 (80자 이상)" })
  @MaxLength(120_000, { message: "대본이 너무 깁니다 (12만 자 이내)" })
  text!: string;
}

export class ApplyCueDraftDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  scriptTitle?: string;

  // 지정하면 새 대본을 만들지 않고 이 대본에 막을 이어붙인다.
  @IsOptional()
  @IsString()
  targetScriptId?: string;

  @IsObject({ message: "적용할 초안이 없습니다" })
  draft!: unknown;
}
