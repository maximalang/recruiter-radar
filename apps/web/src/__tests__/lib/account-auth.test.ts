import {
  buildAccountLoginUrl,
  normalizeAccountEmail,
  sanitizeAccountReturnTo,
} from "@/lib/account-auth";
import { normalizeCheckoutOrderUserId } from "@/lib/paymentsNormalize";
import { generateOwnerId } from "@/lib/session";

describe("account authentication boundaries", () => {
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
});
