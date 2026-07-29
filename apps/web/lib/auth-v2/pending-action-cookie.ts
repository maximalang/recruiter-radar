import { cookies } from "next/headers";

export type PendingAuthAction = "email_change" | "workspace_invite";

const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const COOKIE_NAMES: Record<PendingAuthAction, string> = {
  email_change: "__Host-rr_email_change",
  workspace_invite: "__Host-rr_workspace_invite",
};
const COOKIE_MAX_AGE: Record<PendingAuthAction, number> = {
  email_change: 15 * 60,
  workspace_invite: 24 * 60 * 60,
};
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
};

export async function writePendingAuthActionToken(
  action: PendingAuthAction,
  token: string,
): Promise<void> {
  if (!TOKEN_PATTERN.test(token)) {
    throw new Error("Pending auth action requires a valid opaque token.");
  }
  const jar = await cookies();
  jar.set(COOKIE_NAMES[action], token, {
    ...COOKIE_OPTIONS,
    maxAge: COOKIE_MAX_AGE[action],
  });
}

export async function readPendingAuthActionToken(
  action: PendingAuthAction,
): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAMES[action])?.value?.trim() ?? "";
  return TOKEN_PATTERN.test(token) ? token : null;
}

export async function hasPendingAuthActionToken(
  action: PendingAuthAction,
): Promise<boolean> {
  return Boolean(await readPendingAuthActionToken(action));
}

export async function clearPendingAuthActionToken(
  action: PendingAuthAction,
): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE_NAMES[action], "", {
    ...COOKIE_OPTIONS,
    maxAge: 0,
  });
}
