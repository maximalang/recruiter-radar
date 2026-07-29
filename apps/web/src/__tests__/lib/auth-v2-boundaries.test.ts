import {
  getAuthV2Flags,
  isAuthOnboardingV2EnabledForUser,
  isAuthPlatformV2EnabledForUser,
  isAuthWorkspacesV2EnabledForUser,
  isAuthV2SessionReadEnabledForUser,
  parseCanaryUserIds,
} from "@/lib/auth-v2/config";
import {
  isAuthSameOriginRequest,
  maskAuthEmail,
  normalizeAuthEmail,
  resolveAuthClientAddress,
  sanitizeAuthReturnTo,
  shouldWarnAuthAccountReplacement,
} from "@/lib/auth-v2/security";

describe("auth v2 feature boundaries", () => {
  test("enables boolean flags only for the exact value true", () => {
    expect(getAuthV2Flags({
      AUTH_PLATFORM_V2_ENABLED: "true",
      AUTH_WORKSPACES_V2_ENABLED: "true",
      AUTH_ONBOARDING_V2_ENABLED: "TRUE",
      AUTH_PASSKEYS_ENABLED: "1",
      AUTH_LEGACY_SESSION_MIGRATION_ENABLED: " true ",
    })).toEqual({
      platform: true,
      workspaces: true,
      onboarding: false,
      passkeys: false,
      legacySessionMigration: false,
    });
  });

  test("fails dependent flags closed when their parent is disabled", () => {
    expect(getAuthV2Flags({
      AUTH_PLATFORM_V2_ENABLED: "false",
      AUTH_WORKSPACES_V2_ENABLED: "true",
      AUTH_ONBOARDING_V2_ENABLED: "true",
      AUTH_PASSKEYS_ENABLED: "true",
      AUTH_LEGACY_SESSION_MIGRATION_ENABLED: "true",
    })).toEqual({
      platform: false,
      workspaces: false,
      onboarding: false,
      passkeys: false,
      legacySessionMigration: false,
    });
  });

  test("accepts only a complete comma-separated positive decimal canary list", () => {
    expect(parseCanaryUserIds("17, 42,17")).toEqual(new Set(["17", "42"]));
    expect(parseCanaryUserIds("")).toEqual(new Set());
    expect(parseCanaryUserIds("17,,42")).toBeNull();
    expect(parseCanaryUserIds("17,*")).toBeNull();
    expect(parseCanaryUserIds("-1")).toBeNull();
    expect(parseCanaryUserIds("01")).toBeNull();
    expect(parseCanaryUserIds("9223372036854775807")).toEqual(
      new Set(["9223372036854775807"]),
    );
    expect(parseCanaryUserIds("9223372036854775808")).toBeNull();
  });

  test("does not turn a canary list into global enablement", () => {
    const env = {
      AUTH_PLATFORM_V2_ENABLED: "false",
      AUTH_V2_CANARY_USER_IDS: "17,42",
    };

    expect(isAuthPlatformV2EnabledForUser(null, env)).toBe(false);
    expect(isAuthPlatformV2EnabledForUser("18", env)).toBe(false);
    expect(isAuthPlatformV2EnabledForUser("17", env)).toBe(true);
    expect(isAuthV2SessionReadEnabledForUser("17", env)).toBe(true);
    expect(isAuthV2SessionReadEnabledForUser("18", env)).toBe(false);
    expect(isAuthV2SessionReadEnabledForUser("18", {
      ...env,
      AUTH_V2_SESSION_ROLLBACK_COMPAT_ENABLED: "true",
    })).toBe(true);
  });

  test("requires both the workspace flag and per-user platform eligibility", () => {
    const env = {
      AUTH_PLATFORM_V2_ENABLED: "false",
      AUTH_WORKSPACES_V2_ENABLED: "true",
      AUTH_V2_CANARY_USER_IDS: "17",
    };

    expect(isAuthWorkspacesV2EnabledForUser("17", env)).toBe(true);
    expect(isAuthWorkspacesV2EnabledForUser("18", env)).toBe(false);
    expect(isAuthWorkspacesV2EnabledForUser("17", {
      ...env,
      AUTH_WORKSPACES_V2_ENABLED: "TRUE",
    })).toBe(false);
  });

  test("scopes onboarding to an eligible workspace user and an exact flag", () => {
    const env = {
      AUTH_PLATFORM_V2_ENABLED: "false",
      AUTH_WORKSPACES_V2_ENABLED: "true",
      AUTH_ONBOARDING_V2_ENABLED: "true",
      AUTH_V2_CANARY_USER_IDS: "17",
    };

    expect(isAuthOnboardingV2EnabledForUser("17", env)).toBe(true);
    expect(isAuthOnboardingV2EnabledForUser("18", env)).toBe(false);
    expect(isAuthOnboardingV2EnabledForUser("17", {
      ...env,
      AUTH_ONBOARDING_V2_ENABLED: "TRUE",
    })).toBe(false);
  });
});

describe("auth v2 request boundaries", () => {
  test("normalizes Unicode to NFC and lowercases only the IDN domain", () => {
    expect(normalizeAuthEmail("  U\u0308ser+Sales@ПРИМЕР.РФ  ")).toEqual({
      canonical: "Üser+Sales@xn--e1afmkfd.xn--p1ai",
      normalized: "Üser+Sales@xn--e1afmkfd.xn--p1ai",
    });
  });

  test("preserves local-part case and provider aliases", () => {
    expect(normalizeAuthEmail("User.Name+tag@Example.COM")).toEqual({
      canonical: "User.Name+tag@example.com",
      normalized: "User.Name+tag@example.com",
    });
  });

  test.each([
    "first@example.com,second@example.com",
    "first@example.com;second@example.com",
    "first@example.com\nBcc:second@example.com",
    ".first@example.com",
    "first..last@example.com",
    `${"a".repeat(65)}@example.com`,
    "user@localhost",
  ])("rejects an unsafe or unsupported mailbox: %s", (email) => {
    expect(normalizeAuthEmail(email)).toBeNull();
  });

  test("allows only explicit local product destinations", () => {
    expect(sanitizeAuthReturnTo("/checkout?plan=pilot-week")).toBe("/checkout?plan=pilot-week");
    expect(sanitizeAuthReturnTo("/opportunities/42#outcome")).toBe("/opportunities/42#outcome");
    expect(sanitizeAuthReturnTo("/onboarding")).toBe("/onboarding");
    expect(sanitizeAuthReturnTo("/auth/invite")).toBe("/auth/invite");
    expect(sanitizeAuthReturnTo("/auth/email-change")).toBe("/dashboard");
    expect(sanitizeAuthReturnTo("/auth/invite/extra")).toBe("/dashboard");
    expect(sanitizeAuthReturnTo("https://attacker.example")).toBe("/dashboard");
    expect(sanitizeAuthReturnTo("//attacker.example")).toBe("/dashboard");
    expect(sanitizeAuthReturnTo("/api/auth/logout")).toBe("/dashboard");
    expect(sanitizeAuthReturnTo("/dashboard\\@attacker.example")).toBe("/dashboard");
  });

  test("masks target identity and enforces the configured request origin", () => {
    expect(maskAuthEmail("owner@example.com")).toBe("o***r@e***e.com");
    const env = {
      AUTH_SITE_URL: "https://radar.example",
      NODE_ENV: "production",
    };
    expect(isAuthSameOriginRequest(new Request("https://radar.example", {
      headers: {
        Origin: "https://radar.example",
        "Sec-Fetch-Site": "same-origin",
      },
    }), env)).toBe(true);
    expect(isAuthSameOriginRequest(new Request("https://radar.example", {
      headers: { Origin: "https://attacker.example" },
    }), env)).toBe(false);
    expect(isAuthSameOriginRequest(new Request("https://radar.example"), env))
      .toBe(false);
  });

  test("ignores forwarding headers unless the deployment opts into one", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.10",
      "cf-connecting-ip": "198.51.100.20",
    });

    expect(resolveAuthClientAddress({
      directAddress: "192.0.2.5",
      headers,
      env: {},
    })).toBe("192.0.2.5");
  });

  test("warns about session replacement for a different or not-yet-created account", () => {
    expect(shouldWarnAuthAccountReplacement("42", "42")).toBe(false);
    expect(shouldWarnAuthAccountReplacement("42", "73")).toBe(true);
    expect(shouldWarnAuthAccountReplacement("42", null)).toBe(true);
    expect(shouldWarnAuthAccountReplacement(null, "73")).toBe(false);
  });

  test("resolves a configured X-Forwarded-For chain from the trusted edge", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.10, 198.51.100.20",
    });

    expect(resolveAuthClientAddress({
      directAddress: "192.0.2.5",
      headers,
      env: {
        AUTH_TRUSTED_PROXY_HEADER: "x-forwarded-for",
        AUTH_TRUSTED_PROXY_HOPS: "2",
      },
    })).toBe("203.0.113.10");
  });

  test("fails closed to the direct address for malformed proxy configuration or input", () => {
    const headers = new Headers({
      "x-forwarded-for": "attacker.example, 198.51.100.20",
    });

    expect(resolveAuthClientAddress({
      directAddress: "192.0.2.5",
      headers,
      env: {
        AUTH_TRUSTED_PROXY_HEADER: "x-forwarded-for",
        AUTH_TRUSTED_PROXY_HOPS: "2",
      },
    })).toBe("192.0.2.5");
    expect(resolveAuthClientAddress({
      directAddress: "192.0.2.5",
      headers,
      env: {
        AUTH_TRUSTED_PROXY_HEADER: "x-forwarded-for",
        AUTH_TRUSTED_PROXY_HOPS: "0",
      },
    })).toBe("192.0.2.5");
  });
});
