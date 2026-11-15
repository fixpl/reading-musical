import { BadRequestException, ConflictException, HttpException, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { PlatformRole, Prisma, ProfileType } from "@prisma/client";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { createHash, createHmac } from "node:crypto";
import { RATE_LIMIT_KEY } from "../common/decorators/rate-limit.decorator";
import { MailService } from "../mail/mail.service";
import { PrismaService } from "../prisma/prisma.service";
import { SiteService } from "../site/site.service";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { RegisterDto, RequestRegistrationEmailDto, VerifyRegistrationEmailDto } from "./dto";
import { RegistrationEmailService } from "./registration-email.service";

const SECRET = "registration-email-unit-test-secret";
const EMAIL = "Actor@example.invalid";
const CODE = "083215";
const ID = "b51d9890-8b80-4caa-9668-71ba018c2ec3";
const TOKEN = "a".repeat(64);
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
type Challenge = {
  id: string; email: string; codeHash: string; expiresAt: Date; attempts: number; verifiedAt: Date | null;
  proofHash: string | null; proofExpiresAt: Date | null; consumedAt: Date | null; createdAt: Date;
};
const challenge = (overrides: Partial<Challenge> = {}): Challenge => ({
  id: ID, email: EMAIL, codeHash: createHmac("sha256", SECRET).update(`registration-email-code:${ID}:${CODE}`).digest("hex"),
  expiresAt: new Date(Date.now() + 600_000), attempts: 0, verifiedAt: null, proofHash: null,
  proofExpiresAt: null, consumedAt: null, createdAt: new Date(Date.now() - 60_001), ...overrides
});

function fixture() {
  let state = { challenges: [] as Challenge[], deliveries: [] as any[], users: [] as any[], sessions: [] as any[] };
  const configValues: Record<string, string> = { JWT_ACCESS_SECRET: SECRET, JWT_REFRESH_SECRET: "registration-refresh-unit-test-secret", MAIL_TRANSPORT: "json" };
  const config = { get: jest.fn((key: string) => configValues[key]) };
  const matches = (row: Challenge, where: any) => (!where.id || row.id === where.id)
    && (!where.email || (typeof where.email === "string" ? row.email === where.email : row.email.toLowerCase() === where.email.equals.toLowerCase()))
    && (!where.proofHash || row.proofHash === where.proofHash)
    && (!Object.hasOwn(where, "consumedAt") || row.consumedAt === where.consumedAt)
    && (!where.verifiedAt || row.verifiedAt !== null)
    && (!where.proofExpiresAt || Boolean(row.proofExpiresAt && row.proofExpiresAt > where.proofExpiresAt.gt))
    && (!where.createdAt || row.createdAt > where.createdAt.gt);
  const apply = (row: Challenge, data: any) => {
    const { attempts, ...rest } = data;
    Object.assign(row, rest);
    if (attempts) row.attempts += attempts.increment;
  };
  const db = {
    $transaction: jest.fn(), $queryRaw: jest.fn().mockResolvedValue([{ value: 1 }]),
    registrationEmailChallenge: {
      findFirst: jest.fn(async ({ where }: any) => structuredClone(state.challenges.filter((row) => matches(row, where)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null)),
      count: jest.fn(async ({ where }: any) => state.challenges.filter((row) => matches(row, where)).length),
      create: jest.fn(async ({ data }: any) => { const row = challenge({ createdAt: new Date(), ...data }); state.challenges.push(row); return structuredClone(row); }),
      findUnique: jest.fn(async ({ where }: any) => structuredClone(state.challenges.find((row) => matches(row, where)) ?? null)),
      update: jest.fn(async ({ where, data }: any) => { const row = state.challenges.find((entry) => entry.id === where.id)!; apply(row, data); return structuredClone(row); }),
      updateMany: jest.fn(async ({ where, data }: any) => { const rows = state.challenges.filter((row) => matches(row, where)); rows.forEach((row) => apply(row, data)); return { count: rows.length }; })
    },
    emailDelivery: { create: jest.fn(async ({ data }: any) => { state.deliveries.push(structuredClone(data)); return { id: `mail-${state.deliveries.length}` }; }) },
    user: {
      findUnique: jest.fn(async ({ where }: any) => state.users.find((row) => row.email === where.email) ?? null),
      create: jest.fn(async ({ data }: any) => {
        if (state.users.some((row) => row.email === data.email)) throw new Prisma.PrismaClientKnownRequestError("duplicate test email", { code: "P2002", clientVersion: "test" });
        const row = { id: `user-${state.users.length}`, status: "ACTIVE", ...data }; state.users.push(row); return row;
      })
    },
    authSession: { create: jest.fn(async ({ data }: any) => { state.sessions.push(data); return data; }) }
  };
  // 모의 transaction은 rollback·순서를 검증한다. PostgreSQL advisory lock의 실제 경합 보장은 별도 통합 검사 대상이다.
  let tail = Promise.resolve();
  db.$transaction.mockImplementation((callback: (tx: typeof db) => Promise<unknown>) => {
    const run = async () => {
      const original = structuredClone(state);
      try { return await callback(db); } catch (error) { state = original; throw error; }
    };
    const result = tail.then(run); tail = result.then(() => undefined, () => undefined); return result;
  });
  const jwt = { signAsync: jest.fn(async (payload: any) => payload.purpose === "refresh" ? "refresh-token" : "access-token") };
  const site = {
    registrationConsents: jest.fn(async () => ({ marketingPrivacy: false, marketingEmail: false, events: [{ kind: "TERMS", accepted: true }] })),
    queueConsentReceipt: jest.fn()
  };
  const service = new RegistrationEmailService(db as unknown as PrismaService, config as unknown as ConfigService);
  const auth = new AuthService(db as unknown as PrismaService, jwt as unknown as JwtService, config as unknown as ConfigService,
    {} as MailService, site as unknown as SiteService, service);
  const proof = (overrides: Partial<Challenge> = {}) => {
    const row = challenge({ verifiedAt: new Date(), proofHash: digest(TOKEN), proofExpiresAt: new Date(Date.now() + 600_000), ...overrides });
    state.challenges.push(row); return row;
  };
  const registerDto = (overrides: Partial<RegisterDto> = {}): RegisterDto => ({ email: EMAIL, emailVerificationToken: TOKEN,
    password: "TestPassword09", name: "배우", profileType: ProfileType.ACTOR, agreements: { terms: true, privacy: true, age14: true }, ...overrides });
  return { db, config, configValues, service, auth, site, jwt, proof, registerDto, get state() { return state; } };
}

describe("가입 전 이메일 인증 발급", () => {
  test.each([
    { MAIL_SENDING_ENABLED: "false" }, { MAIL_TRANSPORT: "resend" }, { MAIL_TRANSPORT: "json", NODE_ENV: "production" }
  ])("발송 준비가 안 되면 challenge와 outbox를 만들지 않는다: %j", async (values) => {
    const f = fixture(); Object.assign(f.configValues, values);
    await expect(f.service.request({ email: EMAIL })).rejects.toThrow(ServiceUnavailableException);
    expect(f.db.$transaction).not.toHaveBeenCalled(); expect(f.state.challenges).toHaveLength(0); expect(f.state.deliveries).toHaveLength(0);
  });

  test("HMAC 설정이 없으면 기존 challenge도 변경하지 않는다", async () => {
    const f = fixture(); delete f.configValues.JWT_ACCESS_SECRET; f.proof();
    await expect(f.service.request({ email: EMAIL })).rejects.toThrow(ServiceUnavailableException);
    expect(f.db.$transaction).not.toHaveBeenCalled(); expect(f.state.challenges[0].consumedAt).toBeNull();
  });

  test("이메일별 잠금 뒤 HMAC만 저장하고 같은 transaction에 인증 메일을 기록한다", async () => {
    const f = fixture(); const result = await f.service.request({ email: EMAIL });
    const stored = f.state.challenges[0]; const mail = f.state.deliveries[0]; const sentCode = mail.bodyText.match(/인증번호: (\d{6})/)[1];
    expect(f.db.$queryRaw.mock.calls[0][0].join("?")).toContain("pg_advisory_xact_lock(hashtextextended(");
    expect(f.db.$queryRaw.mock.calls[0][1]).toBe(`registration-email:${EMAIL.toLowerCase()}`);
    expect(stored.codeHash).toBe(createHmac("sha256", SECRET).update(`registration-email-code:${stored.id}:${sentCode}`).digest("hex"));
    expect(stored.email).toBe(EMAIL); expect(stored.attempts).toBe(0); expect(stored.proofHash).toBeNull();
    expect(stored.expiresAt.getTime() - stored.createdAt.getTime()).toBeGreaterThanOrEqual(599_000);
    expect(stored.expiresAt.getTime() - stored.createdAt.getTime()).toBeLessThanOrEqual(600_000);
    expect(result).toEqual({ challengeId: stored.id, expiresAt: stored.expiresAt, retryAfterSeconds: 60 });
    expect(mail).toMatchObject({ toEmail: EMAIL, templateKey: "auth.registration_code", status: "QUEUED",
      metadata: { challengeId: stored.id, transactional: true, expiresAt: result.expiresAt.toISOString() } });
    expect(Object.keys(mail.metadata).sort()).toEqual(["challengeId", "expiresAt", "transactional"]);
    expect(JSON.stringify(result)).not.toContain(sentCode); expect(JSON.stringify(mail.metadata)).not.toContain(sentCode);
    expect(f.db.user.create).not.toHaveBeenCalled();
  });

  test("60초 이내 재요청은 새 코드와 메일을 만들지 않는다", async () => {
    const f = fixture(); await f.service.request({ email: EMAIL });
    await expect(f.service.request({ email: EMAIL })).rejects.toMatchObject({ status: 429,
      response: expect.objectContaining({ code: "REGISTRATION_EMAIL_RATE_LIMITED", retryAfterSeconds: expect.any(Number) }) });
    expect(f.state.challenges).toHaveLength(1); expect(f.state.deliveries).toHaveLength(1);
  });

  test("이메일 대소문자를 바꿔도 같은 메일함의 발급 제한과 이전 proof 무효화가 적용된다", async () => {
    const f = fixture(); await f.service.request({ email: EMAIL });
    await expect(f.service.request({ email: EMAIL.toLowerCase() })).rejects.toMatchObject({ status: 429 });
    f.state.challenges[0].createdAt = new Date(Date.now() - 60_001);
    f.state.challenges[0].verifiedAt = new Date(); f.state.challenges[0].proofHash = digest(TOKEN); f.state.challenges[0].proofExpiresAt = new Date(Date.now() + 600_000);
    await f.service.request({ email: EMAIL.toLowerCase() });
    expect(f.state.challenges[0]).toMatchObject({ consumedAt: expect.any(Date), proofHash: null });
    expect(f.state.challenges[1].email).toBe(EMAIL.toLowerCase());
    expect(f.db.$queryRaw.mock.calls.every((call) => call[1] === `registration-email:${EMAIL.toLowerCase()}`)).toBe(true);
  });

  test("IP와 별개로 이메일당 시간당 10회까지만 발급한다", async () => {
    const f = fixture();
    for (let i = 0; i < 10; i += 1) f.state.challenges.push(challenge({ id: `previous-${i}`, consumedAt: new Date(), createdAt: new Date(Date.now() - (i + 2) * 60_000) }));
    await expect(f.service.request({ email: EMAIL })).rejects.toThrow(HttpException);
    expect(f.db.registrationEmailChallenge.create).not.toHaveBeenCalled(); expect(f.db.emailDelivery.create).not.toHaveBeenCalled();
  });

  test("동시 최초 요청도 하나만 발급하도록 이메일 잠금을 먼저 잡는다", async () => {
    const f = fixture(); const results = await Promise.allSettled([f.service.request({ email: EMAIL }), f.service.request({ email: EMAIL })]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(f.state.challenges).toHaveLength(1); expect(f.state.deliveries).toHaveLength(1);
    expect(f.db.$queryRaw).toHaveBeenCalledTimes(2);
  });

  test("재발급은 같은 이메일의 이전 코드와 proof만 무효화한다", async () => {
    const f = fixture(); f.proof(); const other = challenge({ id: "other", email: "other@example.invalid" }); f.state.challenges.push(other);
    const result = await f.service.request({ email: EMAIL });
    expect(f.state.challenges[0]).toMatchObject({ consumedAt: expect.any(Date), proofHash: null, proofExpiresAt: null });
    expect(f.state.challenges[1]).toEqual(other); expect(result.challengeId).not.toBe(ID);
    await expect(f.service.verify({ email: EMAIL, challengeId: ID, code: CODE })).rejects.toThrow(UnauthorizedException);
    await expect(f.db.$transaction((tx: any) => f.service.consumeProof(tx, EMAIL, TOKEN))).rejects.toThrow(UnauthorizedException);
  });

  test("outbox 기록이 실패하면 신규 코드 생성과 이전 proof 폐기를 함께 rollback한다", async () => {
    const f = fixture(); f.proof(); const original = structuredClone(f.state); f.db.emailDelivery.create.mockRejectedValueOnce(new Error("outbox unavailable"));
    await expect(f.service.request({ email: EMAIL })).rejects.toThrow("인증 메일을 준비하지 못했어요.");
    expect(f.state).toEqual(original);
  });
});

describe("가입 인증번호 확인", () => {
  test("틀린 번호 횟수를 commit한 뒤 오류를 반환한다", async () => {
    const f = fixture(); f.state.challenges.push(challenge());
    await expect(f.service.verify({ email: EMAIL, challengeId: ID, code: "000000" })).rejects.toMatchObject({ response: expect.objectContaining({ code: "REGISTRATION_EMAIL_CODE_INVALID" }) });
    expect(f.state.challenges[0].attempts).toBe(1); expect(f.state.challenges[0].proofHash).toBeNull();
    await expect(f.db.$transaction.mock.results[0].value).resolves.toBeNull();
  });

  test("다섯 번 실패하면 올바른 번호도 거절하고 실패 횟수는 5에서 멈춘다", async () => {
    const f = fixture(); f.state.challenges.push(challenge());
    for (let i = 0; i < 5; i += 1) await expect(f.service.verify({ email: EMAIL, challengeId: ID, code: "000000" })).rejects.toThrow(UnauthorizedException);
    await expect(f.service.verify({ email: EMAIL, challengeId: ID, code: CODE })).rejects.toThrow(UnauthorizedException);
    expect(f.state.challenges[0].attempts).toBe(5); expect(f.db.registrationEmailChallenge.update).toHaveBeenCalledTimes(5);
  });

  test.each(["missing", "expired", "consumed", "verified", "different-email", "email-case"])("%s challenge로 proof를 만들지 않는다", async (kind) => {
    const f = fixture();
    if (kind !== "missing") f.state.challenges.push(challenge(kind === "expired" ? { expiresAt: new Date(0) }
      : kind === "consumed" ? { consumedAt: new Date() } : kind === "verified" ? { verifiedAt: new Date() }
        : kind === "different-email" ? { email: "another@example.invalid" } : kind === "email-case" ? { email: EMAIL.toLowerCase() } : {}));
    await expect(f.service.verify({ email: EMAIL, challengeId: ID, code: CODE })).rejects.toThrow(UnauthorizedException);
    expect(f.db.registrationEmailChallenge.update).not.toHaveBeenCalled();
  });

  test("proof 원문은 응답 한 번에만 담고 SHA-256과 10분 기한만 저장한다", async () => {
    const f = fixture(); f.state.challenges.push(challenge());
    const result = await f.service.verify({ email: EMAIL, challengeId: ID, code: CODE });
    expect(result.emailVerificationToken).toMatch(/^[a-f0-9]{64}$/);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now() + 599_000);
    expect(result.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 600_000);
    expect(f.state.challenges[0]).toMatchObject({ verifiedAt: expect.any(Date), proofHash: digest(result.emailVerificationToken), proofExpiresAt: result.expiresAt, attempts: 0, consumedAt: null });
    expect(JSON.stringify(f.state)).not.toContain(result.emailVerificationToken); expect(f.state.deliveries).toHaveLength(0);
    await expect(f.service.verify({ email: EMAIL, challengeId: ID, code: CODE })).rejects.toThrow(UnauthorizedException);
  });

  test("동시 번호 확인은 proof를 하나만 반환한다", async () => {
    const f = fixture(); f.state.challenges.push(challenge());
    const results = await Promise.allSettled([f.service.verify({ email: EMAIL, challengeId: ID, code: CODE }), f.service.verify({ email: EMAIL, challengeId: ID, code: CODE })]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(f.db.registrationEmailChallenge.update).toHaveBeenCalledTimes(1);
    expect(f.db.$queryRaw.mock.calls.every(([query]: any) => query.join("?").includes("FOR UPDATE"))).toBe(true);
  });
});

describe("가입 transaction의 이메일 proof 소비", () => {
  test.each(["missing", "malformed", "unverified", "expired", "consumed", "different-email", "email-case", "different-proof"])("%s proof로 계정과 세션을 만들지 않는다", async (kind) => {
    const f = fixture();
    if (!["missing", "malformed"].includes(kind)) f.proof(kind === "unverified" ? { verifiedAt: null } : kind === "expired" ? { proofExpiresAt: new Date(0) }
      : kind === "consumed" ? { consumedAt: new Date() } : kind === "different-email" ? { email: "other@example.invalid" }
        : kind === "email-case" ? { email: EMAIL.toLowerCase() } : { proofHash: digest("b".repeat(64)) });
    await expect(f.auth.register(f.registerDto(kind === "malformed" ? { emailVerificationToken: "bad" } : {}))).rejects.toMatchObject({ response: expect.objectContaining({ code: "REGISTRATION_EMAIL_VERIFICATION_INVALID" }) });
    expect(f.state.users).toHaveLength(0); expect(f.state.sessions).toHaveLength(0); expect(f.jwt.signAsync).not.toHaveBeenCalled();
    expect(f.site.registrationConsents).not.toHaveBeenCalled();
  });

  test("정상 인증 후 동의와 계정을 함께 저장하고 기존 token 응답을 유지한다", async () => {
    const f = fixture(); f.proof(); const dto = f.registerDto(); const result = await f.auth.register(dto);
    expect(result).toMatchObject({ next: "/app", user: { email: EMAIL, status: "ACTIVE", platformRole: PlatformRole.MEMBER }, tokens: { accessToken: "access-token", refreshToken: "refresh-token" } });
    expect(f.site.registrationConsents).toHaveBeenCalledWith(dto.agreements, undefined, f.db);
    expect(f.state.users[0]).toMatchObject({ email: EMAIL, name: "배우", consentEvents: { createMany: { data: [{ kind: "TERMS", accepted: true }] } } });
    expect(f.state.users[0].passwordHash).not.toBe(dto.password); expect(f.state.sessions).toHaveLength(1);
    expect(f.state.challenges[0]).toMatchObject({ consumedAt: expect.any(Date), proofHash: null, proofExpiresAt: null });
  });

  test("소비한 proof는 다시 쓸 수 없다", async () => {
    const f = fixture(); f.proof();
    await f.db.$transaction((tx: any) => f.service.consumeProof(tx, EMAIL, TOKEN));
    await expect(f.db.$transaction((tx: any) => f.service.consumeProof(tx, EMAIL, TOKEN))).rejects.toThrow(UnauthorizedException);
  });

  test("동시 가입 요청은 proof와 계정을 한 번만 소비한다", async () => {
    const f = fixture(); f.proof();
    const results = await Promise.allSettled([f.auth.register(f.registerDto()), f.auth.register(f.registerDto())]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(f.state.users).toHaveLength(1); expect(f.state.sessions).toHaveLength(1);
  });

  test("동의 문서가 바뀌면 proof 소비를 rollback하고 다시 제출할 수 있다", async () => {
    const f = fixture(); f.proof(); f.site.registrationConsents.mockRejectedValueOnce(new BadRequestException("동의 내용을 다시 확인해 주세요"));
    await expect(f.auth.register(f.registerDto())).rejects.toThrow(BadRequestException);
    expect(f.state.challenges[0]).toMatchObject({ consumedAt: null, proofHash: digest(TOKEN) }); expect(f.state.users).toHaveLength(0); expect(f.state.sessions).toHaveLength(0);
    await expect(f.auth.register(f.registerDto())).resolves.toMatchObject({ user: { email: EMAIL } });
  });

  test("계정 생성의 unique 충돌은 proof 소비를 rollback하고 기존 충돌 응답을 유지한다", async () => {
    const f = fixture(); f.proof(); f.db.user.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("duplicate test email", { code: "P2002", clientVersion: "test" }));
    await expect(f.auth.register(f.registerDto())).rejects.toThrow(ConflictException);
    expect(f.state.challenges[0]).toMatchObject({ consumedAt: null, proofHash: digest(TOKEN) }); expect(f.state.users).toHaveLength(0); expect(f.state.sessions).toHaveLength(0);
  });

  test("계정 생성의 일반 실패도 proof와 동의를 저장하지 않는다", async () => {
    const f = fixture(); f.proof(); f.db.user.create.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(f.auth.register(f.registerDto())).rejects.toThrow("database unavailable");
    expect(f.state.challenges[0]).toMatchObject({ consumedAt: null, proofHash: digest(TOKEN) }); expect(f.state.users).toHaveLength(0); expect(f.state.sessions).toHaveLength(0);
  });
});

describe("가입 이메일 HTTP 계약", () => {
  test("요청과 확인 endpoint는 이메일 변경으로 우회할 수 없는 IP 제한을 사용한다", () => {
    for (const method of [AuthController.prototype.requestRegistrationEmail, AuthController.prototype.verifyRegistrationEmail]) {
      expect(Reflect.getMetadata(RATE_LIMIT_KEY, method)).toMatchObject({ keyMode: "ip", defaultWindowMs: 60_000 });
    }
  });

  test("이메일 식별값을 대소문자 변환하지 않고 DTO에서 인증값 형식을 검증한다", () => {
    const request = plainToInstance(RequestRegistrationEmailDto, { email: EMAIL }); expect(request.email).toBe(EMAIL); expect(validateSync(request)).toHaveLength(0);
    expect(validateSync(plainToInstance(VerifyRegistrationEmailDto, { email: EMAIL, challengeId: ID, code: CODE }))).toHaveLength(0);
    for (const code of ["12345", "1234567", "12345a", 123456]) expect(validateSync(plainToInstance(VerifyRegistrationEmailDto, { email: EMAIL, challengeId: ID, code }))).not.toHaveLength(0);
    const f = fixture(); expect(validateSync(plainToInstance(RegisterDto, f.registerDto()))).toHaveLength(0);
    for (const emailVerificationToken of [undefined, "a".repeat(63), "a".repeat(65), "A".repeat(64)]) {
      expect(validateSync(plainToInstance(RegisterDto, f.registerDto({ emailVerificationToken })))).toEqual(expect.arrayContaining([expect.objectContaining({ property: "emailVerificationToken" })]));
    }
  });
});
