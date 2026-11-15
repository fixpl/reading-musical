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

describe("local environment defaults", () => {
  it("uses the documented frontend port without weakening production validation", () => {
    const config = validateEnvironment({
      DATABASE_URL: "postgresql://local:local@127.0.0.1:5432/local_test",
      JWT_ACCESS_SECRET: "local-test-access",
      JWT_REFRESH_SECRET: "local-test-refresh"
    });
    expect(config.APP_PUBLIC_URL).toBe("http://localhost:5179");
    expect(config.CORS_ORIGINS).toBe("http://localhost:5179,http://127.0.0.1:5179");
    expect(() => validateEnvironment(productionEnvironment({ CORS_ORIGINS: "" }))).toThrow();
    expect(() => validateEnvironment(productionEnvironment({ JWT_ACCESS_SECRET: "change-me" }))).toThrow();
  });
});

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

describe("deployment configuration boundaries", () => {
  it("permits explicitly paused Resend without keys while keeping production authentication strict", () => {
    const config = validateEnvironment(productionEnvironment({ MAIL_SENDING_ENABLED: "false", RESEND_API_KEY: "", RESEND_FROM_EMAIL: "" }));
    expect(config.MAIL_SENDING_ENABLED).toBe("false"); expect(config.MAIL_TRANSPORT).toBe("resend");
    expect(() => validateEnvironment(productionEnvironment({ MAIL_SENDING_ENABLED: "false", JWT_ACCESS_SECRET: "weak" }))).toThrow("JWT_ACCESS_SECRET");
  });
  it("requires credentials as soon as sending is enabled", () => {
    expect(() => validateEnvironment(productionEnvironment({ MAIL_SENDING_ENABLED: "true", RESEND_API_KEY: "" }))).toThrow("RESEND_API_KEY");
    expect(() => validateEnvironment(productionEnvironment({ MAIL_SENDING_ENABLED: "yes" }))).toThrow("MAIL_SENDING_ENABLED");
  });
  it.each(["https://user:pass@example.com", "https://example.com?token=secret", "https://example.com#fragment"])("rejects unsafe public base URL %s", (APP_PUBLIC_URL) => {
    expect(() => validateEnvironment(productionEnvironment({ APP_PUBLIC_URL }))).toThrow("APP_PUBLIC_URL");
  });
  it("rejects path-containing CORS origins and mail header injection", () => {
    expect(() => validateEnvironment(productionEnvironment({ CORS_ORIGINS: "https://example.com/path" }))).toThrow("CORS_ORIGINS");
    const injected = `Sender${String.fromCharCode(13, 10)}Bcc: other@example.com <mail@example.com>`;
    expect(() => validateEnvironment(productionEnvironment({ RESEND_FROM_EMAIL: injected }))).toThrow("RESEND_FROM_EMAIL");
  });
});

describe("validateEnvironment asset storage", () => {
  const r2 = { ASSET_STORAGE: "r2", R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef", R2_ACCESS_KEY_ID: "k".repeat(32), R2_SECRET_ACCESS_KEY: "s".repeat(64), R2_BUCKET: "attachment" };

  it("defaults to local disk and rejects unknown drivers", () => {
    expect(validateEnvironment(productionEnvironment()).ASSET_STORAGE).toBe("local");
    expect(() => validateEnvironment(productionEnvironment({ ASSET_STORAGE: "s3" }))).toThrow("ASSET_STORAGE");
  });

  it("requires the R2 credentials, and then no longer needs a local object directory in production", () => {
    expect(() => validateEnvironment(productionEnvironment({ ...r2, R2_BUCKET: "" }))).toThrow("R2_BUCKET");
    const config = validateEnvironment(productionEnvironment({ ...r2, ASSET_OBJECT_DIR: ".relative" }));
    expect(config.ASSET_STORAGE).toBe("r2");
    expect(config.UPLOAD_URL_TTL).toBe("3600");
    expect(() => validateEnvironment(productionEnvironment({ ASSET_OBJECT_DIR: ".relative" }))).toThrow("ASSET_OBJECT_DIR");
  });

  it("catches pasted placeholders and malformed values at startup", () => {
    expect(() => validateEnvironment(productionEnvironment({ ...r2, R2_ACCESS_KEY_ID: "..." }))).toThrow("R2_ACCESS_KEY_ID");
    expect(() => validateEnvironment(productionEnvironment({ ...r2, R2_SECRET_ACCESS_KEY: "short" }))).toThrow("R2_SECRET_ACCESS_KEY");
    expect(() => validateEnvironment(productionEnvironment({ ...r2, R2_BUCKET: "R2_BUCKETattachment" }))).toThrow("R2_BUCKET");
    expect(() => validateEnvironment(productionEnvironment({ ...r2, R2_ACCOUNT_ID: "abc" }))).toThrow("R2_ACCOUNT_ID");
  });

  it("validates and normalizes the explicit legacy project list at startup", () => {
    const config = validateEnvironment(productionEnvironment({ ...r2, R2_PROJECT_NAME: "art-bridge", R2_LEGACY_PROJECT_NAMES: " reading-musical,art-bridge,reading-musical " }));
    expect(config.R2_PROJECT_NAME).toBe("art-bridge");
    expect(config.R2_LEGACY_PROJECT_NAMES).toBe("reading-musical");
    expect(() => validateEnvironment(productionEnvironment({ ...r2, R2_LEGACY_PROJECT_NAMES: "../other" }))).toThrow("R2_LEGACY_PROJECT_NAMES");
    expect(() => validateEnvironment(productionEnvironment({ ...r2, R2_LEGACY_PROJECT_NAMES: "old,,other" }))).toThrow("R2_LEGACY_PROJECT_NAMES");
    expect(() => validateEnvironment(productionEnvironment({ ...r2, R2_PROJECT_NAME: "../other" }))).toThrow("R2_PROJECT_NAME");
  });
});
