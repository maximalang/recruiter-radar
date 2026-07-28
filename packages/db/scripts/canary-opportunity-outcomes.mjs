import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import pg from 'pg'

const { Client } = pg
const execFileAsync = promisify(execFile)
const databaseUrl = process.env.DATABASE_URL?.trim()
if (!databaseUrl) throw new Error('DATABASE_URL is required.')

const args = process.argv.slice(2)
const ownerIndex = args.indexOf('--owner-id')
const ownerId = ownerIndex >= 0 ? args[ownerIndex + 1] : null
const apply = args.includes('--apply')
if (!ownerId || !/^[1-9]\d*$/.test(ownerId)) {
  throw new Error('--owner-id requires a positive integer.')
}
const allowed = new Set(['--owner-id', ownerId, '--apply', '--dry-run'])
const unknown = args.find((argument) => !allowed.has(argument))
if (unknown) throw new Error(`Unknown argument: ${unknown}`)
if (apply && args.includes('--dry-run')) {
  throw new Error('Cannot combine --apply with --dry-run.')
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const rebuildScript = path.join(
  root,
  'packages/db/scripts/rebuild-opportunity-outcomes.mjs',
)
const client = new Client({ connectionString: databaseUrl })

await client.connect()
try {
  const schema = await client.query(
    `SELECT
       (
         SELECT COUNT(*) = 3
         FROM schema_migrations
         WHERE version = ANY(ARRAY[
           '20260728110000_complete_opportunity_meeting_lifecycle',
           '20260728111000_enforce_opportunity_outcome_write_boundary',
           '20260728112000_enforce_outcome_correction_capability'
         ])
       ) AS migration_ledger,
       EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'opportunity_outcome_state'
           AND column_name = 'meeting_status'
       ) AS meeting_projection,
       EXISTS (
         SELECT 1
         FROM pg_trigger trigger
         JOIN pg_class relation ON relation.oid = trigger.tgrelid
         JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
         WHERE namespace.nspname = 'public'
           AND relation.relname = 'opportunity_outcome_events'
           AND trigger.tgname =
             'opportunity_outcome_events_require_projection'
           AND trigger.tgenabled <> 'D'
           AND NOT trigger.tgisinternal
       ) AS write_boundary,
       EXISTS (
         SELECT 1
         FROM pg_trigger trigger
         JOIN pg_class relation ON relation.oid = trigger.tgrelid
         JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
         WHERE namespace.nspname = 'public'
           AND relation.relname = 'opportunity_outcome_events'
           AND trigger.tgname =
             'opportunity_outcome_events_correction_capability'
           AND trigger.tgenabled <> 'D'
           AND NOT trigger.tgisinternal
       ) AS correction_boundary`,
  )
  const ownerScope = await client.query(
    `SELECT COUNT(*)::INTEGER AS count
     FROM opportunities
     WHERE owner_id = $1`,
    [ownerId],
  )
  const isolation = await client.query(
    `SELECT COUNT(*)::INTEGER AS count
     FROM opportunity_outcome_events event
     LEFT JOIN opportunities opportunity
       ON opportunity.owner_id = event.owner_id
      AND opportunity.client_profile_id = event.client_profile_id
      AND opportunity.id = event.opportunity_id
      AND opportunity.hiring_episode_id = event.hiring_episode_id
      AND opportunity.organization_id = event.organization_id
     WHERE event.owner_id = $1
       AND opportunity.id IS NULL`,
    [ownerId],
  )
  const privacy = await client.query(
    `SELECT COUNT(*)::INTEGER AS count
     FROM opportunity_outcome_events
     WHERE owner_id = $1
       AND (
         contact_reference IS NOT NULL
         OR (
           contact_reference_label IS NOT NULL
           AND NOT (
             contact_reference_label ~ '^.\\*{3}@[^@[:space:]]+$'
             OR contact_reference_label
               ~ '^\\+?[0-9] \\*{3} \\*{3}-[0-9]{2}-[0-9]{2}$'
             OR contact_reference_label
               ~ '^[[:alpha:]][[:alnum:]+.-]*://[^/[:space:]]+/…$'
             OR contact_reference_label ~ '^.\\*{3}$'
           )
         )
         OR metadata::TEXT
           ~* '[[:alnum:]._%+-]+@[[:alnum:].-]+\\.[[:alpha:]]{2,}'
         OR metadata::TEXT ~ '\\+[0-9][0-9 ()-]{6,}[0-9]'
       )`,
    [ownerId],
  )
  const duplicateKeys = await client.query(
    `SELECT COUNT(*)::INTEGER AS count
     FROM (
       SELECT idempotency_key
       FROM opportunity_outcome_events
       WHERE owner_id = $1
       GROUP BY idempotency_key
       HAVING COUNT(*) > 1
     ) duplicate`,
    [ownerId],
  )
  const chronology = await client.query(
    `WITH effective AS (
       SELECT event.*
       FROM opportunity_outcome_events event
       WHERE event.owner_id = $1
         AND event.event_type <> 'reverted'
         AND NOT EXISTS (
           SELECT 1
           FROM opportunity_outcome_events correction
           WHERE correction.owner_id = event.owner_id
             AND correction.opportunity_id = event.opportunity_id
             AND correction.event_type = 'reverted'
             AND correction.reverts_event_id = event.id
         )
     ), ordered AS (
       SELECT
         event_type,
         occurred_at,
         LAG(occurred_at) OVER (
           PARTITION BY opportunity_id,
             CASE WHEN event_type IN (
               'meeting', 'meeting_completed', 'meeting_cancelled',
               'meeting_no_show'
             ) THEN 'meeting' ELSE 'commercial' END
           ORDER BY id
         ) AS previous_at
       FROM effective
       WHERE event_type IN (
         'accepted', 'dismissed', 'contacted', 'replied', 'meeting',
         'meeting_completed', 'meeting_cancelled', 'meeting_no_show',
         'proposal', 'won', 'lost'
       )
     )
     SELECT COUNT(*)::INTEGER AS count
     FROM ordered
     WHERE occurred_at < previous_at`,
    [ownerId],
  )
  const meeting = await client.query(
    `WITH effective AS (
       SELECT event.*
       FROM opportunity_outcome_events event
       WHERE event.owner_id = $1
         AND event.event_type <> 'reverted'
         AND NOT EXISTS (
           SELECT 1
           FROM opportunity_outcome_events correction
           WHERE correction.owner_id = event.owner_id
             AND correction.opportunity_id = event.opportunity_id
             AND correction.event_type = 'reverted'
             AND correction.reverts_event_id = event.id
         )
     ), expected AS (
       SELECT
         state.opportunity_id,
         COALESCE(
           (ARRAY_AGG(
             CASE event.event_type
               WHEN 'meeting' THEN 'scheduled'
               WHEN 'meeting_completed' THEN 'completed'
               WHEN 'meeting_cancelled' THEN 'cancelled'
               WHEN 'meeting_no_show' THEN 'no_show'
             END
             ORDER BY event.id DESC
           ) FILTER (WHERE event.event_type IN (
             'meeting', 'meeting_completed', 'meeting_cancelled',
             'meeting_no_show'
           )))[1],
           'none'
         ) AS meeting_status,
         COUNT(event.id) FILTER (
           WHERE event.event_type = 'meeting'
         )::INTEGER AS attempt_count
       FROM opportunity_outcome_state state
       LEFT JOIN effective event
         ON event.opportunity_id = state.opportunity_id
       WHERE state.owner_id = $1
       GROUP BY state.opportunity_id
     )
     SELECT COUNT(*)::INTEGER AS count
     FROM expected
     JOIN opportunity_outcome_state state
       ON state.owner_id = $1
      AND state.opportunity_id = expected.opportunity_id
     WHERE state.meeting_status <> expected.meeting_status
        OR state.meeting_attempt_count <> expected.attempt_count`,
    [ownerId],
  )
  const cohort = await client.query(
    `WITH effective AS (
       SELECT event.*
       FROM opportunity_outcome_events event
       WHERE event.owner_id = $1
         AND event.event_type = 'shown'
         AND NOT EXISTS (
           SELECT 1
           FROM opportunity_outcome_events correction
           WHERE correction.owner_id = event.owner_id
             AND correction.opportunity_id = event.opportunity_id
             AND correction.event_type = 'reverted'
             AND correction.reverts_event_id = event.id
         )
     ), expected AS (
       SELECT
         opportunity_id,
         (ARRAY_AGG(occurred_at ORDER BY occurred_at, id))[1]
           AS first_shown_at
       FROM effective
       GROUP BY opportunity_id
     )
     SELECT COUNT(*)::INTEGER AS count
     FROM expected
     LEFT JOIN opportunity_outcome_state state
       ON state.owner_id = $1
      AND state.opportunity_id = expected.opportunity_id
     WHERE state.first_shown_at IS DISTINCT FROM expected.first_shown_at`,
    [ownerId],
  )
  const lockContention = await client.query(
    `SELECT COUNT(*)::INTEGER AS count
     FROM pg_locks
     WHERE locktype = 'advisory'
       AND NOT granted`,
  )

  if (apply) await runRebuild(['--owner-id', ownerId, '--apply'])
  const rebuild = await runRebuild(['--owner-id', ownerId, '--dry-run'])
  const projectionDrift = Number(rebuild.rebuildChanged ?? 0)
  const externalIngestEnabled =
    process.env.OPPORTUNITY_OUTCOMES_EXTERNAL_INGEST_ENABLED === 'true'
  const flags = {
    engine: process.env.OPPORTUNITY_ENGINE_V1_ENABLED === 'true',
    outcomes: process.env.OPPORTUNITY_OUTCOMES_ENABLED === 'true',
    ui: process.env.OPPORTUNITY_OUTCOMES_UI_ENABLED === 'true',
  }
  const result = {
    ownerId,
    mode: apply ? 'apply' : 'dry_run',
    flags,
    ownerOpportunityCount: Number(ownerScope.rows[0]?.count ?? 0),
    migrationsReady: Boolean(
      schema.rows[0]?.migration_ledger &&
      schema.rows[0]?.meeting_projection &&
      schema.rows[0]?.write_boundary &&
      schema.rows[0]?.correction_boundary,
    ),
    tenantIsolationViolations: Number(isolation.rows[0]?.count ?? 0),
    projectionDrift,
    cohortProjectionMismatches: Number(cohort.rows[0]?.count ?? 0),
    duplicateReplayKeys: Number(duplicateKeys.rows[0]?.count ?? 0),
    chronologyConflicts: Number(chronology.rows[0]?.count ?? 0),
    rawContactRows: Number(privacy.rows[0]?.count ?? 0),
    invalidMeetingLifecycles: Number(meeting.rows[0]?.count ?? 0),
    externalIngestEnabled,
    lockContention: Number(lockContention.rows[0]?.count ?? 0),
  }
  const ready = (
    result.migrationsReady &&
    result.ownerOpportunityCount > 0 &&
    result.flags.engine &&
    result.flags.outcomes &&
    result.flags.ui &&
    result.tenantIsolationViolations === 0 &&
    result.projectionDrift === 0 &&
    result.cohortProjectionMismatches === 0 &&
    result.duplicateReplayKeys === 0 &&
    result.chronologyConflicts === 0 &&
    result.rawContactRows === 0 &&
    result.invalidMeetingLifecycles === 0 &&
    result.externalIngestEnabled === false
  )
  process.stdout.write(`${JSON.stringify({ ...result, ready })}\n`)
  if (!ready) process.exitCode = 2
} finally {
  await client.end()
}

async function runRebuild(rebuildArgs) {
  const output = await execFileAsync(process.execPath, [
    rebuildScript,
    ...rebuildArgs,
  ], {
    cwd: root,
    env: process.env,
  })
  const completed = output.stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .find((entry) =>
      entry.event === 'opportunity_outcome.rebuild_completed')
  if (!completed) throw new Error('Outcome rebuild did not complete.')
  return completed
}
