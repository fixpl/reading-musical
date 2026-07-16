import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { BoardCategory } from "@prisma/client";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { PlatformRoles } from "../common/decorators/platform-roles.decorator";
import { ProductionRoles } from "../common/decorators/production-roles.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import type { RequestUser } from "../common/types/request-user";
import { BoardService } from "./board.service";
import { CreateBoardCommentDto, CreateBoardPostDto, UpdateBoardPostDto } from "./dto";

@ApiTags("board")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@PlatformRoles("SUPER_ADMIN", "ORG_ADMIN")
@ProductionRoles("PRODUCER", "DIRECTOR", "MUSIC_DIRECTOR", "STAGE_MANAGER", "ACTOR", "STAFF", "GUEST")
@Controller("productions/:productionId/board")
export class BoardController {
  constructor(private readonly boardService: BoardService) {}

  @Get()
  list(
    @Param("productionId") productionId: string,
    @CurrentUser() user: RequestUser,
    @Query("category") category?: BoardCategory
  ) {
    return this.boardService.list(productionId, category, user);
  }

  @Post()
  create(
    @Param("productionId") productionId: string,
    @Body() dto: CreateBoardPostDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.boardService.create(productionId, dto, user);
  }

  @Get(":postId")
  get(@Param("productionId") productionId: string, @Param("postId") postId: string, @CurrentUser() user: RequestUser) {
    return this.boardService.get(productionId, postId, user);
  }

  @Patch(":postId")
  update(
    @Param("productionId") productionId: string,
    @Param("postId") postId: string,
    @Body() dto: UpdateBoardPostDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.boardService.update(productionId, postId, dto, user);
  }

  @Delete(":postId")
  remove(
    @Param("productionId") productionId: string,
    @Param("postId") postId: string,
    @CurrentUser() user: RequestUser
  ) {
    return this.boardService.remove(productionId, postId, user);
  }

  @Post(":postId/comments")
  addComment(
    @Param("productionId") productionId: string,
    @Param("postId") postId: string,
    @Body() dto: CreateBoardCommentDto,
    @CurrentUser() user: RequestUser
  ) {
    return this.boardService.addComment(productionId, postId, dto, user);
  }

  @Delete(":postId/comments/:commentId")
  removeComment(
    @Param("productionId") productionId: string,
    @Param("postId") postId: string,
    @Param("commentId") commentId: string,
    @CurrentUser() user: RequestUser
  ) {
    return this.boardService.removeComment(productionId, postId, commentId, user);
  }
}
