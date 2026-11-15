import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma, RecruitmentApplicationStatus } from "@prisma/client";
import type { RequestUser } from "../common/types/request-user";
import { PrismaService } from "../prisma/prisma.service";
import type { OpportunityQueryDto, RecruitmentPageDto, ReviewRecruitmentApplicationDto, RoundDocumentDto, SubmitRecruitmentApplicationDto, UpdateRecruitmentRoundDto } from "./dto";
import { normalizeRecruitmentDocument, recruitmentText } from "./recruitment-document";
import { recordRecruitmentTransition } from "./recruitment-events";
import { cancelRoundApplications } from "./recruitment-lifecycle";
import { isRecruitmentApplicationPending, isRecruitmentOpen, presentRecruitmentApplication, presentRecruitmentRound } from "./recruitment-presenter";

type Db = PrismaService | Prisma.TransactionClient;
const ACTIVE_PRODUCTION = { deletedAt: null, archived: false } as const;
const ROUND_INCLUDE = {
  production: { select: { id: true, title: true, organizationId: true, deletedAt: true, archived: true } },
  positions: { orderBy: [{ order: "asc" }, { id: "asc" }], include: { _count: { select: { applications: { where: { status: "APPROVED" } } } } } }
} satisfies Prisma.RecruitmentRoundInclude;
const APPLICATION_INCLUDE = {
  round: { include: ROUND_INCLUDE }, position: { include: { _count: { select: { applications: { where: { status: "APPROVED" } } } } } },
  user: { select: { id: true, name: true } }, events: { orderBy: [{ createdAt: "asc" }, { revision: "asc" }] }
} satisfies Prisma.RecruitmentApplicationInclude;
type RoundRow = Prisma.RecruitmentRoundGetPayload<{ include: typeof ROUND_INCLUDE }>;
type ApplicationRow = Prisma.RecruitmentApplicationGetPayload<{ include: typeof APPLICATION_INCLUDE }>;
type Caller = { id: string; status: string; platformRole: string; organizationId: string | null };

@Injectable()
export class RecruitmentService {
  constructor(private readonly prisma: PrismaService) {}

  async opportunities(query: OpportunityQueryDto, user: RequestUser) {
    return this.ready(async () => {
      await this.activeCaller(this.prisma, user);
      const { limit, offset } = this.page(query); const now = new Date();
      const q = query.q?.trim();
      const where: Prisma.RecruitmentRoundWhereInput = {
        status: "OPEN", publishedAt: { not: null }, production: ACTIVE_PRODUCTION,
        AND: [{ OR: [{ deadlineAt: null }, { deadlineAt: { gt: now } }] },
          ...(q ? [{ OR: [{ title: { contains: q, mode: "insensitive" as const } }, { region: { contains: q, mode: "insensitive" as const } }, { production: { title: { contains: q, mode: "insensitive" as const } } }] }] : [])],
        ...(query.role ? { positions: { some: { role: query.role } } } : {})
      };
      const [rows, total] = await Promise.all([
        this.prisma.recruitmentRound.findMany({ where, include: ROUND_INCLUDE, orderBy: [{ publishedAt: "desc" }, { id: "desc" }], skip: offset, take: limit }),
        this.prisma.recruitmentRound.count({ where })
      ]);
      return this.paged(rows.map(row => presentRecruitmentRound(row, now)), total, offset, limit);
    });
  }

  async opportunity(id: string, user: RequestUser) {
    return this.ready(async () => {
      await this.activeCaller(this.prisma, user);
      const round = await this.publishedRound(this.prisma, id);
      const application = await this.prisma.recruitmentApplication.findUnique({ where: { roundId_userId: { roundId: id, userId: user.id } }, include: APPLICATION_INCLUDE });
      const membership = await this.prisma.membership.findUnique({ where: { userId_productionId: { userId: user.id, productionId: round.productionId } }, include: { roles: true } });
      const roles = new Set(membership?.roles.map(item => item.role) ?? []);
      const now = new Date();
      const mayApply = isRecruitmentOpen(round, now) && (!application || application.status === "WITHDRAWN");
      return { round: presentRecruitmentRound(round, now), myApplication: application ? presentRecruitmentApplication(application, now) : null,
        eligiblePositionIds: mayApply ? round.positions.filter(position => !roles.has(position.role)).map(position => position.id) : [] };
    });
  }

  async submit(roundId: string, dto: SubmitRecruitmentApplicationDto, user: RequestUser) {
    const message = recruitmentText(dto.message, 2000, "지원 내용", true);
    const availability = recruitmentText(dto.availability ?? "", 1000, "참여 가능 일정");
    return this.ready(async () => {
      const productionId = await this.productionIdForRound(roundId);
      return this.write(productionId, user, false, async tx => {
        const round = await this.publishedRound(tx, roundId, productionId);
        const now = new Date();
        if (!isRecruitmentOpen(round, now)) throw new ConflictException("지금은 지원을 받고 있지 않아요");
        const position = round.positions.find(item => item.id === dto.positionId);
        if (!position) throw new BadRequestException("이 모집에서 지원할 자리를 선택해 주세요");
        const prior = await tx.recruitmentApplication.findUnique({ where: { roundId_userId: { roundId, userId: user.id } } });
        this.revision(prior?.revision ?? 0, dto.expectedRevision);
        if (prior && prior.status !== "WITHDRAWN") throw new ConflictException("이미 이 회차에 지원했어요. 내 지원 현황을 확인해 주세요");
        const membership = await tx.membership.findUnique({ where: { userId_productionId: { userId: user.id, productionId } }, include: { roles: true } });
        if (membership?.roles.some(item => item.role === position.role)) throw new ConflictException("이미 이 공연에서 같은 역할로 참여하고 있어요");
        const data = { positionId: position.id, message, availability, status: RecruitmentApplicationStatus.SUBMITTED,
          reviewMessage: null, reviewedById: null, reviewedAt: null, membershipId: null };
        const application = prior
          ? await tx.recruitmentApplication.update({ where: { id: prior.id }, data: { ...data, revision: { increment: 1 } } })
          : await tx.recruitmentApplication.create({ data: { ...data, roundId, userId: user.id } });
        await recordRecruitmentTransition(tx, { applicationId: application.id, productionId, userId: user.id, actorId: user.id,
          fromStatus: prior?.status ?? null, toStatus: "SUBMITTED", revision: application.revision });
        return presentRecruitmentApplication(await this.applicationRow(tx, application.id), now);
      });
    });
  }

  async myApplications(query: RecruitmentPageDto, user: RequestUser) {
    return this.ready(async () => {
      await this.activeCaller(this.prisma, user);
      const { limit, offset } = this.page(query);
      const where = { userId: user.id, round: { production: ACTIVE_PRODUCTION } } satisfies Prisma.RecruitmentApplicationWhereInput;
      const [rows, total] = await Promise.all([
        this.prisma.recruitmentApplication.findMany({ where, include: APPLICATION_INCLUDE, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], skip: offset, take: limit }),
        this.prisma.recruitmentApplication.count({ where })
      ]);
      const now = new Date();
      return this.paged(rows.map(row => presentRecruitmentApplication(row, now)), total, offset, limit);
    });
  }

  async withdraw(applicationId: string, expectedRevision: number, user: RequestUser) {
    return this.ready(async () => {
      const existing = await this.prisma.recruitmentApplication.findFirst({ where: { id: applicationId, userId: user.id, round: { production: ACTIVE_PRODUCTION } }, select: { round: { select: { productionId: true } } } });
      if (!existing) throw this.noApplication();
      return this.write(existing.round.productionId, user, false, async tx => {
        const application = await this.applicationRow(tx, applicationId);
        if (application.userId !== user.id) throw this.noApplication();
        this.revision(application.revision, expectedRevision);
        if (!isRecruitmentApplicationPending(application.status)) throw new ConflictException("현재 상태에서는 지원을 취소할 수 없어요");
        await tx.recruitmentApplication.update({ where: { id: application.id }, data: { status: "WITHDRAWN", reviewMessage: null, revision: { increment: 1 } } });
        await recordRecruitmentTransition(tx, { applicationId, productionId: application.round.productionId, userId: user.id, actorId: user.id,
          fromStatus: application.status, toStatus: "WITHDRAWN", revision: application.revision + 1 });
        return presentRecruitmentApplication(await this.applicationRow(tx, applicationId), new Date());
      });
    });
  }

  async access(productionId: string, user: RequestUser) {
    return this.ready(async () => {
      const production = await this.production(this.prisma, productionId);
      const caller = await this.activeCaller(this.prisma, user);
      const membership = await this.prisma.membership.findUnique({ where: { userId_productionId: { userId: user.id, productionId } }, include: { roles: true } });
      const admin = this.admin(caller, production.organizationId);
      if (!admin && !membership) throw new NotFoundException("공연을 찾을 수 없어요");
      const roles = membership?.roles.map(item => item.role) ?? [];
      return { canManageRecruitment: admin || roles.includes("PRODUCER"),
        canManageSchedule: admin || roles.some(role => ["PRODUCER", "DIRECTOR", "MUSIC_DIRECTOR", "STAGE_MANAGER"].includes(role)) };
    });
  }

  async rounds(productionId: string, query: RecruitmentPageDto, user: RequestUser) {
    return this.ready(async () => {
      await this.assertManager(this.prisma, productionId, user);
      const { limit, offset } = this.page(query); const where = { productionId, production: ACTIVE_PRODUCTION };
      const [rows, total] = await Promise.all([
        this.prisma.recruitmentRound.findMany({ where, include: ROUND_INCLUDE, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: offset, take: limit }),
        this.prisma.recruitmentRound.count({ where })
      ]);
      const now = new Date();
      return this.paged(rows.map(row => presentRecruitmentRound(row, now)), total, offset, limit);
    });
  }

  async createRound(productionId: string, dto: RoundDocumentDto, user: RequestUser) {
    const document = normalizeRecruitmentDocument(dto);
    return this.ready(() => this.write(productionId, user, true, async tx => {
      const round = await tx.recruitmentRound.create({ data: { ...document.fields, productionId, createdById: user.id,
        positions: { create: document.positions } }, include: ROUND_INCLUDE });
      return presentRecruitmentRound(round, new Date());
    }));
  }

  async updateRound(productionId: string, roundId: string, dto: UpdateRecruitmentRoundDto, user: RequestUser) {
    const document = normalizeRecruitmentDocument(dto);
    return this.ready(() => this.write(productionId, user, true, async tx => {
      const round = await this.roundRow(tx, roundId, productionId); this.revision(round.revision, dto.expectedRevision);
      if (round.status !== "DRAFT") throw new ConflictException("게시한 모집은 수정할 수 없어요. 새 회차를 작성해 주세요");
      await tx.recruitmentPosition.deleteMany({ where: { roundId } });
      const updated = await tx.recruitmentRound.update({ where: { id: roundId }, data: { ...document.fields, positions: { create: document.positions }, revision: { increment: 1 } }, include: ROUND_INCLUDE });
      return presentRecruitmentRound(updated, new Date());
    }));
  }

  async publishRound(productionId: string, roundId: string, expectedRevision: number, user: RequestUser) {
    return this.ready(() => this.write(productionId, user, true, async tx => {
      const round = await this.roundRow(tx, roundId, productionId); this.revision(round.revision, expectedRevision);
      if (round.status !== "DRAFT") throw new ConflictException("초안인 모집만 게시할 수 있어요");
      const now = new Date();
      if (round.deadlineAt && round.deadlineAt.getTime() <= now.getTime()) throw new BadRequestException("지원 마감일을 현재 시각 이후로 정해 주세요");
      return presentRecruitmentRound(await tx.recruitmentRound.update({ where: { id: roundId }, data: { status: "OPEN", publishedAt: now, revision: { increment: 1 } }, include: ROUND_INCLUDE }), now);
    }));
  }

  async closeRound(productionId: string, roundId: string, expectedRevision: number, user: RequestUser) {
    return this.ready(() => this.write(productionId, user, true, async tx => {
      const round = await this.roundRow(tx, roundId, productionId); this.revision(round.revision, expectedRevision);
      if (round.status !== "OPEN") throw new ConflictException("접수 중인 모집만 마감할 수 있어요");
      return presentRecruitmentRound(await tx.recruitmentRound.update({ where: { id: roundId }, data: { status: "CLOSED", revision: { increment: 1 } }, include: ROUND_INCLUDE }), new Date());
    }));
  }

  async cancelRound(productionId: string, roundId: string, expectedRevision: number, user: RequestUser) {
    return this.ready(() => this.write(productionId, user, true, async tx => {
      const round = await this.roundRow(tx, roundId, productionId); this.revision(round.revision, expectedRevision);
      if (round.status === "CANCELLED") throw new ConflictException("이미 취소한 모집이에요");
      await tx.recruitmentRound.update({ where: { id: roundId }, data: { status: "CANCELLED", revision: { increment: 1 } } });
      await cancelRoundApplications(tx, roundId, productionId, user.id);
      return presentRecruitmentRound(await this.roundRow(tx, roundId, productionId), new Date());
    }));
  }

  async applications(productionId: string, roundId: string, query: RecruitmentPageDto, user: RequestUser) {
    return this.ready(async () => {
      await this.assertManager(this.prisma, productionId, user); await this.roundRow(this.prisma, roundId, productionId);
      const { limit, offset } = this.page(query); const where = { roundId, round: { productionId, production: ACTIVE_PRODUCTION } };
      const [rows, total] = await Promise.all([
        this.prisma.recruitmentApplication.findMany({ where, include: APPLICATION_INCLUDE, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], skip: offset, take: limit }),
        this.prisma.recruitmentApplication.count({ where })
      ]);
      const now = new Date();
      return this.paged(rows.map(row => presentRecruitmentApplication(row, now)), total, offset, limit);
    });
  }

  async review(productionId: string, roundId: string, applicationId: string, dto: ReviewRecruitmentApplicationDto, user: RequestUser) {
    if (!["REVIEWING", "ON_HOLD", "APPROVED", "NOT_SELECTED"].includes(dto.status)) throw new BadRequestException("지원 검토 상태를 확인해 주세요");
    const reviewMessage = recruitmentText(dto.reviewMessage ?? "", 1000, "지원자에게 전할 안내") || null;
    return this.ready(() => this.write(productionId, user, true, async tx => {
      const round = await this.roundRow(tx, roundId, productionId);
      const application = await this.applicationRow(tx, applicationId);
      const now = new Date();
      if (application.roundId !== roundId) throw this.noApplication();
      // 이미 승인한 요청의 재전송은 정원·이력·알림을 다시 만들지 않는다.
      if (application.status === "APPROVED" && dto.status === "APPROVED") return presentRecruitmentApplication(application, now);
      this.revision(application.revision, dto.expectedRevision);
      if (round.status !== "OPEN" && round.status !== "CLOSED") throw new ConflictException("이 모집의 지원 검토는 종료됐어요");
      if (!isRecruitmentApplicationPending(application.status)) throw new ConflictException("이미 처리한 지원이에요. 최신 상태를 확인해 주세요");
      let membershipId: string | undefined;
      if (dto.status === "APPROVED") {
        // 차단 처리와 승인도 경합하지 않도록 현재 회원 행을 잠근 뒤 ACTIVE를 다시 확인한다.
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${application.userId} FOR UPDATE`;
        const applicant = await tx.user.findUnique({ where: { id: application.userId }, select: { status: true } });
        if (!applicant || applicant.status !== "ACTIVE") throw new ConflictException("비활성·차단된 회원은 참여를 확정할 수 없어요");
        const approved = await tx.recruitmentApplication.count({ where: { positionId: application.positionId, status: "APPROVED" } });
        if (approved >= application.position.capacity) throw new ConflictException("이 자리의 모집 정원이 찼어요");
        const role = application.position.role === "ACTOR" ? "ACTOR" : "STAFF";
        const membership = await tx.membership.upsert({ where: { userId_productionId: { userId: application.userId, productionId } },
          update: {}, create: { userId: application.userId, productionId, primaryRole: role } });
        await tx.membershipRole.upsert({ where: { membershipId_role: { membershipId: membership.id, role } }, update: {},
          create: { membershipId: membership.id, role, grantedById: user.id } });
        membershipId = membership.id;
      }
      const updated = await tx.recruitmentApplication.update({ where: { id: applicationId }, data: {
        status: dto.status, reviewMessage, reviewedAt: new Date(), reviewedById: user.id,
        ...(membershipId ? { membershipId } : {}), revision: { increment: 1 }
      } });
      await recordRecruitmentTransition(tx, { applicationId, productionId, userId: application.userId, actorId: user.id,
        fromStatus: application.status, toStatus: dto.status, revision: updated.revision, message: reviewMessage });
      return presentRecruitmentApplication(await this.applicationRow(tx, applicationId), now);
    }));
  }

  private async write<T>(productionId: string, user: RequestUser, manage: boolean, action: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.$transaction(async tx => {
      // 모든 지원·심사·마감·공연 취소는 공연 행부터 잠가 정원과 상태를 같은 순서로 처리한다.
      await tx.$queryRaw`SELECT id FROM productions WHERE id = ${productionId} FOR UPDATE`;
      if (manage) await this.assertManager(tx, productionId, user);
      else { await this.production(tx, productionId); await this.activeCaller(tx, user); }
      return action(tx);
    }, { timeout: 15000 });
  }
  private async activeCaller(db: Db, user: RequestUser): Promise<Caller> {
    const caller = await db.user.findUnique({ where: { id: user.id }, select: { id: true, status: true, platformRole: true, organizationId: true } });
    if (!caller || caller.status !== "ACTIVE") throw new ForbiddenException("현재 활동 중인 회원만 이용할 수 있어요");
    return caller;
  }
  private async production(db: Db, id: string) {
    const row = await db.production.findFirst({ where: { id, ...ACTIVE_PRODUCTION }, select: { id: true, title: true, organizationId: true } });
    if (!row) throw new NotFoundException("공연을 찾을 수 없어요");
    return row;
  }
  private admin(caller: Caller, organizationId: string) { return caller.platformRole === "SUPER_ADMIN" || caller.platformRole === "ORG_ADMIN" && Boolean(caller.organizationId && caller.organizationId === organizationId); }
  private async assertManager(db: Db, productionId: string, user: RequestUser) {
    const [production, caller] = await Promise.all([this.production(db, productionId), this.activeCaller(db, user)]);
    if (this.admin(caller, production.organizationId)) return;
    const membership = await db.membership.findFirst({ where: { productionId, userId: user.id, roles: { some: { role: "PRODUCER" } } }, select: { id: true } });
    if (!membership) throw new ForbiddenException("이 공연의 모집을 관리할 권한이 없어요");
  }
  private async productionIdForRound(id: string) {
    const round = await this.prisma.recruitmentRound.findFirst({ where: { id, production: ACTIVE_PRODUCTION, publishedAt: { not: null } }, select: { productionId: true } });
    if (!round) throw new NotFoundException("모집을 찾을 수 없어요");
    return round.productionId;
  }
  private async roundRow(db: Db, id: string, productionId?: string): Promise<RoundRow> {
    const row = await db.recruitmentRound.findFirst({ where: { id, ...(productionId ? { productionId } : {}), production: ACTIVE_PRODUCTION }, include: ROUND_INCLUDE });
    if (!row) throw new NotFoundException("모집을 찾을 수 없어요");
    return row;
  }
  private async publishedRound(db: Db, id: string, productionId?: string) {
    const row = await this.roundRow(db, id, productionId);
    if (!row.publishedAt || row.status === "DRAFT") throw new NotFoundException("모집을 찾을 수 없어요");
    return row;
  }
  private async applicationRow(db: Db, id: string): Promise<ApplicationRow> {
    const row = await db.recruitmentApplication.findFirst({ where: { id, round: { production: ACTIVE_PRODUCTION } }, include: APPLICATION_INCLUDE });
    if (!row) throw this.noApplication();
    return row;
  }
  private noApplication() { return new NotFoundException("지원서를 찾을 수 없어요"); }
  private page(query: RecruitmentPageDto) {
    const limit = query.limit ?? 20, offset = query.offset ?? 0;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50 || !Number.isInteger(offset) || offset < 0 || offset > 100000) throw new BadRequestException("목록 조회 범위를 확인해 주세요");
    return { limit, offset };
  }
  private paged<T>(items: T[], total: number, offset: number, limit: number) { return { items, total, offset, hasMore: offset + limit < total }; }
  private revision(actual: number, expected: number) { if (!Number.isInteger(expected) || actual !== expected) throw new ConflictException("다른 곳에서 내용이 바뀌었어요. 최신 상태를 불러온 뒤 다시 처리해 주세요"); }
  private async ready<T>(action: () => Promise<T>): Promise<T> {
    try { return await action(); }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (["P2021", "P2022"].includes(error.code)) throw new ServiceUnavailableException("모집 저장 공간을 준비 중이에요. 운영 관리자에게 알려 주세요");
        if (error.code === "P2002") throw new ConflictException("이미 접수되거나 처리한 내용이에요. 최신 상태를 확인해 주세요");
      }
      throw error;
    }
  }
}
