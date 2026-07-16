import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsEnum, IsOptional, IsString, IsUUID, Max, Min } from "class-validator";

export enum NotificationStatusFilter {
  ALL = "ALL",
  UNREAD = "UNREAD",
  READ = "READ"
}

export enum NotificationCategoryFilter {
  ALL = "ALL",
  CHANGE = "CHANGE"
}

export class NotificationListQueryDto {
  @ApiPropertyOptional({ enum: NotificationStatusFilter, default: NotificationStatusFilter.ALL })
  @IsOptional()
  @IsEnum(NotificationStatusFilter)
  status?: NotificationStatusFilter;

  @ApiPropertyOptional({ enum: NotificationCategoryFilter, default: NotificationCategoryFilter.ALL })
  @IsOptional()
  @IsEnum(NotificationCategoryFilter)
  category?: NotificationCategoryFilter;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  productionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(100)
  take?: number;
}
