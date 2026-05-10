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
export type TelegramDeliveryResult = { ok: true; skipped?: false } | { ok: false; error: string; skipped?: boolean };
export type EntitlementResult = { allowed: boolean; reason: string | null };
type LeadsResult = { rows: LeadRow[]; error: string | null };

const globalForPg = globalThis as typeof globalThis & { recruiterRadarPool?: Pool };

export function isActionableLeadStatus(value: FormDataEntryValue | null): value is ActionableLeadStatus { return typeof value === "string" && ACTIONABLE_LEAD_STATUSES.includes(value as ActionableLeadStatus); }
export function getPool(): Pool | null { const connectionString = process.env.DATABASE_URL; if (!connectionString) return null; if (!globalForPg.recruiterRadarPool) globalForPg.recruiterRadarPool = new Pool({ connectionString }); return globalForPg.recruiterRadarPool; }

export async function getLeads(): Promise<LeadsResult> { const pool = getPool(); if (!pool) return { rows: [], error: "DATABASE_URL is not set." }; try { const result = await pool.query<LeadRow>(`SELECT dc.id, o.name AS "orgName", COALESCE(cdos.feedback_status::text, 'new') AS "status", dc.total_score AS "score", dc.created_at::text AS "lastSignalAt", cp.agency_name AS "userName" FROM digest_candidates dc INNER JOIN orgs o ON o.id = dc.org_id INNER JOIN client_profiles cp ON cp.id = dc.client_profile_id LEFT JOIN client_digest_org_state cdos ON cdos.client_profile_id = dc.client_profile_id AND cdos.org_id = dc.org_id ORDER BY dc.created_at DESC, dc.id DESC LIMIT 200`); return { rows: result.rows, error: null }; } catch (error) { const message = error instanceof Error ? error.message : "Unknown database error."; return { rows: [], error: `Failed to load digest candidates: ${message}` }; } }
function toFeedbackAction(status: ActionableLeadStatus): DigestFeedbackAction { return status === "snooze" ? "snooze" : status; }

export async function updateLeadStatus(leadId: number, nextStatus: ActionableLeadStatus): Promise<boolean> { const pool = getPool(); if (!pool) throw new Error("DATABASE_URL is not set."); const row = await pool.query<{ clientProfileId: string; orgId: string }>(`SELECT client_profile_id::text AS "clientProfileId", org_id::text AS "orgId" FROM digest_candidates WHERE id = $1 LIMIT 1`, [leadId]); if (row.rowCount !== 1) return false; await updateDigestOrgStateFeedback({ clientProfileId: row.rows[0].clientProfileId, orgId: row.rows[0].orgId, action: toFeedbackAction(nextStatus) }); return true; }

async function getLeadDeliveryRow(leadId: number): Promise<LeadDeliveryRow | null> { const pool = getPool(); if (!pool) throw new Error("DATABASE_URL is not set."); const result = await pool.query<LeadDeliveryRow>(`SELECT dc.id, dc.client_profile_id AS "clientProfileId", dc.org_id AS "orgId", o.name AS "orgName", COALESCE(cdos.feedback_status::text, 'new') AS "status", dc.total_score AS "score", dc.created_at::text AS "lastSignalAt", cp.agency_name AS "userName" FROM digest_candidates dc INNER JOIN orgs o ON o.id = dc.org_id INNER JOIN client_profiles cp ON cp.id = dc.client_profile_id LEFT JOIN client_digest_org_state cdos ON cdos.client_profile_id = dc.client_profile_id AND cdos.org_id = dc.org_id WHERE dc.id = $1 LIMIT 1`, [leadId]); return result.rowCount === 1 ? result.rows[0] : null; }

async function insertDigestDeliveryAttempt(input: { digestCandidateId: number; idempotencyKey: string; channel: string; status: "queued" | "sent" | "failed" | "skipped"; errorMessage?: string | null; }): Promise<boolean> { const pool = getPool(); if (!pool) throw new Error("DATABASE_URL is not set."); const result = await pool.query(`INSERT INTO digest_delivery_attempts (digest_candidate_id, idempotency_key, channel, status, error_message) VALUES ($1, $2, $3, $4, LEFT($5, 1000)) ON CONFLICT (digest_candidate_id, idempotency_key) DO NOTHING RETURNING id`, [input.digestCandidateId, input.idempotencyKey, input.channel, input.status, input.errorMessage ?? null]); return result.rowCount === 1; }

export async function hasClientProfilePremiumEntitlement(clientProfileId: string | number): Promise<EntitlementResult> { const pool = getPool(); if (!pool) throw new Error("DATABASE_URL is not set."); const profile = await pool.query<{ userId: number }>(`SELECT user_id AS "userId" FROM client_profiles WHERE id = $1 LIMIT 1`, [clientProfileId]); if (profile.rowCount !== 1) return { allowed: false, reason: "Client profile not found." }; return hasPremiumEntitlement(profile.rows[0].userId); }

export async function getLatestDigestCandidateIdsByClientProfile(clientProfileId: string | number): Promise<number[]> {
  const pool = getPool(); if (!pool) throw new Error("DATABASE_URL is not set.");
  const run = await pool.query<{ digestRunId: number }>(`SELECT id AS "digestRunId" FROM digest_runs WHERE client_profile_id = $1 ORDER BY created_at DESC LIMIT 1`, [clientProfileId]);
  if (run.rowCount !== 1) return [];
  const rows = await pool.query<{ id: number }>(`SELECT id FROM digest_candidates WHERE digest_run_id = $1 ORDER BY id ASC`, [run.rows[0].digestRunId]);
  return rows.rows.map((r) => r.id);
}

export async function sendLeadToTelegram(leadId: number): Promise<TelegramDeliveryResult> {
  const lead = await getLeadDeliveryRow(leadId); if (!lead) return { ok: false, error: "Digest candidate not found." };
  const channel = "telegram"; const { config, error } = getTelegramConfig(); const target = config?.chatId ?? "unknown"; const idempotencyKey = `${leadId}:${channel}:${target}`;

  const queued = await insertDigestDeliveryAttempt({ digestCandidateId: leadId, idempotencyKey, channel, status: "queued" });
  if (!queued) {
    await insertDigestDeliveryAttempt({ digestCandidateId: leadId, idempotencyKey: `${idempotencyKey}:duplicate:${Date.now()}`, channel, status: "skipped", errorMessage: "Duplicate delivery attempt skipped." });
    logEvent("telegram.delivery.skipped", { digestCandidateId: leadId, clientProfileId: lead.clientProfileId, orgId: lead.orgId, reason: "duplicate" });
    return { ok: false, skipped: true, error: "Duplicate delivery attempt skipped." };
  }

  if (!config) { await insertDigestDeliveryAttempt({ digestCandidateId: leadId, idempotencyKey: `${idempotencyKey}:failed:${Date.now()}`, channel, status: "failed", errorMessage: error ?? "Telegram is not configured." }); return { ok: false, error: error ?? "Telegram is not configured." }; }

  try {
    await sendTelegramLeadMessage({ orgName: lead.orgName, status: lead.status, score: lead.score, lastSignalAt: lead.lastSignalAt, userName: lead.userName }, config);
    await insertDigestDeliveryAttempt({ digestCandidateId: leadId, idempotencyKey: `${idempotencyKey}:sent:${Date.now()}`, channel, status: "sent" });
    logEvent("telegram.delivery.sent", { digestCandidateId: leadId, clientProfileId: lead.clientProfileId, orgId: lead.orgId });
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown Telegram delivery error.";
    await insertDigestDeliveryAttempt({ digestCandidateId: leadId, idempotencyKey: `${idempotencyKey}:failed:${Date.now()}`, channel, status: "failed", errorMessage: message });
    logError("telegram.delivery.failed", e, { digestCandidateId: leadId, clientProfileId: lead.clientProfileId, orgId: lead.orgId });
    return { ok: false, error: message };
  }
}

export async function hasPremiumEntitlement(userId: number): Promise<EntitlementResult> { const pool = getPool(); if (!pool) throw new Error("DATABASE_URL is not set."); const activeSubscription = await pool.query<{ ok: boolean }>(`SELECT TRUE AS ok FROM subscriptions WHERE user_id = $1 AND status IN ('trial', 'active', 'past_due') LIMIT 1`, [userId]); if (activeSubscription.rowCount === 1) return { allowed: true, reason: null }; const activePilot = await pool.query<{ ok: boolean }>(`SELECT TRUE AS ok FROM pilot_enrollments WHERE user_id = $1 AND status = 'active' AND (ends_at IS NULL OR ends_at > NOW()) LIMIT 1`, [userId]); if (activePilot.rowCount === 1) return { allowed: true, reason: null }; return { allowed: false, reason: "No active subscription or pilot." }; }
