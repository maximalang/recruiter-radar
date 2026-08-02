import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import pg from 'pg'
import opportunityCanaryFlags from './lib/opportunity-canary-flags.cjs'

const { Client } = pg
const {
  isOpportunityCanaryActivationReady,
  resolveOpportunityCanaryFlags,
} = opportunityCanaryFlags
const execFileAsync = promisify(execFile)
const databaseUrl = process.env.DATABASE_URL?.trim()
if (!databaseUrl) throw new Error('DATABASE_URL is required.')

const args = process.argv.slice(2)
const ownerIndex = args.indexOf('--owner-id')
const ownerId = ownerIndex >= 0 ? args[ownerIndex + 1] : null
const workspaceIndex = args.indexOf('--workspace-id')
const workspaceId = workspaceIndex >= 0 ? args[workspaceIndex + 1] : null
const apply = args.includes('--apply')
const preActivation = args.includes('--pre-activation')
if (!ownerId || !/^[1-9]\d*$/.test(ownerId)) {
  throw new Error('--owner-id requires a positive integer.')
}
if (workspaceId !== null && !/^[1-9]\d*$/.test(workspaceId)) {
  throw new Error('--workspace-id requires a positive integer.')
}
const allowed = new Set([
  '--owner-id',
  ownerId,
  '--workspace-id',
  ...(workspaceId ? [workspaceId] : []),
  '--apply',
  '--dry-run',
  '--pre-activation',
])
const unknown = args.find((argument) => !allowed.has(argument))
if (unknown) throw new Error(`Unknown argument: ${unknown}`)
if (apply && args.includes('--dry-run')) {
  throw new Error('Cannot combine --apply with --dry-run.')
}
if (apply && preActivation) {
  throw new Error('Pre-activation validation must remain read-only.')
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const rebuildScript = path.join(
  root,
  'packages/db/scripts/rebuild-opportunity-outcomes.mjs',
)
const client = new Client({ connectionString: databaseUrl })
const scopeParams = [ownerId, workspaceId]

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
     FROM opportunities opportunity
     WHERE opportunity.owner_id = $1
       AND ($2::BIGINT IS NULL OR opportunity.workspace_id = $2)`,
    scopeParams,
  )
  const isolation = await client.query(
    `SELECT COUNT(*)::INTEGER AS count
     FROM opportunity_outcome_events event
     LEFT JOIN opportunities scoped_opportunity
       ON scoped_opportunity.owner_id = event.owner_id
      AND scoped_opportunity.id = event.opportunity_id
     LEFT JOIN opportunities opportunity
       ON opportunity.owner_id = event.owner_id
      AND opportunity.client_profile_id = event.client_profile_id
      AND opportunity.id = event.opportunity_id
      AND opportunity.hiring_episode_id = event.hiring_episode_id
      AND opportunity.organization_id = event.organization_id
     WHERE event.owner_id = $1
       AND (
         $2::BIGINT IS NULL
         OR scoped_opportunity.workspace_id = $2
         OR scoped_opportunity.id IS NULL
       )
       AND opportunity.id IS NULL`,
    scopeParams,
  )
  const privacy = await client.query(
    `SELECT COUNT(*)::INTEGER AS count
     FROM opportunity_outcome_events event
     JOIN opportunities opportunity
       ON opportunity.owner_id = event.owner_id
      AND opportunity.id = event.opportunity_id
     WHERE event.owner_id = $1
       AND ($2::BIGINT IS NULL OR opportunity.workspace_id = $2)
       AND (
         event.contact_reference IS NOT NULL
         OR (
           event.contact_reference_label IS NOT NULL
           AND NOT (
             event.contact_reference_label ~ '^.\\*{3}@[^@[:space:]]+$'
             OR event.contact_reference_label
               ~ '^\\+?[0-9] \\*{3} \\*{3}-[0-9]{2}-[0-9]{2}$'
             OR event.contact_reference_label
               ~ '^[[:alpha:]][[:alnum:]+.-]*://[^/[:space:]]+/…$'
             OR event.contact_reference_label ~ '^.\\*{3}$'
           )
         )
         OR event.metadata::TEXT
           ~* '[[:alnum:]._%+-]+@[[:alnum:].-]+\\.[[:alpha:]]{2,}'
         OR event.metadata::TEXT ~ '\\+[0-9][0-9 ()-]{6,}[0-9]'
       )`,
    scopeParams,
  )
  const duplicateKeys = await client.query(
    `SELECT COUNT(*)::INTEGER AS count
     FROM (
       SELECT event.idempotency_key
       FROM opportunity_outcome_events event
       JOIN opportunities opportunity
         ON opportunity.owner_id = event.owner_id
        AND opportunity.id = event.opportunity_id
       WHERE event.owner_id = $1
         AND ($2::BIGINT IS NULL OR opportunity.workspace_id = $2)
       GROUP BY event.idempotency_key
       HAVING COUNT(*) > 1
     ) duplicate`,
    scopeParams,
  )
  const chronology = await client.query(
    `WITH effective AS (
       SELECT event.*
       FROM opportunity_outcome_events event
       JOIN opportunities opportunity
         ON opportunity.owner_id = event.owner_id
        AND opportunity.id = event.opportunity_id
       WHERE event.owner_id = $1
         AND ($2::BIGINT IS NULL OR opportunity.workspace_id = $2)
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
    scopeParams,
  )
  const meeting = await client.query(
    `WITH effective AS (
       SELECT event.*
       FROM opportunity_outcome_events event
       JOIN opportunities opportunity
         ON opportunity.owner_id = event.owner_id
        AND opportunity.id = event.opportunity_id
       WHERE event.owner_id = $1
         AND ($2::BIGINT IS NULL OR opportunity.workspace_id = $2)
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
       JOIN opportunities opportunity
         ON opportunity.owner_id = state.owner_id
        AND opportunity.id = state.opportunity_id
       LEFT JOIN effective event
         ON event.opportunity_id = state.opportunity_id
       WHERE state.owner_id = $1
         AND ($2::BIGINT IS NULL OR opportunity.workspace_id = $2)
       GROUP BY state.opportunity_id
     )
     SELECT COUNT(*)::INTEGER AS count
     FROM expected
     JOIN opportunity_outcome_state state
       ON state.owner_id = $1
      AND state.opportunity_id = expected.opportunity_id
     WHERE state.meeting_status <> expected.meeting_status
        OR state.meeting_attempt_count <> expected.attempt_count`,
    scopeParams,
  )
  const cohort = await client.query(
    `WITH effective AS (
       SELECT event.*
       FROM opportunity_outcome_events event
       JOIN opportunities opportunity
         ON opportunity.owner_id = event.owner_id
        AND opportunity.id = event.opportunity_id
       WHERE event.owner_id = $1
         AND ($2::BIGINT IS NULL OR opportunity.workspace_id = $2)
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
    scopeParams,
  )
  const lockContention = await client.query(
    `SELECT COUNT(*)::INTEGER AS count
     FROM pg_locks
     WHERE locktype = 'advisory'
       AND NOT granted`,
  )

  const rebuildScope = ['--owner-id', ownerId]
  if (workspaceId) rebuildScope.push('--workspace-id', workspaceId)
  if (apply) await runRebuild([...rebuildScope, '--apply'])
  const rebuild = await runRebuild([...rebuildScope, '--dry-run'])
  const projectionDrift = Number(rebuild.rebuildChanged ?? 0)
  const externalIngestEnabled =
    process.env.OPPORTUNITY_OUTCOMES_EXTERNAL_INGEST_ENABLED === 'true'
  const flags = resolveOpportunityCanaryFlags(
    ownerId,
    process.env,
    workspaceId,
  )
  const activationReady = isOpportunityCanaryActivationReady(
    ownerId,
    preActivation ? 'pre_activation' : 'active',
    process.env,
    workspaceId,
  )
  const result = {
    ownerId,
    workspaceId,
    mode: apply ? 'apply' : 'dry_run',
    phase: preActivation ? 'pre_activation' : 'active',
    flags,
    activationReady,
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
    result.activationReady &&
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
