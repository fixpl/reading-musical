type EnvConfig = Record<string, string | undefined>;

const DEFAULT_API_PREFIX = "/api/v1";
const DEFAULT_APP_PUBLIC_URL = "http://localhost:5179";
const DEFAULT_CORS_ORIGINS = "http://localhost:5179,http://127.0.0.1:5179";
const DEFAULT_MAIL_HOST = "localhost";
const DEFAULT_MAIL_PORT = "1025";
const DEFAULT_MAIL_FROM = "no-reply@reading-musical.local";
const DEFAULT_MAIL_TRANSPORT = "smtp";
const PRODUCTION_SECRET_PLACEHOLDERS = new Set(["change-me", "change-me-strong", "secret", "password"]);
const DEFAULT_RATE_LIMIT_WINDOW_MS = "60000";
const RATE_LIMIT_DEFAULTS = [
  ["RATE_LIMIT_LOGIN_LIMIT", "60", 1, 10000],
  ["RATE_LIMIT_LOGIN_WINDOW_MS", DEFAULT_RATE_LIMIT_WINDOW_MS, 1000, 86400000],
  ["RATE_LIMIT_REGISTER_LIMIT", "20", 1, 10000],
  ["RATE_LIMIT_REGISTER_WINDOW_MS", DEFAULT_RATE_LIMIT_WINDOW_MS, 1000, 86400000],
  ["RATE_LIMIT_PASSWORD_RESET_LIMIT", "20", 1, 10000],
  ["RATE_LIMIT_PASSWORD_RESET_WINDOW_MS", DEFAULT_RATE_LIMIT_WINDOW_MS, 1000, 86400000],
  ["RATE_LIMIT_USER_SEARCH_LIMIT", "120", 1, 10000],
  ["RATE_LIMIT_USER_SEARCH_WINDOW_MS", DEFAULT_RATE_LIMIT_WINDOW_MS, 1000, 86400000],
  ["RATE_LIMIT_INQUIRY_LIMIT", "10", 1, 10000],
  ["RATE_LIMIT_INQUIRY_WINDOW_MS", DEFAULT_RATE_LIMIT_WINDOW_MS, 1000, 86400000],
  ["RATE_LIMIT_EVENT_CREATE_LIMIT", "30", 1, 10000],
  ["RATE_LIMIT_EVENT_CREATE_WINDOW_MS", DEFAULT_RATE_LIMIT_WINDOW_MS, 1000, 86400000],
  ["RATE_LIMIT_AI_DRAFT_LIMIT", "5", 1, 10000],
  ["RATE_LIMIT_AI_DRAFT_WINDOW_MS", DEFAULT_RATE_LIMIT_WINDOW_MS, 1000, 86400000],
  ["RATE_LIMIT_AI_EXTRACT_LIMIT", "20", 1, 10000],
  ["RATE_LIMIT_AI_EXTRACT_WINDOW_MS", DEFAULT_RATE_LIMIT_WINDOW_MS, 1000, 86400000],
  ["RATE_LIMIT_AI_APPLY_LIMIT", "10", 1, 10000],
  ["RATE_LIMIT_AI_APPLY_WINDOW_MS", DEFAULT_RATE_LIMIT_WINDOW_MS, 1000, 86400000]
] as const;

export function validateEnvironment(config: EnvConfig) {
  const nodeEnv = config.NODE_ENV || "development";
  const isProduction = nodeEnv === "production";
  const next: EnvConfig = { ...config };

  if (isProduction && !config.CORS_ORIGINS?.trim()) {
    throw new Error("CORS_ORIGINS is required in production.");
  }

  next.API_PREFIX = normalizeApiPrefix(config.API_PREFIX || DEFAULT_API_PREFIX);
  next.PORT = normalizePort(config.PORT || "3000");
  next.APP_PUBLIC_URL = normalizeAbsoluteUrl(config.APP_PUBLIC_URL || DEFAULT_APP_PUBLIC_URL, "APP_PUBLIC_URL");
  next.API_EXTERNAL_URL = normalizeAbsoluteUrl(config.API_EXTERNAL_URL || `http://localhost:${next.PORT}`, "API_EXTERNAL_URL");
  next.CORS_ORIGINS = normalizeCorsOrigins(config.CORS_ORIGINS || DEFAULT_CORS_ORIGINS, isProduction);
  next.DATABASE_URL = normalizeDatabaseUrl(config.DATABASE_URL);
  next.JWT_ACCESS_EXPIRES_IN = normalizeDuration(config.JWT_ACCESS_EXPIRES_IN || "15m", "JWT_ACCESS_EXPIRES_IN");
  next.JWT_REFRESH_EXPIRES_IN = normalizeDuration(config.JWT_REFRESH_EXPIRES_IN || "7d", "JWT_REFRESH_EXPIRES_IN");
  next.AUTH_MAX_FAILED_LOGIN_ATTEMPTS = normalizeInteger(
    config.AUTH_MAX_FAILED_LOGIN_ATTEMPTS || "5",
    "AUTH_MAX_FAILED_LOGIN_ATTEMPTS",
    1,
    100
  );
  next.AUTH_LOGIN_LOCK_MINUTES = normalizeInteger(config.AUTH_LOGIN_LOCK_MINUTES || "15", "AUTH_LOGIN_LOCK_MINUTES", 1, 10080);
  next.AUTH_REFRESH_COOKIE_NAME = normalizeCookieName(config.AUTH_REFRESH_COOKIE_NAME || "reading_musical_refresh");
  next.AUTH_REFRESH_COOKIE_SAMESITE = normalizeSameSite(config.AUTH_REFRESH_COOKIE_SAMESITE || "lax");
  next.AUTH_REFRESH_COOKIE_SECURE = normalizeBoolean(
    config.AUTH_REFRESH_COOKIE_SECURE ?? (isProduction ? "true" : "false"),
    "AUTH_REFRESH_COOKIE_SECURE"
  );
  next.AUTH_EXPOSE_DEV_RESET_URL = normalizeBoolean(config.AUTH_EXPOSE_DEV_RESET_URL || "false", "AUTH_EXPOSE_DEV_RESET_URL");
  next.RATE_LIMIT_TRUST_PROXY = normalizeBoolean(config.RATE_LIMIT_TRUST_PROXY || "false", "RATE_LIMIT_TRUST_PROXY");
  next.MAIL_TRANSPORT = normalizeMailTransport(config.MAIL_TRANSPORT || DEFAULT_MAIL_TRANSPORT, isProduction);
  next.RESEND_API_KEY = config.RESEND_API_KEY?.trim();
  next.RESEND_FROM_EMAIL = config.RESEND_FROM_EMAIL?.trim();
  next.RESEND_REPLY_TO = config.RESEND_REPLY_TO?.trim();
  next.MAIL_HOST = (config.MAIL_HOST || DEFAULT_MAIL_HOST).trim();
  next.MAIL_PORT = normalizePort(config.MAIL_PORT || DEFAULT_MAIL_PORT);
  next.MAIL_FROM = (next.MAIL_TRANSPORT === "resend" ? next.RESEND_FROM_EMAIL : config.MAIL_FROM || DEFAULT_MAIL_FROM)?.trim();
  next.MAIL_SECURE = normalizeBoolean(config.MAIL_SECURE || "false", "MAIL_SECURE");
  next.MAIL_WORKER_BATCH_SIZE = normalizeInteger(config.MAIL_WORKER_BATCH_SIZE || "25", "MAIL_WORKER_BATCH_SIZE", 1, 100);
  next.MAIL_WORKER_INTERVAL_MS = normalizeInteger(config.MAIL_WORKER_INTERVAL_MS || "30000", "MAIL_WORKER_INTERVAL_MS", 1000, 86400000);
  next.MAIL_WORKER_PROCESSING_TIMEOUT_MS = normalizeInteger(
    config.MAIL_WORKER_PROCESSING_TIMEOUT_MS || "300000",
    "MAIL_WORKER_PROCESSING_TIMEOUT_MS",
    30000,
    86400000
  );
  next.MAIL_WORKER_RETRY_DELAY_MS = normalizeInteger(config.MAIL_WORKER_RETRY_DELAY_MS || "300000", "MAIL_WORKER_RETRY_DELAY_MS", 1000, 86400000);
  next.MAIL_WORKER_MAX_ATTEMPTS = normalizeInteger(config.MAIL_WORKER_MAX_ATTEMPTS || "3", "MAIL_WORKER_MAX_ATTEMPTS", 1, 10);
  next.MAIL_DIGEST_WINDOW_MS = normalizeInteger(config.MAIL_DIGEST_WINDOW_MS || "3600000", "MAIL_DIGEST_WINDOW_MS", 60000, 86400000);
  next.ATTENDANCE_REMINDER_LOOKAHEAD_HOURS = normalizeInteger(
    config.ATTENDANCE_REMINDER_LOOKAHEAD_HOURS || "24",
    "ATTENDANCE_REMINDER_LOOKAHEAD_HOURS",
    1,
    168
  );
  next.SIGNED_URL_TTL = normalizeInteger(config.SIGNED_URL_TTL || "600", "SIGNED_URL_TTL", 60, 86400);
  next.ASSET_OBJECT_DIR = normalizeObjectDir(config.ASSET_OBJECT_DIR === undefined ? ".asset-objects" : config.ASSET_OBJECT_DIR);
  for (const [key, fallback, min, max] of RATE_LIMIT_DEFAULTS) {
    next[key] = normalizeInteger(config[key] || fallback, key, min, max);
  }


  requireEnv(next, "JWT_ACCESS_SECRET");
  requireEnv(next, "JWT_REFRESH_SECRET");

  if (next.MAIL_TRANSPORT === "smtp") {
    requireEnv(next, "MAIL_HOST");
  }
  if (next.MAIL_TRANSPORT === "resend") {
    if (!next.RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY is required when MAIL_TRANSPORT=resend.");
    }
    if (!next.RESEND_FROM_EMAIL) {
      throw new Error("RESEND_FROM_EMAIL is required when MAIL_TRANSPORT=resend.");
    }
    assertEmailAddress("RESEND_FROM_EMAIL", next.RESEND_FROM_EMAIL);
    if (next.RESEND_REPLY_TO) {
      assertEmailAddress("RESEND_REPLY_TO", next.RESEND_REPLY_TO);
    }
    if (isProduction) {
      assertResendCredential(next.RESEND_API_KEY);
    }
  }
  requireEnv(next, "MAIL_FROM");

  if (isProduction) {
    assertExplicitProductionValue(config, "APP_PUBLIC_URL");
    assertExplicitProductionValue(config, "API_EXTERNAL_URL");
    assertHttpsUrl("APP_PUBLIC_URL", next.APP_PUBLIC_URL);
    assertHttpsUrl("API_EXTERNAL_URL", next.API_EXTERNAL_URL);
    assertProductionSecret("JWT_ACCESS_SECRET", next.JWT_ACCESS_SECRET);
    assertProductionSecret("JWT_REFRESH_SECRET", next.JWT_REFRESH_SECRET);
    if (next.JWT_PASSWORD_RESET_SECRET) {
      assertProductionSecret("JWT_PASSWORD_RESET_SECRET", next.JWT_PASSWORD_RESET_SECRET);
    }
    if (next.AUTH_REFRESH_COOKIE_SECURE !== "true") {
      throw new Error("AUTH_REFRESH_COOKIE_SECURE must be true in production.");
    }
    if (next.AUTH_EXPOSE_DEV_RESET_URL === "true") {
      throw new Error("AUTH_EXPOSE_DEV_RESET_URL must be false in production.");
    }
    if (!next.ASSET_OBJECT_DIR?.startsWith("/")) {
      throw new Error("ASSET_OBJECT_DIR must be an absolute path in production.");
    }
  }

  if (Boolean(config.MAIL_USER?.trim()) !== Boolean(config.MAIL_PASSWORD?.trim())) {
    throw new Error("MAIL_USER and MAIL_PASSWORD must be provided together.");
  }

  const sameSite = next.AUTH_REFRESH_COOKIE_SAMESITE;
  const secure = next.AUTH_REFRESH_COOKIE_SECURE === "true";
  if (sameSite === "none" && !secure) {
    throw new Error("AUTH_REFRESH_COOKIE_SECURE=true is required when AUTH_REFRESH_COOKIE_SAMESITE=none.");
  }

  return next;
}

function requireEnv(config: EnvConfig, key: string) {
  if (!config[key]?.trim()) {
    throw new Error(`${key} is required.`);
  }
}

function assertProductionSecret(key: string, value: string | undefined) {
  const secret = value?.trim() || "";
  const normalized = secret.toLowerCase();
  if (secret.length < 32 || PRODUCTION_SECRET_PLACEHOLDERS.has(normalized) || normalized.includes("replace-with")) {
    throw new Error(`${key} must be a non-placeholder secret with at least 32 characters in production.`);
  }
}

function assertResendCredential(value: string) {
  const credential = value.trim();
  const normalized = credential.toLowerCase();
  if (!/^re_\S{20,}$/.test(credential) || normalized.includes("replace") || normalized.includes("placeholder")) {
    throw new Error("RESEND_API_KEY must be a valid non-placeholder Resend credential in production.");
  }
}

function assertEmailAddress(key: string, value: string) {
  const trimmed = value.trim();
  const displayNameMatch = trimmed.match(/^[^<>]+<([^<>]+)>$/);
  const mailbox = displayNameMatch?.[1]?.trim() || trimmed;
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(mailbox)) {
    throw new Error(`${key} must be a valid email address.`);
  }
}

function assertExplicitProductionValue(config: EnvConfig, key: string) {
  if (!config[key]?.trim()) {
    throw new Error(`${key} must be explicitly configured in production.`);
  }
}

function assertHttpsUrl(key: string, value: string | undefined) {
  if (!value?.startsWith("https://")) {
    throw new Error(`${key} must use https in production.`);
  }
}

function normalizeApiPrefix(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_API_PREFIX;
  }
  const normalized = `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
  if (normalized === "/") {
    throw new Error("API_PREFIX must include a path segment, for example /api/v1.");
  }
  return normalized;
}

function normalizeAbsoluteUrl(value: string, key: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
    return trimmed;
  } catch {
    throw new Error(`${key} must be an absolute http(s) URL.`);
  }
}

function normalizeCorsOrigins(value: string, isProduction: boolean) {
  const origins = value
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);

  if (origins.length === 0) {
    throw new Error("CORS_ORIGINS must contain at least one origin.");
  }
  if (isProduction && origins.includes("*")) {
    throw new Error("CORS_ORIGINS cannot contain * in production.");
  }
  for (const origin of origins) {
    if (origin === "*" && !isProduction) {
      continue;
    }
    const normalized = normalizeAbsoluteUrl(origin, "CORS_ORIGINS");
    if (isProduction && !normalized.startsWith("https://")) {
      throw new Error("CORS_ORIGINS must use https origins in production.");
    }
  }
  return origins.join(",");
}

function normalizeDatabaseUrl(value: string | undefined) {
  if (!value?.trim()) {
    throw new Error("DATABASE_URL is required.");
  }
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
      throw new Error("unsupported protocol");
    }
    return value.trim();
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL.");
  }
}

function normalizeDuration(value: string, key: string) {
  const normalized = value.trim();
  if (!/^\d+(ms|s|m|h|d)$/.test(normalized)) {
    throw new Error(`${key} must be a duration such as 15m, 12h, or 7d.`);
  }
  return normalized;
}

function normalizeCookieName(value: string) {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw new Error("AUTH_REFRESH_COOKIE_NAME must contain only letters, numbers, underscores, or hyphens.");
  }
  return normalized;
}

function normalizeSameSite(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized !== "lax" && normalized !== "strict" && normalized !== "none") {
    throw new Error("AUTH_REFRESH_COOKIE_SAMESITE must be lax, strict, or none.");
  }
  return normalized;
}

function normalizePort(value: string) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  return String(port);
}

function normalizeInteger(value: string, key: string, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${key} must be an integer between ${min} and ${max}.`);
  }
  return String(parsed);
}

function normalizeBoolean(value: string, key: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized !== "true" && normalized !== "false") {
    throw new Error(`${key} must be true or false.`);
  }
  return normalized;
}

function normalizeMailTransport(value: string, isProduction: boolean) {
  const normalized = value.trim().toLowerCase();
  if (normalized !== "smtp" && normalized !== "json" && normalized !== "resend") {
    throw new Error("MAIL_TRANSPORT must be smtp, json, or resend.");
  }
  if (isProduction && normalized === "json") {
    throw new Error("MAIL_TRANSPORT must be smtp or resend in production.");
  }
  return normalized;
}

function normalizeObjectDir(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("ASSET_OBJECT_DIR must not be empty.");
  }
  return trimmed;
}
