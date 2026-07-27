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
      client_profile_id BIGINT NOT NULL,
      episode_type TEXT NOT NULL,
      confidence_gate TEXT NOT NULL,
      source_family TEXT NOT NULL,
      score_bucket TEXT NOT NULL
    ) ON COMMIT DROP;

    CREATE TEMP TABLE benchmark_outcome_events (
      id BIGINT PRIMARY KEY,
      owner_id BIGINT NOT NULL,
      opportunity_id BIGINT NOT NULL,
      event_type TEXT NOT NULL,
      occurred_at TIMESTAMPTZ NOT NULL
    ) ON COMMIT DROP;

    INSERT INTO benchmark_opportunities
    SELECT
      opportunity_id,
      1 + ((opportunity_id - 1) % 10),
      1 + ((opportunity_id - 1) % 100),
      CASE WHEN opportunity_id % 2 = 0 THEN 'vacancy_spike' ELSE 'role_cluster' END,
      CASE WHEN opportunity_id % 4 = 0 THEN 'A' ELSE 'B' END,
      CASE WHEN opportunity_id % 3 = 0 THEN 'career_page' ELSE 'job_board' END,
      CASE WHEN opportunity_id % 5 = 0 THEN 'high' ELSE 'medium' END
    FROM generate_series(1, 10000) AS opportunity_id;

    INSERT INTO benchmark_outcome_events
    SELECT
      event_id,
      opportunity.owner_id,
      opportunity.id,
      (ARRAY[
        'shown', 'opened', 'accepted', 'contacted', 'replied',
        'meeting', 'proposal', 'won', 'exported', 'opened'
      ])[1 + ((event_id - 1) % 10)],
      TIMESTAMPTZ '2026-01-01 00:00:00+00'
        + ((opportunity.id % 28) * INTERVAL '1 day')
        + (((event_id - 1) % 10) * INTERVAL '1 hour')
    FROM generate_series(1, 100000) AS event_id
    JOIN benchmark_opportunities opportunity
      ON opportunity.id = 1 + ((event_id - 1) / 10);

    CREATE INDEX benchmark_outcome_owner_type_time_idx
      ON benchmark_outcome_events (owner_id, event_type, occurred_at, opportunity_id);
    CREATE INDEX benchmark_outcome_owner_opportunity_time_idx
      ON benchmark_outcome_events (owner_id, opportunity_id, occurred_at, event_type);
    ANALYZE benchmark_opportunities;
    ANALYZE benchmark_outcome_events;
  `)

  const result = await client.query(`
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    WITH cohort AS (
      SELECT DISTINCT ON (event.opportunity_id)
        event.opportunity_id,
        event.occurred_at AS cohort_at
      FROM benchmark_outcome_events event
      JOIN benchmark_opportunities opportunity
        ON opportunity.id = event.opportunity_id
       AND opportunity.owner_id = event.owner_id
      WHERE event.owner_id = 1
        AND event.event_type = 'shown'
        AND event.occurred_at >= TIMESTAMPTZ '2026-01-01 00:00:00+00'
        AND event.occurred_at < TIMESTAMPTZ '2026-02-01 00:00:00+00'
      ORDER BY event.opportunity_id, event.occurred_at, event.id
    ),
    accepted AS (
      SELECT cohort.opportunity_id, MIN(event.occurred_at) AS occurred_at
      FROM cohort
      JOIN benchmark_outcome_events event
        ON event.owner_id = 1
       AND event.opportunity_id = cohort.opportunity_id
       AND event.event_type = 'accepted'
       AND event.occurred_at >= cohort.cohort_at
       AND event.occurred_at < TIMESTAMPTZ '2026-02-01 00:00:00+00'
      GROUP BY cohort.opportunity_id
    ),
    contacted AS (
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

  const plan = result.rows[0]['QUERY PLAN'][0]
  console.log(JSON.stringify({
    event: 'opportunity_outcome.funnel_benchmark_completed',
    fixture: {
      owners: 10,
      profiles: 100,
      opportunities: 10000,
      outcomeEvents: 100000,
    },
    executionTimeMs: plan['Execution Time'],
    planningTimeMs: plan['Planning Time'],
    sharedHitBlocks: collectPlanMetric(plan.Plan, 'Shared Hit Blocks'),
    localHitBlocks: collectPlanMetric(plan.Plan, 'Local Hit Blocks'),
    nodeTypes: [...collectPlanValues(plan.Plan, 'Node Type')].sort(),
    indexesUsed: [...collectPlanValues(plan.Plan, 'Index Name')].sort(),
  }, null, 2))
} finally {
  await client.query('ROLLBACK').catch(() => undefined)
  await client.end()
}

function collectPlanMetric(node, key) {
  return (node[key] ?? 0) +
    (node.Plans ?? []).reduce((sum, child) => sum + collectPlanMetric(child, key), 0)
}

function collectPlanValues(node, key, values = new Set()) {
  if (node[key]) values.add(node[key])
  for (const child of node.Plans ?? []) collectPlanValues(child, key, values)
  return values
}
