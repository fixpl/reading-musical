import { Injectable } from "@nestjs/common";
import { Prisma, ProductionRole } from "@prisma/client";
import type { RequestUser } from "../common/types/request-user";
import { PrismaService } from "../prisma/prisma.service";
import { SearchProductionQueryDto } from "./dto";
import { ProductionAccessService } from "./production-access.service";
import { maskEmail, searchSnippet, takeSearch } from "./production-shared.util";

const PEOPLE_MANAGER_ROLES: readonly ProductionRole[] = [
  ProductionRole.PRODUCER,
  ProductionRole.DIRECTOR,
  ProductionRole.MUSIC_DIRECTOR,
  ProductionRole.STAGE_MANAGER
];

type ProductionSearchResultType = "SCRIPT_BLOCK" | "ROLE" | "MEMBER" | "MUSIC_CUE" | "EVENT";

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

/** 공연 참여자 목록(listPeople)과 공연 내 통합 검색(search) — productions.service.ts에서 분리. */
@Injectable()
export class ProductionDirectoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProductionAccessService
  ) {}

  async listPeople(productionId: string, user: RequestUser) {
    const access = await this.access.getAccess(productionId, user);
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
          email: access.canViewSensitive ? membership.user.email : maskEmail(membership.user.email),
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
    const access = await this.access.getAccess(productionId, user);
    const q = query.q?.trim() ?? "";
    const take = takeSearch(query.take);
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
      })
    ]);

    const rawGroups: Array<Omit<ProductionSearchGroup, "count">> = [
      {
        type: "SCRIPT_BLOCK",
        label: "대본",
        items: scriptBlocks.map((block) => ({
          type: "SCRIPT_BLOCK",
          id: block.id,
          title: `${block.scene.title} · ${block.cueLabel ?? block.character?.name ?? block.type}`,
          snippet: searchSnippet(block.text, q),
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
          snippet: searchSnippet(role.description, q),
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
          snippet: access.canViewSensitive ? membership.user.email : maskEmail(membership.user.email),
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
          snippet: searchSnippet(cue.note ?? cue.anchorBlock?.text ?? null, q),
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
          snippet: searchSnippet(event.location ?? event.meetingUrl ?? null, q),
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
}
