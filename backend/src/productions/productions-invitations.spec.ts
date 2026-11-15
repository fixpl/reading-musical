import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type { RequestUser } from "../common/types/request-user";
import { ProductionAccessService } from "./production-access.service";
import { ProductionMembersService } from "./production-members.service";
import { ProductionNotificationsService } from "./production-notifications.service";

const DAY = 24 * 60 * 60 * 1000;
const admin = { id: "admin", email: "admin@x.io", platformRole: "SUPER_ADMIN", name: "운영자" } as RequestUser;
const invitee = { id: "u2", email: "Guest@X.io", platformRole: "MEMBER", name: "손님" } as RequestUser;

type InvitationRow = {
  id: string;
  productionId: string;
  email: string;
  role: string;
  token: string;
  status: string;
  expiresAt: Date;
  createdAt?: Date;
  production?: { id: string; title: string };
};

function row(overrides: Partial<InvitationRow> = {}): InvitationRow {
  return {
    id: "i1",
    productionId: "p1",
    email: "guest@x.io",
    role: "ACTOR",
    token: "tok",
    status: "PENDING",
    expiresAt: new Date(Date.now() + DAY),
    production: { id: "p1", title: "공연" },
    ...overrides
  };
}

function build(options: { invitation?: InvitationRow | null; production?: { id: string; title: string } | null; alreadyMember?: boolean } = {}) {
  const invitation = options.invitation === undefined ? row() : options.invitation;
  const tx = {
    invitation: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    membership: { upsert: jest.fn().mockResolvedValue({ id: "m1" }) },
    membershipRole: { upsert: jest.fn().mockResolvedValue({}) }
  };
  const prisma = {
    production: { findUnique: jest.fn().mockResolvedValue(options.production === undefined ? { id: "p1", title: "공연" } : options.production) },
    membership: {
      findFirst: jest.fn().mockResolvedValue(options.alreadyMember ? { id: "m0" } : null),
      upsert: jest.fn().mockResolvedValue({ id: "m1" })
    },
    membershipRole: { upsert: jest.fn().mockResolvedValue({}) },
    invitation: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn((args: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: "i-new", status: "PENDING", createdAt: new Date(), ...args.data })
      ),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(invitation),
      findUnique: jest.fn().mockResolvedValue(invitation),
      update: jest.fn().mockResolvedValue({})
    },
    activityLog: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn((fn: (client: typeof tx) => Promise<unknown>) => fn(tx))
  };
  const mail = {
    queueEmail: jest.fn().mockResolvedValue({ id: "d1", status: "QUEUED" }),
    fromEmail: jest.fn().mockReturnValue("noreply@x.io")
  };
  const notifications = { createNotification: jest.fn().mockResolvedValue({}) };
  const config = { get: jest.fn().mockReturnValue("https://app.example.com/") };
  const productionNotifications = new ProductionNotificationsService(prisma as never, config as never, mail as never, notifications as never);
  const service = new ProductionMembersService(prisma as never, new ProductionAccessService(prisma as never), mail as never, notifications as never, productionNotifications);
  return { service, prisma, tx, mail, notifications };
}

describe("ProductionMembersService invitations", () => {
  describe("createInvitation", () => {
    it("normalizes the email, creates a ~72h invitation and queues a mail with the invite link", async () => {
      const { service, prisma, mail } = build();
      const before = Date.now();
      const result = await service.createInvitation("p1", { email: "  Guest@X.io ", role: "ACTOR" } as never, admin);

      const data = prisma.invitation.create.mock.calls[0][0].data as { token: string; expiresAt: Date };
      expect(data).toMatchObject({ productionId: "p1", email: "guest@x.io", role: "ACTOR" });
      expect(data.token.length).toBeGreaterThanOrEqual(30);
      const ttl = data.expiresAt.getTime() - before;
      expect(ttl).toBeGreaterThan(72 * 60 * 60 * 1000 - 5000);
      expect(ttl).toBeLessThan(72 * 60 * 60 * 1000 + 5000);

      expect(result.inviteUrl).toBe(`https://app.example.com/invite/${data.token}`);
      expect(mail.queueEmail).toHaveBeenCalledWith(expect.objectContaining({ toEmail: "guest@x.io", templateKey: "production.invitation", productionId: "p1" }));
      expect(prisma.activityLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "production.invitation.create" }) }));
      expect(result).toMatchObject({ emailDeliveryId: "d1", emailDeliveryStatus: "QUEUED" });
    });

    it("revokes earlier pending invitations for the same email before creating", async () => {
      const { service, prisma } = build();
      await service.createInvitation("p1", { email: "guest@x.io", role: "ACTOR" } as never);
      expect(prisma.invitation.updateMany).toHaveBeenCalledWith({ where: { productionId: "p1", email: "guest@x.io", status: "PENDING" }, data: { status: "REVOKED" } });
      expect(prisma.invitation.updateMany.mock.invocationCallOrder[0]).toBeLessThan(prisma.invitation.create.mock.invocationCallOrder[0]);
      expect(prisma.activityLog.create).not.toHaveBeenCalled(); // no actor => no log
    });

    it("rejects an unknown production", async () => {
      const { service, prisma } = build({ production: null });
      await expect(service.createInvitation("p1", { email: "a@b.c", role: "ACTOR" } as never)).rejects.toThrow(NotFoundException);
      expect(prisma.invitation.create).not.toHaveBeenCalled();
    });

    it("rejects a blank email", async () => {
      const { service } = build();
      await expect(service.createInvitation("p1", { email: "   ", role: "ACTOR" } as never)).rejects.toThrow(BadRequestException);
    });

    it("rejects inviting someone who is already a member", async () => {
      const { service, prisma, mail } = build({ alreadyMember: true });
      await expect(service.createInvitation("p1", { email: "guest@x.io", role: "ACTOR" } as never)).rejects.toThrow(BadRequestException);
      expect(prisma.invitation.create).not.toHaveBeenCalled();
      expect(mail.queueEmail).not.toHaveBeenCalled();
    });
  });

  describe("listInvitations", () => {
    it("lists only unexpired pending invitations with invite urls", async () => {
      const { service, prisma } = build();
      prisma.invitation.findMany.mockResolvedValue([row({ createdAt: new Date() })]);
      const result = await service.listInvitations("p1");
      const where = prisma.invitation.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({ productionId: "p1", status: "PENDING" });
      expect(where.expiresAt.gt).toBeInstanceOf(Date);
      expect(result[0].inviteUrl).toBe("https://app.example.com/invite/tok");
    });
  });

  describe("revokeInvitation", () => {
    it("revokes a pending invitation scoped to the production", async () => {
      const { service, prisma } = build();
      await expect(service.revokeInvitation("p1", "i1", admin)).resolves.toEqual({ id: "i1", status: "REVOKED" });
      expect(prisma.invitation.findFirst).toHaveBeenCalledWith({ where: { id: "i1", productionId: "p1" } });
      expect(prisma.invitation.update).toHaveBeenCalledWith({ where: { id: "i1" }, data: { status: "REVOKED" } });
      expect(prisma.activityLog.create).toHaveBeenCalled();
    });

    it("404s for an invitation of another production", async () => {
      const { service, prisma } = build({ invitation: null });
      await expect(service.revokeInvitation("p1", "i1")).rejects.toThrow(NotFoundException);
      expect(prisma.invitation.update).not.toHaveBeenCalled();
    });

    it.each(["ACCEPTED", "REVOKED", "EXPIRED"])("rejects an already %s invitation", async (status) => {
      const { service, prisma } = build({ invitation: row({ status }) });
      await expect(service.revokeInvitation("p1", "i1")).rejects.toThrow(BadRequestException);
      expect(prisma.invitation.update).not.toHaveBeenCalled();
    });
  });

  describe("getInvitation", () => {
    it("404s for an unknown token", async () => {
      const { service } = build({ invitation: null });
      await expect(service.getInvitation("nope")).rejects.toThrow(NotFoundException);
    });

    it("reports a pending-but-past-expiry invitation as EXPIRED", async () => {
      const { service } = build({ invitation: row({ expiresAt: new Date(Date.now() - 1000) }) });
      await expect(service.getInvitation("tok")).resolves.toMatchObject({ status: "EXPIRED", expired: true });
    });

    it("reports a live pending invitation as PENDING", async () => {
      const { service } = build();
      await expect(service.getInvitation("tok")).resolves.toMatchObject({ status: "PENDING", expired: false });
    });

    it("does not expose the token or internal ids beyond the production summary", async () => {
      const { service } = build();
      const result = await service.getInvitation("tok");
      expect(result).not.toHaveProperty("token");
    });
  });

  describe("acceptInvitation", () => {
    it("creates membership and role, marks ACCEPTED and notifies (email compared case-insensitively)", async () => {
      const { service, prisma, tx, notifications } = build();
      const result = await service.acceptInvitation("tok", invitee);
      expect(tx.membership.upsert).toHaveBeenCalledWith(expect.objectContaining({
        where: { userId_productionId: { userId: "u2", productionId: "p1" } },
        create: { userId: "u2", productionId: "p1", primaryRole: "ACTOR" }
      }));
      expect(tx.membershipRole.upsert).toHaveBeenCalledWith(expect.objectContaining({
        where: { membershipId_role: { membershipId: "m1", role: "ACTOR" } }
      }));
      expect(tx.invitation.updateMany).toHaveBeenCalledWith({ where: { id: "i1", status: "PENDING" }, data: { status: "ACCEPTED" } });
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function));
      expect(prisma.membership.upsert).not.toHaveBeenCalled();
      expect(prisma.membershipRole.upsert).not.toHaveBeenCalled();
      expect(prisma.invitation.update).not.toHaveBeenCalled();
      expect(notifications.createNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: "u2", productionId: "p1" }));
      expect(result).toMatchObject({ ok: true, productionId: "p1", membershipId: "m1", role: "ACTOR", next: "/app/p/p1" });
    });

    it("accepts only once when concurrent requests both read a pending invitation", async () => {
      const { service, prisma, tx, notifications } = build();
      let status = "PENDING";
      tx.invitation.updateMany.mockImplementation(async () => {
        if (status !== "PENDING") return { count: 0 };
        status = "ACCEPTED";
        return { count: 1 };
      });

      const results = await Promise.allSettled([
        service.acceptInvitation("tok", invitee),
        service.acceptInvitation("tok", invitee)
      ]);

      expect(prisma.invitation.findUnique).toHaveBeenCalledTimes(2);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((result) => result.status === "rejected");
      expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(BadRequestException);
      expect(tx.membership.upsert).toHaveBeenCalledTimes(1);
      expect(tx.membershipRole.upsert).toHaveBeenCalledTimes(1);
      expect(notifications.createNotification).toHaveBeenCalledTimes(1);
    });

    it("fails inside the transaction without notifying when membership role creation fails", async () => {
      const { service, prisma, tx, notifications } = build();
      const error = new Error("membership role failure");
      tx.membershipRole.upsert.mockRejectedValue(error);

      await expect(service.acceptInvitation("tok", invitee)).rejects.toBe(error);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.invitation.updateMany).toHaveBeenCalledTimes(1);
      expect(tx.membership.upsert).toHaveBeenCalledTimes(1);
      expect(prisma.invitation.update).not.toHaveBeenCalled();
      expect(prisma.membership.upsert).not.toHaveBeenCalled();
      expect(notifications.createNotification).not.toHaveBeenCalled();
    });

    it("404s for an unknown token", async () => {
      const { service } = build({ invitation: null });
      await expect(service.acceptInvitation("nope", invitee)).rejects.toThrow(NotFoundException);
    });

    it.each(["ACCEPTED", "REVOKED", "EXPIRED"])("rejects an invitation that is already %s", async (status) => {
      const { service, prisma } = build({ invitation: row({ status }) });
      await expect(service.acceptInvitation("tok", invitee)).rejects.toThrow(BadRequestException);
      expect(prisma.membership.upsert).not.toHaveBeenCalled();
    });

    it("marks an expired pending invitation EXPIRED and refuses it", async () => {
      const { service, prisma } = build({ invitation: row({ expiresAt: new Date(Date.now() - 1000) }) });
      await expect(service.acceptInvitation("tok", invitee)).rejects.toThrow(BadRequestException);
      expect(prisma.invitation.update).toHaveBeenCalledWith({ where: { id: "i1" }, data: { status: "EXPIRED" } });
      expect(prisma.membership.upsert).not.toHaveBeenCalled();
    });

    it("rejects a logged-in user whose email differs from the invited one", async () => {
      const { service, prisma } = build();
      await expect(service.acceptInvitation("tok", { ...invitee, email: "other@x.io" })).rejects.toThrow(ForbiddenException);
      expect(prisma.membership.upsert).not.toHaveBeenCalled();
      expect(prisma.invitation.update).not.toHaveBeenCalled();
    });
  });
});
