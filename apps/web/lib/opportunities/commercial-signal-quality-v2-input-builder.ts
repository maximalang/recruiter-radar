import type { QueryResult } from 'pg'

import {
  buildEconomicsFit,
  buildMarketDifficulty,
} from './commercial-fit-v2'
import type {
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
  accountRestriction: string | null
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
  match.feature_snapshot #>> '{agency,accountRestriction}'
    AS "accountRestriction"
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
  const [eventResult, evidenceResult] = await Promise.all([
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
  ])
  if (evidenceResult.rows.length === 0) fail('QUALITY_LINEAGE_EVIDENCE_MISSING')

  const provenance = evidenceResult.rows.map(toProvenance)
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
    evidenceResult.rows,
    new Date(decisionAt),
  )
  const input = assembled.input
  const usedIds = ids([
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
  timestamp(row.candidateValidUntil as string, 'candidate valid until')
  timestamp(row.episodeValidUntil as string, 'episode valid until')
}

function assembleInput(
  row: LineageRow,
  events: EventRow[],
  evidenceById: ReadonlyMap<string, CommercialSignalEvidenceProvenance>,
  evidenceRows: EvidenceRow[],
  decisionAt: Date,
): { input: CommercialSignalQualityEngineV2Input; archetypes: string[] } {
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
  const frictionInput = buildFrictionInput(events, directIds, decisionAt)
  const friction = buildHiringFriction(frictionInput)
  const negatives = buildNegativeEvidence(
    events,
    directIds,
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
      friction.componentValues.time_to_fill_history,
      friction.observationStates.time_to_fill_history === 'observed'
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
    hiringNeed,
    hiringFriction: friction,
    agencyFit,
    propensity,
    convergence,
    economics,
    marketDifficulty: buildMarketDifficulty({
      decisionDate: decisionAt.toISOString().slice(0, 10),
      roleFamily: 'unknown',
      seniority: 'unknown',
      region: 'unknown',
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
) {
  const jobs = events.filter((event) => event.eventType === 'job_posting')
  const reposts = events.filter((event) => event.eventType === 'vacancy_repost')
  const salaries = events.filter((event) => event.eventType === 'vacancy_salary_change')
  const restarts = events.filter((event) => event.eventType === 'hiring_restart')
  const allJobIds = ids(jobs.flatMap(directIds))
  const repostIds = ids(reposts.flatMap(directIds))
  const salaryIds = ids(salaries.flatMap(directIds))
  const restartIds = ids(restarts.flatMap(directIds))
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
    const evidenceIds = directIds(event)
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
  const requirementIds = ids(requirements.flatMap(directIds))
  const evergreen = explicitBooleanObservation(events, directIds, [
    'evergreen', 'evergreenRole', 'evergreen_role',
  ])
  const massHiring = explicitBooleanObservation(events, directIds, [
    'massHiring', 'mass_hiring',
  ])
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
    salaryChange: salaryIds.length === 0 ? unknownMetric() : observedMetric(1, salaryIds),
    requirementsChange: requirementIds.length === 0
      ? unknownMetric() : observedMetric(1, requirementIds),
    closeReopenCycles: restartIds.length === 0
      ? unknownMetric() : observedMetric(1, restartIds),
    roleScarcity: unknownMetric(),
    seniorityComplexity: unknownMetric(),
    multiRoleComplexity: unknownMetric(),
    regionalDifficulty: unknownMetric(),
    internalRecruitingCapacity: unknownMetric(),
    hiringVelocityVsCapacity: unknownMetric(),
    timeToFillHistory: unknownMetric(),
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
  events: EventRow[],
  directIds: (event: EventRow) => string[],
  evidenceById: ReadonlyMap<string, CommercialSignalEvidenceProvenance>,
  decisionAt: Date,
): NegativeEvidenceInput[] {
  return events.filter((event) => event.eventType === 'hiring_slowdown')
    .map((event) => ({
      type: 'hiring_slowdown' as const,
      classification: 'confirmed_negative' as const,
      sourceKind: directIds(event).some((id) =>
        evidenceById.get(id)?.sourceKind === 'direct')
        ? 'direct' as const
        : 'official' as const,
      severity: event.confidence ?? 0.8,
      eventIds: [event.eventId],
      evidenceIds: directIds(event),
      observedAt: event.occurredAt,
      validUntil: new Date(Math.max(
        decisionAt.getTime(),
        Date.parse(event.lastSeenAt) + (45 * 86_400_000),
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
) {
  const signal = <T>(value: T, matching: EventRow[]) => ({
    value,
    eventIds: matching.map((item) => item.eventId),
    evidenceIds: ids(matching.flatMap(directIds)),
  })
  const byType = (type: string) => events.filter((event) => event.eventType === type)
  const newUnit = byType('new_business_unit')
  const newRegion = byType('new_region')
  const leadership = byType('leadership_change')
  const recruiters = byType('recruiter_vacancy')
  const restarts = byType('hiring_restart')
  const slowdown = byType('hiring_slowdown')
  const reposts = byType('vacancy_repost')
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
    hiringAcceleration: signal(restarts.length > 0 ? 0.8 : null, restarts),
    growthVsBaseline: signal<number | null>(null, []),
    repeatedRoleShare: signal<number | null>(null, []),
    meaningfulRepostCycles: signal(reposts.length || null, reposts),
    roleComplexity: signal<number | null>(null, []),
    salaryOrRequirementsChanged: signal<boolean | null>(
      events.some((event) => event.eventType === 'vacancy_salary_change') || null,
      events.filter((event) => event.eventType === 'vacancy_salary_change'),
    ),
    newUnit: signal<boolean | null>(newUnit.length > 0 || null, newUnit),
    newRegion: signal<boolean | null>(newRegion.length > 0 || null, newRegion),
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
    freezeOrSlowdown: signal<boolean | null>(slowdown.length > 0 || null, slowdown),
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
