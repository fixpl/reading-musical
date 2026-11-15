import { BoardService } from "./board.service";

const staff = { id: "staff", email: "s@x.test", name: "연출", platformRole: "SUPER_ADMIN" } as never;
const actor = { id: "actor", email: "a@x.test", name: "배우", platformRole: "MEMBER" } as never;

function fixture() {
  const created = { id: "post", productionId: "show", authorId: "staff", category: "NOTICE", channel: "NOTICE", visibility: "TEAM", title: "리허설 시간 변경", revision: 1 };
  const prisma = {
    production: { findFirst: jest.fn().mockResolvedValue({ id: "show" }), findUnique: jest.fn().mockResolvedValue({ title: "따뜻한 것들의 무게", organizationId: "org" }) },
    user: { findUnique: jest.fn().mockResolvedValue({ organizationId: "org" }), findMany: jest.fn().mockImplementation(async ({ where }) => (where.id?.in ?? []).map((id: string) => ({ id }))) },
    membership: { findMany: jest.fn().mockResolvedValue([{ userId: "actor" }, { userId: "staff2" }]), findFirst: jest.fn().mockResolvedValue({ id: "m" }), findUnique: jest.fn().mockResolvedValue({ id: "m" }) },
    boardPost: { create: jest.fn().mockResolvedValue(created), findFirst: jest.fn().mockResolvedValue({ ...created, authorId: "author", category: "QUESTION", channel: "GENERAL", title: "질문" }), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    boardComment: { create: jest.fn().mockResolvedValue({ id: "c2" }), findMany: jest.fn().mockResolvedValue([{ authorId: "earlier" }, { authorId: "actor" }]) },
    $transaction: jest.fn()
  };
  prisma.$transaction.mockImplementation((work: (tx: typeof prisma) => unknown) => work(prisma));
  const notifications = { createNotifications: jest.fn().mockResolvedValue([]) };
  return { prisma, notifications, service: new BoardService(prisma as never, { emitBoardChanged: jest.fn() } as never, notifications as never) };
}

describe("community notifications", () => {
  test("a new team notice reaches every other active member", async () => {
    const { service, notifications, prisma } = fixture();
    await service.create("show", { channel: "NOTICE", title: "리허설 시간 변경", body: "내일 7시" } as never, staff);
    expect(prisma.membership.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: { not: "staff" }, user: { status: "ACTIVE" } }) }));
    const sent = notifications.createNotifications.mock.calls[0][0];
    expect(sent.map((item: { userId: string }) => item.userId)).toEqual(["actor", "staff2"]);
    expect(sent[0]).toMatchObject({ type: "board.notice_created", payload: { postId: "post", postTitle: "리허설 시간 변경", authorName: "연출" } });
  });

  test("a comment notifies the post author and earlier commenters, never the commenter", async () => {
    const { service, notifications } = fixture();
    await service.addComment("show", "post", { body: "확인했습니다" } as never, actor);
    const sent = notifications.createNotifications.mock.calls[0][0] as Array<{ userId: string; payload: { mine: boolean } }>;
    expect(sent.map((item) => item.userId).sort()).toEqual(["author", "earlier"]);
    expect(sent.find((item) => item.userId === "author")!.payload.mine).toBe(true);
  });

  test("a failing notification never fails the saved post", async () => {
    const { service, notifications } = fixture();
    notifications.createNotifications.mockRejectedValue(new Error("db down"));
    await expect(service.create("show", { channel: "NOTICE", title: "공지", body: "내용" } as never, staff)).resolves.toMatchObject({ id: "post" });
  });
});
