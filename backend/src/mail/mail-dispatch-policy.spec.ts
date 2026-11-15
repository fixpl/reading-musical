import { mailReadiness, prepareResendDispatch, retryDecision, RESEND_RETRY_WINDOW_MS } from "./mail-dispatch-policy";
import { ResendDeliveryError } from "./resend-mail.transport";
import { ConfigService } from "@nestjs/config";
const delivery = { id: "mail", toEmail: "to@example.invalid", subject: "subject", bodyText: "private text", templateKey: "inquiry.reply", attempts: 0, metadata: { inquiryId: "inquiry" } };
const sender = { from: "Art Bridge <mail@example.invalid>", replyTo: "support@example.invalid" };

describe("mail dispatch policy", () => {
  it("pauses without credentials and never exposes configuration values", () => {
    const config = new ConfigService({ MAIL_TRANSPORT: "resend", MAIL_SENDING_ENABLED: "false" });
    expect(mailReadiness(config)).toEqual({ ready: false, transport: "resend", reason: "PAUSED" });
    expect(mailReadiness(new ConfigService({ MAIL_TRANSPORT: "resend" })).reason).toBe("CONFIGURATION_REQUIRED");
  });
  it("does not allow JSON transport in production", () => {
    expect(mailReadiness(new ConfigService({ MAIL_TRANSPORT: "json", NODE_ENV: "production" })).ready).toBe(false);
  });
  it("records the immutable sender and first attempt without a key or message copy", () => {
    const result = prepareResendDispatch(delivery, sender, 1000);
    expect(result.snapshot.firstAttemptAt).toBe(new Date(1000).toISOString());
    expect(result.metadata).toMatchObject({ inquiryId: "inquiry" });
    expect(result.snapshot.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result.metadata)).not.toContain(delivery.bodyText);
    expect(result.snapshot).not.toHaveProperty("credential");
  });
  it("keeps the original sender on retry even after deployment configuration changes", () => {
    const first = prepareResendDispatch(delivery, sender, 1000);
    const second = prepareResendDispatch({ ...delivery, attempts: 1, metadata: first.metadata }, { from: "new@example.invalid" }, 2000);
    expect(second.snapshot).toEqual(first.snapshot);
  });
  it.each(["bodyText", "toEmail", "subject", "templateKey"])("refuses changed retry payload field %s", (key) => {
    const first = prepareResendDispatch(delivery, sender, 1000);
    expect(() => prepareResendDispatch({ ...delivery, attempts: 1, metadata: first.metadata, [key]: "changed" }, sender, 2000)).toThrow("PAYLOAD_CHANGED");
  });
  it("refuses legacy retries without a frozen payload instead of risking duplicates", () => {
    expect(() => prepareResendDispatch({ ...delivery, attempts: 1 }, sender)).toThrow("LEGACY_RETRY_REQUIRES_REVIEW");
  });
  it("stops automatic retry before the provider 24-hour idempotency window", () => {
    const first = prepareResendDispatch(delivery, sender, 1000);
    expect(() => prepareResendDispatch({ ...delivery, attempts: 1, metadata: first.metadata }, sender, 1000 + RESEND_RETRY_WINDOW_MS)).toThrow("RETRY_WINDOW_EXPIRED");
  });
  it("does not restart the retry clock when a worker restarts", () => {
    const first = prepareResendDispatch(delivery, sender, 1000);
    expect(prepareResendDispatch({ ...delivery, attempts: 2, metadata: first.metadata }, sender, 3000).snapshot.firstAttemptAt).toBe(first.snapshot.firstAttemptAt);
  });
  it("uses exponential retry, jitter and the longer Retry-After delay", () => {
    const error = new ResendDeliveryError("RATE_LIMITED", true, 429, 300000);
    expect(retryDecision(error, 2, 4, 60000, () => 0)).toMatchObject({ terminal: false, delayMs: 300000, pauseBatch: true });
    expect(retryDecision(new Error("private recipient data"), 2, 4, 60000, () => 0)).toMatchObject({ delayMs: 120000, errorMessage: "MAIL_TRANSPORT_FAILED" });
  });
  it("does not retry invalid requests and exhausted attempts", () => {
    expect(retryDecision(new ResendDeliveryError("REQUEST_REJECTED", false, 422), 1, 4, 1000).terminal).toBe(true);
    expect(retryDecision(new ResendDeliveryError("TRANSPORT_UNCERTAIN", true), 4, 4, 1000).terminal).toBe(true);
  });
});
