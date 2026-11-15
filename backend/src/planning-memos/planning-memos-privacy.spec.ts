import { PlanningMemosService } from "./planning-memos.service";
import type { RequestUser } from "../common/types/request-user";

const viewer: RequestUser = { id: "viewer", email: "viewer@example.test", name: "참여자", platformRole: "ORG_ADMIN" };

function fixture(options: { ownOrganization?: boolean; authorId?: string } = {}) {
  const memo = { id: "memo", productionId: "production", authorId: options.authorId ?? "other" };
  const prisma = {
    planningMemo: { findFirst: jest.fn().mockResolvedValue(memo), update: jest.fn().mockResolvedValue(memo), delete: jest.fn().mockResolvedValue(memo) },
    production: { findUnique: jest.fn().mockResolvedValue({ organizationId: "production-org" }) },
    user: { findUnique: jest.fn().mockResolvedValue({ organizationId: options.ownOrganization ? "production-org" : "other-org" }) }
  };
  return { service: new PlanningMemosService(prisma as never), prisma };
}

describe("기획 메모의 작성자·공연 조직 권한", () => {
  it.each(["update", "remove"] as const)("다른 조직 운영자의 타인 메모 %s를 거절한다", async (action) => {
    const { service, prisma } = fixture();
    const result = action === "update" ? service.update("production", "memo", { body: "변경" }, viewer) : service.remove("production", "memo", viewer);
    await expect(result).rejects.toMatchObject({ status: 403 });
    expect(prisma.planningMemo.update).not.toHaveBeenCalled();
    expect(prisma.planningMemo.delete).not.toHaveBeenCalled();
  });

  it.each([
    { ownOrganization: true, user: viewer },
    { authorId: viewer.id, user: viewer },
    { user: { ...viewer, platformRole: "SUPER_ADMIN" as const } }
  ])("작성자·해당 조직 운영자·플랫폼 관리자는 수정과 삭제를 유지한다", async ({ user, ...options }) => {
    const { service, prisma } = fixture(options);
    await expect(service.update("production", "memo", { body: "변경" }, user)).resolves.toMatchObject({ id: "memo" });
    await expect(service.remove("production", "memo", user)).resolves.toEqual({ ok: true });
    expect(prisma.planningMemo.update).toHaveBeenCalledTimes(1);
    expect(prisma.planningMemo.delete).toHaveBeenCalledTimes(1);
  });
});
