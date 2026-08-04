import type { Pool, PoolClient } from 'pg'

import { getPool } from '@/lib/db-pool'
import { logError, logEvent } from '@/lib/runtime'
import {
  OPPORTUNITY_SCORING_V3_LIMITS,
  clampOpportunityScoringV3JobBatchSize,
  isOpportunityScoringV3Enabled,
} from './config'
import {
  buildOpportunityScoringV3,
  type OpportunityScoringV3Input,
  type OpportunityV3ContactPolicy,
  type OpportunityV3EconomicsOutcome,
  type OpportunityV3Mode,
  type OpportunityV3SafeContactCategory,
  type OpportunityV3Status,
} from './opportunity-scoring-v3'
import {
  AGENCY_DNA_MATCH_FEATURE_VERSION,
} from './agency-dna-match'
import {
  persistOpportunityCandidate,
  type OpportunityCandidateDb,
} from './opportunity-scoring-v3-repository'
import type {
  AgencyDnaCapacity,
  AgencyDnaRestrictionType,
} from './agency-dna'
import type { ExternalAgencyPropensityLevel } from './external-agency-propensity'
import type { SignalEpisodeStage } from './signal-episode'

export type OpportunityScoringV3JobDb = Pick<Pool, 'query' | 'connect'> |
  Pick<PoolClient, 'query' | 'release'>

export type OpportunityScoringV3JobOptions = {
  workspaceId?: string | number | null
  organizationId?: string | number | null
  batchSize?: number
  dryRun?: boolean
  enabled?: boolean
  rolloutMode?: 'shadow' | 'canary'
  now?: Date
  env?: Readonly<Record<string, string | undefined>>
}

export type OpportunityScoringV3JobStats = {
  enabled: boolean
  dryRun: boolean
  rolloutMode: 'shadow' | 'canary'
  scanned: number
  built: number
  qualifiedActionable: number
  qualifiedNeedsEnrichment: number
  review: number
  blocked: number
  expired: number
  dismissed: number
  persisted: number
  replayed: number
  failed: number
}

export class OpportunityScoringV3ApplyScopeRequiredError extends Error {
  constructor() {
    super('Opportunity Scoring v3 apply requires explicit workspace and organization.')
    this.name = 'OpportunityScoringV3ApplyScopeRequiredError'
  }
}

type CandidateRow = Record<string, unknown>

export async function buildOpportunityScoringV3Job(
  options: OpportunityScoringV3JobOptions = {},
  providedDb: OpportunityScoringV3JobDb | null = null,
): Promise<OpportunityScoringV3JobStats> {
  const enabled = options.enabled !== false &&
    isOpportunityScoringV3Enabled(options.env)
  const rolloutMode = options.rolloutMode ?? 'shadow'
  const stats = emptyStats(enabled, options.dryRun !== false, rolloutMode)
  if (!enabled) return stats
  if (!stats.dryRun &&
      (options.workspaceId == null || options.organizationId == null)) {
    throw new OpportunityScoringV3ApplyScopeRequiredError()
  }

  const database = providedDb ?? getPool()
  if (!database) throw new Error('DATABASE_URL is not set.')
  const batchSize = clampOpportunityScoringV3JobBatchSize(
    options.batchSize ?? OPPORTUNITY_SCORING_V3_LIMITS.defaultJobBatchSize,
  )
  const ownsClient = 'connect' in database && !('release' in database)
  const jobDb = ownsClient && 'connect' in database
    ? await database.connect()
    : database
  try {
    await jobDb.query(
      `SELECT set_config('statement_timeout', $1, false)`,
      [`${OPPORTUNITY_SCORING_V3_LIMITS.statementTimeoutMs}ms`],
    )
    return await executeJob(
      options,
      stats,
      batchSize,
      validDate(options.now ?? new Date()),
      jobDb,
    )
  } finally {
    await jobDb.query('RESET statement_timeout').catch((error) => {
      logError('opportunity_scoring_v3.statement_timeout_reset_failed', error)
    })
    if (ownsClient && 'release' in jobDb) jobDb.release()
  }
}

async function executeJob(
  options: OpportunityScoringV3JobOptions,
  stats: OpportunityScoringV3JobStats,
  batchSize: number,
  now: Date,
  database: OpportunityScoringV3JobDb,
): Promise<OpportunityScoringV3JobStats> {
  const candidates = await loadCandidates(options, batchSize, now, database)
  for (const source of candidates) {
    stats.scanned += 1
    try {
      const candidate = buildOpportunityScoringV3({
        ...source,
        rolloutMode: stats.rolloutMode,
        fallbackScoringVersion: 'opportunity-v2',
        now,
      })
      stats.built += 1
      countStatus(stats, candidate.status)
      if (stats.dryRun) continue
      const persisted = await persistOpportunityCandidate(
        candidate,
        database as OpportunityCandidateDb,
      )
      if (persisted.inserted) stats.persisted += 1
      else stats.replayed += 1
    } catch (error) {
      stats.failed += 1
      logError('opportunity_scoring_v3.build_failed', error, {
        organizationId: source.organizationId,
        workspaceId: source.workspaceId,
        clientProfileId: source.clientProfileId,
        agencyDnaMatchSnapshotId: source.agencyDnaMatchSnapshotId,
      })
    }
  }
  logEvent('opportunity_scoring_v3.build_completed', {
    dryRun: stats.dryRun,
    rolloutMode: stats.rolloutMode,
    scanned: stats.scanned,
    built: stats.built,
    qualifiedActionable: stats.qualifiedActionable,
    qualifiedNeedsEnrichment: stats.qualifiedNeedsEnrichment,
    review: stats.review,
    blocked: stats.blocked,
    expired: stats.expired,
    dismissed: stats.dismissed,
    persisted: stats.persisted,
    replayed: stats.replayed,
    failed: stats.failed,
  })
  return stats
}

async function loadCandidates(
  options: OpportunityScoringV3JobOptions,
  batchSize: number,
  now: Date,
  database: OpportunityScoringV3JobDb,
): Promise<OpportunityScoringV3Input[]> {
  const result = await database.query<CandidateRow>(
    `WITH latest_match AS (
       SELECT DISTINCT ON (
         match.organization_id,
         match.workspace_id,
         match.client_profile_id,
         match.match_identity
       ) match.*
       FROM agency_dna_match_snapshots match
       WHERE match.feature_version = $3
         AND ($1::BIGINT IS NULL OR match.workspace_id = $1)
         AND ($2::BIGINT IS NULL OR match.organization_id = $2)
       ORDER BY
         match.organization_id,
         match.workspace_id,
         match.client_profile_id,
         match.match_identity,
         match.match_generation DESC,
         match.id DESC
     )
     SELECT
       match.organization_id::TEXT AS "organizationId",
       match.workspace_id::TEXT AS "workspaceId",
       match.owner_id::TEXT AS "ownerId",
       match.client_profile_id::TEXT AS "clientProfileId",
       match.id::TEXT AS "agencyDnaMatchSnapshotId",
       match.match_generation AS "agencyDnaMatchGeneration",
       match.match_identity AS "agencyDnaMatchIdentity",
       match.input_hash AS "agencyDnaMatchInputHash",
       propensity.id::TEXT AS "propensitySnapshotId",
       propensity.propensity_generation AS "propensityGeneration",
       thesis.id::TEXT AS "commercialThesisId",
       thesis.thesis_generation AS "commercialThesisGeneration",
       episode.id::TEXT AS "signalEpisodeId",
       episode.episode_generation AS "signalEpisodeGeneration",
       state_snapshot.id::TEXT AS "companyStateSnapshotId",
       match.agency_dna_version AS "agencyDnaVersion",
       match.agency_dna_snapshot_hash AS "agencyDnaSnapshotHash",
       match.evidence_hash AS "evidenceHash",
       evidence.evidence_ids AS "evidenceIds",
       evidence.source_families AS "evidenceSourceFamilies",
       evidence.direct_count AS "directEvidenceCount",
       evidence.corroboration_count AS "corroborationEvidenceCount",
       (
         NULLIF(BTRIM(org.inn), '') IS NOT NULL
         OR NULLIF(BTRIM(org.ogrn), '') IS NOT NULL
         OR NULLIF(BTRIM(org.domain), '') IS NOT NULL
         OR NULLIF(BTRIM(org.website_url), '') IS NOT NULL
         OR NULLIF(BTRIM(org.career_page_url), '') IS NOT NULL
       ) AS "organizationIdentityVerified",
       TRUE AS "stateChangeConfirmed",
       state_snapshot.state_confidence AS "companyStateConfidence",
       episode.stage AS "episodeStage",
       episode.intensity AS "episodeIntensity",
       episode.last_seen_at AS "episodeLastSeenAt",
       episode.valid_until AS "episodeValidUntil",
       EXISTS (
         SELECT 1
         FROM JSONB_ARRAY_ELEMENTS(match.reasons) reason
         WHERE reason->>'code' IN (
           'EXCLUDED_INDUSTRY', 'EXCLUDED_REGION', 'UNDESIRABLE_HIRING_TYPE'
         )
       ) AS "profileExcluded",
       match.feature_snapshot #>> '{agency,accountRestriction}'
         AS "accountRestriction",
       CASE match.feature_snapshot #>> '{agency,accountRestriction}'
         WHEN 'existing_client' THEN 'grow'
         WHEN 'former_client' THEN 'reactivate'
         WHEN 'do_not_contact' THEN 'blocked'
         WHEN 'conflict' THEN 'blocked'
         ELSE 'find'
       END AS "opportunityMode",
       match.fit_score AS "agencyFitScore",
       match.coverage AS "agencyFitCoverage",
       match.selection_policy->>'minimumFitScore' AS "minimumAgencyFitScore",
       match.selection_policy->>'minimumCoverage' AS "minimumAgencyFitCoverage",
       propensity.score AS "propensityScore",
       propensity.level AS "propensityLevel",
       match.dimensions #>> '{economics,outcome}' AS "economicsOutcome",
       match.selection_policy->>'capacity' AS "currentCapacity",
       contact_paths.categories AS "corporateContactPathCategories",
       personas.functions AS "decisionMakerFunctions",
       profile.contact_policy AS "contactPolicy",
       (
         CASE WHEN (
           NULLIF(BTRIM(org.inn), '') IS NOT NULL
           OR NULLIF(BTRIM(org.ogrn), '') IS NOT NULL
           OR NULLIF(BTRIM(org.domain), '') IS NOT NULL
           OR NULLIF(BTRIM(org.website_url), '') IS NOT NULL
           OR NULLIF(BTRIM(org.career_page_url), '') IS NOT NULL
         ) THEN 0.25 ELSE 0 END
         + CASE WHEN CARDINALITY(personas.functions) > 0 THEN 0.25 ELSE 0 END
         + CASE WHEN CARDINALITY(contact_paths.categories) > 0
             THEN 0.50 ELSE 0 END
       ) AS "enrichmentCompleteness"
     FROM latest_match match
     JOIN external_agency_propensity_snapshots propensity
       ON propensity.id = match.propensity_snapshot_id
      AND propensity.organization_id = match.organization_id
      AND propensity.workspace_id = match.workspace_id
      AND propensity.client_profile_id = match.client_profile_id
      AND propensity.propensity_generation = match.propensity_generation
     JOIN commercial_theses thesis
       ON thesis.id = propensity.commercial_thesis_id
      AND thesis.organization_id = propensity.organization_id
      AND thesis.thesis_generation = propensity.commercial_thesis_generation
     JOIN signal_episodes episode
       ON episode.id = thesis.signal_episode_id
      AND episode.organization_id = thesis.organization_id
      AND episode.episode_generation = thesis.signal_episode_generation
     JOIN client_profiles profile
       ON profile.id = match.client_profile_id
      AND profile.owner_id = match.owner_id
      AND profile.workspace_id = match.workspace_id
     JOIN orgs org ON org.id = match.organization_id
     JOIN LATERAL (
       SELECT snapshot.*
       FROM signal_episode_state_changes episode_state
       JOIN company_state_changes state_change
         ON state_change.id = episode_state.company_state_change_id
        AND state_change.organization_id = episode_state.organization_id
       JOIN company_state_snapshots snapshot
         ON snapshot.id = state_change.snapshot_id
        AND snapshot.organization_id = state_change.organization_id
       WHERE episode_state.signal_episode_id = episode.id
         AND episode_state.organization_id = episode.organization_id
       ORDER BY snapshot.snapshot_at DESC, snapshot.id DESC
       LIMIT 1
     ) state_snapshot ON TRUE
     JOIN LATERAL (
       SELECT
         ARRAY_AGG(item.id::TEXT ORDER BY item.id) AS evidence_ids,
         ARRAY_AGG(DISTINCT LOWER(BTRIM(item.source))
           ORDER BY LOWER(BTRIM(item.source))) AS source_families,
         COUNT(*) FILTER (WHERE item.tier = 'direct')::INTEGER AS direct_count,
         COUNT(*) FILTER (
           WHERE item.tier = 'corroboration'
         )::INTEGER AS corroboration_count
       FROM agency_dna_match_evidence match_evidence
       JOIN evidence_items item ON item.id = match_evidence.evidence_id
        AND item.org_id = match_evidence.organization_id
       WHERE match_evidence.match_snapshot_id = match.id
         AND match_evidence.organization_id = match.organization_id
         AND match_evidence.workspace_id = match.workspace_id
         AND match_evidence.client_profile_id = match.client_profile_id
       HAVING COUNT(*) > 0
     ) evidence ON TRUE
     JOIN LATERAL (
       SELECT COALESCE(ARRAY_AGG(category ORDER BY category), ARRAY[]::TEXT[])
         AS categories
       FROM (
         SELECT DISTINCT LOWER(BTRIM(path->>'category')) AS category
         FROM signal_episode_events episode_event
         JOIN company_event_publications publication
           ON publication.company_event_id = episode_event.company_event_id
          AND publication.organization_id = episode_event.organization_id
         CROSS JOIN LATERAL JSONB_ARRAY_ELEMENTS(
           CASE
             WHEN JSONB_TYPEOF(publication.source_snapshot->'contact_paths')
               = 'array'
             THEN publication.source_snapshot->'contact_paths'
             ELSE '[]'::JSONB
           END
         ) path
         WHERE episode_event.signal_episode_id = episode.id
           AND episode_event.organization_id = episode.organization_id
           AND LOWER(BTRIM(path->>'category')) IN (
             'hr-email', 'careers-email', 'generic-email', 'contact-form'
           )
         UNION
         SELECT 'career-page'
         WHERE NULLIF(BTRIM(org.career_page_url), '') IS NOT NULL
       ) safe_categories
     ) contact_paths ON TRUE
     JOIN LATERAL (
       SELECT COALESCE(ARRAY_AGG(code ORDER BY code), ARRAY[]::TEXT[])
         AS functions
       FROM (
         SELECT DISTINCT REPLACE(
           LOWER(BTRIM(persona->>'code')), '_', '-'
         ) AS code
         FROM JSONB_ARRAY_ELEMENTS(thesis.recommended_persona) persona
         WHERE BTRIM(COALESCE(persona->>'code', '')) <> ''
       ) persona_codes
     ) personas ON TRUE
     WHERE episode.stage = CASE
       WHEN $5::TIMESTAMPTZ >= episode.valid_until THEN 'expired'
       WHEN $5::TIMESTAMPTZ >= episode.last_seen_at +
         (episode.valid_until - episode.last_seen_at) * 0.75 THEN 'cooling'
       ELSE 'active'
     END
     ORDER BY
       match.workspace_id,
       match.client_profile_id,
       match.organization_id,
       match.id
     LIMIT $4`,
    [
      options.workspaceId == null ? null : String(options.workspaceId),
      options.organizationId == null ? null : String(options.organizationId),
      AGENCY_DNA_MATCH_FEATURE_VERSION,
      batchSize,
      now.toISOString(),
    ],
  )
  return result.rows.map(candidateFromRow)
}

function candidateFromRow(row: CandidateRow): OpportunityScoringV3Input {
  return {
    organizationId: String(row.organizationId),
    workspaceId: String(row.workspaceId),
    ownerId: String(row.ownerId),
    clientProfileId: String(row.clientProfileId),
    agencyDnaMatchSnapshotId: String(row.agencyDnaMatchSnapshotId),
    agencyDnaMatchGeneration: Number(row.agencyDnaMatchGeneration),
    agencyDnaMatchIdentity: String(row.agencyDnaMatchIdentity),
    agencyDnaMatchInputHash: String(row.agencyDnaMatchInputHash),
    propensitySnapshotId: String(row.propensitySnapshotId),
    propensityGeneration: Number(row.propensityGeneration),
    commercialThesisId: String(row.commercialThesisId),
    commercialThesisGeneration: Number(row.commercialThesisGeneration),
    signalEpisodeId: String(row.signalEpisodeId),
    signalEpisodeGeneration: Number(row.signalEpisodeGeneration),
    companyStateSnapshotId: String(row.companyStateSnapshotId),
    agencyDnaVersion: Number(row.agencyDnaVersion),
    agencyDnaSnapshotHash: String(row.agencyDnaSnapshotHash),
    evidenceHash: String(row.evidenceHash),
    evidenceIds: stringArray(row.evidenceIds),
    evidenceSourceFamilies: stringArray(row.evidenceSourceFamilies),
    directEvidenceCount: Number(row.directEvidenceCount),
    corroborationEvidenceCount: Number(row.corroborationEvidenceCount),
    organizationIdentityVerified: row.organizationIdentityVerified === true,
    stateChangeConfirmed: row.stateChangeConfirmed === true,
    companyStateConfidence: Number(row.companyStateConfidence),
    episodeStage: String(row.episodeStage) as SignalEpisodeStage,
    episodeIntensity: Number(row.episodeIntensity),
    episodeLastSeenAt: timestamp(row.episodeLastSeenAt),
    episodeValidUntil: timestamp(row.episodeValidUntil),
    profileExcluded: row.profileExcluded === true,
    accountRestriction: row.accountRestriction == null
      ? null
      : String(row.accountRestriction) as AgencyDnaRestrictionType,
    opportunityMode: String(row.opportunityMode) as OpportunityV3Mode,
    agencyFitScore: Number(row.agencyFitScore),
    agencyFitCoverage: Number(row.agencyFitCoverage),
    minimumAgencyFitScore: Number(row.minimumAgencyFitScore),
    minimumAgencyFitCoverage: Number(row.minimumAgencyFitCoverage),
    propensityScore: Number(row.propensityScore),
    propensityLevel: String(row.propensityLevel) as ExternalAgencyPropensityLevel,
    economicsOutcome: String(row.economicsOutcome) as OpportunityV3EconomicsOutcome,
    currentCapacity: String(row.currentCapacity) as AgencyDnaCapacity,
    corporateContactPathCategories: stringArray(
      row.corporateContactPathCategories,
    ) as OpportunityV3SafeContactCategory[],
    decisionMakerFunctions: stringArray(row.decisionMakerFunctions),
    contactPolicy: String(row.contactPolicy) as OpportunityV3ContactPolicy,
    enrichmentCompleteness: Number(row.enrichmentCompleteness),
    rolloutMode: 'shadow',
    fallbackScoringVersion: 'opportunity-v2',
  }
}

function countStatus(
  stats: OpportunityScoringV3JobStats,
  status: OpportunityV3Status,
): void {
  if (status === 'qualified_actionable') stats.qualifiedActionable += 1
  else if (status === 'qualified_needs_enrichment') {
    stats.qualifiedNeedsEnrichment += 1
  } else stats[status] += 1
}

function emptyStats(
  enabled: boolean,
  dryRun: boolean,
  rolloutMode: 'shadow' | 'canary',
): OpportunityScoringV3JobStats {
  return {
    enabled,
    dryRun,
    rolloutMode,
    scanned: 0,
    built: 0,
    qualifiedActionable: 0,
    qualifiedNeedsEnrichment: 0,
    review: 0,
    blocked: 0,
    expired: 0,
    dismissed: 0,
    persisted: 0,
    replayed: 0,
    failed: 0,
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : []
}

function timestamp(value: unknown): string {
  const parsed = value instanceof Date ? value : new Date(String(value))
  if (!Number.isFinite(parsed.getTime())) throw new TypeError('Invalid timestamp.')
  return parsed.toISOString()
}

function validDate(value: Date): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError('Opportunity Scoring v3 evaluation time is invalid.')
  }
  return new Date(value.getTime())
}
