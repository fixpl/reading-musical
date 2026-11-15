import { EmailDeliveryStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { RegistrationEmailRetentionService } from "./registration-email-retention.service";

const NOW = new Date("2026-10-23T09:00:00Z");
const before = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
const redacted = "인증번호 보관 기간 종료";
type Challenge = { id: string; createdAt: Date; expiresAt: Date; proofExpiresAt: Date | null };
type Delivery = { id: string; templateKey: string; bodyText: string; createdAt: Date; status: EmailDeliveryStatus; updatedAt: Date; attempts: number; lastAttemptAt: Date | null; nextAttemptAt: Date | null; skippedReason: string | null; toEmail: string; metadata: unknown; providerMessageId: string | null; errorMessage: string | null };

function fixture() {
  const challenges: Challenge[] = [];
  const deliveries: Delivery[] = [];
  const challengeMatches = (row: Challenge, where: any) => (!where.id || where.id.in.includes(row.id))
    && row.createdAt < where.createdAt.lt && row.expiresAt <= where.expiresAt.lte
    && (row.proofExpiresAt === null || row.proofExpiresAt <= where.OR[1].proofExpiresAt.lte);
  const mailMatches = (row: Delivery, where: any) => (!where.id || row.id === where.id) && row.templateKey === where.templateKey
    && (!where.createdAt.lte || row.createdAt <= where.createdAt.lte) && (!where.createdAt.lt || row.createdAt < where.createdAt.lt)
    && (!where.bodyText || !where.bodyText.notIn.includes(row.bodyText))
    && (!where.NOT || !(row.status === where.NOT.status && row.toEmail === where.NOT.toEmail && row.metadata === null
      && row.providerMessageId === null && row.bodyText === where.NOT.bodyText && row.errorMessage === where.NOT.errorMessage))
    && (!where.status || row.status === where.status) && (!where.updatedAt || row.updatedAt.getTime() === where.updatedAt.getTime());
  const db = {
    registrationEmailChallenge: {
      findMany: jest.fn(async ({ where, take }: any) => challenges.filter((row) => challengeMatches(row, where)).slice(0, take).map(({ id }) => ({ id }))),
      deleteMany: jest.fn(async ({ where }: any) => {
        const rows = challenges.filter((row) => challengeMatches(row, where));
        for (const row of rows) challenges.splice(challenges.indexOf(row), 1);
        return { count: rows.length };
      })
    },
    emailDelivery: {
      findMany: jest.fn(async ({ where, take }: any) => deliveries.filter((row) => mailMatches(row, where)).slice(0, take).map(({ id, status, updatedAt }) => ({ id, status, updatedAt }))),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const rows = deliveries.filter((row) => mailMatches(row, where));
        rows.forEach((row) => Object.assign(row, data, data.metadata === Prisma.DbNull ? { metadata: null } : {}));
        return { count: rows.length };
      }),
      deleteMany: jest.fn(async ({ where }: any) => {
        const rows = deliveries.filter((row) => mailMatches(row, where));
        for (const row of rows) deliveries.splice(deliveries.indexOf(row), 1);
        return { count: rows.length };
      })
    }
  };
  const challenge = (id: string, overrides: Partial<Challenge> = {}) => {
    const row = { id, createdAt: before(25 * 60), expiresAt: before(24 * 60), proofExpiresAt: null, ...overrides };
    challenges.push(row); return row;
  };
  const mail = (id: string, overrides: Partial<Delivery> = {}) => {
    const row = { id, templateKey: "auth.registration_code", bodyText: "회원가입 인증번호: 083215", createdAt: before(11), status: EmailDeliveryStatus.QUEUED,
      updatedAt: before(1), attempts: 0, lastAttemptAt: null, nextAttemptAt: before(1), skippedReason: null,
      toEmail: "actor@example.invalid", metadata: { challengeId: "private-challenge", transactional: true }, providerMessageId: "private-provider-id", errorMessage: "private error detail", ...overrides };
    deliveries.push(row); return row;
  };
  return { challenges, deliveries, db, challenge, mail, service: new RegistrationEmailRetentionService(db as unknown as PrismaService) };
}

describe("회원가입 이메일 인증 자료 보관 기한", () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(NOW); });
  afterEach(() => jest.useRealTimers());

  test("24시간이 지났고 코드와 proof가 모두 만료된 challenge만 삭제한다", async () => {
    const f = fixture(); f.challenge("expired-no-proof"); f.challenge("expired-proof", { proofExpiresAt: before(1) });
    f.challenge("recent-hour", { createdAt: before(59), expiresAt: before(49) });
    f.challenge("within-retention", { createdAt: before(24 * 60 - 1) }); f.challenge("exact-retention", { createdAt: before(24 * 60) });
    f.challenge("valid-code", { expiresAt: new Date(NOW.getTime() + 1) });
    f.challenge("valid-proof", { proofExpiresAt: new Date(NOW.getTime() + 1) });
    await expect(f.service.purgeExpiredBatch()).resolves.toEqual({ deletedDeliveries: 0, anonymized: 0, deleted: 2, sanitized: 0, moreMayRemain: false });
    expect(f.challenges.map((row) => row.id)).toEqual(["recent-hour", "within-retention", "exact-retention", "valid-code", "valid-proof"]);
    expect(f.db.registrationEmailChallenge.findMany).toHaveBeenCalledWith(expect.objectContaining({ select: { id: true }, take: 500, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }));
    expect(f.db.registrationEmailChallenge.deleteMany).toHaveBeenCalledWith({ where: expect.objectContaining({ id: { in: ["expired-no-proof", "expired-proof"] },
      createdAt: { lt: before(24 * 60) }, expiresAt: { lte: NOW }, OR: [{ proofExpiresAt: null }, { proofExpiresAt: { lte: NOW } }] }) });
  });

  test("선택 이후 proof 상태가 바뀌면 삭제 조건을 다시 확인한다", async () => {
    const f = fixture(); const row = f.challenge("changed"); const select = f.db.registrationEmailChallenge.findMany.getMockImplementation()!;
    f.db.registrationEmailChallenge.findMany.mockImplementationOnce(async (query: any) => {
      const selected = await select(query); row.proofExpiresAt = new Date(NOW.getTime() + 600_000); return selected;
    });
    await expect(f.service.purgeExpiredBatch()).resolves.toEqual({ deletedDeliveries: 0, anonymized: 0, deleted: 0, sanitized: 0, moreMayRemain: false });
    expect(f.challenges).toHaveLength(1);
  });

  test("한 배치는 challenge와 가입 인증메일 각각 500개까지만 정리한다", async () => {
    const f = fixture();
    for (let i = 0; i < 501; i += 1) { f.challenge(`challenge-${i}`); f.mail(`mail-${i}`); }
    await expect(f.service.purgeExpiredBatch()).resolves.toEqual({ deletedDeliveries: 0, anonymized: 0, deleted: 500, sanitized: 500, moreMayRemain: true });
    expect(f.challenges).toHaveLength(1); expect(f.deliveries.filter((row) => row.bodyText !== redacted)).toHaveLength(1);
    expect(f.db.registrationEmailChallenge.deleteMany.mock.calls[0][0].where.id.in).toHaveLength(500);
    expect(f.db.emailDelivery.updateMany).toHaveBeenCalledTimes(500);
    await expect(f.service.purgeExpiredBatch()).resolves.toEqual({ deletedDeliveries: 0, anonymized: 0, deleted: 1, sanitized: 1, moreMayRemain: false });
    expect(f.challenges).toHaveLength(0);
  });

  test("유효한 최근 코드·이미 파기한 본문·상담/복구/일반 메일은 보존한다", async () => {
    const f = fixture(); f.mail("expired"); f.mail("recent", { createdAt: before(9) });
    for (const bodyText of [redacted, "인증번호 유효기간 종료", "인증번호 안내 발송 실패", "인증번호 안내 발송 완료"]) f.mail(bodyText, { bodyText });
    f.mail("inquiry", { templateKey: "inquiry.access_code" }); f.mail("reset", { templateKey: "auth.password_reset" }); f.mail("general", { templateKey: "production.invitation" });
    const original = structuredClone(f.deliveries.slice(1));
    await expect(f.service.purgeExpiredBatch()).resolves.toEqual({ deletedDeliveries: 0, anonymized: 0, deleted: 0, sanitized: 1, moreMayRemain: false });
    expect(f.deliveries.slice(1)).toEqual(original);
    expect(f.db.emailDelivery.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 500,
      where: expect.objectContaining({ templateKey: "auth.registration_code", createdAt: { lte: before(10) } }) }));
  });

  test("발송 전 큐만 중단하고 나머지 상태와 PROCESSING lease는 변경하지 않는다", async () => {
    const f = fixture(); f.mail("queued"); const startedAt = before(2);
    f.mail("processing", { status: EmailDeliveryStatus.PROCESSING, attempts: 2, lastAttemptAt: startedAt, nextAttemptAt: null });
    for (const status of [EmailDeliveryStatus.SENT, EmailDeliveryStatus.FAILED, EmailDeliveryStatus.SKIPPED]) f.mail(status, { status, attempts: 3, skippedReason: "EXISTING_REASON" });
    const original = structuredClone(f.deliveries);
    await expect(f.service.purgeExpiredBatch()).resolves.toEqual({ deletedDeliveries: 0, anonymized: 0, deleted: 0, sanitized: 5, moreMayRemain: false });
    expect(f.deliveries[0]).toMatchObject({ status: "SKIPPED", skippedReason: "CODE_EXPIRED_OR_USED", bodyText: redacted, nextAttemptAt: null });
    for (let i = 1; i < original.length; i += 1) expect(f.deliveries[i]).toEqual({ ...original[i], bodyText: redacted });
    expect(f.db.emailDelivery.updateMany.mock.calls[1][0].data).toEqual({ bodyText: redacted });
  });

  test("선택 이후 다른 worker가 선점한 메일은 수정하지 않는다", async () => {
    const f = fixture(); const row = f.mail("claimed"); const select = f.db.emailDelivery.findMany.getMockImplementation()!;
    f.db.emailDelivery.findMany.mockImplementationOnce(async (query: any) => {
      const selected = await select(query); row.status = EmailDeliveryStatus.PROCESSING; row.attempts = 1; row.lastAttemptAt = NOW; return selected;
    });
    await expect(f.service.purgeExpiredBatch()).resolves.toEqual({ deletedDeliveries: 0, anonymized: 0, deleted: 0, sanitized: 0, moreMayRemain: false });
    expect(row).toMatchObject({ status: "PROCESSING", attempts: 1, lastAttemptAt: NOW, bodyText: "회원가입 인증번호: 083215" });
    expect(f.db.emailDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "claimed", status: "QUEUED", updatedAt: before(1) }) }));
  });

  test("메일 발송이 중단된 상태에서도 만료 자료를 정리한다", async () => {
    const previous = process.env.MAIL_SENDING_ENABLED; process.env.MAIL_SENDING_ENABLED = "false";
    try {
      const f = fixture(); f.challenge("expired"); f.mail("expired");
      await expect(f.service.purgeExpiredBatch()).resolves.toEqual({ deletedDeliveries: 0, anonymized: 0, deleted: 1, sanitized: 1, moreMayRemain: false });
    } finally {
      if (previous === undefined) delete process.env.MAIL_SENDING_ENABLED; else process.env.MAIL_SENDING_ENABLED = previous;
    }
  });

  test("24시간 지난 가입 인증 발송 기록은 수신 주소·metadata와 함께 삭제하고 기존 메일은 보존한다", async () => {
    const f = fixture();
    for (const status of [EmailDeliveryStatus.QUEUED, EmailDeliveryStatus.SENT, EmailDeliveryStatus.FAILED, EmailDeliveryStatus.SKIPPED]) {
      f.mail(status, { status, createdAt: before(25 * 60), bodyText: redacted });
    }
    f.mail("within-retention", { createdAt: before(24 * 60 - 1), bodyText: redacted });
    f.mail("exact-retention", { createdAt: before(24 * 60), bodyText: redacted });
    f.mail("old-inquiry", { templateKey: "inquiry.access_code", createdAt: before(25 * 60) });
    f.mail("old-password-reset", { templateKey: "auth.password_reset", createdAt: before(25 * 60) });
    await expect(f.service.purgeExpiredBatch()).resolves.toEqual({ deleted: 0, sanitized: 0, deletedDeliveries: 4, anonymized: 0, moreMayRemain: false });
    expect(f.deliveries.map((row) => row.id)).toEqual(["within-retention", "exact-retention", "old-inquiry", "old-password-reset"]);
    expect(f.db.emailDelivery.deleteMany).toHaveBeenCalledTimes(4);
    expect(f.db.emailDelivery.deleteMany.mock.calls[0][0].where).toMatchObject({ id: "QUEUED", status: "QUEUED", updatedAt: before(1),
      templateKey: "auth.registration_code", createdAt: { lt: before(24 * 60) } });
  });

  test("24시간 지난 PROCESSING 기록은 lease를 유지하고 개인정보만 익명화한다", async () => {
    const f = fixture(); const row = f.mail("processing", { status: EmailDeliveryStatus.PROCESSING, createdAt: before(25 * 60),
      attempts: 2, lastAttemptAt: before(1), nextAttemptAt: NOW });
    const original = structuredClone(row);
    await expect(f.service.purgeExpiredBatch()).resolves.toEqual({ deleted: 0, sanitized: 1, deletedDeliveries: 0, anonymized: 1, moreMayRemain: false });
    expect(f.deliveries).toHaveLength(1);
    expect(row).toEqual({ ...original, toEmail: "expired-registration@example.invalid", metadata: null, providerMessageId: null,
      bodyText: redacted, errorMessage: "REGISTRATION_DATA_EXPIRED" });
    expect(f.db.emailDelivery.updateMany.mock.calls[1][0].data).toEqual({ toEmail: "expired-registration@example.invalid", metadata: Prisma.DbNull,
      providerMessageId: null, bodyText: redacted, errorMessage: "REGISTRATION_DATA_EXPIRED" });
    expect(f.db.emailDelivery.deleteMany).not.toHaveBeenCalled();
    await expect(f.service.purgeExpiredBatch()).resolves.toEqual({ deleted: 0, sanitized: 0, deletedDeliveries: 0, anonymized: 0, moreMayRemain: false });
    expect(f.db.emailDelivery.updateMany).toHaveBeenCalledTimes(2);
  });

  test("24시간 발송 기록 파기도 500개로 제한하고 남은 배치를 보고한다", async () => {
    const f = fixture();
    for (let i = 0; i < 501; i += 1) f.mail(`old-${i}`, { createdAt: before(25 * 60), bodyText: redacted });
    await expect(f.service.purgeExpiredBatch()).resolves.toEqual({ deleted: 0, sanitized: 0, deletedDeliveries: 500, anonymized: 0, moreMayRemain: true });
    expect(f.deliveries).toHaveLength(1); expect(f.db.emailDelivery.deleteMany).toHaveBeenCalledTimes(500);
    await expect(f.service.purgeExpiredBatch()).resolves.toEqual({ deleted: 0, sanitized: 0, deletedDeliveries: 1, anonymized: 0, moreMayRemain: false });
    expect(f.deliveries).toHaveLength(0);
  });

  test("발송 기록 선택 뒤 worker가 선점하면 CAS로 실제 삭제를 건너뛴다", async () => {
    const f = fixture(); const row = f.mail("claimed-old", { createdAt: before(25 * 60), bodyText: redacted });
    const select = f.db.emailDelivery.findMany.getMockImplementation()!;
    f.db.emailDelivery.findMany.mockImplementation(async (query: any) => {
      const selected = await select(query);
      if (query.where.NOT) { row.status = EmailDeliveryStatus.PROCESSING; row.updatedAt = NOW; row.attempts = 1; row.lastAttemptAt = NOW; }
      return selected;
    });
    await expect(f.service.purgeExpiredBatch()).resolves.toEqual({ deleted: 0, sanitized: 0, deletedDeliveries: 0, anonymized: 0, moreMayRemain: false });
    expect(f.deliveries).toHaveLength(1); expect(row.toEmail).toBe("actor@example.invalid");
    expect(row).toMatchObject({ status: "PROCESSING", attempts: 1, updatedAt: NOW, lastAttemptAt: NOW });
    expect(f.db.emailDelivery.deleteMany).toHaveBeenCalledWith({ where: expect.objectContaining({ id: "claimed-old", status: "QUEUED", updatedAt: before(1) }) });
  });
});
