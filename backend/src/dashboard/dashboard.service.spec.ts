import { NotFoundException } from "@nestjs/common";
import type { RequestUser } from "../common/types/request-user";
import { DashboardService } from "./dashboard.service";

describe("DashboardService.getProductionDashboard", () => {
  it("hides the dashboard of a deleted production", async () => {
    const prisma = {
      membership: { findFirst: jest.fn().mockResolvedValue({ roles: [], staffAssignments: [], user: { profileComplete: true } }) },
      production: { findUnique: jest.fn().mockResolvedValue({ id: "p1", deletedAt: new Date() }) }
    };
    const service = new DashboardService(prisma as never);
    await expect(
      service.getProductionDashboard("p1", { id: "u1", platformRole: "MEMBER" } as RequestUser)
    ).rejects.toThrow(NotFoundException);
  });
});
