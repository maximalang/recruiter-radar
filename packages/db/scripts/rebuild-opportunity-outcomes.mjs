import pg from 'pg'

const { Client } = pg

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required.')

const argumentsSet = new Set(process.argv.slice(2))
const apply = argumentsSet.has('--apply')
const ownerArgumentIndex = process.argv.indexOf('--owner-id')
const ownerId = ownerArgumentIndex >= 0
  ? process.argv[ownerArgumentIndex + 1]
  : null

if (ownerArgumentIndex >= 0 && (!ownerId || !/^[1-9]\d*$/.test(ownerId))) {
  throw new Error('--owner-id requires a positive integer.')
}

const allowedArguments = new Set(['--apply', '--dry-run', '--owner-id', ownerId])
const unknownArgument = process.argv.slice(2).find((argument) =>
  !allowedArguments.has(argument),
)
if (unknownArgument) throw new Error(`Unknown argument: ${unknownArgument}`)

const client = new Client({ connectionString: databaseUrl })
const scopeClause = ownerId ? 'WHERE owner_id = $1' : ''
const parameters = ownerId ? [ownerId] : []

const projectionSql = `
  CREATE TEMP TABLE rebuilt_opportunity_outcome_state
  ON COMMIT DROP
  AS
  WITH scoped_events AS (
    SELECT *
    FROM opportunity_outcome_events
    ${scopeClause}
  ), aggregated AS (
    SELECT
      owner_id,
      client_profile_id,
      opportunity_id,
      hiring_episode_id,
      organization_id,
      (ARRAY_AGG(new_stage ORDER BY id DESC))[1] AS current_stage,
      MAX(id) AS last_event_id,
      MAX(occurred_at) AS last_event_at,
      MIN(occurred_at) FILTER (WHERE event_type = 'shown') AS first_shown_at,
      MIN(occurred_at) FILTER (WHERE event_type = 'opened') AS first_opened_at,
      MIN(occurred_at) FILTER (WHERE event_type = 'accepted') AS accepted_at,
      MIN(occurred_at) FILTER (WHERE event_type = 'contacted') AS contacted_at,
      MIN(occurred_at) FILTER (WHERE event_type = 'replied') AS replied_at,
      MIN(occurred_at) FILTER (WHERE event_type = 'meeting') AS meeting_at,
      MIN(occurred_at) FILTER (WHERE event_type = 'proposal') AS proposal_at,
      MIN(occurred_at) FILTER (WHERE event_type = 'won') AS won_at,
      MIN(occurred_at) FILTER (WHERE event_type = 'lost') AS lost_at,
      (ARRAY_AGG(reason_code ORDER BY id DESC)
        FILTER (WHERE event_type = 'dismissed'))[1] AS dismiss_reason_code,
      (ARRAY_AGG(reason_code ORDER BY id DESC)
        FILTER (WHERE event_type = 'lost'))[1] AS lost_reason_code,
      (ARRAY_AGG(value_minor ORDER BY id DESC)
        FILTER (WHERE event_type = 'won'))[1] AS deal_value_minor,
      (ARRAY_AGG(currency ORDER BY id DESC)
        FILTER (WHERE event_type = 'won'))[1] AS currency
    FROM scoped_events
    GROUP BY
      owner_id,
      client_profile_id,
      opportunity_id,
      hiring_episode_id,
      organization_id
  )
  SELECT *, NOW() AS updated_at
  FROM aggregated
`

const comparableColumns = `
  owner_id,
  client_profile_id,
  opportunity_id,
  hiring_episode_id,
  organization_id,
  current_stage,
  last_event_id,
  last_event_at,
  first_shown_at,
  first_opened_at,
  accepted_at,
  contacted_at,
  replied_at,
  meeting_at,
  proposal_at,
  won_at,
  lost_at,
  dismiss_reason_code,
  lost_reason_code,
  deal_value_minor,
  currency
`

function log(event, fields = {}) {
  process.stdout.write(`${JSON.stringify({
    level: 'info',
    event,
    ...fields,
  })}\n`)
}

await client.connect()
log('opportunity_outcome.rebuild_started', {
  mode: apply ? 'apply' : 'dry_run',
  ownerScoped: Boolean(ownerId),
})

try {
  await client.query('BEGIN')
  await client.query(projectionSql, parameters)

  const comparison = await client.query(`
    WITH existing AS (
      SELECT ${comparableColumns}
      FROM opportunity_outcome_state
      ${scopeClause}
    ), rebuilt AS (
      SELECT ${comparableColumns}
      FROM rebuilt_opportunity_outcome_state
    )
    SELECT
      (SELECT COUNT(*) FROM rebuilt)::INTEGER AS scanned,
      (SELECT COUNT(*) FROM (
        (SELECT * FROM existing EXCEPT SELECT * FROM rebuilt)
        UNION ALL
        (SELECT * FROM rebuilt EXCEPT SELECT * FROM existing)
      ) differences)::INTEGER AS changed
  `, parameters)

  const rebuildScanned = comparison.rows[0]?.scanned ?? 0
  const rebuildChanged = comparison.rows[0]?.changed ?? 0

  if (apply) {
    if (ownerId) {
      await client.query(
        'DELETE FROM opportunity_outcome_state WHERE owner_id = $1',
        [ownerId],
      )
    } else {
      await client.query('DELETE FROM opportunity_outcome_state')
    }
    await client.query(`
      INSERT INTO opportunity_outcome_state (
        ${comparableColumns},
        updated_at
      )
      SELECT
        ${comparableColumns},
        updated_at
      FROM rebuilt_opportunity_outcome_state
      ORDER BY owner_id, opportunity_id
    `)
  }

  await client.query(apply ? 'COMMIT' : 'ROLLBACK')
  log('opportunity_outcome.rebuild_completed', {
    mode: apply ? 'apply' : 'dry_run',
    rebuildScanned,
    rebuildChanged,
    rebuildFailed: 0,
  })
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined)
  log('opportunity_outcome.rebuild_failed', {
    mode: apply ? 'apply' : 'dry_run',
    rebuildScanned: 0,
    rebuildChanged: 0,
    rebuildFailed: 1,
    errorName: error instanceof Error ? error.name : 'UnknownError',
  })
  throw error
} finally {
  await client.end()
}
