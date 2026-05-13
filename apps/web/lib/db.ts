import { Pool } from "pg";

import { updateDigestOrgStateFeedback, type DigestFeedbackAction } from "./digestFeedback";
import { getTelegramBotToken, sendTelegramLeadMessage } from "./telegram";
import { logError, logEvent } from "./runtime";

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

type LeadDeliveryRow = LeadRow & { clientProfileId: number; orgId: number; telegramChatId: string | null; payload: unknown };
export type TelegramDeliveryResult = { ok: true } | { ok: false; error: string };
export type EntitlementResult = { allowed: boolean; reason: string | null };
type LeadsResult = { rows: LeadRow[]; error: string | null };

const globalForPg = globalThis as typeof globalThis & { recruiterRadarPool?: Pool };

export function isActionableLeadStatus(value: FormDataEntryValue | null): value is ActionableLeadStatus {
  return typeof value === "string" && ACTIONABLE_LEAD_STATUSES.includes(value as ActionableLeadStatus);
}

export function getPool(): Pool | null {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;
  if (!globalForPg.recruiterRadarPool) {
    globalForPg.recruiterRadarPool = new Pool({ connectionString });
  }
  return globalForPg.recruiterRadarPool;
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

export async function updateLeadStatus(leadId: number, nextStatus: ActionableLeadStatus): Promise<boolean> {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is not set.");
  const row = await pool.query<{ clientProfileId: string; orgId: string }>(
    `SELECT client_profile_id::text AS "clientProfileId", org_id::text AS "orgId" FROM digest_candidates WHERE id = $1 LIMIT 1`,
    [leadId]
  );
  if (row.rowCount !== 1) return false;
  await updateDigestOrgStateFeedback({
    clientProfileId: row.rows[0].clientProfileId,
    orgId: row.rows[0].orgId,
    action: toFeedbackAction(nextStatus)
  });
  return true;
}

async function getLeadDeliveryRow(leadId: number): Promise<LeadDeliveryRow | null> {
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
      dc.payload
    FROM digest_candidates dc
    INNER JOIN orgs o ON o.id = dc.org_id
    INNER JOIN client_profiles cp ON cp.id = dc.client_profile_id
    LEFT JOIN client_digest_org_state cdos ON cdos.client_profile_id = dc.client_profile_id AND cdos.org_id = dc.org_id
    WHERE dc.id = $1
    LIMIT 1
  `, [leadId]);
  return result.rowCount === 1 ? result.rows[0] : null;
}

export async function sendLeadToTelegram(leadId: number): Promise<TelegramDeliveryResult> {
  const lead = await getLeadDeliveryRow(leadId);
  if (!lead) return { ok: false, error: "Digest candidate not found." };
  if (!lead.telegramChatId) return { ok: false, error: "Client profile has no linked Telegram chat." };
  const { botToken, error } = getTelegramBotToken();
  if (!botToken) return { ok: false, error: error ?? "Telegram is not configured." };
  try {
    const confidenceGate = extractConfidenceGate(lead.payload);
    const callbackPrefix = `dgf:${lead.clientProfileId}:${lead.orgId}`;
    const replyMarkup = {
      inline_keyboard: [[
        { text: "✅ Беру", callback_data: `${callbackPrefix}:accepted` },
        { text: "👎 Мимо", callback_data: `${callbackPrefix}:badfit` },
        { text: "⏸ Позже", callback_data: `${callbackPrefix}:snooze` }
      ]]
    };
    await sendTelegramLeadMessage(
      { orgName: lead.orgName, status: lead.status, score: lead.score, lastSignalAt: lead.lastSignalAt, userName: lead.userName, confidenceGate },
      { botToken, chatId: lead.telegramChatId },
      { replyMarkup }
    );
    logEvent("telegram.delivery.sent", { digestCandidateId: leadId, clientProfileId: lead.clientProfileId, orgId: lead.orgId });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Telegram delivery error.";
    logError("telegram.delivery.failed", error, { digestCandidateId: leadId, clientProfileId: lead.clientProfileId, orgId: lead.orgId });
    return { ok: false, error: message };
  }
}

function extractConfidenceGate(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const payloadObj = payload as Record<string, unknown>;
  const confidenceGate = payloadObj.confidenceGate;

  if (typeof confidenceGate === "string" && confidenceGate.length > 0) {
    return confidenceGate;
  }

  return undefined;
}


export async function assertDigestEntitlementByClientProfileId(clientProfileId: string | number): Promise<void> {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is not set.");
  const profile = await pool.query<{ isActive: boolean }>(`SELECT is_active AS "isActive" FROM client_profiles WHERE id = $1 LIMIT 1`, [clientProfileId]);
  if (profile.rowCount !== 1) throw new Error("Client profile not found.");
  if (!profile.rows[0].isActive) throw new Error("Client profile is inactive.");

  const hasUserIdColumn = await pool.query<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = 'client_profiles'
        AND column_name = 'user_id'
    ) AS "exists"
  `);

  let userId: number | null = null;
  if (hasUserIdColumn.rows[0]?.exists) {
    const ownerFromProfile = await pool.query<{ userId: string }>(
      `SELECT user_id::TEXT AS "userId" FROM client_profiles WHERE id = $1 AND user_id IS NOT NULL LIMIT 1`,
      [clientProfileId]
    );
    if (ownerFromProfile.rowCount === 1) userId = Number(ownerFromProfile.rows[0].userId);
  }

  if (userId == null) {
    const ownerFallback = await pool.query<{ userId: string }>(`
      SELECT user_id::TEXT AS "userId"
      FROM checkout_orders
      WHERE payload ->> 'clientProfileId' = $1
      ORDER BY created_at DESC
      LIMIT 1
    `, [String(clientProfileId)]);
    if (ownerFallback.rowCount === 1) userId = Number(ownerFallback.rows[0].userId);
  }

  if (userId == null) throw new Error("Client profile entitlement owner not found.");
  const entitlement = await hasPremiumEntitlement(userId);
  if (!entitlement.allowed) throw new Error(entitlement.reason ?? "No active subscription or pilot.");
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
