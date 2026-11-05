import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ProductionRole } from "@prisma/client";
import { randomBytes } from "node:crypto";
import type { RequestUser } from "../common/types/request-user";
import { MailService } from "../mail/mail.service";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import { AddMembersDto, CreateInvitationDto, UpdateMemberDto } from "./dto";
import { ProductionAccessService } from "./production-access.service";
import { ProductionNotificationsService } from "./production-notifications.service";
import { normalizeRoles, rolesChanged } from "./production-shared.util";

/** 공연 멤버 추가/변경/해제와 초대 — productions.service.ts에서 분리. */
@Injectable()
export class ProductionMembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProductionAccessService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
    private readonly productionNotifications: ProductionNotificationsService
  ) {}

  async listMembers(productionId: string) {
    return this.prisma.membership.findMany({
      where: { productionId },
      orderBy: { createdAt: "asc" },
      include: this.access.memberInclude()
    });
  }

  async addMembers(productionId: string, dto: AddMembersDto, user: RequestUser) {
    await this.access.assertCanManageMembers(productionId, user);
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
            bodyText: this.productionNotifications.memberAddedEmailBody({
              productionTitle: production.title,
              recipientName: targetUser.name,
              roles,
              primaryRole: dto.primaryRole,
              productionUrl: `${this.productionNotifications.appPublicUrl()}/app/p/${productionId}`
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
    await this.access.assertCanManageMembers(productionId, user);
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
      const nextRoles = normalizeRoles(dto.roles, beforeRoles);
      const nextPrimaryRole = dto.primaryRole ?? (nextRoles.includes(membership.primaryRole) ? membership.primaryRole : nextRoles[0]);
      if (!nextRoles.includes(nextPrimaryRole)) {
        throw new BadRequestException("대표 역할은 역할 목록에 포함되어야 해요");
      }

      await this.access.assertProducerRemains(tx, productionId, membershipId, nextRoles);

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
        include: this.access.memberInclude()
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
        changed: membership.primaryRole !== nextPrimaryRole || rolesChanged(beforeRoles, nextRoles),
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
        bodyText: this.productionNotifications.memberRoleUpdatedEmailBody({
          productionTitle: updated.production.title,
          recipientName: updated.targetUser.name,
          beforeRoles: updated.beforeRoles,
          roles: updated.nextRoles,
          primaryRole: updated.nextPrimaryRole,
          actorName: user.name,
          productionUrl: `${this.productionNotifications.appPublicUrl()}/app/p/${productionId}`
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
    await this.access.assertCanManageMembers(productionId, user);
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
      await this.access.assertProducerRemains(tx, productionId, membershipId, []);

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
          bodyText: this.productionNotifications.memberRemovedEmailBody({
            productionTitle: removed.productionTitle,
            recipientName: removed.userName,
            roles: removed.roles,
            actorName: user.name,
            productionsUrl: `${this.productionNotifications.appPublicUrl()}/productions`
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
    const inviteUrl = `${this.productionNotifications.appPublicUrl()}/invite/${invitation.token}`;
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
}
