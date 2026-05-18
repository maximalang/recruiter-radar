import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

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

function decode(token: string): string | null {
  try {
    const dot = token.lastIndexOf(".");
    if (dot < 1) return null;

    const ownerId = token.slice(0, dot);
    const mac = token.slice(dot + 1);

    if (!/^[0-9a-f]+$/.test(ownerId)) return null;

    const secret = getSecret();
    const expected = sign(`session:${ownerId}`, secret);

    const macBuf = Buffer.from(mac, "hex");
    const expectedBuf = Buffer.from(expected, "hex");

    if (macBuf.length !== expectedBuf.length) return null;
    if (!timingSafeEqual(macBuf, expectedBuf)) return null;

    return ownerId;
  } catch {
    return null;
  }
}

export function generateOwnerId(): string {
  // 8 random bytes → 16-char hex, used as anonymous visitor ID
  return randomBytes(8).toString("hex");
}

/**
 * Read and verify the signed session cookie.
 * Returns the ownerId string if valid, null otherwise.
 */
export async function readOwnerSession(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value?.trim() ?? null;
  if (!token) return null;
  return decode(token);
}

/**
 * Write a signed session cookie for the given ownerId.
 * Must be called from a Server Action or Route Handler (not a Server Component render).
 */
export async function writeOwnerSession(ownerId: string): Promise<void> {
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
