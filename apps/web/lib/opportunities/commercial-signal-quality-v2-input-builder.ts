import type { QueryResult } from 'pg'

import {
  buildEconomicsFit,
  buildMarketDifficulty,
} from './commercial-fit-v2'
import type {
  CommercialSignalCompanyStateChangeLineage,
  CommercialSignalCompanyStateLineage,
  CommercialSignalCompanyStateSnapshot,
  CommercialSignalQualityEngineV2Input,
  CommercialSignalQualityStatus,
} from './commercial-signal-quality-engine-v2'
import {
  buildEvidenceIndependence,
  type CommercialSignalEvidenceProvenance,
  type OpportunityQualityComponent,
} from './commercial-signal-quality-v2'
import { buildExternalAgencyPropensity } from './external-agency-propensity-v2'
import {
  buildHiringFriction,
  type EvidencedFlag,
  type EvidencedMetric,
  type EvidencedRepostCycles,
} from './hiring-friction-v1'
import { buildHiringProblemArchetypes } from './hiring-problem-archetypes-v1'
import {
  getSourceFeatureCapability,
  type SourceFeature,
} from './source-feature-capabilities'
import {
  evaluateNegativeEvidence,
  type NegativeEvidenceInput,
} from './negative-evidence-v1'
import {
  buildSignalConvergence,
  type SignalConvergenceEvent,
  type SignalConvergenceEventType,
} from './signal-convergence-v1'

export type CommercialSignalQualityV2InputBuilderDb = {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
}

export type CommercialSignalQualityV2InputScope = {
  workspaceId: string
  clientProfileId: string
  organizationId?: string | null
}

export type CommercialSignalQualityV2BuiltInput = {
  opportunityLineageId: string
  candidateId: string
  candidateGeneration: number
  v3Status: CommercialSignalQualityStatus
  v3QualityScore: number
  archetypes: string[]
  organizationId: string
  workspaceId: string
  clientProfileId: string
  organizationIndustry: string | null
  validUntil: string
  input: CommercialSignalQualityEngineV2Input
}

export const COMMERCIAL_SIGNAL_QUALITY_V2_LINEAGE_ERROR_CODES = [
  'QUALITY_LINEAGE_NOT_FOUND_OR_SCOPE_MISMATCH',
  'QUALITY_LINEAGE_CANDIDATE_STALE',
  'QUALITY_LINEAGE_EPISODE_STALE',
  'QUALITY_LINEAGE_MATCH_STALE',
  'QUALITY_LINEAGE_PROPENSITY_STALE',
  'QUALITY_LINEAGE_THESIS_STALE',
  'QUALITY_LINEAGE_STATE_MISSING',
  'QUALITY_LINEAGE_STATE_FUTURE',
  'QUALITY_LINEAGE_STATE_INVALID',
  'QUALITY_LINEAGE_EVIDENCE_MISSING',
] as const

export type CommercialSignalQualityV2LineageErrorCode =
  typeof COMMERCIAL_SIGNAL_QUALITY_V2_LINEAGE_ERROR_CODES[number]

export class CommercialSignalQualityV2LineageError extends Error {
  readonly code: CommercialSignalQualityV2LineageErrorCode

  constructor(code: CommercialSignalQualityV2LineageErrorCode) {
    super(code)
    this.name = 'CommercialSignalQualityV2LineageError'
    this.code = code
  }
}

type LineageRow = {
  opportunityLineageId: string
  candidateId: string
  organizationId: string
  workspaceId: string
  clientProfileId: string
  lineageCandidateIdentity: string
  candidateIdentity: string | null
  lineageCandidateGeneration: number
  candidateGeneration: number | null
  signalEpisodeId: string
  signalEpisodeIdentity: string
  lineageEpisodeGeneration: number
  episodeIdentity: string | null
  episodeGeneration: number | null
  lineageCreatedAt: string
  candidateValidUntil: string | null
  episodeValidUntil: string | null
  qualityComponents: unknown
  actionabilityComponents: unknown
  candidateFeatures: unknown
  v3Status: string
  v3QualityScore: number
  matchId: string | null
  matchGeneration: number | null
  candidateMatchGeneration: number | null
  matchFitScore: number | null
  matchCoverage: number | null
  propensityId: string | null
  propensityGeneration: number | null
  candidatePropensityGeneration: number | null
  propensityScore: number | null
  propensityLevel: string | null
  thesisId: string | null
  thesisGeneration: number | null
  candidateThesisGeneration: number | null
  stateSnapshotId: string | null
  stateSnapshotAt: string | null
  stateHiringBaseline: unknown
  stateCurrentHiringVelocity: unknown
  stateRoleDistribution: unknown
  stateSeniorityDistribution: unknown
  stateRegionDistribution: unknown
  stateVacancyLifetime: unknown
  stateRepostRate: unknown
  stateRecruitingCapacitySignals: unknown
  stateBusinessChangeSignals: unknown
  stateClassification: string | null
  stateConfidence: number | null
  stateFeatureVersion: string | null
  stateEventIds: string[]
  stateEvidenceIds: string[]
  stateHasFutureEvent: boolean
  stateHasFutureEvidence: boolean
  stateHasFutureChange: boolean
  accountRestriction: string | null
  organizationIndustry: string | null
}

type EventRow = {
  eventId: string
  eventType: string
  occurredAt: string
  lastSeenAt: string
  confidence: number | null
  payload: unknown
  evidenceIds: string[]
}

type EvidenceRow = {
  evidenceId: string
  source: string
  url: string
  fetchedAt: string
  contentHash: string
  tier: string
  payloadRef: unknown
  matchEvidence: boolean
  propensityEvidence: boolean
  thesisEvidence: boolean
  episodeEvidence: boolean
}

type StateChangeRow = CommercialSignalCompanyStateChangeLineage

const LINEAGE_SQL = `SELECT
  lineage.id::TEXT AS "opportunityLineageId",
  lineage.candidate_id::TEXT AS "candidateId",
  lineage.organization_id::TEXT AS "organizationId",
  lineage.workspace_id::TEXT AS "workspaceId",
  lineage.client_profile_id::TEXT AS "clientProfileId",
  lineage.candidate_identity AS "lineageCandidateIdentity",
  candidate.candidate_identity AS "candidateIdentity",
  lineage.candidate_generation AS "lineageCandidateGeneration",
  candidate.candidate_generation AS "candidateGeneration",
  lineage.signal_episode_id::TEXT AS "signalEpisodeId",
  lineage.signal_episode_identity AS "signalEpisodeIdentity",
  lineage.signal_episode_generation AS "lineageEpisodeGeneration",
  episode.episode_identity AS "episodeIdentity",
  episode.episode_generation AS "episodeGeneration",
  lineage.created_at AS "lineageCreatedAt",
  candidate.valid_until AS "candidateValidUntil",
  episode.valid_until AS "episodeValidUntil",
  candidate.quality_components AS "qualityComponents",
  candidate.actionability_components AS "actionabilityComponents",
  candidate.feature_snapshot AS "candidateFeatures",
  candidate.status AS "v3Status",
  candidate.quality_score AS "v3QualityScore",
  match.id::TEXT AS "matchId",
  match.match_generation AS "matchGeneration",
  candidate.agency_dna_match_generation AS "candidateMatchGeneration",
  match.fit_score AS "matchFitScore",
  match.coverage AS "matchCoverage",
  propensity.id::TEXT AS "propensityId",
  propensity.propensity_generation AS "propensityGeneration",
  candidate.propensity_generation AS "candidatePropensityGeneration",
  propensity.score AS "propensityScore",
  propensity.level AS "propensityLevel",
  thesis.id::TEXT AS "thesisId",
  thesis.thesis_generation AS "thesisGeneration",
  candidate.commercial_thesis_generation AS "candidateThesisGeneration",
  state_snapshot.id::TEXT AS "stateSnapshotId",
  state_snapshot.snapshot_at AS "stateSnapshotAt",
  state_snapshot.hiring_baseline AS "stateHiringBaseline",
  state_snapshot.current_hiring_velocity AS "stateCurrentHiringVelocity",
  state_snapshot.role_distribution AS "stateRoleDistribution",
  state_snapshot.seniority_distribution AS "stateSeniorityDistribution",
  state_snapshot.region_distribution AS "stateRegionDistribution",
  state_snapshot.vacancy_lifetime AS "stateVacancyLifetime",
  state_snapshot.repost_rate AS "stateRepostRate",
  state_snapshot.recruiting_capacity_signals AS "stateRecruitingCapacitySignals",
  state_snapshot.business_change_signals AS "stateBusinessChangeSignals",
  state_snapshot.state_classification AS "stateClassification",
  state_snapshot.state_confidence AS "stateConfidence",
  state_snapshot.feature_version AS "stateFeatureVersion",
  COALESCE(ARRAY(
    SELECT snapshot_event.company_event_id::TEXT
    FROM company_state_snapshot_events snapshot_event
    WHERE snapshot_event.snapshot_id = state_snapshot.id
      AND snapshot_event.organization_id = lineage.organization_id
    ORDER BY snapshot_event.company_event_id
  ), ARRAY[]::TEXT[]) AS "stateEventIds",
  COALESCE(ARRAY(
    SELECT snapshot_evidence.evidence_id::TEXT
    FROM company_state_snapshot_evidence snapshot_evidence
    WHERE snapshot_evidence.snapshot_id = state_snapshot.id
      AND snapshot_evidence.organization_id = lineage.organization_id
    ORDER BY snapshot_evidence.evidence_id
  ), ARRAY[]::TEXT[]) AS "stateEvidenceIds",
  EXISTS (
    SELECT 1
    FROM company_state_snapshot_events snapshot_event
    JOIN company_events state_event
      ON state_event.id = snapshot_event.company_event_id
     AND state_event.organization_id = snapshot_event.organization_id
    WHERE snapshot_event.snapshot_id = state_snapshot.id
      AND snapshot_event.organization_id = lineage.organization_id
      AND state_event.occurred_at > lineage.created_at
  ) AS "stateHasFutureEvent",
  EXISTS (
    SELECT 1
    FROM company_state_snapshot_evidence snapshot_evidence
    JOIN evidence_items state_evidence
      ON state_evidence.id = snapshot_evidence.evidence_id
     AND state_evidence.org_id = snapshot_evidence.organization_id
    WHERE snapshot_evidence.snapshot_id = state_snapshot.id
      AND snapshot_evidence.organization_id = lineage.organization_id
      AND state_evidence.fetched_at > lineage.created_at
  ) AS "stateHasFutureEvidence",
  EXISTS (
    SELECT 1
    FROM company_state_changes state_change
    WHERE state_change.snapshot_id = state_snapshot.id
      AND state_change.organization_id = lineage.organization_id
      AND state_change.created_at > lineage.created_at
  ) AS "stateHasFutureChange",
  match.feature_snapshot #>> '{agency,accountRestriction}'
    AS "accountRestriction",
  match.feature_snapshot #>> '{company,organizationIndustry}'
    AS "organizationIndustry"
FROM commercial_signal_opportunity_lineage lineage
LEFT JOIN opportunity_candidates candidate
  ON candidate.id = lineage.candidate_id
 AND candidate.organization_id = lineage.organization_id
 AND candidate.workspace_id = lineage.workspace_id
 AND candidate.client_profile_id = lineage.client_profile_id
LEFT JOIN signal_episodes episode
  ON episode.id = lineage.signal_episode_id
 AND episode.organization_id = lineage.organization_id
LEFT JOIN agency_dna_match_snapshots match
  ON match.id = candidate.agency_dna_match_snapshot_id
 AND match.organization_id = lineage.organization_id
 AND match.workspace_id = lineage.workspace_id
 AND match.client_profile_id = lineage.client_profile_id
LEFT JOIN external_agency_propensity_snapshots propensity
  ON propensity.id = candidate.propensity_snapshot_id
 AND propensity.organization_id = lineage.organization_id
 AND propensity.workspace_id = lineage.workspace_id
 AND propensity.client_profile_id = lineage.client_profile_id
LEFT JOIN commercial_theses thesis
  ON thesis.id = candidate.commercial_thesis_id
 AND thesis.organization_id = lineage.organization_id
LEFT JOIN company_state_snapshots state_snapshot
  ON state_snapshot.id = candidate.company_state_snapshot_id
 AND state_snapshot.organization_id = lineage.organization_id
WHERE lineage.id = $1
  AND lineage.workspace_id = $2
  AND lineage.client_profile_id = $3
  AND ($4::BIGINT IS NULL OR lineage.organization_id = $4)`

const EVENTS_SQL = `SELECT
  event.id::TEXT AS "eventId",
  event.event_type AS "eventType",
  event.occurred_at AS "occurredAt",
  event.last_seen_at AS "lastSeenAt",
  event.confidence,
  event.payload,
  ARRAY(
    SELECT evidence_id::TEXT
    FROM UNNEST(event.evidence_ids) evidence_id
    ORDER BY evidence_id
  ) AS "evidenceIds"
FROM signal_episode_events episode_event
JOIN company_events event
  ON event.id = episode_event.company_event_id
 AND event.organization_id = episode_event.organization_id
WHERE episode_event.signal_episode_id = $1
  AND episode_event.organization_id = $2
  AND event.occurred_at <= $3::TIMESTAMPTZ
ORDER BY event.occurred_at, event.id`

const STATE_CHANGES_SQL = `SELECT
  state_change.id::TEXT AS "changeId",
  state_change.change_type AS "changeType",
  state_change.direction,
  state_change.magnitude,
  state_change.baseline_deviation AS "baselineDeviation",
  state_change.confidence,
  ARRAY(
    SELECT change_event.company_event_id::TEXT
    FROM company_state_change_events change_event
    WHERE change_event.change_id = state_change.id
      AND change_event.organization_id = state_change.organization_id
    ORDER BY change_event.company_event_id
  ) AS "eventIds",
  ARRAY(
    SELECT change_evidence.evidence_id::TEXT
    FROM company_state_change_evidence change_evidence
    WHERE change_evidence.change_id = state_change.id
      AND change_evidence.organization_id = state_change.organization_id
    ORDER BY change_evidence.evidence_id
  ) AS "evidenceIds",
  state_snapshot.snapshot_at AS "observedAt",
  state_change.feature_version AS "featureVersion"
FROM company_state_changes state_change
JOIN company_state_snapshots state_snapshot
  ON state_snapshot.id = state_change.snapshot_id
 AND state_snapshot.organization_id = state_change.organization_id
WHERE state_change.snapshot_id = $1
  AND state_change.organization_id = $2
  AND state_snapshot.snapshot_at <= $3::TIMESTAMPTZ
  AND state_change.created_at <= $3::TIMESTAMPTZ
ORDER BY state_change.id`

const STATE_EVIDENCE_SQL = `SELECT
  evidence.id::TEXT AS "evidenceId",
  evidence.source,
  evidence.url,
  evidence.fetched_at AS "fetchedAt",
  evidence.content_hash AS "contentHash",
  evidence.tier,
  evidence.payload_ref AS "payloadRef",
  FALSE AS "matchEvidence",
  FALSE AS "propensityEvidence",
  FALSE AS "thesisEvidence",
  FALSE AS "episodeEvidence"
FROM company_state_snapshot_evidence snapshot_evidence
JOIN evidence_items evidence
  ON evidence.id = snapshot_evidence.evidence_id
 AND evidence.org_id = snapshot_evidence.organization_id
WHERE snapshot_evidence.snapshot_id = $1
  AND snapshot_evidence.organization_id = $2
  AND evidence.fetched_at <= $3::TIMESTAMPTZ
ORDER BY evidence.id`

const EVIDENCE_SQL = `SELECT
  evidence.id::TEXT AS "evidenceId",
  evidence.source,
  evidence.url,
  evidence.fetched_at AS "fetchedAt",
  evidence.content_hash AS "contentHash",
  evidence.tier,
  evidence.payload_ref AS "payloadRef",
  EXISTS (
    SELECT 1 FROM agency_dna_match_evidence match_evidence
    WHERE match_evidence.match_snapshot_id = $6
      AND match_evidence.evidence_id = evidence.id
      AND match_evidence.organization_id = candidate_evidence.organization_id
      AND match_evidence.workspace_id = candidate_evidence.workspace_id
      AND match_evidence.client_profile_id = candidate_evidence.client_profile_id
  ) AS "matchEvidence",
  EXISTS (
    SELECT 1 FROM external_agency_propensity_evidence propensity_evidence
    WHERE propensity_evidence.propensity_snapshot_id = $7
      AND propensity_evidence.evidence_id = evidence.id
      AND propensity_evidence.organization_id = candidate_evidence.organization_id
      AND propensity_evidence.workspace_id = candidate_evidence.workspace_id
      AND propensity_evidence.client_profile_id = candidate_evidence.client_profile_id
  ) AS "propensityEvidence",
  EXISTS (
    SELECT 1 FROM commercial_thesis_evidence thesis_evidence
    WHERE thesis_evidence.commercial_thesis_id = $8
      AND thesis_evidence.evidence_id = evidence.id
      AND thesis_evidence.organization_id = candidate_evidence.organization_id
  ) AS "thesisEvidence",
  EXISTS (
    SELECT 1 FROM signal_episode_evidence episode_evidence
    WHERE episode_evidence.signal_episode_id = $9
      AND episode_evidence.evidence_id = evidence.id
      AND episode_evidence.organization_id = candidate_evidence.organization_id
  ) AS "episodeEvidence"
FROM opportunity_candidate_evidence candidate_evidence
JOIN evidence_items evidence
  ON evidence.id = candidate_evidence.evidence_id
 AND evidence.org_id = candidate_evidence.organization_id
WHERE candidate_evidence.candidate_id = $1
  AND candidate_evidence.organization_id = $2
  AND candidate_evidence.workspace_id = $3
  AND candidate_evidence.client_profile_id = $4
  AND evidence.fetched_at <= $5::TIMESTAMPTZ
ORDER BY evidence.id`

export async function buildCommercialSignalQualityV2Input(
  rawLineageId: string,
  rawScope: CommercialSignalQualityV2InputScope,
  db: CommercialSignalQualityV2InputBuilderDb,
): Promise<CommercialSignalQualityV2BuiltInput> {
  const lineageId = positiveId(rawLineageId, 'opportunity lineage id')
  const scope = {
    workspaceId: positiveId(rawScope.workspaceId, 'workspace id'),
    clientProfileId: positiveId(rawScope.clientProfileId, 'client profile id'),
    organizationId: rawScope.organizationId == null
      ? null
      : positiveId(rawScope.organizationId, 'organization id'),
  }
  const lineageResult = await db.query<LineageRow>(LINEAGE_SQL, [
    lineageId,
    scope.workspaceId,
    scope.clientProfileId,
    scope.organizationId,
  ])
  const row = lineageResult.rows[0]
  if (!row) fail('QUALITY_LINEAGE_NOT_FOUND_OR_SCOPE_MISMATCH')
  validateExactLineage(row)

  const decisionAt = timestamp(row.lineageCreatedAt, 'lineage decision at')
  const [eventResult, evidenceResult, stateChangeResult, stateEvidenceResult] = await Promise.all([
    db.query<EventRow>(EVENTS_SQL, [
      row.signalEpisodeId,
      row.organizationId,
      decisionAt,
    ]),
    db.query<EvidenceRow>(EVIDENCE_SQL, [
      row.candidateId,
      row.organizationId,
      row.workspaceId,
      row.clientProfileId,
      decisionAt,
      row.matchId,
      row.propensityId,
      row.thesisId,
      row.signalEpisodeId,
    ]),
    db.query<StateChangeRow>(STATE_CHANGES_SQL, [
      row.stateSnapshotId,
      row.organizationId,
      decisionAt,
    ]),
    db.query<EvidenceRow>(STATE_EVIDENCE_SQL, [
      row.stateSnapshotId,
      row.organizationId,
      decisionAt,
    ]),
  ])
  const allEvidenceRows = dedupeEvidenceRows([
    ...evidenceResult.rows,
    ...stateEvidenceResult.rows,
  ])
  if (allEvidenceRows.length === 0) fail('QUALITY_LINEAGE_EVIDENCE_MISSING')

  const provenance = allEvidenceRows.map(toProvenance)
  const evidenceById = new Map(provenance.map((item) => [item.evidenceId, item]))
  const allowedEvidenceIds = new Set(provenance.map((item) => item.evidenceId))
  const events = eventResult.rows.map((event) => ({
    ...event,
    evidenceIds: ids(event.evidenceIds.filter((id) => allowedEvidenceIds.has(id))),
  })).filter((event) => event.evidenceIds.length > 0)
  const assembled = assembleInput(
    row,
    events,
    evidenceById,
    allEvidenceRows,
    stateChangeResult.rows,
    new Date(decisionAt),
  )
  const input = assembled.input
  const usedIds = ids([
    ...(input.stateLineage?.evidenceIds ?? []),
    ...(input.stateLineage?.changes.flatMap((item) => item.evidenceIds) ?? []),
    ...input.currentHiringEvidence.evidenceIds,
    ...input.hiringNeed.evidenceIds,
    ...input.hiringFriction.evidenceIds,
    ...input.agencyFit.evidenceIds,
    ...input.propensity.evidenceIds,
    ...input.convergence.evidenceIds,
    ...input.economics.evidenceIds,
    ...input.marketDifficulty.evidenceIds,
    ...input.negativeEvidence.evidenceIds,
    ...input.contact.evidenceIds,
  ])
  input.evidence = usedIds.map((id) => {
    const item = evidenceById.get(id)
    if (!item) fail('QUALITY_LINEAGE_EVIDENCE_MISSING')
    return item
  })

  return {
    opportunityLineageId: row.opportunityLineageId,
    candidateId: row.candidateId,
    candidateGeneration: row.candidateGeneration as number,
    v3Status: qualityStatus(row.v3Status),
    v3QualityScore: unitInterval(row.v3QualityScore, 'v3 quality score'),
    archetypes: assembled.archetypes,
    organizationId: row.organizationId,
    workspaceId: row.workspaceId,
    clientProfileId: row.clientProfileId,
    organizationIndustry: assembled.organizationIndustry,
    validUntil: earliestTimestamp([
      row.candidateValidUntil as string,
      row.episodeValidUntil as string,
    ]),
    input,
  }
}

function validateExactLineage(row: LineageRow): void {
  if (
    row.candidateGeneration === null ||
    row.candidateGeneration !== row.lineageCandidateGeneration ||
    row.candidateIdentity !== row.lineageCandidateIdentity
  ) fail('QUALITY_LINEAGE_CANDIDATE_STALE')
  if (
    row.episodeGeneration === null ||
    row.episodeGeneration !== row.lineageEpisodeGeneration ||
    row.episodeIdentity !== row.signalEpisodeIdentity
  ) fail('QUALITY_LINEAGE_EPISODE_STALE')
  if (
    row.matchId === null ||
    row.matchGeneration !== row.candidateMatchGeneration
  ) fail('QUALITY_LINEAGE_MATCH_STALE')
  if (
    row.propensityId === null ||
    row.propensityGeneration !== row.candidatePropensityGeneration
  ) fail('QUALITY_LINEAGE_PROPENSITY_STALE')
  if (
    row.thesisId === null ||
    row.thesisGeneration !== row.candidateThesisGeneration
  ) fail('QUALITY_LINEAGE_THESIS_STALE')
  if (row.stateSnapshotId === null) fail('QUALITY_LINEAGE_STATE_MISSING')
  if (row.stateSnapshotAt === null) fail('QUALITY_LINEAGE_STATE_MISSING')
  const decisionAt = timestamp(row.lineageCreatedAt, 'lineage decision at')
  const snapshotAt = timestamp(row.stateSnapshotAt, 'state snapshot at')
  if (
    snapshotAt > decisionAt ||
    row.stateHasFutureEvent ||
    row.stateHasFutureEvidence ||
    row.stateHasFutureChange
  ) fail('QUALITY_LINEAGE_STATE_FUTURE')
  timestamp(row.candidateValidUntil as string, 'candidate valid until')
  timestamp(row.episodeValidUntil as string, 'episode valid until')
}

function buildStateLineage(
  row: LineageRow,
  rawChanges: StateChangeRow[],
): CommercialSignalCompanyStateLineage {
  if (
    row.stateSnapshotId === null ||
    row.stateSnapshotAt === null ||
    row.stateFeatureVersion === null ||
    row.stateClassification === null ||
    row.stateConfidence === null
  ) fail('QUALITY_LINEAGE_STATE_MISSING')
  if (![
    'insufficient_history', 'accelerating', 'steady', 'slowing',
  ].includes(row.stateClassification)) fail('QUALITY_LINEAGE_STATE_INVALID')
  const snapshotAt = timestamp(row.stateSnapshotAt, 'state snapshot at')
  const featureVersion = requiredText(row.stateFeatureVersion, 'state feature version')
  const eventIds = ids(row.stateEventIds)
  const evidenceIds = ids(row.stateEvidenceIds)
  const snapshot = stateSnapshot(row)
  if (eventIds.length === 0 || evidenceIds.length === 0) {
    fail('QUALITY_LINEAGE_STATE_INVALID')
  }
  const changes = rawChanges.map((raw) => {
    const direction = raw.direction
    if (!['up', 'down', 'new', 'changed'].includes(direction)) {
      fail('QUALITY_LINEAGE_STATE_INVALID')
    }
    const change: CommercialSignalCompanyStateChangeLineage = {
      changeId: positiveId(raw.changeId, 'state change id'),
      changeType: requiredText(raw.changeType, 'state change type'),
      direction,
      magnitude: nonNegative(raw.magnitude, 'state change magnitude'),
      baselineDeviation: nullableFinite(
        raw.baselineDeviation,
        'state change baseline deviation',
      ),
      confidence: unitInterval(raw.confidence, 'state change confidence'),
      eventIds: ids(raw.eventIds),
      evidenceIds: ids(raw.evidenceIds),
      observedAt: timestamp(raw.observedAt, 'state change observed at'),
      featureVersion: requiredText(raw.featureVersion, 'state change feature version'),
    }
    if (
      change.observedAt !== snapshotAt ||
      change.featureVersion !== featureVersion ||
      change.eventIds.length === 0 ||
      change.evidenceIds.length === 0 ||
      change.eventIds.some((id) => !eventIds.includes(id)) ||
      change.evidenceIds.some((id) => !evidenceIds.includes(id))
    ) fail('QUALITY_LINEAGE_STATE_INVALID')
    return change
  }).sort((left, right) =>
    left.changeId.length - right.changeId.length ||
    left.changeId.localeCompare(right.changeId, 'en'))
  return {
    snapshotId: positiveId(row.stateSnapshotId, 'state snapshot id'),
    snapshotAt,
    featureVersion,
    stateClassification: row.stateClassification as
      CommercialSignalCompanyStateLineage['stateClassification'],
    stateConfidence: unitInterval(row.stateConfidence, 'state confidence'),
    eventIds,
    evidenceIds,
    snapshot,
    changes,
  }
}

function stateSnapshot(row: LineageRow): CommercialSignalCompanyStateSnapshot {
  const baseline = object(row.stateHiringBaseline)
  const velocity = object(row.stateCurrentHiringVelocity)
  const roles = object(row.stateRoleDistribution)
  const seniorities = object(row.stateSeniorityDistribution)
  const regions = object(row.stateRegionDistribution)
  const lifetime = object(row.stateVacancyLifetime)
  const repost = object(row.stateRepostRate)
  const capacity = object(row.stateRecruitingCapacitySignals)
  const business = object(row.stateBusinessChangeSignals)
  const direction = velocity.direction
  if (!['up', 'steady', 'down', 'unknown'].includes(String(direction))) {
    fail('QUALITY_LINEAGE_STATE_INVALID')
  }
  if (typeof baseline.sufficientHistory !== 'boolean' ||
      typeof repost.supported !== 'boolean') {
    fail('QUALITY_LINEAGE_STATE_INVALID')
  }
  const fallbackReason = baseline.fallbackReason
  if (fallbackReason !== null && fallbackReason !== 'insufficient_history') {
    fail('QUALITY_LINEAGE_STATE_INVALID')
  }
  return {
    hiringBaseline: {
      vacancies7d: count(baseline.vacancies7d, 'baseline vacancies 7d'),
      vacancies14d: count(baseline.vacancies14d, 'baseline vacancies 14d'),
      vacancies30d: count(baseline.vacancies30d, 'baseline vacancies 30d'),
      medianHiringVelocityPer7d: nonNegative(
        baseline.medianHiringVelocityPer7d,
        'median hiring velocity',
      ),
      historyEventCount: count(baseline.historyEventCount, 'history event count'),
      historyCoverageDays: nonNegative(
        baseline.historyCoverageDays,
        'history coverage days',
      ),
      historicalPeriodCount: count(
        baseline.historicalPeriodCount,
        'historical period count',
      ),
      sufficientHistory: baseline.sufficientHistory,
      fallbackReason,
    },
    currentHiringVelocity: {
      vacancies7d: count(velocity.vacancies7d, 'current vacancies 7d'),
      vacancies14d: count(velocity.vacancies14d, 'current vacancies 14d'),
      vacancies30d: count(velocity.vacancies30d, 'current vacancies 30d'),
      baselineDeviation14d: nullableFinite(
        velocity.baselineDeviation14d,
        'baseline deviation 14d',
      ),
      direction: direction as
        CommercialSignalCompanyStateSnapshot['currentHiringVelocity']['direction'],
    },
    roleDistribution: {
      current: nonNegativeRecord(roles.current, 'current role distribution'),
      baseline: nonNegativeRecord(roles.baseline, 'baseline role distribution'),
    },
    seniorityDistribution: {
      current: nonNegativeRecord(
        seniorities.current,
        'current seniority distribution',
      ),
      baseline: nonNegativeRecord(
        seniorities.baseline,
        'baseline seniority distribution',
      ),
    },
    regionDistribution: {
      current: nonNegativeRecord(regions.current, 'current region distribution'),
      baseline: nonNegativeRecord(regions.baseline, 'baseline region distribution'),
      newRegions: textArray(regions.newRegions),
    },
    vacancyLifetime: {
      observedCount: count(lifetime.observedCount, 'vacancy lifetime count'),
      medianDays: nullableNonNegative(lifetime.medianDays, 'vacancy lifetime median'),
    },
    repostRate: {
      supported: repost.supported,
      observedCount: count(repost.observedCount, 'repost observed count'),
      repostCount: count(repost.repostCount, 'repost count'),
      rate: nullableUnit(repost.rate, 'repost rate'),
    },
    recruitingCapacitySignals: {
      currentRecruiterVacancies: count(
        capacity.currentRecruiterVacancies,
        'current recruiter vacancies',
      ),
      baselineRecruiterVacancies: count(
        capacity.baselineRecruiterVacancies,
        'baseline recruiter vacancies',
      ),
    },
    businessChangeSignals: {
      current30d: nonNegativeRecord(
        business.current30d,
        'business change signals',
      ),
    },
  }
}

function assembleInput(
  row: LineageRow,
  events: EventRow[],
  evidenceById: ReadonlyMap<string, CommercialSignalEvidenceProvenance>,
  evidenceRows: EvidenceRow[],
  stateChanges: StateChangeRow[],
  decisionAt: Date,
): {
  input: CommercialSignalQualityEngineV2Input
  archetypes: string[]
  organizationIndustry: string | null
} {
  const directIds = (event: EventRow): string[] => event.evidenceIds.filter((id) => {
    const source = evidenceById.get(id)?.sourceKind
    return source === 'direct' || source === 'official'
  })
  const eventIds = (types: readonly string[]): string[] => ids(events
    .filter((event) => types.includes(event.eventType))
    .flatMap(directIds))
  const hiringEvidenceIds = eventIds([
    'job_posting', 'vacancy_repost', 'vacancy_salary_change',
    'vacancy_cluster', 'recruiter_vacancy', 'hiring_restart',
  ])
  const matchEvidenceIds = ids(evidenceRows
    .filter((item) => item.matchEvidence)
    .map((item) => item.evidenceId))
  const propensityEvidenceIds = ids(evidenceRows
    .filter((item) => item.propensityEvidence)
    .map((item) => item.evidenceId))
  const qualityComponents = object(row.qualityComponents)
  const actionabilityComponents = object(row.actionabilityComponents)
  const candidateFeatures = object(row.candidateFeatures)
  const qualityFeatures = object(candidateFeatures.quality)
  const actionabilityFeatures = object(candidateFeatures.actionability)
  const stateLineage = buildStateLineage(row, stateChanges)
  const hiringNeed = componentFromPersisted(
    qualityComponents.timing,
    hiringEvidenceIds,
    'HIRING_NEED_UNKNOWN',
  )
  const agencyFit = componentFromPersisted(
    qualityComponents.agencyFit,
    matchEvidenceIds,
    'AGENCY_FIT_UNKNOWN',
    row.matchFitScore,
    row.matchCoverage,
  )
  const frictionInput = buildFrictionInput(
    events,
    directIds,
    decisionAt,
    stateLineage,
    evidenceById,
  )
  const friction = buildHiringFriction(frictionInput)
  const negatives = buildNegativeEvidence(
    stateLineage.changes,
    evidenceById,
    decisionAt,
  )
  const negativeEvidence = evaluateNegativeEvidence(negatives, decisionAt)
  const independence = buildEvidenceIndependence(
    [...evidenceById.values()],
    decisionAt,
  )
  const groupByEvidence = new Map(independence.groups.flatMap((group) =>
    group.reasonCodes.includes('EVIDENCE_ORIGIN_UNKNOWN')
      ? []
      : group.evidenceIds.map((evidenceId) => [
          evidenceId,
          group.evidenceIndependenceGroup,
        ] as const)))
  const convergence = buildSignalConvergence({
    events: buildConvergenceEvents(events, directIds, groupByEvidence),
    negativeEvidence,
    now: decisionAt,
  })
  const archetypes = buildHiringProblemArchetypes(buildArchetypeInput(
    events,
    directIds,
    friction,
    stateLineage,
  ))
  const accountRestriction = row.accountRestriction
  const previousRelationship = accountRestriction === 'existing_client' ||
    accountRestriction === 'former_client'
    ? propensityComponent(0.9, matchEvidenceIds, row.matchCoverage)
    : propensityComponent(null, [])
  const propensity = buildExternalAgencyPropensity({
    hiringNeed: toPropensity(hiringNeed),
    hiringFriction: {
      value: friction.frictionLevel === 'unknown' ? null : friction.frictionScore,
      confidence: friction.frictionLevel === 'unknown' ? 0 : friction.coverage,
      coverage: friction.frictionLevel === 'unknown' ? 0 : friction.coverage,
      evidenceIds: friction.frictionLevel === 'unknown' ? [] : friction.evidenceIds,
    },
    externalSupportPlausibility: propensityComponent(
      row.propensityLevel === 'insufficient_evidence' ? null : row.propensityScore,
      propensityEvidenceIds,
      evidenceCoverage(propensityEvidenceIds),
    ),
    timing: toPropensity(componentFromPersisted(
      qualityComponents.timing,
      hiringEvidenceIds,
      'TIMING_UNKNOWN',
    )),
    agencyDna: toPropensity(agencyFit),
    previousAgencyRelationship: previousRelationship,
    internalRecruitingCapacity: propensityComponent(
      friction.componentValues.internal_recruiting_capacity,
      friction.observationStates.internal_recruiting_capacity === 'observed'
        ? friction.evidenceIds : [],
    ),
    timeToFillPressure: propensityComponent(
      friction.componentValues.vacancy_lifetime,
      friction.observationStates.vacancy_lifetime === 'observed'
        ? friction.evidenceIds : [],
    ),
    procurementBarrier: propensityComponent(null, []),
    doNotContact: {
      value: accountRestriction === 'do_not_contact' ? true : null,
      evidenceIds: accountRestriction === 'do_not_contact'
        ? matchEvidenceIds : [],
    },
    conflict: {
      value: accountRestriction === 'conflict' ? true : null,
      evidenceIds: accountRestriction === 'conflict'
        ? matchEvidenceIds : [],
    },
    archetypes: archetypes.map((item) => ({
      archetype: item.archetype,
      confidence: item.confidence,
      evidenceIds: item.evidenceIds,
      eventIds: item.supportingEventIds,
    })),
    evidenceOriginGroups: Object.fromEntries([...groupByEvidence.entries()]),
    convergenceIndependentGroupCount: convergence.independentGroupCount,
  })
  const persistedEconomicsOutcome = economicsOutcome(qualityFeatures.economicsOutcome)
  const economicsComponent = persistedEconomicsOutcome === 'unknown'
    ? null
    : componentFromPersisted(
      qualityComponents.economics,
      matchEvidenceIds,
      'ECONOMICS_UNKNOWN',
    )
  const economics = economicsComponent === null || economicsComponent.value === null
    ? buildEconomicsFit(unknownEconomicsInput())
    : {
        featureVersion: 'commercial-fit-v2' as const,
        economicsFit: persistedEconomicsOutcome,
        componentValue: economicsComponent.value,
        componentConfidence: economicsComponent.confidence,
        coverage: economicsComponent.coverage,
        reasons: economicsComponent.reasonCodes,
        evidenceIds: economicsComponent.evidenceIds,
      }
  const contactIds = persistedEvidenceIds([
    actionabilityComponents.corporateContactPath,
    actionabilityComponents.contactPolicy,
  ], evidenceById)
  const contactPathAvailable = Array.isArray(
    actionabilityFeatures.corporateContactPathCategories,
  ) && actionabilityFeatures.corporateContactPathCategories.length > 0

  return {
    archetypes: archetypes.map((item) => item.archetype),
    organizationIndustry: optionalText(row.organizationIndustry),
    input: {
    decisionAt: decisionAt.toISOString(),
    decisionSource: 'deterministic',
    componentSources: {
      hiringNeed: 'derived_deterministic',
      hiringFriction: 'derived_deterministic',
      agencyFit: 'derived_deterministic',
      propensity: 'derived_deterministic',
      convergence: 'derived_deterministic',
      economics: 'derived_deterministic',
      marketDifficulty: 'derived_deterministic',
    },
    currentHiringEvidence: {
      present: hiringEvidenceIds.length > 0,
      evidenceIds: hiringEvidenceIds,
    },
    stateLineage,
    hiringNeed,
    hiringFriction: friction,
    agencyFit,
    propensity,
    convergence,
    economics,
    marketDifficulty: buildMarketDifficulty({
      decisionDate: decisionAt.toISOString().slice(0, 10),
      roleFamily: dominantKnownKey(stateLineage.snapshot.roleDistribution.current),
      seniority: dominantKnownKey(
        stateLineage.snapshot.seniorityDistribution.current,
      ),
      region: dominantKnownKey(stateLineage.snapshot.regionDistribution.current),
      observation: null,
    }),
    negativeEvidence,
    contact: {
      corporateContactPathAvailable: contactPathAvailable,
      doNotContact: accountRestriction === 'do_not_contact',
      conflict: accountRestriction === 'conflict',
      evidenceIds: contactIds,
    },
      evidence: [],
    },
  }
}

function buildFrictionInput(
  events: EventRow[],
  directIds: (event: EventRow) => string[],
  decisionAt: Date,
  stateLineage: CommercialSignalCompanyStateLineage,
  evidenceById: ReadonlyMap<string, CommercialSignalEvidenceProvenance>,
) {
  const jobs = events.filter((event) => event.eventType === 'job_posting')
  const reposts = events.filter((event) => event.eventType === 'vacancy_repost')
  const salaries = events.filter((event) => event.eventType === 'vacancy_salary_change')
  const restarts = events.filter((event) => event.eventType === 'hiring_restart')
  const capableIds = (
    rawIds: string[],
    feature: SourceFeature,
  ): string[] => ids(rawIds.filter((id) => {
    const source = evidenceById.get(id)?.sourceFamily
    return source !== undefined &&
      getSourceFeatureCapability(source, feature).status !== 'unsupported'
  }))
  const eventFeatureIds = (event: EventRow, feature: SourceFeature): string[] =>
    capableIds(directIds(event), feature)
  const allJobIds = ids(jobs.flatMap((event) =>
    eventFeatureIds(event, 'vacancy')))
  const repostIds = ids(reposts.flatMap((event) =>
    eventFeatureIds(event, 'stable_publication_identity')))
  const salaryIds = ids(salaries.flatMap((event) =>
    eventFeatureIds(event, 'salary_snapshot')))
  const restartIds = ids(restarts.flatMap((event) =>
    eventFeatureIds(event, 'vacancy')))
  const observedReposts = reposts.flatMap((event) => {
    const payloadVersion = textPayload(event.payload, ['payloadVersion'])
    const intervalDays = numberPayload(event.payload, ['intervalDays', 'interval_days'])
    const lifecycleClassification = repostLifecycle(event.payload)
    const salaryChanged = booleanPayload(event.payload, [
      'salaryChanged', 'salary_changed',
    ])
    const requirementsChanged = booleanPayload(event.payload, [
      'requirementsChanged', 'requirements_changed',
    ])
    const sourcePublicationChanged = booleanPayload(event.payload, [
      'sourcePublicationChanged', 'source_publication_changed',
    ])
    const evidenceIds = eventFeatureIds(event, 'stable_publication_identity')
    return payloadVersion !== 'vacancy-repost-v2' || intervalDays === null ||
      lifecycleClassification === null ||
      evidenceIds.length === 0
      ? []
      : [{
          intervalDays,
          automated: null,
          lifecycleClassification,
          salaryChanged,
          requirementsChanged,
          sourcePublicationChanged,
          evidenceIds,
        }]
  })
  const earliestJob = jobs.map((item) => Date.parse(item.occurredAt))
    .filter(Number.isFinite).sort((left, right) => left - right)[0]
  const requirements = events.filter((event) =>
    booleanPayload(event.payload, ['requirementsChanged', 'requirements_changed']) === true)
  const requirementIds = ids(requirements.flatMap((event) =>
    eventFeatureIds(event, 'requirements_snapshot')))
  const vacancyDirectIds = (event: EventRow): string[] =>
    eventFeatureIds(event, 'vacancy')
  const evergreen = explicitBooleanObservation(events, vacancyDirectIds, [
    'evergreen', 'evergreenRole', 'evergreen_role',
  ])
  const massHiring = explicitBooleanObservation(events, vacancyDirectIds, [
    'massHiring', 'mass_hiring',
  ])
  const snapshot = stateLineage.snapshot
  const stateEvidenceIds = stateLineage.evidenceIds
  const lifetimeEvidenceIds = capableIds(
    stateEvidenceIds,
    'stable_publication_identity',
  )
  const roleEvidenceIds = capableIds(stateEvidenceIds, 'normalized_role')
  const seniorityEvidenceIds = capableIds(stateEvidenceIds, 'seniority')
  const vacancyEvidenceIds = capableIds(stateEvidenceIds, 'vacancy')
  const vacancyLifetime = snapshot.vacancyLifetime.observedCount > 0 &&
      snapshot.vacancyLifetime.medianDays !== null && lifetimeEvidenceIds.length > 0
    ? observedMetric(
        clamp01((snapshot.vacancyLifetime.medianDays - 30) / 90),
        lifetimeEvidenceIds,
      )
    : unknownMetric()
  const repostRate = snapshot.repostRate.supported &&
      snapshot.repostRate.rate !== null && lifetimeEvidenceIds.length > 0
    ? observedMetric(snapshot.repostRate.rate, lifetimeEvidenceIds)
    : unknownMetric()
  const seniorityComplexity = distributionSeniorityComplexity(
    snapshot.seniorityDistribution.current,
    seniorityEvidenceIds,
  )
  const multiRoleComplexity = distributionComplexity(
    snapshot.roleDistribution.current,
    roleEvidenceIds,
  )
  const deviation = snapshot.currentHiringVelocity.baselineDeviation14d
  const recruiterVacancies =
    snapshot.recruitingCapacitySignals.currentRecruiterVacancies
  const recruiterPressure = snapshot.hiringBaseline.sufficientHistory &&
      deviation !== null && recruiterVacancies > 0 && vacancyEvidenceIds.length > 0
    ? observedMetric(clamp01(Math.max(0, deviation)), vacancyEvidenceIds)
    : unknownMetric()
  return {
    vacancyAgeDays: earliestJob === undefined || allJobIds.length === 0
      ? unknownMetric()
      : observedMetric(Math.max(0, (decisionAt.getTime() - earliestJob) / 86_400_000), allJobIds),
    repostCycles: repostIds.length === 0 || observedReposts.length !== reposts.length
      ? unknownReposts()
      : {
          state: 'observed' as const,
          value: observedReposts,
          evidenceIds: repostIds,
        },
    repostRate,
    salaryChange: salaryIds.length === 0 ? unknownMetric() : observedMetric(1, salaryIds),
    requirementsChange: requirementIds.length === 0
      ? unknownMetric() : observedMetric(1, requirementIds),
    closeReopenCycles: restartIds.length === 0
      ? unknownMetric() : observedMetric(1, restartIds),
    roleScarcity: unknownMetric(),
    seniorityComplexity,
    multiRoleComplexity,
    regionalDifficulty: unknownMetric(),
    internalRecruitingCapacity: unknownMetric(),
    hiringVelocityVsCapacity: recruiterPressure,
    observedVacancyLifetime: vacancyLifetime,
    evergreenRole: evergreen,
    massHiring,
  }
}

function repostLifecycle(
  payload: unknown,
): 'meaningful' | 'routine_republication' | 'unknown' | null {
  const value = textPayload(payload, ['lifecycleClassification'])
  return value === 'meaningful' || value === 'routine_republication' || value === 'unknown'
    ? value
    : null
}

function buildNegativeEvidence(
  stateChanges: CommercialSignalCompanyStateChangeLineage[],
  evidenceById: ReadonlyMap<string, CommercialSignalEvidenceProvenance>,
  decisionAt: Date,
): NegativeEvidenceInput[] {
  return stateChanges.filter((change) =>
    change.changeType === 'hiring_slowdown' && change.direction === 'down')
    .map((change) => ({
      type: 'hiring_slowdown' as const,
      classification: 'confirmed_negative' as const,
      sourceKind: change.evidenceIds.some((id) =>
        evidenceById.get(id)?.sourceKind === 'direct')
        ? 'direct' as const
        : 'official' as const,
      severity: change.confidence,
      eventIds: change.eventIds,
      evidenceIds: change.evidenceIds,
      observedAt: change.observedAt,
      validUntil: new Date(Math.max(
        decisionAt.getTime(),
        Date.parse(change.observedAt) + (45 * 86_400_000),
      )).toISOString(),
    })).filter((item) => item.evidenceIds.length > 0)
}

function buildConvergenceEvents(
  events: EventRow[],
  directIds: (event: EventRow) => string[],
  groupByEvidence: ReadonlyMap<string, string>,
): SignalConvergenceEvent[] {
  const typeMap: Partial<Record<string, SignalConvergenceEventType>> = {
    leadership_change: 'leadership_change',
    new_business_unit: 'new_unit',
    new_region: 'new_region',
    hiring_restart: 'hiring_acceleration',
    vacancy_cluster: 'role_cluster',
    vacancy_repost: 'vacancy_repost',
    vacancy_salary_change: 'salary_change',
    recruiter_vacancy: 'recruiter_vacancy',
  }
  return events.flatMap((event) => {
    const type = typeMap[event.eventType]
    const evidenceIds = directIds(event)
    if (!type || evidenceIds.length === 0) return []
    const groups = ids(evidenceIds.flatMap((id) => groupByEvidence.get(id) ?? []), false)
    return [{
      eventId: event.eventId,
      type,
      strength: event.confidence ?? 0.7,
      occurredAt: event.occurredAt,
      evidenceIds,
      evidenceIndependenceGroup: groups.length === 1 ? groups[0]! : null,
    }]
  })
}

function buildArchetypeInput(
  events: EventRow[],
  directIds: (event: EventRow) => string[],
  friction: ReturnType<typeof buildHiringFriction>,
  stateLineage: CommercialSignalCompanyStateLineage,
) {
  const signal = <T>(value: T, matching: EventRow[]) => ({
    value,
    eventIds: matching.map((item) => item.eventId),
    evidenceIds: ids(matching.flatMap(directIds)),
  })
  const byType = (type: string) => events.filter((event) => event.eventType === type)
  const stateSignal = <T>(
    value: T,
    changes: CommercialSignalCompanyStateChangeLineage[],
  ) => ({
    value,
    eventIds: ids(changes.flatMap((item) => item.eventIds)),
    evidenceIds: ids(changes.flatMap((item) => item.evidenceIds)),
  })
  const newUnit = byType('new_business_unit')
  const leadership = byType('leadership_change')
  const recruiters = byType('recruiter_vacancy')
  const restarts = byType('hiring_restart')
  const accelerations = stateLineage.changes.filter((item) =>
    item.changeType === 'hiring_acceleration' && item.direction === 'up')
  const slowdowns = stateLineage.changes.filter((item) =>
    item.changeType === 'hiring_slowdown' && item.direction === 'down')
  const reposts = byType('vacancy_repost')
  const meaningfulReposts = reposts.filter((event) =>
    repostLifecycle(event.payload) === 'meaningful')
  const newRegions = stateLineage.changes.filter((item) =>
    item.changeType === 'new_region' && item.direction === 'new')
  const snapshot = stateLineage.snapshot
  const deviation = snapshot.currentHiringVelocity.baselineDeviation14d
  const stateObserved = <T>(value: T) => ({
    value,
    eventIds: stateLineage.eventIds,
    evidenceIds: stateLineage.evidenceIds,
  })
  const growthVsBaseline = snapshot.hiringBaseline.sufficientHistory &&
      deviation !== null
    ? stateObserved<number | null>(clamp01(0.5 + (deviation / 2)))
    : stateObserved<number | null>(null)
  const roleEntries = knownDistribution(snapshot.roleDistribution.current)
  const roleCount = roleEntries.reduce((sum, [, count]) => sum + count, 0)
  const repeatedRoleShare = roleCount >= 3
    ? stateObserved<number | null>(
        Math.max(...roleEntries.map(([, count]) => count)) / roleCount,
      )
    : stateObserved<number | null>(null)
  const roleComplexity = distributionComplexity(
    snapshot.roleDistribution.current,
    stateLineage.evidenceIds,
  )
  const evergreen = events.filter((event) => booleanPayload(event.payload, [
    'evergreen', 'evergreenRole', 'evergreen_role',
  ]) !== null)
  const massHiring = events.filter((event) => booleanPayload(event.payload, [
    'massHiring', 'mass_hiring',
  ]) !== null)
  return {
    friction: {
      level: friction.frictionLevel,
      score: friction.frictionScore,
      evidenceIds: friction.evidenceIds,
    },
    hiringAcceleration: accelerations.length > 0
      ? stateSignal<number | null>(stateLineage.stateConfidence, accelerations)
      : signal(restarts.length > 0 ? 0.8 : null, restarts),
    growthVsBaseline,
    repeatedRoleShare,
    meaningfulRepostCycles: signal(
      meaningfulReposts.length || null,
      meaningfulReposts,
    ),
    roleComplexity: stateObserved<number | null>(roleComplexity.value),
    salaryOrRequirementsChanged: signal<boolean | null>(
      events.some((event) =>
        event.eventType === 'vacancy_salary_change' ||
        booleanPayload(event.payload, ['salaryChanged', 'requirementsChanged']) === true
      ) || null,
      events.filter((event) =>
        event.eventType === 'vacancy_salary_change' ||
        booleanPayload(event.payload, ['salaryChanged', 'requirementsChanged']) === true
      ),
    ),
    newUnit: signal<boolean | null>(newUnit.length > 0 || null, newUnit),
    newRegion: stateSignal<boolean | null>(newRegions.length > 0 || null, newRegions),
    leadershipChange: signal<boolean | null>(leadership.length > 0 || null, leadership),
    recruiterVacancy: signal<boolean | null>(recruiters.length > 0 || null, recruiters),
    massHiring: signal<boolean | null>(massHiring.length === 0
      ? null
      : massHiring.some((event) => booleanPayload(event.payload, [
        'massHiring', 'mass_hiring',
      ]) === true), massHiring),
    evergreen: signal<boolean | null>(evergreen.length === 0
      ? null
      : evergreen.some((event) => booleanPayload(event.payload, [
        'evergreen', 'evergreenRole', 'evergreen_role',
      ]) === true), evergreen),
    reactivation: signal<boolean | null>(restarts.length > 0 || null, restarts),
    freezeOrSlowdown: stateSignal<boolean | null>(
      slowdowns.length > 0 || null,
      slowdowns,
    ),
  }
}

function componentFromPersisted(
  raw: unknown,
  fallbackEvidenceIds: string[],
  unknownReason: string,
  fallbackValue: number | null = null,
  fallbackCoverage: number | null = null,
): OpportunityQualityComponent {
  const persisted = object(raw)
  const evidenceIds = persistedEvidenceIds([persisted], null)
  const usableIds = evidenceIds.length > 0 ? evidenceIds : fallbackEvidenceIds
  const score = finiteUnit(persisted.score) ?? finiteUnit(fallbackValue)
  const coverage = finiteUnit(persisted.coverage) ?? finiteUnit(fallbackCoverage) ??
    (usableIds.length > 0 ? 1 : 0)
  if (score === null || usableIds.length === 0) {
    return {
      value: null,
      confidence: 0,
      coverage: 0,
      reasonCodes: [unknownReason],
      evidenceIds: [],
    }
  }
  const reasons = Array.isArray(persisted.reasons)
    ? persisted.reasons.map(object).map((reason) => String(reason.code ?? ''))
      .filter(Boolean)
    : []
  return {
    value: score,
    confidence: coverage,
    coverage,
    reasonCodes: reasons.length > 0 ? reasons : [`${unknownReason}_FALLBACK`],
    evidenceIds: usableIds,
  }
}

function persistedEvidenceIds(
  values: unknown[],
  allowed: ReadonlyMap<string, CommercialSignalEvidenceProvenance> | null,
): string[] {
  const extracted = values.flatMap((value) => {
    const item = object(value)
    const reasons = Array.isArray(item.reasons) ? item.reasons.map(object) : []
    return reasons.flatMap((reason) => Array.isArray(reason.evidenceIds)
      ? reason.evidenceIds.map(String) : [])
  })
  return ids(extracted.filter((id) => allowed === null || allowed.has(id)))
}

function toPropensity(component: OpportunityQualityComponent) {
  return {
    value: component.value,
    confidence: component.confidence,
    coverage: component.coverage,
    evidenceIds: component.evidenceIds,
  }
}

function propensityComponent(
  value: number | null,
  evidenceIds: string[],
  rawCoverage: number | null = null,
) {
  const normalized = finiteUnit(value)
  const coverage = finiteUnit(rawCoverage) ?? evidenceCoverage(evidenceIds)
  return {
    value: normalized,
    confidence: normalized === null ? 0 : coverage,
    coverage: normalized === null ? 0 : coverage,
    evidenceIds: normalized === null ? [] : evidenceIds,
  }
}

function evidenceCoverage(evidenceIds: string[]): number {
  return Math.min(1, evidenceIds.length / 2)
}

function unknownEconomicsInput() {
  const unknown = { value: null, evidenceIds: [] }
  return {
    expectedRoleCount: unknown,
    roleSeniority: unknown,
    serviceType: unknown,
    companySize: unknown,
    agencyMinimumFeeMinor: null,
    agencyTypicalFeeMinor: null,
    engagementType: unknown,
    estimatedScopeMinor: unknown,
    caseSimilarity: null,
  }
}

function economicsOutcome(value: unknown): 'match' | 'partial' | 'mismatch' | 'unknown' {
  return value === 'match' || value === 'mismatch'
    ? value
    : value === 'partial' ? 'partial' : 'unknown'
}

function observedMetric(value: number, evidenceIds: string[]): EvidencedMetric {
  return { state: 'observed', value, evidenceIds }
}

function unknownMetric(): EvidencedMetric {
  return { state: 'unknown', value: null, evidenceIds: [] }
}

function distributionComplexity(
  distribution: Record<string, number>,
  evidenceIds: string[],
): EvidencedMetric {
  const known = knownDistribution(distribution)
  const sampleSize = known.reduce((total, [, count]) => total + count, 0)
  if (sampleSize < 3 || evidenceIds.length === 0) return unknownMetric()
  return observedMetric(clamp01((known.length - 1) / 3), evidenceIds)
}

function distributionSeniorityComplexity(
  distribution: Record<string, number>,
  evidenceIds: string[],
): EvidencedMetric {
  const entries = Object.entries(distribution)
  const total = entries.reduce((sum, [, count]) => sum + count, 0)
  const known = knownDistribution(distribution)
  const knownCount = known.reduce((sum, [, count]) => sum + count, 0)
  if (
    knownCount < 3 || total === 0 || knownCount / total < 0.6 ||
    evidenceIds.length === 0
  ) {
    return unknownMetric()
  }
  const seniorKeys = new Set(['lead', 'head', 'principal', 'senior', 'executive'])
  const seniorCount = known.reduce((sum, [key, count]) =>
    sum + (seniorKeys.has(key.toLowerCase()) ? count : 0), 0)
  return observedMetric(clamp01(seniorCount / knownCount), evidenceIds)
}

function knownDistribution(
  distribution: Record<string, number>,
): Array<[string, number]> {
  return Object.entries(distribution)
    .filter(([key, count]) => key.trim().toLowerCase() !== 'unknown' && count > 0)
    .sort(([left], [right]) => left.localeCompare(right))
}

function dominantKnownKey(distribution: Record<string, number>): string {
  return knownDistribution(distribution)
    .sort(([leftKey, leftCount], [rightKey, rightCount]) =>
      rightCount - leftCount || leftKey.localeCompare(rightKey))[0]?.[0] ?? 'unknown'
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function unknownReposts(): EvidencedRepostCycles {
  return { state: 'unknown', value: null, evidenceIds: [] }
}

function explicitBooleanObservation(
  events: EventRow[],
  directIds: (event: EventRow) => string[],
  keys: string[],
): EvidencedFlag {
  const observed = events.filter((event) => booleanPayload(event.payload, keys) !== null)
  const evidenceIds = ids(observed.flatMap(directIds))
  if (evidenceIds.length === 0) {
    return { state: 'unknown', value: null, evidenceIds: [] }
  }
  return {
    state: 'observed',
    value: observed.some((event) => booleanPayload(event.payload, keys) === true),
    evidenceIds,
  }
}

function toProvenance(row: EvidenceRow): CommercialSignalEvidenceProvenance {
  const payload = object(row.payloadRef)
  return {
    evidenceId: positiveId(row.evidenceId, 'evidence id'),
    sourceKind: row.tier === 'direct'
      ? 'direct'
      : row.tier === 'corroboration'
        ? 'derived_deterministic'
        : 'approved_context',
    sourceFamily: requiredText(row.source, 'evidence source'),
    sourceDomain: sourceDomain(row.url, row.source),
    upstreamOrigin: optionalText(payload.upstreamOrigin ?? payload.upstream_origin),
    canonicalUrl: requiredText(row.url, 'evidence url'),
    vacancyFingerprint: optionalText(
      payload.vacancyFingerprint ?? payload.vacancy_fingerprint,
    ),
    publicationFingerprint: optionalText(
      payload.publicationFingerprint ?? payload.publication_fingerprint,
    ),
    organizationDomain: optionalText(
      payload.organizationDomain ?? payload.organization_domain,
    ),
    contentFingerprint: optionalText(
      payload.contentFingerprint ?? payload.content_fingerprint ?? row.contentHash,
    ),
    observedAt: timestamp(row.fetchedAt, 'evidence observed at'),
  }
}

function booleanPayload(value: unknown, keys: string[]): boolean | null {
  const payload = object(value)
  for (const key of keys) {
    if (typeof payload[key] === 'boolean') return payload[key] as boolean
  }
  return null
}

function textPayload(value: unknown, keys: string[]): string | null {
  const payload = object(value)
  for (const key of keys) {
    const parsed = optionalText(payload[key])
    if (parsed !== null) return parsed
  }
  return null
}

function numberPayload(value: unknown, keys: string[]): number | null {
  const payload = object(value)
  for (const key of keys) {
    const parsed = Number(payload[key])
    if (Number.isFinite(parsed) && parsed >= 0) return parsed
  }
  return null
}

function dedupeEvidenceRows(rows: EvidenceRow[]): EvidenceRow[] {
  const byId = new Map<string, EvidenceRow>()
  for (const row of rows) {
    const existing = byId.get(row.evidenceId)
    byId.set(row.evidenceId, existing
      ? {
          ...existing,
          matchEvidence: existing.matchEvidence || row.matchEvidence,
          propensityEvidence: existing.propensityEvidence || row.propensityEvidence,
          thesisEvidence: existing.thesisEvidence || row.thesisEvidence,
          episodeEvidence: existing.episodeEvidence || row.episodeEvidence,
        }
      : row)
  }
  return [...byId.values()].sort((left, right) =>
    left.evidenceId.length - right.evidenceId.length ||
    left.evidenceId.localeCompare(right.evidenceId, 'en'))
}

function nonNegative(value: unknown, label: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be non-negative`)
  }
  return parsed
}

function nullableFinite(value: unknown, label: string): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be finite`)
  return parsed
}

function count(value: unknown, label: string): number {
  const parsed = nonNegative(value, label)
  if (!Number.isSafeInteger(parsed)) throw new Error(label + ' must be an integer')
  return parsed
}

function nullableNonNegative(value: unknown, label: string): number | null {
  const parsed = nullableFinite(value, label)
  if (parsed !== null && parsed < 0) throw new Error(label + ' must be non-negative')
  return parsed
}

function nullableUnit(value: unknown, label: string): number | null {
  const parsed = nullableFinite(value, label)
  if (parsed !== null && (parsed < 0 || parsed > 1)) {
    throw new Error(label + ' must be between 0 and 1')
  }
  return parsed
}

function nonNegativeRecord(value: unknown, label: string): Record<string, number> {
  const raw = object(value)
  const entries = Object.entries(raw).map(([key, item]) => [
    requiredText(key, label + ' key'),
    nonNegative(item, label + ' value'),
  ] as const)
  return Object.fromEntries(entries.sort(([left], [right]) =>
    left.localeCompare(right)))
}

function textArray(value: unknown): string[] {
  if (!Array.isArray(value)) fail('QUALITY_LINEAGE_STATE_INVALID')
  return [...new Set(value.map((item) => requiredText(item, 'state text')))]
    .sort((left, right) => left.localeCompare(right))
}

function finiteUnit(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : null
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function sourceDomain(url: string, fallback: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return requiredText(fallback, 'source domain').toLowerCase()
  }
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function requiredText(value: unknown, label: string): string {
  const normalized = String(value ?? '').trim()
  if (normalized === '') throw new Error(`${label} is required`)
  return normalized
}

function earliestTimestamp(values: string[]): string {
  return values.map((value) => timestamp(value, 'valid until'))
    .sort()[0]!
}

function timestamp(value: string, label: string): string {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label} is invalid`)
  return parsed.toISOString()
}

function positiveId(value: string, label: string): string {
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`${label} must be positive`)
  return value
}

function qualityStatus(value: string): CommercialSignalQualityStatus {
  if (![
    'qualified_actionable',
    'qualified_needs_enrichment',
    'review',
    'blocked',
    'expired',
    'dismissed',
  ].includes(value)) throw new Error('v3 status is invalid')
  return value as CommercialSignalQualityStatus
}

function unitInterval(value: number, label: string): number {
  const normalized = finiteUnit(value)
  if (normalized === null) throw new Error(`${label} must be between 0 and 1`)
  return normalized
}

function ids(values: readonly string[], validate = true): string[] {
  const normalized = values.map(String)
  if (validate && normalized.some((value) => !/^[1-9]\d*$/.test(value))) {
    throw new Error('lineage id must be positive')
  }
  return [...new Set(normalized)].sort((left, right) =>
    left.length - right.length || left.localeCompare(right, 'en'))
}

function fail(code: CommercialSignalQualityV2LineageErrorCode): never {
  throw new CommercialSignalQualityV2LineageError(code)
}
