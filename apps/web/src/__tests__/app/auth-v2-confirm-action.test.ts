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
}));
jest.mock("@/lib/auth-v2/session-cookie", () => ({
  readAuthV2SessionCookie: jest.fn(),
  writeAuthV2SessionCookie: jest.fn(),
}));
jest.mock("@/lib/auth-v2/sessions", () => ({
  readAuthSession: jest.fn(),
  revokeAuthSessionById: jest.fn(),
}));
jest.mock("@/lib/session", () => ({
  assertOwnerSessionConfigured: jest.fn(),
  clearLegacyOwnerSession: jest.fn(),
  writeOwnerSession: jest.fn(),
}));

import { confirmAccountLoginAction } from "@/app/auth/confirm/actions";
import {
  clearPendingAccountLogin,
  readPendingAccountLogin,
} from "@/lib/account-login-cookie";
import { consumeAccountLogin } from "@/lib/account-auth";
import { consumeAuthV2Login } from "@/lib/auth-v2/challenges";
import {
  readAuthV2SessionCookie,
  writeAuthV2SessionCookie,
} from "@/lib/auth-v2/session-cookie";
import {
  readAuthSession,
  revokeAuthSessionById,
} from "@/lib/auth-v2/sessions";
import {
  clearLegacyOwnerSession,
  writeOwnerSession,
} from "@/lib/session";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

const mockHeaders = jest.mocked(headers);
const mockReadPending = jest.mocked(readPendingAccountLogin);
const mockClearPending = jest.mocked(clearPendingAccountLogin);
const mockConsumeLegacy = jest.mocked(consumeAccountLogin);
const mockConsumeV2 = jest.mocked(consumeAuthV2Login);
const mockReadV2Cookie = jest.mocked(readAuthV2SessionCookie);
const mockWriteV2Cookie = jest.mocked(writeAuthV2SessionCookie);
const mockReadV2Session = jest.mocked(readAuthSession);
const mockRevokeV2 = jest.mocked(revokeAuthSessionById);
const mockClearLegacy = jest.mocked(clearLegacyOwnerSession);
const mockWriteLegacy = jest.mocked(writeOwnerSession);
const mockRedirect = jest.mocked(redirect);
const originalPlatformFlag = process.env.AUTH_PLATFORM_V2_ENABLED;

describe("auth v2 explicit confirm bridge", () => {
  afterAll(() => {
    if (originalPlatformFlag === undefined) {
      delete process.env.AUTH_PLATFORM_V2_ENABLED;
    } else {
      process.env.AUTH_PLATFORM_V2_ENABLED = originalPlatformFlag;
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AUTH_PLATFORM_V2_ENABLED = "false";
    delete process.env.AUTH_TRUSTED_PROXY_HEADER;
    mockHeaders.mockResolvedValue({
      get: () => null,
    } as never);
    mockReadPending.mockResolvedValue("a".repeat(64));
    mockClearPending.mockResolvedValue(undefined);
    mockReadV2Cookie.mockResolvedValue(null);
    mockReadV2Session.mockResolvedValue(null);
    mockRevokeV2.mockResolvedValue(true);
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
    mockConsumeV2.mockResolvedValue({
      account: {
        id: "42",
        email: "owner@example.com",
        fullName: null,
        emailVerifiedAt: new Date(),
      },
      returnTo: "/dashboard",
      session: { id: "17", token: "b".repeat(64) },
    });
    mockReadV2Cookie.mockResolvedValue("c".repeat(64));
    mockReadV2Session.mockResolvedValue({
      id: "9",
      userId: "8",
    } as never);

    await confirmAccountLoginAction();

    expect(mockConsumeV2).toHaveBeenCalledWith({
      token: "a".repeat(64),
      clientAddress: "unknown",
    });
    expect(mockRevokeV2).toHaveBeenCalledWith({
      userId: "8",
      sessionId: "9",
      reason: "security_action",
    });
    expect(mockWriteV2Cookie).toHaveBeenCalledWith("b".repeat(64));
    expect(mockClearLegacy).toHaveBeenCalled();
    expect(mockClearPending).toHaveBeenCalled();
    expect(mockWriteLegacy).not.toHaveBeenCalled();
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  test("accepts an outstanding legacy challenge after v2 rollout", async () => {
    process.env.AUTH_PLATFORM_V2_ENABLED = "true";
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
});
