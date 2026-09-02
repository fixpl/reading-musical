import "dotenv/config";
import {
  AssetKind,
  AttendanceStatus,
  CastAssignmentKind,
  CueFireMode,
  CueType,
  EventType,
  Phase,
  PlatformRole,
  Prisma,
  PrismaClient,
  ProductionRole,
  ProfileType,
  SceneBlockType,
  StaffDiscipline,
  UserStatus,
  Visibility
} from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { createPrismaClientOptions } from "../src/prisma/create-prisma-client-options";

const prisma = new PrismaClient(createPrismaClientOptions());

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL || "admin@example.com";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || "change-me-strong";
  const demoPassword = process.env.SEED_DEMO_PASSWORD || adminPassword;

  const organization = await prisma.organization.upsert({
    where: { id: "org_default" },
    update: { name: "아트브릿지 운영단체" },
    create: { id: "org_default", name: "아트브릿지 운영단체" }
  });

  const admin = await upsertSeedUser({
    organizationId: organization.id,
    email: adminEmail,
    password: adminPassword,
    name: "운영 관리자",
    profileType: ProfileType.PLANNER,
    platformRole: PlatformRole.SUPER_ADMIN,
    profileDetails: { position: "최종관리자", organization: "아트브릿지 운영단체" }
  });

  const actor = await upsertSeedUser({
    organizationId: organization.id,
    email: process.env.SEED_ACTOR_EMAIL || "actor@example.com",
    password: demoPassword,
    name: "테스트 배우 민준",
    phone: "010-1111-2222",
    profileType: ProfileType.ACTOR,
    platformRole: PlatformRole.MEMBER,
    profileDetails: {
      voiceRange: "Baritone",
      mainSkills: ["대사", "노래", "리딩"],
      memo: "로컬 QA용 배우 계정"
    }
  });

  const staff = await upsertSeedUser({
    organizationId: organization.id,
    email: process.env.SEED_STAFF_EMAIL || "staff@example.com",
    password: demoPassword,
    name: "테스트 스태프 지훈",
    phone: "010-3333-4444",
    profileType: ProfileType.STAFF,
    platformRole: PlatformRole.MEMBER,
    profileDetails: {
      disciplines: ["SOUND"],
      equipment: ["노트북", "오디오 인터페이스"],
      memo: "로컬 QA용 음향 스태프 계정"
    }
  });

  const demoProduction = await prisma.production.upsert({
    where: { organizationId_title: { organizationId: organization.id, title: "아트브릿지 리딩 쇼케이스" } },
    update: {
      currentPhase: Phase.READING,
      visibility: Visibility.DRAFT,
      venue: "아트브릿지 리딩룸"
    },
    create: {
      organizationId: organization.id,
      title: "아트브릿지 리딩 쇼케이스",
      slug: "artbridge-reading-showcase",
      synopsis: "로컬 테스트용 리딩뮤지컬 공연 준비 데이터",
      description: "배우, 스태프, 대본 장면, 음악 큐, 일정 관리 화면을 검증하기 위한 데모 공연입니다.",
      venue: "아트브릿지 리딩룸",
      currentPhase: Phase.READING,
      visibility: Visibility.DRAFT
    }
  });

  const productions = await prisma.production.findMany({
    where: { organizationId: organization.id, archived: false },
    orderBy: [{ createdAt: "asc" }, { title: "asc" }]
  });

  for (const production of productions.length ? productions : [demoProduction]) {
    await seedProductionDemoData({
      productionId: production.id,
      adminId: admin.id,
      actorId: actor.id,
      staffId: staff.id
    });
  }

  await Promise.all([
    ensurePersonalScheduleFixture({
      userId: actor.id,
      title: "본업 근무",
      reason: "개인 일정 충돌 표시 확인용",
      startAt: localDateAt(addDays(new Date(), 1), 9, 0),
      endAt: localDateAt(addDays(new Date(), 1), 18, 0)
    }),
    ensurePersonalScheduleFixture({
      userId: staff.id,
      title: "외부 공연 음향 셋업",
      reason: "개인 일정 충돌 표시 확인용",
      startAt: localDateAt(addDays(new Date(), 2), 17, 0),
      endAt: localDateAt(addDays(new Date(), 2), 21, 0)
    })
  ]);

  console.log(
    [
      `Seed complete: organization=${organization.id}`,
      `admin=${admin.email}`,
      `actor=${actor.email}`,
      `staff=${staff.email}`,
      `demoPassword=${demoPassword}`,
      `productions=${productions.length || 1}`
    ].join(", ")
  );
}

async function upsertSeedUser(input: {
  organizationId: string;
  email: string;
  password: string;
  name: string;
  phone?: string;
  profileType: ProfileType;
  platformRole: PlatformRole;
  profileDetails: Prisma.InputJsonObject;
}) {
  const passwordHash = await bcrypt.hash(input.password, 12);
  return prisma.user.upsert({
    where: { email: input.email },
    update: {
      organizationId: input.organizationId,
      passwordHash,
      name: input.name,
      phone: input.phone,
      profileType: input.profileType,
      profileDetails: input.profileDetails,
      profileComplete: true,
      status: UserStatus.ACTIVE,
      platformRole: input.platformRole
    },
    create: {
      organizationId: input.organizationId,
      email: input.email,
      passwordHash,
      name: input.name,
      phone: input.phone,
      profileType: input.profileType,
      profileDetails: input.profileDetails,
      profileComplete: true,
      status: UserStatus.ACTIVE,
      platformRole: input.platformRole
    }
  });
}

async function seedProductionDemoData(input: { productionId: string; adminId: string; actorId: string; staffId: string }) {
  const producerMembership = await ensureMembership(input.productionId, input.adminId, ProductionRole.PRODUCER, [ProductionRole.PRODUCER]);
  const actorMembership = await ensureMembership(input.productionId, input.actorId, ProductionRole.ACTOR, [ProductionRole.ACTOR]);
  const staffMembership = await ensureMembership(input.productionId, input.staffId, ProductionRole.STAFF, [ProductionRole.STAFF]);

  await prisma.staffAssignment.upsert({
    where: { membershipId_assignmentKey: { membershipId: staffMembership.id, assignmentKey: StaffDiscipline.SOUND } },
    update: {
      productionId: input.productionId,
      discipline: StaffDiscipline.SOUND,
      customLabel: "음향 스태프",
      isLead: true,
      note: "리딩 음악 큐 재생과 음향 확인 담당"
    },
    create: {
      productionId: input.productionId,
      membershipId: staffMembership.id,
      discipline: StaffDiscipline.SOUND,
      assignmentKey: StaffDiscipline.SOUND,
      customLabel: "음향 스태프",
      isLead: true,
      note: "리딩 음악 큐 재생과 음향 확인 담당"
    }
  });

  const { scenes } = await ensureScriptFixtures(input.productionId, actorMembership.id);
  await ensureCueTrackFixtures(input.productionId, actorMembership.id, staffMembership.id);
  await ensureTrackCueFixtures(input.productionId, input.adminId, scenes);
  await ensureBlockTimingFixtures(scenes);
  const musicCue = await ensureMusicFixtures(input.productionId, input.adminId, scenes[0]?.id ?? null);
  await ensureStageFixtures(input.productionId, scenes[0]?.id ?? null);
  await ensureScheduleFixtures({
    productionId: input.productionId,
    memberships: [producerMembership.id, actorMembership.id, staffMembership.id],
    sceneIds: scenes.map((scene) => scene.id),
    musicCueId: musicCue?.id ?? null
  });
}

async function ensureMembership(productionId: string, userId: string, primaryRole: ProductionRole, roles: ProductionRole[]) {
  const membership = await prisma.membership.upsert({
    where: { userId_productionId: { userId, productionId } },
    update: { primaryRole },
    create: { userId, productionId, primaryRole }
  });
  await prisma.membershipRole.createMany({
    data: roles.map((role) => ({ membershipId: membership.id, role })),
    skipDuplicates: true
  });
  return membership;
}

async function ensureScriptFixtures(productionId: string, actorMembershipId: string) {
  const script =
    (await prisma.script.findFirst({ where: { productionId, title: "리딩 대본" } })) ??
    (await prisma.script.create({ data: { productionId, title: "리딩 대본" } }));
  const act =
    (await prisma.act.findFirst({ where: { scriptId: script.id, order: 1 } })) ??
    (await prisma.act.create({ data: { scriptId: script.id, order: 1, title: "1막" } }));
  const sceneOne =
    (await prisma.scene.findFirst({ where: { actId: act.id, order: 1 } })) ??
    (await prisma.scene.create({
      data: {
        actId: act.id,
        order: 1,
        title: "1장. 첫 리딩",
        summary: "배우와 스태프가 첫 장면의 리딩 흐름을 맞춥니다."
      }
    }));
  const sceneTwo =
    (await prisma.scene.findFirst({ where: { actId: act.id, order: 2 } })) ??
    (await prisma.scene.create({
      data: {
        actId: act.id,
        order: 2,
        title: "2장. 음악 큐 확인",
        summary: "대사와 음악 큐의 연결 타이밍을 확인합니다."
      }
    }));
  const role =
    (await prisma.role.findFirst({ where: { productionId, name: "민준" } })) ??
    (await prisma.role.create({
      data: {
        productionId,
        name: "민준",
        description: "테스트 배우가 맡는 리딩 배역"
      }
    }));

  await prisma.castAssignment.upsert({
    where: { roleId_membershipId: { roleId: role.id, membershipId: actorMembershipId } },
    update: { kind: CastAssignmentKind.MAIN },
    create: { roleId: role.id, membershipId: actorMembershipId, kind: CastAssignmentKind.MAIN }
  });
  for (const scene of [sceneOne, sceneTwo]) {
    await prisma.sceneRole.upsert({
      where: { sceneId_roleId: { sceneId: scene.id, roleId: role.id } },
      update: { lineCount: scene.order === 1 ? 3 : 1, songCount: scene.order === 2 ? 1 : 0 },
      create: { sceneId: scene.id, roleId: role.id, lineCount: scene.order === 1 ? 3 : 1, songCount: scene.order === 2 ? 1 : 0 }
    });
  }

  if ((await prisma.sceneBlock.count({ where: { sceneId: sceneOne.id } })) === 0) {
    await prisma.sceneBlock.createMany({
      data: [
        {
          sceneId: sceneOne.id,
          order: 1,
          type: SceneBlockType.STAGE_DIRECTION,
          text: "배우와 스태프가 테이블에 모여 첫 리딩을 시작한다."
        },
        {
          sceneId: sceneOne.id,
          order: 2,
          type: SceneBlockType.DIALOGUE,
          characterId: role.id,
          text: "오늘은 여기서 시작할게요. 음악 큐가 들어오면 다음 장면으로 넘어갑니다.",
          cueLabel: "M01"
        }
      ]
    });
  }
  if ((await prisma.sceneBlock.count({ where: { sceneId: sceneTwo.id } })) === 0) {
    await prisma.sceneBlock.createMany({
      data: [
        {
          sceneId: sceneTwo.id,
          order: 1,
          type: SceneBlockType.LYRIC,
          characterId: role.id,
          text: "조용히 이어지는 첫 번째 멜로디 위로 장면이 열린다.",
          cueLabel: "M02"
        }
      ]
    });
  }

  return { script, act, role, scenes: [sceneOne, sceneTwo] };
}

async function ensureCueTrackFixtures(productionId: string, actorMembershipId: string, staffMembershipId: string) {
  await Promise.all([
    prisma.cueTrack.upsert({
      where: { productionId_name: { productionId, name: "배우" } },
      update: { ownerMembershipId: actorMembershipId, order: 1 },
      create: { productionId, name: "배우", order: 1, ownerMembershipId: actorMembershipId }
    }),
    prisma.cueTrack.upsert({
      where: { productionId_name: { productionId, name: "효과음" } },
      update: { ownerMembershipId: staffMembershipId, order: 2 },
      create: { productionId, name: "효과음", order: 2, ownerMembershipId: staffMembershipId }
    })
  ]);
}

// 샘플 트랙 큐 — 첫 화면이 빈 상태로 뜨지 않도록 배우·효과음 트랙에 기본 큐를 넣는다.
async function ensureTrackCueFixtures(productionId: string, authorId: string, scenes: { id: string; order: number }[]) {
  const sceneOne = scenes[0];
  const sceneTwo = scenes[1];
  const actorTrack = await prisma.cueTrack.findFirst({ where: { productionId, name: "배우" } });
  const sfxTrack = await prisma.cueTrack.findFirst({ where: { productionId, name: "효과음" } });
  const role = await prisma.role.findFirst({ where: { productionId, name: "민준" } });

  if (actorTrack && sceneOne && (await prisma.trackCue.count({ where: { trackId: actorTrack.id, deletedAt: null } })) === 0) {
    await prisma.trackCue.createMany({
      data: [
        {
          productionId,
          trackId: actorTrack.id,
          sceneId: sceneOne.id,
          cueNumber: "배01",
          trigger: "해설 시작 신호",
          content: "민준 테이블 중앙 의자에 착석",
          characterId: role?.id ?? null,
          durationSec: 30,
          order: 0,
          authorId
        },
        {
          productionId,
          trackId: actorTrack.id,
          sceneId: sceneTwo?.id ?? sceneOne.id,
          cueNumber: "배02",
          trigger: "M02 가사 시작",
          content: "민준 일어서서 정면 보고 노래",
          characterId: role?.id ?? null,
          durationSec: 60,
          order: 1,
          authorId
        }
      ]
    });
  }
  if (sfxTrack && sceneOne && (await prisma.trackCue.count({ where: { trackId: sfxTrack.id, deletedAt: null } })) === 0) {
    await prisma.trackCue.createMany({
      data: [
        {
          productionId,
          trackId: sfxTrack.id,
          sceneId: sceneOne.id,
          cueNumber: "효01",
          trigger: "1장 시작과 함께",
          content: "잔잔한 카페 ambient 사운드 재생",
          durationSec: 45,
          order: 0,
          authorId
        }
      ]
    });
  }
}

// 대본 블록 타임라인 기본 배치 — 시간 미지정 블록에 순서대로 시작/길이를 채운다.
async function ensureBlockTimingFixtures(scenes: { id: string; order: number }[]) {
  let cursorMs = 0;
  for (const scene of scenes) {
    const blocks = await prisma.sceneBlock.findMany({
      where: { sceneId: scene.id },
      orderBy: { order: "asc" },
      select: { id: true, type: true, startMs: true, durationMs: true }
    });
    for (const block of blocks) {
      const durationMs = block.durationMs ?? (block.type === "LYRIC" ? 15000 : block.type === "DIALOGUE" ? 12000 : 8000);
      if (block.startMs == null) {
        await prisma.sceneBlock.update({ where: { id: block.id }, data: { startMs: cursorMs, durationMs } });
      }
      cursorMs = Math.max(cursorMs, (block.startMs ?? cursorMs) + durationMs);
    }
  }
}

async function ensureMusicFixtures(productionId: string, ownerId: string, sceneId: string | null) {
  const storageKey = `seed/${productionId}/demo-intro.mp3`;
  const asset =
    (await prisma.asset.findFirst({ where: { productionId, storageKey } })) ??
    (await prisma.asset.create({
      data: {
        ownerId,
        productionId,
        kind: AssetKind.AUDIO,
        storageKey,
        mime: "audio/mpeg",
        sizeBytes: 1024,
        checksum: `sha256:${"0".repeat(64)}`
      }
    }));
  const track =
    (await prisma.musicTrack.findFirst({ where: { productionId, title: "데모 인트로 음악" } })) ??
    (await prisma.musicTrack.create({
      data: {
        productionId,
        assetId: asset.id,
        title: "데모 인트로 음악",
        durationMs: 90000,
        waveformPeaksJson: [0.12, 0.3, 0.18, 0.42, 0.25, 0.2]
      }
    }));
  const cue =
    (await prisma.musicCue.findFirst({ where: { productionId, cueNumber: "M01" } })) ??
    (await prisma.musicCue.create({
      data: {
        productionId,
        trackId: track.id,
        sceneId,
        cueNumber: "M01",
        cueType: CueType.BGM,
        order: 1,
        trackStartMs: 0,
        trackEndMs: 30000,
        fadeInMs: 2000,
        fadeOutMs: 1500,
        volumeDb: -3,
        fireMode: CueFireMode.MANUAL,
        note: "첫 리딩 시작 전 분위기 음악"
      }
    }));
  return cue;
}

async function ensureStageFixtures(productionId: string, sceneId: string | null) {
  if (!sceneId) return;
  const stagePlan =
    (await prisma.stagePlan.findFirst({ where: { productionId, name: "기본 리딩룸" } })) ??
    (await prisma.stagePlan.create({
      data: {
        productionId,
        name: "기본 리딩룸",
        layout: { width: 100, height: 100, unit: "percent" }
      }
    }));
  await prisma.stageSceneNote.upsert({
    where: { stagePlanId_sceneId: { stagePlanId: stagePlan.id, sceneId } },
    update: { note: "배우 테이블 중앙, 음향 노트북은 상수 쪽에 배치" },
    create: {
      stagePlanId: stagePlan.id,
      sceneId,
      note: "배우 테이블 중앙, 음향 노트북은 상수 쪽에 배치"
    }
  });
}

async function ensureScheduleFixtures(input: { productionId: string; memberships: string[]; sceneIds: string[]; musicCueId: string | null }) {
  const readingStart = localDateAt(addDays(new Date(), 1), 13, 0);
  const readingEnd = localDateAt(addDays(new Date(), 1), 15, 0);
  const musicStart = localDateAt(addDays(new Date(), 2), 18, 0);
  const musicEnd = localDateAt(addDays(new Date(), 2), 19, 30);

  const readingEvent = await upsertScheduleEvent({
    productionId: input.productionId,
    title: "1차 테이블 리딩",
    type: EventType.READING,
    startAt: readingStart,
    endAt: readingEnd,
    location: "연습실 A",
    meetingUrl: null,
    sceneIds: input.sceneIds,
    musicCueIds: input.musicCueId ? [input.musicCueId] : [],
    membershipIds: input.memberships
  });

  await upsertScheduleEvent({
    productionId: input.productionId,
    title: "음악 큐 리허설",
    type: EventType.MUSIC_PRACTICE,
    startAt: musicStart,
    endAt: musicEnd,
    location: "음향실",
    meetingUrl: "https://meet.google.com/demo-artbridge",
    sceneIds: input.sceneIds.slice(0, 1),
    musicCueIds: input.musicCueId ? [input.musicCueId] : [],
    membershipIds: input.memberships
  });

  await prisma.attendance.updateMany({
    where: { eventId: readingEvent.id, membershipId: { in: input.memberships.slice(0, 1) } },
    data: { status: AttendanceStatus.ACCEPTED }
  });
}

async function upsertScheduleEvent(input: {
  productionId: string;
  title: string;
  type: EventType;
  startAt: Date;
  endAt: Date;
  location: string;
  meetingUrl: string | null;
  sceneIds: string[];
  musicCueIds: string[];
  membershipIds: string[];
}) {
  const event =
    (await prisma.scheduleEvent.findFirst({ where: { productionId: input.productionId, title: input.title } })) ??
    (await prisma.scheduleEvent.create({
      data: {
        productionId: input.productionId,
        title: input.title,
        type: input.type,
        startAt: input.startAt,
        endAt: input.endAt,
        location: input.location,
        meetingUrl: input.meetingUrl
      }
    }));

  const updated = await prisma.scheduleEvent.update({
    where: { id: event.id },
    data: {
      type: input.type,
      startAt: input.startAt,
      endAt: input.endAt,
      location: input.location,
      meetingUrl: input.meetingUrl
    }
  });

  await prisma.eventScene.deleteMany({ where: { eventId: updated.id } });
  if (input.sceneIds.length) {
    await prisma.eventScene.createMany({
      data: input.sceneIds.map((sceneId) => ({ eventId: updated.id, sceneId })),
      skipDuplicates: true
    });
  }

  await prisma.eventMusicCue.deleteMany({ where: { eventId: updated.id } });
  if (input.musicCueIds.length) {
    await prisma.eventMusicCue.createMany({
      data: input.musicCueIds.map((cueId) => ({ eventId: updated.id, cueId })),
      skipDuplicates: true
    });
  }

  for (const membershipId of input.membershipIds) {
    await prisma.attendance.upsert({
      where: { eventId_membershipId: { eventId: updated.id, membershipId } },
      update: {},
      create: { eventId: updated.id, membershipId, status: AttendanceStatus.INVITED }
    });
  }
  return updated;
}

async function ensurePersonalScheduleFixture(input: {
  userId: string;
  title: string;
  reason: string;
  startAt: Date;
  endAt: Date;
}) {
  const existing = await prisma.availability.findFirst({ where: { userId: input.userId, title: input.title } });
  if (existing) {
    return prisma.availability.update({
      where: { id: existing.id },
      data: { startAt: input.startAt, endAt: input.endAt, isAvailable: false, reason: input.reason }
    });
  }
  return prisma.availability.create({ data: { ...input, isAvailable: false } });
}

function localDateAt(date: Date, hour: number, minute: number) {
  const next = new Date(date);
  next.setHours(hour, minute, 0, 0);
  return next;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(date.getDate() + days);
  return next;
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
