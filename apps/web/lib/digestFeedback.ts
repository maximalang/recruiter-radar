import { Pool, type PoolClient } from "pg";

type DigestFeedbackDbClient = Pick<Pool, "query"> | Pick<PoolClient, "query">;

type DigestCandidateContextRow = {
  orgId: string;
  sourceExternalId: string | null;
  sourceDisplayName: string | null;
};

type DigestOrgStateRow = {
  clientProfileId: string;
  orgId: string;
  feedbackStatus: string;
  feedbackAt: string | null;
  feedbackNote: string | null;
  cooldownUntil: string | null;
  suppressedUntil: string | null;
  lastDigestCandidateId: string | null;
  lastDigestRunId: string | null;
  updatedAt: string;
};

export const DIGEST_FEEDBACK_ACTIONS = [
  "accepted",
  "badfit",
  "dismissed",
  "snooze",
  "contacted",
  "replied",
  "won"
] as const;

export type DigestFeedbackAction = (typeof DIGEST_FEEDBACK_ACTIONS)[number];

const globalForPg = globalThis as typeof globalThis & {
  recruiterRadarDigestFeedbackPool?: Pool;
};

function getPool(): Pool | null {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    return null;
  }

  if (!globalForPg.recruiterRadarDigestFeedbackPool) {
    globalForPg.recruiterRadarDigestFeedbackPool = new Pool({
      connectionString
    });
  }

  return globalForPg.recruiterRadarDigestFeedbackPool;
}

export function isDigestFeedbackAction(value: unknown): value is DigestFeedbackAction {
  return typeof value === "string" && DIGEST_FEEDBACK_ACTIONS.includes(value as DigestFeedbackAction);
}

export const DEFAULT_BADFIT_SUPPRESSION_DAYS = 30
const MAX_SUPPRESSION_DAYS = 365
const DEFAULT_SNOOZE_DAYS = 7
const MAX_SNOOZE_DAYS = 90

export type DigestFeedbackActionPlan = {
  feedbackStatus: string
  cooldownSql: string
  suppressedSql: string
  cooldownUpdateSql: string
  suppressedUpdateSql: string
  extraParams: unknown[]
}

/**
 * Pure SQL-fragment plan for a digest feedback action. Lifted out of
 * updateDigestOrgStateFeedback so the time-bounded suppression contract
 * (badfit/dismissed default 30 days) can be unit-tested without a DB.
 *
 * paramOffset = number of $N placeholders already consumed by the caller's
 * static params, so generated $N indices are unique inside the prepared
 * statement.
 */
export function buildDigestFeedbackActionPlan(input: {
  action: DigestFeedbackAction
  snoozeDays?: number | null
  suppressionDays?: number | null
  paramOffset?: number
}): DigestFeedbackActionPlan {
  const offset = input.paramOffset ?? 0
  switch (input.action) {
    case 'accepted':
    case 'contacted':
      return {
        feedbackStatus: 'contacted',
        cooldownSql: 'NULL',
        suppressedSql: "'infinity'::timestamptz",
        cooldownUpdateSql: 'NULL',
        suppressedUpdateSql: "'infinity'::timestamptz",
        extraParams: [],
      }
    case 'replied':
      return {
        feedbackStatus: 'replied',
        cooldownSql: 'NULL',
        suppressedSql: "'infinity'::timestamptz",
        cooldownUpdateSql: 'NULL',
        suppressedUpdateSql: "'infinity'::timestamptz",
        extraParams: [],
      }
    case 'won':
      return {
        feedbackStatus: 'won',
        cooldownSql: 'NULL',
        suppressedSql: "'infinity'::timestamptz",
        cooldownUpdateSql: 'NULL',
        suppressedUpdateSql: "'infinity'::timestamptz",
        extraParams: [],
      }
    case 'badfit':
    case 'dismissed': {
      const days = clampSuppressionDays(input.suppressionDays)
      const idx = offset + 1
      return {
        feedbackStatus: input.action,
        cooldownSql: 'NULL',
        suppressedSql: `NOW() + ($${idx} * INTERVAL '1 day')`,
        cooldownUpdateSql: 'NULL',
        suppressedUpdateSql: `GREATEST(COALESCE(client_digest_org_state.suppressed_until, '-infinity'::timestamptz), NOW() + ($${idx} * INTERVAL '1 day'))`,
        extraParams: [days],
      }
    }
    case 'snooze': {
      const days = clampSnoozeDays(input.snoozeDays)
      const idx = offset + 1
      return {
        feedbackStatus: 'snooze',
        cooldownSql: 'NULL',
        suppressedSql: `NOW() + ($${idx} * INTERVAL '1 day')`,
        cooldownUpdateSql: 'NULL',
        suppressedUpdateSql: `GREATEST(COALESCE(client_digest_org_state.suppressed_until, '-infinity'::timestamptz), NOW() + ($${idx} * INTERVAL '1 day'))`,
        extraParams: [days],
      }
    }
  }
}

function clampSuppressionDays(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_BADFIT_SUPPRESSION_DAYS
  }
  const v = Math.trunc(value)
  if (v <= 0) return DEFAULT_BADFIT_SUPPRESSION_DAYS
  if (v > MAX_SUPPRESSION_DAYS) return MAX_SUPPRESSION_DAYS
  return v
}

function clampSnoozeDays(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_SNOOZE_DAYS
  }
  const v = Math.trunc(value)
  if (v <= 0) return DEFAULT_SNOOZE_DAYS
  if (v > MAX_SNOOZE_DAYS) return MAX_SNOOZE_DAYS
  return v
}

export async function updateDigestOrgStateFeedback(input: {
  clientProfileId: string | number;
  orgId?: string | number | null;
  digestCandidateId?: string | number | null;
  action: DigestFeedbackAction;
  note?: string | null;
  snoozeDays?: number | null;
  suppressionDays?: number | null;
}, db?: DigestFeedbackDbClient): Promise<DigestOrgStateRow> {
  const pool = db ?? getPool();

  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  const clientProfileId = normalizePositiveInteger(input.clientProfileId, "Invalid client profile id.");
  const digestCandidateId = input.digestCandidateId == null ? null : normalizePositiveInteger(input.digestCandidateId, "Invalid digest candidate id.");
  const explicitOrgId = input.orgId == null ? null : normalizePositiveInteger(input.orgId, "Invalid org id.");
  const note = normalizeOptionalText(input.note);
  // Static placeholders below: $1..$7. Action-specific extras start at $8.
  const STATIC_PARAM_COUNT = 7;
  const actionConfig = buildDigestFeedbackActionPlan({
    action: input.action,
    snoozeDays: input.snoozeDays,
    suppressionDays: input.suppressionDays,
    paramOffset: STATIC_PARAM_COUNT,
  });
  const candidateContext = digestCandidateId == null
    ? null
    : await getDigestCandidateContext({ clientProfileId, digestCandidateId }, pool);
  const orgId = explicitOrgId ?? (candidateContext ? Number(candidateContext.orgId) : null);

  if (digestCandidateId != null && !candidateContext && explicitOrgId == null) {
    throw new Error("Digest candidate not found for this client profile.");
  }

  if (digestCandidateId != null && candidateContext && explicitOrgId != null && String(explicitOrgId) !== String(candidateContext.orgId)) {
    throw new Error("orgId does not match the digest candidate's org.");
  }

  if (!orgId) {
    throw new Error("orgId or digestCandidateId is required.");
  }

  const result = await pool.query<DigestOrgStateRow>(`
    INSERT INTO client_digest_org_state (
      client_profile_id,
      org_id,
      last_digest_candidate_id,
      feedback_status,
      feedback_at,
      feedback_note,
      cooldown_until,
      suppressed_until,
      last_source_external_id,
      last_source_display_name
    )
    VALUES (
      $1,
      $2,
      $3,
      $4::digest_feedback_status,
      NOW(),
      $5,
      ${actionConfig.cooldownSql},
      ${actionConfig.suppressedSql},
      $6,
      $7
    )
    ON CONFLICT (client_profile_id, org_id) DO UPDATE
    SET
      last_digest_candidate_id = COALESCE(EXCLUDED.last_digest_candidate_id, client_digest_org_state.last_digest_candidate_id),
      feedback_status = EXCLUDED.feedback_status,
      feedback_at = EXCLUDED.feedback_at,
      feedback_note = EXCLUDED.feedback_note,
      cooldown_until = ${actionConfig.cooldownUpdateSql},
      suppressed_until = ${actionConfig.suppressedUpdateSql},
      last_source_external_id = COALESCE(EXCLUDED.last_source_external_id, client_digest_org_state.last_source_external_id),
      last_source_display_name = COALESCE(EXCLUDED.last_source_display_name, client_digest_org_state.last_source_display_name),
      updated_at = NOW()
    RETURNING
      client_profile_id::TEXT AS "clientProfileId",
      org_id::TEXT AS "orgId",
      feedback_status::TEXT AS "feedbackStatus",
      feedback_at::TEXT AS "feedbackAt",
      feedback_note AS "feedbackNote",
      cooldown_until::TEXT AS "cooldownUntil",
      suppressed_until::TEXT AS "suppressedUntil",
      last_digest_candidate_id::TEXT AS "lastDigestCandidateId",
      last_digest_run_id::TEXT AS "lastDigestRunId",
      updated_at::TEXT AS "updatedAt"
  `, [
    clientProfileId,
    orgId,
    digestCandidateId,
    actionConfig.feedbackStatus,
    note,
    candidateContext?.sourceExternalId ?? null,
    candidateContext?.sourceDisplayName ?? null,
    ...actionConfig.extraParams
  ]);

  return result.rows[0];
}

async function getDigestCandidateContext(input: {
  clientProfileId: number;
  digestCandidateId: number;
}, db: DigestFeedbackDbClient): Promise<DigestCandidateContextRow | null> {
  const result = await db.query<DigestCandidateContextRow>(`
    SELECT
      org_id::TEXT AS "orgId",
      source_external_id AS "sourceExternalId",
      source_display_name AS "sourceDisplayName"
    FROM digest_candidates
    WHERE id = $1
      AND client_profile_id = $2
  `, [input.digestCandidateId, input.clientProfileId]);

  return result.rowCount === 1 ? result.rows[0] : null;
}

function normalizePositiveInteger(value: string | number, message: string): number {
  const normalizedValue = typeof value === "number" ? value : Number(value);

  if (!Number.isInteger(normalizedValue) || normalizedValue <= 0) {
    throw new Error(message);
  }

  return normalizedValue;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();
  return normalizedValue === "" ? null : normalizedValue;
}
