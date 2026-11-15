import { BadRequestException, ConflictException, ForbiddenException, Injectable } from "@nestjs/common";
import { AssetKind, Prisma, ProductionRole } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import type { RequestUser } from "../common/types/request-user";
import { PrismaService } from "../prisma/prisma.service";
import { SiteService } from "../site/site.service";
import { addsOptionalProfileData } from "./profile-privacy";
import { ChangePasswordDto, SearchUsersQueryDto, UpdateProfileDto, UpdateUserSettingsDto } from "./dto";

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService, private readonly site: SiteService) {}

  async search(query: SearchUsersQueryDto, user: RequestUser) {
    const q = query.q?.trim() ?? "";
    const take = Math.min(Math.max(query.take ?? 20, 1), 50);
    if (!query.productionId && user.platformRole !== "SUPER_ADMIN" && user.platformRole !== "ORG_ADMIN") {
      throw new ForbiddenException("공연 기준 검색만 사용할 수 있어요");
    }
    // 후보는 공연이 속한 조직(또는 ORG_ADMIN 본인 조직) 안으로 제한한다 — 전 플랫폼 회원 조회 방지.
    let organizationScope: string | null = null;
    if (query.productionId) {
      organizationScope = await this.assertCanSearchForProduction(query.productionId, user);
    }
    if (user.platformRole === "ORG_ADMIN") {
      const caller = await this.prisma.user.findUnique({ where: { id: user.id }, select: { organizationId: true } });
      organizationScope = caller?.organizationId ?? organizationScope;
    } else if (user.platformRole === "SUPER_ADMIN" && !query.productionId) {
      organizationScope = null;
    }
    if (query.minAge !== undefined && query.maxAge !== undefined && query.minAge > query.maxAge) {
      throw new BadRequestException("최소 나이는 최대 나이보다 클 수 없어요");
    }
    if (
      query.minParticipationCount !== undefined &&
      query.maxParticipationCount !== undefined &&
      query.minParticipationCount > query.maxParticipationCount
    ) {
      throw new BadRequestException("최소 참여수는 최대 참여수보다 클 수 없어요");
    }
    if ((query.availableStartAt && !query.availableEndAt) || (!query.availableStartAt && query.availableEndAt)) {
      throw new BadRequestException("가용성 필터는 시작과 종료를 함께 입력해 주세요");
    }

    const hasFilter =
      Boolean(query.profileType) ||
      Boolean(query.gender) ||
      Boolean(query.status) ||
      query.profileComplete !== undefined ||
      Boolean(query.region?.trim()) ||
      Boolean(query.specialty?.trim()) ||
      query.minAge !== undefined ||
      query.maxAge !== undefined ||
      query.minParticipationCount !== undefined ||
      query.maxParticipationCount !== undefined ||
      Boolean(query.availableStartAt && query.availableEndAt);

    if (q.length > 0 && q.length < 2) {
      throw new BadRequestException("검색어는 2자 이상 입력해 주세요");
    }
    if (q.length < 2 && !hasFilter) {
      return [];
    }

    const where: Prisma.UserWhereInput = {};
    const and: Prisma.UserWhereInput[] = [];
    if (organizationScope) {
      // 다른 조직에 소속된 회원만 차단 — 무소속(자가 가입) 인재풀은 검색 대상 유지.
      and.push({ OR: [{ organizationId: organizationScope }, { organizationId: null }] });
    }
    if (q.length >= 2) {
      and.push({
        OR: [
          { email: { contains: q, mode: "insensitive" } },
          { name: { contains: q, mode: "insensitive" } },
          { phone: { contains: q, mode: "insensitive" } }
        ]
      });
    }
    if (query.profileType) where.profileType = query.profileType;
    if (query.gender) where.gender = query.gender;
    // 비활성·차단 계정은 멤버 후보에 나오지 않는다(상태를 직접 고른 경우만 예외).
    where.status = query.status ?? "ACTIVE";
    if (query.profileComplete !== undefined) where.profileComplete = query.profileComplete;
    if (query.region?.trim()) {
      where.address = { contains: query.region.trim(), mode: "insensitive" };
    }
    const birthDateRange = this.birthDateRange(query.minAge, query.maxAge);
    if (birthDateRange) {
      where.birthDate = birthDateRange;
    }
    if (query.productionId && query.excludeAlreadyMembers !== false) {
      and.push({ memberships: { none: { productionId: query.productionId } } });
    }
    if (query.availableStartAt && query.availableEndAt) {
      const startAt = new Date(query.availableStartAt);
      const endAt = new Date(query.availableEndAt);
      if (endAt <= startAt) {
        throw new BadRequestException("가용성 종료 시각은 시작 시각보다 뒤여야 해요");
      }
      and.push({
        availabilities: {
          none: {
            isAvailable: false,
            startAt: { lt: endAt },
            endAt: { gt: startAt }
          }
        }
      });
    }
    if (and.length > 0) {
      where.AND = and;
    }

    const candidates = await this.prisma.user.findMany({
      where,
      skip: query.skip ?? 0,
      take: Math.min(take * 5, 200),
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        gender: true,
        birthDate: true,
        address: true,
        profileType: true,
        profileDetails: true,
        profileComplete: true,
        status: true,
        _count: { select: { memberships: true } }
      }
    });

    const specialty = query.specialty?.trim().toLowerCase();
    const canViewSensitive = user.platformRole === "SUPER_ADMIN" || user.platformRole === "ORG_ADMIN";
    return candidates
      .map((candidate) => {
        const participationCount = candidate._count.memberships;
        return {
          id: candidate.id,
          email: canViewSensitive ? candidate.email : this.maskEmail(candidate.email),
          name: candidate.name,
          phone: canViewSensitive ? candidate.phone : null,
          gender: canViewSensitive ? candidate.gender : null,
          birthDate: canViewSensitive ? candidate.birthDate : null,
          age: this.age(candidate.birthDate),
          address: canViewSensitive ? candidate.address : null,
          profileType: candidate.profileType,
          profileDetails: candidate.profileDetails,
          profileComplete: candidate.profileComplete,
          status: candidate.status,
          participationCount,
          specialtyText: this.profileDetailsText(candidate.profileDetails)
        };
      })
      .filter((candidate) => query.minParticipationCount === undefined || candidate.participationCount >= query.minParticipationCount)
      .filter((candidate) => query.maxParticipationCount === undefined || candidate.participationCount <= query.maxParticipationCount)
      .filter((candidate) => !specialty || candidate.specialtyText.toLowerCase().includes(specialty))
      .slice(0, take);
  }

  async updateMe(userId: string, dto: UpdateProfileDto) {
    if (dto.name !== undefined && !dto.name?.trim()) throw new BadRequestException("이름을 입력해 주세요.");
    if (dto.photoAssetId) await this.assertOwnedProfilePhotoAsset(userId, dto.photoAssetId);
    return this.prisma.$transaction(async (tx) => {
      const previous = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: {
        phone: true, gender: true, birthDate: true, address: true, profileDetails: true, photoAssetId: true, updatedAt: true
      } });
      if (addsOptionalProfileData(dto, previous)) {
        await this.site.recordProfileConsent(userId, dto, "PROFILE_UPDATE", tx);
      }
      // Empty fields are explicit removal; undefined means leave this field unchanged.
      // Compare-and-swap also prevents a concurrent edit from restoring removed information.
      const updated = await tx.user.updateMany({
        where: { id: userId, updatedAt: previous.updatedAt },
        data: {
          name: dto.name?.trim(), phone: dto.phone === undefined ? undefined : dto.phone?.trim() || null,
          profileType: dto.profileType, gender: dto.gender,
          birthDate: dto.birthDate === undefined ? undefined : dto.birthDate ? new Date(dto.birthDate) : null,
          address: dto.address === undefined ? undefined : dto.address?.trim() || null,
          profileDetails: dto.profileDetails === undefined ? undefined : dto.profileDetails === null ? Prisma.JsonNull : dto.profileDetails as Prisma.InputJsonObject,
          photoAssetId: dto.photoAssetId,
          profileComplete: dto.phone === undefined ? undefined : Boolean(dto.phone?.trim())
        }
      });
      if (updated.count !== 1) throw new ConflictException("프로필이 다른 작업에서 변경되었습니다. 최신 내용을 불러온 뒤 다시 저장해 주세요.");
      return tx.user.findUniqueOrThrow({ where: { id: userId }, select: {
        id: true, email: true, name: true, phone: true, gender: true, birthDate: true, address: true,
        profileType: true, profileDetails: true, photoAssetId: true, emailNotify: true, profileComplete: true
      } });
    });
  }

  async updateMySettings(userId: string, dto: UpdateUserSettingsDto) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { profileDetails: true }
    });
    const profileDetails = this.objectRecord(user.profileDetails);
    const currentSettings = this.objectRecord(profileDetails.settings);
    const nextSettings = {
      ...currentSettings,
      ...(dto.locale ? { locale: dto.locale } : {}),
      ...(dto.theme ? { theme: dto.theme } : {})
    };

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        emailNotify: dto.emailNotify,
        profileDetails:
          dto.locale || dto.theme
            ? {
                ...profileDetails,
                settings: nextSettings
              }
            : undefined
      },
      select: {
        id: true,
        emailNotify: true,
        profileDetails: true
      }
    });

    const settings = this.objectRecord(this.objectRecord(updated.profileDetails).settings);
    return {
      id: updated.id,
      emailNotify: updated.emailNotify,
      locale: settings.locale ?? "ko",
      theme: settings.theme ?? "system"
    };
  }

  async changeMyPassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, passwordHash: true }
    });
    const passwordOk = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!passwordOk) {
      throw new BadRequestException("현재 비밀번호를 확인해 주세요.");
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException("현재 비밀번호와 다른 비밀번호를 입력해 주세요");
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: await bcrypt.hash(dto.newPassword, 12),
          failedLoginCount: 0,
          lockedUntil: null
        }
      }),
      this.prisma.authSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: "PASSWORD_CHANGE" }
      })
    ]);

    return { ok: true };
  }

  private objectRecord(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  }

  private async assertOwnedProfilePhotoAsset(userId: string, photoAssetId: string) {
    const asset = await this.prisma.asset.findUnique({
      where: { id: photoAssetId },
      select: {
        id: true,
        ownerId: true,
        productionId: true,
        kind: true,
        mime: true
      }
    });
    if (!asset) {
      throw new BadRequestException("프로필 사진 파일을 찾을 수 없어요");
    }
    if (asset.ownerId !== userId) {
      throw new ForbiddenException("본인이 업로드한 프로필 사진만 연결할 수 있어요");
    }
    if (asset.productionId || asset.kind !== AssetKind.IMAGE || !["image/png", "image/jpeg", "image/webp"].includes(asset.mime)) {
      throw new BadRequestException("프로필 사진은 개인 이미지 Asset만 연결할 수 있어요");
    }
  }

  private async assertCanSearchForProduction(productionId: string, user: RequestUser): Promise<string> {
    const production = await this.prisma.production.findUnique({
      where: { id: productionId },
      select: { organizationId: true }
    });
    if (!production) {
      throw new ForbiddenException("멤버를 검색할 권한이 없어요");
    }
    if (user.platformRole === "SUPER_ADMIN" || user.platformRole === "ORG_ADMIN") {
      return production.organizationId;
    }
    const membership = await this.prisma.membership.findFirst({
      where: {
        productionId,
        userId: user.id,
        roles: {
          some: {
            role: ProductionRole.PRODUCER
          }
        }
      },
      select: { id: true }
    });
    if (!membership) {
      throw new ForbiddenException("멤버를 검색할 권한이 없어요");
    }
    return production.organizationId;
  }

  private maskEmail(email: string) {
    const [local, domain] = email.split("@");
    if (!domain) {
      return "***";
    }
    const visible = local.slice(0, Math.min(2, local.length));
    return `${visible}${"*".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
  }

  private birthDateRange(minAge?: number, maxAge?: number): Prisma.DateTimeNullableFilter | null {
    const range: Prisma.DateTimeNullableFilter = {};
    const now = new Date();
    if (minAge !== undefined) {
      const latest = new Date(now);
      latest.setFullYear(latest.getFullYear() - minAge);
      range.lte = latest;
    }
    if (maxAge !== undefined) {
      const earliest = new Date(now);
      earliest.setFullYear(earliest.getFullYear() - maxAge - 1);
      earliest.setDate(earliest.getDate() + 1);
      range.gte = earliest;
    }
    return Object.keys(range).length > 0 ? range : null;
  }

  private age(birthDate: Date | null) {
    if (!birthDate) return null;
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age -= 1;
    }
    return age;
  }

  private profileDetailsText(value: unknown) {
    if (!value) return "";
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
}
