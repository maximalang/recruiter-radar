import { cookies } from "next/headers";

export const AUTH_V2_SESSION_COOKIE = "__Host-rr_session";
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
};

export async function readAuthV2SessionCookie(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(AUTH_V2_SESSION_COOKIE)?.value?.trim() ?? "";
  return TOKEN_PATTERN.test(token) ? token : null;
}

export async function writeAuthV2SessionCookie(token: string): Promise<void> {
  if (!TOKEN_PATTERN.test(token)) {
    throw new Error("Auth v2 session token must be a 256-bit hexadecimal value.");
  }
  const jar = await cookies();
  jar.set(AUTH_V2_SESSION_COOKIE, token, {
    ...COOKIE_OPTIONS,
    maxAge: COOKIE_MAX_AGE,
  });
}

export async function clearAuthV2SessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(AUTH_V2_SESSION_COOKIE, "", {
    ...COOKIE_OPTIONS,
    maxAge: 0,
  });
}
