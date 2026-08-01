import pg from 'pg'

const { Client } = pg
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required.')

const client = new Client({ connectionString: databaseUrl })
await client.connect()

try {
  await client.query('BEGIN')
  await client.query(`
    CREATE TEMP TABLE benchmark_opportunities (
      id BIGINT PRIMARY KEY,
      owner_id BIGINT NOT NULL,
      workspace_id BIGINT NOT NULL,
      client_profile_id BIGINT NOT NULL,
      public_reference UUID NOT NULL
    ) ON COMMIT DROP;

    CREATE TEMP TABLE benchmark_outcome_events (
      id BIGINT PRIMARY KEY,
      owner_id BIGINT NOT NULL,
      opportunity_id BIGINT NOT NULL,
      event_type TEXT NOT NULL,
      occurred_at TIMESTAMPTZ NOT NULL,
      analytics_snapshot JSONB NOT NULL,
      reverts_event_id BIGINT,
      reason_code TEXT,
      channel TEXT,
      contact_path_type TEXT,
      assigned_user_id BIGINT,
      value_minor BIGINT,
      currency CHAR(3)
    ) ON COMMIT DROP;

    INSERT INTO benchmark_opportunities
    SELECT
      opportunity_id,
      CASE
        WHEN opportunity_id <= 10000 THEN 1
        ELSE 2 + ((opportunity_id - 10001) % 9)
      END,
      CASE
        WHEN opportunity_id <= 10000 THEN 1
        ELSE 2 + ((opportunity_id - 10001) % 9)
      END,
      1 + ((opportunity_id - 1) % 1000),
      MD5(opportunity_id::TEXT)::UUID
    FROM generate_series(1, 20000) AS opportunity_id;

    INSERT INTO benchmark_outcome_events
    SELECT
      event_id,
      opportunity.owner_id,
      opportunity.id,
      kind.event_type,
      TIMESTAMPTZ '2026-01-01 00:00:00+00'
        + ((opportunity.id % 28) * INTERVAL '1 day')
        + (((event_id - 1) % 10) * INTERVAL '1 hour'),
      JSONB_BUILD_OBJECT(
        'clientProfileId', opportunity.client_profile_id::TEXT,
        'clientProfileVersion', 'profile-v2',
        'agencyDnaVersion', 'dna-v2',
        'hiringMode', 'specialist',
        'specialization', 'it recruitment',
        'matchedRoleFamilies', JSONB_BUILD_ARRAY('backend'),
        'matchedIndustries', JSONB_BUILD_ARRAY('it'),
        'matchedRegions', JSONB_BUILD_ARRAY('moscow'),
        'organizationSizeBucket', 'medium',
        'episodeType', 'vacancy_spike',
        'confidenceGate', CASE WHEN opportunity.id % 4 = 0 THEN 'A' ELSE 'B' END,
        'scoreBucket', CASE WHEN opportunity.id % 5 = 0 THEN 'high' ELSE 'medium' END,
        'externalSupportNeedBucket', 'high',
        'sourceFamilies', JSONB_BUILD_ARRAY('job_board'),
        'scoringVersion', 'opportunity-v2'
      ),
      CASE WHEN kind.event_type = 'reverted' THEN event_id - 1 END,
      CASE WHEN kind.event_type = 'lost' THEN 'price' END,
      CASE WHEN kind.event_type = 'contacted' THEN 'email' END,
      CASE WHEN kind.event_type = 'contacted' THEN 'corporate_email' END,
      1 + (opportunity.id % 25),
      CASE WHEN kind.event_type = 'won' THEN 250000 END,
      CASE WHEN kind.event_type = 'won' THEN 'RUB' END
    FROM generate_series(1, 200000) AS event_id
    JOIN benchmark_opportunities opportunity
      ON opportunity.id = 1 + ((event_id - 1) / 10)
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN event_id % 100 = 0 THEN 'reverted'
        WHEN ((event_id - 1) % 10) = 7 AND opportunity.id % 3 = 0 THEN 'lost'
        ELSE (ARRAY[
          'shown', 'opened', 'accepted', 'contacted', 'replied',
          'meeting', 'proposal', 'won', 'exported', 'opened'
        ])[1 + ((event_id - 1) % 10)]
      END AS event_type
    ) kind;

    CREATE INDEX benchmark_outcome_owner_type_time_idx
      ON benchmark_outcome_events (
        owner_id, event_type, occurred_at, opportunity_id, id
      );
    CREATE INDEX benchmark_outcome_owner_opportunity_time_idx
      ON benchmark_outcome_events (
        owner_id, opportunity_id, occurred_at, event_type, id
      );
    CREATE INDEX benchmark_outcome_owner_reverts_idx
      ON benchmark_outcome_events (owner_id, reverts_event_id)
      WHERE reverts_event_id IS NOT NULL;
    ANALYZE benchmark_opportunities;
    ANALYZE benchmark_outcome_events;
  `)

  const legacyResult = await client.query(`
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    WITH cohort_ranked AS (
      SELECT
        event.opportunity_id,
        event.occurred_at AS cohort_at,
        ROW_NUMBER() OVER (
          PARTITION BY event.opportunity_id
          ORDER BY event.occurred_at, event.id
        ) AS cohort_rank
      FROM benchmark_outcome_events event
      JOIN benchmark_opportunities opportunity
        ON opportunity.id = event.opportunity_id
       AND opportunity.owner_id = event.owner_id
      WHERE event.owner_id = 1
        AND event.event_type = 'shown'
    ), cohort AS (
      SELECT opportunity_id, cohort_at
      FROM cohort_ranked
      WHERE cohort_rank = 1
        AND cohort_at >= TIMESTAMPTZ '2026-01-01 00:00:00+00'
        AND cohort_at < TIMESTAMPTZ '2026-02-01 00:00:00+00'
    ), accepted AS (
      SELECT cohort.opportunity_id, MIN(event.occurred_at) AS occurred_at
      FROM cohort
      JOIN benchmark_outcome_events event
        ON event.owner_id = 1
       AND event.opportunity_id = cohort.opportunity_id
       AND event.event_type = 'accepted'
       AND event.occurred_at >= cohort.cohort_at
       AND event.occurred_at < TIMESTAMPTZ '2026-02-01 00:00:00+00'
      GROUP BY cohort.opportunity_id
    ), contacted AS (
      SELECT accepted.opportunity_id, MIN(event.occurred_at) AS occurred_at
      FROM accepted
      JOIN benchmark_outcome_events event
        ON event.owner_id = 1
       AND event.opportunity_id = accepted.opportunity_id
       AND event.event_type = 'contacted'
       AND event.occurred_at >= accepted.occurred_at
       AND event.occurred_at < TIMESTAMPTZ '2026-02-01 00:00:00+00'
      GROUP BY accepted.opportunity_id
    )
    SELECT
      (SELECT COUNT(*) FROM cohort) AS cohort_size,
      (SELECT COUNT(*) FROM accepted) AS accepted_count,
      (SELECT COUNT(*) FROM contacted) AS contacted_count;
  `)

  const analyticsCte = `
    WITH scoped_opportunities AS (
      SELECT scoped_opportunity.id
      FROM benchmark_opportunities scoped_opportunity
      WHERE scoped_opportunity.owner_id = 1
        AND scoped_opportunity.workspace_id = 1
    ), cohort_ranked AS (
      SELECT
        event.opportunity_id,
        event.occurred_at AS cohort_at,
        event.analytics_snapshot AS cohort_snapshot,
        event.channel AS cohort_channel,
        event.contact_path_type AS cohort_contact_path_type,
        event.assigned_user_id AS cohort_assigned_user_id,
        ROW_NUMBER() OVER (
          PARTITION BY event.opportunity_id
          ORDER BY event.occurred_at, event.id
        ) AS cohort_rank
      FROM benchmark_outcome_events event
      JOIN scoped_opportunities scoped_opportunity
        ON scoped_opportunity.id = event.opportunity_id
      WHERE event.owner_id = 1
        AND event.event_type = 'shown'
        AND event.occurred_at < TIMESTAMPTZ '2026-02-01 00:00:00+00'
        AND NOT EXISTS (
          SELECT 1
          FROM benchmark_outcome_events correction
          WHERE correction.owner_id = event.owner_id
            AND correction.opportunity_id = event.opportunity_id
            AND correction.event_type = 'reverted'
            AND correction.reverts_event_id = event.id
        )
    ), cohort AS (
      SELECT
        opportunity_id,
        cohort_at,
        cohort_snapshot,
        cohort_channel,
        cohort_contact_path_type,
        cohort_assigned_user_id
      FROM cohort_ranked
      WHERE cohort_rank = 1
        AND cohort_at >= TIMESTAMPTZ '2026-01-01 00:00:00+00'
        AND cohort_at < TIMESTAMPTZ '2026-02-01 00:00:00+00'
        AND cohort_snapshot->>'agencyDnaVersion' = 'dna-v2'
        AND cohort_snapshot->'matchedRoleFamilies' ? 'backend'
    ), cohort_events AS (
      SELECT
        event.*,
        cohort.cohort_at,
        cohort.cohort_snapshot,
        cohort.cohort_channel,
        cohort.cohort_contact_path_type,
        cohort.cohort_assigned_user_id
      FROM cohort
      JOIN benchmark_outcome_events event
        ON event.owner_id = 1
       AND event.opportunity_id = cohort.opportunity_id
      WHERE event.event_type <> 'reverted'
        AND event.occurred_at >= cohort.cohort_at
        AND event.occurred_at < TIMESTAMPTZ '2026-02-01 00:00:00+00'
        AND NOT EXISTS (
          SELECT 1
          FROM benchmark_outcome_events correction
          WHERE correction.owner_id = event.owner_id
            AND correction.opportunity_id = event.opportunity_id
            AND correction.event_type = 'reverted'
            AND correction.reverts_event_id = event.id
        )
    )`

  const analyticsResult = await client.query(`
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    ${analyticsCte}, per_opportunity AS (
      SELECT
        opportunity_id,
        MIN(occurred_at) FILTER (WHERE event_type = 'shown') AS shown_at,
        MIN(occurred_at) FILTER (WHERE event_type = 'opened') AS opened_at,
        MIN(occurred_at) FILTER (WHERE event_type = 'accepted') AS accepted_at,
        MIN(occurred_at) FILTER (WHERE event_type = 'contacted') AS contacted_at,
        MIN(occurred_at) FILTER (WHERE event_type = 'replied') AS replied_at,
        MIN(occurred_at) FILTER (WHERE event_type = 'meeting') AS meeting_at,
        MIN(occurred_at) FILTER (WHERE event_type = 'proposal') AS proposal_at,
        MIN(occurred_at) FILTER (WHERE event_type = 'won') AS won_at,
        MIN(occurred_at) FILTER (WHERE event_type = 'lost') AS lost_at
      FROM cohort_events
      GROUP BY opportunity_id
    ), reason_counts AS (
      SELECT event_type, reason_code, COUNT(*) AS reason_count
      FROM cohort_events
      WHERE event_type IN ('dismissed', 'lost')
        AND reason_code IS NOT NULL
      GROUP BY event_type, reason_code
    )
    SELECT
      COUNT(*) AS cohort_size,
      COUNT(*) FILTER (WHERE contacted_at IS NOT NULL) AS contacted_count,
      COUNT(*) FILTER (WHERE won_at IS NOT NULL) AS won_count,
      COUNT(*) FILTER (WHERE lost_at IS NOT NULL) AS lost_count,
      PERCENTILE_CONT(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (contacted_at - accepted_at))
      ) FILTER (
        WHERE accepted_at IS NOT NULL
          AND contacted_at IS NOT NULL
          AND contacted_at >= accepted_at
      ) AS accepted_contacted_median_seconds,
      (SELECT JSONB_AGG(reason_counts ORDER BY event_type, reason_code)
       FROM reason_counts) AS reasons,
      (SELECT COALESCE(SUM(value_minor), 0)
       FROM cohort_events
       WHERE event_type = 'won' AND currency = 'RUB') AS confirmed_revenue_minor
    FROM per_opportunity;
  `)

  const calibrationResult = await client.query(`
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    ${analyticsCte}, per_opportunity AS (
      SELECT
        event.opportunity_id,
        event.cohort_at,
        event.cohort_snapshot,
        MIN(event.occurred_at) FILTER (
          WHERE event.event_type = 'accepted'
        ) AS accepted_at,
        MIN(event.occurred_at) FILTER (
          WHERE event.event_type = 'contacted'
        ) AS contacted_at,
        MIN(event.occurred_at) FILTER (
          WHERE event.event_type = 'won'
        ) AS won_at,
        MIN(event.occurred_at) FILTER (
          WHERE event.event_type = 'lost'
        ) AS lost_at,
        MAX(event.value_minor) FILTER (
          WHERE event.event_type = 'won' AND event.currency = 'RUB'
        ) AS confirmed_revenue_minor
      FROM cohort_events event
      GROUP BY
        event.opportunity_id,
        event.cohort_at,
        event.cohort_snapshot
    )
    SELECT
      scoped_opportunity.public_reference,
      event.cohort_at,
      event.cohort_snapshot,
      event.accepted_at,
      event.contacted_at,
      event.won_at,
      event.lost_at,
      event.confirmed_revenue_minor,
      COUNT(*) OVER () AS cohort_size
    FROM per_opportunity event
    JOIN benchmark_opportunities scoped_opportunity
      ON scoped_opportunity.id = event.opportunity_id
     AND scoped_opportunity.owner_id = 1
     AND scoped_opportunity.workspace_id = 1
    ORDER BY event.cohort_at, scoped_opportunity.public_reference
    LIMIT 5001;
  `)

  const legacy = planMetrics(legacyResult.rows[0]['QUERY PLAN'][0])
  const analyticsV2 = planMetrics(analyticsResult.rows[0]['QUERY PLAN'][0])
  const calibration = planMetrics(calibrationResult.rows[0]['QUERY PLAN'][0])
  for (const [name, metrics] of [
    ['summary', analyticsV2],
    ['calibration export', calibration],
  ]) {
    if (metrics.executionTimeMs > 1000) {
      throw new Error(
        `Opportunity Analytics v2 ${name} benchmark exceeded 1000ms: ${metrics.executionTimeMs}`,
      )
    }
    if (!metrics.indexesUsed.some((indexName) =>
      indexName.startsWith('benchmark_outcome_owner_'))) {
      throw new Error(
        `Opportunity Analytics v2 ${name} benchmark used no owner-scoped event index.`,
      )
    }
  }

  console.log(JSON.stringify({
    event: 'opportunity_analytics_v2.benchmark_completed',
    fixture: {
      owners: 10,
      workspaces: 10,
      profiles: 1000,
      opportunities: 20000,
      outcomeEvents: 200000,
      targetOutcomeEvents: 100000,
      corrections: 2000,
      targetCorrections: 1000,
    },
    regressionGuardMs: 1000,
    legacyFunnel: legacy,
    analyticsV2,
    calibrationExport: calibration,
  }, null, 2))
} finally {
  await client.query('ROLLBACK').catch(() => undefined)
  await client.end()
}

function planMetrics(plan) {
  return {
    executionTimeMs: plan['Execution Time'],
    planningTimeMs: plan['Planning Time'],
    sharedHitBlocks: collectPlanMetric(plan.Plan, 'Shared Hit Blocks'),
    localHitBlocks: collectPlanMetric(plan.Plan, 'Local Hit Blocks'),
    nodeTypes: [...collectPlanValues(plan.Plan, 'Node Type')].sort(),
    indexesUsed: [...collectPlanValues(plan.Plan, 'Index Name')].sort(),
  }
}

function collectPlanMetric(node, key) {
  return (node[key] ?? 0) +
    (node.Plans ?? []).reduce(
      (sum, child) => sum + collectPlanMetric(child, key),
      0,
    )
}

function collectPlanValues(node, key, values = new Set()) {
  if (node[key]) values.add(node[key])
  for (const child of node.Plans ?? []) collectPlanValues(child, key, values)
  return values
}
