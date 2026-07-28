jest.mock("@/lib/account-auth", () => ({
  isLoginChallengeActive: jest.fn(),
}));
jest.mock("@/lib/auth-v2/challenges", () => ({
  isAuthV2LoginChallengeActive: jest.fn(),
  readAuthV2LoginChallengePreview: jest.fn(),
}));

import { isLoginChallengeActive } from "@/lib/account-auth";
import {
  isAuthV2LoginChallengeActive,
  readAuthV2LoginChallengePreview,
} from "@/lib/auth-v2/challenges";
import { POST } from "@/app/api/auth/login/verify/route";

const mockIsLoginChallengeActive = jest.mocked(isLoginChallengeActive);
const mockIsAuthV2LoginChallengeActive = jest.mocked(
  isAuthV2LoginChallengeActive,
);
const mockReadAuthV2LoginChallengePreview = jest.mocked(
  readAuthV2LoginChallengePreview,
);
const originalPlatformFlag = process.env.AUTH_PLATFORM_V2_ENABLED;
const originalSiteUrl = process.env.AUTH_SITE_URL;

describe("magic-login verify bridge", () => {
  afterAll(() => {
    restoreEnv("AUTH_PLATFORM_V2_ENABLED", originalPlatformFlag);
    restoreEnv("AUTH_SITE_URL", originalSiteUrl);
  });

  beforeEach(() => {
    mockIsLoginChallengeActive.mockReset();
    mockIsAuthV2LoginChallengeActive.mockReset();
    mockReadAuthV2LoginChallengePreview.mockReset();
    mockReadAuthV2LoginChallengePreview.mockResolvedValue(null);
    process.env.AUTH_PLATFORM_V2_ENABLED = "false";
    process.env.AUTH_SITE_URL = "https://radar.example";
  });

  test("prefers auth v2 but accepts an outstanding legacy link during rollout", async () => {
    process.env.AUTH_PLATFORM_V2_ENABLED = "true";
    mockIsAuthV2LoginChallengeActive
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    mockIsLoginChallengeActive.mockResolvedValue(true);

    const v2Token = "b".repeat(64);
    const legacyToken = "c".repeat(64);
    const v2Response = await POST(new Request(
      "https://radar.example/api/auth/login/verify",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://radar.example",
        },
        body: JSON.stringify({ token: v2Token }),
      },
    ));
    const legacyResponse = await POST(new Request(
      "https://radar.example/api/auth/login/verify",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://radar.example",
        },
        body: JSON.stringify({ token: legacyToken }),
      },
    ));

    expect(mockIsAuthV2LoginChallengeActive).toHaveBeenNthCalledWith(
      1,
      v2Token,
    );
    expect(mockIsLoginChallengeActive).not.toHaveBeenCalledWith(v2Token);
    expect(mockIsAuthV2LoginChallengeActive).toHaveBeenNthCalledWith(
      2,
      legacyToken,
    );
    expect(mockIsLoginChallengeActive).toHaveBeenCalledWith(legacyToken);
    await expect(v2Response.json()).resolves.toMatchObject({ ok: true });
    await expect(legacyResponse.json()).resolves.toMatchObject({ ok: true });
  });

  test("moves an active fragment token into an httpOnly pending cookie", async () => {
    mockIsLoginChallengeActive.mockResolvedValue(true);
    const token = "a".repeat(64);

    const response = await POST(new Request("https://radar.example/api/auth/login/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://radar.example",
      },
      body: JSON.stringify({ token }),
    }));

    expect(mockIsLoginChallengeActive).toHaveBeenCalledWith(token);
    expect(response.status).toBe(200);
    await expect(response.clone().json()).resolves.toEqual({ ok: true, next: "/auth/confirm" });
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("set-cookie")).toContain(
      "__Host-rr_login_pending=",
    );
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("Secure");
  });

  test("rejects an inactive token without setting a pending cookie", async () => {
    mockIsLoginChallengeActive.mockResolvedValue(false);

    const response = await POST(new Request("https://radar.example/api/auth/login/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://radar.example",
      },
      body: JSON.stringify({ token: "bad" }),
    }));

    await expect(response.clone().json()).resolves.toEqual({ ok: false, next: "/login?error=invalid-link" });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  test("rejects cross-origin token transfer before challenge lookup", async () => {
    const response = await POST(new Request(
      "https://radar.example/api/auth/login/verify",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://attacker.example",
        },
        body: JSON.stringify({ token: "a".repeat(64) }),
      },
    ));

    expect(response.status).toBe(403);
    expect(mockIsLoginChallengeActive).not.toHaveBeenCalled();
    expect(mockIsAuthV2LoginChallengeActive).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
