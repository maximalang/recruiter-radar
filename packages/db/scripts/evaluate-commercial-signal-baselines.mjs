import pg from 'pg';

const { Client } = pg;
const LABEL_RELEVANCE = Object.freeze({
  strong: 3,
  acceptable: 2,
  weak: 1,
  not_a_lead: 0,
});
const DEFAULT_REVIEW_SET = 'holdout';
const REVIEW_SETS = new Set(['training', 'holdout', 'production_shadow', 'canary']);

function parseArgs(argv) {
  const result = {
    workspaceId: null,
    reviewSet: DEFAULT_REVIEW_SET,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--workspace-id') result.workspaceId = argv[++index] ?? null;
    else if (arg === '--review-set') result.reviewSet = argv[++index] ?? null;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  result.workspaceId = positiveId(result.workspaceId, 'workspace');
  if (!REVIEW_SETS.has(result.reviewSet)) {
    throw new Error(`Invalid review set: ${result.reviewSet}`);
  }
  return result;
}

export async function evaluateCommercialSignalBaselines({
  connectionString,
  workspaceId,
  reviewSet = DEFAULT_REVIEW_SET,
}) {
  const normalizedWorkspaceId = positiveId(workspaceId, 'workspace');
  if (!REVIEW_SETS.has(reviewSet)) throw new Error(`Invalid review set: ${reviewSet}`);

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const sample = await loadEvaluationSample(client, normalizedWorkspaceId, reviewSet);
    const globalCounts = await loadGlobalReviewCounts(client, normalizedWorkspaceId);
    const validation = resolveValidationStatus(globalCounts);
    const baselines = [
      evaluateBaseline('vacancy_count', sample, (row) => row.vacancyCount),
      evaluateBaseline('freshness', sample, (row) => row.freshnessScore),
      evaluateBaseline('legacy_fiur', sample, (row) => row.legacyFiurScore),
      evaluateBaseline('opportunity_scoring_v2', sample, (row) => row.v2Score),
      evaluateBaseline('commercial_signal_v3', sample, (row) => row.v3Score),
    ];

    return {
      workspaceId: normalizedWorkspaceId,
      reviewSet,
      validationStatus: validation.status,
      validationReasonCodes: validation.reasonCodes,
      sample: {
        reviewedOpportunities: globalCounts.reviewedOpportunities,
        actionableReviewed: globalCounts.actionableReviewed,
        holdoutReviewed: globalCounts.holdoutReviewed,
        evaluatedRows: sample.length,
      },
      baselines,
      winner: validation.status === 'insufficient_sample'
        ? null
        : chooseWinner(baselines),
      note: validation.status === 'insufficient_sample'
        ? 'Ranking metrics are diagnostic only until the minimum real reviewed sample is satisfied.'
        : 'Winner is selected by Precision@10, then NDCG@10, then Precision@5. Conversion rates are descriptive outcomes, not model probabilities.',
    };
  } finally {
    await client.end();
  }
}

async function loadEvaluationSample(client, workspaceId, reviewSet) {
  const result = await client.query(
    `WITH latest_reviewer_annotations AS (
       SELECT DISTINCT ON (annotation.lineage_id, annotation.reviewer_user_id)
         annotation.lineage_id,
         annotation.reviewer_user_id,
         annotation.label,
         annotation.review_set,
         annotation.created_at
       FROM commercial_signal_annotations annotation
       WHERE annotation.workspace_id = $1
         AND annotation.review_set = $2
       ORDER BY
         annotation.lineage_id,
         annotation.reviewer_user_id,
         annotation.annotation_generation DESC,
         annotation.id DESC
     ),
     adjudicated AS (
       SELECT
         lineage_id,
         AVG(CASE label
           WHEN 'strong' THEN 3
           WHEN 'acceptable' THEN 2
           WHEN 'weak' THEN 1
           WHEN 'not_a_lead' THEN 0
         END)::DOUBLE PRECISION AS relevance
       FROM latest_reviewer_annotations
       GROUP BY lineage_id
     ),
     outcomes AS (
       SELECT
         lineage.opportunity_id,
         BOOL_OR(event.event_type = 'accepted') AS accepted,
         BOOL_OR(event.event_type = 'contacted') AS contacted,
         BOOL_OR(event.event_type = 'replied') AS replied,
         BOOL_OR(event.event_type = 'meeting') AS meeting
       FROM commercial_signal_opportunity_lineage lineage
       LEFT JOIN opportunity_outcome_events event
         ON event.opportunity_id = lineage.opportunity_id
       WHERE lineage.workspace_id = $1
       GROUP BY lineage.opportunity_id
     )
     SELECT
       lineage.id::TEXT AS "lineageId",
       adjudicated.relevance,
       compatibility.vacancy_count::DOUBLE PRECISION AS "vacancyCount",
       GREATEST(
         0::DOUBLE PRECISION,
         1 - EXTRACT(EPOCH FROM (NOW() - signal_episode.last_seen_at)) /
           (30 * 24 * 60 * 60)::DOUBLE PRECISION
       ) AS "freshnessScore",
       CASE
         WHEN opportunity.metadata ? 'fiurScore'
           AND (opportunity.metadata->>'fiurScore') ~ '^-?[0-9]+([.][0-9]+)?$'
         THEN (opportunity.metadata->>'fiurScore')::DOUBLE PRECISION
         WHEN opportunity.metadata ? 'fiur_score'
           AND (opportunity.metadata->>'fiur_score') ~ '^-?[0-9]+([.][0-9]+)?$'
         THEN (opportunity.metadata->>'fiur_score')::DOUBLE PRECISION
         ELSE NULL
       END AS "legacyFiurScore",
       (
         SELECT previous.opportunity_score::DOUBLE PRECISION
         FROM opportunities previous
         WHERE previous.workspace_id = lineage.workspace_id
           AND previous.client_profile_id = lineage.client_profile_id
           AND previous.organization_id = lineage.organization_id
           AND previous.scoring_version = 'opportunity-v2'
         ORDER BY previous.valid_from DESC NULLS LAST, previous.id DESC
         LIMIT 1
       ) AS "v2Score",
       candidate.ranking_score::DOUBLE PRECISION AS "v3Score",
       candidate.status AS "candidateStatus",
       COALESCE(outcomes.accepted, FALSE) AS accepted,
       COALESCE(outcomes.contacted, FALSE) AS contacted,
       COALESCE(outcomes.replied, FALSE) AS replied,
       COALESCE(outcomes.meeting, FALSE) AS meeting
     FROM adjudicated
     JOIN commercial_signal_opportunity_lineage lineage
       ON lineage.id = adjudicated.lineage_id
     JOIN opportunity_candidates candidate
       ON candidate.id = lineage.candidate_id
     JOIN signal_episodes signal_episode
       ON signal_episode.id = lineage.signal_episode_id
      AND signal_episode.organization_id = lineage.organization_id
     JOIN hiring_episodes compatibility
       ON compatibility.id = lineage.compatibility_hiring_episode_id
      AND compatibility.organization_id = lineage.organization_id
     JOIN opportunities opportunity
       ON opportunity.id = lineage.opportunity_id
     LEFT JOIN outcomes ON outcomes.opportunity_id = lineage.opportunity_id
     WHERE lineage.workspace_id = $1`,
    [workspaceId, reviewSet],
  );

  return result.rows.map((row) => ({
    lineageId: positiveId(row.lineageId, 'lineage'),
    relevance: finiteNumber(row.relevance, 'relevance'),
    vacancyCount: nullableFiniteNumber(row.vacancyCount),
    freshnessScore: nullableFiniteNumber(row.freshnessScore),
    legacyFiurScore: nullableFiniteNumber(row.legacyFiurScore),
    v2Score: nullableFiniteNumber(row.v2Score),
    v3Score: nullableFiniteNumber(row.v3Score),
    candidateStatus: String(row.candidateStatus ?? ''),
    accepted: row.accepted === true,
    contacted: row.contacted === true,
    replied: row.replied === true,
    meeting: row.meeting === true,
  }));
}

async function loadGlobalReviewCounts(client, workspaceId) {
  const result = await client.query(
    `WITH latest_reviewer_annotations AS (
       SELECT DISTINCT ON (annotation.lineage_id, annotation.reviewer_user_id)
         annotation.lineage_id,
         annotation.reviewer_user_id,
         annotation.label,
         annotation.review_set
       FROM commercial_signal_annotations annotation
       WHERE annotation.workspace_id = $1
       ORDER BY
         annotation.lineage_id,
         annotation.reviewer_user_id,
         annotation.annotation_generation DESC,
         annotation.id DESC
     ),
     reviewed AS (
       SELECT
         lineage_id,
         BOOL_OR(review_set = 'holdout') AS in_holdout,
         BOOL_OR(label IN ('strong', 'acceptable')) AS positive
       FROM latest_reviewer_annotations
       GROUP BY lineage_id
     )
     SELECT
       COUNT(*)::INTEGER AS "reviewedOpportunities",
       COUNT(*) FILTER (
         WHERE reviewed.positive
           AND candidate.status = 'qualified_actionable'
       )::INTEGER AS "actionableReviewed",
       COUNT(*) FILTER (WHERE reviewed.in_holdout)::INTEGER AS "holdoutReviewed"
     FROM reviewed
     JOIN commercial_signal_opportunity_lineage lineage
       ON lineage.id = reviewed.lineage_id
     JOIN opportunity_candidates candidate
       ON candidate.id = lineage.candidate_id`,
    [workspaceId],
  );
  return {
    reviewedOpportunities: count(result.rows[0]?.reviewedOpportunities),
    actionableReviewed: count(result.rows[0]?.actionableReviewed),
    holdoutReviewed: count(result.rows[0]?.holdoutReviewed),
  };
}

export function evaluateBaseline(name, sample, scoreFn) {
  const scored = sample
    .map((row) => ({ ...row, score: scoreFn(row) }))
    .filter((row) => Number.isFinite(row.score))
    .sort((left, right) => right.score - left.score || left.lineageId.localeCompare(right.lineageId));
  if (scored.length === 0) {
    return {
      name,
      status: 'unavailable',
      reasonCode: 'NO_COMPARABLE_PERSISTED_SCORE',
      sampleSize: 0,
      precisionAt5: null,
      precisionAt10: null,
      ndcgAt10: null,
      acceptedRate: null,
      contactedRate: null,
      replyRate: null,
      meetingRate: null,
    };
  }
  return {
    name,
    status: 'available',
    reasonCode: null,
    sampleSize: scored.length,
    precisionAt5: precisionAt(scored, 5),
    precisionAt10: precisionAt(scored, 10),
    ndcgAt10: ndcgAt(scored, 10),
    acceptedRate: booleanRate(scored, 'accepted'),
    contactedRate: booleanRate(scored, 'contacted'),
    replyRate: conditionalBooleanRate(scored, 'replied', 'contacted'),
    meetingRate: conditionalBooleanRate(scored, 'meeting', 'contacted'),
  };
}

export function precisionAt(scored, k) {
  const top = scored.slice(0, Math.min(k, scored.length));
  if (top.length === 0) return null;
  return round(top.filter((row) => row.relevance >= 2).length / top.length);
}

export function ndcgAt(scored, k) {
  const top = scored.slice(0, Math.min(k, scored.length));
  if (top.length === 0) return null;
  const dcg = discountedGain(top.map((row) => row.relevance));
  const ideal = discountedGain(
    scored.map((row) => row.relevance).sort((left, right) => right - left).slice(0, top.length),
  );
  return ideal > 0 ? round(dcg / ideal) : 0;
}

function discountedGain(relevances) {
  return relevances.reduce((sum, relevance, index) =>
    sum + ((2 ** relevance) - 1) / Math.log2(index + 2), 0);
}

function booleanRate(rows, key) {
  if (rows.length === 0) return null;
  return round(rows.filter((row) => row[key] === true).length / rows.length);
}

function conditionalBooleanRate(rows, numeratorKey, denominatorKey) {
  const denominator = rows.filter((row) => row[denominatorKey] === true);
  if (denominator.length === 0) return null;
  return round(
    denominator.filter((row) => row[numeratorKey] === true).length / denominator.length,
  );
}

function resolveValidationStatus(counts) {
  const reasonCodes = [];
  if (counts.reviewedOpportunities < 100) reasonCodes.push('REVIEWED_LT_100');
  if (counts.actionableReviewed < 30) reasonCodes.push('ACTIONABLE_REVIEWED_LT_30');
  if (counts.holdoutReviewed < 1) reasonCodes.push('HOLDOUT_EMPTY');
  return reasonCodes.length > 0
    ? { status: 'insufficient_sample', reasonCodes }
    : { status: 'shadow_validated', reasonCodes: [] };
}

function chooseWinner(baselines) {
  const available = baselines.filter((baseline) => baseline.status === 'available');
  if (available.length === 0) return null;
  return [...available].sort((left, right) =>
    compareNullable(right.precisionAt10, left.precisionAt10)
    || compareNullable(right.ndcgAt10, left.ndcgAt10)
    || compareNullable(right.precisionAt5, left.precisionAt5)
    || left.name.localeCompare(right.name))[0].name;
}

function compareNullable(left, right) {
  return (left ?? -1) - (right ?? -1);
}

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Invalid ${label}.`);
  return number;
}

function nullableFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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

function round(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const args = parseArgs(process.argv.slice(2));
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    console.error('DATABASE_URL is required.');
    process.exit(1);
  }
  try {
    const result = await evaluateCommercialSignalBaselines({
      connectionString,
      ...args,
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
