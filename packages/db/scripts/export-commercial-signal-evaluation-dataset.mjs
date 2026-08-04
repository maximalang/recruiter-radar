import { createHmac } from 'node:crypto'

import pg from 'pg'

import { COMMERCIAL_SIGNAL_DATASET_SCHEMA } from './lib/commercial-signal-evaluation.mjs'

const { Pool } = pg
const args = process.argv.slice(2)
const workspaceId = positiveInteger(optionValue(args, '--workspace-id'), 'workspace-id')
const kind = optionValue(args, '--kind')
if (!['anonymized_labeled', 'holdout', 'production_shadow'].includes(kind)) {
  throw new TypeError(
    '--kind must be anonymized_labeled, holdout, or production_shadow.',
  )
}
const from = isoTimestamp(optionValue(args, '--from'), 'from')
const to = isoTimestamp(optionValue(args, '--to'), 'to')
if (Date.parse(to) <= Date.parse(from)) {
  throw new TypeError('--to must be later than --from.')
}
const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is required.')
const anonymizationKey = process.env.EVALUATION_ANONYMIZATION_KEY ?? ''
if (anonymizationKey.length < 32) {
  throw new Error('EVALUATION_ANONYMIZATION_KEY must contain at least 32 characters.')
}

const pool = new Pool({ connectionString, max: 1 })
const client = await pool.connect()
try {
  await client.query('BEGIN TRANSACTION READ ONLY')
  await client.query("SET LOCAL statement_timeout = '30s'")
  const rawRows = kind === 'production_shadow'
    ? await productionShadowRows(client, workspaceId, from, to)
    : await labeledOpportunityRows(client, workspaceId, from, to)
  await client.query('COMMIT')
  if (rawRows.length > 5_000) {
    throw new Error('Evaluation export exceeds the 5,000-row safety limit.')
  }
  const transformed = rawRows.map((row) => anonymizeRow(row, kind, anonymizationKey))
  const rows = kind === 'holdout'
    ? transformed.filter((row) => splitBucket(row.sampleKey) === 0)
    : kind === 'anonymized_labeled'
      ? transformed.filter((row) => splitBucket(row.sampleKey) !== 0)
      : transformed
  const workspaceKey = pseudonym(anonymizationKey, `workspace:${workspaceId}`)
  const status = rows.length > 0 ? 'ready' : 'unavailable'
  process.stdout.write(`${JSON.stringify({
    schemaVersion: COMMERCIAL_SIGNAL_DATASET_SCHEMA,
    datasetId: `${kind}-${workspaceKey.slice(0, 12)}`,
    datasetVersion: `${from.slice(0, 10)}_${to.slice(0, 10)}-v1`,
    kind,
    status,
    provenance: 'anonymized_real',
    splitGroup: splitGroup(kind),
    exclusionSplitGroups: kind === 'holdout'
      ? ['labeled-real', 'production-shadow'] : [],
    minimumSample: 30,
    minimumLabeled: 10,
    ...(status === 'unavailable' ? {
      unavailableReason: 'No rows matched the workspace, time window, and split.',
    } : {}),
    limitations: limitations(kind),
    rows,
  }, null, 2)}\n`)
} catch (error) {
  await client.query('ROLLBACK').catch(() => {})
  throw error
} finally {
  client.release()
  await pool.end()
}

async function labeledOpportunityRows(client, workspaceId, from, to) {
  const result = await client.query(`
    WITH latest_v2 AS (
      SELECT DISTINCT ON (
        snapshot.client_profile_id,
        snapshot.hiring_episode_id
      )
        snapshot.client_profile_id AS "profileId",
        snapshot.owner_id AS "ownerId",
        snapshot.hiring_episode_id AS "episodeId",
        snapshot.opportunity_id AS "opportunityId",
        snapshot.ranking_score::DOUBLE PRECISION AS "opportunityV2",
        opportunity.metadata,
        episode.episode_type AS "episodeType",
        episode.last_seen_at::TEXT AS "observedAt",
        episode.vacancy_count AS "vacancyCount"
      FROM opportunity_scoring_snapshots snapshot
      JOIN opportunities opportunity
        ON opportunity.id = snapshot.opportunity_id
       AND opportunity.workspace_id = snapshot.workspace_id
       AND opportunity.client_profile_id = snapshot.client_profile_id
      JOIN hiring_episodes episode
        ON episode.id = snapshot.hiring_episode_id
       AND episode.organization_id = opportunity.organization_id
      WHERE snapshot.workspace_id = $1
        AND snapshot.scoring_version = 'opportunity-v2'
        AND episode.last_seen_at >= $2::TIMESTAMPTZ
        AND episode.last_seen_at < $3::TIMESTAMPTZ
      ORDER BY
        snapshot.client_profile_id,
        snapshot.hiring_episode_id,
        snapshot.created_at DESC,
        snapshot.id DESC
    )
    SELECT
      latest."profileId"::TEXT AS "profileId",
      latest."ownerId"::TEXT AS "ownerId",
      latest."episodeId"::TEXT AS "episodeId",
      latest."opportunityId"::TEXT AS "opportunityId",
      latest."opportunityV2",
      latest."episodeType",
      latest."observedAt",
      latest."vacancyCount",
      CASE
        WHEN COALESCE(latest.metadata #>> '{fiur,total}', '')
          ~ '^[0-9]+(\\.[0-9]+)?$'
        THEN (latest.metadata #>> '{fiur,total}')::DOUBLE PRECISION
        ELSE NULL
      END AS "oldFiur",
      CASE
        WHEN JSONB_TYPEOF(latest.metadata->'sourceFamilies') = 'array'
        THEN latest.metadata->'sourceFamilies'
        ELSE '[]'::JSONB
      END AS "sourceFamilies",
      outcome.accepted_at IS NOT NULL AS accepted,
      outcome.contacted_at IS NOT NULL AS contacted,
      outcome.replied_at IS NOT NULL AS replied,
      outcome.meeting_at IS NOT NULL AS meeting,
      outcome.dismiss_reason_code AS "dismissReasonCode",
      outcome.lost_reason_code AS "lostReasonCode",
      outcome.owner_id IS NOT NULL AS "hasOutcome"
    FROM latest_v2 latest
    LEFT JOIN opportunity_outcome_state outcome
      ON outcome.opportunity_id = latest."opportunityId"
     AND outcome.client_profile_id = latest."profileId"
     AND outcome.owner_id = latest."ownerId"
    ORDER BY latest."profileId", latest."episodeId", latest."opportunityId"
    LIMIT 5001
  `, [workspaceId, from, to])
  return result.rows
}

async function productionShadowRows(client, workspaceId, from, to) {
  const result = await client.query(`
    SELECT DISTINCT ON (
      candidate.client_profile_id,
      candidate.organization_id,
      candidate.candidate_identity
    )
      candidate.client_profile_id::TEXT AS "profileId",
      candidate.signal_episode_id::TEXT AS "episodeId",
      candidate.id::TEXT AS "opportunityId",
      episode.episode_type AS "episodeType",
      candidate.feature_snapshot #>> '{quality,episodeLastSeenAt}'
        AS "observedAt",
      NULL::INTEGER AS "vacancyCount",
      NULL::DOUBLE PRECISION AS "oldFiur",
      NULL::DOUBLE PRECISION AS "opportunityV2",
      candidate.ranking_score::DOUBLE PRECISION AS "opportunityV3",
      COALESCE(candidate.evidence_snapshot->'evidenceSourceFamilies', '[]'::JSONB)
        AS "sourceFamilies",
      NULL::BOOLEAN AS accepted,
      NULL::BOOLEAN AS contacted,
      NULL::BOOLEAN AS replied,
      NULL::BOOLEAN AS meeting,
      NULL::TEXT AS "dismissReasonCode",
      NULL::TEXT AS "lostReasonCode",
      FALSE AS "hasOutcome"
    FROM opportunity_candidates candidate
    JOIN signal_episodes episode
      ON episode.id = candidate.signal_episode_id
     AND episode.organization_id = candidate.organization_id
    WHERE candidate.workspace_id = $1
      AND candidate.rollout_mode = 'shadow'
      AND candidate.created_at >= $2::TIMESTAMPTZ
      AND candidate.created_at < $3::TIMESTAMPTZ
    ORDER BY
      candidate.client_profile_id,
      candidate.organization_id,
      candidate.candidate_identity,
      candidate.candidate_generation DESC,
      candidate.id DESC
    LIMIT 5001
  `, [workspaceId, from, to])
  return result.rows
}

function anonymizeRow(row, kind, key) {
  const sampleKey = pseudonym(
    key,
    `profile:${row.profileId}:episode:${row.episodeId}:item:${row.opportunityId}`,
  )
  const hasOutcome = row.hasOutcome === true
  const progressed = row.accepted === true || row.contacted === true ||
    row.replied === true || row.meeting === true
  const category = progressed ? null : mapFalsePositiveReason(
    row.dismissReasonCode ?? row.lostReasonCode,
  )
  return {
    sampleKey,
    agencyProfileKey: pseudonym(key, `profile:${row.profileId}`),
    episodeType: safeIdentifier(row.episodeType, 'unknown'),
    sourceFamilies: jsonStringArray(row.sourceFamilies),
    queryPlanKey: null,
    observedAt: new Date(row.observedAt).toISOString(),
    vacancyCount: row.vacancyCount == null ? null : Number(row.vacancyCount),
    scores: {
      oldFiur: finiteOrNull(row.oldFiur),
      opportunityV2: finiteOrNull(row.opportunityV2),
      opportunityV3: finiteOrNull(row.opportunityV3),
    },
    labels: {
      qualified: kind === 'production_shadow' ? null
        : progressed ? true : category ? false : null,
      accepted: hasOutcome ? row.accepted === true : null,
      contacted: hasOutcome ? row.contacted === true : null,
      replied: hasOutcome ? row.replied === true : null,
      meeting: hasOutcome ? row.meeting === true : null,
      falsePositiveCategory: category,
    },
  }
}

function mapFalsePositiveReason(reason) {
  const mappings = {
    bad_fit: 'weak_agency_fit',
    wrong_roles: 'wrong_role',
    wrong_industry: 'weak_agency_fit',
    wrong_region: 'wrong_region',
    company_too_small: 'weak_agency_fit',
    company_too_large: 'weak_agency_fit',
    low_commercial_value: 'bad_economics',
    internal_recruitment_only: 'internal_only',
    no_external_need_signal: 'weak_external_need',
    weak_evidence: 'unverified_company',
    duplicate: 'duplicate_event',
    wrong_timing: 'stale_signal',
    internal_team: 'internal_only',
    price: 'bad_economics',
    no_budget: 'bad_economics',
    procurement_block: 'bad_economics',
    position_closed: 'stale_signal',
  }
  return mappings[reason] ?? null
}

function pseudonym(key, value) {
  return createHmac('sha256', key).update(value).digest('hex')
}

function splitBucket(sampleKey) {
  return Number.parseInt(sampleKey.slice(0, 8), 16) % 5
}

function splitGroup(kind) {
  if (kind === 'holdout') return 'holdout-real'
  if (kind === 'production_shadow') return 'production-shadow'
  return 'labeled-real'
}

function limitations(kind) {
  const common = [
    'Identifiers are keyed pseudonyms; no company or contact identity is exported.',
    'The exporter is read-only and workspace scoped.',
    'Missing values remain null and are not inferred as zero.',
  ]
  if (kind === 'production_shadow') return [
    ...common,
    'V3 shadow candidates are not joined to legacy outcomes without an explicit lineage key.',
    'Shadow rows do not constitute rollout or canary acceptance.',
  ]
  return [
    ...common,
    'Legacy outcome reasons are mapped only when they have an unambiguous taxonomy category.',
    'V3 remains null until a reviewed cross-version lineage contract exists.',
  ]
}

function jsonStringArray(value) {
  const input = Array.isArray(value) ? value : []
  return [...new Set(input.map((item) => String(item).trim().toLowerCase())
    .filter((item) => /^[a-z0-9][a-z0-9._-]{0,127}$/.test(item)))]
    .sort()
}

function safeIdentifier(value, fallback) {
  const normalized = String(value ?? '').trim().toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '')
    .slice(0, 128)
  return normalized || fallback
}

function finiteOrNull(value) {
  if (value == null) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function positiveInteger(value, label) {
  if (!/^\d+$/.test(String(value ?? ''))) {
    throw new TypeError(`--${label} must be a positive integer.`)
  }
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError(`--${label} must be a positive safe integer.`)
  }
  return number
}

function isoTimestamp(value, label) {
  const parsed = Date.parse(String(value ?? ''))
  if (!Number.isFinite(parsed)) throw new TypeError(`--${label} is invalid.`)
  return new Date(parsed).toISOString()
}

function optionValue(input, name) {
  const index = input.indexOf(name)
  return index >= 0 ? input[index + 1] : null
}
