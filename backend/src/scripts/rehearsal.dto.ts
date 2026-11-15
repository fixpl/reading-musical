import { ArrayMaxSize, ArrayUnique, IsArray, IsInt, IsObject, IsString, Max, MaxLength, Min, MinLength } from "class-validator";

export class SaveRehearsalDto {
  @IsString() @MinLength(1) @MaxLength(100)
  source!: string;
  @IsInt() @Min(0) @Max(86_400_000)
  positionMs!: number;
  @IsArray() @ArrayUnique() @ArrayMaxSize(2000) @IsString({ each: true }) @MaxLength(100, { each: true })
  completedKeys!: string[];
  @IsObject()
  notes!: Record<string, string>;
  @IsInt() @Min(0) @Max(2147483646)
  expectedRevision!: number;
}
