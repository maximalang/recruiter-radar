import { cookies } from "next/headers";

export const ACCOUNT_LOGIN_PENDING_COOKIE = "__Host-rr_login_pending";
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export async function readPendingAccountLogin(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(ACCOUNT_LOGIN_PENDING_COOKIE)?.value?.trim() ?? "";
  return TOKEN_PATTERN.test(token) ? token : null;
}

export async function clearPendingAccountLogin(): Promise<void> {
  const jar = await cookies();
  jar.set(ACCOUNT_LOGIN_PENDING_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
