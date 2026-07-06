import { Pool } from "pg";

import { getPool as getSharedPool } from "./db-pool";
import { updateDigestOrgStateFeedback, type DigestFeedbackAction } from "./digestFeedback";
import type { HhDigestItem } from "./hhDigest";
import { getTelegramBotToken, sendTelegramTextMessage } from "./telegram";
import { deriveWhyNow, deriveLawfulContactPath, formatLawfulContactPath, extractPayloadFields } from "./leads-data";
import { buildWhyMatch } from "./leads/why-match";
import { buildTelegramDigestFeedbackReplyMarkup } from "./telegramDigestFeedback";
import { buildBatchDigestMessages, type BatchLead } from "./telegram/digest-batch";
import { logError, logEvent } from "./runtime";
import type {
  ClientProfile,
  Org,
  DigestItem,
  Lead,
  DigestRun,
  QueryResult,
  DigestDbClient
} from "./db-types";

export const ACTIONABLE_LEAD_STATUSES = ["contacted", "replied", "won", "badfit", "snooze"] as const;
export type ActionableLeadStatus = (typeof ACTIONABLE_LEAD_STATUSES)[number];
export type LeadStatus = ActionableLeadStatus | "new" | "saved" | "dismissed";

type LeadRow = {
  id: number;
  orgName: string;
  status: LeadStatus;
  score: number | null;
  lastSignalAt: string | null;
  userName: string;
};

export type EntitlementResult = { allowed: boolean; reason: string | null };
type LeadsResult = { rows: LeadRow[]; error: string | null };

const globalForPg = globalThis as typeof globalThis & { recruiterRadarPool?: Pool };

export function isActionableLeadStatus(value: FormDataEntryValue | null): value is ActionableLeadStatus {
  return typeof value === "string" && ACTIONABLE_LEAD_STATUSES.includes(value as ActionableLeadStatus);
}

/**
 * Returns the shared Postgres Pool.
 * @deprecated Import getPool from '@/lib/db-pool' instead.
 * Kept as a re-export for backward compatibility.
 */
export function getPool(): Pool | null {
  return getSharedPool();
}

export async function getLeads(): Promise<LeadsResult> {
  const pool = getPool();
  if (!pool) return { rows: [], error: "DATABASE_URL is not set." };
  try {
    const result = await pool.query<LeadRow>(`
      SELECT
        dc.id,
        o.name AS "orgName",
        COALESCE(cdos.feedback_status::text, 'new') AS "status",
        dc.total_score AS "score",
        dc.created_at::text AS "lastSignalAt",
        cp.agency_name AS "userName"
      FROM digest_candidates dc
      INNER JOIN orgs o ON o.id = dc.org_id
      INNER JOIN client_profiles cp ON cp.id = dc.client_profile_id
      LEFT JOIN client_digest_org_state cdos
        ON cdos.client_profile_id = dc.client_profile_id
       AND cdos.org_id = dc.org_id
      ORDER BY dc.created_at DESC, dc.id DESC
      LIMIT 200
    `);
    return { rows: result.rows, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown database error.";
    return { rows: [], error: `Failed to load digest candidates: ${message}` };
  }
}

function toFeedbackAction(status: ActionableLeadStatus): DigestFeedbackAction {
  return status === "snooze" ? "snooze" : status;
}

export async function updateLeadStatus(candidateId: number, nextStatus: ActionableLeadStatus): Promise<boolean> {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is not set.");
  const row = await pool.query<{ clientProfileId: string; orgId: string }>(
    `SELECT client_profile_id::text AS "clientProfileId", org_id::text AS "orgId" FROM digest_candidates WHERE id = $1 LIMIT 1`,
    [candidateId]
  );
  if (row.rowCount !== 1) return false;
  await updateDigestOrgStateFeedback({
    clientProfileId: row.rows[0].clientProfileId,
    orgId: row.rows[0].orgId,
    action: toFeedbackAction(nextStatus)
  });
  return true;
}

/**
 * Coerces a Postgres array / JSON column (typed `unknown` off the row) into a
 * clean `string[]` of non-empty trimmed entries. Tolerates null, a single
 * string, or a mixed array.
 */
function toStringArray(value: unknown): string[] {
  if (value == null) return [];
  const raw = Array.isArray(value) ? value : [value];
  return raw
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

/** App base URL for deep links in the batch digest. Trailing slash trimmed. */
function resolveAppBaseUrlForTelegram(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!raw) return "";
  return raw.replace(/\/+$/, "");
}

/** Row shape for the per-run batch candidate query. */
type BatchCandidateRow = {
  id: number;
  orgId: string;
  orgName: string;
  score: number | null;
  vacanciesCount: number;
  payload: unknown;
  reasons: unknown;
  sourceFamilies: unknown;
  orgDomain: string | null;
  orgWebsite: string | null;
  careerPageUrl: string | null;
  telegramChatId: string | null;
  profileRoles: unknown;
  profileIndustries: unknown;
  profileTargetCity: string | null;
  profileHiringIntentMin: number | null;
  profileMinOpenRoles: number | null;
  profileRemoteFriendly: boolean | null;
  lastSignalAt: string | null;
};

export type BatchDeliveryResult =
  | { ok: true; messagesSent: number; leadCount: number }
  | { ok: false; error: string };

/**
 * Deliver ALL A/B candidates for one (run, client profile) as a SINGLE batched
 * Telegram digest — one numbered message (split into ≤2 messages at the 4096
 * char limit) instead of one message per lead. Feedback buttons for every
 * included lead are attached to the LAST message (the one carrying the footer
 * link and the one the recruiter lands on).
 *
 * Idempotency, claim/skip bookkeeping, and the C/D gate are owned by the caller
 * (deliverCandidatesForRun); this function does the fetch + build + send only.
 * Returns the number of Telegram messages sent and the lead count.
 */
export async function sendBatchDigestForRun(input: {
  runId: string;
  clientProfileId: string;
}): Promise<BatchDeliveryResult> {
  const pool = getPool();
  if (!pool) return { ok: false, error: "DATABASE_URL is not set." };

  const { botToken, error } = getTelegramBotToken();
  if (!botToken) return { ok: false, error: error ?? "Telegram is not configured." };

  const result = await pool.query<BatchCandidateRow>(`
    SELECT
      dc.id,
      dc.org_id AS "orgId",
      dc.source_display_name AS "orgName",
      dc.total_score AS "score",
      dc.vacancies_count AS "vacanciesCount",
      dc.payload,
      dc.reasons,
      dc.source_families AS "sourceFamilies",
      dc.latest_published_at::text AS "lastSignalAt",
      o.domain AS "orgDomain",
      o.website_url AS "orgWebsite",
      o.career_page_url AS "careerPageUrl",
      cp.telegram_chat_id::text AS "telegramChatId",
      cp.roles AS "profileRoles",
      cp.industries AS "profileIndustries",
      cp.target_city AS "profileTargetCity",
      cp.hiring_intent_min AS "profileHiringIntentMin",
      cp.min_open_roles AS "profileMinOpenRoles",
      cp.remote_friendly AS "profileRemoteFriendly"
    FROM digest_candidates dc
    INNER JOIN client_profiles cp ON cp.id = dc.client_profile_id
    LEFT JOIN orgs o ON o.id = dc.org_id
    WHERE dc.digest_run_id = $1
      AND dc.client_profile_id = $2
      AND (dc.payload->>'confidence_gate' NOT IN ('C', 'D') OR dc.payload->>'confidence_gate' IS NULL)
    ORDER BY dc.total_score DESC, dc.id ASC
  `, [input.runId, input.clientProfileId]);

  if (result.rowCount === 0) {
    return { ok: true, messagesSent: 0, leadCount: 0 };
  }

  const chatId = result.rows[0].telegramChatId;
  if (!chatId) {
    return { ok: false, error: "Client profile has no linked Telegram chat." };
  }

  // Build the per-lead batch cards + the feedback-button items in one pass so the
  // buttons and the numbered blocks stay in lockstep (button rank = block index).
  const batchLeads: BatchLead[] = [];
  const feedbackItems: HhDigestItem[] = [];

  result.rows.forEach((row, index) => {
    const { evidenceTitles, locationNames, isForeignEmployer, confidenceGate } = extractPayloadFields(row.payload);
    const sourceFamilies = toStringArray(row.sourceFamilies);
    const whyMatch = buildWhyMatch(
      {
        orgName: row.orgName,
        evidenceTitles,
        locationNames,
        vacanciesCount: row.vacanciesCount,
        score: row.score,
        latestSignalAt: row.lastSignalAt,
      },
      {
        roles: toStringArray(row.profileRoles),
        industries: toStringArray(row.profileIndustries),
        targetCity: row.profileTargetCity,
        minOpenRoles: row.profileMinOpenRoles,
        hiringIntentMin: row.profileHiringIntentMin,
        remoteFriendly: row.profileRemoteFriendly ?? false,
      },
    );

    batchLeads.push({
      orgId: String(row.orgId),
      orgName: row.orgName,
      score: row.score,
      confidenceGate: confidenceGate || undefined,
      vacanciesCount: row.vacanciesCount ?? 0,
      evidenceTitles,
      locationNames,
      whyLine: whyMatch[0] ?? deriveWhyNow(row.reasons) ?? null,
      isForeignEmployer,
      careerPageUrl: row.careerPageUrl,
      orgWebsite: row.orgWebsite,
      orgDomain: row.orgDomain,
      contactPathLabel: formatLawfulContactPath(
        deriveLawfulContactPath(row.reasons, sourceFamilies),
      ),
      sourceFamilies,
    });

    feedbackItems.push({
      rank: index + 1,
      org_id: String(row.orgId),
      hh_employer_id: "",
      employer_name: row.orgName,
      vacancies_count: row.vacanciesCount ?? 0,
      distinct_vacancy_names_count: 0,
      latest_published_at: row.lastSignalAt ?? "",
      total_score: row.score ?? 0,
      reasons: ["", ""],
      opener: "",
      source_families: sourceFamilies,
      evidence_titles: evidenceTitles,
      candidate_source_keys: [],
      location_names: locationNames,
    });
  });

  const baseUrl = resolveAppBaseUrlForTelegram();
  const batch = buildBatchDigestMessages({
    leads: batchLeads,
    leadsUrl: baseUrl ? `${baseUrl}/leads` : "/leads",
  });

  if (batch.messages.length === 0) {
    return { ok: true, messagesSent: 0, leadCount: 0 };
  }

  // Feedback buttons only cover the leads that made it into the text.
  const replyMarkup = buildTelegramDigestFeedbackReplyMarkup({
    clientProfileId: String(input.clientProfileId),
    items: feedbackItems.slice(0, batch.includedLeads),
  });

  // Partial-send safety: the delivery claim covers the WHOLE batch, so if we
  // fail the claim after the first message already went out, the caller's
  // stale-reclaim would re-send message 1 (duplicate). To avoid that, a failure
  // on message 1 fails the whole batch (nothing was delivered — safe to retry),
  // but a failure on a LATER message is swallowed: the first message (which
  // carries the leads + the "open all" link) is already in the recruiter's chat,
  // so we treat the batch as delivered and log the shortfall rather than risk a
  // duplicate on retry. The dropped leads remain reachable via the in-app link.
  let messagesSent = 0;
  try {
    for (let i = 0; i < batch.messages.length; i += 1) {
      const isLast = i === batch.messages.length - 1;
      try {
        await sendTelegramTextMessage(
          batch.messages[i],
          { botToken, chatId },
          {
            parseMode: "HTML",
            ...(isLast && replyMarkup ? { replyMarkup } : {}),
          },
        );
        messagesSent += 1;
      } catch (perMessageError) {
        if (i === 0) throw perMessageError; // nothing delivered yet — fail + retry
        // A later message failed after message 1 landed. Don't fail the claim
        // (that would re-deliver message 1); log and stop.
        logError("telegram.batch_delivery.partial", perMessageError, {
          runId: input.runId,
          clientProfileId: input.clientProfileId,
          failedMessageIndex: i,
          messagesSent,
        });
        break;
      }
    }
    logEvent("telegram.batch_delivery.sent", {
      runId: input.runId,
      clientProfileId: input.clientProfileId,
      messages: messagesSent,
      leads: batch.includedLeads,
      dropped: batch.droppedLeads,
    });
    return { ok: true, messagesSent, leadCount: batch.includedLeads };
  } catch (sendError) {
    const message = sendError instanceof Error ? sendError.message : "Unknown Telegram batch error.";
    logError("telegram.batch_delivery.failed", sendError, {
      runId: input.runId,
      clientProfileId: input.clientProfileId,
    });
    return { ok: false, error: message };
  }
}


export async function assertDigestEntitlementByClientProfileId(clientProfileId: string | number): Promise<void> {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is not set.");

  const profile = await pool.query<{ isActive: boolean }>(
    `SELECT is_active AS "isActive" FROM client_profiles WHERE id = $1 LIMIT 1`,
    [clientProfileId]
  );
  if (profile.rowCount !== 1) throw new Error("Client profile not found.");
  if (!profile.rows[0].isActive) throw new Error("Client profile is inactive.");

  // Resolve owner via paid checkout order only — canceled/unpaid orders are excluded.
  const ownerResult = await pool.query<{ userId: string }>(`
    SELECT user_id::TEXT AS "userId"
    FROM checkout_orders
    WHERE payload ->> 'clientProfileId' = $1
      AND status = 'paid'
    ORDER BY paid_at DESC
    LIMIT 1
  `, [String(clientProfileId)]);

  if (ownerResult.rowCount !== 1) throw new Error("Client profile entitlement owner not found.");
  const userId = Number(ownerResult.rows[0].userId);

  const entitlement = await hasPremiumEntitlement(userId);
  if (!entitlement.allowed) throw new Error(entitlement.reason ?? "No active subscription or pilot.");
}


export async function assertTelegramChatOwnsClientProfile(telegramChatId: string, clientProfileId: string): Promise<void> {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is not set.");
  const result = await pool.query<{ ok: boolean }>(
    `SELECT TRUE AS ok FROM client_profiles WHERE id = $1 AND telegram_chat_id::text = $2 LIMIT 1`,
    [clientProfileId, telegramChatId]
  );
  if (result.rowCount !== 1) throw new Error("Chat is not authorized for this client profile.");
}

export async function checkTelegramChatOwnsClientProfile(telegramChatId: string, clientProfileId: string): Promise<boolean> {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is not set.");
  const result = await pool.query<{ ok: boolean }>(
    `SELECT TRUE AS ok FROM client_profiles WHERE id = $1 AND telegram_chat_id::text = $2 LIMIT 1`,
    [clientProfileId, telegramChatId]
  );
  return result.rowCount === 1;
}

export async function hasPremiumEntitlement(userId: number): Promise<EntitlementResult> {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is not set.");
  const activeSubscription = await pool.query<{ ok: boolean }>(`SELECT TRUE AS ok FROM subscriptions WHERE user_id = $1 AND status IN ('trial', 'active', 'past_due') LIMIT 1`, [userId]);
  if (activeSubscription.rowCount === 1) return { allowed: true, reason: null };
  const activePilot = await pool.query<{ ok: boolean }>(`SELECT TRUE AS ok FROM pilot_enrollments WHERE user_id = $1 AND status = 'active' AND (ends_at IS NULL OR ends_at > NOW()) LIMIT 1`, [userId]);
  if (activePilot.rowCount === 1) return { allowed: true, reason: null };
  return { allowed: false, reason: "No active subscription or pilot." };
}
