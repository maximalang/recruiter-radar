jest.mock("@/lib/account-auth", () => ({
  isLoginChallengeActive: jest.fn(),
}));

import { isLoginChallengeActive } from "@/lib/account-auth";
import { POST } from "@/app/api/auth/login/verify/route";

const mockIsLoginChallengeActive = jest.mocked(isLoginChallengeActive);

describe("magic-login verify bridge", () => {
  beforeEach(() => {
    mockIsLoginChallengeActive.mockReset();
    process.env.SESSION_SECURE_COOKIE = "true";
  });

  test("moves an active fragment token into an httpOnly pending cookie", async () => {
    mockIsLoginChallengeActive.mockResolvedValue(true);
    const token = "a".repeat(64);

    const response = await POST(new Request("https://radar.example/api/auth/login/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }));

    expect(mockIsLoginChallengeActive).toHaveBeenCalledWith(token);
    expect(response.status).toBe(200);
    await expect(response.clone().json()).resolves.toEqual({ ok: true, next: "/auth/confirm" });
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("set-cookie")).toContain("rr_login_pending=");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  });

  test("rejects an inactive token without setting a pending cookie", async () => {
    mockIsLoginChallengeActive.mockResolvedValue(false);

    const response = await POST(new Request("https://radar.example/api/auth/login/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "bad" }),
    }));

    await expect(response.clone().json()).resolves.toEqual({ ok: false, next: "/login?error=invalid-link" });
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
