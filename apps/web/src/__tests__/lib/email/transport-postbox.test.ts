import { sendEmail } from "@/lib/email/transport";

describe("Yandex Postbox transport", () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    globalThis.fetch = jest.fn().mockResolvedValue(
      new Response("{}", { status: 200 }),
    );
    process.env.POSTBOX_ACCESS_KEY_ID = "access-key";
    process.env.POSTBOX_SECRET_ACCESS_KEY = "secret-key";
    process.env.POSTBOX_FROM = "support@example.test";
    process.env.POSTBOX_REPLY_TO = "support@example.test";
    process.env.POSTBOX_ENDPOINT = "https://postbox.example.test";
    process.env.POSTBOX_REGION = "ru-central1";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  test("sends signed AWS-compatible request with safe message shape", async () => {
    await expect(sendEmail({
      to: "test@example.test",
      subject: "Magic link",
      html: "<a href='https://example.test/token'>Sign in</a>",
      text: "https://example.test/token",
    })).resolves.toEqual({ ok: true });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = jest.mocked(globalThis.fetch).mock.calls[0]!;
    expect(String(url)).toBe(
      "https://postbox.example.test/v2/email/outbound-emails",
    );
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual(expect.objectContaining({
      authorization: expect.stringContaining(
        "AWS4-HMAC-SHA256 Credential=access-key/",
      ),
      "x-amz-date": expect.stringMatching(/^\d{8}T\d{6}Z$/),
    }));
    expect(JSON.parse(String(init?.body))).toEqual({
      FromEmailAddress: "support@example.test",
      ReplyToAddresses: ["support@example.test"],
      Destination: { ToAddresses: ["test@example.test"] },
      Content: {
        Simple: {
          Subject: { Data: "Magic link", Charset: "UTF-8" },
          Body: {
            Text: { Data: "https://example.test/token", Charset: "UTF-8" },
            Html: {
              Data: "<a href='https://example.test/token'>Sign in</a>",
              Charset: "UTF-8",
            },
          },
        },
      },
    });
  });

  test("does not expose provider response text on failure", async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(
      new Response("secret recipient token", { status: 403 }),
    );
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(sendEmail({
      to: "private@example.test",
      subject: "token",
      html: "<p>token</p>",
      text: "token",
    })).resolves.toEqual({ ok: false, reason: "send_failed" });

    expect(consoleError).toHaveBeenCalledWith(
      JSON.stringify({
        level: "error",
        event: "email.send_failed",
        message: "postbox_send_failed",
        failureCategory: "provider_http",
        responseCode: 403,
      }),
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
      "secret recipient token",
    );
    consoleError.mockRestore();
  });
});
