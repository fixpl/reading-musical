import { validateEnvironment } from "./env.validation";

const validResendCredential = `re_${"c".repeat(24)}`;

function productionEnvironment(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: "production",
    APP_PUBLIC_URL: "https://art-bridge.example.com",
    API_EXTERNAL_URL: "https://art-bridge.example.com",
    API_PREFIX: "/api/v1",
    CORS_ORIGINS: "https://art-bridge.example.com",
    DATABASE_URL: "postgresql://user:password@database:5432/app",
    JWT_ACCESS_SECRET: "a".repeat(32),
    JWT_REFRESH_SECRET: "b".repeat(32),
    AUTH_REFRESH_COOKIE_SECURE: "true",
    AUTH_EXPOSE_DEV_RESET_URL: "false",
    ASSET_OBJECT_DIR: "/app/.asset-objects",
    MAIL_TRANSPORT: "resend",
    RESEND_API_KEY: validResendCredential,
    RESEND_FROM_EMAIL: "Art Bridge <mail@example.com>",
    ...overrides
  };
}

describe("validateEnvironment Resend configuration", () => {
  it("accepts Resend as the production mail transport", () => {
    const config = validateEnvironment(productionEnvironment());

    expect(config.MAIL_TRANSPORT).toBe("resend");
    expect(config.RESEND_API_KEY).toBe(validResendCredential);
    expect(config.MAIL_FROM).toBe("Art Bridge <mail@example.com>");
  });

  it("requires a Resend API key when Resend transport is selected", () => {
    expect(() => validateEnvironment(productionEnvironment({ RESEND_API_KEY: "" }))).toThrow(
      "RESEND_API_KEY is required when MAIL_TRANSPORT=resend."
    );
  });

  it("requires a Resend sender when Resend transport is selected", () => {
    expect(() => validateEnvironment(productionEnvironment({ RESEND_FROM_EMAIL: "" }))).toThrow(
      "RESEND_FROM_EMAIL is required when MAIL_TRANSPORT=resend."
    );
  });

  it("rejects a placeholder Resend credential in production", () => {
    expect(() => validateEnvironment(productionEnvironment({ RESEND_API_KEY: "invalid-placeholder" }))).toThrow(
      "RESEND_API_KEY must be a valid non-placeholder Resend credential in production."
    );
  });

  it("rejects invalid sender and reply-to mailboxes", () => {
    expect(() => validateEnvironment(productionEnvironment({ RESEND_FROM_EMAIL: "not-an-email" }))).toThrow(
      "RESEND_FROM_EMAIL must be a valid email address."
    );
    expect(() => validateEnvironment(productionEnvironment({ RESEND_REPLY_TO: "not-an-email" }))).toThrow(
      "RESEND_REPLY_TO must be a valid email address."
    );
  });
});
