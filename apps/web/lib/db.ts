import { Pool } from "pg";

import { getPool as getSharedPool } from "./db-pool";
import { updateDigestOrgStateFeedback, type DigestFeedbackAction } from "./digestFeedback";
import type { HhDigestItem } from "./hhDigest";
import { getTelegramBotToken, sendTelegramLeadMessage } from "./telegram";
import { deriveWhyNow, deriveLawfulContactPath, formatLawfulContactPath } from "./leads-data";
import { buildWhyMatch } from "./leads/why-match";
import { parseStoredEnrichment } from "./ai/enrichment/enrichmentStore";
import { buildTelegramDigestFeedbackReplyMarkup } from "./telegramDigestFeedback";
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

type LeadDeliveryRow = LeadRow & {
  clientProfileId: number;
  orgId: number;
  telegramChatId: string | null;
  payload: unknown;
  reasons: unknown;
  opener: string | null;
  evidenceTitles: unknown;
  locationNames: unknown;
  sourceFamilies: unknown;
  vacanciesCount: number | null;
  distinctVacancyNamesCount: number | null;
  confidenceGate: string | null;
  orgDomain: string | null;
  careerPageUrl: string | null;
  aiEnrichment: unknown;
  profileRoles: unknown;
  profileIndustries: unknown;
  profileTargetCity: string | null;
  profileHiringIntentMin: number | null;
  profileMinOpenRoles: number | null;
};
export type TelegramDeliveryResult = { ok: true } | { ok: false; error: string };
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

async function getLeadDeliveryRow(candidateId: number): Promise<LeadDeliveryRow | null> {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is not set.");
  const result = await pool.query<LeadDeliveryRow>(`
    SELECT
      dc.id,
      dc.client_profile_id AS "clientProfileId",
      dc.org_id AS "orgId",
      o.name AS "orgName",
      COALESCE(cdos.feedback_status::text, 'new') AS "status",
      dc.total_score AS "score",
      dc.created_at::text AS "lastSignalAt",
      cp.agency_name AS "userName",
      cp.telegram_chat_id::text AS "telegramChatId",
      dc.payload,
      dc.reasons,
      dc.opener,
      dc.evidence_titles AS "evidenceTitles",
      dc.location_names AS "locationNames",
      dc.source_families AS "sourceFamilies",
      dc.vacancies_count AS "vacanciesCount",
      dc.distinct_vacancy_names_count AS "distinctVacancyNamesCount",
      dc.confidence_gate AS "confidenceGate",
      o.domain AS "orgDomain",
      o.career_page_url AS "careerPageUrl",
      dc.ai_enrichment AS "aiEnrichment",
      cp.roles AS "profileRoles",
      cp.industries AS "profileIndustries",
      cp.target_city AS "profileTargetCity",
      cp.hiring_intent_min AS "profileHiringIntentMin",
      cp.min_open_roles AS "profileMinOpenRoles"
    FROM digest_candidates dc
    INNER JOIN orgs o ON o.id = dc.org_id
    INNER JOIN client_profiles cp ON cp.id = dc.client_profile_id
    LEFT JOIN client_digest_org_state cdos ON cdos.client_profile_id = dc.client_profile_id AND cdos.org_id = dc.org_id
    WHERE dc.id = $1
    LIMIT 1
  `, [candidateId]);
  return result.rowCount === 1 ? result.rows[0] : null;
}

export async function sendLeadToTelegram(candidateId: number): Promise<TelegramDeliveryResult> {
  const lead = await getLeadDeliveryRow(candidateId);
  if (!lead) return { ok: false, error: "Digest candidate not found." };
  if (!lead.telegramChatId) return { ok: false, error: "Client profile has no linked Telegram chat." };
  const { botToken, error } = getTelegramBotToken();
  if (!botToken) return { ok: false, error: error ?? "Telegram is not configured." };
  try {
    // Confidence gate: prefer the column, fall back to the JSON payload.
    const confidenceGate = lead.confidenceGate ?? extractConfidenceGate(lead.payload);
    const evidenceTitles = toStringArray(lead.evidenceTitles);
    const locationNames = toStringArray(lead.locationNames);
    const sourceFamilies = toStringArray(lead.sourceFamilies);

    // Reuse the same evidence-first derivations the /leads/[id] page uses, so the
    // Telegram card and the in-app card tell an identical story.
    const whyNow = deriveWhyNow(lead.reasons);
    const lawfulContactPath = formatLawfulContactPath(
      deriveLawfulContactPath(lead.reasons, sourceFamilies)
    );

    // Why-this-match: concrete filter criteria this lead satisfies for the
    // agency. Reads the profile filter columns joined onto the delivery row.
    const whyMatch = buildWhyMatch(
      {
        orgName: lead.orgName,
        evidenceTitles,
        locationNames,
        vacanciesCount: lead.vacanciesCount,
        score: lead.score,
        latestSignalAt: lead.lastSignalAt,
      },
      {
        roles: toStringArray(lead.profileRoles),
        industries: toStringArray(lead.profileIndustries),
        targetCity: lead.profileTargetCity,
        minOpenRoles: lead.profileMinOpenRoles,
        hiringIntentMin: lead.profileHiringIntentMin,
      }
    );

    // AI hint: the one-line enriched hiring summary, if a successful enrichment
    // was persisted. Advisory only — rendered with an explicit AI label.
    const storedEnrichment = parseStoredEnrichment(lead.aiEnrichment);
    const aiHint =
      storedEnrichment && storedEnrichment.hiringPatternSummary.trim().length > 0
        ? storedEnrichment.hiringPatternSummary.trim()
        : null;

    const feedbackItem: HhDigestItem = {
      rank: 1,
      org_id: String(lead.orgId),
      hh_employer_id: "",
      employer_name: lead.orgName,
      vacancies_count: lead.vacanciesCount ?? 0,
      distinct_vacancy_names_count: lead.distinctVacancyNamesCount ?? 0,
      latest_published_at: lead.lastSignalAt ?? "",
      total_score: lead.score ?? 0,
      reasons: ["", ""],
      opener: lead.opener ?? "",
      source_families: sourceFamilies,
      evidence_titles: evidenceTitles,
      candidate_source_keys: [],
      location_names: locationNames
    };

    const replyMarkup = buildTelegramDigestFeedbackReplyMarkup({
      clientProfileId: String(lead.clientProfileId),
      items: [feedbackItem]
    });
    await sendTelegramLeadMessage(
      {
        orgName: lead.orgName,
        status: lead.status,
        score: lead.score,
        lastSignalAt: lead.lastSignalAt,
        userName: lead.userName,
        confidence_gate: confidenceGate,
        whyNow,
        evidenceTitles,
        vacanciesCount: lead.vacanciesCount,
        lawfulContactPath,
        sourceFamilies,
        locationNames,
        orgDomain: lead.orgDomain,
        careerPageUrl: lead.careerPageUrl,
        whyMatch,
        aiHint
      },
      { botToken, chatId: lead.telegramChatId },
      { replyMarkup }
    );
    logEvent("telegram.delivery.sent", { digestCandidateId: candidateId, clientProfileId: lead.clientProfileId, orgId: lead.orgId });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Telegram delivery error.";
    logError("telegram.delivery.failed", error, { digestCandidateId: candidateId, clientProfileId: lead.clientProfileId, orgId: lead.orgId });
    return { ok: false, error: message };
  }
}

function extractConfidenceGate(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const payloadObj = payload as Record<string, unknown>;
  const confidenceGate = payloadObj.confidence_gate;

  if (typeof confidenceGate === "string" && confidenceGate.length > 0) {
    return confidenceGate;
  }

  return undefined;
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
