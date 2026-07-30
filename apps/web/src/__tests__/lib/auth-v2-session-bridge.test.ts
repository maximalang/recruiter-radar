jest.mock("next/headers", () => ({
  cookies: jest.fn(),
}));
jest.mock("@/lib/auth-v2/legacy-session", () => ({
  readLegacyOwnerSessionForAuthorization: jest.fn(),
  revokeLegacyOwnerSessionForLogout: jest.fn(),
}));
jest.mock("@/lib/auth-v2/session-cookie", () => ({
  clearAuthV2SessionCookie: jest.fn(),
  readAuthV2SessionCookieState: jest.fn(),
}));
jest.mock("@/lib/auth-v2/sessions", () => ({
  readAuthSession: jest.fn(),
  revokeAuthSessionForLogout: jest.fn(),
}));

import {
  clearAuthV2SessionCookie,
  readAuthV2SessionCookieState,
} from "@/lib/auth-v2/session-cookie";
import {
  readLegacyOwnerSessionForAuthorization,
  revokeLegacyOwnerSessionForLogout,
} from "@/lib/auth-v2/legacy-session";
import {
  readAuthSession,
  revokeAuthSessionForLogout,
} from "@/lib/auth-v2/sessions";
import {
  clearOwnerSession,
  readOwnerSession,
} from "@/lib/session";
import { cookies } from "next/headers";

const mockCookies = jest.mocked(cookies);
const mockReadV2CookieState = jest.mocked(readAuthV2SessionCookieState);
const mockClearV2Cookie = jest.mocked(clearAuthV2SessionCookie);
const mockReadLegacyForAuthorization = jest.mocked(
  readLegacyOwnerSessionForAuthorization,
);
const mockRevokeLegacyForLogout = jest.mocked(
  revokeLegacyOwnerSessionForLogout,
);
const mockReadV2Session = jest.mocked(readAuthSession);
const mockRevokeV2ForLogout = jest.mocked(revokeAuthSessionForLogout);
const originalSessionSecret = process.env.SESSION_SECRET;
const originalPlatformFlag = process.env.AUTH_PLATFORM_V2_ENABLED;

describe("owner session compatibility bridge", () => {
  const deleteCookie = jest.fn();
  const getCookie = jest.fn();

  afterAll(() => {
    if (originalSessionSecret === undefined) {
      delete process.env.SESSION_SECRET;
    } else {
      process.env.SESSION_SECRET = originalSessionSecret;
    }
    if (originalPlatformFlag === undefined) {
      delete process.env.AUTH_PLATFORM_V2_ENABLED;
    } else {
      process.env.AUTH_PLATFORM_V2_ENABLED = originalPlatformFlag;
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SESSION_SECRET = "s".repeat(32);
    process.env.AUTH_PLATFORM_V2_ENABLED = "true";
    mockCookies.mockResolvedValue({
      delete: deleteCookie,
      get: getCookie,
    } as never);
    mockReadV2CookieState.mockResolvedValue({ status: "absent" });
    mockClearV2Cookie.mockResolvedValue(undefined);
    mockReadLegacyForAuthorization.mockResolvedValue(null);
    mockReadV2Session.mockResolvedValue(null);
    mockRevokeV2ForLogout.mockResolvedValue("revoked");
    mockRevokeLegacyForLogout.mockResolvedValue("revoked");
    getCookie.mockReturnValue(undefined);
  });

  test("prefers a valid database session without exposing its token", async () => {
    mockReadV2CookieState.mockResolvedValue({
      status: "valid",
      token: "a".repeat(64),
    });
    mockReadV2Session.mockResolvedValue({
      id: "17",
      userId: "42",
      rotationDue: false,
    } as never);

    await expect(readOwnerSession()).resolves.toBe("42");
    expect(mockReadV2Session).toHaveBeenCalledWith("a".repeat(64));
  });

  test("does not fall back to legacy identity for a malformed present v2 cookie", async () => {
    const token = `42.${"c".repeat(64)}`;
    mockReadV2CookieState.mockResolvedValue({ status: "invalid" });
    getCookie.mockImplementation((name: string) => (
      name === "rr_sid" ? { value: token } : undefined
    ));
    mockReadLegacyForAuthorization.mockResolvedValue("42");

    await expect(readOwnerSession()).resolves.toBeNull();
    expect(mockReadV2Session).not.toHaveBeenCalled();
    expect(mockReadLegacyForAuthorization).not.toHaveBeenCalled();
  });

  test("does not fall back to legacy identity for an unknown v2 session", async () => {
    const token = `42.${"c".repeat(64)}`;
    mockReadV2CookieState.mockResolvedValue({
      status: "valid",
      token: "a".repeat(64),
    });
    getCookie.mockImplementation((name: string) => (
      name === "rr_sid" ? { value: token } : undefined
    ));
    mockReadLegacyForAuthorization.mockResolvedValue("42");
    mockReadV2Session.mockResolvedValue(null);

    await expect(readOwnerSession()).resolves.toBeNull();
    expect(mockReadLegacyForAuthorization).not.toHaveBeenCalled();
  });

  test("preserves only a policy-authorized legacy session", async () => {
    const token = `42.${"c".repeat(64)}`;
    getCookie.mockImplementation((name: string) => (
      name === "rr_sid" ? { value: token } : undefined
    ));
    mockReadLegacyForAuthorization.mockResolvedValue("42");

    await expect(readOwnerSession()).resolves.toBe("42");
    expect(mockReadV2Session).not.toHaveBeenCalled();
    expect(mockReadLegacyForAuthorization).toHaveBeenCalledWith({
      legacyToken: token,
    });
  });

  test("does not revive a legacy cookie rejected after one-time exchange", async () => {
    const token = `42.${"d".repeat(64)}`;
    getCookie.mockImplementation((name: string) => (
      name === "rr_sid" ? { value: token } : undefined
    ));
    mockReadLegacyForAuthorization.mockResolvedValue(null);

    await expect(readOwnerSession()).resolves.toBeNull();
    expect(mockReadLegacyForAuthorization).toHaveBeenCalledWith({
      legacyToken: token,
    });
  });

  test("does not authorize a database session that requires rotation", async () => {
    mockReadV2CookieState.mockResolvedValue({
      status: "valid",
      token: "a".repeat(64),
    });
    mockReadV2Session.mockResolvedValue({
      id: "17",
      userId: "42",
      rotationDue: true,
    } as never);

    await expect(readOwnerSession()).resolves.toBeNull();
    expect(mockReadLegacyForAuthorization).not.toHaveBeenCalled();
  });

  test("does not accept a non-canary v2 session while the platform is disabled", async () => {
    process.env.AUTH_PLATFORM_V2_ENABLED = "false";
    delete process.env.AUTH_V2_CANARY_USER_IDS;
    mockReadV2CookieState.mockResolvedValue({
      status: "valid",
      token: "a".repeat(64),
    });
    mockReadV2Session.mockResolvedValue({
      id: "17",
      userId: "42",
      rotationDue: false,
    } as never);

    await expect(readOwnerSession()).resolves.toBeNull();
  });

  test("revokes the database session before clearing both cookies", async () => {
    mockReadV2CookieState.mockResolvedValue({
      status: "valid",
      token: "b".repeat(64),
    });
    const legacyToken = `42.${"c".repeat(64)}`;
    getCookie.mockImplementation((name: string) => (
      name === "rr_sid" ? { value: legacyToken } : undefined
    ));

    await expect(clearOwnerSession()).resolves.toBe(true);

    expect(mockRevokeV2ForLogout).toHaveBeenCalledWith(
      "b".repeat(64),
    );
    expect(mockRevokeLegacyForLogout).toHaveBeenCalledWith(legacyToken);
    expect(mockClearV2Cookie).toHaveBeenCalled();
    expect(deleteCookie).toHaveBeenCalledWith("rr_sid");
  });

  test("persists a legacy-only logout tombstone before deleting the cookie", async () => {
    const legacyToken = `42.${"d".repeat(64)}`;
    getCookie.mockImplementation((name: string) => (
      name === "rr_sid" ? { value: legacyToken } : undefined
    ));

    await expect(clearOwnerSession()).resolves.toBe(true);

    expect(mockRevokeV2ForLogout).not.toHaveBeenCalled();
    expect(mockRevokeLegacyForLogout).toHaveBeenCalledWith(legacyToken);
    expect(mockClearV2Cookie).toHaveBeenCalled();
    expect(deleteCookie).toHaveBeenCalledWith("rr_sid");
  });

  test("keeps a legacy-only cookie when its tombstone cannot be persisted", async () => {
    const legacyToken = `42.${"e".repeat(64)}`;
    getCookie.mockImplementation((name: string) => (
      name === "rr_sid" ? { value: legacyToken } : undefined
    ));
    mockRevokeLegacyForLogout.mockResolvedValue("unavailable");

    await expect(clearOwnerSession()).resolves.toBe(false);

    expect(mockClearV2Cookie).not.toHaveBeenCalled();
    expect(deleteCookie).not.toHaveBeenCalled();
  });

  test("clears an already inactive database session cookie", async () => {
    mockReadV2CookieState.mockResolvedValue({
      status: "valid",
      token: "b".repeat(64),
    });
    mockRevokeV2ForLogout.mockResolvedValue("inactive");

    await expect(clearOwnerSession()).resolves.toBe(true);

    expect(mockClearV2Cookie).toHaveBeenCalled();
    expect(deleteCookie).toHaveBeenCalledWith("rr_sid");
  });

  test("keeps both cookies when database revocation is unavailable", async () => {
    mockReadV2CookieState.mockResolvedValue({
      status: "valid",
      token: "b".repeat(64),
    });
    mockRevokeV2ForLogout.mockResolvedValue("unavailable");

    await expect(clearOwnerSession()).resolves.toBe(false);

    expect(mockClearV2Cookie).not.toHaveBeenCalled();
    expect(deleteCookie).not.toHaveBeenCalled();
  });

  test("keeps both cookies when the presented session token cannot be read", async () => {
    mockReadV2CookieState.mockRejectedValue(new Error("cookie store unavailable"));

    await expect(clearOwnerSession()).rejects.toThrow("cookie store unavailable");

    expect(mockRevokeV2ForLogout).not.toHaveBeenCalled();
    expect(mockClearV2Cookie).not.toHaveBeenCalled();
    expect(deleteCookie).not.toHaveBeenCalled();
  });
});
