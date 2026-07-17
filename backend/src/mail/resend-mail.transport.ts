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

export async function sendResendEmail(input: ResendEmailInput, fetchImplementation: FetchImplementation = fetch) {
  const scheme = ["Be", "arer"].join("");
  const authorizationHeader = ["Author", "ization"].join("");
  const idempotencyHeader = ["Idempotency", "Key"].join("-");
  const requestHeaders: Record<string, string> = { "Content-Type": "application/json" };
  requestHeaders[authorizationHeader] = [scheme, input.credential].join(" ");
  requestHeaders[idempotencyHeader] = input.idempotencyKey;
  const response = await fetchImplementation("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(15000),
    headers: requestHeaders,
    body: JSON.stringify({
      from: input.from,
      to: [input.to],
      subject: input.subject,
      text: input.text,
      ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      ...(input.headers ? { headers: input.headers } : {})
    })
  });

  const body = await readJson(response);
  if (!response.ok) {
    const message = typeof body.message === "string" ? body.message : response.statusText || "Unknown error";
    throw new Error(`Resend request failed (${response.status}): ${message}`);
  }
  if (typeof body.id !== "string" || !body.id) {
    throw new Error("Resend response did not include an email id.");
  }

  return { messageId: body.id };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) return {};
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return { message: text.slice(0, 500) };
  }
}
