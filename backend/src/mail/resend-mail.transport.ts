export type ResendEmailInput = {
  credential: string;
  idempotencyKey: string;
  from: string;
  replyTo?: string;
  to: string;
  subject: string;
  text: string;
  headers?: Record<string, string>;
};

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Only safe, structured diagnostics are persisted. Provider text may contain recipient data. */
export class ResendDeliveryError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly status = 0,
    readonly retryAfterMs = 0,
    readonly configurationError = false
  ) {
    super(`Resend ${code}${status ? ` (HTTP ${status})` : ""}`);
    this.name = "ResendDeliveryError";
  }
}

export function resendRetryAfter(value: string | null, now = Date.now()): number {
  if (!value?.trim()) return 0;
  const text = value.trim();
  const delay = /^\d+(?:\.\d+)?$/.test(text) ? Number(text) * 1000 : Date.parse(text) - now;
  return Number.isFinite(delay) ? Math.min(86400000, Math.max(0, Math.ceil(delay))) : 0;
}

export async function sendResendEmail(input: ResendEmailInput, fetchImplementation: FetchImplementation = fetch) {
  if (!input.credential.trim() || /[\r\n]/.test(input.credential)) {
    throw new ResendDeliveryError("CONFIGURATION_REQUIRED", false, 0, 0, true);
  }
  if (!input.idempotencyKey || input.idempotencyKey.length > 256 || /[\r\n]/.test(input.idempotencyKey)) {
    throw new ResendDeliveryError("INVALID_IDEMPOTENCY_KEY", false);
  }
  let response: Response;
  let body: Record<string, unknown>;
  try {
    response = await fetchImplementation("https://api.resend.com/emails", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.credential}`,
        "Idempotency-Key": input.idempotencyKey
      },
      body: JSON.stringify({
        from: input.from, to: [input.to], subject: input.subject, text: input.text,
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
        ...(input.headers ? { headers: input.headers } : {})
      })
    });
    const value: unknown = await response.json().catch(() => null);
    body = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    // A timeout can occur after provider acceptance: retry only with the SAME key/payload.
    throw new ResendDeliveryError("TRANSPORT_UNCERTAIN", true);
  }
  if (!response.ok) {
    const concurrent = response.status === 409 && body.name === "concurrent_idempotent_requests";
    const mismatch = response.status === 409 && body.name === "invalid_idempotent_request";
    const configuration = response.status === 401 || response.status === 403;
    const retryable = concurrent || response.status === 408 || response.status === 429 || response.status >= 500;
    const code = mismatch ? "IDEMPOTENCY_PAYLOAD_MISMATCH" : concurrent ? "CONCURRENT_REQUEST"
      : configuration ? "CREDENTIAL_OR_DOMAIN_REJECTED" : response.status === 429 ? "RATE_LIMITED"
      : response.status >= 500 ? "PROVIDER_UNAVAILABLE" : "REQUEST_REJECTED";
    throw new ResendDeliveryError(code, retryable, response.status, resendRetryAfter(response.headers.get("retry-after")), configuration);
  }
  if (typeof body.id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(body.id)) {
    throw new ResendDeliveryError("INVALID_RESPONSE", true);
  }
  // This is provider acceptance, not proof of recipient delivery.
  return { messageId: body.id };
}
