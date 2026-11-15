import { createHash } from "node:crypto";
import { ResendDeliveryError } from "./resend-mail.transport";

type ConfigReader = { get<T = string>(key: string): T | undefined };
export function mailReadiness(config: ConfigReader) {
  const transport = (config.get<string>("MAIL_TRANSPORT") || "smtp").trim().toLowerCase();
  const enabled = String(config.get("MAIL_SENDING_ENABLED") ?? "true").toLowerCase() === "true";
  if (!enabled) return { ready: false, transport, reason: "PAUSED" as const };
  if (transport === "resend" && (!config.get<string>("RESEND_API_KEY")?.trim() || !config.get<string>("RESEND_FROM_EMAIL")?.trim())) {
    return { ready: false, transport, reason: "CONFIGURATION_REQUIRED" as const };
  }
  if (!["smtp", "resend", "json"].includes(transport) || (transport === "json" && config.get("NODE_ENV") === "production")) {
    return { ready: false, transport, reason: "INVALID_TRANSPORT" as const };
  }
  return { ready: true, transport, reason: null };
}

export const RESEND_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
export function metadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export type MailContent = { id: string; toEmail: string; subject: string; bodyText: string; templateKey: string; attempts: number; metadata: unknown };
type DispatchSnapshot = { transport: "resend"; firstAttemptAt: string; from: string; replyTo: string | null; digest: string };

/** Freeze non-secret sending configuration. An idempotency key must never be paired with a changed payload. */
export function prepareResendDispatch(delivery: MailContent, sender: { from: string; replyTo?: string }, now = Date.now()) {
  const metadata = metadataObject(delivery.metadata);
  const stored = metadataObject(metadata.mailDispatch);
  let from = sender.from;
  let replyTo = sender.replyTo || null;
  let firstAttemptAt = new Date(now).toISOString();
  if (delivery.attempts > 0 || Object.keys(stored).length > 0) {
    if (stored.transport !== "resend" || typeof stored.from !== "string" || typeof stored.firstAttemptAt !== "string"
      || typeof stored.digest !== "string" || !(stored.replyTo === null || typeof stored.replyTo === "string")) {
      throw new ResendDeliveryError("LEGACY_RETRY_REQUIRES_REVIEW", false);
    }
    const started = Date.parse(stored.firstAttemptAt);
    if (!Number.isFinite(started) || started > now || now - started >= RESEND_RETRY_WINDOW_MS) {
      throw new ResendDeliveryError("RETRY_WINDOW_EXPIRED", false);
    }
    from = stored.from; replyTo = stored.replyTo; firstAttemptAt = stored.firstAttemptAt;
  }
  const digest = createHash("sha256").update(JSON.stringify({ from, replyTo, to: delivery.toEmail, subject: delivery.subject,
    text: delivery.bodyText, templateKey: delivery.templateKey, id: delivery.id })).digest("hex");
  if (typeof stored.digest === "string" && stored.digest !== digest) throw new ResendDeliveryError("PAYLOAD_CHANGED", false);
  const snapshot: DispatchSnapshot = { transport: "resend", from, replyTo, firstAttemptAt, digest };
  return { snapshot, metadata: { ...metadata, mailDispatch: snapshot } };
}

export function retryDecision(error: unknown, attempt: number, maxAttempts: number, baseDelayMs: number, random = Math.random) {
  const known = error instanceof ResendDeliveryError;
  const terminal = attempt >= maxAttempts || (known && !error.retryable);
  const exponential = Math.min(3600000, baseDelayMs * 2 ** Math.max(0, attempt - 1));
  const jitter = Math.floor(exponential * 0.2 * random());
  return { terminal, delayMs: Math.max(exponential + jitter, known ? error.retryAfterMs : 0),
    errorMessage: known ? error.message : "MAIL_TRANSPORT_FAILED",
    pauseBatch: known && (error.configurationError || error.status === 429) };
}
