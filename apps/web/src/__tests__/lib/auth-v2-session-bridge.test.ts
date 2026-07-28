import { createHmac } from "node:crypto";

jest.mock("next/headers", () => ({
  cookies: jest.fn(),
}));
jest.mock("@/lib/auth-v2/session-cookie", () => ({
  clearAuthV2SessionCookie: jest.fn(),
  readAuthV2SessionCookie: jest.fn(),
}));
jest.mock("@/lib/auth-v2/sessions", () => ({
  readAuthSession: jest.fn(),
  revokeAuthSession: jest.fn(),
  revokeAuthSessionById: jest.fn(),
}));

import {
  clearAuthV2SessionCookie,
  readAuthV2SessionCookie,
} from "@/lib/auth-v2/session-cookie";
import {
  readAuthSession,
  revokeAuthSessionById,
} from "@/lib/auth-v2/sessions";
import {
  clearOwnerSession,
  readOwnerSession,
} from "@/lib/session";
import { cookies } from "next/headers";

const mockCookies = jest.mocked(cookies);
const mockReadV2Cookie = jest.mocked(readAuthV2SessionCookie);
const mockClearV2Cookie = jest.mocked(clearAuthV2SessionCookie);
const mockReadV2Session = jest.mocked(readAuthSession);
const mockRevokeV2 = jest.mocked(revokeAuthSessionById);
const originalSessionSecret = process.env.SESSION_SECRET;
const originalPlatformFlag = process.env.AUTH_PLATFORM_V2_ENABLED;

function legacyToken(userId: string): string {
  const mac = createHmac("sha256", process.env.SESSION_SECRET!)
    .update(`session:${userId}`)
    .digest("hex");
  return `${userId}.${mac}`;
}

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
    mockReadV2Cookie.mockResolvedValue(null);
    mockClearV2Cookie.mockResolvedValue(undefined);
    mockReadV2Session.mockResolvedValue(null);
    mockRevokeV2.mockResolvedValue(true);
    getCookie.mockReturnValue(undefined);
  });

  test("prefers a valid database session without exposing its token", async () => {
    mockReadV2Cookie.mockResolvedValue("a".repeat(64));
    mockReadV2Session.mockResolvedValue({
      id: "17",
      userId: "42",
    } as never);

    await expect(readOwnerSession()).resolves.toBe("42");
    expect(mockReadV2Session).toHaveBeenCalledWith("a".repeat(64));
  });

  test("preserves a valid legacy owner session when no v2 cookie exists", async () => {
    getCookie.mockImplementation((name: string) => (
      name === "rr_sid" ? { value: legacyToken("42") } : undefined
    ));

    await expect(readOwnerSession()).resolves.toBe("42");
    expect(mockReadV2Session).not.toHaveBeenCalled();
  });

  test("does not accept a non-canary v2 session while the platform is disabled", async () => {
    process.env.AUTH_PLATFORM_V2_ENABLED = "false";
    delete process.env.AUTH_V2_CANARY_USER_IDS;
    mockReadV2Cookie.mockResolvedValue("a".repeat(64));
    mockReadV2Session.mockResolvedValue({
      id: "17",
      userId: "42",
    } as never);

    await expect(readOwnerSession()).resolves.toBeNull();
  });

  test("revokes the database session before clearing both cookies", async () => {
    mockReadV2Cookie.mockResolvedValue("b".repeat(64));
    mockReadV2Session.mockResolvedValue({
      id: "17",
      userId: "42",
    } as never);

    await clearOwnerSession();

    expect(mockRevokeV2).toHaveBeenCalledWith({
      userId: "42",
      sessionId: "17",
      reason: "logout",
    });
    expect(mockClearV2Cookie).toHaveBeenCalled();
    expect(deleteCookie).toHaveBeenCalledWith("rr_sid");
  });
});
