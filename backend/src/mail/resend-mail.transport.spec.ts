import { sendResendEmail } from "./resend-mail.transport";

const credential = "test-api-key";

describe("sendResendEmail", () => {
  it("sends the expected Resend API request", async () => {
    const fetchImplementation = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "email_123" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    const result = await sendResendEmail(
      {
        credential,
        idempotencyKey: "email-delivery/delivery_123",
        from: "Art Bridge <mail@example.com>",
        replyTo: "support@example.com",
        to: "member@example.com",
        subject: "Invitation",
        text: "You are invited",
        headers: { "X-Reading-Musical-Delivery": "delivery_123" }
      },
      fetchImplementation
    );

    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        signal: expect.any(AbortSignal)
      })
    );
    const request = fetchImplementation.mock.calls[0][1] as RequestInit;
    expect(Object.values(request.headers as Record<string, string>)).toEqual(
      expect.arrayContaining([expect.stringContaining(credential), "email-delivery/delivery_123"])
    );
    expect(JSON.parse(String(request.body))).toEqual({
      from: "Art Bridge <mail@example.com>",
      to: ["member@example.com"],
      subject: "Invitation",
      text: "You are invited",
      reply_to: "support@example.com",
      headers: { "X-Reading-Musical-Delivery": "delivery_123" }
    });
    expect(result).toEqual({ messageId: "email_123" });
  });

  it("surfaces the Resend error without exposing the API key", async () => {
    const fetchImplementation = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "Domain is not verified" }), {
        status: 403,
        headers: { "content-type": "application/json" }
      })
    );

    await expect(
      sendResendEmail(
        {
          credential,
          idempotencyKey: "email-delivery/delivery_123",
          from: "mail@example.com",
          to: "member@example.com",
          subject: "Invitation",
          text: "You are invited"
        },
        fetchImplementation
      )
    ).rejects.toThrow("Resend request failed (403): Domain is not verified");
  });
});
