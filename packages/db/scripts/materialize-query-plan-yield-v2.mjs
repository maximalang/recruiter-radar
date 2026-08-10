import { createHash } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;
const METRIC_VERSION = 'query-plan-yield-v2';
const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

function parseArgs(argv) {
  const result = {
    workspaceId: null,
    clientProfileId: null,
    windowDays: DEFAULT_WINDOW_DAYS,
    limit: DEFAULT_LIMIT,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--workspace-id') result.workspaceId = argv[++index] ?? null;
    else if (arg === '--client-profile-id') result.clientProfileId = argv[++index] ?? null;
    else if (arg === '--window-days') result.windowDays = Number(argv[++index]);
    else if (arg === '--limit') result.limit = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  result.workspaceId = positiveId(result.workspaceId, 'workspace');
  result.clientProfileId = result.clientProfileId == null
    ? null
    : positiveId(result.clientProfileId, 'client profile');
  result.windowDays = integerBetween(result.windowDays, 1, 180, 'window days');
  result.limit = integerBetween(result.limit, 1, MAX_LIMIT, 'limit');
  return result;
}

export async function materializeQueryPlanYield({
  connectionString,
  workspaceId,
  clientProfileId = null,
  windowDays = DEFAULT_WINDOW_DAYS,
  limit = DEFAULT_LIMIT,
  now = new Date(),
}) {
  const normalizedWorkspaceId = positiveId(workspaceId, 'workspace');
  const normalizedProfileId = clientProfileId == null
    ? null
    : positiveId(clientProfileId, 'client profile');
  const boundedDays = integerBetween(windowDays, 1, 180, 'window days');
  const boundedLimit = integerBetween(limit, 1, MAX_LIMIT, 'limit');
  const measurementEnd = validDate(now);
  const measurementStart = new Date(
    measurementEnd.getTime() - boundedDays * 24 * 60 * 60 * 1000,
  );

  const client = new Client({ connectionString });
  await client.connect();
  const stats = {
    workspaceId: normalizedWorkspaceId,
    clientProfileId: normalizedProfileId,
    measurementWindowStart: measurementStart.toISOString(),
    measurementWindowEnd: measurementEnd.toISOString(),
    plansScanned: 0,
    snapshotsInserted: 0,
    snapshotsReplayed: 0,
    failures: [],
  };

  try {
    const plans = await loadCurrentPlans(
      client,
      normalizedWorkspaceId,
      normalizedProfileId,
      boundedLimit,
    );
    for (const plan of plans) {
      stats.plansScanned += 1;
      try {
        const counts = await computePlanCounts(
          client,
          plan,
          measurementStart,
          measurementEnd,
        );
        const rates = computeRates(counts);
        const snapshot = {
          metricVersion: METRIC_VERSION,
          planSnapshotId: plan.planSnapshotId,
          workspaceId: plan.workspaceId,
          clientProfileId: plan.clientProfileId,
          measurementWindowStart: measurementStart.toISOString(),
          measurementWindowEnd: measurementEnd.toISOString(),
          ...counts,
          ...rates,
        };
        const inputHash = sha256(stableStringify(snapshot));
        const inserted = await client.query(
          `INSERT INTO query_plan_metric_snapshots (
             plan_snapshot_id, workspace_id, client_profile_id,
             metric_version, measurement_window_start, measurement_window_end,
             execution_count, zero_result_executions, fetched_records,
             unique_events, unique_companies, new_company_events,
             independent_events, episodes, qualified_episodes,
             qualified_opportunities, actionable_opportunities,
             strong_reviewed_opportunities, ordinary_hiring_opportunities,
             stale_opportunities, accepted, contacted, replied, meetings,
             won_opportunities, duplicate_rate, stale_rate, zero_result_rate,
             qualified_rate, accepted_rate, contacted_rate, reply_rate,
             meeting_rate, independent_event_fetch_rate, episode_fetch_rate,
             qualified_fetch_rate, strong_reviewed_fetch_rate, input_hash
           )
           VALUES (
             $1, $2, $3, $4, $5::TIMESTAMPTZ, $6::TIMESTAMPTZ,
             $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
             $17, $18, $19, $20, $21, $22, $23, $24, $25, $26,
             $27, $28, $29, $30, $31, $32, $33, $34, $35, $36,
             $37, $38
           )
           ON CONFLICT (plan_snapshot_id, metric_version, input_hash) DO NOTHING`,
          [
            plan.planSnapshotId,
            plan.workspaceId,
            plan.clientProfileId,
            METRIC_VERSION,
            measurementStart.toISOString(),
            measurementEnd.toISOString(),
            counts.executionCount,
            counts.zeroResultExecutions,
            counts.fetchedRecords,
            counts.uniqueEvents,
            counts.uniqueCompanies,
            counts.newCompanyEvents,
            counts.independentEvents,
            counts.episodes,
            counts.qualifiedEpisodes,
            counts.qualifiedOpportunities,
            counts.actionableOpportunities,
            counts.strongReviewedOpportunities,
            counts.ordinaryHiringOpportunities,
            counts.staleOpportunities,
            counts.accepted,
            counts.contacted,
            counts.replied,
            counts.meetings,
            counts.won,
            rates.duplicateRate,
            rates.staleRate,
            rates.zeroResultRate,
            rates.qualifiedRate,
            rates.acceptedRate,
            rates.contactedRate,
            rates.replyRate,
            rates.meetingRate,
            rates.independentEventFetchRate,
            rates.episodeFetchRate,
            rates.qualifiedFetchRate,
            rates.strongReviewedFetchRate,
            inputHash,
          ],
        );
        if ((inserted.rowCount ?? 0) > 0) stats.snapshotsInserted += 1;
        else stats.snapshotsReplayed += 1;
      } catch (error) {
        stats.failures.push({
          planSnapshotId: plan.planSnapshotId,
          reasonCode: errorCode(error),
        });
      }
    }
    return stats;
  } finally {
    await client.end();
  }
}

async function loadCurrentPlans(client, workspaceId, clientProfileId, limit) {
  const result = await client.query(
    `SELECT
       plan.id::TEXT AS "planSnapshotId",
       plan.workspace_id::TEXT AS "workspaceId",
       plan.client_profile_id::TEXT AS "clientProfileId"
     FROM query_plan_snapshots plan
     WHERE plan.workspace_id = $1
       AND ($2::BIGINT IS NULL OR plan.client_profile_id = $2)
       AND plan.status = 'ready'
       AND NOT EXISTS (
         SELECT 1
         FROM query_plan_snapshots newer
         WHERE newer.workspace_id = plan.workspace_id
           AND newer.client_profile_id = plan.client_profile_id
           AND newer.planner_version = plan.planner_version
           AND newer.plan_identity = plan.plan_identity
           AND newer.plan_generation > plan.plan_generation
       )
     ORDER BY plan.client_profile_id, plan.id
     LIMIT $3`,
    [workspaceId, clientProfileId, limit],
  );
  return result.rows.map((row) => ({
    planSnapshotId: positiveId(row.planSnapshotId, 'plan snapshot'),
    workspaceId: positiveId(row.workspaceId, 'workspace'),
    clientProfileId: positiveId(row.clientProfileId, 'client profile'),
  }));
}

async function computePlanCounts(client, plan, start, end) {
  const result = await client.query(
    `WITH executions AS (
       SELECT DISTINCT execution.id, execution.fetched_records
       FROM query_plan_source_execution_consumers consumer
       JOIN query_plan_source_executions execution
         ON execution.id = consumer.execution_id
       WHERE consumer.plan_snapshot_id = $1
         AND consumer.workspace_id = $2
         AND consumer.client_profile_id = $3
         AND execution.started_at >= $4::TIMESTAMPTZ
         AND execution.started_at < $5::TIMESTAMPTZ
     ),
     execution_signals AS (
       SELECT DISTINCT
         execution_signal.execution_id,
         execution_signal.signal_id,
         execution_signal.organization_id
       FROM query_plan_source_execution_signals execution_signal
       JOIN executions execution ON execution.id = execution_signal.execution_id
     ),
     company_events AS (
       SELECT DISTINCT
         publication.company_event_id,
         publication.organization_id
       FROM execution_signals execution_signal
       JOIN company_event_publications publication
         ON publication.signal_id = execution_signal.signal_id
        AND publication.organization_id = execution_signal.organization_id
     ),
     episodes AS (
       SELECT DISTINCT
         episode_event.signal_episode_id,
         episode_event.organization_id
       FROM company_events company_event
       JOIN signal_episode_events episode_event
         ON episode_event.company_event_id = company_event.company_event_id
        AND episode_event.organization_id = company_event.organization_id
     ),
     lineages AS (
       SELECT DISTINCT
         lineage.id AS lineage_id,
         lineage.opportunity_id,
         lineage.candidate_id,
         lineage.signal_episode_id,
         lineage.organization_id,
         lineage.owner_id
       FROM commercial_signal_opportunity_query_plans query_link
       JOIN commercial_signal_opportunity_lineage lineage
         ON lineage.id = query_link.lineage_id
       WHERE query_link.plan_snapshot_id = $1
         AND query_link.workspace_id = $2
         AND query_link.client_profile_id = $3
         AND lineage.created_at >= $4::TIMESTAMPTZ
         AND lineage.created_at < $5::TIMESTAMPTZ
     ),
     outcome_flags AS (
       SELECT
         lineage.opportunity_id,
         outcome.accepted_at >= lineage.created_at
           AND outcome.accepted_at < $5::TIMESTAMPTZ AS accepted,
         outcome.contacted_at >= lineage.created_at
           AND outcome.contacted_at < $5::TIMESTAMPTZ AS contacted,
         outcome.replied_at >= lineage.created_at
           AND outcome.replied_at < $5::TIMESTAMPTZ AS replied,
         outcome.meeting_at >= lineage.created_at
           AND outcome.meeting_at < $5::TIMESTAMPTZ AS meeting,
         outcome.won_at >= lineage.created_at
           AND outcome.won_at < $5::TIMESTAMPTZ AS won
       FROM lineages lineage
       LEFT JOIN opportunity_outcome_state outcome
         ON outcome.opportunity_id = lineage.opportunity_id
        AND outcome.owner_id = lineage.owner_id
     ),
     quality_links AS (
       SELECT
         lineage.lineage_id,
         link.quality_snapshot_id
       FROM lineages lineage
       JOIN commercial_signal_quality_opportunity_lineage link
         ON link.opportunity_lineage_id = lineage.lineage_id
        AND link.candidate_id = lineage.candidate_id
        AND link.workspace_id = $2
        AND link.client_profile_id = $3
       JOIN commercial_signal_quality_snapshots quality
        ON quality.id = link.quality_snapshot_id
        AND quality.candidate_id = lineage.candidate_id
        AND quality.decision_at <= lineage.created_at
        AND lineage.created_at <= quality.valid_until
     ),
     quality_groups AS (
       SELECT DISTINCT evidence.evidence_independence_group
       FROM lineages lineage
       JOIN quality_links quality_link
         ON quality_link.lineage_id = lineage.lineage_id
       JOIN commercial_signal_quality_evidence evidence
         ON evidence.quality_snapshot_id = quality_link.quality_snapshot_id
        AND evidence.candidate_id = lineage.candidate_id
        AND evidence.workspace_id = $2
        AND evidence.client_profile_id = $3
        AND evidence.observed_at <= lineage.created_at
        AND evidence.decision_role = 'positive'
     ),
     latest_annotations AS (
       SELECT DISTINCT ON (annotation.lineage_id, annotation.reviewer_user_id)
         annotation.lineage_id,
         annotation.reviewer_user_id,
         annotation.label,
         annotation.reason_code
       FROM commercial_signal_annotations annotation
       JOIN lineages lineage ON lineage.lineage_id = annotation.lineage_id
       WHERE annotation.workspace_id = $2
         AND annotation.client_profile_id = $3
         AND annotation.created_at >= $4::TIMESTAMPTZ
         AND annotation.created_at < $5::TIMESTAMPTZ
       ORDER BY annotation.lineage_id, annotation.reviewer_user_id,
         annotation.annotation_generation DESC, annotation.id DESC
     ),
     review_flags AS (
       SELECT
         lineage.lineage_id,
         BOOL_AND(annotation.label IN ('strong', 'acceptable'))
           AND NOT BOOL_OR(annotation.reason_code = 'ordinary_hiring')
           AS strong_reviewed,
         BOOL_AND(annotation.reason_code = 'ordinary_hiring')
           AND NOT BOOL_OR(annotation.label IN ('strong', 'acceptable'))
           AS ordinary_hiring
       FROM lineages lineage
       JOIN latest_annotations annotation
         ON annotation.lineage_id = lineage.lineage_id
       GROUP BY lineage.lineage_id
     )
     SELECT
       (SELECT COUNT(*) FROM executions)::BIGINT AS "executionCount",
       (SELECT COUNT(*) FROM executions WHERE fetched_records = 0)::BIGINT
         AS "zeroResultExecutions",
       COALESCE((SELECT SUM(fetched_records) FROM executions), 0)::BIGINT
         AS "fetchedRecords",
       (SELECT COUNT(DISTINCT signal_id) FROM execution_signals)::BIGINT
         AS "uniqueEvents",
       (SELECT COUNT(DISTINCT organization_id) FROM execution_signals)::BIGINT
         AS "uniqueCompanies",
       (SELECT COUNT(DISTINCT company_event_id) FROM company_events)::BIGINT
         AS "newCompanyEvents",
       (SELECT COUNT(*) FROM quality_groups)::BIGINT AS "independentEvents",
       (SELECT COUNT(DISTINCT signal_episode_id) FROM episodes)::BIGINT
         AS "episodes",
       (SELECT COUNT(DISTINCT signal_episode_id) FROM lineages)::BIGINT
         AS "qualifiedEpisodes",
       (SELECT COUNT(*) FROM lineages)::BIGINT AS "qualifiedOpportunities",
       (SELECT COUNT(*)
        FROM lineages lineage
        JOIN opportunity_candidates candidate ON candidate.id = lineage.candidate_id
        JOIN signal_episodes episode
          ON episode.id = lineage.signal_episode_id
         AND episode.organization_id = lineage.organization_id
       WHERE candidate.status = 'qualified_actionable'
          AND episode.valid_until > $5::TIMESTAMPTZ)::BIGINT
         AS "actionableOpportunities",
       (SELECT COUNT(*) FROM review_flags WHERE strong_reviewed)::BIGINT
         AS "strongReviewedOpportunities",
       (SELECT COUNT(*) FROM review_flags WHERE ordinary_hiring)::BIGINT
         AS "ordinaryHiringOpportunities",
       (SELECT COUNT(*)
        FROM lineages lineage
        JOIN signal_episodes episode
          ON episode.id = lineage.signal_episode_id
         AND episode.organization_id = lineage.organization_id
        WHERE episode.valid_until <= $5::TIMESTAMPTZ)::BIGINT
         AS "staleOpportunities",
       (SELECT COUNT(*) FROM outcome_flags WHERE accepted)::BIGINT AS accepted,
       (SELECT COUNT(*) FROM outcome_flags WHERE contacted)::BIGINT AS contacted,
       (SELECT COUNT(*) FROM outcome_flags WHERE replied)::BIGINT AS replied,
       (SELECT COUNT(*) FROM outcome_flags WHERE meeting)::BIGINT AS meetings,
       (SELECT COUNT(*) FROM outcome_flags WHERE won)::BIGINT AS won`,
    [
      plan.planSnapshotId,
      plan.workspaceId,
      plan.clientProfileId,
      start.toISOString(),
      end.toISOString(),
    ],
  );
  const row = result.rows[0] ?? {};
  return {
    executionCount: count(row.executionCount),
    zeroResultExecutions: count(row.zeroResultExecutions),
    fetchedRecords: count(row.fetchedRecords),
    uniqueEvents: count(row.uniqueEvents),
    uniqueCompanies: count(row.uniqueCompanies),
    newCompanyEvents: count(row.newCompanyEvents),
    independentEvents: count(row.independentEvents),
    episodes: count(row.episodes),
    qualifiedEpisodes: count(row.qualifiedEpisodes),
    qualifiedOpportunities: count(row.qualifiedOpportunities),
    actionableOpportunities: count(row.actionableOpportunities),
    strongReviewedOpportunities: count(row.strongReviewedOpportunities),
    ordinaryHiringOpportunities: count(row.ordinaryHiringOpportunities),
    staleOpportunities: count(row.staleOpportunities),
    accepted: count(row.accepted),
    contacted: count(row.contacted),
    replied: count(row.replied),
    meetings: count(row.meetings),
    won: count(row.won),
  };
}

function computeRates(counts) {
  return {
    duplicateRate: rate(
      Math.max(0, counts.fetchedRecords - counts.uniqueEvents),
      counts.fetchedRecords,
    ),
    staleRate: rate(counts.staleOpportunities, counts.qualifiedOpportunities),
    zeroResultRate: rate(counts.zeroResultExecutions, counts.executionCount),
    qualifiedRate: rate(counts.qualifiedOpportunities, counts.episodes),
    acceptedRate: rate(counts.accepted, counts.qualifiedOpportunities),
    contactedRate: rate(counts.contacted, counts.qualifiedOpportunities),
    replyRate: rate(counts.replied, counts.contacted),
    meetingRate: rate(counts.meetings, counts.contacted),
    independentEventFetchRate: rate(
      counts.independentEvents,
      counts.fetchedRecords,
    ),
    episodeFetchRate: rate(counts.episodes, counts.fetchedRecords),
    qualifiedFetchRate: rate(
      counts.qualifiedOpportunities,
      counts.fetchedRecords,
    ),
    strongReviewedFetchRate: rate(
      counts.strongReviewedOpportunities,
      counts.fetchedRecords,
    ),
  };
}

function rate(numerator, denominator) {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * 10_000_000) / 10_000_000;
}

function count(value) {
  const number = Number(value ?? 0);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function positiveId(value, label) {
  const normalized = String(value ?? '').trim();
  if (!/^[1-9]\d{0,18}$/.test(normalized)
      || BigInt(normalized) > 9223372036854775807n) {
    throw new Error(`Invalid ${label} identifier.`);
  }
  return BigInt(normalized).toString();
}

function integerBetween(value, minimum, maximum, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return number;
}

function validDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid metric timestamp.');
  return date;
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.keys(value).sort().map(
    (key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`,
  );
  return `{${entries.join(',')}}`;
}

function errorCode(error) {
  const value = error instanceof Error ? `${error.name}:${error.message}` : String(error);
  return value.toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120) || 'METRIC_MATERIALIZATION_FAILED';
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const args = parseArgs(process.argv.slice(2));
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    console.error('DATABASE_URL is required.');
    process.exit(1);
  }
  try {
    const result = await materializeQueryPlanYield({
      connectionString,
      ...args,
    });
    console.log(JSON.stringify(result));
    if (result.failures.length > 0) process.exitCode = 2;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
