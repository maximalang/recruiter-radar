import type { Pool, PoolClient } from 'pg'

import { getPool } from '@/lib/db-pool'
import { logError, logEvent } from '@/lib/runtime'
import {
  parseCommercialSignalCard,
  type CommercialSignalCard,
  type CommercialSignalCardConclusion,
  type CommercialSignalCardMetric,
} from './commercial-signal-card'
import { hashCanonicalJson } from './canonical-hash'
import {
  isCommercialSignalAuthoritativeForWorkspace,
} from './commercial-signal-rollout'
import { summarizeOpportunityTemporalContext } from './temporal-context'

export type CommercialSignalWriterDb = Pick<Pool, 'query' | 'connect'> |
  Pick<PoolClient, 'query' | 'release'>

export type CommercialSignalOpportunityWriterOptions = {
  workspaceId: string | number
  clientProfileId?: string | number | null
  organizationId?: string | number | null
  batchSize?: number
  now?: Date
  env?: Readonly<Record<string, string | undefined>>
}

export type CommercialSignalOpportunityWriterStats = {
  authoritative: boolean
  scanned: number
  written: number
  replayed: number
  enrichmentQueued: number
  queryPlanLinks: number
  failed: number
}

export class CommercialSignalWriterScopeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CommercialSignalWriterScopeError'
  }
}

export class CommercialSignalLineageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CommercialSignalLineageError'
  }
}

type CandidateRow = {
  candidateId: string
  organizationId: string
  organizationName: string
  workspaceId: string
  ownerId: string
  clientProfileId: string
  candidateIdentity: string
  candidateGeneration: number
  signalEpisodeId: string
  signalEpisodeIdentity: string
  signalEpisodeGeneration: number
  signalEpisodeType: string
  signalEpisodeStage: string
  episodeStartedAt: string
  episodeLastSeenAt: string
  episodeValidUntil: string
  episodeIntensity: number
  baselineDeviation: number | null
  problemHypotheses: string[]
  opportunityMode: string
  qualityScore: number
  actionabilityScore: number
  rankingScore: number
  status: 'qualified_actionable' | 'qualified_needs_enrichment'
  qualityComponents: Record<string, unknown>
  actionabilityComponents: Record<string, unknown>
  hardGates: unknown[]
  reasons: unknown[]
  featureSnapshot: Record<string, unknown>
  evidenceSnapshot: Record<string, unknown>
  evidenceHash: string
  scoreVersion: string
  featureSchemaVersion: string
  gateVersion: string
  calibrationStatus: string
  validUntil: string
  temporalEvents?: unknown
}

type QueryPlanLink = {
  executionId: string
  planSnapshotId: string
}

type ContributingEpisodeFacts = {
  signalIds: string[]
  evidenceIds: string[]
  vacancyCount: number
}

const COMPATIBILITY_ENGINE_VERSION = 'commercial-signal-v3-compat-v1'
const DEFAULT_BATCH_SIZE = 20
const MAX_BATCH_SIZE = 100

/**
 * Materializes only qualified canary candidates into the established
 * opportunity/workflow surface. Every write is guarded by exact immutable
 * lineage. There is deliberately no lookup by company, freshness, timestamp or
 * evidence hash.
 */
export async function writeCommercialSignalOpportunities(
  options: CommercialSignalOpportunityWriterOptions,
  providedDb: CommercialSignalWriterDb | null = null,
): Promise<CommercialSignalOpportunityWriterStats> {
  const workspaceId = positiveId(options.workspaceId, 'workspace')
  const authoritative = isCommercialSignalAuthoritativeForWorkspace(
    workspaceId,
    options.env,
  )
  const stats: CommercialSignalOpportunityWriterStats = {
    authoritative,
    scanned: 0,
    written: 0,
    replayed: 0,
    enrichmentQueued: 0,
    queryPlanLinks: 0,
    failed: 0,
  }
  if (!authoritative) return stats

  const now = validDate(options.now ?? new Date())
  const clientProfileId = optionalPositiveId(
    options.clientProfileId,
    'client profile',
  )
  const organizationId = optionalPositiveId(
    options.organizationId,
    'organization',
  )
  const batchSize = boundedInteger(
    options.batchSize ?? DEFAULT_BATCH_SIZE,
    1,
    MAX_BATCH_SIZE,
    'batch size',
  )
  const database = providedDb ?? getPool()
  if (!database) throw new Error('DATABASE_URL is not set.')
  const ownsClient = 'connect' in database && !('release' in database)
  const db = ownsClient && 'connect' in database
    ? await database.connect()
    : database

  try {
    const candidates = await loadCandidates({
      workspaceId,
      clientProfileId,
      organizationId,
      batchSize,
      now,
    }, db)

    for (const candidate of candidates) {
      stats.scanned += 1
      try {
        const result = await materializeCandidate(candidate, now, db)
        if (result.replayed) stats.replayed += 1
        else stats.written += 1
        stats.queryPlanLinks += result.queryPlanLinks
        if (result.enrichmentQueued) stats.enrichmentQueued += 1
      } catch (error) {
        stats.failed += 1
        logError('commercial_signal.writer_failed', error, {
          workspaceId: candidate.workspaceId,
          clientProfileId: candidate.clientProfileId,
          organizationId: candidate.organizationId,
          candidateId: candidate.candidateId,
          candidateGeneration: candidate.candidateGeneration,
        })
      }
    }

    logEvent('commercial_signal.writer_completed', stats)
    return stats
  } finally {
    if (ownsClient && 'release' in db) db.release()
  }
}

async function loadCandidates(
  input: {
    workspaceId: string
    clientProfileId: string | null
    organizationId: string | null
    batchSize: number
    now: Date
  },
  db: CommercialSignalWriterDb,
): Promise<CandidateRow[]> {
  const result = await db.query<Record<string, unknown>>(
    `SELECT
       candidate.id::TEXT AS "candidateId",
       candidate.organization_id::TEXT AS "organizationId",
       org.name AS "organizationName",
       candidate.workspace_id::TEXT AS "workspaceId",
       candidate.owner_id::TEXT AS "ownerId",
       candidate.client_profile_id::TEXT AS "clientProfileId",
       candidate.candidate_identity AS "candidateIdentity",
       candidate.candidate_generation AS "candidateGeneration",
       candidate.signal_episode_id::TEXT AS "signalEpisodeId",
       episode.episode_identity AS "signalEpisodeIdentity",
       candidate.signal_episode_generation AS "signalEpisodeGeneration",
       episode.episode_type AS "signalEpisodeType",
       episode.stage AS "signalEpisodeStage",
       episode.started_at::TEXT AS "episodeStartedAt",
       episode.last_seen_at::TEXT AS "episodeLastSeenAt",
       episode.valid_until::TEXT AS "episodeValidUntil",
       episode.intensity AS "episodeIntensity",
       episode.baseline_deviation AS "baselineDeviation",
       episode.problem_hypotheses AS "problemHypotheses",
       candidate.opportunity_mode AS "opportunityMode",
       candidate.quality_score AS "qualityScore",
       candidate.actionability_score AS "actionabilityScore",
       candidate.ranking_score AS "rankingScore",
       candidate.status,
       candidate.quality_components AS "qualityComponents",
       candidate.actionability_components AS "actionabilityComponents",
       candidate.hard_gates AS "hardGates",
       candidate.reasons,
       candidate.feature_snapshot AS "featureSnapshot",
       candidate.evidence_snapshot AS "evidenceSnapshot",
       candidate.evidence_hash AS "evidenceHash",
       candidate.score_version AS "scoreVersion",
       candidate.feature_schema_version AS "featureSchemaVersion",
       candidate.gate_version AS "gateVersion",
       candidate.calibration_status AS "calibrationStatus",
       candidate.valid_until::TEXT AS "validUntil",
       COALESCE(temporal_data.events, '[]'::JSONB) AS "temporalEvents"
     FROM opportunity_candidates candidate
     JOIN signal_episodes episode
       ON episode.id = candidate.signal_episode_id
      AND episode.organization_id = candidate.organization_id
      AND episode.episode_generation = candidate.signal_episode_generation
     JOIN orgs org ON org.id = candidate.organization_id
     LEFT JOIN LATERAL (
       SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
         'id', event.id::TEXT,
         'subjectType', event.subject_type,
         'eventType', event.event_type,
         'occurredAt', event.occurred_at::TEXT,
         'windowDays', event.window_days,
         'delta', event.delta,
         'evidenceIds', event.evidence_ids::TEXT[]
       ) ORDER BY event.occurred_at DESC, event.id DESC) AS events
       FROM source_temporal_derived_events event
       WHERE event.organization_id = candidate.organization_id
         AND event.occurred_at >= episode.started_at - INTERVAL '30 days'
         AND event.occurred_at <= $4::TIMESTAMPTZ
     ) temporal_data ON TRUE
     WHERE candidate.workspace_id = $1
       AND ($2::BIGINT IS NULL OR candidate.client_profile_id = $2)
       AND ($3::BIGINT IS NULL OR candidate.organization_id = $3)
       AND candidate.rollout_mode = 'canary'
       AND candidate.status IN (
         'qualified_actionable', 'qualified_needs_enrichment'
       )
       AND candidate.valid_until > $4::TIMESTAMPTZ
       AND $4::TIMESTAMPTZ < episode.last_seen_at +
         (episode.valid_until - episode.last_seen_at) * 0.75
       AND candidate.candidate_generation = (
         SELECT MAX(latest.candidate_generation)
         FROM opportunity_candidates latest
         WHERE latest.workspace_id = candidate.workspace_id
           AND latest.client_profile_id = candidate.client_profile_id
           AND latest.organization_id = candidate.organization_id
           AND latest.score_version = candidate.score_version
           AND latest.candidate_identity = candidate.candidate_identity
       )
       AND NOT EXISTS (
         SELECT 1
         FROM commercial_signal_opportunity_lineage lineage
         WHERE lineage.candidate_id = candidate.id
       )
     ORDER BY
       candidate.ranking_score DESC,
       candidate.actionability_score DESC,
       candidate.id ASC
     LIMIT $5`,
    [
      input.workspaceId,
      input.clientProfileId,
      input.organizationId,
      input.now.toISOString(),
      input.batchSize,
    ],
  )
  return result.rows.map(candidateFromRow)
}

async function materializeCandidate(
  candidate: CandidateRow,
  now: Date,
  db: CommercialSignalWriterDb,
): Promise<{
  replayed: boolean
  enrichmentQueued: boolean
  queryPlanLinks: number
}> {
  await db.query('BEGIN')
  try {
    await db.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`commercial-signal:candidate:${candidate.candidateId}`],
    )
    const locked = await db.query<{ id: string }>(
      `SELECT id::TEXT AS id
       FROM opportunity_candidates
       WHERE id = $1
         AND workspace_id = $2
         AND client_profile_id = $3
         AND organization_id = $4
         AND candidate_identity = $5
         AND candidate_generation = $6
         AND rollout_mode = 'canary'
         AND status IN ('qualified_actionable', 'qualified_needs_enrichment')
         AND valid_until > $7::TIMESTAMPTZ
       FOR UPDATE`,
      [
        candidate.candidateId,
        candidate.workspaceId,
        candidate.clientProfileId,
        candidate.organizationId,
        candidate.candidateIdentity,
        candidate.candidateGeneration,
        now.toISOString(),
      ],
    )
    if (!locked.rows[0]) {
      throw new CommercialSignalLineageError(
        `Candidate ${candidate.candidateId} changed before materialization.`,
      )
    }

    const existing = await db.query<{ lineageId: string }>(
      `SELECT id::TEXT AS "lineageId"
       FROM commercial_signal_opportunity_lineage
       WHERE candidate_id = $1`,
      [candidate.candidateId],
    )
    if (existing.rows[0]) {
      await db.query('COMMIT')
      return { replayed: true, enrichmentQueued: false, queryPlanLinks: 0 }
    }

    const facts = await loadEpisodeFacts(candidate, db)
    if (facts.signalIds.length === 0 || facts.vacancyCount === 0) {
      throw new CommercialSignalLineageError(
        `Signal Episode ${candidate.signalEpisodeId} has no exact vacancy-source provenance.`,
      )
    }
    if (facts.evidenceIds.length === 0) {
      throw new CommercialSignalLineageError(
        `Signal Episode ${candidate.signalEpisodeId} has no exact evidence.`,
      )
    }

    const candidateEvidence = await loadCandidateEvidence(candidate, db)
    if (candidateEvidence.length === 0) {
      throw new CommercialSignalLineageError(
        `Candidate ${candidate.candidateId} has no evidence links.`,
      )
    }
    assertEvidenceSubset(candidateEvidence, facts.evidenceIds, candidate.candidateId)

    const queryPlanLinks = await loadExactQueryPlanLinks(candidate, db)
    if (queryPlanLinks.length === 0) {
      throw new CommercialSignalLineageError(
        `Candidate ${candidate.candidateId} has no exact Query Planner source execution lineage.`,
      )
    }

    const lineageKey = buildCommercialSignalLineageKey(candidate)
    const card = buildCommercialSignalCard(candidate, candidateEvidence)
    const compatibilityEpisodeId = await ensureCompatibilityHiringEpisode(
      candidate,
      facts,
      lineageKey,
      db,
    )
    await attachCompatibilityEpisodeProvenance(
      compatibilityEpisodeId,
      candidate.organizationId,
      facts,
      db,
    )

    const opportunityId = await insertCompatibilityOpportunity(
      candidate,
      compatibilityEpisodeId,
      lineageKey,
      card,
      now,
      db,
    )
    const lineageId = await insertLineage({
      candidate,
      compatibilityEpisodeId,
      opportunityId,
      lineageKey,
      card,
    }, db)

    let linkedPlans = 0
    for (const link of queryPlanLinks) {
      const inserted = await db.query(
        `INSERT INTO commercial_signal_opportunity_query_plans (
           lineage_id, execution_id, plan_snapshot_id,
           workspace_id, client_profile_id
         )
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (lineage_id, execution_id, plan_snapshot_id) DO NOTHING`,
        [
          lineageId,
          link.executionId,
          link.planSnapshotId,
          candidate.workspaceId,
          candidate.clientProfileId,
        ],
      )
      linkedPlans += inserted.rowCount ?? 0
    }
    if (linkedPlans === 0 && queryPlanLinks.length > 0) {
      const count = await db.query<{ count: string }>(
        `SELECT COUNT(*)::TEXT AS count
         FROM commercial_signal_opportunity_query_plans
         WHERE lineage_id = $1`,
        [lineageId],
      )
      if (Number(count.rows[0]?.count ?? 0) === 0) {
        throw new CommercialSignalLineageError('Query-plan lineage disappeared during write.')
      }
    }

    let enrichmentQueued = false
    if (candidate.status === 'qualified_needs_enrichment') {
      const queued = await db.query(
        `INSERT INTO commercial_signal_enrichment_queue (
           lineage_id, workspace_id, client_profile_id, organization_id
         )
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (lineage_id) DO NOTHING`,
        [
          lineageId,
          candidate.workspaceId,
          candidate.clientProfileId,
          candidate.organizationId,
        ],
      )
      enrichmentQueued = (queued.rowCount ?? 0) > 0
    }

    await supersedeEarlierCommercialSignalOpportunities(candidate, opportunityId, db)
    await db.query('COMMIT')
    return {
      replayed: false,
      enrichmentQueued,
      queryPlanLinks: linkedPlans,
    }
  } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined)
    throw error
  }
}

async function loadEpisodeFacts(
  candidate: CandidateRow,
  db: CommercialSignalWriterDb,
): Promise<ContributingEpisodeFacts> {
  const signals = await db.query<{ signalId: string }>(
    `SELECT DISTINCT publication.signal_id::TEXT AS "signalId"
     FROM signal_episode_events episode_event
     JOIN company_event_publications publication
       ON publication.company_event_id = episode_event.company_event_id
      AND publication.organization_id = episode_event.organization_id
     WHERE episode_event.signal_episode_id = $1
       AND episode_event.organization_id = $2
       AND publication.signal_id IS NOT NULL
     ORDER BY publication.signal_id`,
    [candidate.signalEpisodeId, candidate.organizationId],
  )
  const evidence = await db.query<{ evidenceId: string }>(
    `SELECT evidence_id::TEXT AS "evidenceId"
     FROM signal_episode_evidence
     WHERE signal_episode_id = $1
       AND organization_id = $2
     ORDER BY evidence_id`,
    [candidate.signalEpisodeId, candidate.organizationId],
  )
  const vacancies = await db.query<{ count: string }>(
    `SELECT COUNT(DISTINCT event.id)::TEXT AS count
     FROM signal_episode_events episode_event
     JOIN company_events event
       ON event.id = episode_event.company_event_id
      AND event.organization_id = episode_event.organization_id
     WHERE episode_event.signal_episode_id = $1
       AND episode_event.organization_id = $2
       AND event.event_type IN (
         'job_posting', 'vacancy_repost', 'vacancy_salary_change',
         'vacancy_cluster', 'recruiter_vacancy', 'new_region',
         'hiring_restart'
       )`,
    [candidate.signalEpisodeId, candidate.organizationId],
  )
  return {
    signalIds: uniqueIds(signals.rows.map((row) => row.signalId)),
    evidenceIds: uniqueIds(evidence.rows.map((row) => row.evidenceId)),
    vacancyCount: Number(vacancies.rows[0]?.count ?? 0),
  }
}

async function loadCandidateEvidence(
  candidate: CandidateRow,
  db: CommercialSignalWriterDb,
): Promise<string[]> {
  const result = await db.query<{ evidenceId: string }>(
    `SELECT evidence_id::TEXT AS "evidenceId"
     FROM opportunity_candidate_evidence
     WHERE candidate_id = $1
       AND organization_id = $2
       AND workspace_id = $3
       AND client_profile_id = $4
     ORDER BY evidence_id`,
    [
      candidate.candidateId,
      candidate.organizationId,
      candidate.workspaceId,
      candidate.clientProfileId,
    ],
  )
  return uniqueIds(result.rows.map((row) => row.evidenceId))
}

async function loadExactQueryPlanLinks(
  candidate: CandidateRow,
  db: CommercialSignalWriterDb,
): Promise<QueryPlanLink[]> {
  const result = await db.query<QueryPlanLink>(
    `SELECT DISTINCT
       execution.id::TEXT AS "executionId",
       consumer.plan_snapshot_id::TEXT AS "planSnapshotId"
     FROM query_plan_source_executions execution
     JOIN query_plan_source_execution_consumers consumer
       ON consumer.execution_id = execution.id
      AND consumer.workspace_id = $2
      AND consumer.client_profile_id = $3
     JOIN query_plan_source_execution_signals execution_signal
       ON execution_signal.execution_id = execution.id
      AND execution_signal.organization_id = $4
     JOIN company_event_publications publication
       ON publication.signal_id = execution_signal.signal_id
      AND publication.organization_id = execution_signal.organization_id
     JOIN signal_episode_events episode_event
       ON episode_event.company_event_id = publication.company_event_id
      AND episode_event.organization_id = publication.organization_id
     WHERE execution.status = 'succeeded'
       AND episode_event.signal_episode_id = $1
       AND episode_event.organization_id = $4
     ORDER BY execution.id, consumer.plan_snapshot_id`,
    [
      candidate.signalEpisodeId,
      candidate.workspaceId,
      candidate.clientProfileId,
      candidate.organizationId,
    ],
  )
  return result.rows
}

async function ensureCompatibilityHiringEpisode(
  candidate: CandidateRow,
  facts: ContributingEpisodeFacts,
  lineageKey: string,
  db: CommercialSignalWriterDb,
): Promise<string> {
  const episodeKey = compatibilityEpisodeKey(candidate)
  const type = compatibilityEpisodeType(candidate.signalEpisodeType)
  const timingScore = componentScore(candidate.qualityComponents, 'timing')
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO hiring_episodes (
       organization_id, episode_type, episode_key, title, summary, status,
       started_at, last_seen_at, signal_count, vacancy_count,
       strength_score, freshness_score, evidence_hash, engine_version, metadata
     )
     VALUES (
       $1, $2, $3, $4, $5, 'active', $6::TIMESTAMPTZ, $7::TIMESTAMPTZ,
       $8, $9, $10, $11, $12, $13, $14::JSONB
     )
     ON CONFLICT (organization_id, episode_key, engine_version) DO NOTHING
     RETURNING id::TEXT AS id`,
    [
      candidate.organizationId,
      type,
      episodeKey,
      opportunityTitle(candidate),
      firstProblemHypothesis(candidate),
      candidate.episodeStartedAt,
      candidate.episodeLastSeenAt,
      facts.signalIds.length,
      facts.vacancyCount,
      candidate.episodeIntensity,
      timingScore,
      candidate.evidenceHash,
      COMPATIBILITY_ENGINE_VERSION,
      JSON.stringify({
        compatibilityOnly: true,
        lineageKey,
        sourceSignalEpisodeId: candidate.signalEpisodeId,
        sourceSignalEpisodeIdentity: candidate.signalEpisodeIdentity,
        sourceSignalEpisodeGeneration: candidate.signalEpisodeGeneration,
        sourceCandidateId: candidate.candidateId,
        sourceCandidateIdentity: candidate.candidateIdentity,
        sourceCandidateGeneration: candidate.candidateGeneration,
      }),
    ],
  )
  const id = inserted.rows[0]?.id
  if (id) return id

  const existing = await db.query<{
    id: string
    metadata: Record<string, unknown>
  }>(
    `SELECT id::TEXT AS id, metadata
     FROM hiring_episodes
     WHERE organization_id = $1
       AND episode_key = $2
       AND engine_version = $3
     FOR UPDATE`,
    [candidate.organizationId, episodeKey, COMPATIBILITY_ENGINE_VERSION],
  )
  const row = existing.rows[0]
  if (!row ||
      String(row.metadata?.sourceSignalEpisodeId ?? '') !== candidate.signalEpisodeId ||
      Number(row.metadata?.sourceSignalEpisodeGeneration ?? 0) !==
        candidate.signalEpisodeGeneration ||
      String(row.metadata?.sourceCandidateId ?? '') !== candidate.candidateId ||
      Number(row.metadata?.sourceCandidateGeneration ?? 0) !==
        candidate.candidateGeneration) {
    throw new CommercialSignalLineageError('Compatibility episode identity collision.')
  }
  return row.id
}

async function attachCompatibilityEpisodeProvenance(
  compatibilityEpisodeId: string,
  organizationId: string,
  facts: ContributingEpisodeFacts,
  db: CommercialSignalWriterDb,
): Promise<void> {
  for (const signalId of facts.signalIds) {
    await db.query(
      `INSERT INTO hiring_episode_evidence (
         hiring_episode_id, organization_id, signal_id, relation_type
       )
       VALUES ($1, $2, $3, 'source')
       ON CONFLICT (hiring_episode_id, signal_id) DO NOTHING`,
      [compatibilityEpisodeId, organizationId, signalId],
    )
  }
  for (const evidenceId of facts.evidenceIds) {
    await db.query(
      `INSERT INTO hiring_episode_evidence (
         hiring_episode_id, organization_id, evidence_id, relation_type
       )
       VALUES ($1, $2, $3, 'supporting')
       ON CONFLICT (hiring_episode_id, evidence_id) DO NOTHING`,
      [compatibilityEpisodeId, organizationId, evidenceId],
    )
  }
}

async function insertCompatibilityOpportunity(
  candidate: CandidateRow,
  compatibilityEpisodeId: string,
  lineageKey: string,
  card: CommercialSignalCard,
  now: Date,
  db: CommercialSignalWriterDb,
): Promise<string> {
  const agencyFit = componentScore(candidate.qualityComponents, 'agencyFit')
  const propensity = componentScore(
    candidate.qualityComponents,
    'externalAgencyPropensity',
  )
  const timing = componentScore(candidate.qualityComponents, 'timing')
  const confidence = componentScore(
    candidate.qualityComponents,
    'evidenceConfidence',
  )
  const status = candidate.status === 'qualified_actionable' ? 'new' : 'review'
  const componentScores = {
    agencyFit,
    hiringIntent: candidate.qualityScore,
    externalSupportNeed: propensity,
    timing,
    reachability: candidate.actionabilityScore,
    confidence,
  }
  const metadata = {
    commercialSignalCard: card,
    commercialSignalLineageKey: lineageKey,
    commercialSignalCandidateId: candidate.candidateId,
    commercialSignalCandidateIdentity: candidate.candidateIdentity,
    commercialSignalCandidateGeneration: candidate.candidateGeneration,
    signalEpisodeId: candidate.signalEpisodeId,
    signalEpisodeIdentity: candidate.signalEpisodeIdentity,
    signalEpisodeGeneration: candidate.signalEpisodeGeneration,
    compatibilityEpisode: true,
    morningBriefEligible: candidate.status === 'qualified_actionable',
    validationStatus: candidate.calibrationStatus,
    opportunityMode: candidate.opportunityMode,
  }
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO opportunities (
       owner_id, client_profile_id, organization_id, hiring_episode_id,
       workspace_id, status, title, why_now, problem_hypothesis,
       recommended_angle, recommended_persona, recommended_action,
       agency_fit_score, hiring_intent_score, agency_propensity_score,
       timing_score, reachability_score, confidence_score, opportunity_score,
       confidence_gate, scoring_version, evidence_hash, valid_from, valid_until,
       metadata, feature_schema_version, gate_version, component_scores,
       hard_gate_results, ranking_score, action_queue_eligible
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
       $13, $14, $15, $16, $17, $18, $19, $20, 'opportunity-v3', $21,
       $22::TIMESTAMPTZ, $23::TIMESTAMPTZ, $24::JSONB, $25, $26,
       $27::JSONB, $28::JSONB, $29, $30
     )
     ON CONFLICT (client_profile_id, hiring_episode_id, scoring_version)
     DO NOTHING
     RETURNING id::TEXT AS id`,
    [
      candidate.ownerId,
      candidate.clientProfileId,
      candidate.organizationId,
      compatibilityEpisodeId,
      candidate.workspaceId,
      status,
      opportunityTitle(candidate),
      card.whyNow.text,
      firstProblemHypothesis(candidate),
      card.whyThisAgency.text,
      recommendedPersona(candidate),
      card.recommendedAction.text,
      agencyFit,
      candidate.qualityScore,
      propensity,
      timing,
      candidate.actionabilityScore,
      confidence,
      candidate.rankingScore,
      confidenceGate(confidence),
      candidate.evidenceHash,
      now.toISOString(),
      candidate.validUntil,
      JSON.stringify(metadata),
      candidate.featureSchemaVersion,
      candidate.gateVersion,
      JSON.stringify(componentScores),
      JSON.stringify(candidate.hardGates),
      candidate.rankingScore,
      candidate.status === 'qualified_actionable',
    ],
  )
  if (inserted.rows[0]?.id) return inserted.rows[0].id

  const existing = await db.query<{
    id: string
    lineageKey: string | null
  }>(
    `SELECT
       id::TEXT AS id,
       metadata->>'commercialSignalLineageKey' AS "lineageKey"
     FROM opportunities
     WHERE client_profile_id = $1
       AND hiring_episode_id = $2
       AND scoring_version = 'opportunity-v3'
     FOR UPDATE`,
    [candidate.clientProfileId, compatibilityEpisodeId],
  )
  const row = existing.rows[0]
  if (!row || row.lineageKey !== lineageKey) {
    throw new CommercialSignalLineageError('Opportunity exact-lineage collision.')
  }
  return row.id
}

async function insertLineage(
  input: {
    candidate: CandidateRow
    compatibilityEpisodeId: string
    opportunityId: string
    lineageKey: string
    card: CommercialSignalCard
  },
  db: CommercialSignalWriterDb,
): Promise<string> {
  const scoreSnapshot = {
    qualityScore: input.candidate.qualityScore,
    actionabilityScore: input.candidate.actionabilityScore,
    rankingScore: input.candidate.rankingScore,
    qualityComponents: input.candidate.qualityComponents,
    actionabilityComponents: input.candidate.actionabilityComponents,
    hardGates: input.candidate.hardGates,
    reasons: input.candidate.reasons,
    featureSnapshot: input.candidate.featureSnapshot,
    evidenceSnapshot: input.candidate.evidenceSnapshot,
    calibrationStatus: input.candidate.calibrationStatus,
  }
  const result = await db.query<{ id: string }>(
    `INSERT INTO commercial_signal_opportunity_lineage (
       lineage_key, opportunity_id, candidate_id,
       compatibility_hiring_episode_id, workspace_id, owner_id,
       client_profile_id, organization_id, candidate_identity,
       candidate_generation, signal_episode_id, signal_episode_identity,
       signal_episode_generation, score_version, score_snapshot,
       commercial_signal_card, evidence_hash
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
       $11, $12, $13, $14, $15::JSONB, $16::JSONB, $17
     )
     ON CONFLICT (candidate_id) DO NOTHING
     RETURNING id::TEXT AS id`,
    [
      input.lineageKey,
      input.opportunityId,
      input.candidate.candidateId,
      input.compatibilityEpisodeId,
      input.candidate.workspaceId,
      input.candidate.ownerId,
      input.candidate.clientProfileId,
      input.candidate.organizationId,
      input.candidate.candidateIdentity,
      input.candidate.candidateGeneration,
      input.candidate.signalEpisodeId,
      input.candidate.signalEpisodeIdentity,
      input.candidate.signalEpisodeGeneration,
      input.candidate.scoreVersion,
      JSON.stringify(scoreSnapshot),
      JSON.stringify(input.card),
      input.candidate.evidenceHash,
    ],
  )
  if (result.rows[0]?.id) return result.rows[0].id

  const existing = await db.query<{ id: string; lineageKey: string }>(
    `SELECT id::TEXT AS id, lineage_key AS "lineageKey"
     FROM commercial_signal_opportunity_lineage
     WHERE candidate_id = $1`,
    [input.candidate.candidateId],
  )
  if (!existing.rows[0] || existing.rows[0].lineageKey !== input.lineageKey) {
    throw new CommercialSignalLineageError('Candidate lineage replay mismatch.')
  }
  return existing.rows[0].id
}

async function supersedeEarlierCommercialSignalOpportunities(
  candidate: CandidateRow,
  opportunityId: string,
  db: CommercialSignalWriterDb,
): Promise<void> {
  await db.query(
    `UPDATE opportunities previous
     SET superseded_at = NOW(), updated_at = NOW()
     FROM commercial_signal_opportunity_lineage lineage
     WHERE lineage.opportunity_id = previous.id
       AND lineage.workspace_id = $1
       AND lineage.client_profile_id = $2
       AND lineage.organization_id = $3
       AND lineage.candidate_identity = $4
       AND lineage.candidate_generation < $5
       AND previous.id <> $6
       AND previous.superseded_at IS NULL`,
    [
      candidate.workspaceId,
      candidate.clientProfileId,
      candidate.organizationId,
      candidate.candidateIdentity,
      candidate.candidateGeneration,
      opportunityId,
    ],
  )
}

export function buildCommercialSignalLineageKey(candidate: Pick<
  CandidateRow,
  | 'workspaceId'
  | 'clientProfileId'
  | 'organizationId'
  | 'signalEpisodeIdentity'
  | 'signalEpisodeGeneration'
  | 'candidateIdentity'
  | 'candidateGeneration'
  | 'scoreVersion'
>): string {
  return hashCanonicalJson({
    workspaceId: candidate.workspaceId,
    clientProfileId: candidate.clientProfileId,
    organizationId: candidate.organizationId,
    signalEpisodeIdentity: candidate.signalEpisodeIdentity,
    signalEpisodeGeneration: candidate.signalEpisodeGeneration,
    candidateIdentity: candidate.candidateIdentity,
    candidateGeneration: candidate.candidateGeneration,
    scoreVersion: candidate.scoreVersion,
  })
}

export function buildCommercialSignalCard(
  candidate: Pick<
    CandidateRow,
    | 'status'
    | 'signalEpisodeType'
    | 'episodeValidUntil'
    | 'baselineDeviation'
    | 'qualityScore'
    | 'actionabilityScore'
    | 'qualityComponents'
    | 'temporalEvents'
  >,
  evidenceIds: readonly string[],
): CommercialSignalCard {
  const allowedEvidenceIds = new Set(uniqueIds([...evidenceIds]))
  const directEvidenceIds = [...allowedEvidenceIds].slice(0, 32)
  if (directEvidenceIds.length === 0) {
    throw new CommercialSignalLineageError('Commercial Signal card requires evidence.')
  }
  const agencyFit = componentScore(candidate.qualityComponents, 'agencyFit')
  const externalAgencyPropensity = componentScore(
    candidate.qualityComponents,
    'externalAgencyPropensity',
  )
  const acceleration = summarizeOpportunityTemporalContext(
    candidate.temporalEvents,
  ).strongestAcceleration
  const whatChanged: CommercialSignalCardConclusion = {
    text: whatChangedText(
      candidate.signalEpisodeType,
      candidate.baselineDeviation,
    ),
    basis: 'evidence',
    evidenceIds: directEvidenceIds,
  }
  const card: CommercialSignalCard = {
    version: 'commercial-signal-card-v1',
    scoreVersion: 'opportunity-v3',
    status: candidate.status,
    whatChanged,
    whyNotOrdinaryHiring: {
      text: 'Ситуация сформирована через подтверждённый Company State Change и Signal Episode, а не из одной публикации вакансии.',
      basis: 'heuristic',
      evidenceIds: [],
    },
    whyAgency: {
      text: 'External Agency Propensity прошёл hard gate качества; обычная активность найма без внешней потребности сюда не проходит.',
      basis: 'heuristic',
      evidenceIds: [],
    },
    whyThisAgency: {
      text: 'Agency DNA Match прошёл обязательные fit/coverage gates для этого workspace и профиля.',
      basis: 'heuristic',
      evidenceIds: [],
    },
    whyNow: {
      text: acceleration && acceleration.change > 0
        ? `Подтверждённый Signal Episode остаётся активным до ${isoDate(candidate.episodeValidUntil)}. Активные вакансии выросли с ${acceleration.previous} до ${acceleration.current} за ${acceleration.windowDays} дней.`
        : `Подтверждённый Signal Episode остаётся активным до ${isoDate(candidate.episodeValidUntil)}.`,
      basis: 'evidence',
      evidenceIds: directEvidenceIds,
    },
    metrics: {
      externalAgencyPropensity: metric(
        externalAgencyPropensity,
        'external_agency_propensity.hard_gate_passed',
      ),
      agencyFit: metric(agencyFit, 'agency_dna.fit_gate_passed'),
      opportunityQuality: metric(
        candidate.qualityScore,
        'opportunity_quality.qualified',
      ),
      actionability: metric(
        candidate.actionabilityScore,
        candidate.status === 'qualified_actionable'
          ? 'actionability.safe_contact_path_ready'
          : 'actionability.enrichment_required',
      ),
    },
    recommendedAction: {
      text: candidate.status === 'qualified_actionable'
        ? 'Использовать подтверждённую ситуацию как основу точечного outreach через разрешённый corporate contact path.'
        : 'Сначала завершить corporate enrichment; до появления разрешённого contact path не переводить opportunity в outreach.',
      basis: 'heuristic',
      evidenceIds: [],
    },
    constraints: [
      {
        text: 'Score — ranking heuristic, а не вероятность покупки агентства.',
        basis: 'heuristic',
        evidenceIds: [],
      },
      {
        text: 'Перед действием необходимо повторно проверить свежесть evidence и отсутствие новых negative signals.',
        basis: 'heuristic',
        evidenceIds: [],
      },
    ],
  }
  const parsed = parseCommercialSignalCard(card, allowedEvidenceIds)
  if (!parsed) {
    throw new CommercialSignalLineageError('Commercial Signal card failed its strict contract.')
  }
  return parsed
}

export function compatibilityEpisodeType(signalEpisodeType: string): string {
  switch (signalEpisodeType) {
    case 'vacancy_acceleration':
    case 'leadership_led_expansion':
    case 'recruiting_capacity_gap':
    case 'business_expansion':
      return 'vacancy_spike'
    case 'persistent_hiring_problem':
      return 'repeated_vacancies'
    case 'role_cluster':
    case 'new_unit_buildout':
      return 'new_role_cluster'
    case 'new_region_expansion':
      return 'new_region'
    case 'hiring_restart':
    case 'reactivation_window':
      return 'hiring_restart'
    case 'sustained_hiring':
      return 'sustained_hiring'
    default:
      throw new CommercialSignalLineageError(
        `Unsupported Signal Episode type: ${signalEpisodeType}`,
      )
  }
}

function compatibilityEpisodeKey(candidate: CandidateRow): string {
  return `commercial-signal-v3:${candidate.signalEpisodeIdentity}:g${candidate.signalEpisodeGeneration}:c${candidate.candidateGeneration}`
}

function opportunityTitle(candidate: CandidateRow): string {
  const company = candidate.organizationName.trim()
  const prefix = episodeTitle(candidate.signalEpisodeType)
  return company ? `${prefix}: ${company}` : prefix
}

function episodeTitle(type: string): string {
  switch (type) {
    case 'vacancy_acceleration': return 'Ускорение найма относительно baseline'
    case 'persistent_hiring_problem': return 'Устойчивая кадровая проблема'
    case 'role_cluster': return 'Кластер связанного найма'
    case 'new_region_expansion': return 'Региональное расширение найма'
    case 'hiring_restart': return 'Возобновление найма после паузы'
    case 'sustained_hiring': return 'Устойчиво повышенный темп найма'
    case 'leadership_led_expansion': return 'Расширение после изменения руководства'
    case 'recruiting_capacity_gap': return 'Разрыв recruiting capacity'
    case 'new_unit_buildout': return 'Формирование нового подразделения'
    case 'business_expansion': return 'Бизнес-расширение с кадровым подтверждением'
    case 'reactivation_window': return 'Окно реактивации бывшего клиента'
    default: return 'Подтверждённая кадровая ситуация'
  }
}

function whatChangedText(type: string, baselineDeviation: number | null): string {
  const base = (() => {
    switch (type) {
      case 'vacancy_acceleration':
        return 'Темп найма отклонился вверх от нормального baseline компании.'
      case 'persistent_hiring_problem':
        return 'Сформировалась повторяющаяся или затяжная кадровая ситуация.'
      case 'role_cluster':
        return 'Одновременно сформировался кластер связанных ролей.'
      case 'new_region_expansion':
        return 'Найм расширился в новый относительно наблюдаемого baseline регион.'
      case 'hiring_restart':
        return 'После подтверждённой паузы компания возобновила значимый найм.'
      case 'sustained_hiring':
        return 'Повышенная активность найма сохраняется несколько периодов.'
      case 'leadership_led_expansion':
        return 'Изменение руководства совпало с подтверждённым ускорением найма.'
      case 'recruiting_capacity_gap':
        return 'Рост найма совпал с признаками нехватки recruiting capacity.'
      case 'new_unit_buildout':
        return 'Набор связанных кадровых сигналов указывает на построение нового подразделения.'
      case 'business_expansion':
        return 'Бизнес-событие совпало с подтверждённым изменением кадрового состояния.'
      case 'reactivation_window':
        return 'После паузы появилась новая значимая кадровая волна по бывшему клиенту.'
      default:
        return 'Зафиксировано подтверждённое изменение кадрового состояния компании.'
    }
  })()
  return baselineDeviation === null || !Number.isFinite(baselineDeviation)
    ? base
    : `${base} Baseline deviation: ${round(baselineDeviation)}.`
}

function recommendedPersona(candidate: CandidateRow): string {
  const actionability = record(candidate.featureSnapshot.actionability)
  const functions = stringArray(actionability.decisionMakerFunctions)
  return functions[0] ?? 'Функция, отвечающая за найм'
}

function firstProblemHypothesis(candidate: CandidateRow): string {
  const hypothesis = candidate.problemHypotheses
    .map((value) => value.trim())
    .find(Boolean)
  if (!hypothesis) {
    throw new CommercialSignalLineageError('Signal Episode problem hypothesis is missing.')
  }
  return hypothesis
}

function assertEvidenceSubset(
  candidateEvidence: readonly string[],
  episodeEvidence: readonly string[],
  candidateId: string,
): void {
  const episodeSet = new Set(episodeEvidence)
  if (candidateEvidence.some((id) => !episodeSet.has(id))) {
    throw new CommercialSignalLineageError(
      `Candidate ${candidateId} contains evidence outside its exact Signal Episode.`,
    )
  }
}

function componentScore(
  components: Record<string, unknown>,
  key: string,
): number {
  const component = record(components[key])
  const value = Number(component.score)
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new CommercialSignalLineageError(`Invalid ${key} component score.`)
  }
  return value
}

function metric(value: number, reasonCode: string): CommercialSignalCardMetric {
  return { value: round(value), reasonCodes: [reasonCode] }
}

function confidenceGate(value: number): 'A' | 'B' | 'C' {
  if (value >= 0.8) return 'A'
  if (value >= 0.65) return 'B'
  return 'C'
}

function buildCandidateScoreSnapshot(candidate: CandidateRow) {
  return {
    qualityScore: candidate.qualityScore,
    actionabilityScore: candidate.actionabilityScore,
    rankingScore: candidate.rankingScore,
    qualityComponents: candidate.qualityComponents,
    actionabilityComponents: candidate.actionabilityComponents,
    hardGates: candidate.hardGates,
    reasons: candidate.reasons,
    featureSnapshot: candidate.featureSnapshot,
    evidenceSnapshot: candidate.evidenceSnapshot,
    calibrationStatus: candidate.calibrationStatus,
  }
}

function candidateFromRow(row: Record<string, unknown>): CandidateRow {
  const status = String(row.status)
  if (status !== 'qualified_actionable' && status !== 'qualified_needs_enrichment') {
    throw new CommercialSignalLineageError(`Unsupported materialization status ${status}.`)
  }
  return {
    candidateId: positiveId(row.candidateId, 'candidate'),
    organizationId: positiveId(row.organizationId, 'organization'),
    organizationName: String(row.organizationName ?? '').trim(),
    workspaceId: positiveId(row.workspaceId, 'workspace'),
    ownerId: positiveId(row.ownerId, 'owner'),
    clientProfileId: positiveId(row.clientProfileId, 'client profile'),
    candidateIdentity: hash(row.candidateIdentity, 'candidate identity'),
    candidateGeneration: positiveInteger(row.candidateGeneration, 'candidate generation'),
    signalEpisodeId: positiveId(row.signalEpisodeId, 'signal episode'),
    signalEpisodeIdentity: hash(row.signalEpisodeIdentity, 'signal episode identity'),
    signalEpisodeGeneration: positiveInteger(
      row.signalEpisodeGeneration,
      'signal episode generation',
    ),
    signalEpisodeType: String(row.signalEpisodeType),
    signalEpisodeStage: String(row.signalEpisodeStage),
    episodeStartedAt: timestamp(row.episodeStartedAt, 'episode started at'),
    episodeLastSeenAt: timestamp(row.episodeLastSeenAt, 'episode last seen at'),
    episodeValidUntil: timestamp(row.episodeValidUntil, 'episode valid until'),
    episodeIntensity: score(row.episodeIntensity, 'episode intensity'),
    baselineDeviation: nullableNumber(row.baselineDeviation),
    problemHypotheses: stringArray(row.problemHypotheses),
    opportunityMode: String(row.opportunityMode),
    qualityScore: score(row.qualityScore, 'quality score'),
    actionabilityScore: score(row.actionabilityScore, 'actionability score'),
    rankingScore: score(row.rankingScore, 'ranking score'),
    status,
    qualityComponents: record(row.qualityComponents),
    actionabilityComponents: record(row.actionabilityComponents),
    hardGates: array(row.hardGates),
    reasons: array(row.reasons),
    featureSnapshot: record(row.featureSnapshot),
    evidenceSnapshot: record(row.evidenceSnapshot),
    evidenceHash: hash(row.evidenceHash, 'evidence hash'),
    scoreVersion: String(row.scoreVersion),
    featureSchemaVersion: String(row.featureSchemaVersion),
    gateVersion: String(row.gateVersion),
    calibrationStatus: String(row.calibrationStatus),
    validUntil: timestamp(row.validUntil, 'candidate valid until'),
    temporalEvents: row.temporalEvents,
  }
}

function positiveId(value: unknown, label: string): string {
  const normalized = String(value ?? '').trim()
  if (!/^[1-9]\d{0,18}$/.test(normalized) ||
      BigInt(normalized) > BigInt('9223372036854775807')) {
    throw new CommercialSignalWriterScopeError(`Invalid ${label} identifier.`)
  }
  return BigInt(normalized).toString()
}

function optionalPositiveId(
  value: string | number | null | undefined,
  label: string,
): string | null {
  return value == null ? null : positiveId(value, label)
}

function positiveInteger(value: unknown, label: string): number {
  const number = Number(value)
  if (!Number.isInteger(number) || number <= 0) {
    throw new CommercialSignalLineageError(`Invalid ${label}.`)
  }
  return number
}

function boundedInteger(
  value: number,
  min: number,
  max: number,
  label: string,
): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new CommercialSignalWriterScopeError(
      `${label} must be an integer between ${min} and ${max}.`,
    )
  }
  return value
}

function hash(value: unknown, label: string): string {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new CommercialSignalLineageError(`Invalid ${label}.`)
  }
  return normalized
}

function score(value: unknown, label: string): number {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw new CommercialSignalLineageError(`Invalid ${label}.`)
  }
  return number
}

function nullableNumber(value: unknown): number | null {
  if (value == null) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function timestamp(value: unknown, label: string): string {
  const text = String(value ?? '')
  const date = new Date(text)
  if (!Number.isFinite(date.getTime())) {
    throw new CommercialSignalLineageError(`Invalid ${label}.`)
  }
  return date.toISOString()
}

function validDate(value: Date): Date {
  if (!Number.isFinite(value.getTime())) {
    throw new CommercialSignalWriterScopeError('Writer now must be a valid date.')
  }
  return value
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? [...value] : []
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : []
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...value as Record<string, unknown> }
    : {}
}

function uniqueIds(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => positiveId(value, 'evidence')))]
    .sort((left, right) => BigInt(left) < BigInt(right) ? -1 : 1)
}

function round(value: number): number {
  return Math.round(value * 100_000) / 100_000
}

function isoDate(value: string): string {
  return new Date(value).toISOString().slice(0, 10)
}
