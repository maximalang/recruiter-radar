import pg from 'pg'

const { Client } = pg

function parseArguments(argv) {
  let ownerId = null
  let json = false
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--json') {
      json = true
      continue
    }
    if (argument === '--owner-id') {
      const value = argv[index + 1]
      if (!value || !/^[1-9]\d*$/.test(value)) {
        throw new Error('--owner-id requires a positive integer.')
      }
      ownerId = value
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${argument}`)
  }
  return { ownerId, json }
}

const OWNER_FILTER = `($1::bigint IS NULL OR candidate.owner_id = $1)`
const EFFECTIVE_EVENT_FILTER = `
  candidate.event_type <> 'reverted'
  AND NOT EXISTS (
    SELECT 1
    FROM opportunity_outcome_events correction
    WHERE correction.owner_id = candidate.owner_id
      AND correction.opportunity_id = candidate.opportunity_id
      AND correction.event_type = 'reverted'
      AND correction.reverts_event_id = candidate.id
  )
`
const COMMERCIAL_EVENT_TYPES = `
  'accepted', 'dismissed', 'contacted', 'replied',
  'meeting', 'meeting_completed', 'meeting_cancelled',
  'meeting_no_show', 'proposal', 'won', 'lost'
`
const STAGE_CHANGING_EVENT_TYPES = `
  'accepted', 'dismissed', 'contacted', 'replied',
  'meeting', 'proposal', 'won', 'lost'
`

const checks = [
  {
    code: 'commercial_chronology_conflict',
    sql: `
      WITH effective AS (
        SELECT
          candidate.*,
          LAG(candidate.occurred_at) OVER (
            PARTITION BY candidate.owner_id, candidate.opportunity_id
            ORDER BY candidate.id
          ) AS prior_occurred_at
        FROM opportunity_outcome_events candidate
        WHERE candidate.event_type IN (${COMMERCIAL_EVENT_TYPES})
          AND ${EFFECTIVE_EVENT_FILTER}
          AND ${OWNER_FILTER}
      )
      SELECT
        owner_id::TEXT AS "ownerId",
        opportunity_id::TEXT AS "opportunityId",
        id::TEXT AS "eventId"
      FROM effective
      WHERE occurred_at < prior_occurred_at`,
  },
  {
    code: 'conflicting_terminal_outcomes',
    sql: `
      SELECT
        candidate.owner_id::TEXT AS "ownerId",
        candidate.opportunity_id::TEXT AS "opportunityId",
        MAX(candidate.id)::TEXT AS "eventId"
      FROM opportunity_outcome_events candidate
      WHERE candidate.event_type IN ('won', 'lost')
        AND ${EFFECTIVE_EVENT_FILTER}
        AND ${OWNER_FILTER}
      GROUP BY candidate.owner_id, candidate.opportunity_id
      HAVING COUNT(*) FILTER (WHERE candidate.event_type = 'won') > 0
         AND COUNT(*) FILTER (WHERE candidate.event_type = 'lost') > 0`,
  },
  {
    code: 'invalid_snooze',
    sql: `
      SELECT
        candidate.owner_id::TEXT AS "ownerId",
        candidate.opportunity_id::TEXT AS "opportunityId",
        candidate.id::TEXT AS "eventId"
      FROM opportunity_outcome_events candidate
      WHERE candidate.event_type = 'snoozed'
        AND (
          candidate.snoozed_until IS NULL
          OR candidate.snoozed_until <= candidate.occurred_at
        )
        AND ${OWNER_FILTER}`,
  },
  {
    code: 'invalid_meeting_lifecycle',
    sql: `
      WITH effective AS (
        SELECT candidate.*
        FROM opportunity_outcome_events candidate
        WHERE candidate.event_type IN (
          'meeting', 'meeting_completed', 'meeting_cancelled',
          'meeting_no_show', 'proposal'
        )
          AND ${EFFECTIVE_EVENT_FILTER}
          AND ${OWNER_FILTER}
      ), lifecycle AS (
        SELECT
          candidate.*,
          (
            SELECT CASE
              WHEN prior.event_type = 'meeting'
                AND prior.metadata->>'meetingStatus' = 'completed'
                THEN 'meeting_completed'
              ELSE prior.event_type
            END
            FROM effective prior
            WHERE prior.owner_id = candidate.owner_id
              AND prior.opportunity_id = candidate.opportunity_id
              AND prior.id < candidate.id
              AND prior.event_type IN (
                'meeting', 'meeting_completed', 'meeting_cancelled',
                'meeting_no_show'
              )
            ORDER BY prior.id DESC
            LIMIT 1
          ) AS prior_meeting_event_type
        FROM effective candidate
      )
      SELECT
        owner_id::TEXT AS "ownerId",
        opportunity_id::TEXT AS "opportunityId",
        id::TEXT AS "eventId"
      FROM lifecycle
      WHERE (
        event_type IN (
          'meeting_completed', 'meeting_cancelled', 'meeting_no_show'
        )
        AND prior_meeting_event_type IS DISTINCT FROM 'meeting'
      ) OR (
        event_type = 'meeting'
        AND prior_meeting_event_type IS NOT NULL
        AND prior_meeting_event_type NOT IN (
          'meeting_cancelled', 'meeting_no_show'
        )
      ) OR (
        event_type = 'proposal'
        AND prior_meeting_event_type IS DISTINCT FROM 'meeting_completed'
      )`,
  },
  {
    code: 'invalid_actor_user_pairing',
    sql: `
      SELECT
        candidate.owner_id::TEXT AS "ownerId",
        candidate.opportunity_id::TEXT AS "opportunityId",
        candidate.id::TEXT AS "eventId"
      FROM opportunity_outcome_events candidate
      WHERE NOT (
        (
          candidate.actor_type IN ('user', 'admin')
          AND candidate.actor_user_id IS NOT NULL
        ) OR (
          candidate.actor_type IN ('system', 'external')
          AND candidate.actor_user_id IS NULL
        )
      )
        AND ${OWNER_FILTER}`,
  },
  {
    code: 'raw_contact_reference',
    sql: `
      SELECT
        candidate.owner_id::TEXT AS "ownerId",
        candidate.opportunity_id::TEXT AS "opportunityId",
        candidate.id::TEXT AS "eventId"
      FROM opportunity_outcome_events candidate
      WHERE (
        candidate.contact_reference IS NOT NULL
        OR (
          candidate.contact_reference_label IS NOT NULL
          AND NOT (
            candidate.contact_reference_label ~ '^.\\*{3}@[^@[:space:]]+$'
            OR candidate.contact_reference_label
              ~ '^\\+?[0-9] \\*{3} \\*{3}-[0-9]{2}-[0-9]{2}$'
            OR candidate.contact_reference_label
              ~ '^[[:alpha:]][[:alnum:]+.-]*://[^/[:space:]]+/…$'
            OR candidate.contact_reference_label ~ '^.\\*{3}$'
          )
        )
        OR candidate.metadata::TEXT
          ~* '[[:alnum:]._%+-]+@[[:alnum:].-]+\\.[[:alpha:]]{2,}'
        OR candidate.metadata::TEXT
          ~ '\\+[0-9][0-9 ()-]{6,}[0-9]'
      )
        AND ${OWNER_FILTER}`,
  },
  {
    code: 'orphan_context',
    sql: `
      SELECT
        candidate.owner_id::TEXT AS "ownerId",
        candidate.opportunity_id::TEXT AS "opportunityId",
        candidate.id::TEXT AS "eventId"
      FROM opportunity_outcome_events candidate
      LEFT JOIN opportunities opportunity
        ON opportunity.owner_id = candidate.owner_id
       AND opportunity.client_profile_id = candidate.client_profile_id
       AND opportunity.id = candidate.opportunity_id
       AND opportunity.hiring_episode_id = candidate.hiring_episode_id
       AND opportunity.organization_id = candidate.organization_id
      WHERE opportunity.id IS NULL
        AND ${OWNER_FILTER}
      UNION ALL
      SELECT
        candidate.owner_id::TEXT,
        candidate.opportunity_id::TEXT,
        candidate.last_event_id::TEXT
      FROM opportunity_outcome_state candidate
      LEFT JOIN opportunities opportunity
        ON opportunity.owner_id = candidate.owner_id
       AND opportunity.id = candidate.opportunity_id
      WHERE opportunity.id IS NULL
        AND ${OWNER_FILTER}`,
  },
  {
    code: 'duplicated_correction_target',
    sql: `
      SELECT
        candidate.owner_id::TEXT AS "ownerId",
        candidate.opportunity_id::TEXT AS "opportunityId",
        candidate.reverts_event_id::TEXT AS "eventId"
      FROM opportunity_outcome_events candidate
      WHERE candidate.event_type = 'reverted'
        AND ${OWNER_FILTER}
      GROUP BY
        candidate.owner_id,
        candidate.opportunity_id,
        candidate.reverts_event_id
      HAVING COUNT(*) > 1`,
  },
  {
    code: 'projection_cross_opportunity_event',
    sql: `
      SELECT
        candidate.owner_id::TEXT AS "ownerId",
        candidate.opportunity_id::TEXT AS "opportunityId",
        COALESCE(
          candidate.last_stage_event_id,
          candidate.last_event_id
        )::TEXT AS "eventId"
      FROM opportunity_outcome_state candidate
      LEFT JOIN opportunity_outcome_events last_event
        ON last_event.id = candidate.last_event_id
       AND last_event.owner_id = candidate.owner_id
       AND last_event.opportunity_id = candidate.opportunity_id
      LEFT JOIN opportunity_outcome_events last_stage_event
        ON last_stage_event.id = candidate.last_stage_event_id
       AND last_stage_event.owner_id = candidate.owner_id
       AND last_stage_event.opportunity_id = candidate.opportunity_id
      WHERE (
        last_event.id IS NULL
        OR (
          candidate.last_stage_event_id IS NOT NULL
          AND last_stage_event.id IS NULL
        )
      )
        AND ${OWNER_FILTER}`,
  },
  {
    code: 'projection_ledger_mismatch',
    sql: `
      WITH effective AS (
        SELECT candidate.*
        FROM opportunity_outcome_events candidate
        WHERE ${EFFECTIVE_EVENT_FILTER}
          AND ${OWNER_FILTER}
      ), expected AS (
        SELECT
          opportunity.owner_id,
          opportunity.id AS opportunity_id,
          latest.id AS last_event_id,
          commercial.id AS last_stage_event_id,
          COALESCE(
            commercial.new_stage,
            CASE
              WHEN opportunity.status IN (
                'new', 'review', 'accepted', 'contacted', 'replied',
                'meeting', 'proposal', 'won', 'lost', 'dismissed'
              ) THEN opportunity.status
              ELSE 'new'
            END
          ) AS commercial_stage,
          CASE
            WHEN workflow.event_type = 'snoozed' THEN 'snoozed'
            ELSE 'active'
          END AS workflow_state,
          CASE
            WHEN workflow.event_type = 'snoozed'
              THEN workflow.snoozed_until
            ELSE NULL
          END AS snoozed_until
        FROM opportunities opportunity
        LEFT JOIN LATERAL (
          SELECT candidate.id
          FROM opportunity_outcome_events candidate
          WHERE candidate.owner_id = opportunity.owner_id
            AND candidate.opportunity_id = opportunity.id
          ORDER BY candidate.id DESC
          LIMIT 1
        ) latest ON TRUE
        LEFT JOIN LATERAL (
          SELECT candidate.id, candidate.new_stage
          FROM effective candidate
          WHERE candidate.owner_id = opportunity.owner_id
            AND candidate.opportunity_id = opportunity.id
            AND candidate.event_type IN (${STAGE_CHANGING_EVENT_TYPES})
            AND candidate.previous_stage IS DISTINCT FROM candidate.new_stage
          ORDER BY candidate.id DESC
          LIMIT 1
        ) commercial ON TRUE
        LEFT JOIN LATERAL (
          SELECT candidate.event_type, candidate.snoozed_until
          FROM effective candidate
          WHERE candidate.owner_id = opportunity.owner_id
            AND candidate.opportunity_id = opportunity.id
            AND candidate.event_type IN ('snoozed', 'resumed')
          ORDER BY candidate.id DESC
          LIMIT 1
        ) workflow ON TRUE
        WHERE ($1::bigint IS NULL OR opportunity.owner_id = $1)
      )
      SELECT
        expected.owner_id::TEXT AS "ownerId",
        expected.opportunity_id::TEXT AS "opportunityId",
        COALESCE(
          candidate.last_stage_event_id,
          candidate.last_event_id,
          expected.last_event_id
        )::TEXT AS "eventId"
      FROM expected
      LEFT JOIN opportunity_outcome_state candidate
        ON candidate.owner_id = expected.owner_id
       AND candidate.opportunity_id = expected.opportunity_id
      WHERE expected.last_event_id IS NOT NULL
        AND (
          candidate.opportunity_id IS NULL
          OR candidate.last_event_id IS DISTINCT FROM expected.last_event_id
          OR candidate.last_stage_event_id
            IS DISTINCT FROM expected.last_stage_event_id
          OR candidate.commercial_stage
            IS DISTINCT FROM expected.commercial_stage
          OR candidate.workflow_state
            IS DISTINCT FROM expected.workflow_state
          OR candidate.snoozed_until
            IS DISTINCT FROM expected.snoozed_until
        )`,
  },
  {
    code: 'post_supersession_effective_event',
    sql: `
      SELECT
        candidate.owner_id::TEXT AS "ownerId",
        candidate.opportunity_id::TEXT AS "opportunityId",
        candidate.id::TEXT AS "eventId"
      FROM opportunity_outcome_events candidate
      JOIN opportunities opportunity
        ON opportunity.owner_id = candidate.owner_id
       AND opportunity.id = candidate.opportunity_id
      WHERE opportunity.superseded_at IS NOT NULL
        AND candidate.recorded_at > opportunity.superseded_at
        AND ${EFFECTIVE_EVENT_FILTER}
        AND ${OWNER_FILTER}`,
  },
]

async function run() {
  const options = parseArguments(process.argv.slice(2))
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is required.')

  const client = new Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    await client.query(
      'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
    )
    const scope = [options.ownerId]
    const counts = await client.query(
      `SELECT
         COUNT(DISTINCT owner_id)::int AS "ownersScanned",
         COUNT(*)::int AS "opportunitiesScanned"
       FROM opportunities
       WHERE ($1::bigint IS NULL OR owner_id = $1)`,
      scope,
    )
    const violations = []
    for (const check of checks) {
      const result = await client.query(check.sql, scope)
      for (const row of result.rows) {
        violations.push({
          ownerId: row.ownerId,
          opportunityId: row.opportunityId,
          eventId: row.eventId ?? null,
          violationCode: check.code,
        })
      }
    }
    await client.query('COMMIT')

    const violationsByCode = {}
    for (const violation of violations) {
      violationsByCode[violation.violationCode] =
        (violationsByCode[violation.violationCode] ?? 0) + 1
    }
    const summary = {
      ok: violations.length === 0,
      ownersScanned: counts.rows[0]?.ownersScanned ?? 0,
      opportunitiesScanned: counts.rows[0]?.opportunitiesScanned ?? 0,
      blockingViolations: violations.length,
      violationsByCode,
      violations,
    }

    if (options.json) {
      process.stdout.write(`${JSON.stringify(summary)}\n`)
    } else {
      console.log(
        `Outcome preflight: ok=${summary.ok} ` +
        `owners=${summary.ownersScanned} ` +
        `opportunities=${summary.opportunitiesScanned} ` +
        `blocking=${summary.blockingViolations}`,
      )
      for (const violation of violations) {
        console.log(
          `${violation.violationCode} ` +
          `owner=${violation.ownerId} ` +
          `opportunity=${violation.opportunityId} ` +
          `event=${violation.eventId ?? '-'}`,
        )
      }
    }
    if (!summary.ok) process.exitCode = 2
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    await client.end()
  }
}

run().catch((error) => {
  console.error(
    `Opportunity outcome preflight failed: ${
      error instanceof Error ? error.message : String(error)
    }`,
  )
  process.exitCode = 1
})
