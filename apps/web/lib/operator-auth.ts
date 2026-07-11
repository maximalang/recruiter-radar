import { createHmac, timingSafeEqual } from "crypto";
import { cookies, headers } from "next/headers";

/**
 * Operator (admin) authentication for the /admin panel and its server actions.
 *
 * The product has no user-role system — tenant auth is an anonymous signed
 * cookie (see lib/session.ts). The operator panel needs a browser-friendly
 * login, so we use a SEPARATE signed cookie (rr_op) keyed off
 * ADMIN_OPERATOR_PASSWORD. The API-key path (x-api-key header) remains for
 * programmatic/CLI callers (cron, ingest scripts).
 *
 * Two access paths:
 *   1. Browser login → loginOperator() verifies password → writeOperatorSession()
 *      sets signed rr_op cookie → checkOperatorAccess() reads the cookie.
 *   2. Programmatic → x-api-key header (ADMIN_API_KEY fallback INGEST_API_KEY).
 *
 * The password is never logged. Cookie is HMAC-signed with SESSION_SECRET
 * (same secret as the tenant session — both are server-held high-entropy keys).
 */

const OPERATOR_COOKIE = "rr_op";
const OPERATOR_COOKIE_MAX_AGE = 60 * 60 * 12; // 12 hours

function getSecret(): string {
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be set and at least 32 characters.");
  }
  return secret;
}

function signOperator(value: string, secret: string): string {
  return createHmac("sha256", secret).update(`operator:${value}`).digest("hex");
}

function encodeOperatorToken(): string {
  const secret = getSecret();
  const mac = signOperator("active", secret);
  return `active.${mac}`;
}

function verifyOperatorToken(token: string): boolean {
  try {
    const dot = token.lastIndexOf(".");
    if (dot < 1) return false;
    const value = token.slice(0, dot);
    const mac = token.slice(dot + 1);
    if (value !== "active") return false;

    const secret = getSecret();
    const expected = signOperator(value, secret);
    const macBuf = Buffer.from(mac, "hex");
    const expectedBuf = Buffer.from(expected, "hex");
    if (macBuf.length !== expectedBuf.length) return false;
    return timingSafeEqual(macBuf, expectedBuf);
  } catch {
    return false;
  }
}

export async function writeOperatorSession(): Promise<void> {
  const token = encodeOperatorToken();
  const jar = await cookies();
  const secure = process.env.SESSION_SECURE_COOKIE !== "false";
  jar.set(OPERATOR_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: OPERATOR_COOKIE_MAX_AGE,
    secure,
  });
}

export async function clearOperatorSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(OPERATOR_COOKIE);
}

export async function readOperatorSession(): Promise<boolean> {
  const jar = await cookies();
  const token = jar.get(OPERATOR_COOKIE)?.value?.trim() ?? null;
  if (!token) return false;
  return verifyOperatorToken(token);
}

export type OperatorAuthResult =
  | { ok: true; via: "session" | "api-key" }
  | { ok: false; reason: "missing-config" | "missing-credentials" | "invalid" };

/**
 * Check operator access from EITHER the signed session cookie OR the x-api-key
 * header. The /admin page calls this to decide whether to render the login form
 * or the operator console. API routes can also use it, though they typically
 * only receive the header path.
 */
export async function checkOperatorAccess(): Promise<OperatorAuthResult> {
  // Path 1: signed session cookie (browser login)
  const hasSession = await readOperatorSession();
  if (hasSession) {
    return { ok: true, via: "session" };
  }

  // Path 2: API key header (programmatic)
  const apiKey = (process.env.ADMIN_API_KEY ?? process.env.INGEST_API_KEY ?? "").trim();
  if (!apiKey) {
    // No API key configured and no session → need login. This is the normal
    // browser state, not an error.
    return { ok: false, reason: "missing-credentials" };
  }

  const headerMap = await headers();
  const provided = (headerMap.get("x-api-key") ?? "").trim();
  if (!provided) {
    return { ok: false, reason: "missing-credentials" };
  }

  if (provided.length !== apiKey.length) {
    return { ok: false, reason: "invalid" };
  }

  let diff = 0;
  for (let i = 0; i < apiKey.length; i++) {
    diff |= provided.charCodeAt(i) ^ apiKey.charCodeAt(i);
  }

  return diff === 0 ? { ok: true, via: "api-key" } : { ok: false, reason: "invalid" };
}

/**
 * Whether the operator panel is available at all (password configured on the
 * server). Used to decide login-form vs fully-locked state.
 */
export function isOperatorPanelConfigured(): boolean {
  return Boolean((process.env.ADMIN_OPERATOR_PASSWORD ?? "").trim());
}

/** Human-readable reason for the locked UI. Only called with a denied result. */
export function operatorLockedReason(reason: "missing-config" | "missing-credentials" | "invalid"): string {
  switch (reason) {
    case "missing-config":
      return "ADMIN_OPERATOR_PASSWORD не задан на сервере. Панель оператора недоступна, пока администратор не задаст пароль.";
    case "missing-credentials":
      return "Войдите как оператор, чтобы открыть панель.";
    case "invalid":
      return "Неверный ключ или пароль оператора.";
    default:
      return "Доступ запрещён.";
  }
}
