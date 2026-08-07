import pg from 'pg';

const { Client } = pg;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function parseArgs(argv) {
  const result = { workspaceId: null, limit: DEFAULT_LIMIT };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--workspace-id') result.workspaceId = argv[++index] ?? null;
    else if (arg === '--limit') result.limit = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  result.workspaceId = positiveId(result.workspaceId, 'workspace');
  result.limit = integerBetween(result.limit, 1, MAX_LIMIT, 'limit');
  return result;
}

export async function loadCommercialSignalTopReview({
  connectionString,
  workspaceId,
  limit = DEFAULT_LIMIT,
  now = new Date(),
}) {
  const normalizedWorkspaceId = positiveId(workspaceId, 'workspace');
  const boundedLimit = integerBetween(limit, 1, MAX_LIMIT, 'limit');
  const evaluationTime = validDate(now);
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query(
      `WITH current_lineage AS (
         SELECT DISTINCT ON (
           lineage.workspace_id,
           lineage.client_profile_id,
           lineage.organization_id
         )
           lineage.*
         FROM commercial_signal_opportunity_lineage lineage
         JOIN opportunity_candidates candidate ON candidate.id = lineage.candidate_id
         WHERE lineage.workspace_id = $1
           AND candidate.status IN ('qualified_actionable', 'qualified_needs_enrichment')
           AND candidate.valid_until > $2::TIMESTAMPTZ
         ORDER BY
           lineage.workspace_id,
           lineage.client_profile_id,
           lineage.organization_id,
           candidate.ranking_score DESC,
           candidate.candidate_generation DESC,
           lineage.id DESC
       )
       SELECT
         lineage.id::TEXT AS "lineageId",
         lineage.workspace_id::TEXT AS "workspaceId",
         lineage.client_profile_id::TEXT AS "clientProfileId",
         lineage.organization_id::TEXT AS "organizationId",
         org.name AS "organizationName",
         candidate.id::TEXT AS "candidateId",
         candidate.candidate_identity AS "candidateIdentity",
         candidate.candidate_generation AS "candidateGeneration",
         candidate.status AS "candidateStatus",
         candidate.ranking_score::DOUBLE PRECISION AS "rankingScore",
         candidate.quality_score::DOUBLE PRECISION AS "qualityScore",
         candidate.actionability_score::DOUBLE PRECISION AS "actionabilityScore",
         candidate.valid_until::TEXT AS "validUntil",
         episode.id::TEXT AS "signalEpisodeId",
         episode.episode_identity AS "signalEpisodeIdentity",
         episode.episode_generation AS "signalEpisodeGeneration",
         episode.episode_type AS "signalEpisodeType",
         episode.stage AS "signalEpisodeStage",
         episode.first_seen_at::TEXT AS "episodeFirstSeenAt",
         episode.last_seen_at::TEXT AS "episodeLastSeenAt",
         episode.valid_until::TEXT AS "episodeValidUntil",
         thesis.thesis_type AS "commercialThesisType",
         thesis.summary AS "commercialThesisSummary",
         propensity.propensity_band AS "externalAgencyPropensityBand",
         propensity.reason_codes AS "propensityReasonCodes",
         dna.match_band AS "agencyDnaMatchBand",
         dna.reason_codes AS "agencyDnaReasonCodes",
         lineage.commercial_signal_card AS "commercialSignalCard",
         COALESCE((
           SELECT JSONB_AGG(
             JSONB_BUILD_OBJECT(
               'planSnapshotId', query_link.plan_snapshot_id::TEXT,
               'source', plan.source,
               'roleFamily', plan.role_family,
               'region', plan.region_snapshot,
               'queryEnv', plan.query_env,
               'reasonCodes', plan.reason_codes,
               'sharedRequestHash', plan.shared_request_hash
             ) ORDER BY query_link.plan_snapshot_id
           )
           FROM commercial_signal_opportunity_query_plans query_link
           JOIN query_plan_snapshots plan ON plan.id = query_link.plan_snapshot_id
           WHERE query_link.lineage_id = lineage.id
         ), '[]'::JSONB) AS "queryPlans",
         COALESCE((
           SELECT JSONB_AGG(
             JSONB_BUILD_OBJECT(
               'eventId', event.id::TEXT,
               'eventType', event.event_type,
               'occurredAt', event.occurred_at,
               'payload', event.payload,
               'evidenceIds', event.evidence_ids
             ) ORDER BY event.occurred_at, event.id
           )
           FROM signal_episode_events episode_event
           JOIN company_events event
             ON event.id = episode_event.company_event_id
            AND event.organization_id = episode_event.organization_id
           WHERE episode_event.signal_episode_id = episode.id
         ), '[]'::JSONB) AS "companyEvents",
         COALESCE((
           SELECT JSONB_AGG(
             JSONB_BUILD_OBJECT(
               'evidenceId', evidence.id::TEXT,
               'source', evidence.source,
               'url', evidence.url,
               'fetchedAt', evidence.fetched_at,
               'tier', evidence.tier
             ) ORDER BY evidence.id
           )
           FROM evidence_items evidence
           WHERE evidence.id = ANY(episode.evidence_ids)
         ), '[]'::JSONB) AS evidence,
         COALESCE((
           SELECT JSONB_AGG(
             JSONB_BUILD_OBJECT(
               'label', annotation.label,
               'reasonCode', annotation.reason_code,
               'reviewSet', annotation.review_set,
               'reviewerUserId', annotation.reviewer_user_id::TEXT,
               'generation', annotation.annotation_generation,
               'createdAt', annotation.created_at
             ) ORDER BY annotation.created_at DESC, annotation.id DESC
           )
           FROM commercial_signal_annotations annotation
           WHERE annotation.lineage_id = lineage.id
         ), '[]'::JSONB) AS annotations
       FROM current_lineage lineage
       JOIN opportunity_candidates candidate ON candidate.id = lineage.candidate_id
       JOIN signal_episodes episode ON episode.id = lineage.signal_episode_id
       JOIN orgs org ON org.id = lineage.organization_id
       LEFT JOIN commercial_theses thesis
         ON thesis.id = candidate.commercial_thesis_id
       LEFT JOIN external_agency_propensity_snapshots propensity
         ON propensity.id = candidate.external_agency_propensity_snapshot_id
       LEFT JOIN agency_dna_match_snapshots dna
         ON dna.id = candidate.agency_dna_match_snapshot_id
       ORDER BY candidate.ranking_score DESC, lineage.id DESC
       LIMIT $3`,
      [normalizedWorkspaceId, evaluationTime.toISOString(), boundedLimit],
    );

    return {
      workspaceId: normalizedWorkspaceId,
      generatedAt: evaluationTime.toISOString(),
      count: result.rows.length,
      opportunities: result.rows,
    };
  } finally {
    await client.end();
  }
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
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid review timestamp.');
  return date;
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const args = parseArgs(process.argv.slice(2));
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    console.error('DATABASE_URL is required.');
    process.exit(1);
  }
  try {
    const result = await loadCommercialSignalTopReview({
      connectionString,
      ...args,
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
