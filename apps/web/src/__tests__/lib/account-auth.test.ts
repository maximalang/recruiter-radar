jest.mock("@/lib/db-pool", () => ({
  getClient: jest.fn(),
  getPool: jest.fn(),
}));
jest.mock("@/lib/email/transport", () => ({
  sendEmail: jest.fn(),
}));
jest.mock("@/lib/runtime", () => ({
  logError: jest.fn(),
  logEvent: jest.fn(),
  logWarn: jest.fn(),
}));

import {
  buildAccountLoginUrl,
  normalizeAccountEmail,
  requestAccountLogin,
  sanitizeAccountReturnTo,
} from "@/lib/account-auth";
import { getClient, getPool } from "@/lib/db-pool";
import { sendEmail } from "@/lib/email/transport";
import { normalizeCheckoutOrderUserId } from "@/lib/paymentsNormalize";
import { generateOwnerId } from "@/lib/session";

const mockGetClient = jest.mocked(getClient);
const mockGetPool = jest.mocked(getPool);
const mockSendEmail = jest.mocked(sendEmail);

const TEMPORARILY_UNAVAILABLE = {
  ok: false,
  error: "Вход временно недоступен. Попробуйте ещё раз немного позже.",
};

describe("account authentication boundaries", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AUTH_RATE_LIMIT_SECRET = "a".repeat(32);
    process.env.SESSION_SECRET = "s".repeat(32);
    process.env.AUTH_SITE_URL = "https://radar.example";
  });

  test("normalizes one conventional mailbox", () => {
    expect(normalizeAccountEmail("  User.Name+sales@Example.COM ")).toBe(
      "User.Name+sales@example.com",
    );
  });

  test.each([
    "first@example.com,second@example.com",
    "first@example.com; second@example.com",
    "first@example.com\nBcc: second@example.com",
    "not-an-email",
    "@example.com",
  ])("rejects unsafe or invalid mailbox syntax: %s", (value) => {
    expect(normalizeAccountEmail(value)).toBeNull();
  });

  test("keeps only allowlisted local account destinations", () => {
    expect(sanitizeAccountReturnTo("/checkout?plan=pilot-week")).toBe(
      "/checkout?plan=pilot-week",
    );
    expect(sanitizeAccountReturnTo("/settings#delivery")).toBe(
      "/settings#delivery",
    );
    expect(sanitizeAccountReturnTo("https://attacker.example")).toBe("/dashboard");
    expect(sanitizeAccountReturnTo("//attacker.example")).toBe("/dashboard");
    expect(sanitizeAccountReturnTo("/api/admin")).toBe("/dashboard");
  });

  test("keeps the one-time token out of the query string", () => {
    process.env.AUTH_SITE_URL = "https://radar.example";
    const token = "a".repeat(64);
    const url = new URL(buildAccountLoginUrl(token));

    expect(url.origin).toBe("https://radar.example");
    expect(url.pathname).toBe("/auth/verify");
    expect(url.search).toBe("");
    expect(url.hash).toBe(`#${token}`);
  });

  test("generated session owner IDs remain compatible with BIGINT checkout IDs", () => {
    const ownerId = generateOwnerId();

    expect(ownerId).toMatch(/^[1-9]\d+$/);
    expect(() => normalizeCheckoutOrderUserId(ownerId)).not.toThrow();
  });

  test("reports an unavailable database without claiming that email was sent", async () => {
    mockGetClient
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("database unavailable"));

    await expect(requestAccountLogin({
      email: "owner@example.com",
      sourceKey: "unknown",
    })).resolves.toEqual(TEMPORARILY_UNAVAILABLE);
    await expect(requestAccountLogin({
      email: "owner@example.com",
      sourceKey: "unknown",
    })).resolves.toEqual(TEMPORARILY_UNAVAILABLE);

    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  test("reports invalid auth configuration without throwing from the action boundary", async () => {
    delete process.env.AUTH_RATE_LIMIT_SECRET;
    delete process.env.SESSION_SECRET;

    await expect(requestAccountLogin({
      email: "owner@example.com",
      sourceKey: "unknown",
    })).resolves.toEqual(TEMPORARILY_UNAVAILABLE);

    expect(mockGetClient).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  test("reports email delivery failure without exposing account existence", async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes("global_count")) {
        return { rows: [{ global_count: "0", source_count: "0" }], rowCount: 1 };
      }
      if (sql.includes("WITH existing AS")) {
        return { rows: [{ id: "42" }], rowCount: 1 };
      }
      if (sql.includes("COUNT(*)::text AS count")) {
        return { rows: [{ count: "0" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    mockGetClient.mockResolvedValue({ query, release: jest.fn() } as never);
    mockGetPool.mockReturnValue({
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
    } as never);
    mockSendEmail.mockResolvedValue({ ok: false, reason: "send_failed" });

    await expect(requestAccountLogin({
      email: "owner@example.com",
      sourceKey: "unknown",
    })).resolves.toEqual(TEMPORARILY_UNAVAILABLE);
  });

  test("reports success when email was sent but delivery-status persistence fails", async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes("global_count")) {
        return { rows: [{ global_count: "0", source_count: "0" }], rowCount: 1 };
      }
      if (sql.includes("WITH existing AS")) {
        return { rows: [{ id: "42" }], rowCount: 1 };
      }
      if (sql.includes("COUNT(*)::text AS count")) {
        return { rows: [{ count: "0" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    mockGetClient.mockResolvedValue({ query, release: jest.fn() } as never);
    mockGetPool.mockReturnValue({
      query: jest.fn().mockRejectedValue(new Error("status update unavailable")),
    } as never);
    mockSendEmail.mockResolvedValue({ ok: true });

    await expect(requestAccountLogin({
      email: "owner@example.com",
      sourceKey: "unknown",
    })).resolves.toEqual({ ok: true, delivery: "sent" });
  });
});
