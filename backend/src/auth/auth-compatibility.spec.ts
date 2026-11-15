import { BadRequestException, ExecutionContext, HttpException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { PlatformRole, ProfileType } from "@prisma/client";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import * as bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import type { RequestUser } from "../common/types/request-user";
import { ProductionAccessService } from "../productions/production-access.service";
import { ProductionMembersService } from "../productions/production-members.service";
import { ProductionNotificationsService } from "../productions/production-notifications.service";
import { AuthService } from "./auth.service";
import { ChangePasswordDto, RegisterDto, ResetPasswordDto } from "./dto";
import { RegistrationEmailService } from "./registration-email.service";

const EMAIL = "member@example.test";
const PASSWORD = "Rehearsal123!";
const NEW_PASSWORD = "NextRehearsal456!";
const OPAQUE_SIGNUP_PROOF = "a".repeat(64);
const SECRETS = {
  JWT_ACCESS_SECRET: "test-access-secret-for-compatibility-only",
  JWT_REFRESH_SECRET: "test-refresh-secret-for-compatibility-only",
  JWT_PASSWORD_RESET_SECRET: "test-password-reset-secret-for-compatibility-only"
};

type UserRow = {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  status: "ACTIVE" | "BLOCKED" | "INACTIVE";
  platformRole: PlatformRole;
  profileType: ProfileType;
  failedLoginCount: number;
  lockedUntil: Date | null;
};

type SessionRow = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason?: string;
};

type SessionWhere = {
  id?: string;
  userId?: string;
  tokenHash?: string;
  revokedAt?: null;
  expiresAt?: { gt: Date };
};

type ChallengeRow = {
  id: string;
  email: string;
  codeHash: string;
  expiresAt: Date;
  createdAt: Date;
  attempts: number;
  verifiedAt: Date | null;
  proofHash: string | null;
  proofExpiresAt: Date | null;
  consumedAt: Date | null;
};

type ChallengeWhere = {
  email: string;
  consumedAt?: null;
  proofHash?: string;
  verifiedAt?: { not: null };
  proofExpiresAt?: { gt: Date };
};

let initialPasswordHash: string;

beforeAll(async () => {
  initialPasswordHash = await bcrypt.hash(PASSWORD, 4);
});

function build(overrides: Partial<UserRow> = {}) {
  const user: UserRow = {
    id: "existing-member",
    email: EMAIL,
    name: "기존 단원",
    passwordHash: initialPasswordHash,
    status: "ACTIVE",
    platformRole: PlatformRole.MEMBER,
    profileType: ProfileType.ACTOR,
    failedLoginCount: 0,
    lockedUntil: null,
    ...overrides
  };
  const users = new Map<string, UserRow>([[user.id, user]]);
  const sessions = new Map<string, SessionRow>();
  const challenges = new Map<string, ChallengeRow>();
  const prisma = {
    user: {
      findUnique: jest.fn(async ({ where }: { where: { id?: string; email?: string } }) =>
        where.id ? users.get(where.id) ?? null : [...users.values()].find((row) => row.email === where.email) ?? null
      ),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<UserRow> }) => {
        const row = users.get(where.id);
        if (!row) throw new Error("Missing fixture user");
        Object.assign(row, data);
        return row;
      }),
      create: jest.fn(async ({ data }: { data: Partial<UserRow> & { email: string } }) => {
        const created = { ...user, ...data, id: "verified-new-member", status: "ACTIVE" as const };
        users.set(created.id, created);
        return created;
      })
    },
    authSession: {
      create: jest.fn(async ({ data }: { data: Omit<SessionRow, "revokedAt"> }) => {
        const session = { ...data, revokedAt: null };
        sessions.set(session.id, session);
        return session;
      }),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => sessions.get(where.id) ?? null),
      updateMany: jest.fn(async ({ where, data }: { where: SessionWhere; data: Partial<SessionRow> }) => {
        let count = 0;
        for (const row of sessions.values()) {
          if (where.id !== undefined && row.id !== where.id) continue;
          if (where.userId !== undefined && row.userId !== where.userId) continue;
          if (where.tokenHash !== undefined && row.tokenHash !== where.tokenHash) continue;
          if (where.revokedAt === null && row.revokedAt !== null) continue;
          if (where.expiresAt && row.expiresAt <= where.expiresAt.gt) continue;
          Object.assign(row, data);
          count++;
        }
        return { count };
      })
    },
    registrationEmailChallenge: {
      findFirst: jest.fn(async ({ where }: { where: { email: string } }) =>
        [...challenges.values()].filter((row) => row.email === where.email).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
      ),
      count: jest.fn(async ({ where }: { where: { email: string; createdAt: { gt: Date } } }) =>
        [...challenges.values()].filter((row) => row.email === where.email && row.createdAt > where.createdAt.gt).length
      ),
      create: jest.fn(async ({ data }: { data: Pick<ChallengeRow, "id" | "email" | "codeHash" | "expiresAt"> }) => {
        const row: ChallengeRow = { ...data, createdAt: new Date(), attempts: 0, verifiedAt: null, proofHash: null, proofExpiresAt: null, consumedAt: null };
        challenges.set(row.id, row);
        return row;
      }),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => challenges.get(where.id) ?? null),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<Omit<ChallengeRow, "attempts">> & { attempts?: { increment: number } } }) => {
        const row = challenges.get(where.id);
        if (!row) throw new Error("Missing fixture challenge");
        const { attempts, ...rest } = data;
        if (attempts) row.attempts += attempts.increment;
        Object.assign(row, rest);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: { where: ChallengeWhere; data: Partial<ChallengeRow> }) => {
        let count = 0;
        for (const row of challenges.values()) {
          if (row.email !== where.email) continue;
          if (where.consumedAt === null && row.consumedAt !== null) continue;
          if (where.proofHash !== undefined && row.proofHash !== where.proofHash) continue;
          if (where.verifiedAt && row.verifiedAt === null) continue;
          if (where.proofExpiresAt && (!row.proofExpiresAt || row.proofExpiresAt <= where.proofExpiresAt.gt)) continue;
          Object.assign(row, data);
          count++;
        }
        return { count };
      })
    },
    emailDelivery: { create: jest.fn().mockResolvedValue({ id: "registration-delivery", status: "QUEUED" }) },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(async (operation: unknown): Promise<unknown> =>
      typeof operation === "function" ? operation(prisma) : Promise.all(operation as Promise<unknown>[])
    )
  };
  const config = new ConfigService({ ...SECRETS, APP_PUBLIC_URL: "https://app.example.test", NODE_ENV: "test", MAIL_TRANSPORT: "json" });
  const jwt = new JwtService();
  const mail = {
    queueEmail: jest.fn().mockResolvedValue({ id: "reset-delivery", status: "QUEUED" }),
    fromEmail: jest.fn().mockReturnValue("noreply@example.test")
  };
  const site = {
    registrationConsents: jest.fn().mockResolvedValue({ marketingPrivacy: false, marketingEmail: false, events: [] }),
    queueConsentReceipt: jest.fn()
  };
  const registrationEmail = new RegistrationEmailService(prisma as never, config);
  const service = new AuthService(prisma as never, jwt, config, mail as never, site as never, registrationEmail);
  const guard = new JwtAuthGuard(jwt, config, prisma as never);
  return { service, guard, prisma, users, user, sessions, challenges, registrationEmail, jwt, config, mail, site };
}

function contextFor(token: string) {
  const request: { headers: { authorization: string }; user?: RequestUser } = {
    headers: { authorization: `Bearer ${token}` }
  };
  return { request, context: { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext };
}

async function resetToken(fixture: ReturnType<typeof build>, payload: Record<string, unknown> = {}, expiresIn = 1800) {
  return fixture.jwt.signAsync({
    sub: fixture.user.id,
    email: fixture.user.email,
    purpose: "password-reset",
    fp: createHash("sha256").update(fixture.user.passwordHash).digest("hex").slice(0, 24),
    ...payload
  }, { secret: SECRETS.JWT_PASSWORD_RESET_SECRET, expiresIn });
}

describe("기존 회원 인증 호환성", () => {
  it("인증 이력이 없는 기존 ACTIVE 회원도 로그인·access 인증·refresh 회전을 유지한다", async () => {
    const fixture = build();
    const result = await fixture.service.login({ email: EMAIL, password: PASSWORD });
    const access = contextFor(result.tokens.accessToken);

    await expect(fixture.guard.canActivate(access.context)).resolves.toBe(true);
    expect(access.request.user).toMatchObject({ id: fixture.user.id, email: EMAIL });
    const refreshed = await fixture.service.refresh({ refreshToken: result.tokens.refreshToken });
    expect(refreshed.tokens.refreshToken !== result.tokens.refreshToken).toBe(true);
    expect(fixture.sessions.size).toBe(1);
    expect([...fixture.sessions.values()][0].revokedAt).toBeNull();
    expect(fixture.user).not.toHaveProperty("emailVerifiedAt");
  });

  it.each(["BLOCKED", "INACTIVE"] as const)("%s 회원은 로그인·기존 access·refresh를 거부한다", async (status) => {
    const fixture = build();
    const { tokens } = await fixture.service.login({ email: EMAIL, password: PASSWORD });
    fixture.user.status = status;

    await expect(fixture.service.login({ email: EMAIL, password: PASSWORD })).rejects.toThrow(UnauthorizedException);
    await expect(fixture.guard.canActivate(contextFor(tokens.accessToken).context)).rejects.toThrow(UnauthorizedException);
    await expect(fixture.service.refresh({ refreshToken: tokens.refreshToken })).rejects.toThrow(UnauthorizedException);
    expect([...fixture.sessions.values()][0]).toMatchObject({ revokedReason: "USER_INACTIVE", revokedAt: expect.any(Date) });
  });

  it("틀린 암호는 실패 횟수를 기록하고 마지막 허용 횟수에서 잠근다", async () => {
    const fixture = build({ failedLoginCount: 3 });
    await expect(fixture.service.login({ email: EMAIL, password: "WrongPassword12" })).rejects.toThrow(UnauthorizedException);
    expect(fixture.user).toMatchObject({ failedLoginCount: 4, lockedUntil: null });
    let error: unknown;
    try { await fixture.service.login({ email: EMAIL, password: "WrongPassword12" }); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    expect(fixture.user.failedLoginCount).toBe(5);
    expect(fixture.user.lockedUntil).toBeInstanceOf(Date);
    await expect(fixture.service.login({ email: EMAIL, password: PASSWORD })).rejects.toThrow(HttpException);
    expect(fixture.sessions.size).toBe(0);
  });

  it("잠금 만료 후 잘못된 암호는 첫 실패부터 계산하고 올바른 암호는 실패 상태를 지운다", async () => {
    const fixture = build({ failedLoginCount: 5, lockedUntil: new Date(Date.now() - 1000) });
    await expect(fixture.service.login({ email: EMAIL, password: "WrongPassword12" })).rejects.toThrow(UnauthorizedException);
    expect(fixture.user).toMatchObject({ failedLoginCount: 1, lockedUntil: null });
    await fixture.service.login({ email: EMAIL, password: PASSWORD });
    expect(fixture.user).toMatchObject({ failedLoginCount: 0, lockedUntil: null });
  });

  it("이미 회전한 refresh를 재사용하면 해당 세션과 최신 refresh도 거부한다", async () => {
    const fixture = build();
    const first = await fixture.service.login({ email: EMAIL, password: PASSWORD });
    const second = await fixture.service.refresh({ refreshToken: first.tokens.refreshToken });

    await expect(fixture.service.refresh({ refreshToken: first.tokens.refreshToken })).rejects.toThrow(UnauthorizedException);
    expect([...fixture.sessions.values()][0].revokedReason).toBe("REUSE_DETECTED");
    await expect(fixture.service.refresh({ refreshToken: second.tokens.refreshToken })).rejects.toThrow(UnauthorizedException);
  });

  it.each(["revoked", "expired", "other-owner"])("%s refresh 세션을 거부한다", async (reason) => {
    const fixture = build();
    const { tokens } = await fixture.service.login({ email: EMAIL, password: PASSWORD });
    const session = [...fixture.sessions.values()][0];
    if (reason === "revoked") session.revokedAt = new Date();
    if (reason === "expired") session.expiresAt = new Date(Date.now() - 1000);
    if (reason === "other-owner") session.userId = "another-member";

    await expect(fixture.service.refresh({ refreshToken: tokens.refreshToken })).rejects.toThrow(UnauthorizedException);
    expect(fixture.sessions.size).toBe(1);
  });

  it("refresh용 secret으로 서명돼도 다른 purpose와 sid 없는 payload는 거부한다", async () => {
    const fixture = build();
    for (const payload of [
      { sub: fixture.user.id, email: EMAIL, purpose: "registration-email", sid: "fake-session" },
      { sub: fixture.user.id, email: EMAIL, purpose: "refresh" }
    ]) {
      const token = await fixture.jwt.signAsync(payload, { secret: SECRETS.JWT_REFRESH_SECRET, expiresIn: "5m" });
      await expect(fixture.service.refresh({ refreshToken: token })).rejects.toThrow(UnauthorizedException);
    }
    expect(fixture.prisma.authSession.findUnique).not.toHaveBeenCalled();
  });

  it("가입 이메일 proof는 access·refresh·암호 복구 token으로 사용할 수 없다", async () => {
    const fixture = build();
    await expect(fixture.guard.canActivate(contextFor(OPAQUE_SIGNUP_PROOF).context)).rejects.toThrow(UnauthorizedException);
    await expect(fixture.service.refresh({ refreshToken: OPAQUE_SIGNUP_PROOF })).rejects.toThrow(UnauthorizedException);
    await expect(fixture.service.resetPassword({ token: OPAQUE_SIGNUP_PROOF, newPassword: NEW_PASSWORD })).rejects.toThrow(BadRequestException);
    expect(fixture.prisma.user.findUnique).not.toHaveBeenCalled();
    expect(fixture.prisma.user.update).not.toHaveBeenCalled();
    expect(fixture.sessions.size).toBe(0);
  });

  it("access·refresh·password-reset token의 서로 다른 용도와 secret을 유지한다", async () => {
    const fixture = build();
    const { tokens } = await fixture.service.login({ email: EMAIL, password: PASSWORD });
    const reset = await resetToken(fixture);

    await expect(fixture.service.refresh({ refreshToken: tokens.accessToken })).rejects.toThrow(UnauthorizedException);
    await expect(fixture.service.refresh({ refreshToken: reset })).rejects.toThrow(UnauthorizedException);
    await expect(fixture.guard.canActivate(contextFor(tokens.refreshToken).context)).rejects.toThrow(UnauthorizedException);
    await expect(fixture.guard.canActivate(contextFor(reset).context)).rejects.toThrow(UnauthorizedException);
    await expect(fixture.service.resetPassword({ token: tokens.accessToken, newPassword: NEW_PASSWORD })).rejects.toThrow(BadRequestException);
    await expect(fixture.service.resetPassword({ token: tokens.refreshToken, newPassword: NEW_PASSWORD })).rejects.toThrow(BadRequestException);
    expect([...fixture.sessions.values()][0].revokedAt).toBeNull();
  });
});

describe("기존 회원 비밀번호 복구 호환성", () => {
  it.each(["missing", "BLOCKED", "INACTIVE"])("%s 계정의 복구 요청은 존재 여부를 드러내지 않고 메일을 보내지 않는다", async (status) => {
    const fixture = build();
    if (status === "missing") fixture.users.clear();
    else fixture.user.status = status as "BLOCKED" | "INACTIVE";

    await expect(fixture.service.forgotPassword({ email: EMAIL })).resolves.toEqual({
      ok: true, message: "가입된 이메일이면 비밀번호 재설정 링크를 보냈어요."
    });
    expect(fixture.mail.queueEmail).not.toHaveBeenCalled();
  });

  it("기존 ACTIVE 계정은 가입 인증 기록 없이 복구 메일을 요청하고 링크를 사용할 수 있다", async () => {
    const fixture = build({ failedLoginCount: 5, lockedUntil: new Date(Date.now() + 60_000) });
    const beforeLock = fixture.user.lockedUntil;
    const response = await fixture.service.forgotPassword({ email: EMAIL });
    expect(response.devResetUrl).toBeUndefined();
    expect(response.emailDeliveryId).toBeUndefined();
    const queued = fixture.mail.queueEmail.mock.calls[0][0];
    expect(queued).toMatchObject({ userId: fixture.user.id, toEmail: EMAIL, templateKey: "auth.password_reset", bypassUserPreference: true });
    const link = queued.bodyText.split("\n").find((line: string) => line.startsWith("https://app.example.test/reset?"));
    expect(link).toBeDefined();
    const token = new URL(link).searchParams.get("token")!;
    const payload = await fixture.jwt.verifyAsync(token, { secret: SECRETS.JWT_PASSWORD_RESET_SECRET });
    expect(payload).toMatchObject({ sub: fixture.user.id, purpose: "password-reset" });
    expect(payload.exp - payload.iat).toBe(1800);
    expect(fixture.user.lockedUntil).toBe(beforeLock);

    await expect(fixture.service.resetPassword({ token, newPassword: NEW_PASSWORD })).resolves.toEqual({ ok: true, next: "/login" });
    expect(fixture.user).toMatchObject({ failedLoginCount: 0, lockedUntil: null });
    expect(await bcrypt.compare(NEW_PASSWORD, fixture.user.passwordHash)).toBe(true);
  });

  it("복구 성공 시 모든 refresh 세션을 철회하고 이전 암호와 사용한 링크를 거부한다", async () => {
    const fixture = build();
    const first = await fixture.service.login({ email: EMAIL, password: PASSWORD });
    await fixture.service.login({ email: EMAIL, password: PASSWORD });
    const token = await resetToken(fixture);
    await fixture.service.resetPassword({ token, newPassword: NEW_PASSWORD });

    expect(fixture.sessions.size).toBe(2);
    expect([...fixture.sessions.values()].every((session) => session.revokedAt && session.revokedReason === "PASSWORD_RESET")).toBe(true);
    await expect(fixture.service.refresh({ refreshToken: first.tokens.refreshToken })).rejects.toThrow(UnauthorizedException);
    await expect(fixture.service.resetPassword({ token, newPassword: "AnotherPassword789" })).rejects.toThrow("이미 사용된 링크");
    await expect(fixture.service.login({ email: EMAIL, password: PASSWORD })).rejects.toThrow(UnauthorizedException);
    const signedIn = await fixture.service.login({ email: EMAIL, password: NEW_PASSWORD });
    expect(signedIn.user.id).toBe(fixture.user.id);
    expect(fixture.sessions.size).toBe(3);
  });

  it.each(["purpose", "email", "fingerprint", "expired", "BLOCKED", "INACTIVE", "missing"])("%s 복구 링크는 암호·세션을 변경하지 않는다", async (reason) => {
    const fixture = build();
    const payload: Record<string, unknown> = {};
    if (reason === "purpose") payload.purpose = "registration-email";
    if (reason === "email") payload.email = "another@example.test";
    if (reason === "fingerprint") payload.fp = "old-password-fingerprint";
    const token = await resetToken(fixture, payload, reason === "expired" ? -1 : 1800);
    if (reason === "BLOCKED" || reason === "INACTIVE") fixture.user.status = reason;
    if (reason === "missing") fixture.users.clear();

    await expect(fixture.service.resetPassword({ token, newPassword: NEW_PASSWORD })).rejects.toThrow(BadRequestException);
    expect(fixture.prisma.user.update).not.toHaveBeenCalled();
    expect(fixture.prisma.authSession.updateMany).not.toHaveBeenCalled();
    expect(fixture.user.passwordHash === initialPasswordHash).toBe(true);
  });

  it.each(["short1", "onlyletters", "123456789", "a1".repeat(65)])("복구·변경·가입 DTO는 유효하지 않은 새 암호를 거부한다", async (newPassword) => {
    for (const dto of [
      plainToInstance(ResetPasswordDto, { token: "reset-fixture", newPassword }),
      plainToInstance(ChangePasswordDto, { currentPassword: PASSWORD, newPassword }),
      plainToInstance(RegisterDto, { email: EMAIL, password: newPassword, name: "단원", profileType: ProfileType.ACTOR, agreements: { terms: true, privacy: true, age14: true } })
    ]) {
      const errors = await validate(dto);
      expect(errors.some((error) => error.property === (dto instanceof RegisterDto ? "password" : "newPassword"))).toBe(true);
    }
  });
});

function invitationService() {
  const tx = {
    invitation: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    membership: { upsert: jest.fn().mockResolvedValue({ id: "new-membership" }) },
    membershipRole: { upsert: jest.fn().mockResolvedValue({}) }
  };
  const prisma = {
    invitation: { findUnique: jest.fn().mockResolvedValue({
      id: "invitation",
      productionId: "show",
      email: EMAIL,
      token: "invitation-fixture",
      role: "ACTOR",
      status: "PENDING",
      expiresAt: new Date(Date.now() + 60_000),
      production: { id: "show", title: "연습 공연" }
    }) },
    $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx))
  };
  const notifications = { createNotification: jest.fn().mockResolvedValue({}) };
  const service = new ProductionMembersService(prisma as never, new ProductionAccessService(prisma as never), {} as never, notifications as never, {} as ProductionNotificationsService);
  return { service, tx, notifications };
}

describe("초대받은 기존 회원 인증 호환성", () => {
  it("기존 회원은 로그인 후 access guard가 복원한 본인 정보로 초대를 수락한다", async () => {
    const fixture = build();
    const invitation = invitationService();
    const { tokens } = await fixture.service.login({ email: EMAIL, password: PASSWORD });
    const access = contextFor(tokens.accessToken);
    await fixture.guard.canActivate(access.context);

    await expect(invitation.service.acceptInvitation("invitation-fixture", access.request.user!)).resolves.toMatchObject({
      ok: true, productionId: "show", membershipId: "new-membership", role: "ACTOR", next: "/app/p/show"
    });
    expect(invitation.tx.membership.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: { userId: fixture.user.id, productionId: "show", primaryRole: "ACTOR" }
    }));
    expect(invitation.notifications.createNotification).toHaveBeenCalledTimes(1);
  });

  it("신규 회원은 이메일 인증·가입 후 같은 access guard와 초대 수락 경로로 팀에 연결된다", async () => {
    const fixture = build();
    fixture.users.clear();
    const invitation = invitationService();
    const requested = await fixture.registrationEmail.request({ email: EMAIL });
    const queued = fixture.prisma.emailDelivery.create.mock.calls[0][0] as { data: { bodyText: string } };
    const code = queued.data.bodyText.match(/인증번호: (\d{6})/)?.[1];
    if (!code) throw new Error("Missing fixture verification code");
    const proof = await fixture.registrationEmail.verify({ email: EMAIL, challengeId: requested.challengeId, code });
    expect(fixture.users.size).toBe(0);
    expect(fixture.sessions.size).toBe(0);
    const dto = plainToInstance(RegisterDto, {
      email: EMAIL,
      emailVerificationToken: proof.emailVerificationToken,
      password: PASSWORD,
      name: "새 단원",
      profileType: ProfileType.ACTOR,
      agreements: { terms: true, privacy: true, age14: true }
    });
    expect(await validate(dto)).toHaveLength(0);
    const registered = await fixture.service.register(dto);
    const access = contextFor(registered.tokens.accessToken);
    await fixture.guard.canActivate(access.context);

    expect(fixture.challenges.get(requested.challengeId)?.consumedAt).toBeInstanceOf(Date);
    expect(fixture.challenges.get(requested.challengeId)?.proofHash).toBeNull();
    await expect(invitation.service.acceptInvitation("invitation-fixture", access.request.user!)).resolves.toMatchObject({
      ok: true, productionId: "show", role: "ACTOR", next: "/app/p/show"
    });
    expect(invitation.tx.membership.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: { userId: registered.user.id, productionId: "show", primaryRole: "ACTOR" }
    }));
    expect(fixture.users.size).toBe(1);
    expect(fixture.sessions.size).toBe(1);
    const signedIn = await fixture.service.login({ email: EMAIL, password: PASSWORD });
    expect(signedIn.user.id).toBe(registered.user.id);
  });
});
