import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { BoardController } from "./board.controller";
import { BoardService } from "./board.service";

@Module({
  imports: [JwtModule.register({})],
  controllers: [BoardController],
  providers: [BoardService]
})
export class BoardModule {}
