import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { BoardService } from "./board.service";
import { CreateBoardPostDto, ListBoardPostsDto, UpdateBoardPostDto } from "./dto";
import type { PrismaService } from "../prisma/prisma.service";
import type { NotificationsGateway } from "../notifications/notifications.gateway";
import type { RequestUser } from "../common/types/request-user";

const actor: RequestUser = { id: "actor", email: "actor@example.test", name: "배우", platformRole: "MEMBER" };
const memo = { channel: "REHEARSAL" as const, body: "첫 대사 전 두 박자", source: "composition", unitKey: "section:part", positionMs: 3000, contextLabel: "항구" };
const saved = { ...memo, id: "post", productionId: "show", authorId: "actor", category: "QUESTION", title: memo.body, pinned: false, visibility: "PRIVATE", status: "OPEN", revision: 1 };

function fixture() {
  const prisma = {
    production: { findFirst: jest.fn().mockResolvedValue({ id: "show" }), findUnique: jest.fn().mockResolvedValue({ organizationId: "org" }) },
    user: { findUnique: jest.fn().mockResolvedValue({ organizationId: "org" }), findMany: jest.fn().mockResolvedValue([{ id: "actor" }, { id: "staff" }, { id: "admin" }]) },
    membership: { findUnique: jest.fn().mockResolvedValue({ id: "membership" }), findFirst: jest.fn().mockResolvedValue(null) },
    script: { findFirst: jest.fn().mockResolvedValue(null) },
    performanceSection: { findFirst: jest.fn().mockResolvedValue({ id: "part" }) },
    scene: { findFirst: jest.fn().mockResolvedValue(null) },
    trackCue: { findFirst: jest.fn().mockResolvedValue(null) },
    boardPost: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(saved), create: jest.fn().mockResolvedValue(saved), updateMany: jest.fn().mockResolvedValue({ count: 1 }), findUniqueOrThrow: jest.fn().mockResolvedValue(saved), deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    boardComment: { create: jest.fn().mockResolvedValue({ id: "reply" }), findFirst: jest.fn().mockResolvedValue({ id: "reply", authorId: "actor" }), delete: jest.fn() },
    $transaction: jest.fn()
  };
  prisma.$transaction.mockImplementation((work) => work(prisma));
  const gateway = { emitBoardChanged: jest.fn() };
  return { prisma, gateway, service: new BoardService(prisma as unknown as PrismaService, gateway as unknown as NotificationsGateway) };
}

describe("performance community and time memo boundaries", () => {
  test("default public feed cannot include private notes", async () => {
    const { service, prisma } = fixture();
    await service.list("show", {}, actor);
    expect(prisma.boardPost.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ productionId: "show", visibility: "TEAM" }), take: 61 }));
  });
  test("combined and private feeds are scoped to this caller, including administrators", async () => {
    const { service, prisma } = fixture();
    await service.list("show", { visibility: "ALL", source: "composition" }, { ...actor, platformRole: "SUPER_ADMIN" });
    expect(prisma.boardPost.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ source: "composition", OR: [{ visibility: "TEAM" }, { visibility: "PRIVATE", authorId: "actor" }] }) }));
    await service.list("show", { visibility: "PRIVATE" }, { ...actor, id: "admin", platformRole: "SUPER_ADMIN" });
    expect(prisma.boardPost.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ visibility: "PRIVATE", authorId: "admin" }) }));
  });
  test("get, write and comment routes all use the parent privacy predicate", async () => {
    const { service, prisma } = fixture();
    prisma.boardPost.findFirst.mockResolvedValue(null);
    const user = { ...actor, id: "admin", platformRole: "SUPER_ADMIN" as const };
    await expect(service.get("show", "post", user)).rejects.toMatchObject({ status: 404 });
    await expect(service.update("show", "post", { body: "changed" }, user)).rejects.toMatchObject({ status: 404 });
    await expect(service.addComment("show", "post", { body: "reply" }, user)).rejects.toMatchObject({ status: 404 });
    await expect(service.removeComment("show", "post", "reply", user)).rejects.toMatchObject({ status: 404 });
    await expect(service.remove("show", "post", user)).rejects.toMatchObject({ status: 404 });
    expect(prisma.boardPost.findFirst).toHaveBeenLastCalledWith({ where: { id: "post", productionId: "show", OR: [{ visibility: "TEAM" }, { visibility: "PRIVATE", authorId: "admin" }] } });
    expect(prisma.boardComment.create).not.toHaveBeenCalled();
  });
  test("unassigned accounts cannot access community, including foreign organization administrators", async () => {
    const { service, prisma } = fixture();
    prisma.membership.findUnique.mockResolvedValue(null);
    await expect(service.list("show", {}, actor)).rejects.toMatchObject({ status: 403 });
    // 조직에 관계없이 배정된 회원은 참여하므로 미배정 계정의 차단을 확인한다.
    prisma.user.findUnique.mockResolvedValue({ organizationId: "other-org" });
    await expect(service.list("show", {}, { ...actor, platformRole: "ORG_ADMIN" })).rejects.toMatchObject({ status: 403 });
    expect(prisma.boardPost.findMany).not.toHaveBeenCalled();
  });
  test("new anchored notes default private and send invalidation only to the author", async () => {
    const { service, prisma, gateway } = fixture();
    await service.create("show", memo, actor);
    expect(prisma.boardPost.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ visibility: "PRIVATE", positionMs: 3000, unitKey: "section:part", authorId: "actor" }) }));
    expect(gateway.emitBoardChanged).toHaveBeenCalledWith(["actor"], "show", "post");
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
  test("partial context and foreign/deleted sections or scripts are rejected", async () => {
    const { service, prisma } = fixture();
    await expect(service.create("show", { body: "memo", positionMs: 0 }, actor)).rejects.toMatchObject({ status: 400 });
    prisma.performanceSection.findFirst.mockResolvedValue(null);
    await expect(service.create("show", memo, actor)).rejects.toMatchObject({ status: 400 });
    await expect(service.create("show", { ...memo, source: "foreign-script", unitKey: "overview" }, actor)).rejects.toMatchObject({ status: 400 });
    expect(prisma.boardPost.create).not.toHaveBeenCalled();
  });
  test("actors may chat without a title, but cannot publish notices", async () => {
    const { service, prisma } = fixture();
    await service.create("show", { body: "내일 리딩 준비했습니다." }, actor);
    expect(prisma.boardPost.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ title: "내일 리딩 준비했습니다.", visibility: "TEAM", channel: "GENERAL" }) }));
    await expect(service.create("show", { body: "공지", title: "알림", channel: "NOTICE" }, actor)).rejects.toMatchObject({ status: 403 });
    await expect(service.create("show", { body: "자료", channel: "MATERIAL" }, actor)).rejects.toMatchObject({ status: 400 });
  });
  test("only the author may change a memo's visibility", async () => {
    const { service, prisma } = fixture();
    prisma.boardPost.findFirst.mockResolvedValue({ ...saved, visibility: "TEAM" });
    await expect(service.update("show", "post", { visibility: "PRIVATE" }, { ...actor, id: "admin", platformRole: "SUPER_ADMIN" })).rejects.toMatchObject({ status: 403 });
    expect(prisma.boardPost.updateMany).not.toHaveBeenCalled();
  });
  test("stale edits and concurrent privacy changes reject replies without persisting", async () => {
    const { service, prisma } = fixture();
    prisma.boardPost.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.update("show", "post", { body: "edit", expectedRevision: 1 }, actor)).rejects.toMatchObject({ status: 409 });
    await expect(service.addComment("show", "post", { body: "reply" }, actor)).rejects.toMatchObject({ status: 409 });
    expect(prisma.boardComment.create).not.toHaveBeenCalled();
  });
  test("unsharing invalidates former readers to remove their cached copy", async () => {
    const { service, prisma, gateway } = fixture();
    prisma.boardPost.findFirst.mockResolvedValue({ ...saved, visibility: "TEAM" });
    await service.update("show", "post", { visibility: "PRIVATE", expectedRevision: 1 }, actor);
    expect(gateway.emitBoardChanged).toHaveBeenCalledWith(["actor", "staff", "admin"], "show", "post");
  });
  test("a failed socket broadcast does not turn a saved message into a failed request", async () => {
    const { service, gateway } = fixture();
    gateway.emitBoardChanged.mockImplementation(() => { throw new Error("offline"); });
    await expect(service.create("show", memo, actor)).resolves.toMatchObject({ id: "post" });
  });
});

describe("community input validation", () => {
  test.each([{ body: "   " }, { body: "valid", visibility: "PUBLIC" }, { body: "valid", positionMs: -1 }, { body: "valid", positionMs: 1.5 }, { body: "valid", channel: null }])("rejects invalid create input %j", async (input) => {
    expect((await validate(plainToInstance(CreateBoardPostDto, input))).length).toBeGreaterThan(0);
  });
  test("rejects null visibility and unbounded pagination", async () => {
    expect((await validate(plainToInstance(UpdateBoardPostDto, { visibility: null }))).length).toBeGreaterThan(0);
    expect((await validate(plainToInstance(ListBoardPostsDto, { limit: "1000" }))).length).toBeGreaterThan(0);
    expect((await validate(plainToInstance(ListBoardPostsDto, { category: "INVALID" }))).length).toBeGreaterThan(0);
  });
});
