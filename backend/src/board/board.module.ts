import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { BoardController } from "./board.controller";
import { BoardService } from "./board.service";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [JwtModule.register({}), NotificationsModule],
  controllers: [BoardController],
  providers: [BoardService]
})
export class BoardModule {}
