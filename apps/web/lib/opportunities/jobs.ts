import type { Pool, PoolClient } from 'pg'

import { resolveHiringMode } from '@/lib/clientProfiles'
import { getPool } from '@/lib/db-pool'
import { extractPayloadFields } from '@/lib/leads-data'
import { logError, logEvent, logWarn } from '@/lib/runtime'
import { computeFiur, type EvidenceTier } from '@/lib/scoring/fiur'
import {
  DEFAULT_HIRING_EPISODE_CONFIG,
  HiringEpisodeDetectionService,
  classifyOpportunityRoleFamily,
  type HiringEpisodeCandidate,
  type HiringSignalInput,
} from './hiring-episode-detection'
import { OpportunityBriefBuilder } from './opportunity-brief-builder'
import {
  OPPORTUNITY_ENGINE_LIMITS,
  clampOpportunityJobBatchSize,
  isOpportunityEngineV1Enabled,
} from './config'
import {
  DEFAULT_OPPORTUNITY_SCORING_CONFIG,
  OpportunityScoringService,
  type ConfidenceGate,
} from './opportunity-scoring'

type OpportunityJobDb = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>

export interface OpportunityJobOptions {
  organizationId?: string | number | null
  batchSize?: number
  dryRun?: boolean
  now?: Date
  enabled?: boolean
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
}

interface SignalRow {
  id: string
  organizationId: string
  signalType: string
  title: string
  region: string | null
  source: string
  sourceUrl: string | null
  occurredAt: string
  evidenceIds: unknown
}

interface OpportunityBuildRow {
  ownerId: string
  clientProfileId: string
  organizationId: string
  hiringEpisodeId: string
  organizationName: string
  organizationDomain: string | null
  organizationWebsiteUrl: string | null
  organizationCareerPageUrl: string | null
  organizationCountry: string | null
  organizationIndustry: string | null
  organizationCity: string | null
  episodeType: HiringEpisodeCandidate['episodeType']
  episodeKey: string
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
}

export async function detectHiringEpisodesJob(
  options: OpportunityJobOptions = {},
  db: OpportunityJobDb | null = getPool(),
): Promise<OpportunityJobStats> {
  const stats = createStats(options)
  if (!stats.enabled) return disabledJob('detect-hiring-episodes', stats)
  if (!db) throw new Error('DATABASE_URL is not set.')

  const now = options.now ?? new Date()
  const batchSize = clampOpportunityJobBatchSize(
    options.batchSize ?? OPPORTUNITY_ENGINE_LIMITS.defaultJobBatchSize,
  )
  logEvent('opportunity.job.started', {
    job: 'detect-hiring-episodes',
    dryRun: stats.dryRun,
    batchSize,
  })

  const organizations = await db.query<{ organizationId: string }>(
    `SELECT DISTINCT org_id::TEXT AS "organizationId"
     FROM signals
     WHERE signal_type = 'job_posting'
       AND occurred_at >= $1::timestamptz
       AND ($2::bigint IS NULL OR org_id = $2)
     ORDER BY org_id::TEXT
     LIMIT $3`,
    [
      new Date(
        now.getTime() -
          DEFAULT_HIRING_EPISODE_CONFIG.historyWindowDays * 24 * 60 * 60 * 1000,
      ).toISOString(),
      options.organizationId == null ? null : String(options.organizationId),
      batchSize,
    ],
  )

  const detector = new HiringEpisodeDetectionService()
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

      if (candidates.length === 0) {
        stats.skipped += 1
        continue
      }
      for (const candidate of candidates) {
        if (stats.dryRun) {
          stats.created += 1
          continue
        }
        const stored = await upsertEpisode(candidate, db)
        if (stored.inserted) stats.created += 1
        else stats.updated += 1
      }
    } catch (error) {
      stats.failed += 1
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
  db: OpportunityJobDb | null = getPool(),
): Promise<OpportunityJobStats> {
  const stats = createStats(options)
  if (!stats.enabled) return disabledJob('build-opportunities', stats)
  if (!db) throw new Error('DATABASE_URL is not set.')

  const now = options.now ?? new Date()
  const batchSize = clampOpportunityJobBatchSize(
    options.batchSize ?? OPPORTUNITY_ENGINE_LIMITS.defaultJobBatchSize,
  )
  logEvent('opportunity.job.started', {
    job: 'build-opportunities',
    dryRun: stats.dryRun,
    batchSize,
  })

  const result = await db.query<OpportunityBuildRow>(
    `${OPPORTUNITY_BUILD_QUERY}
     WHERE he.status = 'active'
       AND cp.is_active = TRUE
       AND cp.owner_id IS NOT NULL
       AND ($1::bigint IS NULL OR he.organization_id = $1)
     ORDER BY he.last_seen_at DESC, he.id DESC, cp.id DESC
     LIMIT $2`,
    [
      options.organizationId == null ? null : String(options.organizationId),
      batchSize,
    ],
  )

  const scorer = new OpportunityScoringService()
  const briefBuilder = new OpportunityBriefBuilder()
  for (const row of result.rows) {
    stats.scanned += 1
    try {
      const episode = mapEpisode(row)
      const payload = extractPayloadFields(row.digestPayload)
      const gate = normalizeConfidenceGate(payload.confidenceGate)
      const fiur = computeFiurForOpportunity(row, payload.contactPaths, now)
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
        profileExcluded: hasExplicitProfileExclusion(row),
        now,
      })
      const brief = briefBuilder.build({
        organizationName: row.organizationName,
        episode,
        score,
      })

      if (stats.dryRun) {
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
      const upsert = await db.query<{ inserted: boolean }>(
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
           metadata
         )
         VALUES (
           $1, $2, $3, $4, $5,
           $6, $7, $8, $9, $10, $11,
           $12, $13, $14, $15, $16, $17, $18,
           $19, $20, $21, $22, $23::jsonb
         )
         ON CONFLICT (client_profile_id, hiring_episode_id, scoring_version)
         DO UPDATE SET
           title = EXCLUDED.title,
           why_now = EXCLUDED.why_now,
           problem_hypothesis = EXCLUDED.problem_hypothesis,
           recommended_angle = EXCLUDED.recommended_angle,
           recommended_persona = EXCLUDED.recommended_persona,
           recommended_action = EXCLUDED.recommended_action,
           agency_fit_score = EXCLUDED.agency_fit_score,
           hiring_intent_score = EXCLUDED.hiring_intent_score,
           agency_propensity_score = EXCLUDED.agency_propensity_score,
           timing_score = EXCLUDED.timing_score,
           reachability_score = EXCLUDED.reachability_score,
           confidence_score = EXCLUDED.confidence_score,
           opportunity_score = EXCLUDED.opportunity_score,
           confidence_gate = EXCLUDED.confidence_gate,
           evidence_hash = EXCLUDED.evidence_hash,
           valid_until = EXCLUDED.valid_until,
           metadata = EXCLUDED.metadata,
           status = CASE
             WHEN opportunities.status IN ('accepted', 'dismissed', 'snoozed', 'contacted')
               THEN opportunities.status
             ELSE EXCLUDED.status
           END,
           updated_at = NOW()
         WHERE opportunities.evidence_hash IS DISTINCT FROM EXCLUDED.evidence_hash
            OR opportunities.metadata IS DISTINCT FROM EXCLUDED.metadata
         RETURNING (xmax = 0) AS inserted`,
        [
          row.ownerId,
          row.clientProfileId,
          row.organizationId,
          row.hiringEpisodeId,
          score.status,
          brief.title,
          brief.whyNow,
          brief.problemHypothesis,
          brief.recommendedAngle,
          brief.recommendedPersona,
          brief.recommendedAction,
          score.components.agencyFit.score,
          score.components.hiringIntent.score,
          score.components.externalAgencyPropensity.score,
          score.components.timing.score,
          score.components.reachability.score,
          score.components.confidence.score,
          score.opportunityScore,
          score.confidenceGate,
          score.scoringVersion,
          episode.evidenceHash,
          validUntil,
          JSON.stringify({
            morningBriefEligible: score.isMorningBriefEligible,
            components: score.components,
            digestCandidateId: row.digestCandidateId,
            digestReasons: row.digestReasons,
            sourceFamilies: toStringArray(row.sourceFamilies),
            contactPaths: payload.contactPaths,
            fiur: {
              fit: fiur.fit,
              intent: fiur.intent,
              urgency: fiur.urgency,
              reachability: fiur.reachability,
              total: fiur.total,
            },
          }),
        ],
      )
      if (upsert.rowCount === 0) stats.skipped += 1
      else if (upsert.rows[0]?.inserted) stats.created += 1
      else stats.updated += 1
    } catch (error) {
      stats.failed += 1
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
  db: OpportunityJobDb | null = getPool(),
): Promise<OpportunityJobStats> {
  const stats = createStats(options)
  if (!stats.enabled) return disabledJob('expire-opportunities', stats)
  if (!db) throw new Error('DATABASE_URL is not set.')

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

  const closed = await db.query(
    `UPDATE hiring_episodes
     SET status = 'closed', closed_at = $1::timestamptz, updated_at = NOW()
     WHERE status = 'active'
       AND last_seen_at < $1::timestamptz - ($2 * INTERVAL '1 day')
       AND ($3::bigint IS NULL OR organization_id = $3)`,
    [
      now.toISOString(),
      DEFAULT_HIRING_EPISODE_CONFIG.inactivityCloseDays,
      options.organizationId ?? null,
    ],
  )
  const expired = await db.query(
    `UPDATE opportunities o
     SET status = 'expired', updated_at = NOW()
     FROM hiring_episodes he
     WHERE he.id = o.hiring_episode_id
       AND o.status IN ('new', 'review', 'snoozed')
       AND (he.status = 'closed' OR o.valid_until < $1::timestamptz)
       AND ($2::bigint IS NULL OR o.organization_id = $2)`,
    [now.toISOString(), options.organizationId ?? null],
  )
  stats.scanned = (closed.rowCount ?? 0) + (expired.rowCount ?? 0)
  stats.expired = expired.rowCount ?? 0
  stats.updated = closed.rowCount ?? 0
  logJobCompleted('expire-opportunities', stats)
  return stats
}

export async function backfillOpportunitiesJob(
  options: OpportunityJobOptions = {},
  db: OpportunityJobDb | null = getPool(),
): Promise<{
  detection: OpportunityJobStats
  opportunities: OpportunityJobStats
}> {
  if (!db && (options.enabled ?? isOpportunityEngineV1Enabled())) {
    throw new Error('DATABASE_URL is not set.')
  }
  const detection = await detectHiringEpisodesJob(options, db)
  const opportunities = await buildOpportunitiesJob(options, db)
  return { detection, opportunities }
}

async function upsertEpisode(
  candidate: HiringEpisodeCandidate,
  db: OpportunityJobDb,
): Promise<{ id: string; inserted: boolean }> {
  const result = await db.query<{ id: string; inserted: boolean }>(
    `INSERT INTO hiring_episodes (
       organization_id,
       episode_type,
       episode_key,
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
       $1, $2, $3, $4, $5,
       $6::timestamptz, $7::timestamptz,
       $8, $9, $10, $11, $12, $13, $14::jsonb
     )
     ON CONFLICT (organization_id, episode_key, engine_version)
     DO UPDATE SET
       title = EXCLUDED.title,
       summary = EXCLUDED.summary,
       started_at = LEAST(hiring_episodes.started_at, EXCLUDED.started_at),
       last_seen_at = GREATEST(hiring_episodes.last_seen_at, EXCLUDED.last_seen_at),
       signal_count = EXCLUDED.signal_count,
       vacancy_count = EXCLUDED.vacancy_count,
       strength_score = EXCLUDED.strength_score,
       freshness_score = EXCLUDED.freshness_score,
       evidence_hash = EXCLUDED.evidence_hash,
       metadata = EXCLUDED.metadata,
       status = 'active',
       closed_at = NULL,
       updated_at = NOW()
     RETURNING id::TEXT AS id, (xmax = 0) AS inserted`,
    [
      candidate.organizationId,
      candidate.episodeType,
      candidate.episodeKey,
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
  return episode
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
    occurredAt: row.occurredAt,
    evidenceIds: toStringArray(row.evidenceIds),
  }
}

function mapEpisode(row: OpportunityBuildRow): HiringEpisodeCandidate {
  return {
    organizationId: row.organizationId,
    episodeType: row.episodeType,
    episodeKey: row.episodeKey,
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
      locations: [
        row.targetCity,
        ...toStringArray(row.excludedLocations).map(() => ''),
      ].filter((value): value is string => Boolean(value)),
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
  const haystack = [
    row.organizationName,
    row.organizationIndustry ?? '',
    row.organizationCity ?? '',
  ].join(' ').toLocaleLowerCase('ru-RU')
  const exclusions = [
    ...toStringArray(row.excludeKeywords),
    ...toStringArray(row.excludedIndustries),
    ...toStringArray(row.excludedLocations),
  ].map((value) => value.toLocaleLowerCase('ru-RU'))
  return exclusions.some((value) => value && haystack.includes(value))
}

function createStats(options: OpportunityJobOptions): OpportunityJobStats {
  return {
    enabled: options.enabled ?? isOpportunityEngineV1Enabled(),
    dryRun: options.dryRun === true,
    scanned: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    expired: 0,
  }
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

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

const EXPIRABLE_COUNT_QUERY = `
  SELECT COUNT(*)::TEXT AS count
  FROM opportunities o
  JOIN hiring_episodes he ON he.id = o.hiring_episode_id
  WHERE o.status IN ('new', 'review', 'snoozed')
    AND (he.status = 'closed' OR o.valid_until < $1::timestamptz)
    AND ($2::bigint IS NULL OR o.organization_id = $2)
`

const OPPORTUNITY_BUILD_QUERY = `
  SELECT
    cp.owner_id::TEXT AS "ownerId",
    cp.id::TEXT AS "clientProfileId",
    he.organization_id::TEXT AS "organizationId",
    he.id::TEXT AS "hiringEpisodeId",
    org.name AS "organizationName",
    org.domain AS "organizationDomain",
    org.website_url AS "organizationWebsiteUrl",
    org.career_page_url AS "organizationCareerPageUrl",
    org.country AS "organizationCountry",
    org.industry AS "organizationIndustry",
    org.city AS "organizationCity",
    he.episode_type AS "episodeType",
    he.episode_key AS "episodeKey",
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
    cp.hiring_mode AS "hiringMode"
  FROM hiring_episodes he
  JOIN orgs org ON org.id = he.organization_id
  CROSS JOIN client_profiles cp
  JOIN LATERAL (
    SELECT candidate.*
    FROM digest_candidates candidate
    WHERE candidate.client_profile_id = cp.id
      AND candidate.org_id = he.organization_id
    ORDER BY candidate.created_at DESC, candidate.id DESC
    LIMIT 1
  ) dc ON TRUE
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
        'tier', CASE WHEN s.source = 'career-pages' THEN 'direct' ELSE 'corroboration' END
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
