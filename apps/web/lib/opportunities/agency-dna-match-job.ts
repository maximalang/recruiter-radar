import type { Pool, PoolClient } from 'pg'

import { getPool } from '@/lib/db-pool'
import { logError, logEvent } from '@/lib/runtime'
import {
  AGENCY_DNA_MATCH_V2_LIMITS,
  clampAgencyDnaMatchJobBatchSize,
  isAgencyDnaMatchV2Enabled,
} from './config'
import {
  AGENCY_DNA_MATCH_FEATURE_VERSION,
  buildAgencyDnaMatch,
  type AgencyDnaMatchInput,
  type AgencyDnaMatchLevel,
} from './agency-dna-match'
import {
  persistAgencyDnaMatch,
  type AgencyDnaMatchDb,
} from './agency-dna-match-repository'
import type {
  AgencyDnaCapacity,
  AgencyDnaCaseHiringMode,
  AgencyDnaCaseStudy,
  AgencyDnaRestrictionType,
  AgencyDnaServiceType,
} from './agency-dna'
import {
  EXTERNAL_AGENCY_PROPENSITY_FEATURE_VERSION,
  type ExternalAgencyPropensityLevel,
} from './external-agency-propensity'
import type { SignalEpisodeStage } from './signal-episode'

export type AgencyDnaMatchJobDb = Pick<Pool, 'query' | 'connect'> |
  Pick<PoolClient, 'query' | 'release'>

export type AgencyDnaMatchJobOptions = {
  workspaceId?: string | number | null
  organizationId?: string | number | null
  batchSize?: number
  dryRun?: boolean
  enabled?: boolean
  env?: Readonly<Record<string, string | undefined>>
}

export type AgencyDnaMatchJobStats = {
  enabled: boolean
  dryRun: boolean
  scanned: number
  built: number
  strong: number
  supported: number
  weak: number
  insufficientEvidence: number
  blocked: number
  persisted: number
  replayed: number
  failed: number
}

export class AgencyDnaMatchApplyScopeRequiredError extends Error {
  constructor() {
    super('Agency DNA Match apply requires explicit workspace and organization.')
    this.name = 'AgencyDnaMatchApplyScopeRequiredError'
  }
}

type CandidateRow = Record<string, unknown>

export async function buildAgencyDnaMatchJob(
  options: AgencyDnaMatchJobOptions = {},
  providedDb: AgencyDnaMatchJobDb | null = null,
): Promise<AgencyDnaMatchJobStats> {
  const enabled = options.enabled !== false && isAgencyDnaMatchV2Enabled(options.env)
  const stats = emptyStats(enabled, options.dryRun !== false)
  if (!enabled) return stats
  if (!stats.dryRun &&
      (options.workspaceId == null || options.organizationId == null)) {
    throw new AgencyDnaMatchApplyScopeRequiredError()
  }

  const database = providedDb ?? getPool()
  if (!database) throw new Error('DATABASE_URL is not set.')
  const batchSize = clampAgencyDnaMatchJobBatchSize(
    options.batchSize ?? AGENCY_DNA_MATCH_V2_LIMITS.defaultJobBatchSize,
  )
  const ownsClient = 'connect' in database && !('release' in database)
  const jobDb = ownsClient && 'connect' in database
    ? await database.connect()
    : database
  try {
    await jobDb.query(
      `SELECT set_config('statement_timeout', $1, false)`,
      [`${AGENCY_DNA_MATCH_V2_LIMITS.statementTimeoutMs}ms`],
    )
    return await executeJob(options, stats, batchSize, jobDb)
  } finally {
    await jobDb.query('RESET statement_timeout').catch((error) => {
      logError('agency_dna_match.statement_timeout_reset_failed', error)
    })
    if (ownsClient && 'release' in jobDb) jobDb.release()
  }
}

async function executeJob(
  options: AgencyDnaMatchJobOptions,
  stats: AgencyDnaMatchJobStats,
  batchSize: number,
  database: AgencyDnaMatchJobDb,
): Promise<AgencyDnaMatchJobStats> {
  const candidates = await loadCandidates(options, batchSize, database)
  for (const candidate of candidates) {
    stats.scanned += 1
    try {
      const draft = buildAgencyDnaMatch(candidate)
      stats.built += 1
      countLevel(stats, draft.level)
      if (stats.dryRun) continue
      const persisted = await persistAgencyDnaMatch(
        draft,
        database as AgencyDnaMatchDb,
      )
      if (persisted.inserted) stats.persisted += 1
      else stats.replayed += 1
    } catch (error) {
      stats.failed += 1
      logError('agency_dna_match.build_failed', error, {
        organizationId: candidate.organizationId,
        workspaceId: candidate.workspaceId,
        clientProfileId: candidate.clientProfileId,
        propensitySnapshotId: candidate.propensitySnapshotId,
      })
    }
  }
  logEvent('agency_dna_match.build_completed', {
    dryRun: stats.dryRun,
    scanned: stats.scanned,
    built: stats.built,
    strong: stats.strong,
    supported: stats.supported,
    weak: stats.weak,
    insufficientEvidence: stats.insufficientEvidence,
    blocked: stats.blocked,
    persisted: stats.persisted,
    replayed: stats.replayed,
    failed: stats.failed,
  })
  return stats
}

async function loadCandidates(
  options: AgencyDnaMatchJobOptions,
  batchSize: number,
  database: AgencyDnaMatchJobDb,
): Promise<AgencyDnaMatchInput[]> {
  const result = await database.query<CandidateRow>(
    `WITH latest_propensity AS (
       SELECT DISTINCT ON (
         propensity.organization_id,
         propensity.workspace_id,
         propensity.client_profile_id,
         propensity.propensity_identity
       ) propensity.*
       FROM external_agency_propensity_snapshots propensity
       WHERE propensity.feature_version = $3
         AND ($1::BIGINT IS NULL OR propensity.workspace_id = $1)
         AND ($2::BIGINT IS NULL OR propensity.organization_id = $2)
       ORDER BY
         propensity.organization_id,
         propensity.workspace_id,
         propensity.client_profile_id,
         propensity.propensity_identity,
         propensity.propensity_generation DESC,
         propensity.id DESC
     )
     SELECT
       propensity.organization_id::TEXT AS "organizationId",
       propensity.workspace_id::TEXT AS "workspaceId",
       propensity.owner_id::TEXT AS "ownerId",
       propensity.client_profile_id::TEXT AS "clientProfileId",
       propensity.id::TEXT AS "propensitySnapshotId",
       propensity.propensity_generation AS "propensityGeneration",
       propensity.propensity_identity AS "propensityIdentity",
       propensity.input_hash AS "propensityInputHash",
       propensity.evidence_hash AS "propensityEvidenceHash",
       propensity.feature_version AS "propensityFeatureVersion",
       propensity.score AS "propensityScore",
       propensity.level AS "propensityLevel",
       propensity.feature_snapshot->>'episodeStage' AS "episodeStage",
       propensity.feature_snapshot->>'evidenceSourceFamilyCount'
         AS "evidenceSourceFamilyCount",
       propensity.feature_snapshot->'roleFamilies' AS "roleFamilies",
       propensity.feature_snapshot->'seniorityDistribution'
         AS "seniorityDistribution",
       episode.regions AS "episodeRegions",
       org.industry AS "organizationIndustry",
       org.city AS "organizationCity",
       org.country AS "organizationCountry",
       ARRAY[]::TEXT[] AS "evidencedTechnologyQualificationTags",
       ARRAY[]::TEXT[] AS "evidencedEngagementTypes",
       NULL::BOOLEAN AS "remoteStatus",
       NULL::TEXT AS "companySizeBucket",
       NULL::BIGINT AS "estimatedFeeMinor",
       NULL::BIGINT AS "estimatedOpportunityValueMinor",
       profile.agency_dna_version AS "agencyDnaVersion",
       profile.agency_dna_snapshot_hash AS "agencyDnaSnapshotHash",
       agency_dna_full_snapshot(profile) AS "agencyDnaSourceSnapshot",
       profile.specialization,
       profile.roles,
       profile.technology_qualification_tags AS "technologyQualificationTags",
       profile.industries,
       profile.target_city AS "targetCity",
       profile.preferred_regions AS "preferredRegions",
       profile.excluded_industries AS "excludedIndustries",
       profile.excluded_locations AS "excludedLocations",
       profile.remote_friendly AS "remoteFriendly",
       profile.service_types AS "serviceTypes",
       profile.target_seniorities AS "targetSeniorities",
       profile.minimum_fee_minor AS "minimumFeeMinor",
       profile.average_fee_minor AS "averageFeeMinor",
       profile.minimum_opportunity_value_minor AS "minimumOpportunityValueMinor",
       profile.preferred_engagement_types AS "preferredEngagementTypes",
       profile.company_sizes AS "companySizes",
       profile.hiring_mode AS "hiringMode",
       profile.undesirable_hiring_types AS "undesirableHiringTypes",
       profile.current_capacity AS "currentCapacity",
       profile.case_studies AS "caseStudies",
       restriction.restriction_type AS "accountRestriction",
       COALESCE((
         SELECT ARRAY_AGG(evidence.evidence_id::TEXT ORDER BY evidence.evidence_id)
         FROM external_agency_propensity_evidence evidence
         WHERE evidence.propensity_snapshot_id = propensity.id
           AND evidence.organization_id = propensity.organization_id
           AND evidence.workspace_id = propensity.workspace_id
           AND evidence.client_profile_id = propensity.client_profile_id
       ), ARRAY[]::TEXT[]) AS "evidenceIds"
     FROM latest_propensity propensity
     JOIN client_profiles profile
       ON profile.id = propensity.client_profile_id
      AND profile.owner_id = propensity.owner_id
      AND profile.workspace_id = propensity.workspace_id
      AND profile.agency_dna_version = propensity.agency_dna_version
      AND profile.agency_dna_snapshot_hash = propensity.agency_dna_snapshot_hash
     JOIN commercial_theses thesis
       ON thesis.id = propensity.commercial_thesis_id
      AND thesis.organization_id = propensity.organization_id
      AND thesis.thesis_generation = propensity.commercial_thesis_generation
     JOIN signal_episodes episode
       ON episode.id = thesis.signal_episode_id
      AND episode.organization_id = thesis.organization_id
      AND episode.episode_generation = thesis.signal_episode_generation
     JOIN orgs org ON org.id = propensity.organization_id
     LEFT JOIN agency_account_restrictions restriction
       ON restriction.workspace_id = profile.workspace_id
      AND restriction.client_profile_id = profile.id
      AND restriction.owner_id = profile.owner_id
      AND restriction.organization_id = propensity.organization_id
     WHERE NOT EXISTS (
       SELECT 1
       FROM agency_dna_match_snapshots match
       WHERE match.organization_id = propensity.organization_id
         AND match.workspace_id = propensity.workspace_id
         AND match.owner_id = propensity.owner_id
         AND match.client_profile_id = propensity.client_profile_id
         AND match.propensity_snapshot_id = propensity.id
         AND match.propensity_generation = propensity.propensity_generation
         AND match.agency_dna_version = profile.agency_dna_version
         AND match.agency_dna_snapshot_hash = profile.agency_dna_snapshot_hash
         AND match.agency_dna_snapshot = agency_dna_full_snapshot(profile)
         AND match.feature_version = $4
         AND match.feature_snapshot #>> '{company,organizationIndustry}'
           IS NOT DISTINCT FROM NULLIF(BTRIM(LOWER(org.industry)), '')
         AND match.feature_snapshot #>> '{company,organizationCity}'
           IS NOT DISTINCT FROM NULLIF(BTRIM(LOWER(org.city)), '')
         AND match.feature_snapshot #>> '{company,organizationCountry}'
           IS NOT DISTINCT FROM NULLIF(BTRIM(LOWER(org.country)), '')
     )
     ORDER BY
       propensity.workspace_id,
       propensity.client_profile_id,
       propensity.organization_id,
       propensity.id
     LIMIT $5`,
    [
      options.workspaceId == null ? null : String(options.workspaceId),
      options.organizationId == null ? null : String(options.organizationId),
      EXTERNAL_AGENCY_PROPENSITY_FEATURE_VERSION,
      AGENCY_DNA_MATCH_FEATURE_VERSION,
      batchSize,
    ],
  )
  return result.rows.map(candidateFromRow)
}

function candidateFromRow(row: CandidateRow): AgencyDnaMatchInput {
  const seniorityDistribution = numberRecord(row.seniorityDistribution)
  const evidencedServiceTypes: AgencyDnaServiceType[] =
    Number(seniorityDistribution.executive ?? 0) > 0 ? ['executive'] : []
  return {
    organizationId: String(row.organizationId),
    workspaceId: String(row.workspaceId),
    ownerId: String(row.ownerId),
    clientProfileId: String(row.clientProfileId),
    propensitySnapshotId: String(row.propensitySnapshotId),
    propensityGeneration: Number(row.propensityGeneration),
    propensityIdentity: String(row.propensityIdentity),
    propensityInputHash: String(row.propensityInputHash),
    propensityEvidenceHash: String(row.propensityEvidenceHash),
    propensityFeatureVersion: String(row.propensityFeatureVersion),
    propensityScore: Number(row.propensityScore),
    propensityLevel: String(row.propensityLevel) as ExternalAgencyPropensityLevel,
    episodeStage: String(row.episodeStage) as SignalEpisodeStage,
    evidenceSourceFamilyCount: Number(row.evidenceSourceFamilyCount),
    evidenceIds: stringArray(row.evidenceIds),
    roleFamilies: stringArray(row.roleFamilies),
    seniorityDistribution,
    episodeRegions: stringArray(row.episodeRegions),
    organizationIndustry: nullableText(row.organizationIndustry),
    organizationCity: nullableText(row.organizationCity),
    organizationCountry: nullableText(row.organizationCountry),
    evidencedTechnologyQualificationTags: stringArray(
      row.evidencedTechnologyQualificationTags,
    ),
    evidencedServiceTypes,
    evidencedEngagementTypes: stringArray(row.evidencedEngagementTypes),
    remoteStatus: typeof row.remoteStatus === 'boolean' ? row.remoteStatus : null,
    companySizeBucket: nullableText(row.companySizeBucket),
    estimatedFeeMinor: nullableNumber(row.estimatedFeeMinor),
    estimatedOpportunityValueMinor: nullableNumber(
      row.estimatedOpportunityValueMinor,
    ),
    agencyDnaVersion: Number(row.agencyDnaVersion),
    agencyDnaSnapshotHash: String(row.agencyDnaSnapshotHash),
    agencyDnaSourceSnapshot: jsonObject(row.agencyDnaSourceSnapshot),
    specialization: nullableText(row.specialization),
    roles: stringArray(row.roles),
    technologyQualificationTags: stringArray(row.technologyQualificationTags),
    industries: stringArray(row.industries),
    targetCity: nullableText(row.targetCity),
    preferredRegions: stringArray(row.preferredRegions),
    excludedIndustries: stringArray(row.excludedIndustries),
    excludedLocations: stringArray(row.excludedLocations),
    remoteFriendly: row.remoteFriendly === true,
    serviceTypes: stringArray(row.serviceTypes) as AgencyDnaServiceType[],
    targetSeniorities: stringArray(row.targetSeniorities),
    minimumFeeMinor: nullableNumber(row.minimumFeeMinor),
    averageFeeMinor: nullableNumber(row.averageFeeMinor),
    minimumOpportunityValueMinor: nullableNumber(row.minimumOpportunityValueMinor),
    preferredEngagementTypes: stringArray(row.preferredEngagementTypes),
    companySizes: stringArray(row.companySizes),
    hiringMode: String(row.hiringMode) as AgencyDnaCaseHiringMode,
    undesirableHiringTypes: stringArray(
      row.undesirableHiringTypes,
    ) as AgencyDnaServiceType[],
    currentCapacity: String(row.currentCapacity) as AgencyDnaCapacity,
    caseStudies: Array.isArray(row.caseStudies)
      ? row.caseStudies as AgencyDnaCaseStudy[]
      : [],
    accountRestriction: row.accountRestriction == null
      ? null
      : String(row.accountRestriction) as AgencyDnaRestrictionType,
  }
}

function countLevel(stats: AgencyDnaMatchJobStats, level: AgencyDnaMatchLevel): void {
  if (level === 'insufficient_evidence') stats.insufficientEvidence += 1
  else stats[level] += 1
}

function emptyStats(enabled: boolean, dryRun: boolean): AgencyDnaMatchJobStats {
  return {
    enabled,
    dryRun,
    scanned: 0,
    built: 0,
    strong: 0,
    supported: 0,
    weak: 0,
    insufficientEvidence: 0,
    blocked: 0,
    persisted: 0,
    replayed: 0,
    failed: 0,
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : []
}

function numberRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).map(([key, count]) => [key, Number(count)]),
  )
}

function jsonObject(value: unknown): Readonly<Record<string, unknown>> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {}
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function nullableNumber(value: unknown): number | null {
  return value == null ? null : Number(value)
}
