import { NotificationsService } from "./notifications.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { NotificationsGateway } from "./notifications.gateway";

describe("NotificationsService.createNotifications", () => {
  it("inserts N recipients with one query and emits to each user", async () => {
    const createManyAndReturn = jest.fn().mockImplementation(async ({ data }: { data: Array<Record<string, unknown>> }) =>
      [...data].reverse().map((row) => ({
        ...row,
        readAt: null,
        createdAt: new Date(),
        production: null
      }))
    );
    const create = jest.fn();
    const prisma = { notification: { createManyAndReturn, create } } as unknown as PrismaService;
    const emitNotificationCreated = jest.fn();
    const gateway = { emitNotificationCreated } as unknown as NotificationsGateway;
    const service = new NotificationsService(prisma, gateway);

    const result = await service.createNotifications([
      { userId: "u1", type: "board.notice_created", payload: { postId: "p" } },
      { userId: "u2", type: "board.notice_created", payload: { postId: "p" } },
      { userId: "u3", type: "board.notice_created", payload: { postId: "p" } },
      { userId: "u1", type: "board.notice_created", payload: { postId: "p" } }
    ]);

    expect(createManyAndReturn).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
    expect(result.map((item) => item.type)).toHaveLength(3);
    expect(emitNotificationCreated.mock.calls.map((call) => call[0])).toEqual(["u1", "u2", "u3"]);
  });

  it("does not query when there are no recipients", async () => {
    const createManyAndReturn = jest.fn();
    const prisma = { notification: { createManyAndReturn } } as unknown as PrismaService;
    const service = new NotificationsService(prisma, {} as NotificationsGateway);
    await expect(service.createNotifications([])).resolves.toEqual([]);
    expect(createManyAndReturn).not.toHaveBeenCalled();
  });
});
