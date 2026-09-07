import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PlatformRole, Prisma, ProductionRole } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestUser } from "../common/types/request-user";
import { CreateCueTrackDto, CreateTrackCueDto, ReorderTrackCueDto, UpdateCueTrackDto, UpdateTrackCueDto } from "./dto";
import { isProductionAdmin } from "../common/access/is-production-admin";

const STAFF_ROLES: readonly ProductionRole[] = [
  ProductionRole.PRODUCER,
  ProductionRole.DIRECTOR,
  ProductionRole.MUSIC_DIRECTOR,
  ProductionRole.STAGE_MANAGER
];

// 리딩뮤지컬 기본 트랙 구성 — 공연별로 자유롭게 바꿀 수 있다.
const DEFAULT_TRACKS = ["해설", "배우", "음악", "효과음", "영상", "조명"];

const TRACK_INCLUDE = {
  ownerMembership: {
    select: {
      id: true,
      user: { select: { id: true, name: true } }
    }
  }
} satisfies Prisma.CueTrackInclude;

const CUE_INCLUDE = {
  scene: {
    select: {
      id: true,
      title: true,
      order: true,
      act: { select: { id: true, title: true, order: true } }
    }
  },
  character: { select: { id: true, name: true } },
  asset: { select: { id: true, kind: true, mime: true, storageKey: true } },
  author: { select: { id: true, name: true } }
} satisfies Prisma.TrackCueInclude;

@Injectable()
export class CueSheetService {
  constructor(private readonly prisma: PrismaService) {}

  async getBoard(productionId: string, user: RequestUser) {
    const [production, tracks, cues, scenes, editableTrackIds] = await Promise.all([
      this.prisma.production.findUnique({
        where: { id: productionId },
        select: {
          id: true,
          title: true,
          currentPhase: true,
          backgroundAssetId: true,
          backgroundAsset: { select: { id: true, kind: true, mime: true, sizeBytes: true, storageKey: true } }
        }
      }),
      this.prisma.cueTrack.findMany({
        where: { productionId },
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        include: TRACK_INCLUDE
      }),
      this.prisma.trackCue.findMany({
        // 소프트 삭제된 큐, 그리고 삭제된 대본의 장면에 걸린 큐는 감춘다(장면 미지정 큐는 유지).
        where: {
          productionId,
          deletedAt: null,
          OR: [{ sceneId: null }, { scene: { act: { script: { deletedAt: null } } } }]
        },
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        include: CUE_INCLUDE
      }),
      this.prisma.scene.findMany({
        where: { act: { script: { productionId, deletedAt: null } } },
        orderBy: [{ act: { order: "asc" } }, { order: "asc" }],
        select: {
          id: true,
          title: true,
          order: true,
          summary: true,
          act: { select: { id: true, title: true, order: true, scriptId: true, script: { select: { title: true } } } },
          // 큐시트 중앙에서 대본(대사·지문)과 큐를 함께 보여주기 위해 장면별 본문도 싣는다.
          blocks: {
            orderBy: { order: "asc" },
            select: {
              id: true,
              type: true,
              text: true,
              order: true,
              startMs: true,
              durationMs: true,
              character: { select: { id: true, name: true } }
            }
          }
        }
      }),
      this.resolveEditableTrackIds(productionId, user)
    ]);

    if (!production) {
      throw new NotFoundException("공연을 찾을 수 없습니다");
    }

    return {
      production,
      tracks,
      cues,
      scenes,
      viewer: {
        canManageTracks: editableTrackIds === "ALL",
        editableTrackIds: editableTrackIds === "ALL" ? tracks.map((track) => track.id) : editableTrackIds
      }
    };
  }

  async createTrack(productionId: string, dto: CreateCueTrackDto, user: RequestUser) {
    await this.assertStaff(productionId, user);
    await this.assertOwnerMembership(productionId, dto.ownerMembershipId);
    const order = await this.nextTrackOrder(productionId);

    return this.prisma.cueTrack.create({
      data: {
        productionId,
        name: dto.name.trim(),
        ownerMembershipId: dto.ownerMembershipId ?? null,
        order
      },
      include: TRACK_INCLUDE
    });
  }

  async createDefaultTracks(productionId: string, user: RequestUser) {
    await this.assertStaff(productionId, user);
    const existing = await this.prisma.cueTrack.count({ where: { productionId } });
    if (existing > 0) {
      return this.prisma.cueTrack.findMany({
        where: { productionId },
        orderBy: [{ order: "asc" }],
        include: TRACK_INCLUDE
      });
    }
    await this.prisma.cueTrack.createMany({
      data: DEFAULT_TRACKS.map((name, index) => ({ productionId, name, order: index }))
    });
    return this.prisma.cueTrack.findMany({
      where: { productionId },
      orderBy: [{ order: "asc" }],
      include: TRACK_INCLUDE
    });
  }

  async updateTrack(productionId: string, trackId: string, dto: UpdateCueTrackDto, user: RequestUser) {
    await this.assertStaff(productionId, user);
    await this.findTrackOrThrow(productionId, trackId);
    await this.assertOwnerMembership(productionId, dto.ownerMembershipId);

    return this.prisma.cueTrack.update({
      where: { id: trackId },
      data: {
        name: dto.name?.trim(),
        ownerMembershipId: dto.ownerMembershipId === undefined ? undefined : dto.ownerMembershipId,
        order: dto.order
      },
      include: TRACK_INCLUDE
    });
  }

  async removeTrack(productionId: string, trackId: string, user: RequestUser) {
    await this.assertStaff(productionId, user);
    await this.findTrackOrThrow(productionId, trackId);
    await this.prisma.cueTrack.delete({ where: { id: trackId } });
    return { ok: true };
  }

  async createCue(productionId: string, trackId: string, dto: CreateTrackCueDto, user: RequestUser) {
    const track = await this.findTrackOrThrow(productionId, trackId);
    await this.assertCanEditTrack(productionId, track.id, user);
    await this.assertScene(productionId, dto.sceneId);
    await this.assertCharacter(productionId, dto.characterId);
    await this.assertMediaAsset(productionId, dto.assetId);
    this.assertCueTiming(dto.startMs, dto.durationSec);

    const [order, count] = await Promise.all([
      this.nextCueOrder(trackId),
      this.prisma.trackCue.count({ where: { trackId, deletedAt: null } })
    ]);
    const cueNumber = dto.cueNumber?.trim() || `${track.name.slice(0, 1)}${String(count + 1).padStart(2, "0")}`;

    return this.prisma.trackCue.create({
      data: {
        productionId,
        trackId,
        sceneId: dto.sceneId ?? null,
        cueNumber,
        trigger: dto.trigger?.trim() || null,
        content: dto.content.trim(),
        note: dto.note?.trim() || null,
        characterId: dto.characterId ?? null,
        durationSec: dto.durationSec ?? null,
        startMs: dto.startMs ?? null,
        assetId: dto.assetId ?? null,
        order,
        authorId: user.id
      },
      include: CUE_INCLUDE
    });
  }

  async updateCue(productionId: string, cueId: string, dto: UpdateTrackCueDto, user: RequestUser) {
    const cue = await this.findCueOrThrow(productionId, cueId);
    await this.assertCanEditTrack(productionId, cue.trackId, user);
    if (dto.sceneId !== undefined) {
      await this.assertScene(productionId, dto.sceneId);
    }
    if (dto.characterId !== undefined) {
      await this.assertCharacter(productionId, dto.characterId);
    }
    if (dto.assetId !== undefined) {
      await this.assertMediaAsset(productionId, dto.assetId);
    }

    this.assertCueTiming(
      dto.startMs === undefined ? cue.startMs : dto.startMs,
      dto.durationSec === undefined ? cue.durationSec : dto.durationSec
    );
    return this.prisma.trackCue.update({
      where: { id: cue.id },
      data: {
        cueNumber: dto.cueNumber?.trim(),
        trigger: dto.trigger === undefined ? undefined : dto.trigger?.trim() || null,
        content: dto.content?.trim(),
        note: dto.note === undefined ? undefined : dto.note?.trim() || null,
        sceneId: dto.sceneId === undefined ? undefined : dto.sceneId,
        characterId: dto.characterId === undefined ? undefined : dto.characterId,
        durationSec: dto.durationSec === undefined ? undefined : dto.durationSec,
        startMs: dto.startMs === undefined ? undefined : dto.startMs,
        assetId: dto.assetId === undefined ? undefined : dto.assetId
      },
      include: CUE_INCLUDE
    });
  }

  /**
   * 큐의 표시 순서를 변경한다. 명시적으로 저장된 startMs는 이 작업으로 덮어쓰지 않는다.
   * 옮긴 큐의 장면을 바꾸고, 그 트랙의 큐 순서(order)를 넘겨받은 배열대로 다시 매긴다.
   */
  async reorderCue(productionId: string, cueId: string, dto: ReorderTrackCueDto, user: RequestUser) {
    const cue = await this.findCueOrThrow(productionId, cueId);
    await this.assertCanEditTrack(productionId, cue.trackId, user);
    if (dto.sceneId) {
      await this.assertScene(productionId, dto.sceneId);
    }

    // order는 공연 전체 진행 순서(전역)라, 이 트랙 큐의 기존 order 값 집합을 새 순서대로 재할당한다
    // (트랙이 전역에서 차지하던 위치는 유지하고, 어느 큐가 어디에 오는지만 바꾼다).
    const trackCues = await this.prisma.trackCue.findMany({
      where: { trackId: cue.trackId, productionId, deletedAt: null },
      select: { id: true, order: true }
    });
    const orderValues = trackCues.map((c) => c.order).sort((a, b) => a - b);
    const trackIds = new Set(trackCues.map((c) => c.id));
    if (new Set(dto.orderedTrackCueIds).size !== dto.orderedTrackCueIds.length || dto.orderedTrackCueIds.some((id) => !trackIds.has(id))) {
      throw new BadRequestException("같은 트랙의 큐를 중복 없이 지정해 주세요");
    }
    const sequence = [...dto.orderedTrackCueIds];
    for (const c of trackCues) if (!sequence.includes(c.id)) sequence.push(c.id); // 누락분은 뒤에 보강

    await this.prisma.$transaction(async (tx) => {
      if (dto.sceneId !== undefined) {
        await tx.trackCue.update({ where: { id: cue.id }, data: { sceneId: dto.sceneId } });
      }
      for (let i = 0; i < sequence.length; i += 1) {
        await tx.trackCue.updateMany({
          where: { id: sequence[i], trackId: cue.trackId, productionId, deletedAt: null },
          data: { order: orderValues[i] ?? i }
        });
      }
    });
    return { ok: true };
  }

  async removeCue(productionId: string, cueId: string, user: RequestUser) {
    const cue = await this.findCueOrThrow(productionId, cueId);
    await this.assertCanEditTrack(productionId, cue.trackId, user);
    // 소프트 삭제 — 실데이터는 남기고 감춘다. 큐시트 초기화 되돌리기로 복구 가능.
    await this.prisma.trackCue.update({ where: { id: cue.id }, data: { deletedAt: new Date() } });
    return { ok: true };
  }

  /**
   * 큐시트 초기화 — 큐를 전부 비운다(잘못 등록한 큐 되돌리기). 소프트 삭제라 실데이터는 남고
   * 트랙·담당자 설정도 그대로다. restoreCues로 되돌릴 수 있다.
   */
  async resetCueSheet(productionId: string, user: RequestUser) {
    await this.assertStaff(productionId, user);
    const removed = await this.prisma.trackCue.updateMany({
      where: { productionId, deletedAt: null },
      data: { deletedAt: new Date() }
    });
    return { removedCues: removed.count };
  }

  /** 소프트 삭제된 큐를 모두 복구한다(초기화·개별 삭제 되돌리기). */
  async restoreCues(productionId: string, user: RequestUser) {
    await this.assertStaff(productionId, user);
    const restored = await this.prisma.trackCue.updateMany({
      where: { productionId, deletedAt: { not: null } },
      data: { deletedAt: null }
    });
    return { restoredCues: restored.count };
  }

  /**
   * 배우 트랙의 인물 미지정 큐를, 큐 내용에 등장하는 배역 이름으로 자동 태깅한다.
   * 대량 생성된 배우 큐를 인물별 서브레인으로 갈라 보기 위한 정리 기능.
   */
  async autotagActorCues(productionId: string, user: RequestUser) {
    await this.assertStaff(productionId, user);
    const roles = (
      await this.prisma.role.findMany({ where: { productionId }, select: { id: true, name: true } })
    )
      .filter((role) => role.name.trim().length >= 2)
      // 긴 이름 우선(부분 문자열 오탐 방지: "블라디미르"가 "블"보다 먼저 매칭되게)
      .sort((a, b) => b.name.length - a.name.length);
    if (roles.length === 0) return { tagged: 0, total: 0 };

    const cues = await this.prisma.trackCue.findMany({
      where: { productionId, deletedAt: null, characterId: null, track: { is: { name: "배우" } } },
      select: { id: true, content: true }
    });

    let tagged = 0;
    for (const cue of cues) {
      const match = roles.find((role) => cue.content.includes(role.name));
      if (match) {
        await this.prisma.trackCue.update({ where: { id: cue.id }, data: { characterId: match.id } });
        tagged += 1;
      }
    }
    return { tagged, total: cues.length };
  }

  /**
   * 대본의 지문(STAGE_DIRECTION)에서 배우 큐를 만들어 배우 트랙에 채운다.
   * 지문이 곧 배우의 동작·등퇴장이므로 그대로 배우 큐가 된다(인물은 지문에 나온 배역명으로 태깅).
   */
  async generateActorCuesFromScript(productionId: string, user: RequestUser) {
    await this.assertStaff(productionId, user);
    const script = await this.prisma.script.findFirst({
      where: { productionId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true }
    });
    if (!script) {
      throw new NotFoundException("대본이 없습니다. 먼저 대본을 등록해 주세요.");
    }
    const scenes = await this.prisma.scene.findMany({
      where: { act: { scriptId: script.id } },
      orderBy: [{ act: { order: "asc" } }, { order: "asc" }],
      select: { id: true, blocks: { orderBy: { order: "asc" }, select: { type: true, text: true, characterId: true, startMs: true, durationMs: true } } }
    });

    let track = await this.prisma.cueTrack.findFirst({ where: { productionId, name: "배우" } });
    if (!track) {
      const order = await this.nextTrackOrder(productionId);
      track = await this.prisma.cueTrack.create({ data: { productionId, name: "배우", order } });
    }
    const roles = (await this.prisma.role.findMany({ where: { productionId }, select: { id: true, name: true } }))
      .filter((role) => role.name.trim().length >= 2)
      .sort((a, b) => b.name.length - a.name.length);

    let count = await this.prisma.trackCue.count({ where: { trackId: track.id } });
    let order = await this.nextCueOrder(track.id);
    const data: {
      productionId: string;
      trackId: string;
      sceneId: string;
      cueNumber: string;
      content: string;
      trigger: string | null;
      characterId: string | null;
      startMs: number | null;
      durationSec: number | null;
      order: number;
      authorId: string;
    }[] = [];

    for (const scene of scenes) {
      let lastDialogue: string | null = null;
      for (const block of scene.blocks) {
        if (block.type === "DIALOGUE") lastDialogue = block.text.trim();
        if (block.type !== "STAGE_DIRECTION") continue;
        const text = block.text.trim();
        if (!text) continue;
        const roleMatch = roles.find((role) => text.includes(role.name));
        const durationSec = block.durationMs === null ? null : Math.ceil(block.durationMs / 1000);
        this.assertCueTiming(block.startMs, durationSec);
        count += 1;
        data.push({
          productionId,
          trackId: track.id,
          sceneId: scene.id,
          cueNumber: `배${String(count).padStart(2, "0")}`,
          content: text.slice(0, 500),
          trigger: lastDialogue ? lastDialogue.slice(0, 60) : null,
          characterId: block.characterId ?? roleMatch?.id ?? null,
          startMs: block.startMs,
          durationSec,
          order: order++,
          authorId: user.id
        });
      }
    }
    if (data.length) {
      await this.prisma.trackCue.createMany({ data });
    }
    return { created: data.length };
  }

  /** 기존 음악 큐(MusicCue)를 "음악" 트랙의 큐로 복사한다. */
  async importMusicCues(productionId: string, user: RequestUser) {
    await this.assertStaff(productionId, user);

    const musicCues = await this.prisma.musicCue.findMany({
      where: { productionId },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      include: {
        track: { select: { title: true } },
        anchorBlock: { select: { cueLabel: true, text: true } },
        scene: { select: { id: true, title: true } }
      }
    });
    if (musicCues.length === 0) {
      return { imported: 0 };
    }

    let musicTrack = await this.prisma.cueTrack.findFirst({ where: { productionId, name: "음악" } });
    if (!musicTrack) {
      musicTrack = await this.prisma.cueTrack.create({
        data: { productionId, name: "음악", order: await this.nextTrackOrder(productionId) }
      });
    }

    const existingNumbers = new Set(
      (
        await this.prisma.trackCue.findMany({
          where: { trackId: musicTrack.id },
          select: { cueNumber: true }
        })
      ).map((cue) => cue.cueNumber)
    );

    const startOrder = await this.nextCueOrder(musicTrack.id);
    const toCreate = musicCues
      .filter((cue) => !existingNumbers.has(cue.cueNumber))
      .map((cue, index) => ({
        productionId,
        trackId: musicTrack.id,
        sceneId: cue.sceneId,
        cueNumber: cue.cueNumber,
        trigger: cue.anchorBlock?.cueLabel ?? cue.anchorBlock?.text?.slice(0, 120) ?? null,
        content: `${cue.track.title} ${this.cueTypeLabel(cue.cueType)}`,
        note: cue.note,
        order: startOrder + index,
        authorId: user.id
      }));

    if (toCreate.length > 0) {
      await this.prisma.trackCue.createMany({ data: toCreate });
    }
    return { imported: toCreate.length };
  }

  private assertCueTiming(startMs: number | null | undefined, durationSec: number | null | undefined) {
    if (startMs != null && (!Number.isInteger(startMs) || startMs < 0 || startMs > 86_400_000)) {
      throw new BadRequestException("시작 시각은 0~24시간 범위의 정수 밀리초여야 합니다");
    }
    if (durationSec != null && (!Number.isInteger(durationSec) || durationSec < 1 || durationSec > 3600)) {
      throw new BadRequestException("큐 길이는 1~3600 범위의 정수 초여야 합니다");
    }
    if (startMs != null && durationSec != null && startMs + durationSec * 1000 > 86_400_000) {
      throw new BadRequestException("큐 종료 시각은 공연 시작 후 24시간 이내여야 합니다");
    }
  }

  private cueTypeLabel(cueType: string) {
    const labels: Record<string, string> = {
      START: "재생",
      BGM: "배경음악",
      STOP: "정지",
      PAUSE: "일시정지",
      RESUME: "재개",
      SFX: "효과음",
      MIC: "마이크",
      NOTE: "메모"
    };
    return labels[cueType] ?? cueType;
  }

  private async nextTrackOrder(productionId: string) {
    const last = await this.prisma.cueTrack.findFirst({
      where: { productionId },
      orderBy: { order: "desc" },
      select: { order: true }
    });
    return (last?.order ?? -1) + 1;
  }

  private async nextCueOrder(trackId: string) {
    const last = await this.prisma.trackCue.findFirst({
      where: { trackId, deletedAt: null },
      orderBy: { order: "desc" },
      select: { order: true }
    });
    return (last?.order ?? -1) + 1;
  }

  private async findTrackOrThrow(productionId: string, trackId: string) {
    const track = await this.prisma.cueTrack.findFirst({ where: { id: trackId, productionId } });
    if (!track) {
      throw new NotFoundException("트랙을 찾을 수 없습니다");
    }
    return track;
  }

  private async findCueOrThrow(productionId: string, cueId: string) {
    const cue = await this.prisma.trackCue.findFirst({ where: { id: cueId, productionId, deletedAt: null } });
    if (!cue) {
      throw new NotFoundException("큐를 찾을 수 없습니다");
    }
    return cue;
  }

  private async assertCharacter(productionId: string, characterId: string | null | undefined) {
    if (!characterId) return;
    const role = await this.prisma.role.findFirst({ where: { id: characterId, productionId }, select: { id: true } });
    if (!role) {
      throw new NotFoundException("이 공연의 배역(인물)을 찾을 수 없습니다");
    }
  }

  /** 큐에 붙이는 미디어는 같은 공연의 영상·음원 파일이어야 한다. */
  private async assertMediaAsset(productionId: string, assetId: string | null | undefined) {
    if (!assetId) return;
    const asset = await this.prisma.asset.findFirst({
      where: { id: assetId, productionId, kind: { in: ["AUDIO", "VIDEO", "IMAGE"] } },
      select: { id: true }
    });
    if (!asset) {
      throw new NotFoundException("이 공연의 영상·음원 파일을 찾을 수 없습니다");
    }
  }

  private async assertScene(productionId: string, sceneId?: string | null) {
    if (!sceneId) return;
    const scene = await this.prisma.scene.findFirst({
      where: { id: sceneId, act: { script: { productionId, deletedAt: null } } },
      select: { id: true }
    });
    if (!scene) {
      throw new NotFoundException("장면을 찾을 수 없습니다");
    }
  }

  private async assertOwnerMembership(productionId: string, membershipId?: string | null) {
    if (!membershipId) return;
    const membership = await this.prisma.membership.findFirst({
      where: { id: membershipId, productionId },
      select: { id: true }
    });
    if (!membership) {
      throw new NotFoundException("담당자로 지정할 멤버를 찾을 수 없습니다");
    }
  }

  /** 제작진·운영자는 전체("ALL"), 그 외에는 본인이 담당자인 트랙 ID 목록. */
  private async resolveEditableTrackIds(productionId: string, user: RequestUser): Promise<"ALL" | string[]> {
    const active = await this.prisma.production.findFirst({ where: { id: productionId, deletedAt: null }, select: { id: true } });
    if (!active) throw new NotFoundException("공연을 찾을 수 없습니다");
    if (await isProductionAdmin(this.prisma, user, productionId)) {
      return "ALL";
    }
    const membership = await this.prisma.membership.findFirst({
      where: { productionId, userId: user.id },
      select: { id: true, roles: { select: { role: true } } }
    });
    if (!membership) {
      throw new ForbiddenException("참여 중인 공연만 열 수 있습니다");
    }
    if (membership.roles.some((role) => STAFF_ROLES.includes(role.role))) {
      return "ALL";
    }
    const owned = await this.prisma.cueTrack.findMany({
      where: { productionId, ownerMembershipId: membership.id },
      select: { id: true }
    });
    return owned.map((track) => track.id);
  }

  private async assertStaff(productionId: string, user: RequestUser) {
    const editable = await this.resolveEditableTrackIds(productionId, user);
    if (editable !== "ALL") {
      throw new ForbiddenException("제작진만 할 수 있는 작업입니다");
    }
  }

  private async assertCanEditTrack(productionId: string, trackId: string, user: RequestUser) {
    const editable = await this.resolveEditableTrackIds(productionId, user);
    if (editable === "ALL") return;
    if (!editable.includes(trackId)) {
      throw new ForbiddenException("담당 트랙에만 큐를 작성할 수 있습니다");
    }
  }
}
