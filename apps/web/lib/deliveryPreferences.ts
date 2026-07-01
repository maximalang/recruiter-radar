/**
 * Delivery-channel preferences — owner-scoped read/write.
 *
 * These columns (web_push_enabled / email_digest_enabled / digest_email) live on
 * client_profiles but are a separate concern from the ICP/scoring profile, so
 * they get their own thin repository instead of widening ClientProfile and every
 * SELECT that maps it. Mirrors how webPush.ts already reads these columns with
 * targeted SQL rather than through the ClientProfile mapper.
 *
 * All writes are scoped to the authenticated session owner (owner_id), the same
 * anti-IDOR boundary as the settings profile action.
 */

import { getPool } from "./db-pool";

export type DeliveryFrequency = "daily" | "weekly";

export type DeliveryPreferences = {
  webPushEnabled: boolean;
  emailDigestEnabled: boolean;
  digestEmail: string | null;
  deliveryEnabled: boolean;
  /** Desired local delivery time, 'HH:MM' 24h, or null for "no preference". */
  deliveryTimeLocal: string | null;
  /** IANA timezone name. */
  deliveryTimezone: string;
  deliveryFrequency: DeliveryFrequency;
};

type DeliveryPreferencesRow = {
  web_push_enabled: boolean;
  email_digest_enabled: boolean;
  digest_email: string | null;
  delivery_enabled: boolean;
  delivery_time_local: string | null;
  delivery_timezone: string;
  delivery_frequency: string;
};

/**
 * Pragmatic email shape check — not RFC-complete, just enough to reject obvious
 * garbage before it becomes a send target. Empty/whitespace is handled upstream
 * (caller passes null to clear the address).
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidDigestEmail(value: string): boolean {
  return EMAIL_RE.test(value);
}

/**
 * 'HH:MM' 24h. Mirrors the CHECK constraint in migration
 * 20260701120000 so client and DB agree on the shape.
 */
const HHMM_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export function isValidDeliveryTimeLocal(value: string): boolean {
  return HHMM_RE.test(value);
}

/**
 * Best-effort IANA tz name check. We do not ship the full tz list — the DB
 * stores any non-blank string and the cron hint falls back gracefully when a
 * name is unrecognized (treats it as UTC). This only rejects obvious garbage
 * (blank, whitespace-only) so a typo at least surfaces as "unknown tz" rather
 * than silently storing an empty value.
 */
export function isValidDeliveryTimezone(value: string): boolean {
  return value.trim() !== "" && value.trim().length <= 64;
}

export const VALID_DELIVERY_FREQUENCIES: ReadonlySet<DeliveryFrequency> = new Set([
  "daily",
  "weekly",
]);

export function normalizeDeliveryFrequency(
  value: unknown,
): DeliveryFrequency | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  return VALID_DELIVERY_FREQUENCIES.has(v as DeliveryFrequency)
    ? (v as DeliveryFrequency)
    : null;
}

/** Read delivery preferences for the owner's profile, or null when absent. */
export async function getDeliveryPreferencesByOwnerId(
  ownerId: string | number,
): Promise<DeliveryPreferences | null> {
  const pool = getPool();
  if (!pool) return null;

  const result = await pool.query<DeliveryPreferencesRow>(
    `
    SELECT web_push_enabled, email_digest_enabled, digest_email,
           delivery_enabled, delivery_time_local, delivery_timezone, delivery_frequency
    FROM client_profiles
    WHERE owner_id = $1
    LIMIT 1
    `,
    [ownerId],
  );

  if (result.rowCount !== 1) return null;
  const row = result.rows[0];
  return {
    webPushEnabled: row.web_push_enabled === true,
    emailDigestEnabled: row.email_digest_enabled === true,
    digestEmail: row.digest_email,
    deliveryEnabled: row.delivery_enabled === true,
    deliveryTimeLocal: row.delivery_time_local,
    deliveryTimezone: row.delivery_timezone,
    deliveryFrequency: normalizeDeliveryFrequency(row.delivery_frequency) ?? "daily",
  };
}

export type SaveDeliveryPreferencesResult =
  | { ok: true; preferences: DeliveryPreferences }
  | {
      ok: false;
      reason:
        | "no_database"
        | "not_found"
        | "invalid_email"
        | "email_required"
        | "invalid_time"
        | "invalid_timezone"
        | "invalid_frequency";
    };

/**
 * Update delivery preferences for the owner's profile.
 *
 * Invariants enforced here (not in the DB):
 *   - email digest can only be enabled when a valid destination is provided;
 *   - a provided email must be well-formed;
 *   - disabling the email digest keeps the stored address (so re-enabling does
 *     not require re-typing it) unless the caller explicitly clears it.
 *   - delivery_time_local, when provided, must match HH:MM 24h;
 *   - delivery_timezone must be a non-blank IANA name;
 *   - delivery_frequency must be a known enum value.
 */
export async function saveDeliveryPreferencesByOwnerId(input: {
  ownerId: string | number;
  webPushEnabled: boolean;
  emailDigestEnabled: boolean;
  /** Trimmed address, or null to clear. Empty string is treated as null. */
  digestEmail: string | null;
  deliveryEnabled: boolean;
  /** 'HH:MM' 24h, or null/blank to clear. */
  deliveryTimeLocal: string | null;
  deliveryTimezone: string;
  deliveryFrequency: DeliveryFrequency;
}): Promise<SaveDeliveryPreferencesResult> {
  const pool = getPool();
  if (!pool) return { ok: false, reason: "no_database" };

  const digestEmail = input.digestEmail && input.digestEmail.trim() !== ""
    ? input.digestEmail.trim()
    : null;

  if (digestEmail !== null && !isValidDigestEmail(digestEmail)) {
    return { ok: false, reason: "invalid_email" };
  }
  if (input.emailDigestEnabled && digestEmail === null) {
    return { ok: false, reason: "email_required" };
  }

  const deliveryTimeLocal =
    input.deliveryTimeLocal && input.deliveryTimeLocal.trim() !== ""
      ? input.deliveryTimeLocal.trim()
      : null;
  if (deliveryTimeLocal !== null && !isValidDeliveryTimeLocal(deliveryTimeLocal)) {
    return { ok: false, reason: "invalid_time" };
  }

  const deliveryTimezone = input.deliveryTimezone.trim();
  if (!isValidDeliveryTimezone(deliveryTimezone)) {
    return { ok: false, reason: "invalid_timezone" };
  }

  if (!VALID_DELIVERY_FREQUENCIES.has(input.deliveryFrequency)) {
    return { ok: false, reason: "invalid_frequency" };
  }

  const result = await pool.query<DeliveryPreferencesRow>(
    `
    UPDATE client_profiles
    SET
      web_push_enabled = $2,
      email_digest_enabled = $3,
      digest_email = $4,
      delivery_enabled = $5,
      delivery_time_local = $6,
      delivery_timezone = $7,
      delivery_frequency = $8
    WHERE owner_id = $1
    RETURNING web_push_enabled, email_digest_enabled, digest_email,
              delivery_enabled, delivery_time_local, delivery_timezone, delivery_frequency
    `,
    [
      input.ownerId,
      input.webPushEnabled,
      input.emailDigestEnabled,
      digestEmail,
      input.deliveryEnabled,
      deliveryTimeLocal,
      deliveryTimezone,
      input.deliveryFrequency,
    ],
  );

  if (result.rowCount !== 1) {
    return { ok: false, reason: "not_found" };
  }
  const row = result.rows[0];
  return {
    ok: true,
    preferences: {
      webPushEnabled: row.web_push_enabled === true,
      emailDigestEnabled: row.email_digest_enabled === true,
      digestEmail: row.digest_email,
      deliveryEnabled: row.delivery_enabled === true,
      deliveryTimeLocal: row.delivery_time_local,
      deliveryTimezone: row.delivery_timezone,
      deliveryFrequency: normalizeDeliveryFrequency(row.delivery_frequency) ?? "daily",
    },
  };
}
