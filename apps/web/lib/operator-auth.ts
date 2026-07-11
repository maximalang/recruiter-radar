import { headers } from "next/headers";

/**
 * Operator (admin) authentication for the /admin panel and its server actions.
 *
 * The product has no user-role system — tenant auth is an anonymous signed
 * cookie (see lib/session.ts). Operator functions (source ingest, pipeline
 * health, source registry) are API-key gated and had no UI. This helper lets
 * the /admin server component + actions share one auth boundary.
 *
 * The key is read from ADMIN_API_KEY, falling back to INGEST_API_KEY so an
 * existing deployment works without a new secret. The check is
 * constant-time-ish via length-equal compare (keys are high-entropy); the
 * header is never logged.
 *
 * Returns { ok: true } on success, or { ok: false, reason } on failure so the
 * caller can render a locked state instead of throwing.
 */
export type OperatorAuthResult =
  | { ok: true }
  | { ok: false; reason: "missing-key" | "missing-header" | "invalid" };

export async function checkOperatorAccess(): Promise<OperatorAuthResult> {
  const expected = (process.env.ADMIN_API_KEY ?? process.env.INGEST_API_KEY ?? "").trim();
  if (!expected) {
    return { ok: false, reason: "missing-key" };
  }

  const headerMap = await headers();
  const provided = (headerMap.get("x-api-key") ?? "").trim();
  if (!provided) {
    return { ok: false, reason: "missing-header" };
  }

  if (provided.length !== expected.length) {
    return { ok: false, reason: "invalid" };
  }

  // simple constant-time compare
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }

  return diff === 0 ? { ok: true } : { ok: false, reason: "invalid" };
}

/** Human-readable reason for the locked UI. Only called with a denied result. */
export function operatorLockedReason(reason: "missing-key" | "missing-header" | "invalid"): string {
  switch (reason) {
    case "missing-key":
      return "ADMIN_API_KEY (или INGEST_API_KEY) не задан на сервере. Панель оператора недоступна.";
    case "missing-header":
      return "Доступ к панели оператора требует ключа (заголовок x-api-key).";
    case "invalid":
      return "Неверный ключ оператора.";
    default:
      return "Доступ запрещён.";
  }
}
