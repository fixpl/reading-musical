import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { CastAssignmentKind, Prisma, ProductionRole, SceneBlockType } from "@prisma/client";
import type { RequestUser } from "../common/types/request-user";
import { PrismaService } from "../prisma/prisma.service";
import { CreateRoleDto, PutSceneRolesDto, UpdateRoleDto, UpsertCastAssignmentDto, MergeRoleDto } from "./dto";
import { assertProductionMembership } from "../common/access/assert-production-membership";

const VIEW_ROLES: ProductionRole[] = [
  ProductionRole.PRODUCER,
  ProductionRole.DIRECTOR,
  ProductionRole.MUSIC_DIRECTOR,
  ProductionRole.STAGE_MANAGER,
  ProductionRole.ACTOR,
  ProductionRole.STAFF,
  ProductionRole.GUEST
];

const EDIT_ROLES = [ProductionRole.PRODUCER, ProductionRole.DIRECTOR];

type RoleCount = { lineCount: number; songCount: number };

@Injectable()
export class CastingService {
  constructor(private readonly prisma: PrismaService) {}

  async listRoles(productionId: string, user: RequestUser) {
    await this.assertMembership(productionId, user, VIEW_ROLES);
    return this.prisma.role.findMany({
      where: { productionId },
      orderBy: { name: "asc" },
      include: this.roleInclude()
    });
  }

  async createRole(productionId: string, dto: CreateRoleDto, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    await this.assertUniqueRoleName(productionId, dto.name);
    return this.prisma.role.create({
      data: {
        productionId,
        name: dto.name.trim(),
        description: dto.description?.trim() || null
      },
      include: this.roleInclude()
    });
  }

  async updateRole(productionId: string, roleId: string, dto: UpdateRoleDto, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    const role = await this.assertRole(productionId, roleId);
    if (dto.name && dto.name.trim() !== role.name) {
      await this.assertUniqueRoleName(productionId, dto.name, roleId);
    }
    const updated = await this.prisma.role.update({
      where: { id: roleId },
      data: {
        name: dto.name?.trim(),
        description: dto.description === undefined ? undefined : dto.description?.trim() || null
      },
      include: this.roleInclude()
    });
    await this.recomputeProductionSceneRoles(productionId);
    return updated;
  }

  async deleteRole(productionId: string, roleId: string, force: boolean, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    await this.assertRole(productionId, roleId);
    const [assignments, sceneRoles, dialogueBlocks] = await Promise.all([
      this.prisma.castAssignment.count({ where: { roleId } }),
      this.prisma.sceneRole.count({ where: { roleId } }),
      this.prisma.sceneBlock.count({ where: { characterId: roleId } })
    ]);
    const impact = { assignments, sceneRoles, dialogueBlocks };
    if (!force && (assignments || sceneRoles || dialogueBlocks)) {
      throw new ConflictException({
        message: "배우 배정, 장면 매핑 또는 대본 블록이 연결된 배역이에요. 영향 내용을 확인한 뒤 삭제해 주세요.",
        impact
      });
    }

    await this.prisma.$transaction([
      this.prisma.sceneBlock.updateMany({ where: { characterId: roleId }, data: { characterId: null } }),
      this.prisma.sceneRole.deleteMany({ where: { roleId } }),
      this.prisma.castAssignment.deleteMany({ where: { roleId } }),
      this.prisma.role.delete({ where: { id: roleId } })
    ]);

    return { deletedId: roleId, impact };
  }

  // 중복 배역 합치기 — source의 모든 참조(배정·장면·대본·큐 인물)를 target으로 옮기고 source를 지운다.
  async mergeRole(productionId: string, sourceRoleId: string, dto: MergeRoleDto, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    if (sourceRoleId === dto.targetRoleId) {
      throw new BadRequestException("같은 배역끼리는 합칠 수 없어요");
    }
    const [source, target] = await Promise.all([
      this.assertRole(productionId, sourceRoleId),
      this.assertRole(productionId, dto.targetRoleId)
    ]);

    const moved = await this.prisma.$transaction(async (tx) => {
      // 배우 배정 — 대상에 이미 있는 멤버는 건너뛰고(유니크), 나머지는 대상으로 옮긴다.
      const targetMembers = new Set(
        (await tx.castAssignment.findMany({ where: { roleId: target.id }, select: { membershipId: true } })).map(
          (row) => row.membershipId
        )
      );
      const srcAssignments = await tx.castAssignment.findMany({
        where: { roleId: source.id },
        select: { id: true, membershipId: true }
      });
      let movedAssignments = 0;
      for (const assignment of srcAssignments) {
        if (targetMembers.has(assignment.membershipId)) {
          await tx.castAssignment.delete({ where: { id: assignment.id } });
        } else {
          await tx.castAssignment.update({ where: { id: assignment.id }, data: { roleId: target.id } });
          movedAssignments += 1;
        }
      }

      // 장면 매핑 — 대상에 이미 있는 장면은 건너뛰고(유니크), 나머지는 대상으로.
      const targetScenes = new Set(
        (await tx.sceneRole.findMany({ where: { roleId: target.id }, select: { sceneId: true } })).map(
          (row) => row.sceneId
        )
      );
      const srcSceneRoles = await tx.sceneRole.findMany({
        where: { roleId: source.id },
        select: { id: true, sceneId: true }
      });
      for (const sceneRole of srcSceneRoles) {
        if (targetScenes.has(sceneRole.sceneId)) {
          await tx.sceneRole.delete({ where: { id: sceneRole.id } });
        } else {
          await tx.sceneRole.update({ where: { id: sceneRole.id }, data: { roleId: target.id } });
        }
      }

      const blocks = await tx.sceneBlock.updateMany({
        where: { characterId: source.id },
        data: { characterId: target.id }
      });
      const cues = await tx.trackCue.updateMany({
        where: { characterId: source.id },
        data: { characterId: target.id }
      });

      await tx.role.delete({ where: { id: source.id } });
      return { movedAssignments, movedBlocks: blocks.count, movedCues: cues.count };
    });

    return { removedId: source.id, mergedInto: target.id, targetName: target.name, ...moved };
  }

  async upsertAssignment(productionId: string, roleId: string, dto: UpsertCastAssignmentDto, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    await this.assertRole(productionId, roleId);
    await this.assertActorMembership(productionId, dto.membershipId);

    const assignment = await this.prisma.castAssignment.upsert({
      where: { roleId_membershipId: { roleId, membershipId: dto.membershipId } },
      update: { kind: dto.kind ?? CastAssignmentKind.MAIN },
      create: { roleId, membershipId: dto.membershipId, kind: dto.kind ?? CastAssignmentKind.MAIN },
      include: this.assignmentInclude()
    });
    return assignment;
  }

  async deleteAssignment(productionId: string, roleId: string, assignmentId: string, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    await this.assertRole(productionId, roleId);
    const assignment = await this.prisma.castAssignment.findFirst({ where: { id: assignmentId, roleId }, select: { id: true } });
    if (!assignment) {
      throw new NotFoundException("배우 배정을 찾을 수 없어요");
    }
    await this.prisma.castAssignment.delete({ where: { id: assignmentId } });
    return { deletedId: assignmentId };
  }

  async putSceneRoles(productionId: string, sceneId: string, dto: PutSceneRolesDto, user: RequestUser) {
    await this.assertMembership(productionId, user, EDIT_ROLES);
    await this.assertScene(productionId, sceneId);
    await this.assertRolesInProduction(productionId, dto.roleIds);

    const roles = await this.prisma.role.findMany({ where: { id: { in: dto.roleIds }, productionId }, select: { id: true, name: true } });

    if (dto.syncMatchingBlocks ?? true) {
      for (const role of roles) {
        await this.prisma.sceneBlock.updateMany({
          where: {
            sceneId,
            characterId: null,
            cueLabel: { equals: role.name, mode: "insensitive" }
          },
          data: { characterId: role.id }
        });
      }
    }

    const counts = await this.computeSceneRoleCounts(sceneId, roles);
    await this.prisma.$transaction(async (tx) => {
      await tx.sceneRole.deleteMany({ where: { sceneId, roleId: { notIn: dto.roleIds } } });
      for (const role of roles) {
        const count = counts.get(role.id) ?? { lineCount: 0, songCount: 0 };
        await tx.sceneRole.upsert({
          where: { sceneId_roleId: { sceneId, roleId: role.id } },
          update: count,
          create: { sceneId, roleId: role.id, ...count }
        });
      }
    });

    return this.getSceneCasting(productionId, sceneId);
  }

  async getWorkload(productionId: string, user: RequestUser) {
    await this.assertMembership(productionId, user, VIEW_ROLES);
    await this.recomputeProductionSceneRoles(productionId);

    const [roles, actorMemberships, scenes] = await Promise.all([
      this.prisma.role.findMany({
        where: { productionId },
        orderBy: { name: "asc" },
        include: this.roleInclude()
      }),
      this.prisma.membership.findMany({
        where: { productionId, roles: { some: { role: ProductionRole.ACTOR } } },
        orderBy: { createdAt: "asc" },
        include: { user: { select: { id: true, email: true, name: true, profileType: true, profileComplete: true } } }
      }),
      this.prisma.scene.findMany({
        where: { act: { script: { productionId } } },
        orderBy: [{ act: { order: "asc" } }, { order: "asc" }],
        include: {
          act: { select: { id: true, title: true, order: true, script: { select: { id: true, title: true } } } },
          blocks: { orderBy: { order: "asc" }, select: { id: true, type: true, characterId: true, cueLabel: true } },
          sceneRoles: { include: { role: true } }
        }
      })
    ]);

    const sceneSummaries = scenes.map((scene) => {
      const suggestedRoleIds = this.suggestRoleIdsForScene(scene.blocks, roles);
      const confirmedRoleIds = scene.sceneRoles.map((sceneRole) => sceneRole.roleId);
      return {
        id: scene.id,
        title: scene.title,
        order: scene.order,
        act: scene.act,
        confirmedRoleIds,
        suggestedRoleIds,
        missingSuggestedRoleIds: suggestedRoleIds.filter((roleId) => !confirmedRoleIds.includes(roleId)),
        sceneRoles: scene.sceneRoles
          .sort((a, b) => a.role.name.localeCompare(b.role.name))
          .map((sceneRole) => ({
            id: sceneRole.id,
            roleId: sceneRole.roleId,
            roleName: sceneRole.role.name,
            lineCount: sceneRole.lineCount,
            songCount: sceneRole.songCount
          }))
      };
    });

    const roleSummaries = roles.map((role) => {
      const lineCount = role.sceneRoles.reduce((sum, sceneRole) => sum + sceneRole.lineCount, 0);
      const songCount = role.sceneRoles.reduce((sum, sceneRole) => sum + sceneRole.songCount, 0);
      return {
        id: role.id,
        name: role.name,
        description: role.description,
        assignments: role.assignments,
        sceneCount: role.sceneRoles.length,
        lineCount,
        songCount,
        hasActor: role.assignments.length > 0
      };
    });

    return {
      roles: roleSummaries,
      actorMemberships,
      scenes: sceneSummaries,
      totals: {
        roles: roles.length,
        actorMemberships: actorMemberships.length,
        unassignedRoles: roleSummaries.filter((role) => !role.hasActor).length,
        scenesWithMissingSuggestions: sceneSummaries.filter((scene) => scene.missingSuggestedRoleIds.length > 0).length
      }
    };
  }

  private async getSceneCasting(productionId: string, sceneId: string) {
    await this.assertScene(productionId, sceneId);
    return this.prisma.scene.findUniqueOrThrow({
      where: { id: sceneId },
      include: { sceneRoles: { include: { role: true }, orderBy: { role: { name: "asc" } } } }
    });
  }

  private async recomputeProductionSceneRoles(productionId: string) {
    const sceneRoles = await this.prisma.sceneRole.findMany({
      where: { scene: { act: { script: { productionId } } } },
      include: { role: { select: { id: true, name: true } } }
    });
    const sceneIds = [...new Set(sceneRoles.map((sceneRole) => sceneRole.sceneId))];
    for (const sceneId of sceneIds) {
      const roles = sceneRoles.filter((sceneRole) => sceneRole.sceneId === sceneId).map((sceneRole) => sceneRole.role);
      const counts = await this.computeSceneRoleCounts(sceneId, roles);
      await this.prisma.$transaction(
        roles.map((role) =>
          this.prisma.sceneRole.update({
            where: { sceneId_roleId: { sceneId, roleId: role.id } },
            data: counts.get(role.id) ?? { lineCount: 0, songCount: 0 }
          })
        )
      );
    }
  }

  private async computeSceneRoleCounts(sceneId: string, roles: Array<{ id: string; name: string }>) {
    const blocks = await this.prisma.sceneBlock.findMany({
      where: { sceneId },
      select: { type: true, characterId: true, cueLabel: true }
    });
    const counts = new Map<string, RoleCount>();
    for (const role of roles) {
      counts.set(role.id, { lineCount: 0, songCount: 0 });
    }

    for (const block of blocks) {
      const matchedRole = roles.find(
        (role) => block.characterId === role.id || this.normalize(block.cueLabel) === this.normalize(role.name)
      );
      if (!matchedRole) {
        continue;
      }
      const count = counts.get(matchedRole.id) ?? { lineCount: 0, songCount: 0 };
      if (block.type === SceneBlockType.LYRIC) {
        count.songCount += 1;
      } else if (block.type === SceneBlockType.DIALOGUE) {
        count.lineCount += 1;
      }
      counts.set(matchedRole.id, count);
    }

    return counts;
  }

  private suggestRoleIdsForScene(blocks: Array<{ characterId: string | null; cueLabel: string | null }>, roles: Array<{ id: string; name: string }>) {
    const suggested = new Set<string>();
    for (const block of blocks) {
      if (block.characterId) {
        suggested.add(block.characterId);
        continue;
      }
      const matchedRole = roles.find((role) => this.normalize(role.name) === this.normalize(block.cueLabel));
      if (matchedRole) {
        suggested.add(matchedRole.id);
      }
    }
    return [...suggested];
  }

  private async assertMembership(productionId: string, user: RequestUser, roles: ProductionRole[]) {
    await assertProductionMembership(this.prisma, user, productionId, roles);
  }

  private async assertUniqueRoleName(productionId: string, name: string, exceptRoleId?: string) {
    const role = await this.prisma.role.findFirst({
      where: { productionId, name: { equals: name.trim(), mode: "insensitive" }, id: exceptRoleId ? { not: exceptRoleId } : undefined },
      select: { id: true }
    });
    if (role) {
      throw new ConflictException("같은 이름의 배역이 이미 있어요");
    }
  }

  private async assertRole(productionId: string, roleId: string) {
    const role = await this.prisma.role.findFirst({ where: { id: roleId, productionId } });
    if (!role) {
      throw new NotFoundException("배역을 찾을 수 없어요");
    }
    return role;
  }

  private async assertRolesInProduction(productionId: string, roleIds: string[]) {
    const uniqueIds = [...new Set(roleIds)];
    if (uniqueIds.length !== roleIds.length) {
      throw new BadRequestException("중복 배역이 포함되어 있어요");
    }
    const count = await this.prisma.role.count({ where: { id: { in: roleIds }, productionId } });
    if (count !== roleIds.length) {
      throw new BadRequestException("이 공연에 속하지 않는 배역이 포함되어 있어요");
    }
  }

  private async assertActorMembership(productionId: string, membershipId: string) {
    const membership = await this.prisma.membership.findFirst({
      where: { id: membershipId, productionId },
      include: { roles: true }
    });
    if (!membership) {
      throw new NotFoundException("공연 멤버를 찾을 수 없어요");
    }
    if (!membership.roles.some((role) => role.role === ProductionRole.ACTOR)) {
      throw new BadRequestException("ACTOR 역할이 있는 멤버만 배역에 배정할 수 있어요");
    }
  }

  private async assertScene(productionId: string, sceneId: string) {
    const scene = await this.prisma.scene.findFirst({
      where: { id: sceneId, act: { script: { productionId } } },
      select: { id: true }
    });
    if (!scene) {
      throw new NotFoundException("장을 찾을 수 없어요");
    }
    return scene;
  }

  private roleInclude(): Prisma.RoleInclude {
    return {
      assignments: { include: this.assignmentInclude(), orderBy: { kind: "asc" } },
      sceneRoles: { include: { scene: { select: { id: true, title: true } } } }
    };
  }

  private assignmentInclude(): Prisma.CastAssignmentInclude {
    return {
      membership: {
        include: {
          user: { select: { id: true, email: true, name: true, profileType: true, profileComplete: true } },
          roles: { select: { role: true } }
        }
      }
    };
  }

  private normalize(value: string | null | undefined) {
    return (value ?? "").trim().toLowerCase();
  }
}
