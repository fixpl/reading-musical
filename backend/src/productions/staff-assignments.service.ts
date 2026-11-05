import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ProductionRole, StaffDiscipline } from "@prisma/client";
import type { RequestUser } from "../common/types/request-user";
import { PrismaService } from "../prisma/prisma.service";
import { PutStaffAssignmentsDto } from "./dto";
import { ProductionActivityLogService } from "./production-activity-log.service";

/** 공연 멤버의 스태프 직무(StaffAssignment) 조회/교체 — productions.service.ts에서 분리. */
@Injectable()
export class StaffAssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ProductionActivityLogService
  ) {}

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
      await this.activityLog.log({
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

  private serializeStaffAssignments(assignments: Awaited<ReturnType<StaffAssignmentsService["listStaffAssignments"]>>) {
    return assignments.map((assignment) => ({
      id: assignment.id,
      discipline: assignment.discipline,
      assignmentKey: assignment.assignmentKey,
      customLabel: assignment.customLabel,
      isLead: assignment.isLead,
      note: assignment.note
    }));
  }
}
