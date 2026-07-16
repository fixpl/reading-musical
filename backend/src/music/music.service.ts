import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException
} from "@nestjs/common";
import { AnchorStatus, AssetKind, CueFireMode, CueType, Prisma, ProductionRole, StaffDiscipline } from "@prisma/client";
import type { RequestUser } from "../common/types/request-user";
import { MailService } from "../mail/mail.service";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateMusicCueDto,
  CreateMusicTrackDto,
  FireCueDto,
  ReorderMusicCuesDto,
  UpdateCueAnchorDto,
  UpdateMusicCueDto,
  UpdateMusicTrackDto
} from "./dto";
import { isPlatformAdmin, isProductionAdmin } from "../common/access/is-production-admin";

const VIEW_ROLES: ProductionRole[] = [
  ProductionRole.PRODUCER,
  ProductionRole.DIRECTOR,
  ProductionRole.MUSIC_DIRECTOR,
  ProductionRole.STAGE_MANAGER,
  ProductionRole.ACTOR,
  ProductionRole.STAFF,
  ProductionRole.GUEST
];

const EDIT_ROLES = [ProductionRole.PRODUCER, ProductionRole.MUSIC_DIRECTOR];
const ANCHOR_EDIT_ROLES = [ProductionRole.PRODUCER, ProductionRole.DIRECTOR, ProductionRole.MUSIC_DIRECTOR];
const FIRE_ROLES = [
  ProductionRole.PRODUCER,
  ProductionRole.DIRECTOR,
  ProductionRole.MUSIC_DIRECTOR,
  ProductionRole.STAGE_MANAGER,
  ProductionRole.STAFF
];
const FIRE_PRIVILEGED_ROLES: ProductionRole[] = [
  ProductionRole.PRODUCER,
  ProductionRole.DIRECTOR,
  ProductionRole.MUSIC_DIRECTOR,
  ProductionRole.STAGE_MANAGER
];
const FIRE_STAFF_DISCIPLINES: StaffDiscipline[] = [StaffDiscipline.SOUND, StaffDiscipline.ACCOMPANIST];

type MembershipContext = Prisma.MembershipGetPayload<{ include: { roles: true; staffAssignments: true } }>;

@Injectable()
export class MusicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService
  ) {}

  async listTracks(productionId: string, user: RequestUser) {
    await this.assertMembership(productionId, user, VIEW_ROLES);
    return this.prisma.musicTrack.findMany({
      where: { productionId },
      orderBy: { createdAt: "asc" },
      include: this.trackInclude()
    });
  }

  async getCueSheet(productionId: string, user: RequestUser) {
    await this.assertMembership(productionId, user, VIEW_ROLES);
    const [tracks, cues, scenes] = await Promise.all([
      this.prisma.musicTrack.findMany({
        where: { productionId },
        orderBy: { createdAt: "asc" },
        include: this.trackInclude()
      }),
      this.prisma.musicCue.findMany({
        where: { productionId },
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        include: this.cueInclude()
      }),
      this.prisma.scene.findMany({
        where: { act: { script: { productionId } } },
        orderBy: [{ act: { order: "asc" } }, { order: "asc" }],
        include: {
          act: { select: { id: true, title: true, order: true, script: { select: { id: true, title: true } } } },
          blocks: {
            orderBy: { order: "asc" },
            select: { id: true, order: true, type: true, cueLabel: true, text: true }
          }
        }
      })
    ]);

    return {
      tracks,
      cues,
      scenes,
      totals: {
        tracks: tracks.length,
        cues: cues.length,
        unlinkedCues: cues.filter((cue) => cue.anchorStatus !== AnchorStatus.OK).length
      }
    };
  }

  async createTrack(productionId: string, dto: CreateMusicTrackDto, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    await this.assertAudioAsset(productionId, dto.assetId);
    return this.prisma.musicTrack.create({
      data: {
        productionId,
        assetId: dto.assetId,
        title: dto.title.trim(),
        durationMs: dto.durationMs ?? null,
        waveformPeaksJson: dto.waveformPeaks ? (dto.waveformPeaks as Prisma.InputJsonValue) : undefined
      },
      include: this.trackInclude()
    });
  }

  async updateTrack(productionId: string, trackId: string, dto: UpdateMusicTrackDto, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    await this.assertTrack(productionId, trackId);
    if (dto.assetId) {
      await this.assertAudioAsset(productionId, dto.assetId);
    }

    return this.prisma.musicTrack.update({
      where: { id: trackId },
      data: {
        assetId: dto.assetId,
        title: dto.title?.trim(),
        durationMs: dto.durationMs === undefined ? undefined : dto.durationMs,
        waveformPeaksJson:
          dto.waveformPeaks === undefined ? undefined : dto.waveformPeaks === null ? Prisma.JsonNull : (dto.waveformPeaks as Prisma.InputJsonValue)
      },
      include: this.trackInclude()
    });
  }

  async deleteTrack(productionId: string, trackId: string, force: boolean, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    await this.assertTrack(productionId, trackId);
    const cueIds = await this.prisma.musicCue.findMany({ where: { trackId }, select: { id: true } });
    const impact = {
      cues: cueIds.length,
      fireLogs: await this.prisma.cueFireLog.count({ where: { cueId: { in: cueIds.map((cue) => cue.id) } } }),
      eventLinks: await this.prisma.eventMusicCue.count({ where: { cueId: { in: cueIds.map((cue) => cue.id) } } }),
      runSheetItems: await this.prisma.runSheetItem.count({ where: { cueId: { in: cueIds.map((cue) => cue.id) } } })
    };
    if (!force && Object.values(impact).some((count) => count > 0)) {
      throw new ConflictException({
        message: "연결된 큐, 발동 로그, 일정 또는 진행표 항목이 있어요. 영향 내용을 확인한 뒤 삭제해 주세요.",
        impact
      });
    }

    await this.prisma.$transaction([
      this.prisma.cueFireLog.deleteMany({ where: { cueId: { in: cueIds.map((cue) => cue.id) } } }),
      this.prisma.eventMusicCue.deleteMany({ where: { cueId: { in: cueIds.map((cue) => cue.id) } } }),
      this.prisma.runSheetItem.deleteMany({ where: { cueId: { in: cueIds.map((cue) => cue.id) } } }),
      this.prisma.musicCue.deleteMany({ where: { trackId } }),
      this.prisma.musicTrack.delete({ where: { id: trackId } })
    ]);

    return { deletedId: trackId, impact };
  }

  async createCue(productionId: string, trackId: string, dto: CreateMusicCueDto, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    await this.assertTrack(productionId, trackId);
    this.validateCueTiming(dto);
    await this.assertUniqueCueNumber(productionId, dto.cueNumber);
    const anchor = await this.resolveAnchor(productionId, dto.sceneId, dto.anchorBlockId);
    const maxOrder = await this.getMaxCueOrder(productionId);
    const nextOrder = Math.min(Math.max(dto.order ?? maxOrder + 1, 1), maxOrder + 1);

    const created = await this.prisma.$transaction(async (tx) => {
      if (nextOrder <= maxOrder) {
        await tx.musicCue.updateMany({
          where: { productionId, order: { gte: nextOrder } },
          data: { order: { increment: 1 } }
        });
      }
      return tx.musicCue.create({
        data: {
          productionId,
          trackId,
          cueNumber: dto.cueNumber.trim(),
          cueType: dto.cueType ?? CueType.START,
          order: nextOrder,
          sceneId: anchor.sceneId,
          anchorBlockId: anchor.anchorBlockId,
          trackStartMs: dto.trackStartMs ?? 0,
          trackEndMs: dto.trackEndMs ?? null,
          fadeInMs: dto.fadeInMs ?? 0,
          fadeOutMs: dto.fadeOutMs ?? 0,
          volumeDb: dto.volumeDb ?? 0,
          fireMode: dto.fireMode ?? CueFireMode.MANUAL,
          note: dto.note?.trim() || null,
          anchorStatus: anchor.anchorStatus
        },
        include: this.cueInclude()
      });
    });
    await this.notifyCueChange(productionId, created, user.id, "music.cue_created");
    return created;
  }

  async updateCue(productionId: string, cueId: string, dto: UpdateMusicCueDto, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    const cue = await this.assertCue(productionId, cueId);
    this.validateCueTiming({ ...cue, ...dto });
    if (dto.cueNumber && dto.cueNumber.trim() !== cue.cueNumber) {
      await this.assertUniqueCueNumber(productionId, dto.cueNumber, cueId);
    }
    const anchor = await this.resolveAnchor(
      productionId,
      dto.sceneId === undefined ? cue.sceneId : dto.sceneId,
      dto.anchorBlockId === undefined ? cue.anchorBlockId : dto.anchorBlockId
    );

    const updated = await this.prisma.musicCue.update({
      where: { id: cueId },
      data: {
        cueNumber: dto.cueNumber?.trim(),
        cueType: dto.cueType,
        order: dto.order,
        sceneId: anchor.sceneId,
        anchorBlockId: anchor.anchorBlockId,
        trackStartMs: dto.trackStartMs,
        trackEndMs: dto.trackEndMs === undefined ? undefined : dto.trackEndMs,
        fadeInMs: dto.fadeInMs,
        fadeOutMs: dto.fadeOutMs,
        volumeDb: dto.volumeDb,
        fireMode: dto.fireMode,
        note: dto.note === undefined ? undefined : dto.note?.trim() || null,
        anchorStatus: anchor.anchorStatus
      },
      include: this.cueInclude()
    });
    await this.notifyCueChange(productionId, updated, user.id, "music.cue_updated");
    return updated;
  }

  async reorderCues(productionId: string, dto: ReorderMusicCuesDto, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    const requestedIds = dto.cueIds;
    const uniqueIds = new Set(requestedIds);
    if (uniqueIds.size !== requestedIds.length) {
      throw new BadRequestException("큐 순서 목록에 중복된 큐가 있어요");
    }

    const currentCues = await this.prisma.musicCue.findMany({
      where: { productionId },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      select: { id: true }
    });
    const currentIds = currentCues.map((cue) => cue.id);
    const currentIdSet = new Set(currentIds);
    const missingIds = currentIds.filter((id) => !uniqueIds.has(id));
    const invalidIds = requestedIds.filter((id) => !currentIdSet.has(id));
    if (requestedIds.length !== currentIds.length || missingIds.length > 0 || invalidIds.length > 0) {
      throw new BadRequestException({
        message: "현재 큐시트의 모든 큐를 빠짐없이 같은 공연 cue id로 보내야 해요",
        missingIds,
        invalidIds
      });
    }

    await this.prisma.$transaction(
      requestedIds.map((id, index) =>
        this.prisma.musicCue.update({
          where: { id },
          data: { order: index + 1 }
        })
      )
    );

    return this.getCueSheet(productionId, user);
  }

  async updateCueAnchor(productionId: string, cueId: string, dto: UpdateCueAnchorDto, user: RequestUser) {
    await this.assertMembership(productionId, user, ANCHOR_EDIT_ROLES);
    await this.assertCue(productionId, cueId);
    const anchor = await this.resolveAnchor(productionId, dto.sceneId, dto.anchorBlockId);
    const updated = await this.prisma.musicCue.update({
      where: { id: cueId },
      data: anchor,
      include: this.cueInclude()
    });
    await this.notifyCueChange(productionId, updated, user.id, "music.cue_anchor_updated");
    return updated;
  }

  async deleteCue(productionId: string, cueId: string, force: boolean, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    const cue = await this.assertCue(productionId, cueId);
    const impact = {
      fireLogs: await this.prisma.cueFireLog.count({ where: { cueId } }),
      eventLinks: await this.prisma.eventMusicCue.count({ where: { cueId } }),
      runSheetItems: await this.prisma.runSheetItem.count({ where: { cueId } })
    };
    if (!force && Object.values(impact).some((count) => count > 0)) {
      throw new ConflictException({
        message: "발동 로그, 일정 또는 진행표에 연결된 큐예요. 영향 내용을 확인한 뒤 삭제해 주세요.",
        impact
      });
    }
    await this.prisma.$transaction([
      this.prisma.cueFireLog.deleteMany({ where: { cueId } }),
      this.prisma.eventMusicCue.deleteMany({ where: { cueId } }),
      this.prisma.runSheetItem.deleteMany({ where: { cueId } }),
      this.prisma.musicCue.delete({ where: { id: cueId } })
    ]);
    await this.normalizeCueOrder(productionId);
    await this.notifyCueChange(productionId, cue, user.id, "music.cue_deleted");
    return { deletedId: cueId, impact };
  }

  async fireCue(productionId: string, cueId: string, dto: FireCueDto, user: RequestUser) {
    const membership = await this.assertMembership(productionId, user, FIRE_ROLES);
    this.assertCanFireCue(user, membership);
    const cue = await this.assertCue(productionId, cueId);
    const sessionId = dto.sessionId ? await this.assertSession(productionId, dto.sessionId) : await this.createAdHocSession(productionId, cue);

    return this.prisma.cueFireLog.create({
      data: {
        sessionId,
        cueId: cue.id,
        firedById: user.id,
        payload: {
          cueNumber: cue.cueNumber,
          cueType: cue.cueType,
          trackStartMs: cue.trackStartMs,
          trackEndMs: cue.trackEndMs,
          fireMode: cue.fireMode,
          ...(dto.payload ?? {})
        } as Prisma.InputJsonValue
      },
      include: { cue: { include: this.cueInclude() } }
    });
  }

  private async assertMembership(productionId: string, user: RequestUser, roles: ProductionRole[]) {
    if (await isProductionAdmin(this.prisma, user, productionId)) {
      return null;
    }
    const membership = await this.prisma.membership.findFirst({
      where: { productionId, userId: user.id, roles: { some: { role: { in: roles } } } },
      include: { roles: true, staffAssignments: true }
    });
    if (!membership) {
      throw new ForbiddenException("이 작업을 할 권한이 없어요");
    }
    return membership;
  }

  private assertCanFireCue(user: RequestUser, membership: MembershipContext | null) {
    if (isPlatformAdmin(user)) return;
    const roles = membership?.roles.map((role) => role.role) ?? [];
    const canFireByRole = roles.some((role) => FIRE_PRIVILEGED_ROLES.includes(role));
    const canFireByStaffDiscipline = membership?.staffAssignments.some((assignment) => FIRE_STAFF_DISCIPLINES.includes(assignment.discipline)) ?? false;
    if (!canFireByRole && !canFireByStaffDiscipline) {
      throw new ForbiddenException("음악 큐를 발동할 권한이 없어요");
    }
  }

  private async assertAudioAsset(productionId: string, assetId: string) {
    const asset = await this.prisma.asset.findFirst({ where: { id: assetId, productionId }, select: { id: true, kind: true } });
    if (!asset) {
      throw new NotFoundException("음원 파일을 찾을 수 없어요");
    }
    if (asset.kind !== AssetKind.AUDIO) {
      throw new BadRequestException("AUDIO asset만 음악 트랙으로 등록할 수 있어요");
    }
  }

  private async assertTrack(productionId: string, trackId: string) {
    const track = await this.prisma.musicTrack.findFirst({ where: { id: trackId, productionId } });
    if (!track) {
      throw new NotFoundException("음악 트랙을 찾을 수 없어요");
    }
    return track;
  }

  private async assertCue(productionId: string, cueId: string) {
    const cue = await this.prisma.musicCue.findFirst({ where: { id: cueId, productionId } });
    if (!cue) {
      throw new NotFoundException("음악 큐를 찾을 수 없어요");
    }
    return cue;
  }

  private async assertSession(productionId: string, sessionId: string) {
    const session = await this.prisma.readingSession.findFirst({ where: { id: sessionId, productionId }, select: { id: true } });
    if (!session) {
      throw new NotFoundException("리딩 세션을 찾을 수 없어요");
    }
    return session.id;
  }

  private async notifyCueChange(
    productionId: string,
    cue: { id: string; cueNumber: string; sceneId: string | null; anchorBlockId: string | null },
    actorId: string,
    type: "music.cue_created" | "music.cue_updated" | "music.cue_anchor_updated" | "music.cue_deleted"
  ) {
    const [production, recipients] = await Promise.all([
      this.prisma.production.findUnique({ where: { id: productionId }, select: { title: true } }),
      this.cueChangeRecipients(productionId, cue, actorId)
    ]);
    if (!recipients.length) return;

    const notificationPayload = {
      cueId: cue.id,
      cueNumber: cue.cueNumber,
      sceneId: cue.sceneId,
      anchorBlockId: cue.anchorBlockId
    } as Prisma.InputJsonValue;
    await Promise.all([
      this.notifications.createNotifications(
        recipients.map((recipient) => ({
          productionId,
          userId: recipient.userId,
          type,
          payload: notificationPayload
        }))
      ),
      ...recipients.map((recipient) =>
        this.mail.queueDigestEmail({
          userId: recipient.userId,
          productionId,
          toEmail: recipient.email,
          templateKey: "music.cue_digest",
          subject: `[아트브릿지] ${production?.title ?? "공연"} 음악 큐 변경 요약`,
          bodyText: this.cueDigestBody({
            recipientName: recipient.name,
            productionTitle: production?.title ?? "공연",
            cueNumber: cue.cueNumber,
            type
          }),
          metadata: {
            cueId: cue.id,
            cueNumber: cue.cueNumber,
            sceneId: cue.sceneId,
            anchorBlockId: cue.anchorBlockId,
            notificationType: type
          }
        })
      )
    ]);
  }

  private async cueChangeRecipients(
    productionId: string,
    cue: { sceneId: string | null; anchorBlockId: string | null },
    actorId: string
  ): Promise<Array<{ userId: string; email: string; name: string }>> {
    const impactFilters: Prisma.MembershipWhereInput[] = [
      {
        roles: {
          some: {
            role: {
              in: [ProductionRole.PRODUCER, ProductionRole.DIRECTOR, ProductionRole.MUSIC_DIRECTOR, ProductionRole.STAGE_MANAGER]
            }
          }
        }
      }
    ];

    if (cue.anchorBlockId) {
      impactFilters.push({
        castAssignments: {
          some: {
            role: {
              dialogueBlocks: {
                some: { id: cue.anchorBlockId }
              }
            }
          }
        }
      });
    }
    if (cue.sceneId) {
      impactFilters.push({
        castAssignments: {
          some: {
            role: {
              sceneRoles: {
                some: { sceneId: cue.sceneId }
              }
            }
          }
        }
      });
    }

    const memberships = await this.prisma.membership.findMany({
      where: {
        productionId,
        userId: { not: actorId },
        OR: impactFilters
      },
      select: { userId: true, user: { select: { email: true, name: true } } }
    });
    const uniqueRecipients = new Map<string, { userId: string; email: string; name: string }>();
    memberships.forEach((membership) => {
      uniqueRecipients.set(membership.userId, {
        userId: membership.userId,
        email: membership.user.email,
        name: membership.user.name
      });
    });
    return [...uniqueRecipients.values()];
  }

  private cueDigestBody(input: {
    recipientName: string;
    productionTitle: string;
    cueNumber: string;
    type: "music.cue_created" | "music.cue_updated" | "music.cue_anchor_updated" | "music.cue_deleted";
  }) {
    const actionByType = {
      "music.cue_created": "새 음악 큐가 추가되었습니다.",
      "music.cue_updated": "음악 큐 정보가 수정되었습니다.",
      "music.cue_anchor_updated": "음악 큐의 대본 anchor가 수정되었습니다.",
      "music.cue_deleted": "음악 큐가 삭제되었습니다."
    };
    return [
      `${input.recipientName}님,`,
      "",
      `[${input.productionTitle}] 큐 ${input.cueNumber}`,
      actionByType[input.type],
      "",
      "음악 큐시트와 대본 뷰어의 cue marker를 확인해 주세요."
    ].join("\n");
  }

  private async createAdHocSession(productionId: string, cue: { sceneId: string | null; anchorBlockId: string | null }) {
    const session = await this.prisma.readingSession.create({
      data: {
        productionId,
        startedAt: new Date(),
        currentSceneId: cue.sceneId,
        currentBlockId: cue.anchorBlockId,
        progressNote: "음악 큐 테스트에서 자동 생성된 세션"
      },
      select: { id: true }
    });
    return session.id;
  }

  private async resolveAnchor(productionId: string, sceneId?: string | null, anchorBlockId?: string | null) {
    let resolvedSceneId = sceneId || null;
    let resolvedBlockId = anchorBlockId || null;

    if (resolvedBlockId) {
      const block = await this.prisma.sceneBlock.findFirst({
        where: { id: resolvedBlockId, scene: { act: { script: { productionId } } } },
        select: { id: true, sceneId: true }
      });
      if (!block) {
        throw new BadRequestException("이 공연에 속하지 않는 대본 블록이에요");
      }
      if (resolvedSceneId && resolvedSceneId !== block.sceneId) {
        throw new BadRequestException("선택한 장면과 anchor 블록의 장면이 달라요");
      }
      resolvedSceneId = block.sceneId;
      resolvedBlockId = block.id;
    }

    if (resolvedSceneId) {
      const scene = await this.prisma.scene.findFirst({
        where: { id: resolvedSceneId, act: { script: { productionId } } },
        select: { id: true }
      });
      if (!scene) {
        throw new BadRequestException("이 공연에 속하지 않는 장면이에요");
      }
    }

    return {
      sceneId: resolvedSceneId,
      anchorBlockId: resolvedBlockId,
      anchorStatus: resolvedSceneId || resolvedBlockId ? AnchorStatus.OK : AnchorStatus.UNLINKED
    };
  }

  private validateCueTiming(dto: {
    trackStartMs?: number | null;
    trackEndMs?: number | null;
    fadeInMs?: number | null;
    fadeOutMs?: number | null;
    volumeDb?: number | null;
  }) {
    const start = dto.trackStartMs ?? 0;
    const end = dto.trackEndMs ?? null;
    if (start < 0 || (end !== null && end <= start)) {
      throw new UnprocessableEntityException("재생 종료 시간은 시작 시간보다 커야 해요");
    }
    if ((dto.fadeInMs ?? 0) < 0 || (dto.fadeOutMs ?? 0) < 0) {
      throw new UnprocessableEntityException("페이드 값은 0 이상이어야 해요");
    }
    const volume = dto.volumeDb ?? 0;
    if (volume < -60 || volume > 12) {
      throw new UnprocessableEntityException("볼륨은 -60dB부터 12dB 사이여야 해요");
    }
  }

  private async assertUniqueCueNumber(productionId: string, cueNumber: string, exceptCueId?: string) {
    const existing = await this.prisma.musicCue.findFirst({
      where: {
        productionId,
        cueNumber: { equals: cueNumber.trim(), mode: "insensitive" },
        id: exceptCueId ? { not: exceptCueId } : undefined
      },
      select: { id: true }
    });
    if (existing) {
      throw new ConflictException("같은 큐 번호가 이미 있어요");
    }
  }

  private async getMaxCueOrder(productionId: string) {
    const aggregate = await this.prisma.musicCue.aggregate({
      where: { productionId },
      _max: { order: true }
    });
    return aggregate._max.order ?? 0;
  }

  private async normalizeCueOrder(productionId: string) {
    const cues = await this.prisma.musicCue.findMany({
      where: { productionId },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      select: { id: true }
    });
    await this.prisma.$transaction(cues.map((cue, index) => this.prisma.musicCue.update({ where: { id: cue.id }, data: { order: index + 1 } })));
  }

  private trackInclude(): Prisma.MusicTrackInclude {
    return {
      asset: { select: { id: true, kind: true, mime: true, sizeBytes: true, checksum: true, storageKey: true } },
      cues: { orderBy: { order: "asc" }, include: this.cueInclude() }
    };
  }

  private cueInclude(): Prisma.MusicCueInclude {
    return {
      track: { select: { id: true, title: true, durationMs: true, assetId: true } },
      scene: { select: { id: true, title: true, order: true, act: { select: { id: true, title: true, order: true } } } },
      anchorBlock: { select: { id: true, order: true, type: true, cueLabel: true, text: true } },
      fireLogs: { orderBy: { firedAt: "desc" }, take: 5 }
    };
  }
}
