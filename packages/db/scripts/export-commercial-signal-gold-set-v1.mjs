import fs from 'node:fs/promises'
import path from 'node:path'
import pg from 'pg'
import {
  SAMPLING_POLICY,
  buildBlindReviewPackage,
  buildGoldSetDataset,
  renderLabelTemplateCsv,
  renderReviewCsv,
  renderReviewHtml,
  serializeDatasetJsonl,
} from './lib/commercial-signal-gold-set-v1.mjs'

const { Pool } = pg
const args = process.argv.slice(2)
const workspaceId = required('--workspace-id')
const profileId = required('--profile-id')
const from = required('--from')
const to = required('--to')
const datasetVersion = required('--dataset-version')
const samplingPolicy = required('--sampling-policy')
const seed = required('--seed')
const outputDir = path.resolve(required('--output-dir'))
if (samplingPolicy !== SAMPLING_POLICY) {
  throw new TypeError(`--sampling-policy must be ${SAMPLING_POLICY}`)
}
const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is required.')
const anonymizationKey = process.env.EVALUATION_ANONYMIZATION_KEY ?? ''
if (anonymizationKey.length < 32) {
  throw new Error('EVALUATION_ANONYMIZATION_KEY must contain at least 32 characters.')
}

await fs.mkdir(outputDir, { recursive: false }).catch((error) => {
  if (error?.code === 'EEXIST') {
    throw new Error('Output directory already exists; frozen review exports are append-by-new-version, never overwritten.')
  }
  throw error
})
const pool = new Pool({ connectionString, max: 1 })
const client = await pool.connect()
try {
  await client.query('BEGIN TRANSACTION READ ONLY')
  await client.query("SET LOCAL statement_timeout = '30s'")
  const rawRows = await exactRows(client, workspaceId, profileId, from, to)
  await client.query('COMMIT')
  if (rawRows.length > 5_000) {
    throw new Error('Gold-set export exceeds the 5,000-row safety limit.')
  }
  const dataset = buildGoldSetDataset(rawRows, {
    workspaceId, profileId, from, to, datasetVersion, samplingPolicy, seed,
    anonymizationKey, createdAt: to,
  })
  const review = buildBlindReviewPackage(dataset)
  await Promise.all([
    fs.writeFile(path.join(outputDir, 'frozen.jsonl'), serializeDatasetJsonl(dataset), { flag: 'wx' }),
    fs.writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify(dataset.manifest, null, 2)}\n`, { flag: 'wx' }),
    fs.writeFile(path.join(outputDir, 'review.json'), `${JSON.stringify(review, null, 2)}\n`, { flag: 'wx' }),
    fs.writeFile(path.join(outputDir, 'review.csv'), renderReviewCsv(review), { flag: 'wx' }),
    fs.writeFile(path.join(outputDir, 'review.html'), renderReviewHtml(review), { flag: 'wx' }),
    fs.writeFile(path.join(outputDir, 'labels.csv'), renderLabelTemplateCsv(review), { flag: 'wx' }),
  ])
  process.stdout.write(`${JSON.stringify({
    ok:true,
    status:'READY_FOR_HUMAN_LABELING',
    outputDir,
    datasetVersion,
    sampleCount:dataset.rows.length,
    frozenFingerprint:dataset.manifest.frozenFingerprint,
    reviewerFile:'review.html',
    labelFile:'labels.csv',
    productionWrites:false,
  })}\n`)
} catch (error) {
  await client.query('ROLLBACK').catch(() => {})
  await fs.rm(outputDir, { recursive:true, force:true }).catch(() => {})
  throw error
} finally {
  client.release()
  await pool.end()
}

async function exactRows(client, workspaceId, profileId, from, to) {
  const result = await client.query(`
    SELECT
      quality.workspace_id::TEXT AS "workspaceId",
      quality.client_profile_id::TEXT AS "profileId",
      quality.organization_id::TEXT AS "organizationId",
      quality.id::TEXT AS "qualitySnapshotId",
      quality.candidate_id::TEXT AS "candidateId",
      candidate.candidate_generation AS "candidateGeneration",
      lineage.opportunity_lineage_id::TEXT AS "opportunityLineageId",
      quality.decision_at::TEXT AS "decisionAt",
      candidate.score_version AS "opportunityV3Version",
      candidate.ranking_score::DOUBLE PRECISION AS "opportunityV3Score",
      candidate.status AS "opportunityV3Status",
      0 AS "opportunityV3UnknownFeatureCount",
      quality.feature_version AS "qualityVersion",
      quality.quality_generation AS "qualityGeneration",
      quality.quality_identity AS "qualityIdentity",
      quality.quality_score::DOUBLE PRECISION AS "qualityScore",
      COALESCE(quality.feature_snapshot->>'status', 'review') AS "qualityStatus",
      quality.quality_coverage::DOUBLE PRECISION AS "qualityCoverage",
      quality.quality_confidence::DOUBLE PRECISION AS "qualityConfidence",
      quality.components AS "qualityComponents",
      quality.reason_codes AS "qualityReasonCodes",
      quality.feature_snapshot AS "qualityFeatureSnapshot",
      COALESCE(candidate.evidence_snapshot->'evidenceIds', '[]'::JSONB) AS "candidateEvidenceIds",
      JSONB_SET(
        JSONB_SET(
          JSONB_SET(
            candidate.feature_snapshot,
            '{evidenceSourceFamilies}',
            COALESCE(candidate.evidence_snapshot->'evidenceSourceFamilies', '[]'::JSONB),
            TRUE
          ),
          '{directEvidenceCount}',
          TO_JSONB(COALESCE((candidate.evidence_snapshot->>'directEvidenceCount')::INTEGER, 0)),
          TRUE
        ),
        '{corroborationEvidenceCount}',
        TO_JSONB(COALESCE((candidate.evidence_snapshot->>'corroborationEvidenceCount')::INTEGER, 0)),
        TRUE
      ) AS "candidateFeatureSnapshot",
      JSONB_BUILD_OBJECT(
        'targetCity', profile.target_city,
        'specialization', profile.specialization,
        'roles', profile.roles,
        'industries', profile.industries,
        'companySizes', profile.company_sizes,
        'excludedIndustries', profile.excluded_industries,
        'excludedLocations', profile.excluded_locations,
        'remoteFriendly', profile.remote_friendly,
        'hiringMode', profile.hiring_mode,
        'contactPolicy', profile.contact_policy
      ) AS "agencyProfile",
      COALESCE(evidence.rows, '[]'::JSONB) AS evidence
    FROM commercial_signal_quality_snapshots quality
    JOIN commercial_signal_quality_opportunity_lineage lineage
      ON lineage.quality_snapshot_id = quality.id
     AND lineage.candidate_id = quality.candidate_id
     AND lineage.workspace_id = quality.workspace_id
     AND lineage.client_profile_id = quality.client_profile_id
    JOIN opportunity_candidates candidate
      ON candidate.id = quality.candidate_id
     AND candidate.organization_id = quality.organization_id
     AND candidate.workspace_id = quality.workspace_id
     AND candidate.client_profile_id = quality.client_profile_id
    JOIN client_profiles profile
      ON profile.id = quality.client_profile_id
     AND profile.owner_id = candidate.owner_id
    LEFT JOIN LATERAL (
      SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
        'evidenceId', item.evidence_id::TEXT,
        'decisionRole', item.decision_role,
        'sourceKind', item.source_kind,
        'sourceFamily', item.source_family,
        'sourceDomain', item.source_domain,
        'observedAt', item.observed_at::TEXT,
        'independenceGroup', item.evidence_independence_group,
        'correlationReasonCode', item.correlation_reason_code,
        'canonicalUrl', item.canonical_url
      ) ORDER BY item.observed_at, item.evidence_id) AS rows
      FROM commercial_signal_quality_evidence item
      WHERE item.quality_snapshot_id = quality.id
        AND item.candidate_id = quality.candidate_id
        AND item.organization_id = quality.organization_id
        AND item.workspace_id = quality.workspace_id
        AND item.client_profile_id = quality.client_profile_id
        AND item.observed_at <= quality.decision_at
    ) evidence ON TRUE
    WHERE quality.workspace_id = $1::BIGINT
      AND quality.client_profile_id = $2::BIGINT
      AND quality.decision_at >= $3::TIMESTAMPTZ
      AND quality.decision_at < $4::TIMESTAMPTZ
      AND candidate.score_version = 'opportunity-v3'
      AND quality.feature_version = 'commercial-signal-quality-v2'
    ORDER BY quality.decision_at, quality.id
    LIMIT 5001
  `, [workspaceId, profileId, from, to])
  return result.rows
}

function required(name) {
  const index = args.indexOf(name)
  const value = index >= 0 ? args[index + 1] : null
  if (!value || value.startsWith('--')) throw new TypeError(`${name} is required.`)
  return value
}
