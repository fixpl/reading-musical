import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { BoardCategory, PlatformRole, Prisma, ProductionRole } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestUser } from "../common/types/request-user";
import { CreateBoardCommentDto, CreateBoardPostDto, UpdateBoardPostDto } from "./dto";

const STAFF_ROLES: readonly ProductionRole[] = [
  ProductionRole.PRODUCER,
  ProductionRole.DIRECTOR,
  ProductionRole.MUSIC_DIRECTOR,
  ProductionRole.STAGE_MANAGER
];

const AUTHOR_SELECT = { select: { id: true, name: true, profileType: true } } as const;

@Injectable()
export class BoardService {
  constructor(private readonly prisma: PrismaService) {}

  async list(productionId: string, category: BoardCategory | undefined, user: RequestUser) {
    await this.assertOrgScope(productionId, user);
    const items = await this.prisma.boardPost.findMany({
      where: { productionId, category: category ?? undefined },
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
      include: {
        author: AUTHOR_SELECT,
        _count: { select: { comments: true } }
      }
    });
    return { items };
  }

  async get(productionId: string, postId: string, user: RequestUser) {
    await this.assertOrgScope(productionId, user);
    const post = await this.prisma.boardPost.findFirst({
      where: { id: postId, productionId },
      include: {
        author: AUTHOR_SELECT,
        comments: {
          orderBy: { createdAt: "asc" },
          include: { author: AUTHOR_SELECT }
        }
      }
    });
    if (!post) {
      throw new NotFoundException("글을 찾을 수 없습니다");
    }
    return post;
  }

  async create(productionId: string, dto: CreateBoardPostDto, user: RequestUser) {
    await this.assertOrgScope(productionId, user);
    const category = dto.category ?? BoardCategory.QUESTION;
    if (category === BoardCategory.NOTICE) {
      await this.assertStaff(productionId, user, "공지는 제작진만 작성할 수 있습니다");
    }

    return this.prisma.boardPost.create({
      data: {
        productionId,
        authorId: user.id,
        category,
        title: dto.title.trim(),
        body: dto.body.trim(),
        pinned: category === BoardCategory.NOTICE
      },
      include: { author: AUTHOR_SELECT, _count: { select: { comments: true } } }
    });
  }

  async update(productionId: string, postId: string, dto: UpdateBoardPostDto, user: RequestUser) {
    await this.assertOrgScope(productionId, user);
    const post = await this.findOrThrow(productionId, postId);

    if (dto.pinned !== undefined) {
      await this.assertStaff(productionId, user, "고정은 제작진만 변경할 수 있습니다");
    }
    if ((dto.title !== undefined || dto.body !== undefined) && post.authorId !== user.id) {
      await this.assertCanModerate(productionId, user, "작성자 또는 제작진만 수정할 수 있습니다");
    }

    return this.prisma.boardPost.update({
      where: { id: post.id },
      data: {
        title: dto.title?.trim(),
        body: dto.body?.trim(),
        pinned: dto.pinned
      },
      include: { author: AUTHOR_SELECT, _count: { select: { comments: true } } }
    });
  }

  async remove(productionId: string, postId: string, user: RequestUser) {
    await this.assertOrgScope(productionId, user);
    const post = await this.findOrThrow(productionId, postId);
    if (post.authorId !== user.id) {
      await this.assertCanModerate(productionId, user, "작성자 또는 제작진만 삭제할 수 있습니다");
    }
    await this.prisma.boardPost.delete({ where: { id: post.id } });
    return { ok: true };
  }

  async addComment(productionId: string, postId: string, dto: CreateBoardCommentDto, user: RequestUser) {
    await this.assertOrgScope(productionId, user);
    await this.findOrThrow(productionId, postId);
    return this.prisma.boardComment.create({
      data: { postId, authorId: user.id, body: dto.body.trim() },
      include: { author: AUTHOR_SELECT }
    });
  }

  async removeComment(productionId: string, postId: string, commentId: string, user: RequestUser) {
    await this.assertOrgScope(productionId, user);
    await this.findOrThrow(productionId, postId);
    const comment = await this.prisma.boardComment.findFirst({ where: { id: commentId, postId } });
    if (!comment) {
      throw new NotFoundException("댓글을 찾을 수 없습니다");
    }
    if (comment.authorId !== user.id) {
      await this.assertCanModerate(productionId, user, "작성자 또는 제작진만 삭제할 수 있습니다");
    }
    await this.prisma.boardComment.delete({ where: { id: comment.id } });
    return { ok: true };
  }

  private async findOrThrow(productionId: string, postId: string) {
    const post = await this.prisma.boardPost.findFirst({ where: { id: postId, productionId } });
    if (!post) {
      throw new NotFoundException("글을 찾을 수 없습니다");
    }
    return post;
  }

  // ORG_ADMIN은 자기 조직 공연만 접근 — RolesGuard의 플랫폼 롤 통과가 조직 경계를 넘지 않게 한다.
  private async assertOrgScope(productionId: string, user: RequestUser) {
    if (user.platformRole !== PlatformRole.ORG_ADMIN) {
      return;
    }
    const [production, caller] = await Promise.all([
      this.prisma.production.findUnique({ where: { id: productionId }, select: { organizationId: true } }),
      this.prisma.user.findUnique({ where: { id: user.id }, select: { organizationId: true } })
    ]);
    if (!production || !caller || production.organizationId !== caller.organizationId) {
      throw new ForbiddenException("이 공연의 게시판에 접근할 권한이 없어요");
    }
  }

  // 작성자가 아닐 때의 수정·삭제(모더레이션)는 운영자 또는 해당 공연 제작진만.
  private async assertCanModerate(productionId: string, user: RequestUser, message: string) {
    if (user.platformRole === PlatformRole.SUPER_ADMIN || user.platformRole === PlatformRole.ORG_ADMIN) {
      return;
    }
    const membership = await this.prisma.membership.findFirst({
      where: {
        productionId,
        userId: user.id,
        roles: { some: { role: { in: [...STAFF_ROLES] } } }
      },
      select: { id: true }
    });
    if (!membership) {
      throw new ForbiddenException(message);
    }
  }

  private async assertStaff(productionId: string, user: RequestUser, message: string) {
    if (user.platformRole === PlatformRole.SUPER_ADMIN || user.platformRole === PlatformRole.ORG_ADMIN) {
      return;
    }
    const membership = await this.prisma.membership.findFirst({
      where: {
        productionId,
        userId: user.id,
        roles: { some: { role: { in: [...STAFF_ROLES] } } }
      },
      select: { id: true }
    });
    if (!membership) {
      throw new ForbiddenException(message);
    }
  }
}
