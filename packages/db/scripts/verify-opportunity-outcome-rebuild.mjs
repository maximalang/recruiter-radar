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
try {
  const fixture = await client.query(
    `SELECT owner_id::TEXT AS "ownerId", opportunity_id::TEXT AS "opportunityId"
     FROM opportunity_outcome_state
     WHERE first_shown_at IS NOT NULL
     ORDER BY owner_id, opportunity_id
     LIMIT 1`,
  )
  assert.ok(fixture.rows[0], 'runtime test must leave a shown projection fixture')
  const { ownerId, opportunityId } = fixture.rows[0]

  await client.query(
    `UPDATE opportunity_outcome_state
     SET first_shown_at = NULL
     WHERE owner_id = $1 AND opportunity_id = $2`,
    [ownerId, opportunityId],
  )

  const dryRun = await rebuild(['--dry-run', '--owner-id', ownerId])
  assert.ok(dryRun.rebuildScanned >= 1)
  assert.ok(dryRun.rebuildChanged >= 1)
  const stillCorrupt = await client.query(
    `SELECT first_shown_at IS NULL AS corrupt
     FROM opportunity_outcome_state
     WHERE owner_id = $1 AND opportunity_id = $2`,
    [ownerId, opportunityId],
  )
  assert.equal(stillCorrupt.rows[0].corrupt, true)

  const applied = await rebuild(['--apply', '--owner-id', ownerId])
  assert.ok(applied.rebuildChanged >= 1)
  const repaired = await client.query(
    `SELECT first_shown_at IS NOT NULL AS repaired
     FROM opportunity_outcome_state
     WHERE owner_id = $1 AND opportunity_id = $2`,
    [ownerId, opportunityId],
  )
  assert.equal(repaired.rows[0].repaired, true)

  const stable = await rebuild(['--dry-run', '--owner-id', ownerId])
  assert.equal(stable.rebuildChanged, 0)
  console.log(JSON.stringify({
    ok: true,
    checks: [
      'dry_run_detects_without_mutation',
      'apply_repairs_projection',
      'rebuild_is_idempotent',
      'owner_scope_preserved',
    ],
  }, null, 2))
} finally {
  await client.end()
}
