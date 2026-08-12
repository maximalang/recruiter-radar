import type { Pool, PoolClient } from 'pg'

import { resolveHiringMode } from '@/lib/clientProfiles'
import {
  filterContactPathsByPolicy,
  hasCorporateSurface,
} from '@/lib/contact-policy-filter'
import { getClient, getPool } from '@/lib/db-pool'
import { extractPayloadFields } from '@/lib/leads-data'
import { logError, logEvent, logWarn } from '@/lib/runtime'
import { computeFiur, type EvidenceTier } from '@/lib/scoring/fiur'
import {
  DEFAULT_HIRING_EPISODE_CONFIG,
  HIRING_EPISODE_ENGINE_VERSION,
  HiringEpisodeDetectionService,
  classifyOpportunityRoleFamily,
  hashEpisodeEvidence,
  isEpisodeContinuation,
  type HiringEpisodeCandidate,
  type HiringSignalInput,
} from './hiring-episode-detection'
import {
  OpportunityBriefBuilder,
  type OpportunityBrief,
} from './opportunity-brief-builder'
import { canonicalJsonStringify, hashCanonicalJson } from './canonical-hash'
import {
  OPPORTUNITY_ENGINE_LIMITS,
  AGENCY_DNA_V1_CANARY_WORKSPACE_IDS_FEATURE_FLAG,
  OPPORTUNITY_SCORING_V2_CANARY_WORKSPACE_IDS_FEATURE_FLAG,
  OPPORTUNITY_SCORING_V2_SHADOW_CANARY_WORKSPACE_IDS_FEATURE_FLAG,
  clampOpportunityJobBatchSize,
  isAgencyDnaV1EnabledForContext,
  isOpportunityEngineV1Enabled,
  isOpportunityOutcomesEnabled,
  isOpportunityScoringV2EnabledForContext,
  isOpportunityScoringV2ShadowEnabledForContext,
  isOpportunityStrategistV1EnabledForContext,
} from './config'
import {
  AGENCY_DNA_CAPACITIES,
  AGENCY_DNA_CASE_HIRING_MODES,
  AGENCY_DNA_SERVICE_TYPES,
  normalizeAgencyDnaCaseStudies,
  resolveAgencyDnaOpportunityContext,
  type AgencyDnaCapacity,
  type AgencyDnaCaseHiringMode,
  type AgencyDnaOpportunityContext,
  type AgencyDnaRestrictionType,
  type AgencyDnaServiceType,
} from './agency-dna'
import {
  lockOutcomeOwnerShared,
  recordOpportunityOutcomeInTransaction,
} from './outcome-repository'
import type { OpportunityOutcomeStage } from './outcome-domain'
import {
  DEFAULT_OPPORTUNITY_SCORING_CONFIG,
  OpportunityScoringService,
  type ConfidenceGate,
  type OpportunityScoreResult,
} from './opportunity-scoring'
import {
  DEFAULT_OPPORTUNITY_SCORING_V2_CONFIG,
  OPPORTUNITY_SCORING_VERSION_V2,
  OpportunityScoringV2Service,
  type OpportunityScoringV2Result,
} from './opportunity-scoring-v2'
import { createOpportunityAnalyticsCohort } from './analytics-cohort'
import {
  OpportunityStrategistV1,
  type OpportunityStrategistBrief,
} from './opportunity-strategist-v1'

type OpportunityJobDb = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>

export const OPPORTUNITY_JOB_LOCK_KEYS = {
  detect: 7_271_001,
  build: 7_271_002,
  expire: 7_271_003,
  backfill: 7_271_004,
} as const

const FIUR_VERSION = 'fiur-v1'
const BRIEF_BUILDER_VERSION = 'opportunity-brief-v2'
const STRATEGIST_BRIEF_BUILDER_VERSION = 'opportunity-brief-v3'
const OPPORTUNITY_SCORING_VERSION_V1 = 'opportunity-v1'
const OPPORTUNITY_FEATURE_SCHEMA_V1 = 'opportunity-features-v1'
const OPPORTUNITY_GATE_VERSION_V1 = 'opportunity-gates-v1'

export interface OpportunityJobOptions {
  organizationId?: string | number | null
  batchSize?: number
  dryRun?: boolean
  now?: Date
  enabled?: boolean
  scoringVersion?: string
}

export interface OpportunityJobStats {
  enabled: boolean
  dryRun: boolean
  scanned: number
  created: number
  updated: number
  skipped: number
  failed: number
  expired: number
  continued: number
  reconciled: number
  skippedUnchanged: number
  superseded: number
  resumed: number
  resumeLatencyMsTotal: number
  resumeLatencyMsMax: number
  locked: number
  skippedBecauseLocked: boolean
  scoringV2ShadowEvaluated: number
  scoringV2ShadowSnapshotsCreated: number
}

interface SignalRow {
  id: string
  organizationId: string
  signalType: string
  title: string
  region: string | null
  source: string
  sourceUrl: string | null
  externalVacancyId: string | null
  occurredAt: string
  evidenceIds: unknown
}

interface OpportunityBuildRow {
  ownerId: string
  workspaceId: string | null
  clientProfileId: string
  organizationId: string
  hiringEpisodeId: string
  organizationName: string
  organizationDomain: string | null
  organizationWebsiteUrl: string | null
  organizationCareerPageUrl: string | null
  organizationInn: string | null
  organizationOgrn: string | null
  organizationCountry: string | null
  organizationIndustry: string | null
  organizationCity: string | null
  episodeType: HiringEpisodeCandidate['episodeType']
  episodeKey: string
  episodeIdentity: string
  episodeGeneration: number
  episodeTitle: string
  episodeSummary: string
  episodeStartedAt: string
  episodeLastSeenAt: string
  signalCount: number
  vacancyCount: number
  strengthScore: number
  freshnessScore: number
  evidenceHash: string
  engineVersion: HiringEpisodeCandidate['engineVersion']
  episodeMetadata: Record<string, unknown>
  signalIds: unknown
  evidenceIds: unknown
  signals: unknown
  evidence: unknown
  digestCandidateId: string
  digestPayload: unknown
  digestReasons: unknown
  sourceFamilies: unknown
  agencyName: string
  targetCity: string | null
  specialization: string | null
  includeKeywords: unknown
  excludeKeywords: unknown
  industries: unknown
  companySizes: unknown
  contactPolicy: 'corporate_only' | 'no_personal' | 'unrestricted'
  roles: unknown
  excludedIndustries: unknown
  excludedLocations: unknown
  remoteFriendly: boolean
  hiringMode: 'auto' | 'specialist' | 'executive' | 'volume'
  serviceTypes: unknown
  targetSeniorities: unknown
  preferredEngagementTypes: unknown
  currentCapacity: string
  agencyDnaVersion: string | number
  agencyDnaSnapshotHash: string | null
  agencyDnaSnapshot: unknown
  restrictionType: AgencyDnaRestrictionType | null
  currentOpportunityId: string | null
  currentInputHash: string | null
  currentScoringVersion: string | null
  buildScoringVersion: string
}

interface OpportunityInputProvenance {
  episodeEvidenceHash: string
  profileSnapshotHash: string
  digestCandidateId: string
  fiurVersion: string
  scoringVersion: string
  scoringConfigHash: string
  briefBuilderVersion: string
  inputHash: string
  comparisonInputHash: string
  agencyDnaVersion: number | null
}

interface OpportunityScoringSelection {
  forcedVersion: string | null
  globalV2: boolean
  canaryWorkspaceId: string | null
  shadowWorkspaceId: string | null
}

interface AgencyDnaBuildState {
  version: number
  snapshotHash: string
  snapshot: Record<string, unknown>
  context: AgencyDnaOpportunityContext
}

export async function detectHiringEpisodesJob(
  options: OpportunityJobOptions = {},
  db: OpportunityJobDb | null = null,
): Promise<OpportunityJobStats> {
  const stats = createStats(options)
  if (!stats.enabled) return disabledJob('detect-hiring-episodes', stats)
  return runWithJobLock(
    'detect',
    'detect-hiring-episodes',
    options,
    db,
    (lockedDb) => runDetectHiringEpisodesJob(options, lockedDb),
  )
}

async function runDetectHiringEpisodesJob(
  options: OpportunityJobOptions = {},
  db: OpportunityJobDb,
): Promise<OpportunityJobStats> {
  const stats = createStats(options)

  const now = options.now ?? new Date()
  const batchSize = clampOpportunityJobBatchSize(
    options.batchSize ?? OPPORTUNITY_ENGINE_LIMITS.defaultJobBatchSize,
  )
  logEvent('opportunity.job.started', {
    job: 'detect-hiring-episodes',
    dryRun: stats.dryRun,
    batchSize,
  })

  const organizations = await db.query<{
    organizationId: string
    lastSignalId: string
    lastSignalUpdatedAt: string
    inputFingerprint: string
  }>(
    `WITH scoped_organizations AS (
       SELECT DISTINCT s.org_id AS organization_id
       FROM signals s
       WHERE s.signal_type = 'job_posting'
         AND s.occurred_at >= $1::timestamptz
         AND ($2::bigint IS NULL OR s.org_id = $2)
       UNION
       SELECT state.organization_id
       FROM hiring_episode_detection_state state
       WHERE state.engine_version = $4
         AND ($2::bigint IS NULL OR state.organization_id = $2)
     ), current_inputs AS (
       SELECT
         scope.organization_id,
         COALESCE(MAX(s.id), 0)::TEXT AS "lastSignalId",
         COALESCE(
           MAX(s.updated_at),
           '1970-01-01T00:00:00Z'::timestamptz
         )::TEXT AS "lastSignalUpdatedAt",
         md5(COALESCE(
           STRING_AGG(
             CONCAT_WS(
               E'\\x1f',
               s.id::TEXT,
               s.updated_at::TEXT,
               s.occurred_at::TEXT,
               s.source,
               s.source_url,
               s.external_id,
               s.headline,
               s.payload::TEXT,
               evidence.fingerprint
             ),
             E'\\n' ORDER BY s.id
           ) FILTER (WHERE s.id IS NOT NULL),
           ''
         )) AS "inputFingerprint"
       FROM scoped_organizations scope
       LEFT JOIN signals s
         ON s.org_id = scope.organization_id
        AND s.signal_type = 'job_posting'
        AND s.occurred_at >= $1::timestamptz
       LEFT JOIN LATERAL (
         SELECT md5(COALESCE(STRING_AGG(
           CONCAT_WS(
             E'\\x1f',
             ei.id::TEXT,
             ei.source,
             ei.url,
             ei.fetched_at::TEXT,
             ei.content_hash,
             ei.tier
           ),
           E'\\n' ORDER BY ei.id
         ), '')) AS fingerprint
         FROM evidence_items ei
         WHERE ei.org_id = s.org_id
           AND ei.url = s.source_url
       ) evidence ON s.id IS NOT NULL
       GROUP BY scope.organization_id
     )
     SELECT
       current_inputs.organization_id::TEXT AS "organizationId",
       current_inputs."lastSignalId",
       current_inputs."lastSignalUpdatedAt",
       current_inputs."inputFingerprint"
     FROM current_inputs
     LEFT JOIN hiring_episode_detection_state state
       ON state.organization_id = current_inputs.organization_id
      AND state.engine_version = $4
     WHERE
       $2::bigint IS NOT NULL
       OR current_inputs."inputFingerprint" IS DISTINCT FROM state.input_fingerprint
       OR state.next_retry_at <= NOW()
     ORDER BY
       COALESCE(state.next_retry_at, '-infinity'::timestamptz) ASC,
       current_inputs.organization_id::TEXT
     LIMIT $3`,
    [
      new Date(
        now.getTime() -
          DEFAULT_HIRING_EPISODE_CONFIG.historyWindowDays * 24 * 60 * 60 * 1000,
      ).toISOString(),
      options.organizationId == null ? null : String(options.organizationId),
      batchSize,
      HIRING_EPISODE_ENGINE_VERSION,
    ],
  )

  const detector = new HiringEpisodeDetectionService()
  const persistPreview = shouldPersistPreview(options)
  for (const organization of organizations.rows) {
    stats.scanned += 1
    try {
      const signalsResult = await db.query<SignalRow>(
        `SELECT
           s.id::TEXT AS id,
           s.org_id::TEXT AS "organizationId",
           s.signal_type::TEXT AS "signalType",
           COALESCE(
             NULLIF(s.payload->>'vacancy_name', ''),
             NULLIF(s.payload->>'title', ''),
             s.headline
           ) AS title,
           COALESCE(
             NULLIF(s.payload->>'area_name', ''),
             NULLIF(s.payload->>'location', '')
           ) AS region,
           s.source,
           s.source_url AS "sourceUrl",
           s.external_id AS "externalVacancyId",
           s.occurred_at::TEXT AS "occurredAt",
           COALESCE(
             ARRAY_AGG(DISTINCT ei.id::TEXT)
               FILTER (WHERE ei.id IS NOT NULL),
             ARRAY[]::TEXT[]
           ) AS "evidenceIds"
         FROM signals s
         LEFT JOIN evidence_items ei
           ON ei.org_id = s.org_id
          AND ei.url = s.source_url
         WHERE s.org_id = $1
           AND s.signal_type = 'job_posting'
           AND s.occurred_at >= $2::timestamptz
         GROUP BY s.id
         ORDER BY s.occurred_at ASC, s.id ASC`,
        [
          organization.organizationId,
          new Date(
            now.getTime() -
              DEFAULT_HIRING_EPISODE_CONFIG.historyWindowDays *
                24 *
                60 *
                60 *
                1000,
          ).toISOString(),
        ],
      )
      const signals = signalsResult.rows.map(mapHiringSignal)
      const candidates = detector.detectOrganization({
        organizationId: organization.organizationId,
        signals,
        now,
      })

      if (candidates.length === 0) stats.skipped += 1
      const managesTransaction = !stats.dryRun && !shouldPersistPreview(options)
      if (managesTransaction) {
        await db.query('BEGIN')
      }
      if (!stats.dryRun || persistPreview) {
        await db.query(
          `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
          [`opportunity:detect:organization:${organization.organizationId}`],
        )
        const closedMissing = await closeMissingActiveEpisodes(
          organization.organizationId,
          candidates.map((candidate) => candidate.episodeIdentity),
          now,
          db,
        )
        stats.updated += closedMissing
      }
      for (const candidate of candidates) {
        if (stats.dryRun && !persistPreview) {
          stats.created += 1
          continue
        }
        const stored = await upsertEpisode(candidate, db)
        if (stored.inserted) stats.created += 1
        else stats.updated += 1
        if (stored.continued) stats.continued += 1
        stats.reconciled += 1
        logEvent(
          stored.inserted
            ? 'hiring_episode.generation_created'
            : 'hiring_episode.continued',
          {
            hiringEpisodeId: stored.id,
            organizationId: candidate.organizationId,
            episodeType: candidate.episodeType,
            episodeGeneration: stored.generation,
            preview: persistPreview,
          },
        )
      }
      if (!stats.dryRun || persistPreview) {
        await markDetectionState(organization, db)
      }
      if (managesTransaction) {
        await db.query('COMMIT')
      }
    } catch (error) {
      stats.failed += 1
      if (!stats.dryRun && !shouldPersistPreview(options)) {
        await db.query('ROLLBACK').catch(() => undefined)
      }
      if (!stats.dryRun || persistPreview) {
        await markDetectionFailure(organization, db).catch((checkpointError) => {
          logError('opportunity.job.failure_checkpoint_failed', checkpointError, {
            job: 'detect-hiring-episodes',
            organizationId: organization.organizationId,
          })
        })
      }
      logError('opportunity.job.entity_failed', error, {
        job: 'detect-hiring-episodes',
        organizationId: organization.organizationId,
      })
    }
  }

  logJobCompleted('detect-hiring-episodes', stats)
  return stats
}

export async function buildOpportunitiesJob(
  options: OpportunityJobOptions = {},
  db: OpportunityJobDb | null = null,
): Promise<OpportunityJobStats> {
  const stats = createStats(options)
  if (!stats.enabled) return disabledJob('build-opportunities', stats)
  return runWithJobLock(
    'build',
    'build-opportunities',
    options,
    db,
    (lockedDb) => runBuildOpportunitiesJob(options, lockedDb),
  )
}

async function runBuildOpportunitiesJob(
  options: OpportunityJobOptions = {},
  db: OpportunityJobDb,
): Promise<OpportunityJobStats> {
  const stats = createStats(options)

  const now = options.now ?? new Date()
  const batchSize = clampOpportunityJobBatchSize(
    options.batchSize ?? OPPORTUNITY_ENGINE_LIMITS.defaultJobBatchSize,
  )
  logEvent('opportunity.job.started', {
    job: 'build-opportunities',
    dryRun: stats.dryRun,
    batchSize,
  })

  const scoringSelection = createOpportunityScoringSelection(options)

  const result = await db.query<OpportunityBuildRow>(
    `${OPPORTUNITY_BUILD_QUERY}
     WHERE he.status = 'active'
       AND cp.is_active = TRUE
       AND cp.owner_id IS NOT NULL
       AND ($1::bigint IS NULL OR he.organization_id = $1)
       AND dc.created_at >= he.started_at
       AND dc.created_at >= he.last_seen_at
       AND dc.created_at >= cp.updated_at
       AND (
         build_failure.next_retry_at IS NULL
         OR build_failure.next_retry_at <= NOW()
       )
        AND NOT EXISTS (
          SELECT 1
          FROM hiring_episode_evidence episode_source
          LEFT JOIN signals source_signal
            ON source_signal.id = episode_source.signal_id
          LEFT JOIN evidence_items source_evidence
            ON source_evidence.id = episode_source.evidence_id
          WHERE episode_source.hiring_episode_id = he.id
            AND NOT (
              dc.source_families ? COALESCE(
                source_signal.source,
                source_evidence.source
              )
            )
        )
     ORDER BY
       (build_failure.next_retry_at IS NOT NULL) ASC,
       build_failure.next_retry_at ASC NULLS FIRST,
       he.last_seen_at DESC,
       he.id DESC,
       cp.id DESC
     LIMIT $2`,
    [
      options.organizationId == null ? null : String(options.organizationId),
      batchSize,
      scoringSelection.forcedVersion,
      scoringSelection.globalV2,
      scoringSelection.canaryWorkspaceId,
    ],
  )

  const scorer = new OpportunityScoringService()
  const scorerV2 = new OpportunityScoringV2Service()
  const briefBuilder = new OpportunityBriefBuilder()
  const strategist = new OpportunityStrategistV1()
  const persistPreview = shouldPersistPreview(options)
  for (const row of result.rows) {
    stats.scanned += 1
    try {
      const scoringVersion = resolveOpportunityScoringVersion(
        row,
        scoringSelection,
      )
      const scoringV2Shadow = scoringVersion === OPPORTUNITY_SCORING_VERSION_V1 &&
        scoringSelection.shadowWorkspaceId !== null &&
        row.workspaceId === scoringSelection.shadowWorkspaceId
      const episode = mapEpisode(row)
      const payload = extractPayloadFields(row.digestPayload)
      const gate = normalizeConfidenceGate(payload.confidenceGate)
      const fiur = computeFiurForOpportunity(row, payload.contactPaths, now)
      const matchedRoles = findMatchedAgencyRoles(row)
      const matchedRoleFamilies = matchedRoles.map((role) =>
        classifyOpportunityRoleFamily(role))
      const matchedIndustries = row.organizationIndustry &&
        toStringArray(row.industries).some(
          (industry) =>
            industry.toLocaleLowerCase('ru-RU') ===
            row.organizationIndustry?.toLocaleLowerCase('ru-RU'),
        )
        ? [row.organizationIndustry]
        : []
      const matchedRegions = row.targetCity &&
        row.organizationCity &&
        row.targetCity.toLocaleLowerCase('ru-RU') ===
          row.organizationCity.toLocaleLowerCase('ru-RU')
        ? [row.organizationCity]
        : []
      const agencyDnaState = resolveAgencyDnaBuildState({
        row,
        matchedRoleFamilies,
        matchedIndustries,
        matchedRegions,
      })
      const profileExcluded = hasExplicitProfileExclusion(row) ||
        Boolean(agencyDnaState?.context.blocksOpportunity)
      const score = scorer.score({
        episode,
        fiur: {
          fit: fiur.fit,
          reachability: fiur.reachability,
          reasons: {
            fit: fiur.reasons.fit,
            reachability: fiur.reasons.reachability,
          },
        },
        confidenceGate: gate,
        confidenceScore:
          DEFAULT_OPPORTUNITY_SCORING_CONFIG.confidenceGateScores[gate],
        profileExcluded,
        now,
      })
      const scoringV2 = scoringVersion === OPPORTUNITY_SCORING_VERSION_V2 ||
        scoringV2Shadow
        ? scorerV2.score({
          episode,
          fiur: {
            fit: fiur.fit,
            reachability: fiur.reachability,
            reasons: {
              fit: fiur.reasons.fit,
              reachability: fiur.reasons.reachability,
            },
          },
          confidenceGate: gate,
          confidenceScore:
            DEFAULT_OPPORTUNITY_SCORING_CONFIG.confidenceGateScores[gate],
          profileExcluded,
          entityResolutionVerified: hasVerifiedOrganizationIdentity(row),
          admissibleHiringEvidence: hasAdmissibleHiringEvidence(row),
          accountRestriction:
            agencyDnaState?.context.restrictionSnapshot.type ?? null,
          contactPolicyEligible: hasEligibleCorporateContact(row, payload.contactPaths),
          capabilityMatchScore: agencyDnaState
            ? scoreAgencyDnaCapabilityMatch(row, agencyDnaState.context)
            : null,
          now,
        })
        : null
      if (scoringV2Shadow) stats.scoringV2ShadowEvaluated += 1
      const brief = briefBuilder.build({
        organizationName: row.organizationName,
        episode,
        score,
        agency: {
          agencyName: row.agencyName,
          specialization: row.specialization,
          hiringMode: row.hiringMode,
          matchedRoles,
          matchedIndustries,
          matchedRegions,
          includeKeywords: toStringArray(row.includeKeywords),
          relevantFitReasons: score.components.agencyFit.reasons.map(
            (reason) => reason.message,
          ),
        },
      })
      const strategistEnabled = isOpportunityStrategistV1EnabledForContext({
        dataOwnerId: row.ownerId,
        workspaceId: row.workspaceId,
      })
      const strategistBrief = strategistEnabled
        ? strategist.build({
          organizationName: row.organizationName,
          episode,
          score: scoringV2 ?? score,
          agency: {
            specialization: row.specialization,
            matchedRoleFamilies,
            matchedIndustries,
            matchedRegions,
            hiringMode: row.hiringMode,
            organizationCompanySizeBucket:
              agencyDnaState?.context.capabilityMatches.companySizeBucket ?? null,
            caseStudies: agencyDnaState
              ? extractAgencyDnaCaseStudies(agencyDnaState.snapshot)
              : [],
          },
        })
        : null
      const briefBuilderVersion = strategistEnabled
        ? STRATEGIST_BRIEF_BUILDER_VERSION
        : BRIEF_BUILDER_VERSION
      const provenance = createOpportunityInputProvenance(
        row,
        episode,
        scoringVersion,
        agencyDnaState,
        briefBuilderVersion,
      )
      const scoringV2Provenance = scoringV2
        ? createOpportunityInputProvenance(
          row,
          episode,
          OPPORTUNITY_SCORING_VERSION_V2,
          agencyDnaState,
          briefBuilderVersion,
        )
        : null

      if (
        stats.dryRun &&
        !persistPreview &&
        row.currentInputHash === provenance.inputHash
      ) {
        stats.skipped += 1
        stats.skippedUnchanged += 1
        if (!stats.dryRun || persistPreview) {
          await clearBuildFailure(row, scoringVersion, db)
        }
        logEvent('opportunity.build.semantic_unchanged', {
          hiringEpisodeId: row.hiringEpisodeId,
          clientProfileId: row.clientProfileId,
          inputHashPrefix: provenance.inputHash.slice(0, 12),
        })
        continue
      }

      if (stats.dryRun && !persistPreview) {
        stats.created += 1
        continue
      }

      const validUntil = new Date(
        Date.parse(episode.lastSeenAt) +
          OPPORTUNITY_ENGINE_LIMITS.opportunityValidityDays *
            24 *
            60 *
            60 *
            1000,
      ).toISOString()
      const stored = await persistOpportunityBuild({
        row,
        score,
        scoringV2,
        scoringV2Provenance,
        brief,
        strategistBrief,
        fiur,
        provenance,
        matchedRoleFamilies,
        matchedIndustries,
        matchedRegions,
        agencyDnaState,
        episodeType: episode.episodeType,
        confidenceGate: gate,
        validUntil,
        now,
        db,
        manageTransaction: !persistPreview,
      })
      if (stored.skippedUnchanged) {
        stats.skipped += 1
        stats.skippedUnchanged += 1
      } else {
        if (stored.inserted) stats.created += 1
        else stats.updated += 1
        if (stored.superseded) stats.superseded += 1
        logEvent(
          stored.inserted ? 'opportunity.created' : 'opportunity.updated',
          {
            opportunityId: stored.id,
            hiringEpisodeId: row.hiringEpisodeId,
            clientProfileId: row.clientProfileId,
            organizationId: row.organizationId,
            scoringVersion,
            preview: persistPreview,
          },
        )
      }
      if (scoringV2Shadow) {
        if (stored.scoringSnapshotInserted) {
          stats.scoringV2ShadowSnapshotsCreated += 1
        }
        logEvent('opportunity.scoring_v2.shadow_evaluated', {
          opportunityId: stored.id,
          hiringEpisodeId: row.hiringEpisodeId,
          clientProfileId: row.clientProfileId,
          snapshotCreated: stored.scoringSnapshotInserted,
          inputHashPrefix: scoringV2Provenance?.inputHash.slice(0, 12),
        })
      }
    } catch (error) {
      stats.failed += 1
      if (!stats.dryRun || persistPreview) {
        await markBuildFailure(
          row,
          resolveOpportunityScoringVersion(row, scoringSelection),
          db,
        ).catch((checkpointError) => {
          logError('opportunity.job.failure_checkpoint_failed', checkpointError, {
            job: 'build-opportunities',
            hiringEpisodeId: row.hiringEpisodeId,
            clientProfileId: row.clientProfileId,
          })
        })
      }
      logError('opportunity.job.entity_failed', error, {
        job: 'build-opportunities',
        hiringEpisodeId: row.hiringEpisodeId,
        clientProfileId: row.clientProfileId,
      })
    }
  }

  logJobCompleted('build-opportunities', stats)
  return stats
}

export async function expireOpportunitiesJob(
  options: OpportunityJobOptions = {},
  db: OpportunityJobDb | null = null,
): Promise<OpportunityJobStats> {
  const stats = createStats(options)
  if (!stats.enabled) return disabledJob('expire-opportunities', stats)
  return runWithJobLock(
    'expire',
    'expire-opportunities',
    options,
    db,
    (lockedDb) => runExpireOpportunitiesJob(options, lockedDb),
  )
}

async function runExpireOpportunitiesJob(
  options: OpportunityJobOptions = {},
  db: OpportunityJobDb,
): Promise<OpportunityJobStats> {
  const stats = createStats(options)

  const now = options.now ?? new Date()
  if (stats.dryRun) {
    const preview = await db.query<{ count: string }>(
      `${EXPIRABLE_COUNT_QUERY}`,
      [now.toISOString(), options.organizationId ?? null],
    )
    stats.scanned = Number(preview.rows[0]?.count ?? 0)
    stats.expired = stats.scanned
    logJobCompleted('expire-opportunities', stats)
    return stats
  }

  await db.query('BEGIN')
  try {
  const closed = await db.query<{ id: string; organizationId: string }>(
    `UPDATE hiring_episodes
     SET status = 'closed', closed_at = $1::timestamptz, updated_at = NOW()
     WHERE status = 'active'
       AND last_seen_at < $1::timestamptz - ($2 * INTERVAL '1 day')
       AND ($3::bigint IS NULL OR organization_id = $3)
     RETURNING id::TEXT AS id, organization_id::TEXT AS "organizationId"`,
    [
      now.toISOString(),
      DEFAULT_HIRING_EPISODE_CONFIG.inactivityCloseDays,
      options.organizationId ?? null,
    ],
  )
  const awakenedCandidates = await db.query<{
    id: string
    ownerId: string
    organizationId: string
    clientProfileId: string
    hiringEpisodeId: string
    snoozedUntil: string
  }>(
    `SELECT
       o.id::TEXT AS id,
       o.owner_id::TEXT AS "ownerId",
       o.organization_id::TEXT AS "organizationId",
       o.client_profile_id::TEXT AS "clientProfileId",
       o.hiring_episode_id::TEXT AS "hiringEpisodeId",
       COALESCE(
         outcome_state.snoozed_until,
         o.snoozed_until
       )::TEXT AS "snoozedUntil"
     FROM opportunities o
     JOIN hiring_episodes he ON he.id = o.hiring_episode_id
     LEFT JOIN opportunity_outcome_state outcome_state
       ON outcome_state.owner_id = o.owner_id
      AND outcome_state.opportunity_id = o.id
     WHERE he.id = o.hiring_episode_id
       AND o.superseded_at IS NULL
       AND he.status = 'active'
       AND COALESCE(
         outcome_state.workflow_state,
         CASE WHEN o.status = 'snoozed' THEN 'snoozed' ELSE 'active' END
       ) = 'snoozed'
       AND COALESCE(
         outcome_state.commercial_stage,
         CASE
           WHEN o.status IN (
             'new', 'review', 'accepted', 'contacted', 'replied',
             'meeting', 'proposal', 'won', 'lost', 'dismissed'
           ) THEN o.status
           ELSE 'new'
         END
       ) NOT IN ('won', 'lost', 'dismissed')
       AND COALESCE(outcome_state.snoozed_until, o.snoozed_until)
         <= $1::timestamptz
       AND (o.valid_until IS NULL OR o.valid_until >= $1::timestamptz)
       AND ($2::bigint IS NULL OR o.organization_id = $2)
     ORDER BY o.owner_id, o.id`,
    [now.toISOString(), options.organizationId ?? null],
  )
  const awakenedRows = []
  for (const candidate of awakenedCandidates.rows) {
    if (isOpportunityOutcomesEnabled()) {
      const resumed = await recordOpportunityOutcomeInTransaction({
        ownerId: candidate.ownerId,
        opportunityId: candidate.id,
        actorType: 'system',
        validationNow: now,
        payload: {
          eventType: 'resumed',
          occurredAt: now.toISOString(),
          reasonCode: null,
          reasonNote: null,
          channel: null,
          contactPathType: null,
          contactReference: null,
          snoozeDays: null,
          snoozedUntil: null,
          revertsEventId: null,
          valueMinor: null,
          currency: null,
          metadata: { source: 'snooze_expiry' },
          idempotencyKey: `system-resume:${candidate.id}:${candidate.snoozedUntil}`,
        },
      }, db)
      if (resumed) awakenedRows.push(candidate)
    } else {
      await db.query(
        `UPDATE opportunities
         SET status = 'new', snoozed_until = NULL, updated_at = NOW()
         WHERE id = $1 AND owner_id = $2 AND status = 'snoozed'`,
        [candidate.id, candidate.ownerId],
      )
      awakenedRows.push(candidate)
    }
  }
  const awakened = {
    rows: awakenedRows,
    rowCount: awakenedRows.length,
  }
  if (awakened.rows.length > 0 && !isOpportunityOutcomesEnabled()) {
    await db.query(
      `DELETE FROM client_episode_state
       WHERE (client_profile_id, owner_id, hiring_episode_id) IN (
          SELECT *
          FROM UNNEST($1::bigint[], $2::bigint[], $3::bigint[])
        )
         AND status = 'snoozed'`,
      [
        awakened.rows.map((row) => row.clientProfileId),
        awakened.rows.map((row) => row.ownerId),
        awakened.rows.map((row) => row.hiringEpisodeId),
      ],
    )
  }
  const expired = await db.query<{
    id: string
    ownerId: string
    organizationId: string
    clientProfileId: string
    hiringEpisodeId: string
  }>(
    `UPDATE opportunities o
     SET status = 'expired', updated_at = NOW()
     FROM hiring_episodes he
     WHERE he.id = o.hiring_episode_id
       AND o.superseded_at IS NULL
       AND (
         o.status IN ('new', 'review', 'snoozed')
         OR EXISTS (
           SELECT 1
           FROM opportunity_outcome_state outcome_state
           WHERE outcome_state.owner_id = o.owner_id
             AND outcome_state.opportunity_id = o.id
             AND outcome_state.workflow_state = 'snoozed'
         )
       )
       AND (he.status = 'closed' OR o.valid_until < $1::timestamptz)
       AND ($2::bigint IS NULL OR o.organization_id = $2)
     RETURNING
        o.id::TEXT AS id,
        o.owner_id::TEXT AS "ownerId",
       o.organization_id::TEXT AS "organizationId",
       o.client_profile_id::TEXT AS "clientProfileId",
       o.hiring_episode_id::TEXT AS "hiringEpisodeId"`,
    [now.toISOString(), options.organizationId ?? null],
  )
  if (expired.rows.length > 0) {
    await db.query(
      `DELETE FROM client_episode_state
       WHERE (client_profile_id, owner_id, hiring_episode_id) IN (
          SELECT *
          FROM UNNEST($1::bigint[], $2::bigint[], $3::bigint[])
        )
         AND status = 'snoozed'`,
      [
        expired.rows.map((row) => row.clientProfileId),
        expired.rows.map((row) => row.ownerId),
        expired.rows.map((row) => row.hiringEpisodeId),
      ],
    )
  }
  await db.query('COMMIT')
  stats.scanned =
    (closed.rowCount ?? 0) +
    (awakened.rowCount ?? 0) +
    (expired.rowCount ?? 0)
  stats.expired = expired.rowCount ?? 0
  stats.updated = (closed.rowCount ?? 0) + (awakened.rowCount ?? 0)
  stats.resumed = awakened.rowCount ?? 0
  for (const opportunity of awakened.rows) {
    const latency = Math.max(
      0,
      now.getTime() - Date.parse(opportunity.snoozedUntil),
    )
    if (Number.isFinite(latency)) {
      stats.resumeLatencyMsTotal += latency
      stats.resumeLatencyMsMax = Math.max(stats.resumeLatencyMsMax, latency)
    }
  }
  for (const episode of closed.rows) {
    logEvent('hiring_episode.closed', {
      hiringEpisodeId: episode.id,
      organizationId: episode.organizationId,
    })
  }
  for (const opportunity of awakened.rows) {
    logEvent('opportunity.updated', {
      opportunityId: opportunity.id,
      clientProfileId: opportunity.clientProfileId,
      organizationId: opportunity.organizationId,
      reason: 'snooze_elapsed',
    })
  }
  for (const opportunity of expired.rows) {
    logEvent('opportunity.expired', {
      opportunityId: opportunity.id,
      clientProfileId: opportunity.clientProfileId,
      organizationId: opportunity.organizationId,
    })
  }
  logJobCompleted('expire-opportunities', stats)
  return stats
  } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined)
    throw error
  }
}

export async function backfillOpportunitiesJob(
  options: OpportunityJobOptions = {},
  db: OpportunityJobDb | null = null,
): Promise<{
  detection: OpportunityJobStats
  opportunities: OpportunityJobStats
}> {
  if (db || !createStats(options).enabled) {
    return runBackfillOpportunitiesJob(options, db)
  }
  const client = await getClient()
  if (!client) throw new Error('DATABASE_URL is not set.')
  const lockKeys = [
    OPPORTUNITY_JOB_LOCK_KEYS.backfill,
    OPPORTUNITY_JOB_LOCK_KEYS.detect,
    OPPORTUNITY_JOB_LOCK_KEYS.build,
    OPPORTUNITY_JOB_LOCK_KEYS.expire,
  ]
  const acquiredLockKeys: number[] = []
  try {
    for (const lockKey of lockKeys) {
      const result = await client.query<{ locked: boolean }>(
        `SELECT pg_try_advisory_lock($1::bigint) AS locked`,
        [lockKey],
      )
      if (result.rows[0]?.locked !== true) {
        const detection = createStats(options)
        detection.locked = 1
        detection.skippedBecauseLocked = true
        const opportunities = { ...detection }
        logEvent('opportunity.job.locked', {
          job: 'backfill-opportunities',
          lockKey,
        })
        return { detection, opportunities }
      }
      acquiredLockKeys.push(lockKey)
    }
    return runBackfillOpportunitiesJob(options, client)
  } finally {
    for (const lockKey of acquiredLockKeys.reverse()) {
      await client.query(`SELECT pg_advisory_unlock($1::bigint)`, [lockKey])
        .catch((error) => {
          logError('opportunity.job.unlock_failed', error, {
            job: 'backfill-opportunities',
            lockKey,
          })
        })
    }
    client.release()
  }
}

async function runBackfillOpportunitiesJob(
  options: OpportunityJobOptions = {},
  db: OpportunityJobDb | null = null,
): Promise<{
  detection: OpportunityJobStats
  opportunities: OpportunityJobStats
}> {
  const enabled = isOpportunityEngineV1Enabled() && options.enabled !== false
  if (!enabled) {
    const disabledOptions = { ...options, dryRun: options.dryRun !== false }
    return {
      detection: await detectHiringEpisodesJob(disabledOptions, db),
      opportunities: await buildOpportunitiesJob(disabledOptions, db),
    }
  }

  const dryRun = options.dryRun !== false
  if (!dryRun) {
    const database = db ?? getPool()
    if (!database) throw new Error('DATABASE_URL is not set.')
    return {
      detection: await detectHiringEpisodesJob({ ...options, dryRun: false }, database),
      opportunities: await buildOpportunitiesJob({ ...options, dryRun: false }, database),
    }
  }

  const ownedClient = db ? null : await getClient()
  const previewDb = db ?? ownedClient
  if (!previewDb) throw new Error('DATABASE_URL is not set.')
  const previewOptions = {
    ...options,
    dryRun: true,
    transactionalPreview: true,
  }

  await previewDb.query('BEGIN')
  try {
    const detection = await detectHiringEpisodesJob(previewOptions, previewDb)
    const opportunities = await buildOpportunitiesJob(previewOptions, previewDb)
    await previewDb.query('ROLLBACK')
    return { detection, opportunities }
  } catch (error) {
    await previewDb.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    ownedClient?.release()
  }
}

async function upsertEpisode(
  candidate: HiringEpisodeCandidate,
  db: OpportunityJobDb,
): Promise<{
  id: string
  inserted: boolean
  continued: boolean
  generation: number
}> {
  const latestResult = await db.query<{
    id: string
    status: 'active' | 'closed'
    startedAt: string
    lastSeenAt: string
    episodeGeneration: number
  }>(
    `SELECT
       id::TEXT AS id,
       status,
       started_at::TEXT AS "startedAt",
       last_seen_at::TEXT AS "lastSeenAt",
       episode_generation AS "episodeGeneration"
     FROM hiring_episodes
     WHERE organization_id = $1
       AND episode_identity = $2
       AND engine_version = $3
     ORDER BY episode_generation DESC, id DESC
     LIMIT 1
     FOR UPDATE`,
    [
      candidate.organizationId,
      candidate.episodeIdentity,
      candidate.engineVersion,
    ],
  )
  const latest = latestResult.rows[0]
  const continued = isEpisodeContinuation(
    latest ?? null,
    candidate.lastSeenAt,
  )
  const generation = continued
    ? latest.episodeGeneration
    : (latest?.episodeGeneration ?? 0) + 1
  const episodeKey = `${candidate.episodeKey}:g${generation}`

  if (latest?.status === 'active' && !continued) {
    await db.query(
      `UPDATE hiring_episodes
       SET
         status = 'closed',
         closed_at = last_seen_at,
         updated_at = NOW()
       WHERE id = $1`,
      [latest.id],
    )
  }

  const result = continued
    ? await db.query<{ id: string; inserted: boolean }>(
      `UPDATE hiring_episodes
       SET
          title = $2,
          summary = $3,
          started_at = LEAST(hiring_episodes.started_at, $4::timestamptz),
          last_seen_at = GREATEST(hiring_episodes.last_seen_at, $5::timestamptz),
          closed_at = NULL,
         signal_count = $6,
         vacancy_count = $7,
         strength_score = $8,
         freshness_score = $9,
         evidence_hash = $10,
         metadata = $11::jsonb,
         updated_at = NOW()
       WHERE id = $1
       RETURNING id::TEXT AS id, FALSE AS inserted`,
      [
        latest?.id,
        candidate.title,
        candidate.summary,
        candidate.startedAt,
        candidate.lastSeenAt,
        candidate.signalCount,
        candidate.vacancyCount,
        candidate.strengthScore,
        candidate.freshnessScore,
        candidate.evidenceHash,
        JSON.stringify(candidate.metadata),
      ],
    )
    : await db.query<{ id: string; inserted: boolean }>(
      `INSERT INTO hiring_episodes (
       organization_id,
       episode_type,
       episode_key,
       episode_identity,
       episode_generation,
       title,
       summary,
       started_at,
       last_seen_at,
       signal_count,
       vacancy_count,
       strength_score,
       freshness_score,
       evidence_hash,
       engine_version,
       metadata
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7,
       $8::timestamptz, $9::timestamptz,
       $10, $11, $12, $13, $14, $15, $16::jsonb
     )
     RETURNING id::TEXT AS id, (xmax = 0) AS inserted`,
      [
        candidate.organizationId,
        candidate.episodeType,
        episodeKey,
        candidate.episodeIdentity,
        generation,
        candidate.title,
        candidate.summary,
        candidate.startedAt,
        candidate.lastSeenAt,
        candidate.signalCount,
        candidate.vacancyCount,
        candidate.strengthScore,
        candidate.freshnessScore,
        candidate.evidenceHash,
        candidate.engineVersion,
        JSON.stringify(candidate.metadata),
      ],
    )
  const episode = result.rows[0]
  if (!episode) throw new Error('Hiring episode upsert returned no row.')
  if (
    continued &&
    latest &&
    (
      Date.parse(candidate.startedAt) > Date.parse(latest.startedAt) ||
      Date.parse(candidate.lastSeenAt) < Date.parse(latest.lastSeenAt)
    )
  ) {
    logEvent('hiring_episode.bounds_preserved', {
      hiringEpisodeId: episode.id,
      organizationId: candidate.organizationId,
      startedAtPreserved: Date.parse(candidate.startedAt) > Date.parse(latest.startedAt),
      lastSeenAtPreserved: Date.parse(candidate.lastSeenAt) < Date.parse(latest.lastSeenAt),
    })
  }

  await db.query(
    `DELETE FROM hiring_episode_evidence
     WHERE hiring_episode_id = $1
       AND (
         (signal_id IS NOT NULL AND NOT (signal_id = ANY($2::bigint[])))
         OR
         (evidence_id IS NOT NULL AND NOT (evidence_id = ANY($3::bigint[])))
       )`,
    [episode.id, candidate.signalIds, candidate.evidenceIds],
  )
  if (candidate.signalIds.length > 0) {
    await db.query(
      `INSERT INTO hiring_episode_evidence (
         hiring_episode_id,
         organization_id,
         signal_id,
         relation_type
       )
       SELECT $1, $2, signal_id::bigint, 'source'
       FROM UNNEST($3::text[]) AS signal_id
       ON CONFLICT (hiring_episode_id, signal_id) DO NOTHING`,
      [episode.id, candidate.organizationId, candidate.signalIds],
    )
  }
  if (candidate.evidenceIds.length > 0) {
    await db.query(
      `INSERT INTO hiring_episode_evidence (
         hiring_episode_id,
         organization_id,
         evidence_id,
         relation_type
       )
       SELECT $1, $2, evidence_id::bigint, 'supporting'
       FROM UNNEST($3::text[]) AS evidence_id
       ON CONFLICT (hiring_episode_id, evidence_id) DO NOTHING`,
      [episode.id, candidate.organizationId, candidate.evidenceIds],
    )
  }
  const storedEvidence = await db.query<{
    signalIds: unknown
    evidenceIds: unknown
  }>(
    `SELECT
       COALESCE(
         ARRAY_AGG(signal_id::TEXT ORDER BY signal_id)
           FILTER (WHERE signal_id IS NOT NULL),
         ARRAY[]::TEXT[]
       ) AS "signalIds",
       COALESCE(
         ARRAY_AGG(evidence_id::TEXT ORDER BY evidence_id)
           FILTER (WHERE evidence_id IS NOT NULL),
         ARRAY[]::TEXT[]
       ) AS "evidenceIds"
     FROM hiring_episode_evidence
     WHERE hiring_episode_id = $1`,
    [episode.id],
  )
  const storedSignalIds = toStringArray(storedEvidence.rows[0]?.signalIds)
  const storedEvidenceIds = toStringArray(storedEvidence.rows[0]?.evidenceIds)
  const storedHash = hashEpisodeEvidence(storedSignalIds, storedEvidenceIds)
  if (storedHash !== candidate.evidenceHash) {
    throw new Error('Hiring episode evidence reconciliation hash mismatch.')
  }
  logEvent('hiring_episode.evidence_reconciled', {
    hiringEpisodeId: episode.id,
    organizationId: candidate.organizationId,
    signalCount: storedSignalIds.length,
    evidenceCount: storedEvidenceIds.length,
  })
  return {
    ...episode,
    continued,
    generation,
  }
}

async function closeMissingActiveEpisodes(
  organizationId: string,
  activeIdentities: string[],
  now: Date,
  db: OpportunityJobDb,
): Promise<number> {
  const result = await db.query<{ id: string }>(
    `UPDATE hiring_episodes
     SET status = 'closed', closed_at = $4::timestamptz, updated_at = NOW()
     WHERE organization_id = $1
       AND engine_version = $2
       AND status = 'active'
       AND episode_identity <> ALL($3::text[])
       AND last_seen_at < $4::timestamptz - ($5 * INTERVAL '1 day')
     RETURNING id::TEXT AS id`,
    [
      organizationId,
      HIRING_EPISODE_ENGINE_VERSION,
      activeIdentities,
      now.toISOString(),
      DEFAULT_HIRING_EPISODE_CONFIG.inactivityCloseDays,
    ],
  )
  for (const row of result.rows) {
    logEvent('hiring_episode.closed', {
      hiringEpisodeId: row.id,
      organizationId,
      reason: 'evidence_reconciled',
    })
  }
  return result.rowCount ?? 0
}

async function markDetectionState(
  organization: {
    organizationId: string
    lastSignalId: string
    lastSignalUpdatedAt: string
    inputFingerprint: string
  },
  db: OpportunityJobDb,
): Promise<void> {
  await db.query(
    `INSERT INTO hiring_episode_detection_state (
       organization_id,
       engine_version,
       last_signal_id,
       last_signal_updated_at,
       input_fingerprint,
       failure_count,
       next_retry_at,
       last_scanned_at
     )
     VALUES ($1, $2, $3::bigint, $4::timestamptz, $5, 0, NULL, NOW())
     ON CONFLICT (organization_id, engine_version)
     DO UPDATE SET
       last_signal_id = EXCLUDED.last_signal_id,
       last_signal_updated_at = EXCLUDED.last_signal_updated_at,
       input_fingerprint = EXCLUDED.input_fingerprint,
       failure_count = 0,
       next_retry_at = NULL,
       last_scanned_at = NOW()`,
    [
      organization.organizationId,
      HIRING_EPISODE_ENGINE_VERSION,
      organization.lastSignalId,
      organization.lastSignalUpdatedAt,
      organization.inputFingerprint,
    ],
  )
}

async function markDetectionFailure(
  organization: {
    organizationId: string
    lastSignalId: string
    lastSignalUpdatedAt: string
    inputFingerprint: string
  },
  db: OpportunityJobDb,
): Promise<void> {
  await db.query(
    `INSERT INTO hiring_episode_detection_state (
       organization_id,
       engine_version,
       last_signal_id,
       last_signal_updated_at,
       input_fingerprint,
       failure_count,
       next_retry_at,
       last_scanned_at
     )
     VALUES (
       $1,
       $2,
       $3::bigint,
       $4::timestamptz,
       $5,
       1,
       NOW() + INTERVAL '5 minutes',
       NOW()
     )
     ON CONFLICT (organization_id, engine_version)
     DO UPDATE SET
       last_signal_id = EXCLUDED.last_signal_id,
       last_signal_updated_at = EXCLUDED.last_signal_updated_at,
       input_fingerprint = EXCLUDED.input_fingerprint,
       failure_count = hiring_episode_detection_state.failure_count + 1,
       next_retry_at = NOW() + INTERVAL '5 minutes',
       last_scanned_at = NOW()`,
    [
      organization.organizationId,
      HIRING_EPISODE_ENGINE_VERSION,
      organization.lastSignalId,
      organization.lastSignalUpdatedAt,
      organization.inputFingerprint,
    ],
  )
}

async function persistOpportunityBuild(input: {
  row: OpportunityBuildRow
  score: OpportunityScoreResult
  scoringV2: OpportunityScoringV2Result | null
  scoringV2Provenance: OpportunityInputProvenance | null
  brief: OpportunityBrief
  strategistBrief: OpportunityStrategistBrief | null
  fiur: ReturnType<typeof computeFiurForOpportunity>
  provenance: OpportunityInputProvenance
  matchedRoleFamilies: readonly string[]
  matchedIndustries: readonly string[]
  matchedRegions: readonly string[]
  agencyDnaState: AgencyDnaBuildState | null
  episodeType: string
  confidenceGate: string
  validUntil: string
  now: Date
  db: OpportunityJobDb
  manageTransaction: boolean
}): Promise<{
  id: string
  inserted: boolean
  superseded: boolean
  skippedUnchanged: boolean
  scoringSnapshotInserted: boolean
}> {
  const {
    row,
    score,
    scoringV2,
    scoringV2Provenance,
    brief,
    strategistBrief,
    fiur,
    provenance,
    matchedRoleFamilies,
    matchedIndustries,
    matchedRegions,
    agencyDnaState,
    episodeType,
    confidenceGate,
    db,
  } = input
  const activeScoringV2 = provenance.scoringVersion ===
    OPPORTUNITY_SCORING_VERSION_V2
    ? scoringV2
    : null
  if (input.manageTransaction) await db.query('BEGIN')
  try {
    if (isOpportunityOutcomesEnabled()) {
      await lockOutcomeOwnerShared(db, row.ownerId)
    }
    const currentResult = await db.query<{
      id: string
      inputHash: string
      scoringVersion: string
      status: OpportunityScoreResult['status']
      snoozedUntil: string | null
    }>(
      `SELECT
         id::TEXT AS id,
         input_hash AS "inputHash",
         scoring_version AS "scoringVersion",
         status,
         snoozed_until::TEXT AS "snoozedUntil"
       FROM opportunities
         WHERE client_profile_id = $1
          AND hiring_episode_id = $2
          AND owner_id = $3
         AND superseded_at IS NULL
       LIMIT 1
       FOR UPDATE`,
      [row.clientProfileId, row.hiringEpisodeId, row.ownerId],
    )
    const current = currentResult.rows[0]

    type LockedEpisodeState = {
      status: 'accepted' | 'dismissed' | 'snoozed' | 'contacted'
      suppressedUntil: string | null
    }
    const episodeStateResult = await db.query<LockedEpisodeState>(
      `SELECT
         status,
         suppressed_until::TEXT AS "suppressedUntil"
       FROM client_episode_state
        WHERE client_profile_id = $1
          AND hiring_episode_id = $2
          AND owner_id = $3
       LIMIT 1
       FOR UPDATE`,
      [row.clientProfileId, row.hiringEpisodeId, row.ownerId],
    )
    let lockedEpisodeState: LockedEpisodeState | null =
      episodeStateResult.rows[0] ?? null
    let elapsedSnoozeCleared = false
    let resumedLegacyStatus:
      'new' | 'review' | 'accepted' | 'dismissed' | 'contacted' | null = null
    if (!lockedEpisodeState && current?.status === 'snoozed') {
      const deadline = Date.parse(current.snoozedUntil ?? '')
      if (Number.isFinite(deadline) && deadline > input.now.getTime()) {
        await db.query(
          `INSERT INTO client_episode_state (
             client_profile_id,
             owner_id,
             hiring_episode_id,
             organization_id,
             status,
             suppressed_until
           )
           VALUES ($1, $2, $3, $4, 'snoozed', $5::timestamptz)
           ON CONFLICT (client_profile_id, hiring_episode_id) DO NOTHING`,
          [
            row.clientProfileId,
            row.ownerId,
            row.hiringEpisodeId,
            row.organizationId,
            current.snoozedUntil,
          ],
        )
        lockedEpisodeState = {
          status: 'snoozed',
          suppressedUntil: current.snoozedUntil,
        }
        logEvent('opportunity.snooze_state_repaired', {
          hiringEpisodeId: row.hiringEpisodeId,
          clientProfileId: row.clientProfileId,
        })
      } else {
        lockedEpisodeState = {
          status: 'snoozed',
          suppressedUntil: current.snoozedUntil,
        }
      }
    }
    if (lockedEpisodeState?.status === 'snoozed') {
      const deadline = Date.parse(lockedEpisodeState.suppressedUntil ?? '')
      if (!Number.isFinite(deadline)) {
        throw new Error('Snoozed episode state has an invalid suppressed_until.')
      }
      if (deadline <= input.now.getTime()) {
        if (isOpportunityOutcomesEnabled() && current) {
          const resumed = await recordOpportunityOutcomeInTransaction({
            ownerId: row.ownerId,
            opportunityId: current.id,
            actorType: 'system',
            ownerLockHeld: true,
            validationNow: input.now,
            payload: {
              eventType: 'resumed',
              occurredAt: input.now.toISOString(),
              reasonCode: null,
              reasonNote: null,
              channel: null,
              contactPathType: null,
              contactReference: null,
              snoozeDays: null,
              snoozedUntil: null,
              revertsEventId: null,
              valueMinor: null,
              currency: null,
              metadata: { source: 'snooze_expiry' },
              idempotencyKey:
                `system-resume:${current.id}:${lockedEpisodeState.suppressedUntil}`,
            },
          }, db)
          if (!resumed) {
            throw new Error('Snoozed opportunity could not be resumed.')
          }
          resumedLegacyStatus = toLegacyOutcomeStatus(
            resumed.state.commercialStage,
          )
        } else {
          await db.query(
            `DELETE FROM client_episode_state
              WHERE client_profile_id = $1
                AND hiring_episode_id = $2
                AND owner_id = $3
                AND status = 'snoozed'
                AND suppressed_until <= $4::timestamptz`,
             [
               row.clientProfileId,
               row.hiringEpisodeId,
               row.ownerId,
               input.now.toISOString(),
             ],
          )
        }
        logEvent('opportunity.snooze_elapsed_during_build', {
          hiringEpisodeId: row.hiringEpisodeId,
          clientProfileId: row.clientProfileId,
        })
        lockedEpisodeState = null
        elapsedSnoozeCleared = true
      }
    }
    const lockedEpisodeStatus = lockedEpisodeState?.status ?? null

    if (current?.inputHash === provenance.inputHash && !elapsedSnoozeCleared) {
      const scoringSnapshotInserted = scoringV2 && scoringV2Provenance
        ? await persistOpportunityScoringSnapshot({
          opportunityId: current.id,
          row,
          score,
          scoringV2,
          provenance: scoringV2Provenance,
          db,
        })
        : false
      await clearBuildFailure(row, provenance.scoringVersion, db)
      if (input.manageTransaction) await db.query('COMMIT')
      logEvent('opportunity.build.semantic_unchanged', {
        opportunityId: current.id,
        hiringEpisodeId: row.hiringEpisodeId,
        clientProfileId: row.clientProfileId,
        inputHashPrefix: provenance.inputHash.slice(0, 12),
      })
      return {
        id: current.id,
        inserted: false,
        superseded: false,
        skippedUnchanged: true,
        scoringSnapshotInserted,
      }
    }

    const preservedStatus =
      resumedLegacyStatus ??
      lockedEpisodeStatus ??
      (
        current?.status &&
        ['accepted', 'dismissed', 'snoozed', 'contacted'].includes(current.status) &&
        !(elapsedSnoozeCleared && current.status === 'snoozed')
          ? current.status
          : activeScoringV2?.status ?? score.status
      )
    const preservedSnoozedUntil = preservedStatus === 'snoozed'
      ? lockedEpisodeState?.suppressedUntil ?? null
      : null
    if (preservedStatus === 'snoozed' && !preservedSnoozedUntil) {
      throw new Error('Snoozed episode state is missing suppressed_until.')
    }
    const activeComponents = activeScoringV2?.components ?? score.components
    const activeRankingScore = activeScoringV2?.rankingScore ?? score.opportunityScore
    const actionQueueEligible = activeScoringV2?.isActionQueueEligible ??
      score.isMorningBriefEligible
    const featureSchemaVersion = activeScoringV2?.featureSchemaVersion ??
      OPPORTUNITY_FEATURE_SCHEMA_V1
    const gateVersion = activeScoringV2?.gateVersion ?? OPPORTUNITY_GATE_VERSION_V1
    const hardGateResults = activeScoringV2?.hardGates ?? []
    const metadata = JSON.stringify({
      morningBriefEligible: actionQueueEligible,
      actionQueueEligible,
      components: activeComponents,
      hardGates: hardGateResults,
      sourceFamilies: toStringArray(row.sourceFamilies),
      agencyFitExplanation: brief.agencyFitExplanation,
      limitations: brief.limitations,
      ...(strategistBrief ? { strategistBrief } : {}),
      modelType: 'heuristic',
      calibrationStatus: 'uncalibrated',
      digestReasons: row.digestReasons,
      analyticsCohort: createOpportunityAnalyticsCohort({
        clientProfileId: row.clientProfileId,
        clientProfileVersion: provenance.profileSnapshotHash,
        agencyDnaVersion: provenance.agencyDnaVersion === null
          ? provenance.profileSnapshotHash
          : String(provenance.agencyDnaVersion),
        hiringMode: row.hiringMode,
        specialization: row.specialization,
        matchedRoleFamilies,
        matchedIndustries,
        matchedRegions,
        organizationSizeBucket: 'unknown',
        episodeType,
        confidenceGate,
        opportunityScore: activeRankingScore,
        externalSupportNeedScore: activeComponents.externalSupportNeed.score,
        sourceFamilies: toStringArray(row.sourceFamilies),
        scoringVersion: provenance.scoringVersion,
      }),
      fiur: {
        fit: fiur.fit,
        intent: fiur.intent,
        urgency: fiur.urgency,
        reachability: fiur.reachability,
        total: fiur.total,
      },
    })
    const values = [
      row.ownerId,
      row.clientProfileId,
      row.organizationId,
      row.hiringEpisodeId,
      preservedStatus,
      brief.title,
      brief.whyNow,
      brief.problemHypothesis,
      brief.recommendedAngle,
      brief.recommendedPersona,
      brief.recommendedAction,
      activeComponents.agencyFit.score,
      score.components.hiringIntent.score,
      score.components.externalSupportNeed.score,
      score.components.timing.score,
      score.components.reachability.score,
      score.components.confidence.score,
      activeRankingScore,
      score.confidenceGate,
      provenance.scoringVersion,
      provenance.episodeEvidenceHash,
      input.validUntil,
      metadata,
      provenance.episodeEvidenceHash,
      provenance.profileSnapshotHash,
      provenance.digestCandidateId,
      provenance.fiurVersion,
      provenance.scoringConfigHash,
      provenance.briefBuilderVersion,
      provenance.inputHash,
      preservedSnoozedUntil,
      provenance.agencyDnaVersion,
      featureSchemaVersion,
      gateVersion,
      JSON.stringify(activeComponents),
      JSON.stringify(hardGateResults),
      activeRankingScore,
      actionQueueEligible,
    ] as const

    let superseded = false
    let reusableOpportunityId: string | null = null
    if (current && current.scoringVersion !== provenance.scoringVersion) {
      const reusableResult = await db.query<{ id: string }>(
        `SELECT id::TEXT AS id
         FROM opportunities
          WHERE client_profile_id = $1
            AND hiring_episode_id = $2
            AND scoring_version = $3
            AND owner_id = $4
           AND superseded_at IS NOT NULL
         ORDER BY updated_at DESC, id DESC
         LIMIT 1
         FOR UPDATE`,
        [
          row.clientProfileId,
          row.hiringEpisodeId,
          provenance.scoringVersion,
          row.ownerId,
        ],
      )
      reusableOpportunityId = reusableResult.rows[0]?.id ?? null
      await db.query(
        `UPDATE opportunities
         SET superseded_at = NOW(), updated_at = NOW()
          WHERE id = $1
            AND owner_id = $2
            AND superseded_at IS NULL`,
        [current.id, row.ownerId],
      )
      superseded = true
      logEvent('opportunity.superseded', {
        opportunityId: current.id,
        hiringEpisodeId: row.hiringEpisodeId,
        clientProfileId: row.clientProfileId,
        previousScoringVersion: current.scoringVersion,
        newScoringVersion: provenance.scoringVersion,
      })
    }

    const updateTargetId = current && !superseded
      ? current.id
      : reusableOpportunityId
    const stored = updateTargetId
      ? await db.query<{ id: string }>(
        `UPDATE opportunities
         SET
           owner_id = $2,
           client_profile_id = $3,
           organization_id = $4,
           hiring_episode_id = $5,
           status = $6,
           title = $7,
           why_now = $8,
           problem_hypothesis = $9,
           recommended_angle = $10,
           recommended_persona = $11,
           recommended_action = $12,
           agency_fit_score = $13,
           hiring_intent_score = $14,
           agency_propensity_score = $15,
           timing_score = $16,
           reachability_score = $17,
           confidence_score = $18,
           opportunity_score = $19,
           confidence_gate = $20,
           scoring_version = $21,
           evidence_hash = $22,
           valid_until = $23,
           metadata = $24::jsonb,
           episode_evidence_hash = $25,
           profile_snapshot_hash = $26,
           digest_candidate_id = $27,
           fiur_version = $28,
           scoring_config_hash = $29,
           brief_builder_version = $30,
            input_hash = $31,
            snoozed_until = $32::timestamptz,
            agency_dna_version = $33,
            feature_schema_version = $34,
            gate_version = $35,
            component_scores = $36::jsonb,
            hard_gate_results = $37::jsonb,
            ranking_score = $38,
            action_queue_eligible = $39,
            superseded_at = NULL,
           updated_at = NOW()
          WHERE id = $1
            AND owner_id = $2
          RETURNING id::TEXT AS id`,
        [updateTargetId, ...values],
      )
      : await db.query<{ id: string }>(
        `INSERT INTO opportunities (
           owner_id,
           client_profile_id,
           organization_id,
           hiring_episode_id,
           status,
           title,
           why_now,
           problem_hypothesis,
           recommended_angle,
           recommended_persona,
           recommended_action,
           agency_fit_score,
           hiring_intent_score,
           agency_propensity_score,
           timing_score,
           reachability_score,
           confidence_score,
           opportunity_score,
           confidence_gate,
           scoring_version,
           evidence_hash,
           valid_until,
           metadata,
           episode_evidence_hash,
           profile_snapshot_hash,
           digest_candidate_id,
           fiur_version,
           scoring_config_hash,
           brief_builder_version,
           input_hash,
           snoozed_until,
           agency_dna_version,
           feature_schema_version,
           gate_version,
           component_scores,
           hard_gate_results,
           ranking_score,
           action_queue_eligible
         )
         VALUES (
           $1, $2, $3, $4, $5,
           $6, $7, $8, $9, $10, $11,
           $12, $13, $14, $15, $16, $17, $18,
           $19, $20, $21, $22, $23::jsonb,
            $24, $25, $26, $27, $28, $29, $30,
            $31::timestamptz, $32, $33, $34,
            $35::jsonb, $36::jsonb, $37, $38
         )
         RETURNING id::TEXT AS id`,
        values,
      )
    const storedRow = stored.rows[0]
    if (!storedRow) throw new Error('Opportunity persistence returned no row.')
    if (agencyDnaState) {
      await persistAgencyDnaSnapshot({
        opportunityId: storedRow.id,
        opportunityInputHash: provenance.inputHash,
        row,
        agencyDnaState,
        fitExplanation: brief.agencyFitExplanation,
        db,
      })
    }
    const scoringSnapshotInserted = scoringV2 && scoringV2Provenance
      ? await persistOpportunityScoringSnapshot({
        opportunityId: storedRow.id,
        row,
        score,
        scoringV2,
        provenance: scoringV2Provenance,
        db,
      })
      : false
    if (preservedSnoozedUntil) {
      logEvent('opportunity.snooze_preserved', {
        opportunityId: storedRow.id,
        hiringEpisodeId: row.hiringEpisodeId,
        clientProfileId: row.clientProfileId,
        scoringVersion: provenance.scoringVersion,
      })
    }
    await clearBuildFailure(row, provenance.scoringVersion, db)
    if (input.manageTransaction) await db.query('COMMIT')
    return {
      id: storedRow.id,
      inserted: !updateTargetId,
      superseded,
      skippedUnchanged: false,
      scoringSnapshotInserted,
    }
  } catch (error) {
    if (input.manageTransaction) {
      await db.query('ROLLBACK').catch(() => undefined)
    }
    throw error
  }
}

function toLegacyOutcomeStatus(
  stage: OpportunityOutcomeStage,
): 'new' | 'review' | 'accepted' | 'dismissed' | 'contacted' {
  if (
    stage === 'new' ||
    stage === 'review' ||
    stage === 'accepted' ||
    stage === 'dismissed' ||
    stage === 'contacted'
  ) {
    return stage
  }
  return 'contacted'
}

function resolveAgencyDnaBuildState(input: {
  row: OpportunityBuildRow
  matchedRoleFamilies: readonly string[]
  matchedIndustries: readonly string[]
  matchedRegions: readonly string[]
}): AgencyDnaBuildState | null {
  const { row } = input
  if (!isAgencyDnaV1EnabledForContext({
    dataOwnerId: row.ownerId,
    workspaceId: row.workspaceId,
  })) {
    return null
  }

  const version = Number(row.agencyDnaVersion)
  const snapshotHash = row.agencyDnaSnapshotHash?.trim() ?? ''
  const snapshot = asRecord(row.agencyDnaSnapshot)
  if (
    !row.workspaceId ||
    !Number.isSafeInteger(version) ||
    version <= 0 ||
    !/^[a-f0-9]{64}$/.test(snapshotHash) ||
    Object.keys(snapshot).length === 0
  ) {
    throw new Error('Agency DNA is enabled but its versioned snapshot is unavailable.')
  }

  const serviceTypes = toStringArray(row.serviceTypes).filter(
    (value): value is AgencyDnaServiceType =>
      AGENCY_DNA_SERVICE_TYPES.includes(value as AgencyDnaServiceType),
  )
  const currentCapacity = AGENCY_DNA_CAPACITIES.includes(
    row.currentCapacity as AgencyDnaCapacity,
  ) ? row.currentCapacity as AgencyDnaCapacity : 'normal'
  const context = resolveAgencyDnaOpportunityContext({
    serviceTypes,
    targetSeniorities: toStringArray(row.targetSeniorities),
    preferredEngagementTypes: toStringArray(row.preferredEngagementTypes),
    currentCapacity,
    matchedRoleFamilies: input.matchedRoleFamilies,
    matchedIndustries: input.matchedIndustries,
    matchedRegions: input.matchedRegions,
    episodeTitle: row.episodeTitle,
    vacancyCount: row.vacancyCount,
    restrictionType: row.restrictionType,
  })

  return { version, snapshotHash, snapshot, context }
}

async function persistAgencyDnaSnapshot(input: {
  opportunityId: string
  opportunityInputHash: string
  row: OpportunityBuildRow
  agencyDnaState: AgencyDnaBuildState
  fitExplanation: string
  db: OpportunityJobDb
}): Promise<void> {
  if (!input.row.workspaceId) {
    throw new Error('Agency DNA snapshot requires workspace context.')
  }
  const fitExplanation = input.fitExplanation.trim() ||
    'Agency DNA restrictions and evidenced capabilities applied.'
  await input.db.query(
    `INSERT INTO opportunity_agency_dna_snapshots (
       opportunity_id,
       owner_id,
       workspace_id,
       client_profile_id,
       agency_dna_version,
       agency_dna_snapshot_hash,
       opportunity_input_hash,
       snapshot,
       capability_matches,
       restriction_snapshot,
       fit_explanation
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7,
       $8::JSONB, $9::JSONB, $10::JSONB, $11
     )
     ON CONFLICT (
       opportunity_id,
       opportunity_input_hash,
       agency_dna_version,
       agency_dna_snapshot_hash
     ) DO NOTHING`,
    [
      input.opportunityId,
      input.row.ownerId,
      input.row.workspaceId,
      input.row.clientProfileId,
      input.agencyDnaState.version,
      input.agencyDnaState.snapshotHash,
      input.opportunityInputHash,
      JSON.stringify(input.agencyDnaState.snapshot),
      JSON.stringify(input.agencyDnaState.context.capabilityMatches),
      JSON.stringify(input.agencyDnaState.context.restrictionSnapshot),
      fitExplanation,
    ],
  )
}

async function persistOpportunityScoringSnapshot(input: {
  opportunityId: string
  row: OpportunityBuildRow
  score: OpportunityScoreResult
  scoringV2: OpportunityScoringV2Result
  provenance: OpportunityInputProvenance
  db: OpportunityJobDb
}): Promise<boolean> {
  if (!input.row.workspaceId) {
    throw new Error('Opportunity scoring snapshot requires workspace context.')
  }
  const result = await input.db.query(
    `INSERT INTO opportunity_scoring_snapshots (
       opportunity_id,
       owner_id,
       workspace_id,
       client_profile_id,
       hiring_episode_id,
       scoring_version,
       baseline_scoring_version,
       feature_schema_version,
       gate_version,
       agency_dna_version,
       profile_snapshot_hash,
       evidence_hash,
       config_hash,
       input_hash,
       comparison_input_hash,
       component_scores,
       baseline_component_scores,
       hard_gate_results,
       confidence_gate,
       ranking_score,
       baseline_ranking_score,
       action_queue_eligible
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
       $11, $12, $13, $14, $15,
       $16::jsonb, $17::jsonb, $18::jsonb, $19, $20, $21, $22
     )
     ON CONFLICT (opportunity_id, scoring_version, input_hash) DO NOTHING
     RETURNING id`,
    [
      input.opportunityId,
      input.row.ownerId,
      input.row.workspaceId,
      input.row.clientProfileId,
      input.row.hiringEpisodeId,
      input.scoringV2.scoringVersion,
      OPPORTUNITY_SCORING_VERSION_V1,
      input.scoringV2.featureSchemaVersion,
      input.scoringV2.gateVersion,
      input.provenance.agencyDnaVersion,
      input.provenance.profileSnapshotHash,
      input.provenance.episodeEvidenceHash,
      input.provenance.scoringConfigHash,
      input.provenance.inputHash,
      input.provenance.comparisonInputHash,
      JSON.stringify(input.scoringV2.components),
      JSON.stringify(input.score.components),
      JSON.stringify(input.scoringV2.hardGates),
      input.scoringV2.confidenceGate,
      input.scoringV2.rankingScore,
      input.score.opportunityScore,
      input.scoringV2.isActionQueueEligible,
    ],
  )
  return result.rowCount === 1
}

function createOpportunityInputProvenance(
  row: OpportunityBuildRow,
  episode: HiringEpisodeCandidate,
  scoringVersion: string,
  agencyDnaState: AgencyDnaBuildState | null,
  briefBuilderVersion: string,
): OpportunityInputProvenance {
  const profileSnapshotHash = agencyDnaState?.snapshotHash ??
    hashCanonicalJson({
      agencyName: row.agencyName,
      targetCity: row.targetCity,
      specialization: row.specialization,
      includeKeywords: sortSetLikeStrings(row.includeKeywords),
      excludeKeywords: sortSetLikeStrings(row.excludeKeywords),
      industries: sortSetLikeStrings(row.industries),
      companySizes: sortSetLikeStrings(row.companySizes),
      contactPolicy: row.contactPolicy,
      roles: sortSetLikeStrings(row.roles),
      excludedIndustries: sortSetLikeStrings(row.excludedIndustries),
      excludedLocations: sortSetLikeStrings(row.excludedLocations),
      remoteFriendly: row.remoteFriendly,
      hiringMode: row.hiringMode,
    })
  const scoringConfigHash = hashCanonicalJson(
    scoringVersion === OPPORTUNITY_SCORING_VERSION_V2
      ? {
        baseline: DEFAULT_OPPORTUNITY_SCORING_CONFIG,
        scoring: DEFAULT_OPPORTUNITY_SCORING_V2_CONFIG,
      }
      : DEFAULT_OPPORTUNITY_SCORING_CONFIG,
  )
  // Set-like inputs are normalized here. canonicalJsonStringify intentionally
  // preserves every other array because digest reason and workflow order can be semantic.
  const buildInputsHash = hashCanonicalJson({
    organization: {
      name: row.organizationName,
      domain: row.organizationDomain,
      websiteUrl: row.organizationWebsiteUrl,
      careerPageUrl: row.organizationCareerPageUrl,
      country: row.organizationCountry,
      industry: row.organizationIndustry,
      city: row.organizationCity,
    },
    episode: {
      episodeType: episode.episodeType,
      episodeGeneration: episode.episodeGeneration,
      title: episode.title,
      summary: episode.summary,
      startedAt: episode.startedAt,
      lastSeenAt: episode.lastSeenAt,
      signalCount: episode.signalCount,
      vacancyCount: episode.vacancyCount,
      strengthScore: episode.strengthScore,
      freshnessScore: episode.freshnessScore,
      engineVersion: episode.engineVersion,
      metadata: semanticEpisodeMetadata(episode.metadata),
    },
    signals: sortSetLikeStrings(
      toRecordArray(row.signals).map((signal) =>
        canonicalJsonStringify(withoutDatabaseId(signal))),
    ),
    evidence: sortSetLikeStrings(
      toRecordArray(row.evidence).map((item) =>
        canonicalJsonStringify(withoutDatabaseId(item))),
    ),
    digest: {
      payload: semanticDigestPayload(row.digestPayload),
      reasons: row.digestReasons,
      sourceFamilies: sortSetLikeStrings(row.sourceFamilies),
    },
  })
  const comparisonInput = {
    profileSnapshotHash,
    agencyDnaVersion: agencyDnaState?.version ?? null,
    agencyDnaRestriction: agencyDnaState?.context.restrictionSnapshot ?? null,
    buildInputsHash,
    fiurVersion: FIUR_VERSION,
    briefBuilderVersion,
  }
  const semanticInput = {
    ...comparisonInput,
    scoringVersion,
    scoringConfigHash,
  }
  return {
    episodeEvidenceHash: episode.evidenceHash,
    ...semanticInput,
    digestCandidateId: row.digestCandidateId,
    inputHash: hashCanonicalJson(semanticInput),
    comparisonInputHash: hashCanonicalJson(comparisonInput),
  }
}

function withoutDatabaseId(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const semanticValue = { ...value }
  delete semanticValue.id
  return semanticValue
}

function semanticEpisodeMetadata(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const semanticMetadata = { ...value }
  // Detector fingerprints are implementation identities. Their fallback path
  // includes organization_id, while the underlying signal content is hashed above.
  delete semanticMetadata.canonicalVacancyFingerprints
  return semanticMetadata
}

function semanticDigestPayload(value: unknown): Record<string, unknown> {
  const semanticPayload = { ...asRecord(value) }
  delete semanticPayload.corroborated_org_ids
  delete semanticPayload.corroboratedOrgIds

  const keyType = semanticPayload.corroboration_key_type ??
    semanticPayload.corroborationKeyType
  const key = semanticPayload.corroboration_key ?? semanticPayload.corroborationKey
  if (
    keyType === 'org_id' ||
    (typeof key === 'string' && /^org:\d+$/.test(key))
  ) {
    delete semanticPayload.corroboration_key
    delete semanticPayload.corroborationKey
    delete semanticPayload.corroboration_key_type
    delete semanticPayload.corroborationKeyType
  }

  return semanticPayload
}

async function clearBuildFailure(
  row: Pick<OpportunityBuildRow, 'clientProfileId' | 'hiringEpisodeId'>,
  scoringVersion: string,
  db: OpportunityJobDb,
): Promise<void> {
  await db.query(
    `DELETE FROM opportunity_build_failures
     WHERE client_profile_id = $1
       AND hiring_episode_id = $2
       AND scoring_version = $3`,
    [row.clientProfileId, row.hiringEpisodeId, scoringVersion],
  )
}

async function markBuildFailure(
  row: Pick<OpportunityBuildRow, 'clientProfileId' | 'hiringEpisodeId'>,
  scoringVersion: string,
  db: OpportunityJobDb,
): Promise<void> {
  await db.query(
    `INSERT INTO opportunity_build_failures (
       client_profile_id,
       hiring_episode_id,
       scoring_version,
       failure_count,
       next_retry_at,
       last_failed_at
     )
     VALUES ($1, $2, $3, 1, NOW() + INTERVAL '5 minutes', NOW())
     ON CONFLICT (client_profile_id, hiring_episode_id, scoring_version)
     DO UPDATE SET
       failure_count = opportunity_build_failures.failure_count + 1,
       next_retry_at = NOW() + INTERVAL '5 minutes',
       last_failed_at = NOW()`,
    [row.clientProfileId, row.hiringEpisodeId, scoringVersion],
  )
}

function mapHiringSignal(row: SignalRow): HiringSignalInput {
  return {
    id: row.id,
    organizationId: row.organizationId,
    signalType: row.signalType,
    title: row.title,
    region: row.region,
    source: row.source,
    sourceUrl: row.sourceUrl,
    externalVacancyId: row.externalVacancyId,
    occurredAt: row.occurredAt,
    evidenceIds: toStringArray(row.evidenceIds),
  }
}

function mapEpisode(row: OpportunityBuildRow): HiringEpisodeCandidate {
  return {
    organizationId: row.organizationId,
    episodeType: row.episodeType,
    episodeKey: row.episodeKey,
    episodeIdentity: row.episodeIdentity,
    episodeGeneration: row.episodeGeneration,
    title: row.episodeTitle,
    summary: row.episodeSummary,
    startedAt: row.episodeStartedAt,
    lastSeenAt: row.episodeLastSeenAt,
    signalCount: row.signalCount,
    vacancyCount: row.vacancyCount,
    strengthScore: row.strengthScore,
    freshnessScore: row.freshnessScore,
    evidenceHash: row.evidenceHash,
    engineVersion: row.engineVersion,
    signalIds: toStringArray(row.signalIds),
    evidenceIds: toStringArray(row.evidenceIds),
    metadata: asRecord(row.episodeMetadata),
  }
}

function computeFiurForOpportunity(
  row: OpportunityBuildRow,
  contactPaths: Array<{ category: string; value: string }>,
  now: Date,
) {
  const signals = toRecordArray(row.signals)
  const evidence = toRecordArray(row.evidence)
  return computeFiur({
    company: {
      id: row.organizationId,
      name: row.organizationName,
      industry: row.organizationIndustry ?? undefined,
      location: row.organizationCity ?? undefined,
      country: row.organizationCountry ?? undefined,
      hasCareerPage: Boolean(row.organizationCareerPageUrl),
      hasCorporateContactPath:
        contactPaths.length > 0 ||
        Boolean(row.organizationDomain || row.organizationWebsiteUrl),
    },
    vacancies: signals.map((signal, index) => {
      const title = stringValue(signal.title) || `Вакансия ${index + 1}`
      return {
        id: stringValue(signal.id) || `${row.hiringEpisodeId}:${index}`,
        title,
        role: classifyOpportunityRoleFamily(title),
        location: stringValue(signal.region) || undefined,
        publishedAt: stringValue(signal.occurredAt) || row.episodeLastSeenAt,
        sourceTier: normalizeEvidenceTier(signal.tier),
      }
    }),
    clientProfile: {
      industries: toStringArray(row.industries),
      roles: toStringArray(row.roles),
      locations: row.targetCity ? [row.targetCity] : [],
      companySizes: toCompanySizes(row.companySizes),
      exclusions: [
        ...toStringArray(row.excludeKeywords),
        ...toStringArray(row.excludedIndustries),
      ],
      specialization: row.specialization ?? undefined,
      includeKeywords: toStringArray(row.includeKeywords),
      contactPolicy: row.contactPolicy,
      hiringMode: resolveHiringMode({
        hiringMode: row.hiringMode,
        roles: toStringArray(row.roles),
      }),
    },
    evidence: evidence.map((item) => ({
      tier: normalizeEvidenceTier(item.tier),
      source: stringValue(item.source) || 'unknown',
    })),
    now: () => now.getTime(),
    recentSignalCount: signals.filter((signal) => {
      const occurredAt = Date.parse(stringValue(signal.occurredAt))
      return Number.isFinite(occurredAt) &&
        now.getTime() - occurredAt <= 7 * 24 * 60 * 60 * 1000
    }).length,
  })
}

function hasExplicitProfileExclusion(row: OpportunityBuildRow): boolean {
  const signals = toRecordArray(row.signals)
  const haystack = [
    row.organizationName,
    row.organizationIndustry ?? '',
    row.organizationCity ?? '',
    row.episodeTitle,
    row.episodeSummary,
    ...signals.flatMap((signal) => [
      stringValue(signal.title),
      stringValue(signal.region),
    ]),
  ].join(' ').toLocaleLowerCase('ru-RU')
  const keywordExclusions = [
    ...toStringArray(row.excludeKeywords),
    ...toStringArray(row.excludedIndustries),
  ].map((value) => value.toLocaleLowerCase('ru-RU'))
  if (keywordExclusions.some((value) => value && haystack.includes(value))) {
    return true
  }

  const locations = [
    row.organizationCity ?? '',
    ...signals.map((signal) => stringValue(signal.region)),
  ].map((value) => value.toLocaleLowerCase('ru-RU')).filter(Boolean)
  const hasRemoteSignal = row.remoteFriendly &&
    ['удал', 'remote', 'дистанцион'].some((term) => haystack.includes(term))
  if (hasRemoteSignal) return false

  return toStringArray(row.excludedLocations)
    .map((value) => value.toLocaleLowerCase('ru-RU'))
    .some((excluded) =>
      excluded &&
      locations.some((location) =>
        location.includes(excluded) || excluded.includes(location)))
}

function findMatchedAgencyRoles(row: OpportunityBuildRow): string[] {
  const episodeRoleValues = toRecordArray(row.signals).flatMap((signal) => {
    const title = stringValue(signal.title)
    return title
      ? [normalizeMatchText(title), classifyOpportunityRoleFamily(title)]
      : []
  })
  return [...new Set(toStringArray(row.roles))]
    .filter((role) => {
      const normalizedRole = normalizeMatchText(role)
      return normalizedRole && episodeRoleValues.some(
        (value) => containsNormalizedPhrase(value, normalizedRole),
      )
    })
    .sort((left, right) => left.localeCompare(right, 'ru'))
}

function normalizeMatchText(value: string): string {
  return value
    .toLocaleLowerCase('ru-RU')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function containsNormalizedPhrase(value: string, phrase: string): boolean {
  return value === phrase ||
    value.startsWith(`${phrase} `) ||
    value.endsWith(` ${phrase}`) ||
    value.includes(` ${phrase} `)
}

function createStats(options: OpportunityJobOptions): OpportunityJobStats {
  return {
    enabled: isOpportunityEngineV1Enabled() && options.enabled !== false,
    dryRun: options.dryRun === true,
    scanned: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    expired: 0,
    continued: 0,
    reconciled: 0,
    skippedUnchanged: 0,
    superseded: 0,
    resumed: 0,
    resumeLatencyMsTotal: 0,
    resumeLatencyMsMax: 0,
    locked: 0,
    skippedBecauseLocked: false,
    scoringV2ShadowEvaluated: 0,
    scoringV2ShadowSnapshotsCreated: 0,
  }
}

async function runWithJobLock(
  lockName: keyof typeof OPPORTUNITY_JOB_LOCK_KEYS,
  job: string,
  options: OpportunityJobOptions,
  providedDb: OpportunityJobDb | null,
  run: (db: OpportunityJobDb) => Promise<OpportunityJobStats>,
): Promise<OpportunityJobStats> {
  if (providedDb) return run(providedDb)

  const client = await getClient()
  if (!client) throw new Error('DATABASE_URL is not set.')
  const lockKey = OPPORTUNITY_JOB_LOCK_KEYS[lockName]
  let locked = false
  try {
    const result = await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock($1::bigint) AS locked`,
      [lockKey],
    )
    locked = result.rows[0]?.locked === true
    if (!locked) {
      const stats = createStats(options)
      stats.locked = 1
      stats.skippedBecauseLocked = true
      logEvent('opportunity.job.locked', { job, lockKey })
      logJobCompleted(job, stats)
      return stats
    }
    return await run(client)
  } finally {
    if (locked) {
      await client.query(`SELECT pg_advisory_unlock($1::bigint)`, [lockKey])
        .catch((error) => {
          logError('opportunity.job.unlock_failed', error, { job, lockKey })
        })
    }
    client.release()
  }
}

function shouldPersistPreview(options: OpportunityJobOptions): boolean {
  return (options as OpportunityJobOptions & {
    transactionalPreview?: boolean
  }).transactionalPreview === true
}

function disabledJob(job: string, stats: OpportunityJobStats): OpportunityJobStats {
  logWarn('opportunity.job.disabled', { job })
  return stats
}

function logJobCompleted(job: string, stats: OpportunityJobStats) {
  logEvent('opportunity.job.completed', { job, ...stats })
}

function normalizeConfidenceGate(value: string): ConfidenceGate {
  return value === 'A' || value === 'B' || value === 'C' ? value : 'D'
}

function createOpportunityScoringSelection(
  options: OpportunityJobOptions,
): OpportunityScoringSelection {
  const requestedVersion = options.scoringVersion === undefined
    ? null
    : normalizeScoringVersion(options.scoringVersion)
  const forcedVersion = requestedVersion &&
    requestedVersion !== OPPORTUNITY_SCORING_VERSION_V2
    ? requestedVersion
    : null
  if (forcedVersion) {
    return {
      forcedVersion,
      globalV2: false,
      canaryWorkspaceId: null,
      shadowWorkspaceId: null,
    }
  }

  const globalV2 = isOpportunityScoringV2EnabledForContext({
    dataOwnerId: null,
    workspaceId: null,
  })
  const candidateIds = new Set([
    parseSingleCanaryId(
      process.env[OPPORTUNITY_SCORING_V2_CANARY_WORKSPACE_IDS_FEATURE_FLAG],
    ),
    parseSingleCanaryId(
      process.env[AGENCY_DNA_V1_CANARY_WORKSPACE_IDS_FEATURE_FLAG],
    ),
  ].filter((value): value is string => value !== null))
  const enabledCanaries = [...candidateIds].filter((workspaceId) =>
    isOpportunityScoringV2EnabledForContext({
      dataOwnerId: null,
      workspaceId,
    }),
  )
  const shadowWorkspaceId = parseSingleCanaryId(
    process.env[OPPORTUNITY_SCORING_V2_SHADOW_CANARY_WORKSPACE_IDS_FEATURE_FLAG],
  )
  const enabledShadowWorkspaceId = shadowWorkspaceId &&
    isOpportunityScoringV2ShadowEnabledForContext({
      dataOwnerId: null,
      workspaceId: shadowWorkspaceId,
    })
    ? shadowWorkspaceId
    : null
  return {
    forcedVersion: null,
    globalV2,
    canaryWorkspaceId: enabledCanaries.length === 1
      ? enabledCanaries[0]
      : null,
    shadowWorkspaceId: globalV2 ? null : enabledShadowWorkspaceId,
  }
}

function resolveOpportunityScoringVersion(
  row: OpportunityBuildRow,
  selection: OpportunityScoringSelection,
): string {
  const selected = selection.forcedVersion ?? (
    selection.globalV2 ||
    (selection.canaryWorkspaceId !== null &&
      row.workspaceId === selection.canaryWorkspaceId)
      ? OPPORTUNITY_SCORING_VERSION_V2
      : OPPORTUNITY_SCORING_VERSION_V1
  )
  if (row.buildScoringVersion && row.buildScoringVersion !== selected) {
    throw new Error('Opportunity scoring selection drifted from the build query.')
  }
  return selected
}

function parseSingleCanaryId(value: string | undefined): string | null {
  const candidates = value?.split(',').map((item) => item.trim()) ?? []
  return candidates.length === 1 && /^[1-9]\d*$/.test(candidates[0])
    ? candidates[0]
    : null
}

function hasVerifiedOrganizationIdentity(row: OpportunityBuildRow): boolean {
  return [
    row.organizationInn,
    row.organizationOgrn,
    row.organizationDomain,
    row.organizationWebsiteUrl,
    row.organizationCareerPageUrl,
  ].some((value) => Boolean(value?.trim()))
}

function hasAdmissibleHiringEvidence(row: OpportunityBuildRow): boolean {
  return [...toRecordArray(row.signals), ...toRecordArray(row.evidence)]
    .some((item) => {
      const tier = normalizeEvidenceTier(item.tier)
      return tier === 'direct' || tier === 'corroboration'
    })
}

function hasEligibleCorporateContact(
  row: OpportunityBuildRow,
  contactPaths: Array<{ category: string; value: string }>,
): boolean {
  const allowedPaths = filterContactPathsByPolicy(contactPaths, row.contactPolicy)
  return hasCorporateSurface(allowedPaths) ||
    Boolean(row.organizationCareerPageUrl?.trim())
}

function scoreAgencyDnaCapabilityMatch(
  row: OpportunityBuildRow,
  context: AgencyDnaOpportunityContext,
): number | null {
  const dimensions: boolean[] = []
  if (toStringArray(row.roles).length > 0) {
    dimensions.push(context.capabilityMatches.roleFamilies.length > 0)
  }
  if (toStringArray(row.industries).length > 0) {
    dimensions.push(context.capabilityMatches.industries.length > 0)
  }
  if (row.targetCity?.trim()) {
    dimensions.push(context.capabilityMatches.regions.length > 0)
  }
  if (toStringArray(row.targetSeniorities).length > 0) {
    dimensions.push(context.capabilityMatches.seniorities.length > 0)
  }
  if (toStringArray(row.serviceTypes).length > 0) {
    dimensions.push(context.capabilityMatches.serviceTypes.length > 0)
  }
  if (dimensions.length === 0) return null
  return dimensions.filter(Boolean).length / dimensions.length
}

function normalizeScoringVersion(value: string | undefined): string {
  const normalized = value?.trim() || 'opportunity-v1'
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(normalized)) {
    throw new Error('Invalid opportunity scoring version.')
  }
  return normalized
}

function normalizeEvidenceTier(value: unknown): EvidenceTier {
  return value === 'direct' || value === 'corroboration' ? value : 'context'
}

function toRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : []
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

function sortSetLikeStrings(value: unknown): string[] {
  return [...new Set(toStringArray(value))].sort()
}

function toCompanySizes(
  value: unknown,
): Array<'startup' | 'small' | 'medium' | 'large' | 'enterprise'> {
  const allowed = new Set(['startup', 'small', 'medium', 'large', 'enterprise'])
  return toStringArray(value).filter(
    (item): item is 'startup' | 'small' | 'medium' | 'large' | 'enterprise' =>
      allowed.has(item),
  )
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function extractAgencyDnaCaseStudies(
  snapshot: Record<string, unknown>,
) {
  const caseStudies = Array.isArray(snapshot.caseStudies)
    ? snapshot.caseStudies
    : []
  return normalizeAgencyDnaCaseStudies(caseStudies.map((value) => {
    const caseStudy = asRecord(value)
    return {
      roleFamilies: toStringArray(caseStudy.roleFamilies),
      industries: toStringArray(caseStudy.industries),
      companySizeBucket: stringValue(caseStudy.companySizeBucket) || null,
      region: stringValue(caseStudy.region) || null,
      hiringModes: toStringArray(caseStudy.hiringModes).filter(
        (value): value is AgencyDnaCaseHiringMode =>
          AGENCY_DNA_CASE_HIRING_MODES.includes(
            value as AgencyDnaCaseHiringMode,
          ),
      ),
      measurableResult: stringValue(caseStudy.measurableResult) || null,
      publicSafeDescription:
        stringValue(caseStudy.publicSafeDescription) || null,
    }
  }))
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

const EXPIRABLE_COUNT_QUERY = `
  SELECT COUNT(*)::TEXT AS count
  FROM opportunities o
  JOIN hiring_episodes he ON he.id = o.hiring_episode_id
  WHERE o.status IN ('new', 'review', 'snoozed')
    AND o.superseded_at IS NULL
    AND (he.status = 'closed' OR o.valid_until < $1::timestamptz)
    AND ($2::bigint IS NULL OR o.organization_id = $2)
`

const OPPORTUNITY_BUILD_QUERY = `
  WITH latest_candidates AS (
    SELECT DISTINCT ON (candidate.client_profile_id, candidate.org_id)
      candidate.*
    FROM digest_candidates candidate
    JOIN digest_runs run ON run.id = candidate.digest_run_id
    WHERE run.status = 'completed'
      AND ($1::bigint IS NULL OR candidate.org_id = $1)
    ORDER BY
      candidate.client_profile_id,
      candidate.org_id,
      candidate.created_at DESC,
      candidate.id DESC
  )
  SELECT
    cp.owner_id::TEXT AS "ownerId",
    cp.workspace_id::TEXT AS "workspaceId",
    cp.id::TEXT AS "clientProfileId",
    he.organization_id::TEXT AS "organizationId",
    he.id::TEXT AS "hiringEpisodeId",
    org.name AS "organizationName",
    org.domain AS "organizationDomain",
    org.website_url AS "organizationWebsiteUrl",
    org.career_page_url AS "organizationCareerPageUrl",
    org.inn AS "organizationInn",
    org.ogrn AS "organizationOgrn",
    org.country AS "organizationCountry",
    org.industry AS "organizationIndustry",
    org.city AS "organizationCity",
    he.episode_type AS "episodeType",
    he.episode_key AS "episodeKey",
    he.episode_identity AS "episodeIdentity",
    he.episode_generation AS "episodeGeneration",
    he.title AS "episodeTitle",
    he.summary AS "episodeSummary",
    he.started_at::TEXT AS "episodeStartedAt",
    he.last_seen_at::TEXT AS "episodeLastSeenAt",
    he.signal_count AS "signalCount",
    he.vacancy_count AS "vacancyCount",
    he.strength_score AS "strengthScore",
    he.freshness_score AS "freshnessScore",
    he.evidence_hash AS "evidenceHash",
    he.engine_version AS "engineVersion",
    he.metadata AS "episodeMetadata",
    COALESCE(episode_data.signal_ids, ARRAY[]::TEXT[]) AS "signalIds",
    COALESCE(episode_data.evidence_ids, ARRAY[]::TEXT[]) AS "evidenceIds",
    COALESCE(episode_data.signals, '[]'::jsonb) AS signals,
    COALESCE(episode_data.evidence, '[]'::jsonb) AS evidence,
    dc.id::TEXT AS "digestCandidateId",
    dc.payload AS "digestPayload",
    dc.reasons AS "digestReasons",
    dc.source_families AS "sourceFamilies",
    cp.agency_name AS "agencyName",
    cp.target_city AS "targetCity",
    cp.specialization,
    cp.include_keywords AS "includeKeywords",
    cp.exclude_keywords AS "excludeKeywords",
    cp.industries,
    cp.company_sizes AS "companySizes",
    cp.contact_policy AS "contactPolicy",
    cp.roles,
    cp.excluded_industries AS "excludedIndustries",
    cp.excluded_locations AS "excludedLocations",
    cp.remote_friendly AS "remoteFriendly",
    cp.hiring_mode AS "hiringMode",
    cp.service_types AS "serviceTypes",
    cp.target_seniorities AS "targetSeniorities",
    cp.preferred_engagement_types AS "preferredEngagementTypes",
    cp.current_capacity AS "currentCapacity",
    cp.agency_dna_version::TEXT AS "agencyDnaVersion",
    cp.agency_dna_snapshot_hash AS "agencyDnaSnapshotHash",
    agency_dna_profile_snapshot(cp) AS "agencyDnaSnapshot",
    account_restriction.restriction_type AS "restrictionType",
    current_opportunity.id::TEXT AS "currentOpportunityId",
    current_opportunity.input_hash AS "currentInputHash",
    current_opportunity.scoring_version AS "currentScoringVersion",
    CASE
      WHEN $3::TEXT IS NOT NULL THEN $3::TEXT
      WHEN $4::BOOLEAN OR cp.workspace_id = $5::BIGINT
        THEN 'opportunity-v2'
      ELSE 'opportunity-v1'
    END AS "buildScoringVersion"
  FROM latest_candidates dc
  JOIN client_profiles cp ON cp.id = dc.client_profile_id
  JOIN hiring_episodes he ON he.organization_id = dc.org_id
  JOIN orgs org ON org.id = he.organization_id
  LEFT JOIN agency_account_restrictions account_restriction
    ON account_restriction.client_profile_id = cp.id
   AND account_restriction.owner_id = cp.owner_id
   AND account_restriction.workspace_id = cp.workspace_id
   AND account_restriction.organization_id = he.organization_id
  LEFT JOIN opportunity_build_failures build_failure
   ON build_failure.client_profile_id = cp.id
   AND build_failure.hiring_episode_id = he.id
   AND build_failure.scoring_version = CASE
     WHEN $3::TEXT IS NOT NULL THEN $3::TEXT
     WHEN $4::BOOLEAN OR cp.workspace_id = $5::BIGINT
       THEN 'opportunity-v2'
     ELSE 'opportunity-v1'
   END
  LEFT JOIN opportunities current_opportunity
    ON current_opportunity.client_profile_id = cp.id
   AND current_opportunity.hiring_episode_id = he.id
   AND current_opportunity.superseded_at IS NULL
  LEFT JOIN LATERAL (
    SELECT
      ARRAY_AGG(DISTINCT hee.signal_id::TEXT)
        FILTER (WHERE hee.signal_id IS NOT NULL) AS signal_ids,
      ARRAY_AGG(DISTINCT hee.evidence_id::TEXT)
        FILTER (WHERE hee.evidence_id IS NOT NULL) AS evidence_ids,
      JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT(
        'id', s.id::TEXT,
        'title', s.headline,
        'region', COALESCE(s.payload->>'area_name', s.payload->>'location'),
        'occurredAt', s.occurred_at::TEXT,
        'tier', CASE
          WHEN s.source IN ('career-pages', 'greenhouse', 'lever', 'ashby', 'recruitee', 'workable', 'smartrecruiters') THEN 'direct'
          ELSE 'corroboration'
        END
      )) FILTER (WHERE s.id IS NOT NULL) AS signals,
      JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT(
        'id', ei.id::TEXT,
        'source', ei.source,
        'tier', ei.tier
      )) FILTER (WHERE ei.id IS NOT NULL) AS evidence
    FROM hiring_episode_evidence hee
    LEFT JOIN signals s ON s.id = hee.signal_id
    LEFT JOIN evidence_items ei ON ei.id = hee.evidence_id
    WHERE hee.hiring_episode_id = he.id
  ) episode_data ON TRUE
`
