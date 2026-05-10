import { Pool } from "pg";

import { updateDigestOrgStateFeedback, type DigestFeedbackAction } from "./digestFeedback";
import { getTelegramConfig, sendTelegramLeadMessage } from "./telegram";
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

type LeadDeliveryRow = LeadRow & { clientProfileId: number; orgId: number };
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
      cp.agency_name AS "userName"
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
  const { config, error } = getTelegramConfig();
  if (!config) return { ok: false, error: error ?? "Telegram is not configured." };
  try {
    await sendTelegramLeadMessage({ orgName: lead.orgName, status: lead.status, score: lead.score, lastSignalAt: lead.lastSignalAt, userName: lead.userName }, config);
    logEvent("telegram.delivery.sent", { digestCandidateId: leadId, clientProfileId: lead.clientProfileId, orgId: lead.orgId });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Telegram delivery error.";
    logError("telegram.delivery.failed", error, { digestCandidateId: leadId, clientProfileId: lead.clientProfileId, orgId: lead.orgId });
    return { ok: false, error: message };
  }
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
