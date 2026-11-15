import { CueSheetService } from "./cue-sheet.service";
import type { RequestUser } from "../common/types/request-user";

test("a stale cue edit preserves the current cue and returns a conflict", async () => {
  const user: RequestUser = { id: "admin", email: "admin@example.test", name: "운영자", platformRole: "SUPER_ADMIN" };
  const current = { id: "cue", trackId: "track", content: "최신 조명 지시", startMs: 0, durationSec: 2, updatedAt: new Date("2026-10-09T00:00:02.000Z") };
  const db = {
    production: { findFirst: jest.fn().mockResolvedValue({ id: "show" }) },
    cueTrack: { findFirst: jest.fn().mockResolvedValue({ id: "track" }) },
    trackCue: {
      findFirst: jest.fn().mockResolvedValue(current),
      updateMany: jest.fn().mockImplementation(async ({ where, data }) => {
        if (where.updatedAt.getTime() !== current.updatedAt.getTime()) return { count: 0 };
        Object.assign(current, data); return { count: 1 };
      }),
      findUniqueOrThrow: jest.fn().mockImplementation(async () => current)
    },
    $transaction: jest.fn()
  };
  db.$transaction.mockImplementation(work => work(db));
  const service = new CueSheetService(db as never);
  await expect(service.updateCue("show", "cue", { content: "과거 조명 지시", expectedUpdatedAt: "2026-10-09T00:00:01.000Z" }, user)).rejects.toMatchObject({ status: 409 });
  expect(current.content).toBe("최신 조명 지시");
  expect(db.trackCue.findUniqueOrThrow).not.toHaveBeenCalled();
  await expect(service.updateCue("show", "cue", { content: "다음 조명 지시", expectedUpdatedAt: current.updatedAt.toISOString() }, user)).resolves.toMatchObject({ content: "다음 조명 지시" });
});

test("a duplicate track name surfaces as a 409 instead of a 500", async () => {
  const { Prisma } = await import("@prisma/client");
  const user: RequestUser = { id: "admin", email: "admin@example.test", name: "운영자", platformRole: "SUPER_ADMIN" };
  const duplicate = new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "test" });
  const db = {
    production: { findFirst: jest.fn().mockResolvedValue({ id: "show" }) },
    cueTrack: {
      findFirst: jest.fn().mockResolvedValue({ id: "track" }),
      aggregate: jest.fn().mockResolvedValue({ _max: { order: 1 } }),
      create: jest.fn().mockRejectedValue(duplicate),
      update: jest.fn().mockRejectedValue(duplicate)
    }
  };
  const service = new CueSheetService(db as never);
  await expect(service.createTrack("show", { name: "조명" }, user)).rejects.toMatchObject({ status: 409 });
  await expect(service.updateTrack("show", "track", { name: "조명" }, user)).rejects.toMatchObject({ status: 409 });
});
