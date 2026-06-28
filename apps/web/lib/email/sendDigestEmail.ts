/**
 * Email digest orchestrator — fetch → render → send → record, idempotently.
 *
 * One email per profile per day. Dedupe is atomic against
 * `lead_channel_deliveries` keyed `(email, profile, day:<YYYY-MM-DD>)`, the same
 * spam-guard pattern as web-push (`notifyNewLeadsForRun`): the INSERT ... ON
 * CONFLICT DO NOTHING is the commit point — if it inserts we own delivery, if it
 * does not another worker already sent today's email and we bail.
 *
 * This module does NOT decide which leads are worth sending — it reuses the
 * digest candidates the pipeline already produced (`getLeadsForAllProfiles`,
 * scoped to THIS run via `digestRunId`) and keeps only the auto-deliverable
 * gates (A/B), matching the confidence-gate contract. C/D never auto-deliver by
 * email. Run-scoping is what makes the digest "companies worth contacting today"
 * rather than every candidate ever scored — it mirrors web-push's per-run set.
 */

import { getPool } from "../db-pool";
import { getLeadsForAllProfiles, type LeadItem } from "../leads-data";
import { logError, logEvent } from "../runtime";

import { renderDigestEmail } from "./digestEmail";
import { isEmailConfigured, sendEmail } from "./transport";

export type SendDigestEmailResult =
  | { delivered: true; leadCount: number }
  | {
      delivered: false;
      reason:
        | "not_configured"
        | "no_database"
        | "disabled"
        | "no_email"
        | "no_leads"
        | "already_sent"
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
   * legacy profiles created before owner attribution; getLeadsForAllProfiles
   * treats a null owner as "match owner_id = $ OR owner_id IS NULL", so a null
   * here would over-broaden the scope — we bail on null instead (see caller).
   */
  ownerId: string | null;
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
  }>(
    `
    SELECT email_digest_enabled, digest_email, agency_name, owner_id::TEXT AS owner_id
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
  };
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
 * send; if the send then fails we leave the claim in place (at-most-once — we do
 * not retry the same day to avoid duplicate inboxing on flaky SMTP).
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
  if (!isEmailConfigured()) {
    return { delivered: false, reason: "not_configured" };
  }

  const pool = getPool();
  if (!pool) {
    return { delivered: false, reason: "no_database" };
  }

  const prefs = await getProfileEmailPrefs(input.clientProfileId);
  if (!prefs || !prefs.emailDigestEnabled) {
    return { delivered: false, reason: "disabled" };
  }
  const to = prefs.digestEmail?.trim();
  if (!to) {
    return { delivered: false, reason: "no_email" };
  }
  if (!prefs.ownerId) {
    // Legacy profile created before owner attribution. Bail to avoid over-broad
    // owner_id = $ OR owner_id IS NULL scope — fix the profile first.
    logError("email.digest_no_owner", new Error("Profile has no owner."), {
      clientProfileId: input.clientProfileId,
    });
    return { delivered: false, reason: "disabled" };
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
    return { delivered: false, reason: "no_leads" };
  }

  // Atomic dedupe claim: one email per (profile, day). First caller wins.
  const dedupeKey = `day:${moscowDayKey(input.now ?? new Date())}`;
  const claim = await pool.query<{ id: number }>(
    `
    INSERT INTO lead_channel_deliveries (channel, client_profile_id, dedupe_key, lead_count)
    VALUES ('email', $1, $2, $3)
    ON CONFLICT (channel, client_profile_id, dedupe_key) DO NOTHING
    RETURNING id
    `,
    [input.clientProfileId, dedupeKey, deliverable.length],
  );
  if (claim.rowCount !== 1) {
    return { delivered: false, reason: "already_sent" };
  }

  const rendered = renderDigestEmail(deliverable, {
    profileName: prefs.agencyName,
    appBaseUrl: resolveAppBaseUrl(),
  });

  const sendResult = await sendEmail({
    to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });

  if (!sendResult.ok) {
    logError("email.digest_send_failed", new Error(sendResult.reason), {
      clientProfileId: input.clientProfileId,
    });
    return { delivered: false, reason: "send_failed" };
  }

  logEvent("email.digest_sent", {
    clientProfileId: input.clientProfileId,
    leadCount: deliverable.length,
    dedupeKey,
  });
  return { delivered: true, leadCount: deliverable.length };
}
