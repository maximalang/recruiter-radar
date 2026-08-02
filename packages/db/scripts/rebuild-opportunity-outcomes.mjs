import pg from 'pg'

const { Client } = pg

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required.')

const argumentsSet = new Set(process.argv.slice(2))
const apply = argumentsSet.has('--apply')
if (apply && argumentsSet.has('--dry-run')) {
  throw new Error('Cannot combine --apply with --dry-run.')
}
const ownerArgumentIndex = process.argv.indexOf('--owner-id')
const requestedOwnerId = ownerArgumentIndex >= 0
  ? process.argv[ownerArgumentIndex + 1]
  : null
const workspaceArgumentIndex = process.argv.indexOf('--workspace-id')
const requestedWorkspaceId = workspaceArgumentIndex >= 0
  ? process.argv[workspaceArgumentIndex + 1]
  : null

if (
  ownerArgumentIndex >= 0 &&
  (!requestedOwnerId || !/^[1-9]\d*$/.test(requestedOwnerId))
) {
  throw new Error('--owner-id requires a positive integer.')
}
if (
  workspaceArgumentIndex >= 0 &&
  (!requestedWorkspaceId || !/^[1-9]\d*$/.test(requestedWorkspaceId))
) {
  throw new Error('--workspace-id requires a positive integer.')
}
if (requestedWorkspaceId && !requestedOwnerId) {
  throw new Error('--workspace-id requires --owner-id.')
}

const allowedArguments = new Set([
  '--apply',
  '--dry-run',
  '--owner-id',
  requestedOwnerId,
  '--workspace-id',
  requestedWorkspaceId,
])
const unknownArgument = process.argv.slice(2).find((argument) =>
  !allowedArguments.has(argument),
)
if (unknownArgument) throw new Error(`Unknown argument: ${unknownArgument}`)

const comparableColumns = `
  owner_id,
  client_profile_id,
  opportunity_id,
  hiring_episode_id,
  organization_id,
  current_stage,
  commercial_stage,
  workflow_state,
  snoozed_until,
  last_event_id,
  last_event_at,
  last_stage_event_id,
  last_stage_event_at,
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
  currency,
  meeting_status,
  active_meeting_event_id,
  last_meeting_event_at,
  meeting_attempt_count
`

const projectionSql = `
  CREATE TEMP TABLE rebuilt_opportunity_outcome_state
  ON COMMIT DROP
  AS
  WITH owner_events AS (
    SELECT event.*
    FROM opportunity_outcome_events event
    JOIN opportunities opportunity
      ON opportunity.owner_id = event.owner_id
     AND opportunity.id = event.opportunity_id
    WHERE event.owner_id = $1
      AND ($2::BIGINT IS NULL OR opportunity.workspace_id = $2)
  ), effective_events AS (
    SELECT event.*
    FROM owner_events event
    WHERE event.event_type <> 'reverted'
      AND NOT EXISTS (
        SELECT 1
        FROM owner_events correction
        WHERE correction.event_type = 'reverted'
          AND correction.reverts_event_id = event.id
      )
  ), contexts AS (
    SELECT DISTINCT ON (opportunity_id)
      owner_id,
      client_profile_id,
      opportunity_id,
      hiring_episode_id,
      organization_id,
      previous_stage AS initial_stage
    FROM owner_events
    WHERE event_type <> 'reverted'
    ORDER BY opportunity_id, id
  ), event_bounds AS (
    SELECT
      opportunity_id,
      (ARRAY_AGG(id ORDER BY id DESC))[1] AS last_event_id,
      MAX(occurred_at) AS last_event_at
    FROM owner_events
    GROUP BY opportunity_id
  ), aggregated AS (
    SELECT
      context.owner_id,
      context.client_profile_id,
      context.opportunity_id,
      context.hiring_episode_id,
      context.organization_id,
      COALESCE(
        (ARRAY_AGG(event.new_stage ORDER BY event.id DESC)
          FILTER (WHERE event_type IN (
            'accepted', 'dismissed', 'contacted', 'replied', 'meeting',
            'proposal', 'won', 'lost'
          )))[1],
        context.initial_stage
      ) AS commercial_stage,
      CASE
        WHEN (ARRAY_AGG(event.event_type ORDER BY event.id DESC)
          FILTER (WHERE event_type IN ('snoozed', 'resumed')))[1] = 'snoozed'
          THEN 'snoozed'
        ELSE 'active'
      END AS workflow_state,
      CASE
        WHEN (ARRAY_AGG(event_type ORDER BY id DESC)
          FILTER (WHERE event_type IN ('snoozed', 'resumed')))[1] = 'snoozed'
          THEN (ARRAY_AGG(event.snoozed_until ORDER BY event.id DESC)
            FILTER (WHERE event_type = 'snoozed'))[1]
        ELSE NULL
      END AS snoozed_until,
      bounds.last_event_id,
      bounds.last_event_at,
      (ARRAY_AGG(event.id ORDER BY event.id DESC)
        FILTER (WHERE event_type IN (
          'accepted', 'dismissed', 'contacted', 'replied', 'meeting',
          'proposal', 'won', 'lost'
        ) AND event.previous_stage <> event.new_stage))[1]
        AS last_stage_event_id,
      (ARRAY_AGG(event.occurred_at ORDER BY event.id DESC)
        FILTER (WHERE event_type IN (
          'accepted', 'dismissed', 'contacted', 'replied', 'meeting',
          'proposal', 'won', 'lost'
        ) AND event.previous_stage <> event.new_stage))[1]
        AS last_stage_event_at,
      MIN(event.occurred_at) FILTER (WHERE event_type = 'shown') AS first_shown_at,
      MIN(event.occurred_at) FILTER (WHERE event_type = 'opened') AS first_opened_at,
      MIN(event.occurred_at) FILTER (WHERE event_type = 'accepted') AS accepted_at,
      MIN(event.occurred_at) FILTER (WHERE event_type = 'contacted') AS contacted_at,
      MIN(event.occurred_at) FILTER (WHERE event_type = 'replied') AS replied_at,
      MIN(event.occurred_at) FILTER (WHERE event_type = 'meeting') AS meeting_at,
      MIN(event.occurred_at) FILTER (WHERE event_type = 'proposal') AS proposal_at,
      MIN(event.occurred_at) FILTER (WHERE event_type = 'won') AS won_at,
      MIN(event.occurred_at) FILTER (WHERE event_type = 'lost') AS lost_at,
      (ARRAY_AGG(event.reason_code ORDER BY event.id DESC)
        FILTER (WHERE event_type = 'dismissed'))[1] AS dismiss_reason_code,
      (ARRAY_AGG(event.reason_code ORDER BY event.id DESC)
        FILTER (WHERE event_type = 'lost'))[1] AS lost_reason_code,
      (ARRAY_AGG(event.value_minor ORDER BY event.id DESC)
        FILTER (WHERE event_type = 'won'))[1] AS deal_value_minor,
      (ARRAY_AGG(event.currency ORDER BY event.id DESC)
        FILTER (WHERE event_type = 'won'))[1] AS currency,
      COALESCE(
        (ARRAY_AGG(
          CASE event.event_type
            WHEN 'meeting' THEN CASE
              WHEN event.metadata->>'meetingStatus' = 'completed'
                THEN 'completed'
              ELSE 'scheduled'
            END
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
      (ARRAY_AGG(event.id ORDER BY event.id DESC)
        FILTER (WHERE event.event_type = 'meeting'))[1]
        AS active_meeting_event_id,
      (ARRAY_AGG(event.occurred_at ORDER BY event.id DESC)
        FILTER (WHERE event.event_type IN (
          'meeting', 'meeting_completed', 'meeting_cancelled',
          'meeting_no_show'
        )))[1] AS last_meeting_event_at,
      COUNT(event.id) FILTER (WHERE event.event_type = 'meeting')::INTEGER
        AS meeting_attempt_count
    FROM contexts context
    JOIN event_bounds bounds USING (opportunity_id)
    LEFT JOIN effective_events event
      ON event.opportunity_id = context.opportunity_id
    GROUP BY
      context.owner_id,
      context.client_profile_id,
      context.opportunity_id,
      context.hiring_episode_id,
      context.organization_id,
      context.initial_stage,
      bounds.last_event_id,
      bounds.last_event_at
  )
  SELECT
    owner_id,
    client_profile_id,
    opportunity_id,
    hiring_episode_id,
    organization_id,
    commercial_stage AS current_stage,
    commercial_stage,
    workflow_state,
    snoozed_until,
    last_event_id,
    last_event_at,
    last_stage_event_id,
    last_stage_event_at,
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
    currency,
    meeting_status,
    active_meeting_event_id,
    last_meeting_event_at,
    meeting_attempt_count,
    NOW() AS updated_at
  FROM aggregated
`

function log(event, fields = {}) {
  process.stdout.write(`${JSON.stringify({
    level: 'info',
    event,
    ...fields,
  })}\n`)
}

const client = new Client({ connectionString: databaseUrl })
const counters = {
  ownersScanned: 0,
  opportunitiesScanned: 0,
  eventsScanned: 0,
  workflowStatesRebuilt: 0,
  correctionsApplied: 0,
  rebuildChanged: 0,
  rebuildFailed: 0,
}

await client.connect()
log('opportunity_outcome.rebuild_started', {
  mode: apply ? 'apply' : 'dry_run',
  ownerScoped: Boolean(requestedOwnerId),
  workspaceScoped: Boolean(requestedWorkspaceId),
})

try {
  const owners = requestedOwnerId
    ? { rows: [{ ownerId: requestedOwnerId }] }
    : await client.query(
      `SELECT owner_id::TEXT AS "ownerId"
       FROM opportunity_outcome_events
       GROUP BY owner_id
       ORDER BY owner_id`,
    )

  for (const owner of owners.rows) {
    await rebuildOwner(String(owner.ownerId))
  }

  log('opportunity_outcome.rebuild_completed', {
    mode: apply ? 'apply' : 'dry_run',
    ...counters,
    rebuildScanned: counters.opportunitiesScanned,
  })
} catch (error) {
  counters.rebuildFailed += 1
  await client.query('ROLLBACK').catch(() => undefined)
  log('opportunity_outcome.rebuild_failed', {
    mode: apply ? 'apply' : 'dry_run',
    ...counters,
    rebuildScanned: counters.opportunitiesScanned,
    errorName: error instanceof Error ? error.name : 'UnknownError',
  })
  throw error
} finally {
  await client.end()
}

async function rebuildOwner(ownerId) {
  await client.query('BEGIN')
  try {
    await client.query(
      `SELECT pg_advisory_xact_lock(
         hashtextextended('opportunity-outcome-owner:' || $1, 0)
       )`,
      [ownerId],
    )
    await client.query(projectionSql, [
      ownerId,
      requestedWorkspaceId,
    ])

    const metrics = await client.query(
      `SELECT
         (SELECT COUNT(*) FROM rebuilt_opportunity_outcome_state)::INTEGER
           AS opportunities,
         (SELECT COUNT(*)
          FROM opportunity_outcome_events event
          JOIN opportunities opportunity
            ON opportunity.owner_id = event.owner_id
           AND opportunity.id = event.opportunity_id
          WHERE event.owner_id = $1
            AND ($2::BIGINT IS NULL OR opportunity.workspace_id = $2)
         )::INTEGER AS events,
         (SELECT COUNT(*) FROM rebuilt_opportunity_outcome_state)::INTEGER
           AS workflows,
         (SELECT COUNT(*)
          FROM opportunity_outcome_events event
          JOIN opportunities opportunity
            ON opportunity.owner_id = event.owner_id
           AND opportunity.id = event.opportunity_id
          WHERE event.owner_id = $1
            AND event.event_type = 'reverted'
            AND ($2::BIGINT IS NULL OR opportunity.workspace_id = $2)
         )::INTEGER
           AS corrections`,
      [ownerId, requestedWorkspaceId],
    )
    const comparison = await client.query(`
      WITH existing AS (
        SELECT ${comparableColumns.replaceAll('\n  ', '\n          state.')}
        FROM opportunity_outcome_state state
        JOIN opportunities opportunity
          ON opportunity.owner_id = state.owner_id
         AND opportunity.id = state.opportunity_id
        WHERE state.owner_id = $1
          AND ($2::BIGINT IS NULL OR opportunity.workspace_id = $2)
      ), rebuilt AS (
        SELECT ${comparableColumns}
        FROM rebuilt_opportunity_outcome_state
      ), differences AS (
        (SELECT * FROM existing EXCEPT SELECT * FROM rebuilt)
        UNION
        (SELECT * FROM rebuilt EXCEPT SELECT * FROM existing)
      )
      SELECT COUNT(DISTINCT (owner_id, opportunity_id))::INTEGER AS changed
      FROM differences
    `, [ownerId, requestedWorkspaceId])

    if (apply) {
      await client.query(
        `DELETE FROM opportunity_outcome_state state
         USING opportunities opportunity
         WHERE opportunity.owner_id = state.owner_id
           AND opportunity.id = state.opportunity_id
           AND state.owner_id = $1
           AND ($2::BIGINT IS NULL OR opportunity.workspace_id = $2)
           AND NOT EXISTS (
             SELECT 1
             FROM rebuilt_opportunity_outcome_state rebuilt
             WHERE rebuilt.owner_id = state.owner_id
               AND rebuilt.opportunity_id = state.opportunity_id
           )`,
        [ownerId, requestedWorkspaceId],
      )
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
        ON CONFLICT (owner_id, opportunity_id)
        DO UPDATE SET
          client_profile_id = EXCLUDED.client_profile_id,
          hiring_episode_id = EXCLUDED.hiring_episode_id,
          organization_id = EXCLUDED.organization_id,
          current_stage = EXCLUDED.current_stage,
          commercial_stage = EXCLUDED.commercial_stage,
          workflow_state = EXCLUDED.workflow_state,
          snoozed_until = EXCLUDED.snoozed_until,
          last_event_id = EXCLUDED.last_event_id,
          last_event_at = EXCLUDED.last_event_at,
          last_stage_event_id = EXCLUDED.last_stage_event_id,
          last_stage_event_at = EXCLUDED.last_stage_event_at,
          first_shown_at = EXCLUDED.first_shown_at,
          first_opened_at = EXCLUDED.first_opened_at,
          accepted_at = EXCLUDED.accepted_at,
          contacted_at = EXCLUDED.contacted_at,
          replied_at = EXCLUDED.replied_at,
          meeting_at = EXCLUDED.meeting_at,
          proposal_at = EXCLUDED.proposal_at,
          won_at = EXCLUDED.won_at,
          lost_at = EXCLUDED.lost_at,
          dismiss_reason_code = EXCLUDED.dismiss_reason_code,
          lost_reason_code = EXCLUDED.lost_reason_code,
          deal_value_minor = EXCLUDED.deal_value_minor,
          currency = EXCLUDED.currency,
          meeting_status = EXCLUDED.meeting_status,
          active_meeting_event_id = EXCLUDED.active_meeting_event_id,
          last_meeting_event_at = EXCLUDED.last_meeting_event_at,
          meeting_attempt_count = EXCLUDED.meeting_attempt_count,
          updated_at = NOW()
      `)
      await client.query('COMMIT')
    } else {
      await client.query('ROLLBACK')
    }

    const row = metrics.rows[0] ?? {}
    counters.ownersScanned += 1
    counters.opportunitiesScanned += Number(row.opportunities ?? 0)
    counters.eventsScanned += Number(row.events ?? 0)
    counters.workflowStatesRebuilt += Number(row.workflows ?? 0)
    counters.correctionsApplied += Number(row.corrections ?? 0)
    counters.rebuildChanged += Number(comparison.rows[0]?.changed ?? 0)
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  }
}
