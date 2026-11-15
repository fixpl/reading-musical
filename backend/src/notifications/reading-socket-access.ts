import { PlatformRole, ProductionRole } from "@prisma/client";
import type { PrismaService } from "../prisma/prisma.service";

const READING_OPERATOR_ROLES: readonly ProductionRole[] = [
  ProductionRole.PRODUCER,
  ProductionRole.DIRECTOR,
  ProductionRole.MUSIC_DIRECTOR,
  ProductionRole.STAGE_MANAGER
];

type ReadingUserAccess = {
  email: string;
  active: boolean;
  allowed: boolean;
};

export type ReadingSocketAccess = {
  productionId: string | null;
  users: Map<string, ReadingUserAccess>;
  guests: Map<string, { productionId: string; expiresAt: number }>;
};

/** 연결 시점의 room·역할을 신뢰하지 않고 전송 직전의 REST 접근 조건을 조회한다. */
export async function getReadingSocketAccess(
  prisma: PrismaService,
  eventId: string,
  userIds: string[],
  guestAccessIds: string[],
  now = Date.now()
): Promise<ReadingSocketAccess> {
  const event = await prisma.scheduleEvent.findFirst({
    where: { id: eventId, production: { deletedAt: null } },
    select: { productionId: true, production: { select: { organizationId: true } } }
  });
  const access: ReadingSocketAccess = { productionId: event?.productionId ?? null, users: new Map(), guests: new Map() };
  if (!event) return access;

  const [users, guests] = await Promise.all([
    userIds.length ? prisma.user.findMany({
      where: { id: { in: [...new Set(userIds)] } },
      select: {
        id: true,
        email: true,
        status: true,
        platformRole: true,
        organizationId: true,
        memberships: {
          where: { productionId: event.productionId },
          select: {
            roles: { select: { role: true } },
            attendances: { where: { eventId }, select: { id: true }, take: 1 }
          }
        }
      }
    }) : [],
    guestAccessIds.length ? prisma.guestReadingAccess.findMany({
      where: {
        id: { in: [...new Set(guestAccessIds)] },
        eventId,
        productionId: event.productionId,
        revokedAt: null,
        expiresAt: { gt: new Date(now) }
      },
      select: { id: true, productionId: true, expiresAt: true }
    }) : []
  ]);

  for (const user of users) {
    const active = user.status === "ACTIVE";
    const admin = user.platformRole === PlatformRole.SUPER_ADMIN || (
      user.platformRole === PlatformRole.ORG_ADMIN && Boolean(user.organizationId) &&
      user.organizationId === event.production.organizationId
    );
    const membership = user.memberships[0];
    const roles = membership?.roles.map(({ role }) => role) ?? [];
    const memberAllowed = roles.length > 0 && (
      roles.some((role) => READING_OPERATOR_ROLES.includes(role)) || Boolean(membership?.attendances.length)
    );
    access.users.set(user.id, { email: user.email, active, allowed: active && (admin || memberAllowed) });
  }
  for (const guest of guests) {
    access.guests.set(guest.id, { productionId: guest.productionId, expiresAt: guest.expiresAt.getTime() });
  }
  return access;
}
