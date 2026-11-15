import { ResendDeliveryError, resendRetryAfter, sendResendEmail } from "./resend-mail.transport";
const input = { credential: "test-only-not-a-live-key", idempotencyKey: "email-delivery/123", from: "Art Bridge <mail@example.invalid>", replyTo: "support@example.invalid", to: "member@example.invalid", subject: "Invitation", text: "private message", headers: { "X-Reading-Musical-Delivery": "123" } };

describe("Resend HTTP contract (mock fetch only)", () => {
  it("uses standard authorization, a stable key, reply-to and a timeout without following redirects", async () => {
    const sender = jest.fn().mockResolvedValue(new Response(JSON.stringify({ id: "provider-id" }), { status: 200 }));
    expect(await sendResendEmail(input, sender)).toEqual({ messageId: "provider-id" });
    const [url, request] = sender.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(request).toMatchObject({ method: "POST", redirect: "error", signal: expect.any(AbortSignal), headers: { Authorization: `Bearer ${input.credential}`, "Idempotency-Key": input.idempotencyKey } });
    expect(JSON.parse(request.body)).toEqual({ from: input.from, to: [input.to], subject: input.subject, text: input.text, reply_to: input.replyTo, headers: input.headers });
  });
  it.each([
    [400, "validation_error", false], [401, "missing_api_key", false], [403, "validation_error", false],
    [409, "invalid_idempotent_request", false], [409, "concurrent_idempotent_requests", true],
    [422, "validation_error", false], [429, "rate_limit_exceeded", true], [500, "internal_server_error", true], [503, "application_error", true]
  ])("classifies HTTP %s/%s retries", async (status, name, retryable) => {
    const sender = jest.fn().mockResolvedValue(new Response(JSON.stringify({ name, message: `${input.credential}: ${input.to}: ${input.text}` }), { status: Number(status), headers: { "Retry-After": "120" } }));
    const error = await sendResendEmail(input, sender).catch((value) => value);
    expect(error).toBeInstanceOf(ResendDeliveryError); expect(error.retryable).toBe(retryable); expect(error.retryAfterMs).toBe(120000);
    expect(error.message).not.toContain(input.credential); expect(error.message).not.toContain(input.to); expect(error.message).not.toContain(input.text);
  });
  it("does not log raw HTML or a non-JSON provider error", async () => {
    const error = await sendResendEmail(input, jest.fn().mockResolvedValue(new Response(`<html>${input.credential}</html>`, { status: 502 }))).catch((value) => value);
    expect(error.message).toBe("Resend PROVIDER_UNAVAILABLE (HTTP 502)");
  });
  it("treats network failures and missing success ids as uncertain, retryable responses", async () => {
    for (const sender of [jest.fn().mockRejectedValue(new Error(input.credential)), jest.fn().mockResolvedValue(new Response('{}', { status: 200 }))]) {
      const error = await sendResendEmail(input, sender).catch((value) => value); expect(error.retryable).toBe(true); expect(error.message).not.toContain(input.credential);
    }
  });
  it("fails missing or malformed local configuration before making a request", async () => {
    const sender = jest.fn();
    await expect(sendResendEmail({ ...input, credential: "" }, sender)).rejects.toThrow("CONFIGURATION_REQUIRED");
    await expect(sendResendEmail({ ...input, idempotencyKey: "x".repeat(257) }, sender)).rejects.toThrow("INVALID_IDEMPOTENCY_KEY");
    expect(sender).not.toHaveBeenCalled();
  });
  it("parses numeric and HTTP-date Retry-After safely", () => {
    expect(resendRetryAfter("1.5")).toBe(1500);
    expect(resendRetryAfter("Wed, 01 Jan 2025 00:01:00 GMT", Date.parse("2025-01-01T00:00:00Z"))).toBe(60000);
    for (const value of [null, "", "nonsense"]) expect(resendRetryAfter(value)).toBe(0);
    expect(resendRetryAfter("999999999")).toBe(86400000);
  });
});
