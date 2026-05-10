import { Pool, type PoolClient } from "pg";

import type { HhDigestItem } from "./hhDigest";

type ClientProfileSignalOutcomesDbClient = Pick<Pool, "query"> | Pick<PoolClient, "query">;

type DigestCandidateStateRow = {
  orgId: string;
  digestCandidateId: string;
  digestRunId: string;
  sourceExternalId: string | null;
  sourceDisplayName: string | null;
};

const globalForPg = globalThis as typeof globalThis & {
  recruiterRadarClientProfileSignalOutcomesPool?: Pool;
};

function getPool(): Pool | null {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    return null;
  }

  if (!globalForPg.recruiterRadarClientProfileSignalOutcomesPool) {
    globalForPg.recruiterRadarClientProfileSignalOutcomesPool = new Pool({
      connectionString
    });
  }

  return globalForPg.recruiterRadarClientProfileSignalOutcomesPool;
}

export async function recordClientProfileDigestShownOutcomes(input: {
  clientProfileId: string;
  deliveryKind: string;
  items: readonly HhDigestItem[];
  pipelineRunId?: string | null;
  messageId?: number | null;
  feedbackSource?: string | null;
}, db?: ClientProfileSignalOutcomesDbClient): Promise<void> {
  const pool = db ?? getPool();

  if (!pool) {
    throw new Error("DATABASE_URL is not set.");
  }

  const clientProfileId = normalizePositiveInteger(input.clientProfileId, "Invalid client profile id.");
  const orgIds = Array.from(
    new Set(
      input.items
        .map((item) => normalizePositiveIntegerOrNull(item.orgId))
        .filter((value): value is number => value !== null)
    )
  );

  if (orgIds.length === 0) {
    return;
  }

  const runId = normalizePositiveIntegerOrNull(input.pipelineRunId);
  const candidateRows = await getLatestDigestCandidateStateRows({
    clientProfileId,
    orgIds,
    runId
  }, pool);

  for (const candidateRow of candidateRows) {
    await pool.query(`
      INSERT INTO client_digest_org_state (
        client_profile_id,
        org_id,
        last_digest_run_id,
        last_digest_candidate_id,
        last_digest_at,
        feedback_status,
        last_source_external_id,
        last_source_display_name
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        NOW(),
        'none',
        $5,
        $6
      )
      ON CONFLICT (client_profile_id, org_id) DO UPDATE
      SET
        last_digest_run_id = COALESCE(EXCLUDED.last_digest_run_id, client_digest_org_state.last_digest_run_id),
        last_digest_candidate_id = COALESCE(EXCLUDED.last_digest_candidate_id, client_digest_org_state.last_digest_candidate_id),
        last_digest_at = NOW(),
        last_source_external_id = COALESCE(EXCLUDED.last_source_external_id, client_digest_org_state.last_source_external_id),
        last_source_display_name = COALESCE(EXCLUDED.last_source_display_name, client_digest_org_state.last_source_display_name),
        updated_at = NOW()
    `, [
      clientProfileId,
      Number(candidateRow.orgId),
      Number(candidateRow.digestRunId),
      Number(candidateRow.digestCandidateId),
      candidateRow.sourceExternalId,
      candidateRow.sourceDisplayName
    ]);
  }

  void input.deliveryKind;
  void input.messageId;
  void input.feedbackSource;
}

async function getLatestDigestCandidateStateRows(input: {
  clientProfileId: number;
  orgIds: readonly number[];
  runId: number | null;
}, db: ClientProfileSignalOutcomesDbClient): Promise<DigestCandidateStateRow[]> {
  const params: Array<number | readonly number[]> = [input.clientProfileId, input.orgIds];
  const runFilterSql = input.runId == null ? "" : "AND digest_run_id = $3";

  if (input.runId != null) {
    params.push(input.runId);
  }

  const result = await db.query<DigestCandidateStateRow>(`
    SELECT DISTINCT ON (org_id)
      org_id::TEXT AS "orgId",
      id::TEXT AS "digestCandidateId",
      digest_run_id::TEXT AS "digestRunId",
      source_external_id AS "sourceExternalId",
      source_display_name AS "sourceDisplayName"
    FROM digest_candidates
    WHERE client_profile_id = $1
      AND org_id = ANY($2::bigint[])
      ${runFilterSql}
    ORDER BY org_id ASC, created_at DESC, id DESC
  `, params);

  return result.rows;
}

function normalizePositiveInteger(value: string | number, message: string): number {
  const normalizedValue = typeof value === "number" ? value : Number(value);

  if (!Number.isInteger(normalizedValue) || normalizedValue <= 0) {
    throw new Error(message);
  }

  return normalizedValue;
}

function normalizePositiveIntegerOrNull(value: string | number | null | undefined): number | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const normalizedValue = typeof value === "number" ? value : Number(value);
  return Number.isInteger(normalizedValue) && normalizedValue > 0 ? normalizedValue : null;
}
