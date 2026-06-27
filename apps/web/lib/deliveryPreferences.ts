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

export type DeliveryPreferences = {
  webPushEnabled: boolean;
  emailDigestEnabled: boolean;
  digestEmail: string | null;
};

type DeliveryPreferencesRow = {
  web_push_enabled: boolean;
  email_digest_enabled: boolean;
  digest_email: string | null;
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

/** Read delivery preferences for the owner's profile, or null when absent. */
export async function getDeliveryPreferencesByOwnerId(
  ownerId: string | number,
): Promise<DeliveryPreferences | null> {
  const pool = getPool();
  if (!pool) return null;

  const result = await pool.query<DeliveryPreferencesRow>(
    `
    SELECT web_push_enabled, email_digest_enabled, digest_email
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
  };
}

export type SaveDeliveryPreferencesResult =
  | { ok: true; preferences: DeliveryPreferences }
  | { ok: false; reason: "no_database" | "not_found" | "invalid_email" | "email_required" };

/**
 * Update delivery preferences for the owner's profile.
 *
 * Invariants enforced here (not in the DB):
 *   - email digest can only be enabled when a valid destination is provided;
 *   - a provided email must be well-formed;
 *   - disabling the email digest keeps the stored address (so re-enabling does
 *     not require re-typing it) unless the caller explicitly clears it.
 */
export async function saveDeliveryPreferencesByOwnerId(input: {
  ownerId: string | number;
  webPushEnabled: boolean;
  emailDigestEnabled: boolean;
  /** Trimmed address, or null to clear. Empty string is treated as null. */
  digestEmail: string | null;
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

  const result = await pool.query<DeliveryPreferencesRow>(
    `
    UPDATE client_profiles
    SET
      web_push_enabled = $2,
      email_digest_enabled = $3,
      digest_email = $4
    WHERE owner_id = $1
    RETURNING web_push_enabled, email_digest_enabled, digest_email
    `,
    [input.ownerId, input.webPushEnabled, input.emailDigestEnabled, digestEmail],
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
    },
  };
}
