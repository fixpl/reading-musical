import { validateEnvironment } from "./env.validation";
import { MailStatusController } from "../mail/mail-status.controller";
import { MailService } from "../mail/mail.service";
import { PrismaService } from "../prisma/prisma.service";
import { PLATFORM_ROLES_KEY } from "../common/decorators/platform-roles.decorator";
const { inspect } = require("../../scripts/deploy-preflight.cjs") as { inspect: (env: Record<string, string>, validate: typeof validateEnvironment) => { configurationValid: boolean; readyForMailTest: boolean; externalServicesVerified: boolean; mailPaused: boolean; problems: string[] } };
const production = () => ({ NODE_ENV: "production", APP_PUBLIC_URL: "https://app.example.invalid", API_EXTERNAL_URL: "https://api.example.invalid", CORS_ORIGINS: "https://app.example.invalid", DATABASE_URL: "postgresql://test:test@127.0.0.1:1/not_used", JWT_ACCESS_SECRET: "a".repeat(32), JWT_REFRESH_SECRET: "b".repeat(32), ASSET_OBJECT_DIR: "/app/.asset-objects", MAIL_TRANSPORT: "resend", MAIL_SENDING_ENABLED: "false" });
describe("offline deployment preflight", () => {
  it("keeps missing-key deployment explicitly paused, not ready for mail tests", () => {
    const result = inspect(production(), validateEnvironment);
    expect(result).toMatchObject({ configurationValid: true, readyForMailTest: false, mailPaused: true, externalServicesVerified: false });
  });
  it("blocks enabling send without credentials", () => {
    const result = inspect({ ...production(), MAIL_SENDING_ENABLED: "true" }, validateEnvironment);
    expect(result.configurationValid).toBe(false); expect(result.problems.join()).toContain("RESEND_API_KEY");
  });
  it("never treats valid config as verified provider or database availability", () => {
    const env = { ...production(), MAIL_SENDING_ENABLED: "true", RESEND_API_KEY: `re_${"x".repeat(24)}`, RESEND_FROM_EMAIL: "mail@example.invalid" };
    const result = inspect(env, validateEnvironment);
    expect(result.readyForMailTest).toBe(true); expect(result.externalServicesVerified).toBe(false);
    for (const secret of [env.DATABASE_URL, env.JWT_ACCESS_SECRET, env.JWT_REFRESH_SECRET, env.RESEND_API_KEY]) expect(JSON.stringify(result)).not.toContain(secret);
  });
  it("refuses an accidental development configuration for release", () => {
    const result = inspect({ ...production(), NODE_ENV: "development" }, validateEnvironment);
    expect(result.problems.join()).toContain("NODE_ENV"); expect(result.readyForMailTest).toBe(false);
  });
});
describe("administrator mail status", () => {
  it("has explicit highest-admin authorization and exposes only status/counts", async () => {
    expect(Reflect.getMetadata(PLATFORM_ROLES_KEY, MailStatusController)).toEqual(["SUPER_ADMIN"]);
    const db = { emailDelivery: { groupBy: jest.fn().mockResolvedValue([{ status: "QUEUED", _count: { _all: 3 } }]), findFirst: jest.fn().mockResolvedValue({ createdAt: new Date(1000) }) } };
    const mail = { deliveryReadiness: () => ({ ready: false, transport: "resend", reason: "PAUSED" }) };
    const result = await new MailStatusController(mail as unknown as MailService, db as unknown as PrismaService).readiness();
    expect(result).toEqual({ ready: false, transport: "resend", reason: "PAUSED", configurationOnly: true, counts: { QUEUED: 3 }, oldestQueuedAt: new Date(1000) });
    expect(db.emailDelivery.findFirst.mock.calls[0][0].select).toEqual({ createdAt: true });
  });
});
