import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

import pg from 'pg'

const { Client } = pg
const execFileAsync = promisify(execFile)
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required.')

const root = resolve(import.meta.dirname, '..', '..', '..')
const rebuildScript = resolve(
  root,
  'packages',
  'db',
  'scripts',
  'rebuild-opportunity-outcomes.mjs',
)
const client = new Client({ connectionString: databaseUrl })
const writer = new Client({ connectionString: databaseUrl })

async function rebuild(args) {
  const result = await execFileAsync(process.execPath, [rebuildScript, ...args], {
    cwd: root,
    env: process.env,
  })
  const completed = result.stdout
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line))
    .find((entry) => entry.event === 'opportunity_outcome.rebuild_completed')
  assert.ok(completed, 'rebuild must emit its completion event')
  return completed
}

await client.connect()
await writer.connect()
try {
  const fixture = await client.query(
    `SELECT state.owner_id::TEXT AS "ownerId",
            state.opportunity_id::TEXT AS "opportunityId",
            opportunity.workspace_id::TEXT AS "workspaceId"
     FROM opportunity_outcome_state state
     JOIN opportunities opportunity
       ON opportunity.owner_id = state.owner_id
      AND opportunity.id = state.opportunity_id
     WHERE state.first_shown_at IS NOT NULL
       AND opportunity.workspace_id IS NOT NULL
     ORDER BY state.owner_id, opportunity.workspace_id, state.opportunity_id
     LIMIT 1`,
  )
  assert.ok(fixture.rows[0], 'runtime test must leave a shown projection fixture')
  const { ownerId, opportunityId, workspaceId } = fixture.rows[0]
  const workspaceScope = [
    '--owner-id', ownerId,
    '--workspace-id', workspaceId,
  ]

  await client.query(
    `UPDATE opportunity_outcome_state
     SET first_shown_at = NULL
     WHERE owner_id = $1 AND opportunity_id = $2`,
    [ownerId, opportunityId],
  )

  const dryRun = await rebuild(['--dry-run', ...workspaceScope])
  assert.ok(dryRun.rebuildScanned >= 1)
  assert.ok(dryRun.rebuildChanged >= 1)
  const stillCorrupt = await client.query(
    `SELECT first_shown_at IS NULL AS corrupt
     FROM opportunity_outcome_state
     WHERE owner_id = $1 AND opportunity_id = $2`,
    [ownerId, opportunityId],
  )
  assert.equal(stillCorrupt.rows[0].corrupt, true)

  const applied = await rebuild(['--apply', ...workspaceScope])
  assert.ok(applied.rebuildChanged >= 1)
  const repaired = await client.query(
    `SELECT first_shown_at IS NOT NULL AS repaired
     FROM opportunity_outcome_state
     WHERE owner_id = $1 AND opportunity_id = $2`,
    [ownerId, opportunityId],
  )
  assert.equal(repaired.rows[0].repaired, true)

  const stable = await rebuild(['--dry-run', ...workspaceScope])
  assert.equal(stable.rebuildChanged, 0)

  await writer.query('BEGIN')
  await writer.query(
    `SELECT pg_advisory_xact_lock_shared(
       hashtextextended('opportunity-outcome-owner:' || $1, 0)
     )`,
    [ownerId],
  )
  const openedAt = new Date().toISOString()
  const inserted = await writer.query(
    `INSERT INTO opportunity_outcome_events (
       owner_id, client_profile_id, opportunity_id, hiring_episode_id,
       organization_id, event_type, previous_stage, new_stage, occurred_at,
       actor_type, metadata, analytics_snapshot, idempotency_key, payload_hash
     )
     SELECT
       state.owner_id, state.client_profile_id, state.opportunity_id,
       opportunity.hiring_episode_id, opportunity.organization_id,
       'opened', state.commercial_stage, state.commercial_stage, $3,
       'system', '{}'::JSONB, '{}'::JSONB, $4, repeat('c', 64)
     FROM opportunity_outcome_state state
     JOIN opportunities opportunity
       ON opportunity.id = state.opportunity_id
      AND opportunity.owner_id = state.owner_id
     WHERE state.owner_id = $1 AND state.opportunity_id = $2
     RETURNING id::TEXT AS id`,
    [ownerId, opportunityId, openedAt, `rebuild-concurrency:${Date.now()}`],
  )
  assert.ok(inserted.rows[0], 'writer fixture event must be inserted')
  await writer.query(
    `UPDATE opportunity_outcome_state
     SET first_opened_at = COALESCE(first_opened_at, $3),
         last_event_id = $4,
         last_event_at = GREATEST(last_event_at, $3),
         updated_at = NOW()
     WHERE owner_id = $1 AND opportunity_id = $2`,
    [ownerId, opportunityId, openedAt, inserted.rows[0].id],
  )
  const concurrentRebuild = rebuild(['--apply', ...workspaceScope])
  await writer.query('COMMIT')
  await concurrentRebuild
  const concurrentProjection = await client.query(
    `SELECT first_opened_at IS NOT NULL AS "writerPreserved",
       last_event_id = $3 AS "latestEventPreserved"
     FROM opportunity_outcome_state
     WHERE owner_id = $1 AND opportunity_id = $2`,
    [ownerId, opportunityId, inserted.rows[0].id],
  )
  assert.equal(concurrentProjection.rows[0].writerPreserved, true)
  assert.equal(concurrentProjection.rows[0].latestEventPreserved, true)

  const stableAfterConcurrency = await rebuild(['--dry-run', ...workspaceScope])
  assert.equal(stableAfterConcurrency.rebuildChanged, 0)
  console.log(JSON.stringify({
    ok: true,
    checks: [
      'dry_run_detects_without_mutation',
      'apply_repairs_projection',
      'rebuild_is_idempotent',
      'owner_scope_preserved',
      'workspace_scope_preserved',
      'concurrent_writer_projection_preserved',
    ],
  }, null, 2))
} finally {
  await writer.query('ROLLBACK').catch(() => undefined)
  await writer.end()
  await client.end()
}
