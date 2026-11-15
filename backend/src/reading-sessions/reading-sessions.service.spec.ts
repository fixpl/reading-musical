import { NotFoundException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { FireReadingCueDto } from "./dto";
import { ReadingSessionsService } from "./reading-sessions.service";

// Offline tests: mock Prisma and the gateway, run the real service code.
function fixture() {
  const prisma = {
    guestReadingAccess: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    activityLog: { create: jest.fn().mockResolvedValue({}) }
  };
  const gateway = { disconnectGuestAccess: jest.fn() };
  const service = new ReadingSessionsService(prisma as never, { get: jest.fn() } as never, {} as never, gateway as never);
  return { prisma, gateway, service };
}

describe("reading session guest access regressions", () => {
  it("disconnects guest sockets when a link is revoked", async () => {
    const { prisma, gateway, service } = fixture();
    const base = { id: "access-1", productionId: "p1", eventId: "e1", expiresAt: new Date(Date.now() + 60_000), revokedAt: null, label: null };
    prisma.guestReadingAccess.findFirst.mockResolvedValue(base);
    prisma.guestReadingAccess.update.mockResolvedValue({ ...base, revokedAt: new Date() });
    jest.spyOn(service as any, "assertMembership").mockResolvedValue({});
    jest.spyOn(service as any, "assertEvent").mockResolvedValue({});
    await service.revokeGuestLink("p1", "e1", "access-1", { reason: "유출" } as never, { id: "u1" } as never);
    expect(gateway.disconnectGuestAccess).toHaveBeenCalledWith("access-1");
  });

  it("hides guest workspace of a deleted production", async () => {
    const { prisma, service } = fixture();
    prisma.guestReadingAccess.findUnique.mockResolvedValue({
      id: "access-1",
      productionId: "p1",
      eventId: "e1",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      production: { id: "p1", title: "삭제됨", deletedAt: new Date() }
    });
    await expect(service.getGuestWorkspace("token")).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.guestReadingAccess.update).not.toHaveBeenCalled();
  });
});

describe("fireCue payload", () => {
  it("keeps server-computed fields when client payload collides", async () => {
    const { service } = fixture();
    const cue = { id: "cue-1", cueNumber: "Q1", cueType: "MUSIC", trackStartMs: 0, trackEndMs: 1000, fireMode: "MANUAL", sceneId: null, anchorBlockId: null };
    const session = { id: "s1", runSheetId: null, currentSceneId: null, currentBlockId: null };
    const created = jest.fn().mockResolvedValue({ id: "log-1", cue });
    const prisma = {
      cueFireLog: { create: created },
      readingSession: { update: jest.fn().mockResolvedValue({ id: "s1", eventId: "e1", currentSceneId: null, currentBlockId: null }) },
      $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops))
    };
    const svc = new ReadingSessionsService(prisma as never, {} as never, { emitReadingSessionEvent: jest.fn() } as never, {} as never);
    const internal = svc as any;
    jest.spyOn(internal, "assertMembership").mockResolvedValue({});
    jest.spyOn(internal, "assertCanFireCue").mockReturnValue(undefined);
    jest.spyOn(internal, "assertActiveSession").mockResolvedValue(session);
    jest.spyOn(internal, "assertCue").mockResolvedValue(cue);
    jest.spyOn(internal, "cueInclude").mockReturnValue({});
    jest.spyOn(internal, "sessionInclude").mockReturnValue({});
    void service;

    await svc.fireCue("p1", "s1", { cueId: "cue-1", payload: { cueNumber: "HACK", participantAutoplay: true, extra: 1 } } as never, { id: "u1" } as never).catch(() => undefined);
    const payload = created.mock.calls[0][0].data.payload;
    expect(payload.cueNumber).toBe("Q1");
    expect(payload.participantAutoplay).toBe(false);
    expect(payload.extra).toBe(1);
  });

  it("rejects payloads larger than 2KB", async () => {
    const dto = plainToInstance(FireReadingCueDto, { cueId: "7f2f0b3e-8b0a-4c7e-9a47-0f4c0a1f6d11", payload: { big: "x".repeat(3000) } });
    expect(await validate(dto)).not.toHaveLength(0);
    const ok = plainToInstance(FireReadingCueDto, { cueId: "7f2f0b3e-8b0a-4c7e-9a47-0f4c0a1f6d11", payload: { small: "x" } });
    expect(await validate(ok)).toHaveLength(0);
  });
});
