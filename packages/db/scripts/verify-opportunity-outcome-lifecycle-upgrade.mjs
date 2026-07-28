import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import pg from 'pg'

const { Client } = pg
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required.')

const root = resolve(import.meta.dirname, '..', '..', '..')
const migrationsDir = resolve(root, 'packages', 'db', 'migrations')
const lifecycleFile =
  '20260728110000_complete_opportunity_meeting_lifecycle.sql'
const boundaryFile =
  '20260728111000_enforce_opportunity_outcome_write_boundary.sql'
const correctionFile =
  '20260728112000_enforce_outcome_correction_capability.sql'
const database = new Client({ connectionString: databaseUrl })

await database.connect()
try {
  await database.query(await readFile(
    resolve(migrationsDir, lifecycleFile),
    'utf8',
  ))
  await database.query(await readFile(
    resolve(migrationsDir, boundaryFile),
    'utf8',
  ))
  await database.query(await readFile(
    resolve(migrationsDir, correctionFile),
    'utf8',
  ))
  const result = await database.query(
    `SELECT
       COUNT(*)::INTEGER AS states,
       COUNT(*) FILTER (
         WHERE meeting_status = 'scheduled'
           AND meeting_attempt_count = 1
           AND active_meeting_event_id IS NOT NULL
           AND last_meeting_event_at IS NOT NULL
       )::INTEGER AS valid
     FROM opportunity_outcome_state
     WHERE commercial_stage = 'meeting'`,
  )
  if (
    Number(result.rows[0]?.states ?? 0) < 1 ||
    result.rows[0]?.states !== result.rows[0]?.valid
  ) {
    throw new Error('Lifecycle upgrade did not backfill legacy meetings.')
  }
  console.log(JSON.stringify({
    ok: true,
    meetingStates: result.rows[0].states,
    writeBoundary: true,
    correctionBoundary: true,
  }))
} finally {
  await database.end()
}
