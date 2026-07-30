jest.mock("@/lib/account-auth", () => ({
  readLoginChallengeState: jest.fn(),
}));
jest.mock("@/lib/auth-v2/challenges", () => ({
  readAuthV2LoginChallengeState: jest.fn(),
}));

import { readLoginChallengeState } from "@/lib/account-auth";
import { readAuthV2LoginChallengeState } from "@/lib/auth-v2/challenges";
import { POST } from "@/app/api/auth/login/verify/route";

const mockReadLoginChallengeState = jest.mocked(readLoginChallengeState);
const mockReadAuthV2LoginChallengeState = jest.mocked(
  readAuthV2LoginChallengeState,
);
const originalPlatformFlag = process.env.AUTH_PLATFORM_V2_ENABLED;
const originalSiteUrl = process.env.AUTH_SITE_URL;

describe("magic-login verify bridge", () => {
  afterAll(() => {
    restoreEnv("AUTH_PLATFORM_V2_ENABLED", originalPlatformFlag);
    restoreEnv("AUTH_SITE_URL", originalSiteUrl);
  });

  beforeEach(() => {
    mockReadLoginChallengeState.mockReset();
    mockReadAuthV2LoginChallengeState.mockReset();
    mockReadLoginChallengeState.mockResolvedValue({
      status: "invalid",
      userId: null,
    });
    mockReadAuthV2LoginChallengeState.mockResolvedValue({
      status: "invalid",
      userId: null,
    });
    process.env.AUTH_PLATFORM_V2_ENABLED = "false";
    process.env.AUTH_SITE_URL = "https://radar.example";
  });

  test("prefers auth v2 but accepts an outstanding legacy link during rollout", async () => {
    process.env.AUTH_PLATFORM_V2_ENABLED = "true";
    mockReadAuthV2LoginChallengeState
      .mockResolvedValueOnce({
        status: "active",
        maskedEmail: "v***2@e***e.com",
        userId: "42",
      })
      .mockResolvedValueOnce({ status: "invalid", userId: null });
    mockReadLoginChallengeState.mockResolvedValue({
      status: "active",
      maskedEmail: "l***y@e***e.com",
      userId: "43",
    });

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

    expect(mockReadAuthV2LoginChallengeState).toHaveBeenNthCalledWith(
      1,
      v2Token,
    );
    expect(mockReadLoginChallengeState).not.toHaveBeenCalledWith(v2Token);
    expect(mockReadAuthV2LoginChallengeState).toHaveBeenNthCalledWith(
      2,
      legacyToken,
    );
    expect(mockReadLoginChallengeState).toHaveBeenCalledWith(legacyToken);
    await expect(v2Response.json()).resolves.toEqual({
      ok: true,
      next: "/auth/confirm",
      status: "active",
    });
    await expect(legacyResponse.json()).resolves.toEqual({
      ok: true,
      next: "/auth/confirm",
      status: "active",
    });
  });

  test("moves an active fragment token into an httpOnly pending cookie", async () => {
    mockReadLoginChallengeState.mockResolvedValue({
      status: "active",
      maskedEmail: "o***r@e***e.com",
      userId: "42",
    });
    const token = "a".repeat(64);

    const response = await POST(new Request("https://radar.example/api/auth/login/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://radar.example",
      },
      body: JSON.stringify({ token }),
    }));

    expect(mockReadLoginChallengeState).toHaveBeenCalledWith(token);
    expect(response.status).toBe(200);
    await expect(response.clone().json()).resolves.toEqual({
      ok: true,
      next: "/auth/confirm",
      status: "active",
    });
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("set-cookie")).toContain(
      "__Host-rr_login_pending=",
    );
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("Secure");
  });

  test("reports a malformed token without setting a pending cookie", async () => {
    const response = await POST(new Request("https://radar.example/api/auth/login/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://radar.example",
      },
      body: JSON.stringify({ token: "bad" }),
    }));

    await expect(response.clone().json()).resolves.toEqual({
      ok: false,
      next: "/auth/confirm?status=invalid",
      status: "invalid",
    });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  test("rejects an oversized request before challenge lookup", async () => {
    const response = await POST(new Request(
      "https://radar.example/api/auth/login/verify",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://radar.example",
        },
        body: JSON.stringify({ token: "a".repeat(2_048) }),
      },
    ));

    expect(response.status).toBe(400);
    expect(mockReadLoginChallengeState).not.toHaveBeenCalled();
    expect(mockReadAuthV2LoginChallengeState).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  test("preserves a known expired token for the explanatory confirm state", async () => {
    mockReadLoginChallengeState.mockResolvedValue({
      status: "expired",
      userId: "42",
    });
    const token = "d".repeat(64);

    const response = await POST(new Request(
      "https://radar.example/api/auth/login/verify",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://radar.example",
        },
        body: JSON.stringify({ token }),
      },
    ));

    await expect(response.clone().json()).resolves.toEqual({
      ok: false,
      next: "/auth/confirm",
      status: "expired",
    });
    expect(response.headers.get("set-cookie")).toContain(
      `__Host-rr_login_pending=${token}`,
    );
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
    expect(mockReadLoginChallengeState).not.toHaveBeenCalled();
    expect(mockReadAuthV2LoginChallengeState).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
