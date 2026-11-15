import { ForbiddenException } from "@nestjs/common";
import { BoardService } from "./board.service";
import type { RequestUser } from "../common/types/request-user";

const user = { id: "org-a-admin", email: "member@example.test", name: "참여자", platformRole: "ORG_ADMIN" } as RequestUser;

function fixture(ownOrganization = false, assigned = true) {
  const prisma = {
    production: {
      findFirst: jest.fn().mockResolvedValue({ id: "show-b" }),
      findUnique: jest.fn().mockResolvedValue({ organizationId: ownOrganization ? "org-a" : "org-b" })
    },
    user: { findUnique: jest.fn().mockResolvedValue({ organizationId: "org-a" }) },
    membership: {
      findUnique: jest.fn().mockResolvedValue(assigned ? { id: "member" } : null),
      findFirst: jest.fn().mockResolvedValue(null)
    },
    boardPost: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue({ id: "post", authorId: "other-author", visibility: "TEAM", revision: 1 }),
      create: jest.fn(), updateMany: jest.fn(), deleteMany: jest.fn()
    }
  };
  return { prisma, service: new BoardService(prisma as never, {} as never) };
}

describe("다른 조직 운영자의 공연팀 게시판 참여", () => {
  it("공연에 배정돼 있으면 팀 게시판을 조회한다", async () => {
    const { service, prisma } = fixture();
    await expect(service.list("show-b", {}, user)).resolves.toEqual({ items: [], nextCursor: null });
    expect(prisma.membership.findUnique).toHaveBeenCalledWith({ where: { userId_productionId: { userId: user.id, productionId: "show-b" } }, select: { id: true } });
  });

  it("배정되지 않은 다른 조직 운영자는 거절한다", async () => {
    const { service, prisma } = fixture(false, false);
    await expect(service.list("show-b", {}, user)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.boardPost.findMany).not.toHaveBeenCalled();
  });

  it("소속 조직 운영자는 멤버 배정 없이 기존처럼 조회한다", async () => {
    const { service, prisma } = fixture(true, false);
    await service.list("show-b", {}, user);
    expect(prisma.membership.findUnique).not.toHaveBeenCalled();
    expect(prisma.boardPost.findMany).toHaveBeenCalled();
  });

  it("전체 보기와 나만 보기에서도 다른 사람의 개인 메모를 포함하지 않는다", async () => {
    const { service, prisma } = fixture();
    await service.list("show-b", { visibility: "ALL" }, user);
    expect(prisma.boardPost.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ OR: [{ visibility: "TEAM" }, { visibility: "PRIVATE", authorId: user.id }] }) }));
    await service.list("show-b", { visibility: "PRIVATE" }, user);
    expect(prisma.boardPost.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ visibility: "PRIVATE", authorId: user.id }) }));
  });

  it("공연 제작진 역할이 없으면 공지 작성이나 다른 사람의 글 수정·삭제는 거절한다", async () => {
    const { service, prisma } = fixture();
    await expect(service.create("show-b", { channel: "NOTICE", title: "공지", body: "내용" }, user)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.update("show-b", "post", { body: "수정" }, user)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.remove("show-b", "post", user)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.boardPost.create).not.toHaveBeenCalled();
    expect(prisma.boardPost.updateMany).not.toHaveBeenCalled();
    expect(prisma.boardPost.deleteMany).not.toHaveBeenCalled();
  });
});
