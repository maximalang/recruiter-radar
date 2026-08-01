import pg from 'pg'

import { evaluateOpportunityScoringRows } from './lib/opportunity-scoring-evaluation.mjs'

const { Pool } = pg
const args = process.argv.slice(2)
const workspaceId = requireWorkspaceId(args)
const requireSufficientData = args.includes('--require-sufficient-data')
const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error('DATABASE_URL is required')
}

const pool = new Pool({ connectionString })
const client = await pool.connect()

try {
  await client.query('BEGIN TRANSACTION READ ONLY')
  const result = await client.query(`
    WITH latest_v2 AS (
      SELECT DISTINCT ON (
        snapshot.owner_id,
        snapshot.client_profile_id,
        snapshot.hiring_episode_id
      )
        snapshot.owner_id,
        snapshot.client_profile_id,
        snapshot.hiring_episode_id,
        snapshot.baseline_ranking_score AS "v1Score",
        snapshot.ranking_score AS "v2Score",
        snapshot.action_queue_eligible AS "actionQueueEligible",
        snapshot.hard_gate_results AS "hardGates",
        snapshot.confidence_gate AS "confidenceGate",
        COALESCE(opportunity.metadata->'sourceFamilies', '[]'::JSONB)
          AS "sourceFamilies",
        episode.episode_type AS "episodeType"
      FROM opportunity_scoring_snapshots snapshot
      JOIN opportunities opportunity
        ON opportunity.id = snapshot.opportunity_id
       AND opportunity.workspace_id = snapshot.workspace_id
      JOIN hiring_episodes episode
        ON episode.id = snapshot.hiring_episode_id
      WHERE snapshot.workspace_id = $1
        AND snapshot.scoring_version = 'opportunity-v2'
      ORDER BY
        snapshot.owner_id,
        snapshot.client_profile_id,
        snapshot.hiring_episode_id,
        snapshot.created_at DESC,
        snapshot.id DESC
    ), outcome_by_episode AS (
      SELECT
        outcome.owner_id,
        outcome.client_profile_id,
        outcome.hiring_episode_id,
        BOOL_OR(outcome.accepted_at IS NOT NULL) AS accepted,
        BOOL_OR(outcome.contacted_at IS NOT NULL) AS contacted,
        BOOL_OR(outcome.replied_at IS NOT NULL) AS replied,
        BOOL_OR(outcome.meeting_at IS NOT NULL) AS meeting,
        MAX(outcome.dismiss_reason_code) AS "dismissReasonCode",
        MAX(outcome.lost_reason_code) AS "lostReasonCode"
      FROM opportunity_outcome_state outcome
      JOIN opportunities opportunity
        ON opportunity.id = outcome.opportunity_id
       AND opportunity.owner_id = outcome.owner_id
      WHERE opportunity.workspace_id = $1
      GROUP BY
        outcome.owner_id,
        outcome.client_profile_id,
        outcome.hiring_episode_id
    )
    SELECT
      latest_v2."v1Score",
      latest_v2."v2Score",
      latest_v2."actionQueueEligible",
      latest_v2."hardGates",
      latest_v2."confidenceGate",
      latest_v2."sourceFamilies",
      latest_v2."episodeType",
      COALESCE(outcome.accepted, FALSE) AS accepted,
      COALESCE(outcome.contacted, FALSE) AS contacted,
      COALESCE(outcome.replied, FALSE) AS replied,
      COALESCE(outcome.meeting, FALSE) AS meeting,
      outcome."dismissReasonCode",
      outcome."lostReasonCode"
    FROM latest_v2
    LEFT JOIN outcome_by_episode outcome
      ON outcome.owner_id = latest_v2.owner_id
     AND outcome.client_profile_id = latest_v2.client_profile_id
     AND outcome.hiring_episode_id = latest_v2.hiring_episode_id
  `, [workspaceId])
  await client.query('COMMIT')

  const report = evaluateOpportunityScoringRows(result.rows)
  process.stdout.write(`${JSON.stringify({
    ...report,
    scope: { workspaceId },
  }, null, 2)}\n`)

  if (requireSufficientData && report.dataStatus !== 'sufficient_data') {
    process.exitCode = 2
  }
} catch (error) {
  await client.query('ROLLBACK').catch(() => {})
  throw error
} finally {
  client.release()
  await pool.end()
}

function requireWorkspaceId(inputArgs) {
  const flagIndex = inputArgs.indexOf('--workspace-id')
  const value = flagIndex >= 0 ? inputArgs[flagIndex + 1] : undefined
  if (!value || !/^\d+$/.test(value)) {
    throw new Error('--workspace-id must be a positive integer')
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error('--workspace-id must be a positive safe integer')
  }
  return parsed
}
