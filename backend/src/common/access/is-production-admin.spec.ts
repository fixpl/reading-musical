import { isProductionAdmin } from "./is-production-admin";
import type { RequestUser } from "../types/request-user";

const user: RequestUser = { id: "admin", email: "admin@example.test", name: "운영자", platformRole: "SUPER_ADMIN" };
const db = (productionOrg: string | null, userOrg: string | null) => ({
  production: { findUnique: jest.fn().mockResolvedValue({ organizationId: productionOrg }) },
  user: { findUnique: jest.fn().mockResolvedValue({ organizationId: userOrg }) }
});

test("the total administrator can manage any performance without membership or organization", async () => {
  const prisma = db("other", null);
  expect(await isProductionAdmin(prisma as never, user, "other-performance")).toBe(true);
  expect(prisma.production.findUnique).not.toHaveBeenCalled();
});
test.each([[null, null, false], ["org-a", "org-a", true], ["org-b", "org-a", false]])("organization administration requires an actual matching organization (%s, %s)", async (productionOrg, userOrg, allowed) => {
  expect(await isProductionAdmin(db(productionOrg as string | null, userOrg as string | null) as never, { ...user, platformRole: "ORG_ADMIN" }, "show")).toBe(allowed);
});
