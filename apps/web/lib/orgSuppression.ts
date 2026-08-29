import type { Pool, PoolClient } from 'pg'

type SuppressionDbClient = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>

export type SuppressionScopeSnapshot = {
  suppressionKey: string
  suppressedOrgIds: string[]
}

export type ClientOrgSuppressionRecord = {
  clientProfileId: string | number
  orgId: string | number
  suppressionKey: string
  suppressedOrgIds: Array<string | number>
  suppressionDays: number
  sourceDigestCandidateId: string | number | null
  sourceFeedbackAt: string
}

export type ClientOrgSuppressionRow = {
  clientProfileId: string
  orgId: string
  suppressionKey: string
  suppressedOrgIds: string[]
  sourceDigestCandidateId: string | null
  sourceFeedbackAt: string
  suppressedUntil: string
  createdAt: string
}

export async function getSuppressionScopeSnapshot(
  db: SuppressionDbClient,
  orgId: string | number,
): Promise<SuppressionScopeSnapshot | null> {
  const result = await db.query<SuppressionScopeSnapshot>(`
    WITH target_key AS (
      SELECT corroboration_key
      FROM org_corroboration_keys_v1
      WHERE org_id = $1::BIGINT
    )
    SELECT
      target_key.corroboration_key AS "suppressionKey",
      ARRAY_AGG(corb.org_id::TEXT ORDER BY corb.org_id) AS "suppressedOrgIds"
    FROM target_key
    JOIN org_corroboration_keys_v1 AS corb
      ON corb.corroboration_key = target_key.corroboration_key
    GROUP BY target_key.corroboration_key
  `, [orgId])

  return result.rows[0] ?? null
}

export async function recordClientOrgSuppression(
  db: SuppressionDbClient,
  input: ClientOrgSuppressionRecord,
): Promise<ClientOrgSuppressionRow> {
  const result = await db.query<ClientOrgSuppressionRow>(`
    INSERT INTO client_org_suppressions (
      client_profile_id,
      org_id,
      suppression_key,
      suppressed_org_ids,
      reason,
      source_digest_candidate_id,
      source_feedback_at,
      suppressed_until
    )
    VALUES (
      $1::BIGINT,
      $2::BIGINT,
      $3,
      $4::BIGINT[],
      'dismissed',
      $5::BIGINT,
      $6::TIMESTAMPTZ,
      NOW() + ($7::INTEGER * INTERVAL '1 day')
    )
    ON CONFLICT (client_profile_id, suppression_key) DO UPDATE
    SET
      org_id = EXCLUDED.org_id,
      suppressed_org_ids = EXCLUDED.suppressed_org_ids,
      reason = EXCLUDED.reason,
      source_digest_candidate_id = EXCLUDED.source_digest_candidate_id,
      source_feedback_at = EXCLUDED.source_feedback_at,
      suppressed_until = GREATEST(
        client_org_suppressions.suppressed_until,
        EXCLUDED.suppressed_until
      )
    RETURNING
      client_profile_id::TEXT AS "clientProfileId",
      org_id::TEXT AS "orgId",
      suppression_key AS "suppressionKey",
      ARRAY(SELECT item::TEXT FROM unnest(suppressed_org_ids) AS item) AS "suppressedOrgIds",
      source_digest_candidate_id::TEXT AS "sourceDigestCandidateId",
      source_feedback_at::TEXT AS "sourceFeedbackAt",
      suppressed_until::TEXT AS "suppressedUntil",
      created_at::TEXT AS "createdAt"
  `, [
    input.clientProfileId,
    input.orgId,
    input.suppressionKey,
    input.suppressedOrgIds,
    input.sourceDigestCandidateId,
    input.sourceFeedbackAt,
    input.suppressionDays,
  ])

  const row = result.rows[0]
  if (!row) {
    throw new Error('Failed to persist organization suppression.')
  }
  return row
}

/** SQL predicate injected into both digest candidate queries before LIMIT. */
export const DIGEST_SUPPRESSION_EXCLUSION_SQL = `
  NOT EXISTS (
    SELECT 1
    FROM client_org_suppressions AS suppression
    WHERE suppression.client_profile_id = $1::BIGINT
      AND suppression.suppressed_until > NOW()
      AND suppression.suppression_key = ranked_candidates.corroboration_key
  )
`
