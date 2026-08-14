/**
 * Email digest orchestrator — fetch → render → send → record, idempotently.
 *
 * One email per profile per day. Dedupe is atomic against
 * `lead_channel_deliveries` keyed `(email, profile, day:<YYYY-MM-DD>)`, the same
 * spam-guard pattern as web-push (`notifyNewLeadsForRun`): the INSERT ... ON
 * CONFLICT DO NOTHING is the claim point — if it inserts we own delivery, if it
 * does not, the persisted state determines whether this is a safe success skip
 * or an unresolved/terminal failure. The claim starts as `processing`; only a
 * successful provider send receives a real `delivered_at`. An ambiguous SMTP
 * result is terminal because replay could duplicate a user-visible email.
 *
 * This module does NOT decide which leads are worth sending — it reuses the
 * digest candidates the pipeline already produced (`getLeadsForAllProfiles`,
 * scoped to THIS run via `digestRunId`) and keeps only the auto-deliverable
 * gates (A/B), matching the confidence-gate contract. C/D never auto-deliver by
 * email. Run-scoping is what makes the digest "companies worth contacting today"
 * rather than every candidate ever scored for the profile — it mirrors web-push's per-run set.
 */

import { getPool } from "../db-pool";
import { getLeadsForAllProfiles, type LeadItem } from "../leads-data";
import { logError, logEvent, logWarn } from "../runtime";
import type { ChannelDeliveryState } from "../delivery/channel-state";
import { persistedChannelDeliveryState } from "../delivery/channel-state";
import type { WhyMatchProfile } from "../leads/why-match";

import { renderDigestEmail } from "./digestEmail";
import { isEmailConfigured, sendEmail } from "./transport";

export type SendDigestEmailResult =
  | { delivered: true; state: 'sent'; leadCount: number }
  | {
      delivered: false;
      state: Exclude<ChannelDeliveryState, 'sent'>;
      reason:
        | "not_configured"
        | "no_database"
        | "disabled"
        | "no_email"
        | "no_leads"
        | "processing"
        | "failed_retryable"
        | "failed_terminal"
        | "already_successfully_delivered"
        | "send_failed";
    };

/** Gates that auto-deliver (CLAUDE.md confidence gates). C/D are review-only. */
const AUTO_DELIVER_GATES = new Set(["A", "B"]);

/** Per-profile email preference + destination, read in one query. */
type ProfileEmailPrefs = {
  emailDigestEnabled: boolean;
  digestEmail: string | null;
  agencyName: string;
  /**
   * Profile owner. Used to owner-scope the lead read below. May be null for
   * legacy profiles created before owner attribution; null always fails closed.
   */
  ownerId: string | null;
  /** Filter fields for the per-lead "Почему вам" block (mirrors the Telegram card). */
  profileFilters: WhyMatchProfile;
};

async function getProfileEmailPrefs(
  clientProfileId: string,
): Promise<ProfileEmailPrefs | null> {
  const pool = getPool();
  if (!pool) return null;

  const result = await pool.query<{
    email_digest_enabled: boolean;
    digest_email: string | null;
    agency_name: string;
    owner_id: string | null;
    roles: unknown;
    industries: unknown;
    target_city: string | null;
    min_open_roles: number | null;
    hiring_intent_min: number | null;
    remote_friendly: boolean | null;
  }>(
    `
    SELECT email_digest_enabled, digest_email, agency_name, owner_id::TEXT AS owner_id,
           roles, industries, target_city, min_open_roles, hiring_intent_min, remote_friendly
    FROM client_profiles
    WHERE id = $1
    LIMIT 1
    `,
    [clientProfileId],
  );

  if (result.rowCount !== 1) return null;
  const row = result.rows[0];
  return {
    emailDigestEnabled: row.email_digest_enabled === true,
    digestEmail: row.digest_email,
    agencyName: row.agency_name,
    ownerId: row.owner_id,
    profileFilters: {
      roles: toStringArray(row.roles),
      industries: toStringArray(row.industries),
      targetCity: row.target_city,
      minOpenRoles: row.min_open_roles,
      hiringIntentMin: row.hiring_intent_min,
      remoteFriendly: row.remote_friendly === true,
    },
  };
}

/** Coerce a JSON/array DB column to a string[] for the why-match filters. */
function toStringArray(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
}

/** Today's date in Moscow time as YYYY-MM-DD — the email dedupe day key. */
function moscowDayKey(now: Date): string {
  // en-CA yields ISO-style YYYY-MM-DD; the timeZone pins the calendar day.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function resolveAppBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!raw) return "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

/**
 * Send today's email digest to one client profile, idempotently.
 *
 * Order is deliberate: cheap preference/dedupe checks first, render+send last.
 * The dedupe row is claimed BEFORE sending so two concurrent runs cannot both
 * send. A failed send keeps the failed claim in place (at-most-once — we do not
 * retry the same day to avoid duplicate inboxing on an ambiguous SMTP failure),
 * but `delivered_at` remains NULL and `delivery_status` becomes `failed_terminal`.
 */
export async function sendDigestEmailForProfile(input: {
  clientProfileId: string;
  /**
   * The digest run whose candidates this email delivers. Required: it scopes the
   * email to this run's fresh batch, keeping it consistent with the Telegram and
   * web-push sets for the same run. Without it the email would accumulate every
   * candidate ever scored for the profile.
   */
  digestRunId: string | number;
  /** Injected for testability; defaults to wall-clock. */
  now?: Date;
}): Promise<SendDigestEmailResult> {
  const pool = getPool();
  if (!pool) {
    return { delivered: false, state: "failed_terminal", reason: "no_database" };
  }

  const prefs = await getProfileEmailPrefs(input.clientProfileId);
  if (!prefs || !prefs.emailDigestEnabled) {
    return { delivered: false, state: "skipped_disabled", reason: "disabled" };
  }
  const to = prefs.digestEmail?.trim();
  if (!to) {
    return { delivered: false, state: "failed_terminal", reason: "no_email" };
  }
  if (!prefs.ownerId) {
    logWarn("email.digest_no_owner", {
      clientProfileId: input.clientProfileId,
      reasonCode: "missing_owner_attribution",
    });
    return { delivered: false, state: "failed_terminal", reason: "failed_terminal" };
  }
  if (!isEmailConfigured()) {
    return { delivered: false, state: "failed_terminal", reason: "not_configured" };
  }

  // Reuse the pipeline's candidates for THIS run; keep only auto-deliverable
  // gates. Run-scoping mirrors web-push and matches the daily-digest contract.
  const { leads } = await getLeadsForAllProfiles({
    profileIds: [input.clientProfileId],
    ownerId: prefs.ownerId,
    digestRunId: input.digestRunId,
  });
  const deliverable: LeadItem[] = leads.filter((lead) =>
    AUTO_DELIVER_GATES.has(lead.confidenceGate),
  );
  if (deliverable.length === 0) {
    return { delivered: false, state: "not_attempted", reason: "no_leads" };
  }

  // Atomic dedupe claim: one email per (profile, day). First caller wins.
  const dedupeKey = `day:${moscowDayKey(input.now ?? new Date())}`;
  const claim = await pool.query<{ id: number }>(
    `
    INSERT INTO lead_channel_deliveries (
      channel, client_profile_id, dedupe_key, lead_count, delivery_status, delivered_at
    )
    VALUES ('email', $1, $2, $3, 'processing', NULL)
    ON CONFLICT (channel, client_profile_id, dedupe_key) DO NOTHING
    RETURNING id
    `,
    [input.clientProfileId, dedupeKey, deliverable.length],
  );
  if (claim.rowCount !== 1) {
    await pool.query(
      `UPDATE lead_channel_deliveries
       SET delivery_status = 'failed_terminal',
           processing_claim_token = NULL,
           next_retry_at = NULL,
           last_error_reason = 'ambiguous_stale_processing'
       WHERE channel = 'email'
         AND client_profile_id = $1
         AND dedupe_key = $2
         AND delivery_status = 'processing'
         AND attempted_at < NOW() - INTERVAL '2 hours'`,
      [input.clientProfileId, dedupeKey],
    );
    const existing = await pool.query<{ delivery_status: string }>(
      `SELECT delivery_status
       FROM lead_channel_deliveries
       WHERE channel = 'email'
         AND client_profile_id = $1
         AND dedupe_key = $2
       LIMIT 1`,
      [input.clientProfileId, dedupeKey],
    );
    const state = persistedChannelDeliveryState(existing.rows[0]?.delivery_status) ?? "failed_terminal";
    return { delivered: false, state, reason: state };
  }
  const claimId = claim.rows[0]?.id;
  if (!claimId) {
    return { delivered: false, state: "failed_terminal", reason: "send_failed" };
  }

  const rendered = renderDigestEmail(deliverable, {
    profileName: prefs.agencyName,
    appBaseUrl: resolveAppBaseUrl(),
    profileFilters: prefs.profileFilters,
  });

  const sendResult = await sendEmail({
    to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });

  if (!sendResult.ok) {
    await pool.query(
      `UPDATE lead_channel_deliveries
       SET delivery_status = 'failed_terminal', delivered_at = NULL,
           last_error_reason = 'smtp_ambiguous_failure'
       WHERE id = $1 AND delivery_status = 'processing'`,
      [claimId],
    ).catch((error) => logError("email.digest_claim_finalize_failed", error, {
      clientProfileId: input.clientProfileId,
    }));
    logWarn("email.digest_send_failed", {
      clientProfileId: input.clientProfileId,
      reasonCode: "smtp_ambiguous_failure",
    });
    return { delivered: false, state: "failed_terminal", reason: "send_failed" };
  }

  const finalized = await pool.query(
    `UPDATE lead_channel_deliveries
     SET delivery_status = 'sent', delivered_at = NOW()
     WHERE id = $1 AND delivery_status = 'processing'`,
    [claimId],
  );
  if (finalized.rowCount !== 1) {
    throw new Error("Email was sent but aggregate delivery state could not be finalized.");
  }

  logEvent("email.digest_sent", {
    clientProfileId: input.clientProfileId,
    leadCount: deliverable.length,
    dedupeKey,
  });
  return { delivered: true, state: 'sent', leadCount: deliverable.length };
}
