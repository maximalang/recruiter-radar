jest.mock("@/lib/auth-v2/legacy-session", () => ({
  exchangeLegacyOwnerSession: jest.fn(),
}));
jest.mock("@/lib/auth-v2/session-cookie", () => ({
  readAuthV2SessionCookie: jest.fn(),
  writeAuthV2SessionCookie: jest.fn(),
}));
jest.mock("@/lib/auth-v2/sessions", () => ({
  readAuthSession: jest.fn(),
  rotateAuthSession: jest.fn(),
}));
jest.mock("@/lib/session", () => ({
  clearLegacyOwnerSession: jest.fn(),
  readLegacyOwnerSessionCookie: jest.fn(),
}));

import { POST } from "@/app/api/auth/session/refresh/route";
import { exchangeLegacyOwnerSession } from "@/lib/auth-v2/legacy-session";
import {
  readAuthV2SessionCookie,
  writeAuthV2SessionCookie,
} from "@/lib/auth-v2/session-cookie";
import {
  readAuthSession,
  rotateAuthSession,
} from "@/lib/auth-v2/sessions";
import {
  clearLegacyOwnerSession,
  readLegacyOwnerSessionCookie,
} from "@/lib/session";

const mockExchange = jest.mocked(exchangeLegacyOwnerSession);
const mockReadCookie = jest.mocked(readAuthV2SessionCookie);
const mockWriteCookie = jest.mocked(writeAuthV2SessionCookie);
const mockReadSession = jest.mocked(readAuthSession);
const mockRotate = jest.mocked(rotateAuthSession);
const mockReadLegacy = jest.mocked(readLegacyOwnerSessionCookie);
const mockClearLegacy = jest.mocked(clearLegacyOwnerSession);
const originalSiteUrl = process.env.AUTH_SITE_URL;
const originalPlatformFlag = process.env.AUTH_PLATFORM_V2_ENABLED;

function sameOriginRequest(origin = "https://radar.example") {
  return new Request("https://radar.example/api/auth/session/refresh", {
    method: "POST",
    headers: {
      Origin: origin,
      "Sec-Fetch-Site": origin === "https://radar.example"
        ? "same-origin"
        : "cross-site",
    },
  });
}

describe("auth v2 writable session refresh boundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AUTH_SITE_URL = "https://radar.example";
    process.env.AUTH_PLATFORM_V2_ENABLED = "true";
    mockReadCookie.mockResolvedValue(null);
    mockReadSession.mockResolvedValue(null);
    mockReadLegacy.mockResolvedValue(null);
    mockExchange.mockResolvedValue(null);
  });

  afterAll(() => {
    restoreEnv("AUTH_SITE_URL", originalSiteUrl);
    restoreEnv("AUTH_PLATFORM_V2_ENABLED", originalPlatformFlag);
  });

  test("rotates a due database session and writes the replacement cookie", async () => {
    mockReadCookie.mockResolvedValue("a".repeat(64));
    mockReadSession.mockResolvedValue({
      id: "17",
      userId: "42",
      rotationDue: true,
    } as never);
    mockRotate.mockResolvedValue({
      token: "b".repeat(64),
      session: { id: "17", userId: "42" },
    } as never);

    const response = await POST(sameOriginRequest());

    expect(mockRotate).toHaveBeenCalledWith("a".repeat(64));
    expect(mockWriteCookie).toHaveBeenCalledWith("b".repeat(64));
    await expect(response.json()).resolves.toEqual({
      ok: true,
      rotated: true,
      migrated: false,
    });
  });

  test("rotates shortly before the hard authorization cutoff", async () => {
    const rotatedAt = new Date(Date.now() - ((24 * 60) - 4) * 60 * 1000);
    mockReadCookie.mockResolvedValue("a".repeat(64));
    mockReadSession.mockResolvedValue({
      id: "17",
      userId: "42",
      rotationDue: false,
      rotatedAt,
    } as never);
    mockRotate.mockResolvedValue({
      token: "b".repeat(64),
      session: { id: "17", userId: "42" },
    } as never);

    await POST(sameOriginRequest());

    expect(mockRotate).toHaveBeenCalledWith(
      "a".repeat(64),
      expect.any(Date),
      { force: true },
    );
    expect(mockWriteCookie).toHaveBeenCalledWith("b".repeat(64));
  });

  test("exchanges an eligible legacy cookie once and clears it", async () => {
    const legacyToken = `42.${"c".repeat(64)}`;
    mockReadLegacy.mockResolvedValue(legacyToken);
    mockExchange.mockResolvedValue({
      token: "d".repeat(64),
      session: { id: "19", userId: "42" },
    } as never);

    const response = await POST(sameOriginRequest());

    expect(mockExchange).toHaveBeenCalledWith({ legacyToken });
    expect(mockWriteCookie).toHaveBeenCalledWith("d".repeat(64));
    expect(mockClearLegacy).toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ migrated: true });
  });

  test("rejects cross-origin refresh before reading any cookie", async () => {
    const response = await POST(sameOriginRequest("https://attacker.example"));

    expect(response.status).toBe(403);
    expect(mockReadCookie).not.toHaveBeenCalled();
    expect(mockReadLegacy).not.toHaveBeenCalled();
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
