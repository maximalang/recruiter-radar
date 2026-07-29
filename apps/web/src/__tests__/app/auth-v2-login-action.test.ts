jest.mock("next/headers", () => ({
  headers: jest.fn(),
}));
jest.mock("next/navigation", () => ({
  redirect: jest.fn(),
}));
jest.mock("@/lib/account-auth", () => ({
  requestAccountLogin: jest.fn(),
  sanitizeAccountReturnTo: jest.fn(() => "/dashboard"),
}));
jest.mock("@/lib/auth-v2/challenges", () => ({
  requestAuthV2Login: jest.fn(),
  shouldRequestAuthV2Login: jest.fn(),
}));
jest.mock("@/lib/session", () => ({
  clearOwnerSession: jest.fn(),
}));

import { requestLoginAction } from "@/app/login/actions";
import { requestAccountLogin } from "@/lib/account-auth";
import {
  requestAuthV2Login,
  shouldRequestAuthV2Login,
} from "@/lib/auth-v2/challenges";
import { headers } from "next/headers";

const mockHeaders = jest.mocked(headers);
const mockLegacyRequest = jest.mocked(requestAccountLogin);
const mockV2Request = jest.mocked(requestAuthV2Login);
const mockShouldUseV2 = jest.mocked(shouldRequestAuthV2Login);
const originalPlatformFlag = process.env.AUTH_PLATFORM_V2_ENABLED;
const originalProxyHeader = process.env.AUTH_TRUSTED_PROXY_HEADER;
const originalProxyHops = process.env.AUTH_TRUSTED_PROXY_HOPS;

function requestHeaders(values: Record<string, string | null>): Headers {
  return {
    get: (name: string) => values[name] ?? null,
  } as Headers;
}

describe("auth v2 login action rollout", () => {
  afterAll(() => {
    restoreEnv("AUTH_PLATFORM_V2_ENABLED", originalPlatformFlag);
    restoreEnv("AUTH_TRUSTED_PROXY_HEADER", originalProxyHeader);
    restoreEnv("AUTH_TRUSTED_PROXY_HOPS", originalProxyHops);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.AUTH_TRUSTED_PROXY_HEADER;
    delete process.env.AUTH_TRUSTED_PROXY_HOPS;
    process.env.AUTH_PLATFORM_V2_ENABLED = "false";
    mockHeaders.mockResolvedValue(requestHeaders({
      "x-forwarded-for": "198.51.100.9, 10.0.0.1",
      "x-real-ip": "192.0.2.10",
    }) as never);
    mockLegacyRequest.mockResolvedValue({ ok: true });
    mockV2Request.mockResolvedValue({ ok: true });
    mockShouldUseV2.mockResolvedValue(false);
  });

  test("preserves the legacy request path while the platform flag is false", async () => {
    const formData = new FormData();
    formData.set("email", "owner@example.com");
    formData.set("returnTo", "/dashboard");

    await expect(requestLoginAction(null, formData)).resolves.toEqual({
      ok: true,
      email: "owner@example.com",
      returnTo: "/dashboard",
      requestedAt: expect.any(Number),
    });

    expect(mockLegacyRequest).toHaveBeenCalledWith(expect.objectContaining({
      email: "owner@example.com",
      sourceKey: "unknown",
    }));
    expect(mockV2Request).not.toHaveBeenCalled();
  });

  test("uses auth v2 and only an explicitly trusted proxy address", async () => {
    process.env.AUTH_PLATFORM_V2_ENABLED = "true";
    mockShouldUseV2.mockResolvedValue(true);
    process.env.AUTH_TRUSTED_PROXY_HEADER = "x-real-ip";
    const formData = new FormData();
    formData.set("email", "owner@example.com");
    formData.set("returnTo", "/checkout?plan=pilot-week");

    await expect(requestLoginAction(null, formData)).resolves.toEqual({
      ok: true,
      email: "owner@example.com",
      returnTo: "/checkout?plan=pilot-week",
      requestedAt: expect.any(Number),
    });

    expect(mockV2Request).toHaveBeenCalledWith({
      email: "owner@example.com",
      returnTo: "/checkout?plan=pilot-week",
      clientAddress: "192.0.2.10",
      userAgent: null,
    });
    expect(mockLegacyRequest).not.toHaveBeenCalled();
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
