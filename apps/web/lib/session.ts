import { createHmac, randomBytes } from "crypto";
import { cookies } from "next/headers";

import {
  clearAuthV2SessionCookie,
  readAuthV2SessionCookie,
} from "./auth-v2/session-cookie";
import { isAuthV2SessionReadEnabledForUser } from "./auth-v2/config";
import {
  readLegacyOwnerSessionForAuthorization,
} from "./auth-v2/legacy-session";
import {
  readAuthSession,
  revokeAuthSession,
  revokeAuthSessionById,
} from "./auth-v2/sessions";

const COOKIE_NAME = "rr_sid";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 90; // 90 days

function getSecret(): string {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be set and at least 32 characters.");
  }
  return secret;
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function encode(ownerId: string): string {
  const secret = getSecret();
  const mac = sign(`session:${ownerId}`, secret);
  return `${ownerId}.${mac}`;
}

export async function getOwnerIdFromSession(): Promise<string | null> {
  return readOwnerSession();
}

export function generateOwnerId(): string {
  // Compatible with JavaScript's safe-integer range and BIGINT payment IDs.
  let value = 0;
  while (value === 0) {
    value = randomBytes(6).readUIntBE(0, 6);
  }
  return String(value);
}

/**
 * Read and verify the signed session cookie.
 * Returns the ownerId string if valid, null otherwise.
 */
export async function readOwnerSession(): Promise<string | null> {
  const v2Token = await readAuthV2SessionCookie().catch(() => null);
  if (v2Token) {
    const session = await readAuthSession(v2Token);
    if (
      session
      && isAuthV2SessionReadEnabledForUser(session.userId)
    ) {
      if (session.rotationDue) return null;
      return session.userId;
    }
  }

  const token = await readLegacyOwnerSessionCookie();
  if (!token) return null;
  return readLegacyOwnerSessionForAuthorization({ legacyToken: token });
}

export async function readLegacyOwnerSessionCookie(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(COOKIE_NAME)?.value?.trim() ?? null;
}

/**
 * Write a signed session cookie for the given ownerId.
 * Must be called from a Server Action or Route Handler (not a Server Component render).
 */
export async function writeOwnerSession(ownerId: string): Promise<void> {
  if (!/^[1-9]\d*$/.test(ownerId)) {
    throw new Error("Owner ID must be a positive integer.");
  }
  const token = encode(ownerId);
  const jar = await cookies();
  // Default secure=true; set SESSION_SECURE_COOKIE=false only for local HTTP dev
  const secure = process.env.SESSION_SECURE_COOKIE !== "false";
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
    secure,
  });
}

export function assertOwnerSessionConfigured(): void {
  getSecret();
}

export async function clearOwnerSession(): Promise<void> {
  const v2Token = await readAuthV2SessionCookie().catch(() => null);
  if (v2Token) {
    const session = await readAuthSession(v2Token);
    if (session) {
      await revokeAuthSessionById({
        userId: session.userId,
        sessionId: session.id,
        reason: "logout",
      });
    } else {
      await revokeAuthSession(v2Token, "logout");
    }
  }
  await clearAuthV2SessionCookie();
  await clearLegacyOwnerSession();
}

export async function clearLegacyOwnerSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}
