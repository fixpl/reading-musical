import { Body, Controller, Get, Param, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { PlatformRoles } from "../common/decorators/platform-roles.decorator";
import { ProductionRoles } from "../common/decorators/production-roles.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import type { RequestUser } from "../common/types/request-user";
import { SaveRehearsalDto } from "./rehearsal.dto";
import { RehearsalService } from "./rehearsal.service";

@ApiTags("personal-rehearsal") @ApiBearerAuth()
@PlatformRoles("SUPER_ADMIN", "ORG_ADMIN")
@ProductionRoles("PRODUCER", "DIRECTOR", "MUSIC_DIRECTOR", "STAGE_MANAGER", "ACTOR", "STAFF", "GUEST")
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("productions/:pid/rehearsal/me")
export class RehearsalController {
  constructor(private readonly service: RehearsalService) {}
  @Get()
  list(@Param("pid") pid: string, @CurrentUser() user: RequestUser) { return this.service.list(pid, user); }
  @Put()
  save(@Param("pid") pid: string, @Body() dto: SaveRehearsalDto, @CurrentUser() user: RequestUser) { return this.service.save(pid, dto, user); }
}
