jest.mock("next/headers", () => ({
  headers: jest.fn(),
}));
jest.mock("next/navigation", () => ({
  redirect: jest.fn(),
}));
jest.mock("@/lib/account-login-cookie", () => ({
  clearPendingAccountLogin: jest.fn(),
  readPendingAccountLogin: jest.fn(),
}));
jest.mock("@/lib/account-auth", () => ({
  consumeAccountLogin: jest.fn(),
}));
jest.mock("@/lib/auth-v2/challenges", () => ({
  consumeAuthV2Login: jest.fn(),
  readAuthV2LoginChallengePreview: jest.fn(),
}));
jest.mock("@/lib/auth-v2/session-cookie", () => ({
  readAuthV2SessionCookie: jest.fn(),
  writeAuthV2SessionCookie: jest.fn(),
}));
jest.mock("@/lib/auth-v2/sessions", () => ({
  revokeAuthSessionForAccountSwitch: jest.fn(),
}));
jest.mock("@/lib/session", () => ({
  assertOwnerSessionConfigured: jest.fn(),
  clearLegacyOwnerSession: jest.fn(),
  readLegacyOwnerSessionCookie: jest.fn(),
  writeOwnerSession: jest.fn(),
}));

import {
  cancelAccountLoginAction,
  confirmAccountLoginAction,
} from "@/app/auth/confirm/actions";
import {
  clearPendingAccountLogin,
  readPendingAccountLogin,
} from "@/lib/account-login-cookie";
import { consumeAccountLogin } from "@/lib/account-auth";
import {
  consumeAuthV2Login,
  readAuthV2LoginChallengePreview,
} from "@/lib/auth-v2/challenges";
import {
  readAuthV2SessionCookie,
  writeAuthV2SessionCookie,
} from "@/lib/auth-v2/session-cookie";
import {
  revokeAuthSessionForAccountSwitch,
} from "@/lib/auth-v2/sessions";
import {
  clearLegacyOwnerSession,
  readLegacyOwnerSessionCookie,
  writeOwnerSession,
} from "@/lib/session";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

const mockHeaders = jest.mocked(headers);
const mockReadPending = jest.mocked(readPendingAccountLogin);
const mockClearPending = jest.mocked(clearPendingAccountLogin);
const mockConsumeLegacy = jest.mocked(consumeAccountLogin);
const mockConsumeV2 = jest.mocked(consumeAuthV2Login);
const mockReadV2Preview = jest.mocked(readAuthV2LoginChallengePreview);
const mockReadV2Cookie = jest.mocked(readAuthV2SessionCookie);
const mockWriteV2Cookie = jest.mocked(writeAuthV2SessionCookie);
const mockRevokeV2 = jest.mocked(revokeAuthSessionForAccountSwitch);
const mockClearLegacy = jest.mocked(clearLegacyOwnerSession);
const mockReadLegacyCookie = jest.mocked(readLegacyOwnerSessionCookie);
const mockWriteLegacy = jest.mocked(writeOwnerSession);
const mockRedirect = jest.mocked(redirect);
const originalPlatformFlag = process.env.AUTH_PLATFORM_V2_ENABLED;
const originalWorkspacesFlag = process.env.AUTH_WORKSPACES_V2_ENABLED;
const originalOnboardingFlag = process.env.AUTH_ONBOARDING_V2_ENABLED;
const originalSiteUrl = process.env.AUTH_SITE_URL;

describe("auth v2 explicit confirm bridge", () => {
  afterAll(() => {
    if (originalPlatformFlag === undefined) {
      delete process.env.AUTH_PLATFORM_V2_ENABLED;
    } else {
      process.env.AUTH_PLATFORM_V2_ENABLED = originalPlatformFlag;
    }
    if (originalSiteUrl === undefined) delete process.env.AUTH_SITE_URL;
    else process.env.AUTH_SITE_URL = originalSiteUrl;
    restoreEnv("AUTH_WORKSPACES_V2_ENABLED", originalWorkspacesFlag);
    restoreEnv("AUTH_ONBOARDING_V2_ENABLED", originalOnboardingFlag);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AUTH_PLATFORM_V2_ENABLED = "false";
    delete process.env.AUTH_WORKSPACES_V2_ENABLED;
    delete process.env.AUTH_ONBOARDING_V2_ENABLED;
    process.env.AUTH_SITE_URL = "https://radar.example";
    delete process.env.AUTH_TRUSTED_PROXY_HEADER;
    mockHeaders.mockResolvedValue(new Headers({
      Origin: "https://radar.example",
      "Sec-Fetch-Site": "same-origin",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/126.0.0.0 Safari/537.36",
    }) as never);
    mockReadPending.mockResolvedValue("a".repeat(64));
    mockClearPending.mockResolvedValue(undefined);
    mockReadV2Cookie.mockResolvedValue(null);
    mockReadLegacyCookie.mockResolvedValue(null);
    mockRevokeV2.mockResolvedValue("revoked");
    mockReadV2Preview.mockResolvedValue(null);
  });

  test("preserves legacy confirm while auth v2 is disabled", async () => {
    mockConsumeLegacy.mockResolvedValue({
      account: {
        id: "42",
        email: "owner@example.com",
        fullName: null,
        emailVerifiedAt: new Date(),
      },
      returnTo: "/checkout?plan=pilot-week",
    });

    await confirmAccountLoginAction();

    expect(mockConsumeV2).not.toHaveBeenCalled();
    expect(mockWriteLegacy).toHaveBeenCalledWith("42");
    expect(mockWriteV2Cookie).not.toHaveBeenCalled();
    expect(mockRedirect).toHaveBeenCalledWith("/checkout?plan=pilot-week");
  });

  test("creates the v2 cookie and revokes the replaced browser session", async () => {
    process.env.AUTH_PLATFORM_V2_ENABLED = "true";
    mockReadV2Preview.mockResolvedValue({
      maskedEmail: "o***r@e***e.com",
      userId: "42",
    });
    mockConsumeV2.mockResolvedValue({
      account: {
        id: "42",
        email: "owner@example.com",
        fullName: null,
        emailVerifiedAt: new Date(),
      },
      returnTo: "/dashboard",
      onboardingRequired: false,
      session: { id: "17", token: "b".repeat(64) },
    });
    mockReadV2Cookie.mockResolvedValue("c".repeat(64));
    const legacyToken = `8.${"d".repeat(64)}`;
    mockReadLegacyCookie.mockResolvedValue(legacyToken);

    await confirmAccountLoginAction();

    expect(mockConsumeV2).toHaveBeenCalledWith({
      token: "a".repeat(64),
      clientAddress: "unknown",
      legacyToken,
      sessionEnvironment: {
        deviceLabel: "Компьютер",
        browserLabel: "Chrome",
        environmentLabel: "Windows",
      },
    });
    expect(mockRevokeV2).toHaveBeenCalledWith("c".repeat(64));
    expect(mockWriteV2Cookie).toHaveBeenCalledWith("b".repeat(64));
    expect(mockClearLegacy).toHaveBeenCalled();
    expect(mockClearPending).toHaveBeenCalled();
    expect(mockWriteLegacy).not.toHaveBeenCalled();
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  test("does not replace the browser cookie when previous-session revocation is unavailable", async () => {
    process.env.AUTH_PLATFORM_V2_ENABLED = "true";
    mockReadV2Preview.mockResolvedValue({
      maskedEmail: "o***r@e***e.com",
      userId: "42",
    });
    mockConsumeV2.mockResolvedValue({
      account: {
        id: "42",
        email: "owner@example.com",
        fullName: null,
        emailVerifiedAt: new Date(),
      },
      returnTo: "/dashboard",
      onboardingRequired: false,
      session: { id: "17", token: "b".repeat(64) },
    });
    mockReadV2Cookie.mockResolvedValue("c".repeat(64));
    mockRevokeV2.mockResolvedValue("unavailable");

    await confirmAccountLoginAction();

    expect(mockRevokeV2).toHaveBeenCalledWith("c".repeat(64));
    expect(mockWriteV2Cookie).not.toHaveBeenCalled();
    expect(mockClearLegacy).not.toHaveBeenCalled();
    expect(mockClearPending).toHaveBeenCalled();
    expect(mockRedirect).toHaveBeenCalledWith(
      "/login?error=session-switch-unavailable",
    );
  });

  test("sends an incomplete new account to onboarding from the default destination", async () => {
    process.env.AUTH_PLATFORM_V2_ENABLED = "true";
    process.env.AUTH_WORKSPACES_V2_ENABLED = "true";
    process.env.AUTH_ONBOARDING_V2_ENABLED = "true";
    mockReadV2Preview.mockResolvedValue({
      maskedEmail: "n***w@e***e.com",
      userId: "42",
    });
    mockConsumeV2.mockResolvedValue({
      account: {
        id: "42",
        email: "new@example.com",
        fullName: null,
        emailVerifiedAt: new Date(),
      },
      returnTo: "/dashboard",
      onboardingRequired: true,
      session: { id: "17", token: "b".repeat(64) },
    });

    await confirmAccountLoginAction();

    expect(mockWriteV2Cookie).toHaveBeenCalledWith("b".repeat(64));
    expect(mockRedirect).toHaveBeenCalledWith("/onboarding");
  });

  test("accepts an outstanding legacy challenge after v2 rollout", async () => {
    process.env.AUTH_PLATFORM_V2_ENABLED = "true";
    mockReadV2Preview.mockResolvedValue({
      maskedEmail: "o***r@e***e.com",
      userId: "42",
    });
    mockConsumeV2.mockResolvedValue(null);
    mockConsumeLegacy.mockResolvedValue({
      account: {
        id: "42",
        email: "owner@example.com",
        fullName: null,
        emailVerifiedAt: new Date(),
      },
      returnTo: "/dashboard",
    });

    await confirmAccountLoginAction();

    expect(mockConsumeV2).toHaveBeenCalled();
    expect(mockConsumeLegacy).toHaveBeenCalledWith("a".repeat(64));
    expect(mockWriteLegacy).toHaveBeenCalledWith("42");
  });

  test("rejects cross-origin confirmation before consuming either challenge", async () => {
    mockHeaders.mockResolvedValue(new Headers({
      Origin: "https://attacker.example",
    }) as never);

    await confirmAccountLoginAction();

    expect(mockConsumeV2).not.toHaveBeenCalled();
    expect(mockConsumeLegacy).not.toHaveBeenCalled();
    expect(mockRedirect).toHaveBeenCalledWith("/login?error=invalid-origin");
  });

  test("cancels without consuming and clears the pending token", async () => {
    await cancelAccountLoginAction();

    expect(mockConsumeV2).not.toHaveBeenCalled();
    expect(mockConsumeLegacy).not.toHaveBeenCalled();
    expect(mockClearPending).toHaveBeenCalled();
    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
