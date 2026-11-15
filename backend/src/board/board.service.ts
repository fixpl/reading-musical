import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { BoardCategory, BoardPost, PlatformRole, Prisma, ProductionRole } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestUser } from "../common/types/request-user";
import { isProductionAdmin } from "../common/access/is-production-admin";
import { NotificationsGateway } from "../notifications/notifications.gateway";
import { NotificationsService } from "../notifications/notifications.service";
import { CreateBoardCommentDto, CreateBoardPostDto, ListBoardPostsDto, UpdateBoardPostDto } from "./dto";

const STAFF_ROLES: readonly ProductionRole[] = [
  ProductionRole.PRODUCER, ProductionRole.DIRECTOR, ProductionRole.MUSIC_DIRECTOR, ProductionRole.STAGE_MANAGER
];
const AUTHOR_SELECT = { select: { id: true, name: true, profileType: true } } as const;
const POST_INCLUDE = { author: AUTHOR_SELECT, _count: { select: { comments: true } } } as const;

@Injectable()
export class BoardService {
  private readonly logger = new Logger(BoardService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
    // 공지·댓글을 벨 알림으로도 남긴다(접속하지 않은 멤버도 나중에 확인할 수 있게).
    @Optional() private readonly notifications?: NotificationsService
  ) {}

  async list(productionId: string, query: ListBoardPostsDto, user: RequestUser) {
    await this.assertAccess(productionId, user);
    const visibility = query.visibility ?? "TEAM";
    const where: Prisma.BoardPostWhereInput = {
      productionId, category: query.category, channel: query.channel, source: query.source, status: query.status,
      ...(visibility === "ALL"
        ? { OR: [{ visibility: "TEAM" }, { visibility: "PRIVATE", authorId: user.id }] }
        : { visibility, ...(visibility === "PRIVATE" ? { authorId: user.id } : {}) })
    };
    if (query.cursor && !await this.prisma.boardPost.findFirst({ where: { AND: [where, { id: query.cursor }] }, select: { id: true } })) {
      throw new BadRequestException("목록이 변경되었습니다. 처음부터 다시 불러오세요.");
    }
    const limit = query.limit ?? 60;
    const rows = await this.prisma.boardPost.findMany({
      where, orderBy: [{ pinned: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: limit + 1, ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: POST_INCLUDE
    });
    const items = rows.slice(0, limit);
    return { items, nextCursor: rows.length > limit ? items.at(-1)!.id : null };
  }

  async get(productionId: string, postId: string, user: RequestUser) {
    await this.assertAccess(productionId, user);
    const post = await this.prisma.boardPost.findFirst({
      where: this.visiblePost(productionId, postId, user),
      include: { author: AUTHOR_SELECT, comments: { orderBy: { createdAt: "asc" }, include: { author: AUTHOR_SELECT } } }
    });
    if (!post) throw new NotFoundException("글을 찾을 수 없습니다");
    return post;
  }

  async create(productionId: string, dto: CreateBoardPostDto, user: RequestUser) {
    await this.assertAccess(productionId, user);
    const channel = dto.channel ?? (dto.category === "NOTICE" ? "NOTICE" : dto.category === "MATERIAL" ? "MATERIAL" : "GENERAL");
    const category = channel === "NOTICE" ? BoardCategory.NOTICE : channel === "MATERIAL" ? BoardCategory.MATERIAL : BoardCategory.QUESTION;
    if (dto.category && dto.category !== category) throw new BadRequestException("분류와 채널을 확인하세요.");
    if (category === BoardCategory.NOTICE) await this.assertStaff(productionId, user, "공지는 제작진만 작성할 수 있습니다");
    if (category !== BoardCategory.QUESTION && !dto.title?.trim()) throw new BadRequestException("공지와 자료에는 제목을 입력하세요.");
    await this.assertContext(productionId, dto);
    const visibility = dto.visibility ?? (dto.source ? "PRIVATE" : "TEAM");
    if (visibility === "PRIVATE" && !dto.source) throw new BadRequestException("나만 보기 메모는 연습 시점에 연결하세요.");
    const post = await this.prisma.boardPost.create({
      data: {
        productionId, authorId: user.id, category, channel, visibility,
        title: dto.title?.trim() || dto.body.trim().split("\n")[0].slice(0, 120),
        body: dto.body.trim(), pinned: category === BoardCategory.NOTICE && visibility === "TEAM",
        source: dto.source, unitKey: dto.unitKey, positionMs: dto.positionMs, contextLabel: dto.contextLabel
      }, include: POST_INCLUDE
    });
    await this.publish(post);
    if (post.category === BoardCategory.NOTICE && post.visibility === "TEAM") await this.notifyNotice(post, user);
    return post;
  }

  async update(productionId: string, postId: string, dto: UpdateBoardPostDto, user: RequestUser) {
    await this.assertAccess(productionId, user);
    const post = await this.findOrThrow(productionId, postId, user);
    if (dto.visibility !== undefined && post.authorId !== user.id) throw new ForbiddenException("공개 범위는 작성자만 변경할 수 있습니다.");
    if (dto.visibility === "PRIVATE" && !post.source) throw new BadRequestException("시점 메모만 나만 보기로 변경할 수 있습니다.");
    if (dto.pinned !== undefined) await this.assertStaff(productionId, user, "고정은 제작진만 변경할 수 있습니다");
    if (post.authorId !== user.id) await this.assertStaff(productionId, user, "작성자 또는 제작진만 수정할 수 있습니다");
    const saved = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.boardPost.updateMany({
        where: { id: post.id, revision: dto.expectedRevision ?? post.revision },
        data: {
          title: dto.title?.trim(), body: dto.body?.trim(), status: dto.status,
          visibility: dto.visibility, pinned: dto.visibility === "PRIVATE" ? false : dto.pinned, revision: { increment: 1 }
        }
      });
      if (changed.count !== 1) throw this.conflict();
      return tx.boardPost.findUniqueOrThrow({ where: { id: post.id }, include: POST_INCLUDE });
    });
    // A team -> private change must invalidate former readers without sending any text.
    await this.publish(saved, post.visibility === "TEAM");
    return saved;
  }

  async remove(productionId: string, postId: string, user: RequestUser) {
    await this.assertAccess(productionId, user);
    const post = await this.findOrThrow(productionId, postId, user);
    if (post.authorId !== user.id) await this.assertStaff(productionId, user, "작성자 또는 제작진만 삭제할 수 있습니다");
    const removed = await this.prisma.boardPost.deleteMany({ where: { id: post.id, revision: post.revision } });
    if (removed.count !== 1) throw this.conflict();
    await this.publish(post);
    return { ok: true };
  }

  async addComment(productionId: string, postId: string, dto: CreateBoardCommentDto, user: RequestUser) {
    await this.assertAccess(productionId, user);
    const post = await this.findOrThrow(productionId, postId, user);
    const comment = await this.prisma.$transaction(async (tx) => {
      // Changing the parent revision serializes replies with visibility changes.
      const changed = await tx.boardPost.updateMany({ where: { id: post.id, revision: post.revision }, data: { revision: { increment: 1 } } });
      if (changed.count !== 1) throw this.conflict();
      return tx.boardComment.create({ data: { postId, authorId: user.id, body: dto.body.trim() }, include: { author: AUTHOR_SELECT } });
    });
    await this.publish(post);
    await this.notifyComment(post, comment.id, dto.body, user);
    return comment;
  }

  async removeComment(productionId: string, postId: string, commentId: string, user: RequestUser) {
    await this.assertAccess(productionId, user);
    const post = await this.findOrThrow(productionId, postId, user);
    const comment = await this.prisma.boardComment.findFirst({ where: { id: commentId, postId } });
    if (!comment) throw new NotFoundException("댓글을 찾을 수 없습니다");
    if (comment.authorId !== user.id) await this.assertStaff(productionId, user, "작성자 또는 제작진만 삭제할 수 있습니다");
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.boardPost.updateMany({ where: { id: post.id, revision: post.revision }, data: { revision: { increment: 1 } } });
      if (changed.count !== 1) throw this.conflict();
      await tx.boardComment.delete({ where: { id: comment.id } });
    });
    await this.publish(post);
    return { ok: true };
  }

  private visiblePost(productionId: string, postId: string, user: RequestUser): Prisma.BoardPostWhereInput {
    // Platform administrators can manage performances, but never read others' personal notes.
    return { id: postId, productionId, OR: [{ visibility: "TEAM" }, { visibility: "PRIVATE", authorId: user.id }] };
  }

  private async findOrThrow(productionId: string, postId: string, user: RequestUser) {
    const post = await this.prisma.boardPost.findFirst({ where: this.visiblePost(productionId, postId, user) });
    if (!post) throw new NotFoundException("글을 찾을 수 없습니다");
    return post;
  }

  private async assertContext(productionId: string, dto: CreateBoardPostDto) {
    const hasContext = [dto.source, dto.unitKey, dto.positionMs, dto.contextLabel].some((value) => value !== undefined);
    if (!hasContext) return;
    if (!dto.source || !dto.unitKey || dto.positionMs == null || !dto.contextLabel) throw new BadRequestException("대본·장면·시점 정보를 함께 입력하세요.");
    if (dto.source !== "composition" && !await this.prisma.script.findFirst({ where: { id: dto.source, productionId, deletedAt: null }, select: { id: true } })) {
      throw new BadRequestException("이 공연의 대본에만 메모를 연결할 수 있습니다.");
    }
    if (dto.unitKey === "overview") return;
    const [kind, id, extra] = dto.unitKey.split(":");
    if (!id || extra) throw new BadRequestException("메모를 연결할 장면을 확인하세요.");
    const exists = kind === "section" && dto.source === "composition"
      ? await this.prisma.performanceSection.findFirst({ where: { id, productionId, deletedAt: null }, select: { id: true } })
      : kind === "scene" && dto.source !== "composition"
      ? await this.prisma.scene.findFirst({ where: { id, act: { scriptId: dto.source, script: { productionId, deletedAt: null } } }, select: { id: true } })
      : kind === "cue"
      ? await this.prismaCue(productionId, id, dto.source)
      : null;
    if (!exists) throw new BadRequestException("현재 공연의 장면이나 큐에 메모를 연결하세요.");
  }

  private prismaCue(productionId: string, id: string, source: string) {
    return this.prisma.trackCue.findFirst({
      where: { id, productionId, ...(source === "composition" ? {} : { OR: [{ sceneId: null }, { scene: { act: { scriptId: source } } }] }) },
      select: { id: true }
    });
  }

  private conflict() { return new ConflictException("다른 기기에서 대화나 메모가 변경됐습니다. 최신 내용을 확인한 뒤 다시 저장하세요."); }

  private async assertAccess(productionId: string, user: RequestUser) {
    if (!await this.prisma.production.findFirst({ where: { id: productionId, deletedAt: null }, select: { id: true } })) throw new NotFoundException("공연을 찾을 수 없습니다.");
    if (await isProductionAdmin(this.prisma, user, productionId)) return;
    // 다른 조직의 운영자도 이 공연에 배정돼 있으면 참여자 권한으로 읽는다.
    if (!await this.prisma.membership.findUnique({ where: { userId_productionId: { userId: user.id, productionId } }, select: { id: true } })) {
      throw new ForbiddenException("배정된 공연의 커뮤니티만 볼 수 있습니다.");
    }
  }

  private async assertStaff(productionId: string, user: RequestUser, message: string) {
    if (await isProductionAdmin(this.prisma, user, productionId)) return;
    if (!await this.prisma.membership.findFirst({
      where: { productionId, userId: user.id, roles: { some: { role: { in: [...STAFF_ROLES] } } } }, select: { id: true }
    })) throw new ForbiddenException(message);
  }

  /** 새 공지: 공연의 다른 활성 멤버 모두에게. 알림 실패가 글 저장을 실패시키지 않는다. */
  private async notifyNotice(post: BoardPost, user: RequestUser) {
    if (!this.notifications) return;
    try {
      const members = await this.prisma.membership.findMany({ where: { productionId: post.productionId, userId: { not: user.id }, user: { status: "ACTIVE" } }, select: { userId: true } });
      const production = await this.prisma.production.findUnique({ where: { id: post.productionId }, select: { title: true } });
      await this.notifications.createNotifications(members.map((member) => ({
        userId: member.userId, productionId: post.productionId, type: "board.notice_created",
        payload: { postId: post.id, postTitle: post.title, authorName: user.name, productionTitle: production?.title ?? "" }
      })));
    } catch (error) {
      this.logger.warn(`공지 알림 생성 실패: ${error instanceof Error ? error.message : error}`);
    }
  }

  /** 새 댓글: 글쓴이와 앞서 댓글을 단 사람에게(본인 제외). 나만 보기 글은 글쓴이에게만. */
  private async notifyComment(post: BoardPost, commentId: string, body: string, user: RequestUser) {
    if (!this.notifications) return;
    try {
      const recipients = new Set<string>([post.authorId]);
      if (post.visibility === "TEAM") {
        const earlier = await this.prisma.boardComment.findMany({ where: { postId: post.id, id: { not: commentId } }, select: { authorId: true }, distinct: ["authorId"] });
        for (const row of earlier) recipients.add(row.authorId);
      }
      recipients.delete(user.id);
      if (!recipients.size) return;
      const active = await this.prisma.user.findMany({ where: { id: { in: [...recipients] }, status: "ACTIVE" }, select: { id: true } });
      await this.notifications.createNotifications(active.map((target) => ({
        userId: target.id, productionId: post.productionId, type: "board.comment_created",
        payload: { postId: post.id, postTitle: post.title, authorName: user.name, snippet: body.trim().slice(0, 80), mine: target.id === post.authorId }
      })));
    } catch (error) {
      this.logger.warn(`댓글 알림 생성 실패: ${error instanceof Error ? error.message : error}`);
    }
  }

  private async publish(post: BoardPost, formerlyShared = false) {
    try {
      let userIds = [post.authorId];
      if (post.visibility === "TEAM" || formerlyShared) {
        const production = await this.prisma.production.findUnique({ where: { id: post.productionId }, select: { organizationId: true } });
        const users = await this.prisma.user.findMany({
          where: { status: "ACTIVE", OR: [
            { memberships: { some: { productionId: post.productionId } } },
            { platformRole: PlatformRole.SUPER_ADMIN },
            ...(production ? [{ platformRole: PlatformRole.ORG_ADMIN, organizationId: production.organizationId }] : [])
          ] }, select: { id: true }
        });
        userIds = users.map((user) => user.id);
      }
      this.gateway.emitBoardChanged(userIds, post.productionId, post.id);
    } catch {
      // A saved message must not be reported as failed because realtime delivery failed.
      this.logger.warn("Community invalidation failed; clients can refresh the saved message.");
    }
  }
}
