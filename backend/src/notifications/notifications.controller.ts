import { Controller, Get, Param, Patch, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import type { RequestUser } from "../common/types/request-user";
import { NotificationListQueryDto } from "./dto";
import { NotificationsService } from "./notifications.service";

@ApiTags("notifications")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  listMine(@CurrentUser() user: RequestUser, @Query() query: NotificationListQueryDto) {
    return this.notificationsService.listMine(user, query);
  }

  @Get("summary")
  getSummary(@CurrentUser() user: RequestUser) {
    return this.notificationsService.getSummary(user);
  }

  @Patch("read-all")
  markAllRead(@CurrentUser() user: RequestUser, @Query() query: NotificationListQueryDto) {
    return this.notificationsService.markAllRead(user, query);
  }

  @Patch(":notificationId/read")
  markRead(@CurrentUser() user: RequestUser, @Param("notificationId") notificationId: string) {
    return this.notificationsService.markRead(user, notificationId);
  }
}
