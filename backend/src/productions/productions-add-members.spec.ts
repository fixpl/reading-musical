import { BadRequestException } from "@nestjs/common";
import { ProductionRole } from "@prisma/client";
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import type { RequestUser } from "../common/types/request-user";
import { AddMembersDto } from "./dto";
import { ProductionAccessService } from "./production-access.service";
import { ProductionMembersService } from "./production-members.service";
import { ProductionNotificationsService } from "./production-notifications.service";

const admin = { id: "admin", platformRole: "SUPER_ADMIN", name: "운영자" } as RequestUser;
const USER_ID = "11111111-1111-4111-8111-111111111111";

function build(options: { existing: { id: string } | null; anotherProducer: boolean }) {
  const tx = {
    membership: {
      findUnique: jest.fn().mockResolvedValue(options.existing),
      upsert: jest.fn().mockResolvedValue({ id: "m1", userId: USER_ID }),
      findFirst: jest.fn()
    },
    membershipRole: {
      findFirst: jest.fn().mockResolvedValue(options.anotherProducer ? { id: "r" } : null),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      createMany: jest.fn().mockResolvedValue({ count: 1 })
    },
    activityLog: { create: jest.fn() }
  };
  const prisma = {
    production: { findUnique: jest.fn().mockResolvedValue({ id: "p1", title: "공연", organizationId: null }) },
    user: { findMany: jest.fn().mockResolvedValue([{ id: USER_ID, email: "a@b.c", name: "가", status: "ACTIVE" }]) },
    $transaction: jest.fn((fn: (client: typeof tx) => unknown, opts?: unknown) => {
      void opts;
      return fn(tx);
    })
  };
  const mail = { queueEmail: jest.fn(), fromEmail: jest.fn() };
  const notifications = { createNotifications: jest.fn() };
  const productionNotifications = new ProductionNotificationsService(prisma as never, {} as never, mail as never, notifications as never);
  const service = new ProductionMembersService(prisma as never, new ProductionAccessService(prisma as never), mail as never, notifications as never, productionNotifications);
  return { service, tx, prisma };
}

const dto = (roles: ProductionRole[]) =>
  ({ userIds: [USER_ID], roles, primaryRole: roles[0], sendNotification: false }) as AddMembersDto;

describe("ProductionMembersService.addMembers", () => {
  it("rejects stripping the last producer from an existing member", async () => {
    const { service, tx } = build({ existing: { id: "m1" }, anotherProducer: false });
    await expect(service.addMembers("p1", dto([ProductionRole.ACTOR]), admin)).rejects.toThrow(BadRequestException);
    expect(tx.membershipRole.deleteMany).not.toHaveBeenCalled();
  });

  it("allows changing an existing member when another producer remains, with a 20s timeout", async () => {
    const { service, tx, prisma } = build({ existing: { id: "m1" }, anotherProducer: true });
    await expect(service.addMembers("p1", dto([ProductionRole.ACTOR]), admin)).resolves.toEqual({ count: 1 });
    expect(tx.membershipRole.deleteMany).toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 20000 });
  });

  it("does not check producers for brand-new members", async () => {
    const { service, tx } = build({ existing: null, anotherProducer: false });
    await service.addMembers("p1", dto([ProductionRole.ACTOR]), admin);
    expect(tx.membershipRole.findFirst).not.toHaveBeenCalled();
  });
});

describe("AddMembersDto", () => {
  const check = (userIds: string[]) =>
    validate(plainToInstance(AddMembersDto, { userIds, roles: ["ACTOR"], primaryRole: "ACTOR" }));

  it("accepts uuid ids", async () => {
    expect(await check([USER_ID])).toHaveLength(0);
  });
  it("rejects non-uuid ids and more than 200 ids", async () => {
    expect(await check(["not-a-uuid"])).not.toHaveLength(0);
    const many = Array.from({ length: 201 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(await check(many)).not.toHaveLength(0);
  });
});
