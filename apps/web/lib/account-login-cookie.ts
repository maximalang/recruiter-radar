import { cookies } from "next/headers";

export const ACCOUNT_LOGIN_PENDING_COOKIE = "rr_login_pending";

export async function readPendingAccountLogin(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(ACCOUNT_LOGIN_PENDING_COOKIE)?.value?.trim() ?? null;
}

export async function clearPendingAccountLogin(): Promise<void> {
  const jar = await cookies();
  jar.delete(ACCOUNT_LOGIN_PENDING_COOKIE);
}
