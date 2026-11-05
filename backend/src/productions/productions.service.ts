import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AssetKind, Phase, PlatformRole, ProductionRole, ProfileType, Visibility } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestUser } from "../common/types/request-user";
import {
  CheckProductionTitleQueryDto,
  CreateProductionDto,
  DuplicateProductionDto,
  SetBackgroundVideoDto,
  UpdateProductionDto
} from "./dto";
import { checklistPhaseCreateDataFromTemplates } from "../checklist/checklist-template-seed";
import { ProductionAccessService } from "./production-access.service";
import { ProductionActivityLogService } from "./production-activity-log.service";
import { ProductionNotificationsService } from "./production-notifications.service";
import { assertDateRange, optionalText, requiredText, titleTakenException } from "./production-shared.util";

/**
 * 공연 핵심 CRUD(생성/조회/수정/보관/삭제/복제)만 담당한다.
 * 필요 정원/스태프 직무/공개 준비 점검/멤버·초대/참여자 목록·검색은
 * 각각 position-requirements / staff-assignments / production-readiness /
 * production-members / production-directory 서비스로 분리되어 있다.
 */
@Injectable()
export class ProductionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProductionAccessService,
    private readonly activityLog: ProductionActivityLogService,
    private readonly productionNotifications: ProductionNotificationsService
  ) {}

  async listForUser(user: RequestUser) {
    if (user.platformRole === "SUPER_ADMIN") {
      return this.prisma.production.findMany({
        where: { archived: false, deletedAt: null },
        orderBy: { createdAt: "desc" },
        include: this.access.productionListInclude()
      });
    }

    // 조직 운영자는 소속 조직의 공연을 모두 본다(멤버로 지정돼 있지 않아도).
    if (user.platformRole === "ORG_ADMIN") {
      const caller = await this.prisma.user.findUnique({ where: { id: user.id }, select: { organizationId: true } });
      if (caller?.organizationId) {
        return this.prisma.production.findMany({
          where: { archived: false, deletedAt: null, organizationId: caller.organizationId },
          orderBy: { createdAt: "desc" },
          include: this.access.productionListInclude()
        });
      }
    }

    const memberships = await this.prisma.membership.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: {
        roles: true,
        production: { include: this.access.productionListInclude() }
      }
    });

    return memberships
      // 배정된 멤버는 역할·공개 여부와 무관하게 본인 공연을 본다. 리딩뮤지컬은 준비중(비공개)에
      // 리허설·대본 리딩을 하므로 배우·스텝도 준비 단계부터 공연에 들어가야 한다. 공개(visibility)는
      // 비멤버 노출용이지 배정된 출연진의 접근을 막는 장치가 아니다.
      .filter((membership) => !membership.production.archived && !membership.production.deletedAt)
      .map((membership) => ({
        ...membership.production,
        myMembership: {
          id: membership.id,
          primaryRole: membership.primaryRole,
          roles: membership.roles.map((role) => role.role)
        }
      }));
  }

  async create(dto: CreateProductionDto, user: RequestUser) {
    await this.assertCanCreateProduction(user);
    const organizationId = await this.resolveOrganizationId(dto.organizationId, user);
    const title = requiredText(dto.title, "공연 제목을 입력해 주세요");
    assertDateRange(dto.startDate, dto.endDate);
    if (dto.visibility === Visibility.PUBLISHED) {
      throw new BadRequestException("새 공연은 먼저 DRAFT로 생성한 뒤 공개 준비 점검을 통과해야 해요");
    }

    const titleExists = await this.prisma.production.findFirst({
      where: { organizationId, title },
      select: { id: true }
    });
    if (titleExists) {
      throw titleTakenException();
    }

    if (dto.slug) {
      const slugExists = await this.prisma.production.findUnique({ where: { slug: dto.slug }, select: { id: true } });
      if (slugExists) {
        throw new ConflictException("이미 사용 중인 공개 주소예요");
      }
    }

    const checklistPhases = await checklistPhaseCreateDataFromTemplates(this.prisma);
    const production = await this.prisma.production.create({
      data: {
        organizationId,
        title,
        slug: optionalText(dto.slug),
        synopsis: optionalText(dto.synopsis),
        description: optionalText(dto.description),
        venue: optionalText(dto.venue),
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        visibility: Visibility.DRAFT,
        positionRequirements: {
          create: dto.positionRequirements?.map((position) => ({
            role: position.role,
            label: position.label,
            requiredCount: position.requiredCount ?? 1
          }))
        },
        memberships: {
          create: {
            userId: user.id,
            primaryRole: ProductionRole.PRODUCER,
            roles: { create: { role: ProductionRole.PRODUCER } }
          }
        },
        checklistPhases: {
          create: checklistPhases
        }
      },
      include: this.access.productionListInclude()
    });

    await this.activityLog.log({
      productionId: production.id,
      organizationId,
      actorId: user.id,
      action: "production.create",
      entity: "Production",
      entityId: production.id,
      reason: "공연 생성",
      afterJson: { title: production.title, visibility: production.visibility }
    });

    return production;
  }

  async findOne(id: string, user: RequestUser) {
    await this.access.assertMemberOrAdmin(id, user);
    const production = await this.prisma.production.findUnique({
      where: { id },
      include: this.access.productionListInclude()
    });
    if (!production) {
      throw new NotFoundException("찾을 수 없어요");
    }
    return production;
  }

  /** 공연 뒷배경 영상 지정/해제 — 타임라인 재생의 기준 시계가 되는 영상. */
  async setBackgroundVideo(productionId: string, dto: SetBackgroundVideoDto, user: RequestUser) {
    await this.access.getAccess(productionId, user);
    if (dto.assetId) {
      const asset = await this.prisma.asset.findFirst({
        where: { id: dto.assetId, productionId, kind: AssetKind.VIDEO },
        select: { id: true }
      });
      if (!asset) {
        throw new NotFoundException("이 공연의 영상 파일을 찾을 수 없어요");
      }
    }
    return this.prisma.production.update({
      where: { id: productionId },
      data: { backgroundAssetId: dto.assetId ?? null },
      select: {
        id: true,
        backgroundAssetId: true,
        backgroundAsset: { select: { id: true, kind: true, mime: true, sizeBytes: true, storageKey: true } }
      }
    });
  }

  async update(productionId: string, dto: UpdateProductionDto, user: RequestUser) {
    await this.access.getAccess(productionId, user);
    const production = await this.prisma.production.findUnique({ where: { id: productionId }, include: { positionRequirements: true } });
    if (!production) {
      throw new NotFoundException("찾을 수 없어요");
    }

    const nextStartDate = dto.startDate === undefined ? production.startDate?.toISOString() : dto.startDate;
    const nextEndDate = dto.endDate === undefined ? production.endDate?.toISOString() : dto.endDate;
    assertDateRange(nextStartDate, nextEndDate);

    const data: Prisma.ProductionUpdateInput = {};
    if (dto.title !== undefined) {
      const title = requiredText(dto.title, "공연 제목을 입력해 주세요");
      if (title !== production.title) {
        const titleExists = await this.prisma.production.findFirst({
          where: { organizationId: production.organizationId, title, id: { not: productionId } },
          select: { id: true }
        });
        if (titleExists) {
          throw titleTakenException();
        }
      }
      data.title = title;
    }
    if (dto.slug !== undefined) {
      const slug = optionalText(dto.slug);
      if (slug && slug !== production.slug) {
        const slugExists = await this.prisma.production.findUnique({ where: { slug }, select: { id: true } });
        if (slugExists) {
          throw new ConflictException("이미 사용 중인 공개 주소예요");
        }
      }
      data.slug = slug;
    }
    if (dto.synopsis !== undefined) data.synopsis = optionalText(dto.synopsis);
    if (dto.description !== undefined) data.description = optionalText(dto.description);
    if (dto.venue !== undefined) data.venue = optionalText(dto.venue);
    if (dto.startDate !== undefined) data.startDate = dto.startDate ? new Date(dto.startDate) : null;
    if (dto.endDate !== undefined) data.endDate = dto.endDate ? new Date(dto.endDate) : null;
    if (dto.currentPhase !== undefined) data.currentPhase = dto.currentPhase;
    if (dto.visibility !== undefined) {
      // 공개는 준비 점검과 무관하게 가능하다. 준비 점검은 readiness 조회로 참고만 한다.
      data.visibility = dto.visibility;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.positionRequirements !== undefined) {
        await tx.positionRequirement.deleteMany({ where: { productionId } });
        if (dto.positionRequirements.length > 0) {
          await tx.positionRequirement.createMany({
            data: dto.positionRequirements.map((position) => ({
              productionId,
              role: position.role,
              label: position.label,
              requiredCount: position.requiredCount ?? 1
            }))
          });
        }
      }
      return tx.production.update({
        where: { id: productionId },
        data,
        include: this.access.productionListInclude()
      });
    });

    await this.activityLog.log({
      productionId,
      organizationId: production.organizationId,
      actorId: user.id,
      action: "production.update",
      entity: "Production",
      entityId: productionId,
      reason: "공연 설정 수정",
      beforeJson: {
        title: production.title,
        visibility: production.visibility,
        currentPhase: production.currentPhase,
        positionRequirementCount: production.positionRequirements.length
      },
      afterJson: {
        title: updated.title,
        visibility: updated.visibility,
        currentPhase: updated.currentPhase,
        positionRequirementCount: updated.positionRequirements.length
      }
    });

    if (production.visibility !== Visibility.PUBLISHED && updated.visibility === Visibility.PUBLISHED) {
      await this.productionNotifications.notifyProductionPublished(productionId, updated.title, user);
    }

    return updated;
  }

  async archive(productionId: string, user: RequestUser) {
    await this.access.getAccess(productionId, user);
    const production = await this.prisma.production.findUnique({ where: { id: productionId } });
    if (!production) {
      throw new NotFoundException("찾을 수 없어요");
    }
    const archived = await this.prisma.production.update({
      where: { id: productionId },
      data: { archived: true, visibility: Visibility.DRAFT },
      include: this.access.productionListInclude()
    });
    await this.activityLog.log({
      productionId,
      organizationId: production.organizationId,
      actorId: user.id,
      action: "production.archive",
      entity: "Production",
      entityId: productionId,
      reason: "공연 보관",
      beforeJson: { archived: production.archived, visibility: production.visibility },
      afterJson: { archived: true, visibility: Visibility.DRAFT }
    });
    return archived;
  }

  /**
   * 공연 소프트 삭제 — 실제 데이터는 지우지 않고 deletedAt만 찍어 목록·접근에서 감춘다(휴지통).
   * 복구(restore)로 되살릴 수 있다.
   */
  async softDelete(productionId: string, user: RequestUser) {
    await this.access.getAccess(productionId, user);
    const production = await this.prisma.production.findUnique({ where: { id: productionId } });
    if (!production) {
      throw new NotFoundException("찾을 수 없어요");
    }
    if (production.deletedAt) {
      return { id: production.id, deletedAt: production.deletedAt };
    }
    const deleted = await this.prisma.production.update({
      where: { id: productionId },
      data: { deletedAt: new Date() },
      select: { id: true, deletedAt: true }
    });
    await this.activityLog.log({
      productionId,
      organizationId: production.organizationId,
      actorId: user.id,
      action: "production.delete",
      entity: "Production",
      entityId: productionId,
      reason: "공연 삭제(휴지통)",
      beforeJson: { deletedAt: null },
      afterJson: { deletedAt: deleted.deletedAt }
    });
    return deleted;
  }

  /** 삭제(휴지통)된 공연을 복구한다. */
  async restore(productionId: string, user: RequestUser) {
    await this.access.getAccess(productionId, user);
    const production = await this.prisma.production.findUnique({ where: { id: productionId } });
    if (!production) {
      throw new NotFoundException("찾을 수 없어요");
    }
    const restored = await this.prisma.production.update({
      where: { id: productionId },
      data: { deletedAt: null },
      include: this.access.productionListInclude()
    });
    await this.activityLog.log({
      productionId,
      organizationId: production.organizationId,
      actorId: user.id,
      action: "production.restore",
      entity: "Production",
      entityId: productionId,
      reason: "공연 복구",
      beforeJson: { deletedAt: production.deletedAt },
      afterJson: { deletedAt: null }
    });
    return restored;
  }

  /** 삭제(휴지통)된 공연 목록 — 관리자 복구 화면용. */
  async listDeleted(user: RequestUser) {
    if (user.platformRole === "SUPER_ADMIN") {
      return this.prisma.production.findMany({
        where: { deletedAt: { not: null } },
        orderBy: { deletedAt: "desc" },
        include: this.access.productionListInclude()
      });
    }
    if (user.platformRole === "ORG_ADMIN") {
      const caller = await this.prisma.user.findUnique({ where: { id: user.id }, select: { organizationId: true } });
      if (caller?.organizationId) {
        return this.prisma.production.findMany({
          where: { deletedAt: { not: null }, organizationId: caller.organizationId },
          orderBy: { deletedAt: "desc" },
          include: this.access.productionListInclude()
        });
      }
    }
    return [];
  }

  async duplicate(productionId: string, dto: DuplicateProductionDto, user: RequestUser) {
    await this.access.getAccess(productionId, user);
    const source = await this.prisma.production.findUnique({
      where: { id: productionId },
      include: { positionRequirements: true }
    });
    if (!source) {
      throw new NotFoundException("찾을 수 없어요");
    }

    const title = requiredText(dto.title, "복제할 공연 제목을 입력해 주세요");
    const titleExists = await this.prisma.production.findFirst({
      where: { organizationId: source.organizationId, title },
      select: { id: true }
    });
    if (titleExists) {
      throw titleTakenException();
    }
    const slug = optionalText(dto.slug);
    if (slug) {
      const slugExists = await this.prisma.production.findUnique({ where: { slug }, select: { id: true } });
      if (slugExists) {
        throw new ConflictException("이미 사용 중인 공개 주소예요");
      }
    }

    const checklistPhases = await checklistPhaseCreateDataFromTemplates(this.prisma);
    const duplicated = await this.prisma.production.create({
      data: {
        organizationId: source.organizationId,
        title,
        slug,
        synopsis: source.synopsis,
        description: source.description,
        venue: source.venue,
        startDate: source.startDate,
        endDate: source.endDate,
        currentPhase: Phase.PLANNING,
        visibility: Visibility.DRAFT,
        positionRequirements: {
          create: source.positionRequirements.map((position) => ({
            role: position.role,
            label: position.label,
            requiredCount: position.requiredCount
          }))
        },
        memberships: {
          create: {
            userId: user.id,
            primaryRole: ProductionRole.PRODUCER,
            roles: { create: { role: ProductionRole.PRODUCER } }
          }
        },
        checklistPhases: {
          create: checklistPhases
        }
      },
      include: this.access.productionListInclude()
    });

    await this.activityLog.log({
      productionId: duplicated.id,
      organizationId: source.organizationId,
      actorId: user.id,
      action: "production.duplicate",
      entity: "Production",
      entityId: duplicated.id,
      reason: `공연 복제: ${source.title}`,
      afterJson: { sourceProductionId: source.id, title: duplicated.title }
    });

    return duplicated;
  }

  async checkTitle(query: CheckProductionTitleQueryDto, user: RequestUser) {
    await this.assertCanCreateProduction(user);
    const organizationId = await this.resolveOrganizationId(query.organizationId, user);
    const title = requiredText(query.title, "공연 제목을 입력해 주세요");
    const exists = await this.prisma.production.findFirst({
      where: {
        organizationId,
        title,
        ...(query.excludeProductionId ? { id: { not: query.excludeProductionId } } : {})
      },
      select: { id: true }
    });
    return {
      available: !exists,
      organizationId,
      title,
      reason: exists ? "TITLE_TAKEN" : null,
      message: exists ? "같은 공연명이 있어요. 날짜·지역을 붙여 주세요" : "사용할 수 있는 공연 제목이에요"
    };
  }

  private async resolveOrganizationId(requestedOrganizationId: string | undefined, user: RequestUser) {
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { organizationId: true }
    });
    if (requestedOrganizationId) {
      if (user.platformRole === PlatformRole.SUPER_ADMIN) {
        return requestedOrganizationId;
      }
      if (dbUser?.organizationId && dbUser.organizationId === requestedOrganizationId) {
        return requestedOrganizationId;
      }
      throw new ForbiddenException("다른 단체에 공연을 만들 수 없어요");
    }
    if (dbUser?.organizationId) {
      return dbUser.organizationId;
    }
    const organization = await this.prisma.organization.upsert({
      where: { id: "org_default" },
      update: {},
      create: { id: "org_default", name: "아트브릿지 운영단체" }
    });
    return organization.id;
  }

  private async assertCanCreateProduction(user: RequestUser) {
    if (user.platformRole === PlatformRole.SUPER_ADMIN || user.platformRole === PlatformRole.ORG_ADMIN) {
      return;
    }

    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { profileType: true }
    });
    const allowedProfileTypes: ProfileType[] = [
      ProfileType.PLANNER,
      ProfileType.DIRECTOR,
      ProfileType.MUSIC_DIRECTOR,
      ProfileType.STAGE_MANAGER
    ];
    if (!dbUser || !allowedProfileTypes.includes(dbUser.profileType)) {
      throw new ForbiddenException("공연 생성은 기획자, 연출자, 음악감독, 무대감독 또는 관리자만 할 수 있어요");
    }
  }
}
