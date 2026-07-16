import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PlanningMemosController } from "./planning-memos.controller";
import { PlanningMemosService } from "./planning-memos.service";

@Module({
  imports: [JwtModule.register({})],
  controllers: [PlanningMemosController],
  providers: [PlanningMemosService]
})
export class PlanningMemosModule {}
