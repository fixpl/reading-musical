import { BadRequestException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { UsersService } from "./users.service";

describe("UsersService.changeMyPassword", () => {
  it("rejects reusing the current password", async () => {
    const passwordHash = await bcrypt.hash("Current-pass1!", 4);
    const prisma = {
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: "u1", passwordHash }), update: jest.fn() },
      authSession: { updateMany: jest.fn() },
      $transaction: jest.fn()
    };
    const service = new UsersService(prisma as never, {} as never);
    await expect(service.changeMyPassword("u1", { currentPassword: "Current-pass1!", newPassword: "Current-pass1!" })).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
