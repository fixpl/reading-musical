import { ForbiddenException } from "@nestjs/common";
import type { RequestUser } from "../common/types/request-user";
import { AdminService } from "./admin.service";

function service(target: { organizationId: string; platformRole: string } | null) {
  const prisma = {
    user: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === "actor" ? { organizationId: "org" } : target)
      )
    }
  };
  return new AdminService(prisma as never, {} as never, {} as never, {} as never);
}
const orgAdmin = { id: "actor", platformRole: "ORG_ADMIN" } as RequestUser;
const assertAccess = (s: AdminService, actor: RequestUser) =>
  (s as unknown as { assertOrgMemberAccess(id: string, a: RequestUser): Promise<void> }).assertOrgMemberAccess("target", actor);

describe("AdminService.assertOrgMemberAccess", () => {
  it("blocks ORG_ADMIN from acting on ORG_ADMIN or SUPER_ADMIN of the same organization", async () => {
    await expect(assertAccess(service({ organizationId: "org", platformRole: "ORG_ADMIN" }), orgAdmin)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(assertAccess(service({ organizationId: "org", platformRole: "SUPER_ADMIN" }), orgAdmin)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it("allows ORG_ADMIN to act on a MEMBER of the same organization and SUPER_ADMIN on anyone", async () => {
    await expect(assertAccess(service({ organizationId: "org", platformRole: "MEMBER" }), orgAdmin)).resolves.toBeUndefined();
    await expect(assertAccess(service({ organizationId: "other", platformRole: "ORG_ADMIN" }), { id: "root", platformRole: "SUPER_ADMIN" } as RequestUser)).resolves.toBeUndefined();
  });
});
