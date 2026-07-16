import {
  decryptNotificationSecret,
  encryptNotificationSecret,
  hashNotificationToken,
  redactProviderSecret,
  timingSafeTextEqual,
} from "../../../lib/notification-secrets";

describe("notification secrets", () => {
  const previousKey = process.env.NOTIFICATION_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.NOTIFICATION_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });

  afterAll(() => {
    if (previousKey === undefined) delete process.env.NOTIFICATION_ENCRYPTION_KEY;
    else process.env.NOTIFICATION_ENCRYPTION_KEY = previousKey;
  });

  it("round-trips a provider credential with authenticated AAD", () => {
    const encrypted = encryptNotificationSecret(
      { botToken: "123456789:abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO" },
      "account:1",
    );

    expect(encrypted).not.toContain("123456789");
    expect(
      decryptNotificationSecret<{ botToken: string }>(encrypted, "account:1"),
    ).toEqual({ botToken: "123456789:abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO" });
    expect(() => decryptNotificationSecret(encrypted, "account:2")).toThrow();
  });

  it("hashes bind tokens and compares digests safely", () => {
    const left = hashNotificationToken("one-time-bind-token");
    const right = hashNotificationToken("one-time-bind-token");
    const other = hashNotificationToken("other-token");

    expect(timingSafeTextEqual(left, right)).toBe(true);
    expect(timingSafeTextEqual(left, other)).toBe(false);
  });

  it("redacts Telegram tokens and query-string secrets", () => {
    const value =
      "bot123456789:abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO https://x.test?a=1&token=super-secret";
    const redacted = redactProviderSecret(value);

    expect(redacted).not.toContain("super-secret");
    expect(redacted).not.toContain("123456789:");
  });
});
