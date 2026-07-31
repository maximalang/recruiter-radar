import type { PoolClient } from 'pg'

import {
  WORKSPACE_ROLES,
  type WorkspaceRole,
} from '@/lib/auth-v2/workspaces'
import { getClient, getPool } from '@/lib/db-pool'
import { logEvent } from '@/lib/runtime'
import {
  getNextOutcomeStage,
  hashOutcomePayload,
  isCommercialOutcomeEvent,
  isObservationalOutcomeEvent,
  isOutcomeTransitionAllowed,
  OPPORTUNITY_OUTCOME_STAGES,
  OUTCOME_EVENT_LABELS,
  OUTCOME_REASON_LABELS,
  type OpportunityOutcomeInput,
  type OutcomeProjectionEvent,
  type OpportunityOutcomeProjection,
  type OpportunityOutcomeReasonCode,
  type OpportunityOutcomeStage,
  type OpportunityOutcomeWorkflowState,
  reduceOutcomeProjection,
  validateOutcomeInput,
} from './outcome-domain'
import {
  protectOutcomeContactReference,
} from './outcome-contact-privacy'

type OutcomeDb = Pick<PoolClient, 'query'>
type OutcomeActorType = 'user' | 'system' | 'external' | 'admin'

export class OutcomeIdempotencyConflictError extends Error {
  readonly code = 'idempotency_key_conflict'

  constructor() {
    super('Outcome idempotency key was reused with another payload.')
    this.name = 'OutcomeIdempotencyConflictError'
  }
}

export class OutcomeTransitionConflictError extends Error {
  readonly code = 'outcome_transition_conflict'

  constructor(
    readonly previousStage?: OpportunityOutcomeStage,
    readonly eventType?: OpportunityOutcomeInput['eventType'],
  ) {
    super('Outcome transition is not allowed.')
    this.name = 'OutcomeTransitionConflictError'
  }
}

export class OutcomeSupersededConflictError extends Error {
  readonly code = 'opportunity_superseded'

  constructor() {
    super('Superseded opportunities do not accept new outcomes.')
    this.name = 'OutcomeSupersededConflictError'
  }
}

export class OutcomeChronologyConflictError extends Error {
  readonly code = 'outcome_chronology_conflict'

  constructor() {
    super('Outcome chronology conflicts with the current projection.')
    this.name = 'OutcomeChronologyConflictError'
  }
}

export class OutcomeCorrectionConflictError extends Error {
  readonly code = 'outcome_correction_conflict'

  constructor() {
    super('The selected effective outcome cannot be reverted.')
    this.name = 'OutcomeCorrectionConflictError'
  }
}

interface OutcomeOpportunityContext {
  id: string
  ownerId: string
  workspaceId: string | null
  clientProfileId: string
  organizationId: string
  hiringEpisodeId: string
  status: string
  supersededAt: string | null
  validUntil: string | null
  scoringVersion: string
  confidenceGate: string
  opportunityScore: number
  externalSupportNeedScore: number
  episodeType: string
  episodeStatus: string
}

export interface PublicOutcomeEvent {
  id: string
  eventType: OpportunityOutcomeInput['eventType']
  previousStage: OpportunityOutcomeStage
  newStage: OpportunityOutcomeStage
  occurredAt: string
  recordedAt: string
  actorType: OutcomeActorType
  reasonCode: OpportunityOutcomeReasonCode | null
  channel: OpportunityOutcomeInput['channel']
  valueMinor: number | null
  currency: 'RUB' | null
  metadata: Record<string, string>
  contactReferenceLabel: string | null
  revertsEventId: string | null
}

export interface RecordOutcomeResult {
  event: PublicOutcomeEvent
  state: OpportunityOutcomeProjection
  idempotent: boolean
}

export interface PublicOutcomeHistoryEvent {
  eventType: OpportunityOutcomeInput['eventType']
  label: string
  previousStage: OpportunityOutcomeStage
  newStage: OpportunityOutcomeStage
  occurredAt: string
  recordedAt: string
  appendOrder: string
  actorType: OutcomeActorType
  reason: { code: string; label: string; note: string | null } | null
  channel: OpportunityOutcomeInput['channel']
  contactPathType: OpportunityOutcomeInput['contactPathType']
  contactReferenceLabel: string | null
  valueMinor: number | null
  currency: 'RUB' | null
  metadata: Record<string, string>
  revertsEventId: string | null
  isEffective: boolean
  isReverted: boolean
  revertedByEventId: string | null
}

export type PublicOutcomeState = Omit<
  OpportunityOutcomeProjection,
  'lastEventId' | 'lastStageEventId' | 'activeMeetingEventId'
>

export interface OutcomeCorrectionCapability {
  canRevert: boolean
  targetEventId: string | null
  targetEventType: string | null
  targetOccurredAt: string | null
}

export interface OutcomeHistoryResult {
  events: PublicOutcomeHistoryEvent[]
  state: PublicOutcomeState | null
  correction: OutcomeCorrectionCapability
  pagination: {
    pageSize: number
    totalItems: number
    sortOrder: 'append_desc'
    hasMore: boolean
    nextBeforeEventId: string | null
  }
}

export interface OutcomeFunnelFilter {
  ownerId: string | number
  from: string
  to: string
  episodeType?: string | null
  confidenceGate?: string | null
  sourceFamily?: string | null
  scoreBucket?: string | null
  externalSupportNeedBucket?: 'low' | 'medium' | 'high' | null
  cohort?: 'shown' | 'accepted'
  maturityDays?: number
}

export interface OutcomeFunnelSummary {
  period: { from: string; to: string }
  cohort: {
    eventType: 'shown' | 'accepted'
    policy: 'first_effective_event_ever_closed_window'
    downstreamBefore: string
    size: number
    cohortAgeDays: number
    observationWindowDays: number
    matured: boolean
    maturityThresholdDays: number
  }
  minimumConversionSample: number
  effectiveActivityCounts: Array<{
    eventType: string
    label: string
    eventCount: number
    opportunityCount: number
  }>
  ledgerActivityCounts: Array<{
    eventType: string
    label: string
    eventCount: number
    opportunityCount: number
  }>
  correctionsCount: number
  cohortCounts: Array<{ eventType: string; label: string; count: number }>
  conversions: Array<{
    from: string
    to: string
    sampleSize: number
    converted: number
    rate: number | null
    medianHours: number | null
    status: 'ready' | 'insufficient_data' | 'immature'
    sampleStatus: 'ready' | 'insufficient_data'
    maturityStatus: 'mature' | 'immature'
  }>
  terminalOutcomes: {
    won: number
    lost: number
    completed: number
    winRate: number | null
    status: 'ready' | 'insufficient_data'
    denominator: 'effective_won_plus_lost'
  }
}

export interface RecordOpportunityOutcomeInput {
  ownerId: string | number
  workspaceId?: string | number | null
  opportunityId: string | number
  actorType: OutcomeActorType
  actorUserId?: string | number | null
  actorWorkspaceId?: string | number | null
  actorRoleSnapshot?: WorkspaceRole | null
  authMode?: 'auth_v2' | 'auth_v2_compat' | 'legacy'
  payload: unknown
  externalSystem?: string | null
  externalEventId?: string | null
  dedupeKey?: string | null
  ownerLockHeld?: boolean
}

export async function lockOutcomeOwnerShared(
  db: OutcomeDb,
  ownerId: string | number,
): Promise<void> {
  await db.query(
    `SELECT pg_advisory_xact_lock_shared(
       hashtextextended('opportunity-outcome-owner:' || $1, 0)
     )`,
    [String(ownerId)],
  )
}

export async function recordOpportunityOutcome(
  input: RecordOpportunityOutcomeInput,
): Promise<RecordOutcomeResult | null> {
  const client = await getClient()
  if (!client) throw new Error('DATABASE_URL is not set.')

  try {
    await client.query('BEGIN')
    const result = await recordOpportunityOutcomeInTransaction(input, client)
    if (!result) {
      await client.query('ROLLBACK')
      return null
    }
    await client.query('COMMIT')
    logEvent(
      result.idempotent
        ? 'opportunity_outcome.idempotent_replay'
        : 'opportunity_outcome.recorded',
      {
        ownerId: String(input.ownerId),
        opportunityId: String(input.opportunityId),
        eventType: result.event.eventType,
        inserted: result.idempotent ? 0 : 1,
        replayed: result.idempotent ? 1 : 0,
      },
    )
    if (!result.idempotent) {
      logEvent('opportunity_outcome.projection_updated', {
        ownerId: String(input.ownerId),
        opportunityId: String(input.opportunityId),
        currentStage: result.state.currentStage,
        projected: 1,
      })
    }
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

export async function getOpportunityOutcomeHistory(
  input: {
    ownerId: string | number
    opportunityId: string | number
    beforeEventId?: string | null
    pageSize?: number
  },
  db: OutcomeDb | null = getPool(),
): Promise<OutcomeHistoryResult | null> {
  if (!db) throw new Error('DATABASE_URL is not set.')
  const pageSize = Math.min(Math.max(Math.trunc(input.pageSize ?? 50), 1), 100)
  const ownerId = String(input.ownerId)
  const opportunityId = String(input.opportunityId)
  const available = await db.query<{
    status: string
    supersededAt: string | null
  }>(
    `SELECT status, superseded_at::TEXT AS "supersededAt"
     FROM opportunities
     WHERE id = $1 AND owner_id = $2
     LIMIT 1`,
    [opportunityId, ownerId],
  )
  if (!available.rows[0]) return null

  const count = await db.query<{ count: string }>(
    `SELECT COUNT(*)::TEXT AS count
     FROM opportunity_outcome_events
     WHERE owner_id = $1 AND opportunity_id = $2`,
    [ownerId, opportunityId],
  )
  const rows = await db.query<{
    id: string
    eventType: OpportunityOutcomeInput['eventType']
    previousStage: OpportunityOutcomeStage
    newStage: OpportunityOutcomeStage
    occurredAt: string
    recordedAt: string
    actorType: OutcomeActorType
    reasonCode: string | null
    reasonNote: string | null
    channel: OpportunityOutcomeInput['channel']
    contactPathType: OpportunityOutcomeInput['contactPathType']
    contactReferenceLabel: string | null
    valueMinor: number | null
    currency: 'RUB' | null
    metadata: Record<string, string>
    revertsEventId: string | null
    isEffective: boolean
    isReverted: boolean
    revertedByEventId: string | null
  }>(
    `WITH page_events AS (
       SELECT event.*
       FROM opportunity_outcome_events event
       WHERE event.owner_id = $1
         AND event.opportunity_id = $2
         AND ($3::bigint IS NULL OR event.id < $3::bigint)
       ORDER BY event.id DESC
       LIMIT $4
     )
     SELECT
       event.id::TEXT AS id,
       event.event_type AS "eventType",
       event.previous_stage AS "previousStage",
       event.new_stage AS "newStage",
       event.occurred_at::TEXT AS "occurredAt",
       event.recorded_at::TEXT AS "recordedAt",
       event.actor_type AS "actorType",
       event.reason_code AS "reasonCode",
       event.reason_note AS "reasonNote",
       event.channel,
       event.contact_path_type AS "contactPathType",
       event.contact_reference_label AS "contactReferenceLabel",
       event.value_minor::DOUBLE PRECISION AS "valueMinor",
       event.currency,
       event.metadata,
       event.reverts_event_id::TEXT AS "revertsEventId",
       (event.event_type = 'reverted' OR correction.id IS NULL) AS "isEffective",
       (correction.id IS NOT NULL) AS "isReverted",
       correction.id::TEXT AS "revertedByEventId"
     FROM page_events event
     LEFT JOIN LATERAL (
       SELECT reverted.id
       FROM opportunity_outcome_events reverted
       WHERE reverted.owner_id = event.owner_id
         AND reverted.opportunity_id = event.opportunity_id
         AND reverted.event_type = 'reverted'
         AND reverted.reverts_event_id = event.id
       ORDER BY reverted.id DESC
       LIMIT 1
     ) correction ON TRUE
     ORDER BY event.id DESC`,
    [ownerId, opportunityId, input.beforeEventId ?? null, pageSize + 1],
  )
  const state = await getOutcomeState(ownerId, opportunityId, db)
  const correctionTarget = await getOutcomeCorrectionTarget(
    ownerId,
    opportunityId,
    db,
  )
  const totalItems = Number(count.rows[0]?.count ?? 0)
  const hasMore = rows.rows.length > pageSize
  const pageRows = rows.rows.slice(0, pageSize)
  const canRevert = (
    available.rows[0]?.supersededAt === null &&
    (
      state?.workflowState ??
      (available.rows[0]?.status === 'snoozed' ? 'snoozed' : 'active')
    ) === 'active' &&
    correctionTarget !== null
  )
  return {
    events: pageRows.map((event) => ({
      eventType: event.eventType,
      label: OUTCOME_EVENT_LABELS[event.eventType],
      previousStage: event.previousStage,
      newStage: event.newStage,
      occurredAt: event.occurredAt,
      recordedAt: event.recordedAt,
      appendOrder: event.id,
      actorType: event.actorType,
      reason: event.reasonCode
        ? {
            code: event.reasonCode,
            label: OUTCOME_REASON_LABELS[event.reasonCode] ?? event.reasonCode,
            note: event.reasonNote,
          }
        : null,
      channel: event.channel,
      contactPathType: event.contactPathType,
      contactReferenceLabel: event.contactReferenceLabel,
      valueMinor: event.valueMinor,
      currency: event.currency,
      metadata: event.metadata,
      revertsEventId: event.revertsEventId,
      isEffective: event.isEffective,
      isReverted: event.isReverted,
      revertedByEventId: event.revertedByEventId,
    })),
    state: state ? toPublicOutcomeState(state) : null,
    correction: canRevert
      ? {
          canRevert: true,
          ...correctionTarget,
        }
      : {
          canRevert: false,
          targetEventId: null,
          targetEventType: null,
          targetOccurredAt: null,
        },
    pagination: {
      pageSize,
      totalItems,
      sortOrder: 'append_desc',
      hasMore,
      nextBeforeEventId: hasMore
        ? pageRows.at(-1)?.id ?? null
        : null,
    },
  }
}

async function getOutcomeCorrectionTarget(
  ownerId: string,
  opportunityId: string,
  db: OutcomeDb,
): Promise<Omit<OutcomeCorrectionCapability, 'canRevert'> | null> {
  const result = await db.query<{
    targetEventId: string
    targetEventType: string
    targetOccurredAt: string
  }>(
    `WITH effective_commercial AS (
       SELECT event.id, event.event_type, event.occurred_at
       FROM opportunity_outcome_events event
       WHERE event.owner_id = $1
         AND event.opportunity_id = $2
         AND event.event_type IN (
           'accepted', 'dismissed', 'contacted', 'replied',
           'meeting', 'meeting_completed', 'meeting_cancelled',
           'meeting_no_show', 'proposal', 'won', 'lost'
         )
         AND NOT EXISTS (
           SELECT 1
           FROM opportunity_outcome_events reverted
           WHERE reverted.owner_id = event.owner_id
             AND reverted.opportunity_id = event.opportunity_id
             AND reverted.event_type = 'reverted'
             AND reverted.reverts_event_id = event.id
         )
     ), latest_correction AS (
       SELECT MAX(id) AS id
       FROM opportunity_outcome_events
       WHERE owner_id = $1
         AND opportunity_id = $2
         AND event_type = 'reverted'
     )
     SELECT
       event.id::TEXT AS "targetEventId",
       event.event_type AS "targetEventType",
       event.occurred_at::TEXT AS "targetOccurredAt"
     FROM effective_commercial event
     CROSS JOIN latest_correction
     WHERE event.id > COALESCE(latest_correction.id, 0)
     ORDER BY event.id DESC
     LIMIT 1`,
    [ownerId, opportunityId],
  )
  return result.rows[0] ?? null
}

export async function resolveOpportunityPublicReference(
  publicReference: string,
  db: OutcomeDb | null = getPool(),
): Promise<{ ownerId: string; opportunityId: string } | null> {
  if (!db) throw new Error('DATABASE_URL is not set.')
  const result = await db.query<{ ownerId: string; opportunityId: string }>(
    `SELECT
       owner_id::TEXT AS "ownerId",
       id::TEXT AS "opportunityId"
     FROM opportunities
     WHERE public_reference = $1::uuid
       AND superseded_at IS NULL
     LIMIT 1`,
    [publicReference],
  )
  return result.rows[0] ?? null
}

export async function getOutcomeFunnelSummary(
  input: OutcomeFunnelFilter,
  db: OutcomeDb | null = getPool(),
): Promise<OutcomeFunnelSummary> {
  if (!db) throw new Error('DATABASE_URL is not set.')
  const cohortEvent = input.cohort ?? 'shown'
  const params: unknown[] = [
    String(input.ownerId),
    input.from,
    input.to,
    cohortEvent,
  ]
  const cohortClauses: string[] = []
  if (input.episodeType) {
    params.push(input.episodeType)
    cohortClauses.push(`cohort_snapshot->>'episodeType' = $${params.length}`)
  }
  if (input.confidenceGate) {
    params.push(input.confidenceGate)
    cohortClauses.push(`cohort_snapshot->>'confidenceGate' = $${params.length}`)
  }
  if (input.scoreBucket) {
    params.push(input.scoreBucket)
    cohortClauses.push(`cohort_snapshot->>'scoreBucket' = $${params.length}`)
  }
  if (input.sourceFamily) {
    params.push(input.sourceFamily)
    cohortClauses.push(
      `cohort_snapshot->'sourceFamilies' ? $${params.length}`,
    )
  }
  if (input.externalSupportNeedBucket) {
    params.push(input.externalSupportNeedBucket)
    cohortClauses.push(
      `cohort_snapshot->>'externalSupportNeedBucket' = $${params.length}`,
    )
  }

  type FunnelRow = Record<string, string | null>
  const result = await db.query<FunnelRow>(
    `WITH owner_events AS (
       SELECT
         id,
         opportunity_id,
         event_type,
         occurred_at,
         analytics_snapshot,
         reverts_event_id
       FROM opportunity_outcome_events
       WHERE owner_id = $1
     ), active_events AS (
       SELECT event.*
       FROM owner_events event
       WHERE event.event_type <> 'reverted'
         AND NOT EXISTS (
           SELECT 1
           FROM owner_events correction
           WHERE correction.event_type = 'reverted'
             AND correction.reverts_event_id = event.id
         )
     ), effective_activity AS (
       SELECT
         event_type,
         COUNT(*)::TEXT AS event_count,
         COUNT(DISTINCT opportunity_id)::TEXT AS opportunity_count
       FROM active_events
       WHERE occurred_at >= $2::timestamptz
         AND occurred_at < $3::timestamptz
       GROUP BY event_type
     ), ledger_activity AS (
       SELECT
         event_type,
         COUNT(*)::TEXT AS event_count,
         COUNT(DISTINCT opportunity_id)::TEXT AS opportunity_count
       FROM owner_events
       WHERE occurred_at >= $2::timestamptz
         AND occurred_at < $3::timestamptz
       GROUP BY event_type
     ), cohort_ranked AS (
       SELECT
         opportunity_id,
         occurred_at AS cohort_at,
         analytics_snapshot AS cohort_snapshot,
         ROW_NUMBER() OVER (
           PARTITION BY opportunity_id
           ORDER BY occurred_at, id
         ) AS cohort_rank
       FROM active_events
       WHERE event_type = $4
     ), cohort_candidates AS (
       SELECT opportunity_id, cohort_at, cohort_snapshot
       FROM cohort_ranked
       WHERE cohort_rank = 1
         AND cohort_at >= $2::timestamptz
         AND cohort_at < $3::timestamptz
     ), cohort AS (
       SELECT *
       FROM cohort_candidates
       ${cohortClauses.length > 0
         ? `WHERE ${cohortClauses.join('\n         AND ')}`
         : ''}
     ), cohort_events AS (
       SELECT event.opportunity_id, event.event_type, event.occurred_at
       FROM cohort
       JOIN active_events event USING (opportunity_id)
       WHERE event.occurred_at >= cohort.cohort_at
         AND event.occurred_at < $3::timestamptz
     ), per_opportunity AS (
       SELECT
         opportunity_id,
         MIN(occurred_at) FILTER (WHERE event_type = 'shown') AS shown_at,
         MIN(occurred_at) FILTER (WHERE event_type = 'opened') AS opened_at,
         MIN(occurred_at) FILTER (WHERE event_type = 'accepted') AS accepted_at,
         MIN(occurred_at) FILTER (WHERE event_type = 'contacted') AS contacted_at,
         MIN(occurred_at) FILTER (WHERE event_type = 'replied') AS replied_at,
         MIN(occurred_at) FILTER (WHERE event_type = 'meeting') AS meeting_at,
         MIN(occurred_at) FILTER (WHERE event_type = 'proposal') AS proposal_at,
         MIN(occurred_at) FILTER (WHERE event_type = 'won') AS won_at,
         MIN(occurred_at) FILTER (WHERE event_type = 'lost') AS lost_at
       FROM cohort_events
       GROUP BY opportunity_id
     )
     SELECT
       (SELECT COUNT(*) FROM cohort)::TEXT AS "cohortSize",
       (SELECT COALESCE(
          JSONB_AGG(
            JSONB_BUILD_OBJECT(
              'eventType', event_type,
              'eventCount', event_count,
              'opportunityCount', opportunity_count
            )
            ORDER BY event_type
          ),
          '[]'::jsonb
        )
        FROM effective_activity)::TEXT AS "effectiveActivityCounts",
       (SELECT COALESCE(
          JSONB_AGG(
            JSONB_BUILD_OBJECT(
              'eventType', event_type,
              'eventCount', event_count,
              'opportunityCount', opportunity_count
            )
            ORDER BY event_type
          ),
          '[]'::jsonb
        )
        FROM ledger_activity)::TEXT AS "ledgerActivityCounts",
       (SELECT COUNT(*)::TEXT
        FROM owner_events
        WHERE event_type = 'reverted'
          AND occurred_at >= $2::timestamptz
          AND occurred_at < $3::timestamptz) AS "correctionsCount",
       (SELECT MIN(cohort_at)::TEXT FROM cohort) AS "cohortFirstAt",
       (SELECT MAX(cohort_at)::TEXT FROM cohort) AS "cohortLastAt",
       COUNT(*) FILTER (WHERE shown_at IS NOT NULL)::TEXT AS "shownCohortCount",
       COUNT(*) FILTER (WHERE opened_at IS NOT NULL)::TEXT AS "openedCohortCount",
       COUNT(*) FILTER (WHERE accepted_at IS NOT NULL)::TEXT AS "acceptedCohortCount",
       COUNT(*) FILTER (WHERE contacted_at IS NOT NULL)::TEXT AS "contactedCohortCount",
       COUNT(*) FILTER (WHERE replied_at IS NOT NULL)::TEXT AS "repliedCohortCount",
       COUNT(*) FILTER (WHERE meeting_at IS NOT NULL)::TEXT AS "meetingCohortCount",
       COUNT(*) FILTER (WHERE proposal_at IS NOT NULL)::TEXT AS "proposalCohortCount",
       COUNT(*) FILTER (WHERE won_at IS NOT NULL)::TEXT AS "wonCohortCount",
       COUNT(*) FILTER (WHERE lost_at IS NOT NULL)::TEXT AS "lostCohortCount",
       ${medianSql('shown_at', 'opened_at', 'shownOpened')},
       ${medianSql('opened_at', 'accepted_at', 'openedAccepted')},
       ${medianSql('accepted_at', 'contacted_at', 'acceptedContacted')},
       ${medianSql('contacted_at', 'replied_at', 'contactedReplied')},
       ${medianSql('replied_at', 'meeting_at', 'repliedMeeting')},
       ${medianSql('meeting_at', 'proposal_at', 'meetingProposal')},
       ${medianSql('proposal_at', 'won_at', 'proposalWon')},
       ${medianSql('contacted_at', 'lost_at', 'contactedLost')},
       ${medianSql('replied_at', 'lost_at', 'repliedLost')},
       ${medianSql('meeting_at', 'lost_at', 'meetingLost')},
       ${medianSql('proposal_at', 'lost_at', 'proposalLost')}
     FROM per_opportunity`,
    params,
  )
  const row = result.rows[0] ?? {}
  const cohortCounts = Object.fromEntries(
    ['shown', 'opened', 'accepted', 'contacted', 'replied', 'meeting', 'proposal', 'won', 'lost']
      .map((eventType) => [
        eventType,
        numberValue(row[`${eventType}CohortCount`]),
      ]),
  ) as Record<string, number>
  const effectiveActivity = parseActivityCounts(row.effectiveActivityCounts)
  const ledgerActivity = parseActivityCounts(row.ledgerActivityCounts)
  const discoveryPairs = [
    ['shown', 'opened', 'shownOpened'],
    ['opened', 'accepted', 'openedAccepted'],
  ] as const
  const commercialPairs = [
    ['accepted', 'contacted', 'acceptedContacted'],
    ['contacted', 'replied', 'contactedReplied'],
    ['replied', 'meeting', 'repliedMeeting'],
    ['meeting', 'proposal', 'meetingProposal'],
    ['proposal', 'won', 'proposalWon'],
    ['contacted', 'lost', 'contactedLost'],
    ['replied', 'lost', 'repliedLost'],
    ['meeting', 'lost', 'meetingLost'],
    ['proposal', 'lost', 'proposalLost'],
  ] as const
  const pairs = cohortEvent === 'accepted'
    ? commercialPairs
    : [...discoveryPairs, ...commercialPairs]
  const minimumConversionSample = 10
  const maturityThresholdDays = Math.max(
    1,
    Math.min(365, Math.trunc(input.maturityDays ?? 30)),
  )
  const cohortFirstAt = row.cohortFirstAt ?? input.from
  const cohortLastAt = row.cohortLastAt ?? cohortFirstAt
  const cohortAgeDays = daysBetween(cohortFirstAt, input.to)
  const observationWindowDays = daysBetween(cohortLastAt, input.to)
  const cohortSize = numberValue(row.cohortSize)
  const matured =
    cohortSize > 0 && observationWindowDays >= maturityThresholdDays
  return {
    period: { from: input.from, to: input.to },
    cohort: {
      eventType: cohortEvent,
      policy: 'first_effective_event_ever_closed_window',
      downstreamBefore: input.to,
      size: cohortSize,
      cohortAgeDays,
      observationWindowDays,
      matured,
      maturityThresholdDays,
    },
    minimumConversionSample,
    effectiveActivityCounts: labelActivityCounts(effectiveActivity),
    ledgerActivityCounts: labelActivityCounts(ledgerActivity),
    correctionsCount: numberValue(row.correctionsCount),
    cohortCounts: Object.entries(cohortCounts)
      .filter(([eventType]) =>
        cohortEvent === 'shown' ||
        (eventType !== 'shown' && eventType !== 'opened'))
      .map(([eventType, count]) => ({
      eventType,
      label: OUTCOME_EVENT_LABELS[eventType as OpportunityOutcomeInput['eventType']],
      count,
    })),
    conversions: pairs.map(([from, to, key]) => {
      const sampleSize = cohortCounts[from]
      const converted = numberValue(row[`${key}Pairs`])
      const ready = sampleSize >= minimumConversionSample
      const medianSample = numberValue(row[`${key}Pairs`])
      return {
        from,
        to,
        sampleSize,
        converted,
        rate: ready && sampleSize > 0
          ? Number((converted / sampleSize).toFixed(4))
          : null,
        medianHours: medianSample >= 3
          ? nullableNumber(row[`${key}MedianHours`])
          : null,
        status: !ready
          ? 'insufficient_data'
          : matured
            ? 'ready'
            : 'immature',
        sampleStatus: ready ? 'ready' : 'insufficient_data',
        maturityStatus: matured ? 'mature' : 'immature',
      }
    }),
    terminalOutcomes: terminalOutcomeSummary(
      cohortCounts.won,
      cohortCounts.lost,
      minimumConversionSample,
    ),
  }
}

export async function recordOpportunityOutcomeInTransaction(
  input: RecordOpportunityOutcomeInput,
  db: OutcomeDb,
): Promise<RecordOutcomeResult | null> {
  const payload = validateOutcomeInput(input.payload)
  const authMode = input.authMode ?? 'legacy'
  const hasWorkspaceActorContext = authMode === 'auth_v2'
  if (
    hasWorkspaceActorContext &&
    (
      input.actorType !== 'user' ||
      input.actorUserId == null ||
      input.workspaceId == null ||
      input.actorWorkspaceId == null ||
      String(input.workspaceId) !== String(input.actorWorkspaceId) ||
      input.actorRoleSnapshot == null ||
      !WORKSPACE_ROLES.includes(input.actorRoleSnapshot)
    )
  ) {
    throw new Error('Auth v2 outcome actor context is incomplete.')
  }
  if (
    !hasWorkspaceActorContext &&
    (
      input.actorWorkspaceId != null ||
      input.actorRoleSnapshot != null
    )
  ) {
    throw new Error('Legacy outcome actor cannot carry workspace attribution.')
  }
  const externalSystem = normalizeExternalIdentifier(
    input.externalSystem,
    'externalSystem',
  )
  const externalEventId = normalizeExternalIdentifier(
    input.externalEventId,
    'externalEventId',
  )
  if ((externalSystem === null) !== (externalEventId === null)) {
    throw new Error('External system and event ID must be provided together.')
  }
  const dedupeKey = normalizeDedupeKey(input.dedupeKey, payload)
  if (!input.ownerLockHeld) {
    await lockOutcomeOwnerShared(db, input.ownerId)
  }
  const contextResult = await db.query<OutcomeOpportunityContext>(
    `SELECT
       o.id::TEXT AS id,
       o.owner_id::TEXT AS "ownerId",
       o.workspace_id::TEXT AS "workspaceId",
       o.client_profile_id::TEXT AS "clientProfileId",
       o.organization_id::TEXT AS "organizationId",
       o.hiring_episode_id::TEXT AS "hiringEpisodeId",
       o.status,
       o.superseded_at::TEXT AS "supersededAt",
       o.valid_until::TEXT AS "validUntil",
       o.scoring_version AS "scoringVersion",
       o.confidence_gate AS "confidenceGate",
       o.opportunity_score AS "opportunityScore",
       o.agency_propensity_score AS "externalSupportNeedScore",
       he.episode_type AS "episodeType",
       he.status AS "episodeStatus"
     FROM opportunities o
     JOIN hiring_episodes he
       ON he.id = o.hiring_episode_id
      AND he.organization_id = o.organization_id
      WHERE o.id = $1
        AND o.owner_id = $2
        AND ($3::BIGINT IS NULL OR o.workspace_id = $3)
      FOR UPDATE`,
    [
      String(input.opportunityId),
      String(input.ownerId),
      input.workspaceId == null ? null : String(input.workspaceId),
    ],
  )
  const context = contextResult.rows[0]
  if (!context) return null
  if (
    input.actorType === 'user' &&
    !hasWorkspaceActorContext &&
    String(input.actorUserId ?? '') !== context.ownerId
  ) {
    throw new Error('User outcome actor must match the tenant owner.')
  }
  if (input.actorType === 'admin' && input.actorUserId == null) {
    throw new Error('Admin outcome actor requires a user identity.')
  }
  if (
    input.actorType !== 'user' &&
    input.actorType !== 'admin' &&
    input.actorUserId != null
  ) {
    throw new Error('System and external outcomes cannot carry a user actor.')
  }

  // The database uniqueness boundary is owner + key, while the opportunity row
  // lock only serializes requests for one opportunity. Lock the same uniqueness
  // scope so concurrent requests for different opportunities deterministically
  // resolve as a replay or a 409 instead of leaking a unique-violation 500.
  await db.query(
    `SELECT pg_advisory_xact_lock(
       hashtextextended('opportunity-outcome:' || $1 || ':' || $2, 0)
     )`,
    [context.ownerId, payload.idempotencyKey],
  )

  const protectedContactReference = protectOutcomeContactReference(
    context.ownerId,
    payload.contactReference,
  )
  const payloadHash = hashOutcomePayload({
    opportunityId: context.id,
    actorType: input.actorType,
    payload: {
      ...payload,
      contactReference: undefined,
      contactReferenceHash: protectedContactReference?.hash ?? null,
    },
    externalSystem,
    externalEventId,
    dedupeKey,
  })

  const replay = await findReplay(
    {
      ownerId: context.ownerId,
      opportunityId: context.id,
      eventType: payload.eventType,
      idempotencyKey: payload.idempotencyKey,
      payloadHash,
      externalSystem,
      externalEventId,
      dedupeKey,
    },
    db,
  )
  if (replay) return replay

  if (context.supersededAt) {
    throw new OutcomeSupersededConflictError()
  }
  if (
    payload.eventType === 'resumed' &&
    (
      context.status === 'expired' ||
      context.episodeStatus !== 'active' ||
      (
        context.validUntil !== null &&
        Date.parse(context.validUntil) < Date.parse(payload.occurredAt)
      )
    )
  ) {
    throw new OutcomeTransitionConflictError(undefined, payload.eventType)
  }

  const lockedState = await getLockedOutcomeState(
    context.ownerId,
    context.id,
    db,
  )
  const previousStage = lockedState?.commercialStage ??
    toInitialStage(context.status) ??
    (context.status === 'snoozed' ? 'new' : null)
  const workflowState = lockedState?.workflowState ??
    (context.status === 'snoozed' ? 'snoozed' : 'active')
  const meetingStatus = lockedState?.meetingStatus ?? 'none'
  if (
    !previousStage ||
    !isOutcomeTransitionAllowed(
      previousStage,
      payload.eventType,
      workflowState,
      meetingStatus,
    )
  ) {
    logEvent('opportunity_outcome.transition_rejected', {
      ownerId: context.ownerId,
      opportunityId: context.id,
      previousStage: previousStage ?? context.status,
      eventType: payload.eventType,
      rejected: 1,
    })
    throw new OutcomeTransitionConflictError(
      previousStage ?? undefined,
      payload.eventType,
    )
  }
  let revertedEventType: OpportunityOutcomeInput['eventType'] | null = null
  let newStage = getNextOutcomeStage(
    previousStage,
    payload.eventType,
    workflowState,
    meetingStatus,
  )
  let correctionTargetsMeetingLifecycle = false
  if (payload.eventType === 'reverted') {
    const target = await db.query<{
      eventType: OpportunityOutcomeInput['eventType']
      previousStage: OpportunityOutcomeStage
      newStage: OpportunityOutcomeStage
    }>(
      `SELECT
         target.event_type AS "eventType",
         target.previous_stage AS "previousStage",
         target.new_stage AS "newStage"
       FROM opportunity_outcome_events target
       WHERE target.id = $1
         AND target.owner_id = $2
         AND target.opportunity_id = $3
         AND target.event_type IN (
           'accepted', 'dismissed', 'contacted', 'replied',
           'meeting', 'meeting_completed', 'meeting_cancelled',
           'meeting_no_show', 'proposal', 'won', 'lost'
         )
         AND NOT EXISTS (
           SELECT 1
           FROM opportunity_outcome_events correction
           WHERE correction.owner_id = target.owner_id
             AND correction.opportunity_id = target.opportunity_id
             AND correction.event_type = 'reverted'
             AND correction.reverts_event_id = target.id
         )
         AND target.id > COALESCE((
           SELECT MAX(latest_correction.id)
           FROM opportunity_outcome_events latest_correction
           WHERE latest_correction.owner_id = target.owner_id
             AND latest_correction.opportunity_id = target.opportunity_id
             AND latest_correction.event_type = 'reverted'
         ), 0)
         AND target.id = (
           SELECT latest_effective.id
           FROM opportunity_outcome_events latest_effective
           WHERE latest_effective.owner_id = target.owner_id
             AND latest_effective.opportunity_id = target.opportunity_id
             AND latest_effective.event_type IN (
               'accepted', 'dismissed', 'contacted', 'replied',
               'meeting', 'meeting_completed', 'meeting_cancelled',
               'meeting_no_show', 'proposal', 'won', 'lost'
             )
             AND NOT EXISTS (
               SELECT 1
               FROM opportunity_outcome_events latest_reverted
               WHERE latest_reverted.owner_id = latest_effective.owner_id
                 AND latest_reverted.opportunity_id =
                   latest_effective.opportunity_id
                 AND latest_reverted.event_type = 'reverted'
                 AND latest_reverted.reverts_event_id = latest_effective.id
             )
           ORDER BY latest_effective.id DESC
           LIMIT 1
         )
       LIMIT 1`,
      [payload.revertsEventId, context.ownerId, context.id],
    )
    const correctionTarget = target.rows[0]
    if (!correctionTarget) throw new OutcomeCorrectionConflictError()
    const stageChanging =
      correctionTarget.previousStage !== correctionTarget.newStage
    if (
      stageChanging &&
      payload.revertsEventId !== lockedState?.lastStageEventId
    ) {
      throw new OutcomeCorrectionConflictError()
    }
    correctionTargetsMeetingLifecycle = [
      'meeting',
      'meeting_completed',
      'meeting_cancelled',
      'meeting_no_show',
    ].includes(correctionTarget.eventType)
    if (correctionTargetsMeetingLifecycle) {
      const latestMeeting = await db.query<{ id: string }>(
        `SELECT event.id::TEXT AS id
         FROM opportunity_outcome_events event
         WHERE event.owner_id = $1
           AND event.opportunity_id = $2
           AND event.event_type IN (
             'meeting', 'meeting_completed', 'meeting_cancelled',
             'meeting_no_show'
           )
           AND NOT EXISTS (
             SELECT 1
             FROM opportunity_outcome_events correction
             WHERE correction.owner_id = event.owner_id
               AND correction.opportunity_id = event.opportunity_id
               AND correction.event_type = 'reverted'
               AND correction.reverts_event_id = event.id
           )
         ORDER BY event.id DESC
         LIMIT 1`,
        [context.ownerId, context.id],
      )
      if (latestMeeting.rows[0]?.id !== payload.revertsEventId) {
        throw new OutcomeCorrectionConflictError()
      }
    }
    revertedEventType = correctionTarget.eventType
    newStage = stageChanging
      ? correctionTarget.previousStage
      : previousStage
  }
  if (
    isCommercialOutcomeEvent(payload.eventType) &&
    lockedState?.lastStageEventAt &&
    Date.parse(payload.occurredAt) < Date.parse(lockedState.lastStageEventAt)
  ) {
    throw new OutcomeChronologyConflictError()
  }
  if (
    [
      'meeting',
      'meeting_completed',
      'meeting_cancelled',
      'meeting_no_show',
    ].includes(payload.eventType) ||
    correctionTargetsMeetingLifecycle
  ) {
    if (
      lockedState?.lastMeetingEventAt &&
      Date.parse(payload.occurredAt) <
        Date.parse(lockedState.lastMeetingEventAt)
    ) {
      throw new OutcomeChronologyConflictError()
    }
  }
  const sourceFamilies = await getSourceFamilies(context.hiringEpisodeId, db)
  const analyticsSnapshot = {
    scoringVersion: context.scoringVersion,
    episodeType: context.episodeType,
    confidenceGate: context.confidenceGate,
    scoreBucket: scoreBucket(context.opportunityScore),
    sourceFamilies,
    externalSupportNeedBucket: supportNeedBucket(
      context.externalSupportNeedScore,
    ),
  }

  const inserted = await db.query<{ id: string; recordedAt: string }>(
    `INSERT INTO opportunity_outcome_events (
       owner_id,
       client_profile_id,
       opportunity_id,
       hiring_episode_id,
       organization_id,
       event_type,
       previous_stage,
       new_stage,
       reason_code,
       reason_note,
       channel,
       contact_path_type,
       contact_reference,
       contact_reference_hash,
       contact_reference_label,
       snoozed_until,
       reverts_event_id,
       external_system,
       external_event_id,
       value_minor,
       currency,
       occurred_at,
       actor_type,
       actor_user_id,
       actor_workspace_id,
       actor_role_snapshot,
       metadata,
       analytics_snapshot,
       idempotency_key,
       dedupe_key,
       payload_hash
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
       $14, $15, $16::timestamptz, $17, $18, $19, $20, $21,
       $22::timestamptz, $23, $24, $25, $26, $27::jsonb, $28::jsonb,
       $29, $30, $31
     )
     RETURNING id::TEXT AS id, recorded_at::TEXT AS "recordedAt"`,
    [
      context.ownerId,
      context.clientProfileId,
      context.id,
      context.hiringEpisodeId,
      context.organizationId,
      payload.eventType,
      previousStage,
      newStage,
      payload.reasonCode,
      payload.reasonNote,
      payload.channel,
      payload.contactPathType,
      null,
      protectedContactReference?.hash ?? null,
      protectedContactReference?.label ?? null,
      payload.snoozedUntil,
      payload.revertsEventId,
      externalSystem,
      externalEventId,
      payload.valueMinor,
      payload.currency,
      payload.occurredAt,
      input.actorType,
      input.actorUserId == null ? null : String(input.actorUserId),
      input.actorWorkspaceId == null
        ? null
        : String(input.actorWorkspaceId),
      input.actorRoleSnapshot ?? null,
      JSON.stringify(payload.metadata),
      JSON.stringify(analyticsSnapshot),
      payload.idempotencyKey,
      dedupeKey,
      payloadHash,
    ],
  )
  const insertedEvent = inserted.rows[0]
  if (!insertedEvent) {
    throw new Error('Outcome event insert returned no row.')
  }

  const event: PublicOutcomeEvent = {
    id: insertedEvent.id,
    eventType: payload.eventType,
    previousStage,
    newStage,
    occurredAt: payload.occurredAt,
    recordedAt: insertedEvent.recordedAt,
    actorType: input.actorType,
    reasonCode: payload.reasonCode,
    channel: payload.channel,
    valueMinor: payload.valueMinor,
    currency: payload.currency,
    metadata: payload.metadata,
    contactReferenceLabel: protectedContactReference?.label ?? null,
    revertsEventId: payload.revertsEventId,
  }
  const projectionEvent = {
    id: event.id,
    eventType: event.eventType,
    previousStage,
    newStage,
    occurredAt: event.occurredAt,
    reasonCode: event.reasonCode,
    valueMinor: event.valueMinor,
    currency: event.currency,
    snoozedUntil: payload.snoozedUntil,
    meetingStatus: payload.eventType === 'meeting'
      ? payload.metadata.meetingStatus as 'scheduled'
      : null,
    revertsEventId: payload.revertsEventId,
    revertedEventType,
  }
  const state = payload.eventType === 'reverted'
    ? await rebuildOpportunityOutcomeProjection(
        context,
        projectionEvent,
        db,
      )
    : reduceOutcomeProjection(lockedState, projectionEvent)
  await persistOutcomeState(context, state, db)
  await persistLegacyCommercialState(context, payload, state, db)

  return { event, state, idempotent: false }
}

async function rebuildOpportunityOutcomeProjection(
  context: OutcomeOpportunityContext,
  correctionEvent: OutcomeProjectionEvent,
  db: OutcomeDb,
): Promise<OpportunityOutcomeProjection> {
  const events = await db.query<
    OutcomeProjectionEvent & { effective: boolean }
  >(
    `SELECT
       event.id::TEXT AS id,
       event.event_type AS "eventType",
       event.previous_stage AS "previousStage",
       event.new_stage AS "newStage",
       event.occurred_at::TEXT AS "occurredAt",
       event.reason_code AS "reasonCode",
       event.value_minor::DOUBLE PRECISION AS "valueMinor",
       event.currency,
       event.snoozed_until::TEXT AS "snoozedUntil",
       event.metadata->>'meetingStatus' AS "meetingStatus",
       NOT EXISTS (
         SELECT 1
         FROM opportunity_outcome_events correction
         WHERE correction.owner_id = event.owner_id
           AND correction.opportunity_id = event.opportunity_id
           AND correction.event_type = 'reverted'
           AND correction.reverts_event_id = event.id
       ) AS effective
     FROM opportunity_outcome_events event
     WHERE event.owner_id = $1
       AND event.opportunity_id = $2
       AND event.event_type <> 'reverted'
     ORDER BY event.id`,
    [context.ownerId, context.id],
  )
  const initialStage = events.rows[0]?.previousStage ??
    toInitialStage(context.status)
  if (!initialStage) {
    throw new Error('Outcome projection has no deterministic initial stage.')
  }
  let projection: OpportunityOutcomeProjection | null = null
  for (const event of events.rows) {
    if (!event.effective) continue
    projection = reduceOutcomeProjection(projection, event)
  }
  const currentStage = projection?.commercialStage ?? initialStage
  return reduceOutcomeProjection(projection, {
    ...correctionEvent,
    previousStage: currentStage,
    newStage: currentStage,
    revertedEventType: null,
  })
}

async function findReplay(
  input: {
    ownerId: string
    opportunityId: string
    eventType: OpportunityOutcomeInput['eventType']
    idempotencyKey: string
    payloadHash: string
    externalSystem: string | null
    externalEventId: string | null
    dedupeKey: string | null
  },
  db: OutcomeDb,
): Promise<RecordOutcomeResult | null> {
  const keyResult = await db.query<{ id: string; payloadHash: string }>(
    `SELECT id::TEXT AS id, payload_hash AS "payloadHash"
     FROM opportunity_outcome_events
     WHERE owner_id = $1
       AND idempotency_key = $2
     LIMIT 1`,
    [input.ownerId, input.idempotencyKey],
  )
  const keyed = keyResult.rows[0]
  if (keyed) {
    if (keyed.payloadHash !== input.payloadHash) {
      throw new OutcomeIdempotencyConflictError()
    }
    return loadRecordedOutcome(input.ownerId, keyed.id, db)
  }

  if (input.externalSystem && input.externalEventId) {
    const external = await db.query<{ id: string; payloadHash: string }>(
      `SELECT id::TEXT AS id, payload_hash AS "payloadHash"
       FROM opportunity_outcome_events
       WHERE owner_id = $1
         AND external_system = $2
         AND external_event_id = $3
       LIMIT 1`,
      [input.ownerId, input.externalSystem, input.externalEventId],
    )
    if (external.rows[0]) {
      if (external.rows[0].payloadHash !== input.payloadHash) {
        throw new OutcomeIdempotencyConflictError()
      }
      return loadRecordedOutcome(input.ownerId, external.rows[0].id, db)
    }
  }

  if (input.dedupeKey) {
    const interaction = await db.query<{ id: string; payloadHash: string }>(
      `SELECT id::TEXT AS id, payload_hash AS "payloadHash"
       FROM opportunity_outcome_events
       WHERE owner_id = $1
         AND opportunity_id = $2
         AND event_type = $3
         AND dedupe_key = $4
       LIMIT 1`,
      [
        input.ownerId,
        input.opportunityId,
        input.eventType,
        input.dedupeKey,
      ],
    )
    if (interaction.rows[0]) {
      if (interaction.rows[0].payloadHash !== input.payloadHash) {
        throw new OutcomeIdempotencyConflictError()
      }
      return loadRecordedOutcome(input.ownerId, interaction.rows[0].id, db)
    }
  }
  return null
}

async function loadRecordedOutcome(
  ownerId: string,
  eventId: string,
  db: OutcomeDb,
): Promise<RecordOutcomeResult> {
  const eventResult = await db.query<PublicOutcomeEvent & { opportunityId: string }>(
    `SELECT
       id::TEXT AS id,
       opportunity_id::TEXT AS "opportunityId",
       event_type AS "eventType",
       previous_stage AS "previousStage",
       new_stage AS "newStage",
       occurred_at::TEXT AS "occurredAt",
       recorded_at::TEXT AS "recordedAt",
       actor_type AS "actorType",
       reason_code AS "reasonCode",
       channel,
       contact_reference_label AS "contactReferenceLabel",
       value_minor::DOUBLE PRECISION AS "valueMinor",
       currency,
       metadata,
       reverts_event_id::TEXT AS "revertsEventId"
     FROM opportunity_outcome_events
     WHERE owner_id = $1 AND id = $2
     LIMIT 1`,
    [ownerId, eventId],
  )
  const event = eventResult.rows[0]
  if (!event) throw new Error('Idempotent outcome event could not be reloaded.')
  const state = await getLockedOutcomeState(ownerId, event.opportunityId, db)
  if (!state) throw new Error('Idempotent outcome state could not be reloaded.')
  return { event, state, idempotent: true }
}

async function getLockedOutcomeState(
  ownerId: string,
  opportunityId: string,
  db: OutcomeDb,
): Promise<OpportunityOutcomeProjection | null> {
  const result = await db.query<OpportunityOutcomeProjection>(
     `SELECT
       commercial_stage AS "commercialStage",
       current_stage AS "currentStage",
       workflow_state AS "workflowState",
       snoozed_until::TEXT AS "snoozedUntil",
       last_event_id::TEXT AS "lastEventId",
       last_event_at::TEXT AS "lastEventAt",
       last_stage_event_id::TEXT AS "lastStageEventId",
       last_stage_event_at::TEXT AS "lastStageEventAt",
       first_shown_at::TEXT AS "firstShownAt",
       first_opened_at::TEXT AS "firstOpenedAt",
       accepted_at::TEXT AS "acceptedAt",
       contacted_at::TEXT AS "contactedAt",
       replied_at::TEXT AS "repliedAt",
       meeting_at::TEXT AS "meetingAt",
       proposal_at::TEXT AS "proposalAt",
       won_at::TEXT AS "wonAt",
       lost_at::TEXT AS "lostAt",
       dismiss_reason_code AS "dismissReasonCode",
       lost_reason_code AS "lostReasonCode",
       deal_value_minor::DOUBLE PRECISION AS "dealValueMinor",
       currency,
       meeting_status AS "meetingStatus",
       active_meeting_event_id::TEXT AS "activeMeetingEventId",
       last_meeting_event_at::TEXT AS "lastMeetingEventAt",
       meeting_attempt_count AS "meetingAttemptCount"
     FROM opportunity_outcome_state
     WHERE owner_id = $1 AND opportunity_id = $2
     FOR UPDATE`,
    [ownerId, opportunityId],
  )
  return result.rows[0] ?? null
}

async function getOutcomeState(
  ownerId: string,
  opportunityId: string,
  db: OutcomeDb,
): Promise<OpportunityOutcomeProjection | null> {
  const result = await db.query<OpportunityOutcomeProjection>(
     `SELECT
       commercial_stage AS "commercialStage",
       current_stage AS "currentStage",
       workflow_state AS "workflowState",
       snoozed_until::TEXT AS "snoozedUntil",
       last_event_id::TEXT AS "lastEventId",
       last_event_at::TEXT AS "lastEventAt",
       last_stage_event_id::TEXT AS "lastStageEventId",
       last_stage_event_at::TEXT AS "lastStageEventAt",
       first_shown_at::TEXT AS "firstShownAt",
       first_opened_at::TEXT AS "firstOpenedAt",
       accepted_at::TEXT AS "acceptedAt",
       contacted_at::TEXT AS "contactedAt",
       replied_at::TEXT AS "repliedAt",
       meeting_at::TEXT AS "meetingAt",
       proposal_at::TEXT AS "proposalAt",
       won_at::TEXT AS "wonAt",
       lost_at::TEXT AS "lostAt",
       dismiss_reason_code AS "dismissReasonCode",
       lost_reason_code AS "lostReasonCode",
       deal_value_minor::DOUBLE PRECISION AS "dealValueMinor",
       currency,
       meeting_status AS "meetingStatus",
       active_meeting_event_id::TEXT AS "activeMeetingEventId",
       last_meeting_event_at::TEXT AS "lastMeetingEventAt",
       meeting_attempt_count AS "meetingAttemptCount"
     FROM opportunity_outcome_state
     WHERE owner_id = $1 AND opportunity_id = $2`,
    [ownerId, opportunityId],
  )
  return result.rows[0] ?? null
}

function toPublicOutcomeState(
  state: OpportunityOutcomeProjection,
): PublicOutcomeState {
  const {
    lastEventId: _lastEventId,
    lastStageEventId: _lastStageEventId,
    activeMeetingEventId: _activeMeetingEventId,
    ...publicState
  } = state
  return publicState
}

async function persistOutcomeState(
  context: OutcomeOpportunityContext,
  state: OpportunityOutcomeProjection,
  db: OutcomeDb,
): Promise<void> {
  const result = await db.query(
    `INSERT INTO opportunity_outcome_state (
       owner_id,
       client_profile_id,
       opportunity_id,
       hiring_episode_id,
       organization_id,
       current_stage,
       commercial_stage,
       workflow_state,
       snoozed_until,
       last_event_id,
       last_event_at,
       last_stage_event_id,
       last_stage_event_at,
       first_shown_at,
       first_opened_at,
       accepted_at,
       contacted_at,
       replied_at,
       meeting_at,
       proposal_at,
       won_at,
       lost_at,
       dismiss_reason_code,
       lost_reason_code,
       deal_value_minor,
       currency,
       meeting_status,
       active_meeting_event_id,
       last_meeting_event_at,
       meeting_attempt_count,
       updated_at
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz,
       $10, $11::timestamptz, $12, $13::timestamptz,
       $14::timestamptz, $15::timestamptz, $16::timestamptz,
       $17::timestamptz, $18::timestamptz, $19::timestamptz,
       $20::timestamptz, $21::timestamptz, $22::timestamptz,
       $23, $24, $25, $26, $27, $28, $29::timestamptz, $30, NOW()
     )
     ON CONFLICT (owner_id, opportunity_id)
     DO UPDATE SET
       client_profile_id = EXCLUDED.client_profile_id,
       hiring_episode_id = EXCLUDED.hiring_episode_id,
       organization_id = EXCLUDED.organization_id,
       current_stage = EXCLUDED.current_stage,
       commercial_stage = EXCLUDED.commercial_stage,
       workflow_state = EXCLUDED.workflow_state,
       snoozed_until = EXCLUDED.snoozed_until,
       last_event_id = EXCLUDED.last_event_id,
       last_event_at = EXCLUDED.last_event_at,
       last_stage_event_id = EXCLUDED.last_stage_event_id,
       last_stage_event_at = EXCLUDED.last_stage_event_at,
       first_shown_at = EXCLUDED.first_shown_at,
       first_opened_at = EXCLUDED.first_opened_at,
       accepted_at = EXCLUDED.accepted_at,
       contacted_at = EXCLUDED.contacted_at,
       replied_at = EXCLUDED.replied_at,
       meeting_at = EXCLUDED.meeting_at,
       proposal_at = EXCLUDED.proposal_at,
       won_at = EXCLUDED.won_at,
       lost_at = EXCLUDED.lost_at,
       dismiss_reason_code = EXCLUDED.dismiss_reason_code,
       lost_reason_code = EXCLUDED.lost_reason_code,
       deal_value_minor = EXCLUDED.deal_value_minor,
       currency = EXCLUDED.currency,
       meeting_status = EXCLUDED.meeting_status,
       active_meeting_event_id = EXCLUDED.active_meeting_event_id,
       last_meeting_event_at = EXCLUDED.last_meeting_event_at,
       meeting_attempt_count = EXCLUDED.meeting_attempt_count,
       updated_at = NOW()`,
    [
      context.ownerId,
      context.clientProfileId,
      context.id,
      context.hiringEpisodeId,
      context.organizationId,
      state.currentStage,
      state.commercialStage,
      state.workflowState,
      state.snoozedUntil,
      state.lastEventId,
      state.lastEventAt,
      state.lastStageEventId,
      state.lastStageEventAt,
      state.firstShownAt,
      state.firstOpenedAt,
      state.acceptedAt,
      state.contactedAt,
      state.repliedAt,
      state.meetingAt,
      state.proposalAt,
      state.wonAt,
      state.lostAt,
      state.dismissReasonCode,
      state.lostReasonCode,
      state.dealValueMinor,
      state.currency,
      state.meetingStatus,
      state.activeMeetingEventId,
      state.lastMeetingEventAt,
      state.meetingAttemptCount,
    ],
  )
  if (result.rowCount !== 1) {
    throw new Error('Outcome projection update returned no row.')
  }
}

async function persistLegacyCommercialState(
  context: OutcomeOpportunityContext,
  payload: OpportunityOutcomeInput,
  state: OpportunityOutcomeProjection,
  db: OutcomeDb,
): Promise<void> {
  if (
    isObservationalOutcomeEvent(payload.eventType) ||
    ![
      'accepted', 'dismissed', 'snoozed', 'resumed', 'contacted',
      'replied', 'meeting', 'proposal', 'won', 'lost', 'reverted',
    ].includes(payload.eventType)
  ) {
    return
  }
  const legacyStatus = state.workflowState === 'snoozed'
    ? 'snoozed'
    : toLegacyOpportunityStatus(state.commercialStage)
  const updated = await db.query(
    `UPDATE opportunities
     SET
       status = $1,
       snoozed_until = $3::timestamptz,
       updated_at = NOW()
     WHERE id = $2
       AND owner_id = $4
       AND superseded_at IS NULL`,
    [
      legacyStatus,
      context.id,
      state.snoozedUntil,
      context.ownerId,
    ],
  )
  if (updated.rowCount !== 1) {
    throw new Error('Legacy opportunity state update returned no row.')
  }
  if (legacyStatus === 'new' || legacyStatus === 'review') {
    await db.query(
      `DELETE FROM client_episode_state
       WHERE client_profile_id = $1
         AND owner_id = $2
         AND hiring_episode_id = $3`,
      [context.clientProfileId, context.ownerId, context.hiringEpisodeId],
    )
    return
  }
  const episodeState = await db.query(
    `INSERT INTO client_episode_state (
       client_profile_id,
       owner_id,
       hiring_episode_id,
       organization_id,
       status,
       suppressed_until
     )
      VALUES (
       $1, $2, $3, $4, $5, $6::timestamptz
     )
     ON CONFLICT (client_profile_id, hiring_episode_id)
     DO UPDATE SET
       owner_id = EXCLUDED.owner_id,
       organization_id = EXCLUDED.organization_id,
       status = EXCLUDED.status,
       suppressed_until = EXCLUDED.suppressed_until,
       updated_at = NOW()`,
    [
      context.clientProfileId,
      context.ownerId,
      context.hiringEpisodeId,
      context.organizationId,
      legacyStatus,
      state.snoozedUntil,
    ],
  )
  if (episodeState.rowCount !== 1) {
    throw new Error('Legacy episode state update returned no row.')
  }
}

function toLegacyOpportunityStatus(
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

async function getSourceFamilies(
  hiringEpisodeId: string,
  db: OutcomeDb,
): Promise<string[]> {
  const result = await db.query<{ sourceFamilies: string[] }>(
    `SELECT COALESCE(
       ARRAY_AGG(DISTINCT source_family ORDER BY source_family)
         FILTER (WHERE source_family IS NOT NULL),
       ARRAY[]::TEXT[]
     ) AS "sourceFamilies"
     FROM (
       SELECT COALESCE(signal.source, evidence.source) AS source_family
       FROM hiring_episode_evidence link
       LEFT JOIN signals signal ON signal.id = link.signal_id
       LEFT JOIN evidence_items evidence ON evidence.id = link.evidence_id
       WHERE link.hiring_episode_id = $1
     ) families`,
    [hiringEpisodeId],
  )
  return result.rows[0]?.sourceFamilies ?? []
}

function toInitialStage(status: string): OpportunityOutcomeStage | null {
  return OPPORTUNITY_OUTCOME_STAGES.includes(status as OpportunityOutcomeStage)
    ? status as OpportunityOutcomeStage
    : null
}

function normalizeDedupeKey(
  value: string | null | undefined,
  payload: OpportunityOutcomeInput,
): string | null {
  const explicit = normalizeExternalIdentifier(value, 'dedupeKey')
  if (payload.eventType === 'shown') {
    const surface = payload.metadata.surface
    const cycleId = payload.metadata.cycleId
    if (!surface || !cycleId) {
      throw new Error('shown requires surface and cycleId metadata.')
    }
    return explicit ?? `${surface}:${cycleId}`
  }
  if (payload.eventType === 'opened') {
    const interactionId = payload.metadata.interactionId
    if (!interactionId) {
      throw new Error('opened requires interactionId metadata.')
    }
    return explicit ?? interactionId
  }
  return explicit
}

function normalizeExternalIdentifier(
  value: string | null | undefined,
  field: string,
): string | null {
  if (value == null) return null
  const normalized = value.trim()
  if (!normalized || normalized.length > 160) {
    throw new Error(`${field} has an invalid length.`)
  }
  return normalized
}

function scoreBucket(score: number): string {
  const percent = Math.min(Math.max(Math.floor(score * 100), 0), 100)
  if (percent === 100) return '100'
  const lower = Math.floor(percent / 10) * 10
  return `${lower}-${lower + 9}`
}

function supportNeedBucket(score: number): 'low' | 'medium' | 'high' {
  if (score >= 0.7) return 'high'
  if (score >= 0.4) return 'medium'
  return 'low'
}

function medianSql(left: string, right: string, key: string): string {
  const valid = `${left} IS NOT NULL AND ${right} IS NOT NULL AND ${right} >= ${left}`
  return `COUNT(*) FILTER (WHERE ${valid})::TEXT AS "${key}Pairs",
       ROUND((
         PERCENTILE_CONT(0.5) WITHIN GROUP (
           ORDER BY EXTRACT(EPOCH FROM (${right} - ${left}))
         ) FILTER (WHERE ${valid}) / 3600
       )::NUMERIC, 2)::TEXT AS "${key}MedianHours"`
}

function numberValue(value: string | null | undefined): number {
  const number = Number(value ?? 0)
  return Number.isFinite(number) ? number : 0
}

function nullableNumber(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function parseActivityCounts(
  value: string | null | undefined,
): Array<{ eventType: string; eventCount: number; opportunityCount: number }> {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
      const row = entry as Record<string, unknown>
      if (typeof row.eventType !== 'string') return []
      const eventCount = Number(row.eventCount)
      const opportunityCount = Number(row.opportunityCount)
      if (!Number.isFinite(eventCount) || !Number.isFinite(opportunityCount)) {
        return []
      }
      return [{
        eventType: row.eventType,
        eventCount,
        opportunityCount,
      }]
    })
  } catch {
    return []
  }
}

function labelActivityCounts(
  activity: ReturnType<typeof parseActivityCounts>,
): OutcomeFunnelSummary['effectiveActivityCounts'] {
  return activity.map((item) => ({
    ...item,
    label: OUTCOME_EVENT_LABELS[
      item.eventType as OpportunityOutcomeInput['eventType']
    ] ?? item.eventType,
  }))
}

function daysBetween(from: string, to: string): number {
  const milliseconds = Date.parse(to) - Date.parse(from)
  if (!Number.isFinite(milliseconds)) return 0
  return Math.max(0, Math.floor(milliseconds / (24 * 60 * 60 * 1000)))
}

function terminalOutcomeSummary(
  won: number,
  lost: number,
  minimumSample: number,
): OutcomeFunnelSummary['terminalOutcomes'] {
  const completed = won + lost
  const ready = completed >= minimumSample
  return {
    won,
    lost,
    completed,
    winRate: ready && completed > 0
      ? Number((won / completed).toFixed(4))
      : null,
    status: ready ? 'ready' : 'insufficient_data',
    denominator: 'effective_won_plus_lost',
  }
}
