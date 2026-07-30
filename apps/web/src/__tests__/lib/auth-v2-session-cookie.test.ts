jest.mock("next/headers", () => ({
  cookies: jest.fn(),
}));

import {
  AUTH_V2_SESSION_COOKIE,
  readAuthV2SessionCookie,
  readAuthV2SessionCookieState,
} from "@/lib/auth-v2/session-cookie";
import { cookies } from "next/headers";

const mockCookies = jest.mocked(cookies);

describe("Auth v2 session cookie reader", () => {
  const getCookie = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockCookies.mockResolvedValue({ get: getCookie } as never);
  });

  test("distinguishes an absent cookie from a malformed present cookie", async () => {
    getCookie.mockReturnValueOnce(undefined);
    await expect(readAuthV2SessionCookieState()).resolves.toEqual({
      status: "absent",
    });

    getCookie.mockReturnValueOnce({ value: "not-a-session-token" });
    await expect(readAuthV2SessionCookieState()).resolves.toEqual({
      status: "invalid",
    });
    expect(getCookie).toHaveBeenCalledWith(AUTH_V2_SESSION_COOKIE);
  });

  test("returns a valid token while preserving the compatibility reader", async () => {
    const token = "a".repeat(64);
    getCookie.mockReturnValueOnce({ value: ` ${token} ` });
    await expect(readAuthV2SessionCookieState()).resolves.toEqual({
      status: "valid",
      token,
    });

    getCookie.mockReturnValueOnce({ value: token });
    await expect(readAuthV2SessionCookie()).resolves.toBe(token);
  });
});
