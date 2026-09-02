import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  AnchorStatus,
  AssetKind,
  ChecklistStatus,
  Phase,
  PlatformRole,
  ProfileType,
  Prisma,
  ProductionRole,
  RunSheetStatus,
  StaffDiscipline,
  Visibility
} from "@prisma/client";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestUser } from "../common/types/request-user";
import { isProductionAdmin } from "../common/access/is-production-admin";
import { MailService } from "../mail/mail.service";
import { NotificationsService } from "../notifications/notifications.service";
import {
  AddMembersDto,
  CheckProductionTitleQueryDto,
  CreateInvitationDto,
  CreateProductionDto,
  DuplicateProductionDto,
  PositionRequirementDto,
  PutStaffAssignmentsDto,
  ReplacePositionRequirementsDto,
  SearchProductionQueryDto,
  SetBackgroundVideoDto,
  UpdateMemberDto,
  UpdatePositionRequirementDto,
  UpdateProductionDto
} from "./dto";
import { checklistPhaseCreateDataFromTemplates } from "../checklist/checklist-template-seed";

type ProductionSearchResultType =
  | "SCRIPT_BLOCK"
  | "ROLE"
  | "MEMBER"
  | "MUSIC_CUE"
  | "EVENT";

type ProductionSearchResult = {
  type: ProductionSearchResultType;
  id: string;
  title: string;
  snippet: string | null;
  href: string;
  resourceType: string;
  resourceId: string;
  metadata?: Record<string, unknown>;
};

type ProductionSearchGroup = {
  type: ProductionSearchResultType;
  label: string;
  count: number;
  items: ProductionSearchResult[];
};

type ReadinessCheck = {
  key: string;
  label: string;
  ready: boolean;
  detail: string;
  href: string;
  readyCount?: number;
  totalCount?: number;
  blockingCount?: number;
  warningCount?: number;
};

const PEOPLE_MANAGER_ROLES: readonly ProductionRole[] = [
  ProductionRole.PRODUCER,
  ProductionRole.DIRECTOR,
  ProductionRole.MUSIC_DIRECTOR,
  ProductionRole.STAGE_MANAGER
];

const PEOPLE_SENSITIVE_ROLES: readonly ProductionRole[] = [
  ProductionRole.PRODUCER,
  ProductionRole.DIRECTOR,
  ProductionRole.STAGE_MANAGER
];

@Injectable()
export class ProductionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService
  ) {}

  async listForUser(user: RequestUser) {
    if (user.platformRole === "SUPER_ADMIN") {
      return this.prisma.production.findMany({
        where: { archived: false, deletedAt: null },
        orderBy: { createdAt: "desc" },
        include: this.productionListInclude()
      });
    }

    // 조직 운영자는 소속 조직의 공연을 모두 본다(멤버로 지정돼 있지 않아도).
    if (user.platformRole === "ORG_ADMIN") {
      const caller = await this.prisma.user.findUnique({ where: { id: user.id }, select: { organizationId: true } });
      if (caller?.organizationId) {
        return this.prisma.production.findMany({
          where: { archived: false, deletedAt: null, organizationId: caller.organizationId },
          orderBy: { createdAt: "desc" },
          include: this.productionListInclude()
        });
      }
    }

    const memberships = await this.prisma.membership.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: {
        roles: true,
        production: { include: this.productionListInclude() }
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
    const title = this.requiredText(dto.title, "공연 제목을 입력해 주세요");
    this.assertDateRange(dto.startDate, dto.endDate);
    if (dto.visibility === Visibility.PUBLISHED) {
      throw new BadRequestException("새 공연은 먼저 DRAFT로 생성한 뒤 공개 준비 점검을 통과해야 해요");
    }

    const titleExists = await this.prisma.production.findFirst({
      where: { organizationId, title },
      select: { id: true }
    });
    if (titleExists) {
      throw this.titleTakenException();
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
        slug: this.optionalText(dto.slug),
        synopsis: this.optionalText(dto.synopsis),
        description: this.optionalText(dto.description),
        venue: this.optionalText(dto.venue),
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
      include: this.productionListInclude()
    });

    await this.logActivity({
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
    await this.assertMemberOrAdmin(id, user);
    const production = await this.prisma.production.findUnique({
      where: { id },
      include: this.productionListInclude()
    });
    if (!production) {
      throw new NotFoundException("찾을 수 없어요");
    }
    return production;
  }

  async listPositionRequirements(productionId: string, user: RequestUser) {
    await this.assertMemberOrAdmin(productionId, user);
    return this.findPositionRequirements(productionId);
  }

  async createPositionRequirement(productionId: string, dto: PositionRequirementDto, user: RequestUser) {
    const access = await this.getProductionAccess(productionId, user);
    const data = this.normalizePositionRequirement(productionId, dto);
    const position = await this.prisma.positionRequirement.create({ data });
    await this.logActivity({
      productionId,
      organizationId: access.production.organizationId,
      actorId: user.id,
      action: "production.position.create",
      entity: "PositionRequirement",
      entityId: position.id,
      reason: "필요 정원 추가",
      afterJson: this.serializePositionRequirement(position)
    });
    return position;
  }

  async replacePositionRequirements(productionId: string, dto: ReplacePositionRequirementsDto, user: RequestUser) {
    const access = await this.getProductionAccess(productionId, user);
    const before = await this.findPositionRequirements(productionId);
    const normalized = dto.positions.map((position) => this.normalizePositionRequirement(productionId, position));

    const after = await this.prisma.$transaction(async (tx) => {
      await tx.positionRequirement.deleteMany({ where: { productionId } });
      await tx.positionRequirement.createMany({ data: normalized });
      return tx.positionRequirement.findMany({ where: { productionId }, orderBy: this.positionRequirementOrderBy() });
    });

    await this.logActivity({
      productionId,
      organizationId: access.production.organizationId,
      actorId: user.id,
      action: "production.position.replace",
      entity: "Production",
      entityId: productionId,
      reason: "필요 정원 전체 교체",
      beforeJson: this.serializePositionRequirements(before),
      afterJson: this.serializePositionRequirements(after)
    });
    return after;
  }

  async updatePositionRequirement(productionId: string, positionId: string, dto: UpdatePositionRequirementDto, user: RequestUser) {
    const access = await this.getProductionAccess(productionId, user);
    const position = await this.assertPositionRequirement(productionId, positionId);
    const data: Prisma.PositionRequirementUpdateInput = {};
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.label !== undefined) data.label = this.requiredText(dto.label, "필요 정원 라벨을 입력해 주세요");
    if (dto.requiredCount !== undefined) data.requiredCount = dto.requiredCount;
    if (Object.keys(data).length === 0) {
      throw new BadRequestException("수정할 필요 정원 항목을 입력해 주세요");
    }

    const updated = await this.prisma.positionRequirement.update({ where: { id: positionId }, data });
    await this.logActivity({
      productionId,
      organizationId: access.production.organizationId,
      actorId: user.id,
      action: "production.position.update",
      entity: "PositionRequirement",
      entityId: positionId,
      reason: "필요 정원 수정",
      beforeJson: this.serializePositionRequirement(position),
      afterJson: this.serializePositionRequirement(updated)
    });
    return updated;
  }

  async deletePositionRequirement(productionId: string, positionId: string, user: RequestUser) {
    const access = await this.getProductionAccess(productionId, user);
    const position = await this.assertPositionRequirement(productionId, positionId);
    const count = await this.prisma.positionRequirement.count({ where: { productionId } });
    if (count <= 1) {
      throw new BadRequestException("필요 정원은 최소 1개 이상 유지해야 해요");
    }

    await this.prisma.positionRequirement.delete({ where: { id: positionId } });
    await this.logActivity({
      productionId,
      organizationId: access.production.organizationId,
      actorId: user.id,
      action: "production.position.delete",
      entity: "PositionRequirement",
      entityId: positionId,
      reason: "필요 정원 삭제",
      beforeJson: this.serializePositionRequirement(position)
    });
    return { deletedId: positionId };
  }

  async getReadiness(productionId: string, user: RequestUser) {
    await this.getProductionAccess(productionId, user);
    const production = await this.prisma.production.findUnique({
      where: { id: productionId },
      include: {
        memberships: { include: { roles: true, staffAssignments: true } },
        scripts: {
          select: {
            id: true,
            versions: { select: { id: true }, take: 1 },
            acts: {
              select: {
                scenes: {
                  select: {
                    blocks: { select: { id: true } }
                  }
                }
              }
            }
          }
        },
        musicCues: { select: { id: true, anchorStatus: true } },
        events: { include: { attendances: { select: { status: true } } } },
        runSheets: { select: { id: true, status: true } },
        checklistPhases: { include: { items: { select: { id: true, status: true } } } }
      }
    });
    if (!production) {
      throw new NotFoundException("찾을 수 없어요");
    }

    const staffMemberships = production.memberships.filter((membership) => membership.roles.some((role) => role.role === "STAFF"));
    const staffWithoutDiscipline = staffMemberships.filter((membership) => membership.staffAssignments.length === 0).length;
    const scriptSummaries = production.scripts.map((script) => ({
      hasVersion: script.versions.length > 0,
      blockCount: script.acts.reduce(
        (actTotal, act) => actTotal + act.scenes.reduce((sceneTotal, scene) => sceneTotal + scene.blocks.length, 0),
        0
      )
    }));
    const confirmedScripts = scriptSummaries.filter((script) => script.hasVersion && script.blockCount > 0).length;
    const scriptBlockCount = scriptSummaries.reduce((total, script) => total + script.blockCount, 0);
    const scriptsWithVersion = scriptSummaries.filter((script) => script.hasVersion).length;
    const scriptsWithBlocks = scriptSummaries.filter((script) => script.blockCount > 0).length;
    const brokenCues = production.musicCues.filter((cue) => cue.anchorStatus !== AnchorStatus.OK).length;
    const attendances = production.events.flatMap((event) => event.attendances);
    const pendingAttendances = attendances.filter((attendance) => attendance.status === "INVITED").length;
    const checklistItems = production.checklistPhases.flatMap((phase) => phase.items);
    const doneChecklist = checklistItems.filter((item) => item.status === ChecklistStatus.DONE).length;
    const blockedChecklist = checklistItems.filter((item) => item.status === ChecklistStatus.BLOCKED).length;
    const waitingApprovalChecklist = checklistItems.filter((item) => item.status === ChecklistStatus.WAITING_APPROVAL).length;
    const incompleteChecklist = checklistItems.length - doneChecklist;
    const lockedRunSheets = production.runSheets.filter(
      (sheet) => sheet.status === RunSheetStatus.LOCKED || sheet.status === RunSheetStatus.COMPLETED
    ).length;

    const checks: ReadinessCheck[] = [
      {
        key: "SCRIPT_READY",
        label: "대본 확정",
        ready: confirmedScripts > 0,
        detail:
          confirmedScripts > 0
            ? `확정 버전과 장면 블록이 있는 대본 ${confirmedScripts}개, 총 블록 ${scriptBlockCount}개`
            : production.scripts.length === 0
              ? "대본 에디터에서 첫 대본을 등록해 주세요."
              : scriptsWithBlocks === 0
                ? "장면/대사 블록을 먼저 입력하거나 파일 import를 반영해 주세요."
                : scriptsWithVersion === 0
                  ? "대본 버전을 생성해 공개 기준 확정본을 남겨 주세요."
                  : "확정 버전과 장면 블록을 모두 가진 대본이 필요해요.",
        href: "script",
        readyCount: confirmedScripts,
        totalCount: Math.max(production.scripts.length, 1),
        blockingCount: confirmedScripts > 0 ? 0 : 1
      },
      {
        key: "MEMBER_MATCHED",
        label: "멤버 매칭",
        ready: production.memberships.length > 1,
        detail:
          production.memberships.length > 1
            ? `${production.memberships.length}명 연결`
            : "기획자 외 배우·스태프·음악감독을 연결해 주세요.",
        href: "members",
        readyCount: production.memberships.length > 1 ? 1 : 0,
        totalCount: 1,
        blockingCount: production.memberships.length > 1 ? 0 : 1
      },
      {
        key: "STAFF_DISCIPLINE",
        label: "스태프 직무 지정",
        ready: staffMemberships.length > 0 && staffWithoutDiscipline === 0,
        detail:
          staffMemberships.length === 0
            ? "STAFF 역할 멤버가 필요해요."
            : staffWithoutDiscipline > 0
              ? `직무 미지정 STAFF ${staffWithoutDiscipline}명`
              : "모든 STAFF에 세부 직무가 지정됐어요.",
        href: "members",
        readyCount: staffMemberships.length - staffWithoutDiscipline,
        totalCount: Math.max(staffMemberships.length, 1),
        blockingCount: staffMemberships.length === 0 ? 1 : staffWithoutDiscipline
      },
      {
        key: "MUSIC_CUE_ANCHOR",
        label: "음악 큐 anchor",
        ready: production.musicCues.length > 0 && brokenCues === 0,
        detail:
          production.musicCues.length === 0
            ? "음악 큐시트에 최소 1개 cue를 등록해 주세요."
            : brokenCues > 0
              ? `대본 anchor가 필요한 cue ${brokenCues}개`
              : "모든 음악 cue가 대본에 연결됐어요.",
        href: "music",
        readyCount: production.musicCues.length - brokenCues,
        totalCount: Math.max(production.musicCues.length, 1),
        blockingCount: production.musicCues.length === 0 ? 1 : brokenCues
      },
      {
        key: "SCHEDULE_ATTENDANCE",
        label: "일정·출석",
        ready: production.events.length > 0 && attendances.length > 0,
        detail:
          production.events.length === 0
            ? "리딩 또는 리허설 일정을 만들어 주세요."
            : attendances.length === 0
              ? "일정 참석자를 연결해 주세요."
              : pendingAttendances > 0
                ? `출석 미응답 ${pendingAttendances}건이 남아 있어요. 공개는 가능하지만 확인이 필요합니다.`
                : "일정과 참석자가 연결됐어요.",
        href: "schedule",
        readyCount: attendances.length - pendingAttendances,
        totalCount: Math.max(attendances.length, 1),
        blockingCount: production.events.length === 0 || attendances.length === 0 ? 1 : 0,
        warningCount: pendingAttendances
      },
      {
        key: "RUN_SHEET_LOCKED",
        label: "진행표 확정",
        ready: lockedRunSheets > 0,
        detail: lockedRunSheets > 0
          ? "확정된 진행표가 있어요."
          : "일정 기반 진행표를 생성하고 확정해 주세요.",
        href: "run-sheets",
        readyCount: lockedRunSheets,
        totalCount: Math.max(production.runSheets.length, 1),
        blockingCount: lockedRunSheets > 0 ? 0 : 1
      },
      {
        key: "CHECKLIST_REQUIRED",
        label: "필수 체크리스트",
        ready: checklistItems.length > 0 && incompleteChecklist === 0,
        detail:
          checklistItems.length === 0
            ? "체크리스트 단계가 필요해요."
            : blockedChecklist > 0
              ? `차단 항목 ${blockedChecklist}개를 먼저 해결해 주세요.`
              : waitingApprovalChecklist > 0
                ? `승인 대기 항목 ${waitingApprovalChecklist}개가 남아 있어요.`
                : incompleteChecklist > 0
                  ? `완료되지 않은 체크리스트 ${incompleteChecklist}개가 남아 있어요.`
                  : "필수 체크리스트가 모두 완료됐어요.",
        href: "checklist",
        readyCount: doneChecklist,
        totalCount: Math.max(checklistItems.length, 1),
        blockingCount: checklistItems.length === 0 ? 1 : incompleteChecklist,
        warningCount: waitingApprovalChecklist
      }
    ];

    const ready = checks.every((check) => check.ready);
    return {
      productionId,
      ready,
      summary: {
        readyCount: checks.filter((check) => check.ready).length,
        totalCount: checks.length,
        blockingCount: checks.filter((check) => !check.ready).length,
        warningCount: checks.reduce((total, check) => total + (check.warningCount ?? 0), 0)
      },
      checks
    };
  }

  /** 공연 뒷배경 영상 지정/해제 — 타임라인 재생의 기준 시계가 되는 영상. */
  async setBackgroundVideo(productionId: string, dto: SetBackgroundVideoDto, user: RequestUser) {
    await this.getProductionAccess(productionId, user);
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
    await this.getProductionAccess(productionId, user);
    const production = await this.prisma.production.findUnique({ where: { id: productionId }, include: { positionRequirements: true } });
    if (!production) {
      throw new NotFoundException("찾을 수 없어요");
    }

    const nextStartDate = dto.startDate === undefined ? production.startDate?.toISOString() : dto.startDate;
    const nextEndDate = dto.endDate === undefined ? production.endDate?.toISOString() : dto.endDate;
    this.assertDateRange(nextStartDate, nextEndDate);

    const data: Prisma.ProductionUpdateInput = {};
    if (dto.title !== undefined) {
      const title = this.requiredText(dto.title, "공연 제목을 입력해 주세요");
      if (title !== production.title) {
        const titleExists = await this.prisma.production.findFirst({
          where: { organizationId: production.organizationId, title, id: { not: productionId } },
          select: { id: true }
        });
        if (titleExists) {
          throw this.titleTakenException();
        }
      }
      data.title = title;
    }
    if (dto.slug !== undefined) {
      const slug = this.optionalText(dto.slug);
      if (slug && slug !== production.slug) {
        const slugExists = await this.prisma.production.findUnique({ where: { slug }, select: { id: true } });
        if (slugExists) {
          throw new ConflictException("이미 사용 중인 공개 주소예요");
        }
      }
      data.slug = slug;
    }
    if (dto.synopsis !== undefined) data.synopsis = this.optionalText(dto.synopsis);
    if (dto.description !== undefined) data.description = this.optionalText(dto.description);
    if (dto.venue !== undefined) data.venue = this.optionalText(dto.venue);
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
        include: this.productionListInclude()
      });
    });

    await this.logActivity({
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
      await this.notifyProductionPublished(productionId, updated.title, user);
    }

    return updated;
  }

  async archive(productionId: string, user: RequestUser) {
    await this.getProductionAccess(productionId, user);
    const production = await this.prisma.production.findUnique({ where: { id: productionId } });
    if (!production) {
      throw new NotFoundException("찾을 수 없어요");
    }
    const archived = await this.prisma.production.update({
      where: { id: productionId },
      data: { archived: true, visibility: Visibility.DRAFT },
      include: this.productionListInclude()
    });
    await this.logActivity({
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
    await this.getProductionAccess(productionId, user);
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
    await this.logActivity({
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
    await this.getProductionAccess(productionId, user);
    const production = await this.prisma.production.findUnique({ where: { id: productionId } });
    if (!production) {
      throw new NotFoundException("찾을 수 없어요");
    }
    const restored = await this.prisma.production.update({
      where: { id: productionId },
      data: { deletedAt: null },
      include: this.productionListInclude()
    });
    await this.logActivity({
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
        include: this.productionListInclude()
      });
    }
    if (user.platformRole === "ORG_ADMIN") {
      const caller = await this.prisma.user.findUnique({ where: { id: user.id }, select: { organizationId: true } });
      if (caller?.organizationId) {
        return this.prisma.production.findMany({
          where: { deletedAt: { not: null }, organizationId: caller.organizationId },
          orderBy: { deletedAt: "desc" },
          include: this.productionListInclude()
        });
      }
    }
    return [];
  }

  async duplicate(productionId: string, dto: DuplicateProductionDto, user: RequestUser) {
    await this.getProductionAccess(productionId, user);
    const source = await this.prisma.production.findUnique({
      where: { id: productionId },
      include: { positionRequirements: true }
    });
    if (!source) {
      throw new NotFoundException("찾을 수 없어요");
    }

    const title = this.requiredText(dto.title, "복제할 공연 제목을 입력해 주세요");
    const titleExists = await this.prisma.production.findFirst({
      where: { organizationId: source.organizationId, title },
      select: { id: true }
    });
    if (titleExists) {
      throw this.titleTakenException();
    }
    const slug = this.optionalText(dto.slug);
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
      include: this.productionListInclude()
    });

    await this.logActivity({
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
    const title = this.requiredText(query.title, "공연 제목을 입력해 주세요");
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

  async addMembers(productionId: string, dto: AddMembersDto, user: RequestUser) {
    await this.assertCanManageMembers(productionId, user);
    const roles = Array.from(new Set(dto.roles));
    const userIds = Array.from(new Set(dto.userIds));
    if (!roles.includes(dto.primaryRole)) {
      throw new BadRequestException("대표 역할은 역할 목록에 포함되어야 해요");
    }

    const [production, users] = await Promise.all([
      this.prisma.production.findUnique({
        where: { id: productionId },
        select: { id: true, title: true, organizationId: true }
      }),
      this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, email: true, name: true }
      })
    ]);
    if (!production) {
      throw new NotFoundException("찾을 수 없어요");
    }
    if (users.length !== userIds.length) {
      throw new BadRequestException("존재하지 않는 사용자가 포함되어 있어요");
    }

    const results = await this.prisma.$transaction(async (tx) => {
      const memberships = [];
      for (const userId of userIds) {
        const membership = await tx.membership.upsert({
          where: { userId_productionId: { userId, productionId } },
          update: { primaryRole: dto.primaryRole },
          create: { userId, productionId, primaryRole: dto.primaryRole }
        });

        await tx.membershipRole.deleteMany({ where: { membershipId: membership.id } });
        await tx.membershipRole.createMany({
          data: roles.map((role) => ({ membershipId: membership.id, role, grantedById: user.id })),
          skipDuplicates: true
        });
        memberships.push(membership);
      }

      await tx.activityLog.create({
        data: {
          productionId,
          organizationId: production.organizationId,
          actorId: user.id,
          action: "production.member.add",
          entity: "Production",
          entityId: productionId,
          reason: "멤버 일괄 매칭",
          afterJson: {
            count: memberships.length,
            userIds,
            roles,
            primaryRole: dto.primaryRole,
            sendNotification: dto.sendNotification !== false
          }
        }
      });

      return memberships;
    });

    if (dto.sendNotification !== false) {
      const userById = new Map(users.map((matchedUser) => [matchedUser.id, matchedUser]));
      await this.notifications.createNotifications(
        results.map((membership) => ({
          userId: membership.userId,
          productionId,
          type: "production.member_added",
          payload: {
            productionId,
            productionTitle: production.title,
            membershipId: membership.id,
            roles,
            primaryRole: dto.primaryRole,
            matchedByUserId: user.id
          }
        }))
      );
      await Promise.all(
        results.map((membership) => {
          const targetUser = userById.get(membership.userId);
          if (!targetUser) {
            return Promise.resolve(null);
          }
          return this.mail.queueEmail({
            userId: targetUser.id,
            productionId,
            toEmail: targetUser.email,
            subject: `[아트브릿지] ${production.title} 공연 역할 매칭 안내`,
            templateKey: "production.member_added",
            bodyText: this.memberAddedEmailBody({
              productionTitle: production.title,
              recipientName: targetUser.name,
              roles,
              primaryRole: dto.primaryRole,
              productionUrl: `${this.appPublicUrl()}/app/p/${productionId}`
            }),
            metadata: {
              productionId,
              membershipId: membership.id,
              roles,
              primaryRole: dto.primaryRole,
              matchedByUserId: user.id,
              matchedByUserName: user.name,
              fromEmail: this.mail.fromEmail()
            }
          });
        })
      );
    }

    return { count: results.length };
  }

  async updateMember(productionId: string, membershipId: string, dto: UpdateMemberDto, user: RequestUser) {
    await this.assertCanManageMembers(productionId, user);
    const updated = await this.prisma.$transaction(async (tx) => {
      const membership = await tx.membership.findUnique({
        where: { id: membershipId },
        include: {
          roles: { select: { role: true } },
          user: { select: { id: true, email: true, name: true } },
          production: { select: { id: true, title: true, organizationId: true } }
        }
      });
      if (!membership || membership.productionId !== productionId) {
        throw new NotFoundException("찾을 수 없어요");
      }

      const beforeRoles = membership.roles.map((role) => role.role);
      const nextRoles = this.normalizeRoles(dto.roles, beforeRoles);
      const nextPrimaryRole = dto.primaryRole ?? (nextRoles.includes(membership.primaryRole) ? membership.primaryRole : nextRoles[0]);
      if (!nextRoles.includes(nextPrimaryRole)) {
        throw new BadRequestException("대표 역할은 역할 목록에 포함되어야 해요");
      }

      await this.assertProducerRemains(tx, productionId, membershipId, nextRoles);

      await tx.membershipRole.deleteMany({ where: { membershipId } });
      await tx.membershipRole.createMany({
        data: nextRoles.map((role) => ({ membershipId, role, grantedById: user.id })),
        skipDuplicates: true
      });
      if (!nextRoles.includes(ProductionRole.STAFF)) {
        await tx.staffAssignment.deleteMany({ where: { membershipId } });
      }

      const result = await tx.membership.update({
        where: { id: membershipId },
        data: { primaryRole: nextPrimaryRole },
        include: this.memberInclude()
      });

      await tx.activityLog.create({
        data: {
          productionId,
          organizationId: membership.production.organizationId,
          actorId: user.id,
          action: "production.member.update",
          entity: "Membership",
          entityId: membershipId,
          reason: "멤버 역할 수정",
          beforeJson: {
            userId: membership.user.id,
            email: membership.user.email,
            primaryRole: membership.primaryRole,
            roles: beforeRoles
          },
          afterJson: {
            userId: membership.user.id,
            email: membership.user.email,
            primaryRole: nextPrimaryRole,
            roles: nextRoles
          }
        }
      });

      return {
        result,
        changed: membership.primaryRole !== nextPrimaryRole || this.rolesChanged(beforeRoles, nextRoles),
        beforeRoles,
        nextRoles,
        beforePrimaryRole: membership.primaryRole,
        nextPrimaryRole,
        production: membership.production,
        targetUser: membership.user
      };
    });

    if (updated.changed) {
      const payload = {
        productionId,
        productionTitle: updated.production.title,
        membershipId,
        beforeRoles: updated.beforeRoles,
        roles: updated.nextRoles,
        beforePrimaryRole: updated.beforePrimaryRole,
        primaryRole: updated.nextPrimaryRole,
        changedByUserId: user.id
      };
      await this.notifications.createNotification({
        userId: updated.targetUser.id,
        productionId,
        type: "production.member_role_updated",
        payload
      });
      await this.mail.queueEmail({
        userId: updated.targetUser.id,
        productionId,
        toEmail: updated.targetUser.email,
        subject: `[아트브릿지] ${updated.production.title} 공연 역할 변경 안내`,
        templateKey: "production.member_role_updated",
        bodyText: this.memberRoleUpdatedEmailBody({
          productionTitle: updated.production.title,
          recipientName: updated.targetUser.name,
          beforeRoles: updated.beforeRoles,
          roles: updated.nextRoles,
          primaryRole: updated.nextPrimaryRole,
          actorName: user.name,
          productionUrl: `${this.appPublicUrl()}/app/p/${productionId}`
        }),
        metadata: {
          ...payload,
          changedByUserName: user.name,
          fromEmail: this.mail.fromEmail()
        }
      });
    }

    return updated.result;
  }

  async removeMember(productionId: string, membershipId: string, user: RequestUser) {
    await this.assertCanManageMembers(productionId, user);
    const removed = await this.prisma.$transaction(async (tx) => {
      const membership = await tx.membership.findUnique({
        where: { id: membershipId },
        include: {
          roles: { select: { role: true } },
          user: { select: { id: true, email: true, name: true } },
          production: { select: { id: true, title: true, organizationId: true } }
        }
      });
      if (!membership || membership.productionId !== productionId) {
        throw new NotFoundException("찾을 수 없어요");
      }

      const beforeRoles = membership.roles.map((role) => role.role);
      await this.assertProducerRemains(tx, productionId, membershipId, []);

      await tx.runSheetItem.updateMany({ where: { ownerMembershipId: membershipId }, data: { ownerMembershipId: null } });
      await tx.checklistAssignment.deleteMany({ where: { membershipId } });
      await tx.attendance.deleteMany({ where: { membershipId } });
      await tx.castAssignment.deleteMany({ where: { membershipId } });
      await tx.staffAssignment.deleteMany({ where: { membershipId } });
      await tx.membershipRole.deleteMany({ where: { membershipId } });
      await tx.membership.delete({ where: { id: membershipId } });

      await tx.activityLog.create({
        data: {
          productionId,
          organizationId: membership.production.organizationId,
          actorId: user.id,
          action: "production.member.remove",
          entity: "Membership",
          entityId: membershipId,
          reason: "멤버 해제",
          beforeJson: {
            userId: membership.user.id,
            email: membership.user.email,
            name: membership.user.name,
            primaryRole: membership.primaryRole,
            roles: beforeRoles
          }
        }
      });

      return {
        ok: true,
        removedMembershipId: membershipId,
        userId: membership.user.id,
        userEmail: membership.user.email,
        userName: membership.user.name,
        productionTitle: membership.production.title,
        primaryRole: membership.primaryRole,
        roles: beforeRoles
      };
    });

    let notificationId: string | undefined;
    let emailDeliveryId: string | undefined;
    let emailDeliveryStatus: string | undefined;
    if (removed.userId !== user.id) {
      const payload = {
        productionId,
        productionTitle: removed.productionTitle,
        membershipId,
        roles: removed.roles,
        primaryRole: removed.primaryRole,
        removedByUserId: user.id,
        removedByUserName: user.name
      };
      const [notification, emailDelivery] = await Promise.all([
        this.notifications.createNotification({
          userId: removed.userId,
          productionId,
          type: "production.member_removed",
          payload
        }),
        this.mail.queueEmail({
          userId: removed.userId,
          productionId,
          toEmail: removed.userEmail,
          subject: `[아트브릿지] ${removed.productionTitle} 공연 매칭 해제 안내`,
          templateKey: "production.member_removed",
          bodyText: this.memberRemovedEmailBody({
            productionTitle: removed.productionTitle,
            recipientName: removed.userName,
            roles: removed.roles,
            actorName: user.name,
            productionsUrl: `${this.appPublicUrl()}/productions`
          }),
          metadata: {
            ...payload,
            fromEmail: this.mail.fromEmail()
          }
        })
      ]);
      notificationId = notification.id;
      emailDeliveryId = emailDelivery.id;
      emailDeliveryStatus = emailDelivery.status;
    }

    return {
      ok: true,
      removedMembershipId: removed.removedMembershipId,
      userId: removed.userId,
      notificationId,
      emailDeliveryId,
      emailDeliveryStatus
    };
  }

  async createInvitation(productionId: string, dto: CreateInvitationDto) {
    const production = await this.prisma.production.findUnique({
      where: { id: productionId },
      select: { id: true, title: true }
    });
    if (!production) {
      throw new NotFoundException("공연을 찾을 수 없어요");
    }

    const email = dto.email.trim().toLowerCase();
    if (!email) {
      throw new BadRequestException("초대 이메일을 입력해 주세요");
    }

    const invitation = await this.prisma.invitation.create({
      data: {
        productionId,
        email,
        role: dto.role,
        token: randomBytes(24).toString("base64url"),
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 72)
      }
    });
    const inviteUrl = `${this.appPublicUrl()}/invite/${invitation.token}`;
    const emailDelivery = await this.mail.queueEmail({
      productionId,
      toEmail: invitation.email,
      subject: `[아트브릿지] ${production.title} 공연 초대`,
      templateKey: "production.invitation",
      bodyText: [
        `${production.title} 공연에 ${invitation.role} 역할로 초대되었습니다.`,
        "",
        "아래 링크에서 초대를 확인하고 수락해 주세요.",
        "",
        inviteUrl,
        "",
        `초대 링크 만료: ${invitation.expiresAt.toISOString()}`
      ].join("\n"),
      metadata: {
        invitationId: invitation.id,
        role: invitation.role,
        expiresAt: invitation.expiresAt.toISOString(),
        fromEmail: this.mail.fromEmail()
      }
    });

    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      inviteUrl,
      emailDeliveryId: emailDelivery.id,
      emailDeliveryStatus: emailDelivery.status,
      production
    };
  }

  async getInvitation(token: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { token },
      include: { production: { select: { id: true, title: true, currentPhase: true, visibility: true } } }
    });
    if (!invitation) {
      throw new NotFoundException("초대를 찾을 수 없어요");
    }
    const expired = invitation.expiresAt.getTime() < Date.now();
    return {
      email: invitation.email,
      role: invitation.role,
      status: expired && invitation.status === "PENDING" ? "EXPIRED" : invitation.status,
      expiresAt: invitation.expiresAt,
      expired,
      production: invitation.production
    };
  }

  async acceptInvitation(token: string, user: RequestUser) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { token },
      include: { production: { select: { id: true, title: true } } }
    });
    if (!invitation) {
      throw new NotFoundException("초대를 찾을 수 없어요");
    }
    if (invitation.status !== "PENDING") {
      throw new BadRequestException("이미 처리된 초대예요");
    }
    if (invitation.expiresAt.getTime() < Date.now()) {
      await this.prisma.invitation.update({ where: { id: invitation.id }, data: { status: "EXPIRED" } });
      throw new BadRequestException("초대 링크가 만료됐어요. 관리자에게 다시 요청해 주세요.");
    }
    if (invitation.email.toLowerCase() !== user.email.toLowerCase()) {
      throw new ForbiddenException("초대받은 이메일 계정으로 로그인해 주세요");
    }

    const membership = await this.prisma.membership.upsert({
      where: { userId_productionId: { userId: user.id, productionId: invitation.productionId } },
      update: {},
      create: {
        userId: user.id,
        productionId: invitation.productionId,
        primaryRole: invitation.role
      }
    });

    await this.prisma.membershipRole.upsert({
      where: { membershipId_role: { membershipId: membership.id, role: invitation.role } },
      update: {},
      create: { membershipId: membership.id, role: invitation.role }
    });

    await this.prisma.invitation.update({ where: { id: invitation.id }, data: { status: "ACCEPTED" } });
    await this.notifications.createNotification({
      userId: user.id,
      productionId: invitation.productionId,
      type: "membership.invitation_accepted",
      payload: {
        title: `${invitation.production.title} 공연 초대를 수락했어요.`,
        role: invitation.role
      }
    });

    return {
      ok: true,
      productionId: invitation.productionId,
      membershipId: membership.id,
      role: invitation.role,
      next: `/app/p/${invitation.productionId}`
    };
  }

  async listMembers(productionId: string) {
    return this.prisma.membership.findMany({
      where: { productionId },
      orderBy: { createdAt: "asc" },
      include: this.memberInclude()
    });
  }

  async listPeople(productionId: string, user: RequestUser) {
    const access = await this.getProductionAccess(productionId, user);
    const memberships = await this.prisma.membership.findMany({
      where: { productionId },
      orderBy: { createdAt: "asc" },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            phone: true,
            profileType: true,
            profileDetails: true,
            profileComplete: true,
            status: true,
            photoAssetId: true
          }
        },
        roles: { select: { role: true } },
        staffAssignments: {
          select: { id: true, discipline: true, customLabel: true, note: true }
        },
        castAssignments: {
          include: {
            role: { select: { id: true, name: true, description: true } }
          }
        },
        attendances: {
          select: {
            status: true,
            event: { select: { id: true, title: true, type: true, startAt: true } }
          },
          orderBy: { event: { startAt: "desc" } },
          take: 5
        }
      }
    });

    const people = memberships.map((membership) => {
      const roles = membership.roles.map((role) => role.role);
      const attendanceSummary = membership.attendances.reduce<Record<string, number>>((summary, attendance) => {
        summary[attendance.status] = (summary[attendance.status] ?? 0) + 1;
        return summary;
      }, {});
      return {
        id: membership.id,
        primaryRole: membership.primaryRole,
        roles,
        user: {
          id: membership.user.id,
          name: membership.user.name,
          email: access.canViewSensitive ? membership.user.email : this.maskEmail(membership.user.email),
          phone: access.canViewSensitive ? membership.user.phone : null,
          profileType: membership.user.profileType,
          profileDetails: membership.user.profileDetails,
          profileComplete: membership.user.profileComplete,
          status: membership.user.status,
          photoAssetId: membership.user.photoAssetId,
          contactVisible: access.canViewSensitive
        },
        staffAssignments: membership.staffAssignments,
        castAssignments: membership.castAssignments.map((assignment) => ({
          id: assignment.id,
          kind: assignment.kind,
          role: assignment.role
        })),
        attendanceSummary,
        recentAttendances: membership.attendances.map((attendance) => ({
          status: attendance.status,
          event: attendance.event
        }))
      };
    });

    return {
      production: access.production,
      viewer: {
        canViewSensitive: access.canViewSensitive,
        roles: access.viewerMembership?.roles.map((role) => role.role) ?? [],
        platformRole: user.platformRole
      },
      summary: {
        total: people.length,
        actors: people.filter((person) => person.roles.includes(ProductionRole.ACTOR)).length,
        staff: people.filter((person) => person.roles.includes(ProductionRole.STAFF)).length,
        managers: people.filter((person) =>
          person.roles.some((role) => PEOPLE_MANAGER_ROLES.includes(role))
        ).length,
        incompleteProfiles: people.filter((person) => !person.user.profileComplete).length,
        staffWithoutDiscipline: people.filter(
          (person) => person.roles.includes(ProductionRole.STAFF) && person.staffAssignments.length === 0
        ).length
      },
      people
    };
  }

  async search(productionId: string, query: SearchProductionQueryDto, user: RequestUser) {
    const access = await this.getProductionAccess(productionId, user);
    const q = query.q?.trim() ?? "";
    const take = this.takeSearch(query.take);
    if (q.length < 2) {
      return {
        production: access.production,
        query: q,
        take,
        count: 0,
        groups: [] as ProductionSearchGroup[],
        items: [] as ProductionSearchResult[]
      };
    }

    const contains = { contains: q, mode: "insensitive" as const };
    const memberOr: Prisma.MembershipWhereInput[] = [
      { user: { name: contains } },
      { staffAssignments: { some: { customLabel: contains } } }
    ];
    if (access.canViewSensitive) {
      memberOr.push({ user: { email: contains } }, { user: { phone: contains } });
    }

    const [scriptBlocks, roles, memberships, musicCues, events] = await Promise.all([
      this.prisma.sceneBlock.findMany({
        where: {
          scene: { act: { script: { productionId } } },
          OR: [{ text: contains }, { cueLabel: contains }]
        },
        orderBy: { updatedAt: "desc" },
        take,
        include: {
          character: { select: { id: true, name: true } },
          scene: {
            select: {
              id: true,
              title: true,
              act: { select: { id: true, title: true, script: { select: { id: true, title: true } } } }
            }
          }
        }
      }),
      this.prisma.role.findMany({
        where: {
          productionId,
          OR: [{ name: contains }, { description: contains }]
        },
        orderBy: { name: "asc" },
        take,
        include: {
          assignments: {
            select: { id: true, membership: { select: { user: { select: { name: true } } } } },
            take: 5
          },
          sceneRoles: { select: { lineCount: true, songCount: true } }
        }
      }),
      this.prisma.membership.findMany({
        where: { productionId, OR: memberOr },
        orderBy: { createdAt: "asc" },
        take,
        include: {
          user: { select: { id: true, email: true, name: true, phone: true, profileType: true, profileComplete: true, status: true } },
          roles: { select: { role: true } },
          staffAssignments: { select: { discipline: true, customLabel: true, isLead: true } },
          castAssignments: { select: { role: { select: { name: true } } } }
        }
      }),
      this.prisma.musicCue.findMany({
        where: {
          productionId,
          OR: [{ cueNumber: contains }, { note: contains }, { track: { title: contains } }, { scene: { title: contains } }]
        },
        orderBy: { order: "asc" },
        take,
        include: {
          track: { select: { id: true, title: true } },
          scene: { select: { id: true, title: true } },
          anchorBlock: { select: { id: true, text: true, cueLabel: true } }
        }
      }),
      this.prisma.scheduleEvent.findMany({
        where: {
          productionId,
          OR: [{ title: contains }, { location: contains }, { meetingUrl: contains }]
        },
        orderBy: { startAt: "asc" },
        take,
        include: {
          scenes: { select: { scene: { select: { title: true } } }, take: 3 },
          musicCues: { select: { cue: { select: { cueNumber: true } } }, take: 3 }
        }
      }),
    ]);

    const rawGroups: Array<Omit<ProductionSearchGroup, "count">> = [
      {
        type: "SCRIPT_BLOCK",
        label: "대본",
        items: scriptBlocks.map((block) => ({
          type: "SCRIPT_BLOCK",
          id: block.id,
          title: `${block.scene.title} · ${block.cueLabel ?? block.character?.name ?? block.type}`,
          snippet: this.searchSnippet(block.text, q),
          href: `/app/p/${productionId}/manage/script?scene=${block.sceneId}`,
          resourceType: "SceneBlock",
          resourceId: block.id,
          metadata: {
            scriptId: block.scene.act.script.id,
            scriptTitle: block.scene.act.script.title,
            actId: block.scene.act.id,
            actTitle: block.scene.act.title,
            sceneId: block.scene.id,
            sceneTitle: block.scene.title,
            blockType: block.type
          }
        }))
      },
      {
        type: "ROLE",
        label: "배역",
        items: roles.map((role) => ({
          type: "ROLE",
          id: role.id,
          title: role.name,
          snippet: this.searchSnippet(role.description, q),
          href: `/app/p/${productionId}/manage/casting`,
          resourceType: "Role",
          resourceId: role.id,
          metadata: {
            assignedActors: role.assignments.map((assignment) => assignment.membership.user.name),
            lineCount: role.sceneRoles.reduce((sum, sceneRole) => sum + sceneRole.lineCount, 0),
            songCount: role.sceneRoles.reduce((sum, sceneRole) => sum + sceneRole.songCount, 0)
          }
        }))
      },
      {
        type: "MEMBER",
        label: "참여자",
        items: memberships.map((membership) => ({
          type: "MEMBER",
          id: membership.id,
          title: membership.user.name,
          snippet: access.canViewSensitive ? membership.user.email : this.maskEmail(membership.user.email),
          href: `/app/p/${productionId}/people`,
          resourceType: "Membership",
          resourceId: membership.id,
          metadata: {
            userId: membership.user.id,
            primaryRole: membership.primaryRole,
            roles: membership.roles.map((role) => role.role),
            profileType: membership.user.profileType,
            profileComplete: membership.user.profileComplete,
            contactVisible: access.canViewSensitive,
            staffAssignments: membership.staffAssignments,
            castRoles: membership.castAssignments.map((assignment) => assignment.role.name)
          }
        }))
      },
      {
        type: "MUSIC_CUE",
        label: "음악 큐",
        items: musicCues.map((cue) => ({
          type: "MUSIC_CUE",
          id: cue.id,
          title: `${cue.cueNumber} · ${cue.track.title}`,
          snippet: this.searchSnippet(cue.note ?? cue.anchorBlock?.text ?? null, q),
          href: `/app/p/${productionId}/cuesheet`,
          resourceType: "MusicCue",
          resourceId: cue.id,
          metadata: {
            cueType: cue.cueType,
            anchorStatus: cue.anchorStatus,
            sceneId: cue.sceneId,
            sceneTitle: cue.scene?.title ?? null,
            anchorBlockId: cue.anchorBlockId
          }
        }))
      },
      {
        type: "EVENT",
        label: "일정",
        items: events.map((event) => ({
          type: "EVENT",
          id: event.id,
          title: event.title,
          snippet: this.searchSnippet(event.location ?? event.meetingUrl ?? null, q),
          href: `/app/p/${productionId}/schedule`,
          resourceType: "ScheduleEvent",
          resourceId: event.id,
          metadata: {
            eventType: event.type,
            startAt: event.startAt,
            endAt: event.endAt,
            scenes: event.scenes.map((eventScene) => eventScene.scene.title),
            cues: event.musicCues.map((eventCue) => eventCue.cue.cueNumber)
          }
        }))
      }
    ];
    const groups = rawGroups
      .map((group) => ({ ...group, count: group.items.length }))
      .filter((group) => group.count > 0);

    const items = groups.flatMap((group) => group.items);
    return {
      production: access.production,
      query: q,
      take,
      count: items.length,
      groups,
      items
    };
  }

  async getStaffAssignments(productionId: string, membershipId: string) {
    const membership = await this.getStaffAssignableMembership(productionId, membershipId);
    return {
      membership: {
        id: membership.id,
        primaryRole: membership.primaryRole,
        roles: membership.roles,
        user: membership.user
      },
      assignments: await this.listStaffAssignments(membershipId)
    };
  }

  async putStaffAssignments(productionId: string, membershipId: string, dto: PutStaffAssignmentsDto, user?: RequestUser) {
    const membership = await this.getStaffAssignableMembership(productionId, membershipId);
    const beforeAssignments = await this.listStaffAssignments(membershipId);
    const normalized = this.normalizeStaffAssignments(productionId, membershipId, dto);

    const keys = new Set(normalized.map((assignment) => assignment.assignmentKey));
    if (keys.size !== normalized.length) {
      throw new ConflictException("중복 직무가 있어요");
    }

    await this.prisma.$transaction([
      this.prisma.staffAssignment.deleteMany({ where: { membershipId } }),
      ...normalized.map((data) => this.prisma.staffAssignment.create({ data }))
    ]);

    const assignments = await this.listStaffAssignments(membershipId);
    if (user) {
      await this.logActivity({
        productionId,
        organizationId: membership.production.organizationId,
        actorId: user.id,
        action: "production.staff_assignment.replace",
        entity: "Membership",
        entityId: membershipId,
        reason: "스태프 직무 교체",
        beforeJson: {
          userId: membership.user.id,
          email: membership.user.email,
          assignments: this.serializeStaffAssignments(beforeAssignments)
        },
        afterJson: {
          userId: membership.user.id,
          email: membership.user.email,
          assignments: this.serializeStaffAssignments(assignments)
        }
      });
    }

    return {
      membership: {
        id: membership.id,
        primaryRole: membership.primaryRole,
        roles: membership.roles,
        user: membership.user
      },
      assignments,
      todoImpact: { clearedTodos: ["STAFF_DISCIPLINE_REQUIRED"] }
    };
  }

  private async getStaffAssignableMembership(productionId: string, membershipId: string) {
    const membership = await this.prisma.membership.findUnique({
      where: { id: membershipId },
      include: {
        roles: true,
        user: { select: { id: true, email: true, name: true, profileType: true } },
        production: { select: { id: true, organizationId: true } }
      }
    });
    if (!membership || membership.productionId !== productionId) {
      throw new NotFoundException("찾을 수 없어요");
    }
    if (!membership.roles.some((role) => role.role === ProductionRole.STAFF)) {
      throw new BadRequestException("STAFF 역할이 있는 멤버에게만 직무를 지정할 수 있어요");
    }
    return membership;
  }

  private normalizeStaffAssignments(productionId: string, membershipId: string, dto: PutStaffAssignmentsDto) {
    return dto.assignments.map((assignment) => {
      const customLabel = assignment.customLabel?.trim() || null;
      if (assignment.discipline === StaffDiscipline.OTHER && !customLabel) {
        throw new BadRequestException("기타 직무는 라벨을 입력해 주세요");
      }
      const assignmentKey =
        assignment.discipline === StaffDiscipline.OTHER
          ? `OTHER:${customLabel?.toLowerCase().replace(/\s+/g, "-")}`
          : assignment.discipline;
      return {
        productionId,
        membershipId,
        discipline: assignment.discipline,
        customLabel,
        assignmentKey,
        isLead: assignment.isLead === true,
        note: null
      };
    });
  }

  private listStaffAssignments(membershipId: string) {
    return this.prisma.staffAssignment.findMany({
      where: { membershipId },
      orderBy: { createdAt: "asc" }
    });
  }

  private serializeStaffAssignments(assignments: Awaited<ReturnType<ProductionsService["listStaffAssignments"]>>) {
    return assignments.map((assignment) => ({
      id: assignment.id,
      discipline: assignment.discipline,
      assignmentKey: assignment.assignmentKey,
      customLabel: assignment.customLabel,
      isLead: assignment.isLead,
      note: assignment.note
    }));
  }

  private findPositionRequirements(productionId: string) {
    return this.prisma.positionRequirement.findMany({
      where: { productionId },
      orderBy: this.positionRequirementOrderBy()
    });
  }

  private positionRequirementOrderBy(): Prisma.PositionRequirementOrderByWithRelationInput[] {
    return [{ role: "asc" }, { label: "asc" }];
  }

  private normalizePositionRequirement(productionId: string, dto: PositionRequirementDto) {
    return {
      productionId,
      role: dto.role,
      label: this.requiredText(dto.label, "필요 정원 라벨을 입력해 주세요"),
      requiredCount: dto.requiredCount ?? 1
    };
  }

  private serializePositionRequirement(position: { id: string; role: ProductionRole; label: string; requiredCount: number }) {
    return {
      id: position.id,
      role: position.role,
      label: position.label,
      requiredCount: position.requiredCount
    };
  }

  private serializePositionRequirements(positions: Array<{ id: string; role: ProductionRole; label: string; requiredCount: number }>) {
    return positions.map((position) => this.serializePositionRequirement(position));
  }

  private async assertPositionRequirement(productionId: string, positionId: string) {
    const position = await this.prisma.positionRequirement.findUnique({ where: { id: positionId } });
    if (!position || position.productionId !== productionId) {
      throw new NotFoundException("찾을 수 없어요");
    }
    return position;
  }

  private async assertMemberOrAdmin(productionId: string, user: RequestUser) {
    await this.getProductionAccess(productionId, user);
  }

  // 멤버 지정·수정·삭제 권한: 운영자(SUPER_ADMIN 전역 / ORG_ADMIN 소속 조직) 또는 그 공연의 기획자.
  private async assertCanManageMembers(productionId: string, user: RequestUser) {
    if (await isProductionAdmin(this.prisma, user, productionId)) {
      return;
    }
    const membership = await this.prisma.membership.findFirst({
      where: { productionId, userId: user.id, roles: { some: { role: ProductionRole.PRODUCER } } },
      select: { id: true }
    });
    if (!membership) {
      throw new ForbiddenException("멤버를 관리할 권한이 없어요");
    }
  }

  private async getProductionAccess(productionId: string, user: RequestUser) {
    const production = await this.prisma.production.findUnique({
      where: { id: productionId },
      select: { id: true, title: true, organizationId: true }
    });
    if (!production) {
      throw new NotFoundException("찾을 수 없어요");
    }

    if (user.platformRole === PlatformRole.SUPER_ADMIN) {
      return { production, viewerMembership: null, canViewSensitive: true };
    }

    const [dbUser, membership] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: user.id },
        select: { organizationId: true }
      }),
      this.prisma.membership.findUnique({
        where: { userId_productionId: { userId: user.id, productionId } },
        include: { roles: { select: { role: true } } }
      })
    ]);

    if (user.platformRole === PlatformRole.ORG_ADMIN && dbUser?.organizationId === production.organizationId) {
      return { production, viewerMembership: membership, canViewSensitive: true };
    }

    if (!membership) {
      throw new NotFoundException("찾을 수 없어요");
    }

    const canViewSensitive = membership.roles.some((role) => PEOPLE_SENSITIVE_ROLES.includes(role.role));
    return { production, viewerMembership: membership, canViewSensitive };
  }

  private productionListInclude(): Prisma.ProductionInclude {
    return {
      organization: { select: { id: true, name: true } },
      positionRequirements: true,
      memberships: { select: { id: true } },
      scripts: { select: { id: true } },
      musicCues: { select: { id: true, anchorStatus: true } },
      events: { select: { id: true } },
      runSheets: { select: { id: true, status: true } },
      checklistPhases: { include: { items: true } }
    };
  }

  private memberInclude(): Prisma.MembershipInclude {
    return {
      user: { select: { id: true, email: true, name: true, phone: true, profileType: true, profileDetails: true, profileComplete: true } },
      roles: { select: { role: true } },
      staffAssignments: true
    };
  }

  private normalizeRoles(nextRoles: ProductionRole[] | undefined, fallbackRoles: ProductionRole[]) {
    const roles = Array.from(new Set(nextRoles ?? fallbackRoles));
    if (roles.length === 0) {
      throw new BadRequestException("역할을 1개 이상 선택해 주세요");
    }
    return roles;
  }

  private async assertProducerRemains(
    tx: Prisma.TransactionClient,
    productionId: string,
    membershipId: string,
    nextRoles: ProductionRole[]
  ) {
    if (nextRoles.includes(ProductionRole.PRODUCER)) {
      return;
    }
    const anotherProducer = await tx.membershipRole.findFirst({
      where: {
        role: ProductionRole.PRODUCER,
        membership: {
          productionId,
          id: { not: membershipId }
        }
      },
      select: { id: true }
    });
    if (!anotherProducer) {
      throw new BadRequestException("마지막 기획자 권한은 해제할 수 없어요");
    }
  }

  private async notifyProductionPublished(productionId: string, productionTitle: string, actor: RequestUser) {
    const memberships = await this.prisma.membership.findMany({
      where: { productionId, userId: { not: actor.id } },
      include: {
        user: { select: { id: true, email: true, name: true } },
        roles: { select: { role: true } }
      },
      orderBy: { createdAt: "asc" }
    });
    if (!memberships.length) {
      return { notifications: 0, emailDeliveries: 0 };
    }

    await this.notifications.createNotifications(
      memberships.map((membership) => ({
        userId: membership.userId,
        productionId,
        type: "production.published",
        payload: {
          productionId,
          productionTitle,
          membershipId: membership.id,
          roles: membership.roles.map((role) => role.role),
          publishedByUserId: actor.id,
          publishedByUserName: actor.name
        }
      }))
    );

    await Promise.all(
      memberships.map((membership) =>
        this.mail.queueEmail({
          userId: membership.user.id,
          productionId,
          toEmail: membership.user.email,
          subject: `[아트브릿지] ${productionTitle} 공연 공개 안내`,
          templateKey: "production.published",
          bodyText: this.productionPublishedEmailBody({
            productionTitle,
            recipientName: membership.user.name,
            roles: membership.roles.map((role) => role.role),
            actorName: actor.name,
            productionUrl: `${this.appPublicUrl()}/app/p/${productionId}`
          }),
          metadata: {
            productionId,
            membershipId: membership.id,
            roles: membership.roles.map((role) => role.role),
            publishedByUserId: actor.id,
            publishedByUserName: actor.name,
            fromEmail: this.mail.fromEmail()
          }
        })
      )
    );

    return { notifications: memberships.length, emailDeliveries: memberships.length };
  }

  private rolesChanged(beforeRoles: ProductionRole[], nextRoles: ProductionRole[]) {
    const before = new Set(beforeRoles);
    const next = new Set(nextRoles);
    return before.size !== next.size || nextRoles.some((role) => !before.has(role));
  }

  private memberAddedEmailBody(input: {
    productionTitle: string;
    recipientName: string;
    roles: ProductionRole[];
    primaryRole: ProductionRole;
    productionUrl: string;
  }) {
    return [
      `${input.recipientName}님, ${input.productionTitle} 공연에 매칭되었습니다.`,
      "",
      `부여 역할: ${this.roleLabels(input.roles)}`,
      `대표 역할: ${this.roleLabel(input.primaryRole)}`,
      "",
      "내 공연에서 대본, 일정, 체크리스트, 알림을 확인해 주세요.",
      input.productionUrl
    ].join("\n");
  }

  private memberRoleUpdatedEmailBody(input: {
    productionTitle: string;
    recipientName: string;
    beforeRoles: ProductionRole[];
    roles: ProductionRole[];
    primaryRole: ProductionRole;
    actorName: string;
    productionUrl: string;
  }) {
    return [
      `${input.recipientName}님, ${input.productionTitle} 공연 역할이 변경되었습니다.`,
      "",
      `이전 역할: ${this.roleLabels(input.beforeRoles)}`,
      `현재 역할: ${this.roleLabels(input.roles)}`,
      `대표 역할: ${this.roleLabel(input.primaryRole)}`,
      `변경자: ${input.actorName}`,
      "",
      "역할에 따라 대시보드 할 일과 접근 가능한 화면이 달라질 수 있습니다.",
      input.productionUrl
    ].join("\n");
  }

  private memberRemovedEmailBody(input: {
    productionTitle: string;
    recipientName: string;
    roles: ProductionRole[];
    actorName: string;
    productionsUrl: string;
  }) {
    return [
      `${input.recipientName}님, ${input.productionTitle} 공연 매칭이 해제되었습니다.`,
      "",
      `해제된 역할: ${this.roleLabels(input.roles)}`,
      `처리자: ${input.actorName}`,
      "",
      "이 공연의 대본, 일정, 체크리스트, 진행표 화면 접근 권한이 제거되었습니다.",
      "다른 참여 공연은 내 공연 목록에서 계속 확인할 수 있습니다.",
      input.productionsUrl
    ].join("\n");
  }

  private productionPublishedEmailBody(input: {
    productionTitle: string;
    recipientName: string;
    roles: ProductionRole[];
    actorName: string;
    productionUrl: string;
  }) {
    return [
      `${input.recipientName}님, ${input.productionTitle} 공연이 공개되었습니다.`,
      "",
      `내 역할: ${this.roleLabels(input.roles)}`,
      `공개 처리: ${input.actorName}`,
      "",
      "이제 내 공연 목록에서 공연을 확인할 수 있습니다.",
      "대본, 일정, 체크리스트, 알림을 확인해 주세요.",
      input.productionUrl
    ].join("\n");
  }

  private roleLabels(roles: ProductionRole[]) {
    return roles.map((role) => this.roleLabel(role)).join(", ");
  }

  private roleLabel(role: ProductionRole) {
    const labels: Record<ProductionRole, string> = {
      PRODUCER: "기획자",
      DIRECTOR: "연출자",
      MUSIC_DIRECTOR: "음악감독",
      STAGE_MANAGER: "무대감독",
      ACTOR: "배우",
      STAFF: "스태프",
      GUEST: "게스트"
    };
    return labels[role] ?? role;
  }

  private appPublicUrl() {
    return (this.config.get<string>("APP_PUBLIC_URL") || "http://localhost:5173").replace(/\/+$/, "");
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

  private assertDateRange(startDate: string | null | undefined, endDate: string | null | undefined) {
    if (!startDate || !endDate) {
      return;
    }
    if (new Date(endDate).getTime() < new Date(startDate).getTime()) {
      throw new BadRequestException("종료일은 시작일 이후여야 해요");
    }
  }

  private requiredText(value: string | undefined, message: string) {
    const text = value?.trim();
    if (!text) {
      throw new BadRequestException(message);
    }
    return text;
  }

  private optionalText(value: string | null | undefined) {
    const text = value?.trim();
    return text ? text : null;
  }

  private titleTakenException() {
    return new ConflictException({
      code: "TITLE_TAKEN",
      field: "title",
      message: "같은 공연명이 있어요. 날짜·지역을 붙여 주세요"
    });
  }

  private takeSearch(value: number | undefined) {
    const next = Number(value ?? 20);
    if (!Number.isFinite(next)) {
      return 20;
    }
    return Math.min(Math.max(Math.trunc(next), 1), 50);
  }

  private searchSnippet(value: string | null | undefined, query: string) {
    const text = value?.replace(/\s+/g, " ").trim();
    if (!text) {
      return null;
    }
    const normalizedQuery = query.toLowerCase();
    const index = text.toLowerCase().indexOf(normalizedQuery);
    if (index < 0) {
      return text.length > 140 ? `${text.slice(0, 137)}...` : text;
    }
    const start = Math.max(0, index - 45);
    const end = Math.min(text.length, index + normalizedQuery.length + 90);
    const prefix = start > 0 ? "..." : "";
    const suffix = end < text.length ? "..." : "";
    return `${prefix}${text.slice(start, end)}${suffix}`;
  }

  private maskEmail(email: string) {
    const [local, domain] = email.split("@");
    if (!domain) {
      return "***";
    }
    const visible = local.slice(0, Math.min(2, local.length));
    return `${visible}${"*".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
  }

  private async logActivity(data: {
    productionId: string;
    organizationId: string;
    actorId: string;
    action: string;
    entity: string;
    entityId: string;
    reason: string;
    beforeJson?: Prisma.InputJsonValue;
    afterJson?: Prisma.InputJsonValue;
  }) {
    await this.prisma.activityLog.create({ data });
  }
}
