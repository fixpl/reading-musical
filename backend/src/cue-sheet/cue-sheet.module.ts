import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { CueSheetController } from "./cue-sheet.controller";
import { CueSheetService } from "./cue-sheet.service";

@Module({
  imports: [JwtModule.register({})],
  controllers: [CueSheetController],
  providers: [CueSheetService]
})
export class CueSheetModule {}
