import type { PoolClient } from 'pg'

import { getClient, getPool } from '@/lib/db-pool'
import { logEvent } from '@/lib/runtime'
import {
  getNextOutcomeStage,
  hashOutcomePayload,
  isOutcomeTransitionAllowed,
  OPPORTUNITY_OUTCOME_STAGES,
  OUTCOME_EVENT_LABELS,
  OUTCOME_REASON_LABELS,
  type OpportunityOutcomeInput,
  type OpportunityOutcomeProjection,
  type OpportunityOutcomeReasonCode,
  type OpportunityOutcomeStage,
  reduceOutcomeProjection,
  validateOutcomeInput,
} from './outcome-domain'

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

interface OutcomeOpportunityContext {
  id: string
  ownerId: string
  clientProfileId: string
  organizationId: string
  hiringEpisodeId: string
  status: string
  supersededAt: string | null
  scoringVersion: string
  confidenceGate: string
  opportunityScore: number
  externalSupportNeedScore: number
  episodeType: string
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
  actorType: OutcomeActorType
  reason: { code: string; label: string; note: string | null } | null
  channel: OpportunityOutcomeInput['channel']
  contactPathType: OpportunityOutcomeInput['contactPathType']
  valueMinor: number | null
  currency: 'RUB' | null
  metadata: Record<string, string>
}

export type PublicOutcomeState = Omit<
  OpportunityOutcomeProjection,
  'lastEventId'
>

export interface OutcomeHistoryResult {
  events: PublicOutcomeHistoryEvent[]
  state: PublicOutcomeState | null
  pagination: {
    page: number
    pageSize: number
    totalItems: number
    totalPages: number
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
}

export interface OutcomeFunnelSummary {
  period: { from: string; to: string }
  minimumConversionSample: number
  stages: Array<{ eventType: string; label: string; count: number }>
  conversions: Array<{
    from: string
    to: string
    sampleSize: number
    converted: number
    rate: number | null
    medianHours: number | null
    status: 'ready' | 'insufficient_data'
  }>
}

export interface RecordOpportunityOutcomeInput {
  ownerId: string | number
  opportunityId: string | number
  actorType: OutcomeActorType
  actorUserId?: string | number | null
  payload: unknown
  externalSystem?: string | null
  externalEventId?: string | null
  dedupeKey?: string | null
  snoozeDays?: number
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
    page?: number
    pageSize?: number
  },
  db: OutcomeDb | null = getPool(),
): Promise<OutcomeHistoryResult | null> {
  if (!db) throw new Error('DATABASE_URL is not set.')
  const pageSize = Math.min(Math.max(Math.trunc(input.pageSize ?? 50), 1), 100)
  const page = Math.max(Math.trunc(input.page ?? 1), 1)
  const offset = (page - 1) * pageSize
  const ownerId = String(input.ownerId)
  const opportunityId = String(input.opportunityId)
  const available = await db.query(
    `SELECT 1
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
    eventType: OpportunityOutcomeInput['eventType']
    previousStage: OpportunityOutcomeStage
    newStage: OpportunityOutcomeStage
    occurredAt: string
    actorType: OutcomeActorType
    reasonCode: string | null
    reasonNote: string | null
    channel: OpportunityOutcomeInput['channel']
    contactPathType: OpportunityOutcomeInput['contactPathType']
    valueMinor: number | null
    currency: 'RUB' | null
    metadata: Record<string, string>
  }>(
    `SELECT
       event_type AS "eventType",
       previous_stage AS "previousStage",
       new_stage AS "newStage",
       occurred_at::TEXT AS "occurredAt",
       actor_type AS "actorType",
       reason_code AS "reasonCode",
       reason_note AS "reasonNote",
       channel,
       contact_path_type AS "contactPathType",
       value_minor::DOUBLE PRECISION AS "valueMinor",
       currency,
       metadata
     FROM opportunity_outcome_events
     WHERE owner_id = $1 AND opportunity_id = $2
     ORDER BY occurred_at ASC, id ASC
     LIMIT $3 OFFSET $4`,
    [ownerId, opportunityId, pageSize, offset],
  )
  const state = await getOutcomeState(ownerId, opportunityId, db)
  const totalItems = Number(count.rows[0]?.count ?? 0)
  return {
    events: rows.rows.map((event) => ({
      eventType: event.eventType,
      label: OUTCOME_EVENT_LABELS[event.eventType],
      previousStage: event.previousStage,
      newStage: event.newStage,
      occurredAt: event.occurredAt,
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
      valueMinor: event.valueMinor,
      currency: event.currency,
      metadata: event.metadata,
    })),
    state: state ? toPublicOutcomeState(state) : null,
    pagination: {
      page,
      pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / pageSize),
    },
  }
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
  const params: unknown[] = [String(input.ownerId), input.from, input.to]
  const clauses = [
    'owner_id = $1',
    'occurred_at >= $2::timestamptz',
    'occurred_at < $3::timestamptz',
  ]
  if (input.episodeType) {
    params.push(input.episodeType)
    clauses.push(`analytics_snapshot->>'episodeType' = $${params.length}`)
  }
  if (input.confidenceGate) {
    params.push(input.confidenceGate)
    clauses.push(`analytics_snapshot->>'confidenceGate' = $${params.length}`)
  }
  if (input.scoreBucket) {
    params.push(input.scoreBucket)
    clauses.push(`analytics_snapshot->>'scoreBucket' = $${params.length}`)
  }
  if (input.sourceFamily) {
    params.push(input.sourceFamily)
    clauses.push(
      `analytics_snapshot->'sourceFamilies' ? $${params.length}`,
    )
  }

  type FunnelRow = Record<string, string | null>
  const result = await db.query<FunnelRow>(
    `WITH filtered AS (
       SELECT opportunity_id, event_type, occurred_at
       FROM opportunity_outcome_events
       WHERE ${clauses.join('\n         AND ')}
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
       FROM filtered
       GROUP BY opportunity_id
     )
     SELECT
       COUNT(*) FILTER (WHERE shown_at IS NOT NULL)::TEXT AS "shownCount",
       COUNT(*) FILTER (WHERE opened_at IS NOT NULL)::TEXT AS "openedCount",
       COUNT(*) FILTER (WHERE accepted_at IS NOT NULL)::TEXT AS "acceptedCount",
       COUNT(*) FILTER (WHERE contacted_at IS NOT NULL)::TEXT AS "contactedCount",
       COUNT(*) FILTER (WHERE replied_at IS NOT NULL)::TEXT AS "repliedCount",
       COUNT(*) FILTER (WHERE meeting_at IS NOT NULL)::TEXT AS "meetingCount",
       COUNT(*) FILTER (WHERE proposal_at IS NOT NULL)::TEXT AS "proposalCount",
       COUNT(*) FILTER (WHERE won_at IS NOT NULL)::TEXT AS "wonCount",
       COUNT(*) FILTER (WHERE lost_at IS NOT NULL)::TEXT AS "lostCount",
       ${medianSql('shown_at', 'opened_at', 'shownOpened')},
       ${medianSql('opened_at', 'accepted_at', 'openedAccepted')},
       ${medianSql('accepted_at', 'contacted_at', 'acceptedContacted')},
       ${medianSql('contacted_at', 'replied_at', 'contactedReplied')},
       ${medianSql('replied_at', 'meeting_at', 'repliedMeeting')},
       ${medianSql('meeting_at', 'proposal_at', 'meetingProposal')},
       ${medianSql('proposal_at', 'won_at', 'proposalWon')}
     FROM per_opportunity`,
    params,
  )
  const row = result.rows[0] ?? {}
  const counts = Object.fromEntries(
    ['shown', 'opened', 'accepted', 'contacted', 'replied', 'meeting', 'proposal', 'won', 'lost']
      .map((eventType) => [eventType, numberValue(row[`${eventType}Count`])]),
  ) as Record<string, number>
  const pairs = [
    ['shown', 'opened', 'shownOpened'],
    ['opened', 'accepted', 'openedAccepted'],
    ['accepted', 'contacted', 'acceptedContacted'],
    ['contacted', 'replied', 'contactedReplied'],
    ['replied', 'meeting', 'repliedMeeting'],
    ['meeting', 'proposal', 'meetingProposal'],
    ['proposal', 'won', 'proposalWon'],
  ] as const
  const minimumConversionSample = 10
  return {
    period: { from: input.from, to: input.to },
    minimumConversionSample,
    stages: Object.entries(counts).map(([eventType, count]) => ({
      eventType,
      label: OUTCOME_EVENT_LABELS[eventType as OpportunityOutcomeInput['eventType']],
      count,
    })),
    conversions: pairs.map(([from, to, key]) => {
      const sampleSize = counts[from]
      const converted = Math.min(counts[to], sampleSize)
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
        status: ready ? 'ready' : 'insufficient_data',
      }
    }),
  }
}

export async function recordOpportunityOutcomeInTransaction(
  input: RecordOpportunityOutcomeInput,
  db: OutcomeDb,
): Promise<RecordOutcomeResult | null> {
  const payload = validateOutcomeInput(input.payload)
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
  const contextResult = await db.query<OutcomeOpportunityContext>(
    `SELECT
       o.id::TEXT AS id,
       o.owner_id::TEXT AS "ownerId",
       o.client_profile_id::TEXT AS "clientProfileId",
       o.organization_id::TEXT AS "organizationId",
       o.hiring_episode_id::TEXT AS "hiringEpisodeId",
       o.status,
       o.superseded_at::TEXT AS "supersededAt",
       o.scoring_version AS "scoringVersion",
       o.confidence_gate AS "confidenceGate",
       o.opportunity_score AS "opportunityScore",
       o.agency_propensity_score AS "externalSupportNeedScore",
       he.episode_type AS "episodeType"
     FROM opportunities o
     JOIN hiring_episodes he
       ON he.id = o.hiring_episode_id
      AND he.organization_id = o.organization_id
     WHERE o.id = $1
       AND o.owner_id = $2
     FOR UPDATE`,
    [String(input.opportunityId), String(input.ownerId)],
  )
  const context = contextResult.rows[0]
  if (!context) return null
  if (
    input.actorType === 'user' &&
    String(input.actorUserId ?? '') !== context.ownerId
  ) {
    throw new Error('User outcome actor must match the tenant owner.')
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

  const payloadHash = hashOutcomePayload({
    opportunityId: context.id,
    actorType: input.actorType,
    payload,
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

  const lockedState = await getLockedOutcomeState(
    context.ownerId,
    context.id,
    db,
  )
  const previousStage = lockedState?.currentStage ?? toInitialStage(context.status)
  if (!previousStage || !isOutcomeTransitionAllowed(previousStage, payload.eventType)) {
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
  const newStage = getNextOutcomeStage(previousStage, payload.eventType)
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
       external_system,
       external_event_id,
       value_minor,
       currency,
       occurred_at,
       actor_type,
       actor_user_id,
       metadata,
       analytics_snapshot,
       idempotency_key,
       dedupe_key,
       payload_hash
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
       $14, $15, $16, $17, $18::timestamptz, $19, $20, $21::jsonb,
       $22::jsonb, $23, $24, $25
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
      payload.contactReference,
      externalSystem,
      externalEventId,
      payload.valueMinor,
      payload.currency,
      payload.occurredAt,
      input.actorType,
      input.actorUserId == null ? null : String(input.actorUserId),
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
  }
  const state = reduceOutcomeProjection(lockedState, {
    id: event.id,
    eventType: event.eventType,
    previousStage,
    newStage,
    occurredAt: event.occurredAt,
    reasonCode: event.reasonCode,
    valueMinor: event.valueMinor,
    currency: event.currency,
  })
  await persistOutcomeState(context, state, db)
  await persistLegacyCommercialState(context, payload, input.snoozeDays, db)

  return { event, state, idempotent: false }
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
    const interaction = await db.query<{ id: string }>(
      `SELECT id::TEXT AS id
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
       value_minor::DOUBLE PRECISION AS "valueMinor",
       currency,
       metadata
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
       current_stage AS "currentStage",
       last_event_id::TEXT AS "lastEventId",
       last_event_at::TEXT AS "lastEventAt",
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
       currency
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
       current_stage AS "currentStage",
       last_event_id::TEXT AS "lastEventId",
       last_event_at::TEXT AS "lastEventAt",
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
       currency
     FROM opportunity_outcome_state
     WHERE owner_id = $1 AND opportunity_id = $2`,
    [ownerId, opportunityId],
  )
  return result.rows[0] ?? null
}

function toPublicOutcomeState(
  state: OpportunityOutcomeProjection,
): PublicOutcomeState {
  const { lastEventId: _lastEventId, ...publicState } = state
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
       last_event_id,
       last_event_at,
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
       updated_at
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::timestamptz,
       $10::timestamptz, $11::timestamptz, $12::timestamptz,
       $13::timestamptz, $14::timestamptz, $15::timestamptz,
       $16::timestamptz, $17::timestamptz, $18, $19, $20, $21, NOW()
     )
     ON CONFLICT (owner_id, opportunity_id)
     DO UPDATE SET
       client_profile_id = EXCLUDED.client_profile_id,
       hiring_episode_id = EXCLUDED.hiring_episode_id,
       organization_id = EXCLUDED.organization_id,
       current_stage = EXCLUDED.current_stage,
       last_event_id = EXCLUDED.last_event_id,
       last_event_at = EXCLUDED.last_event_at,
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
       updated_at = NOW()`,
    [
      context.ownerId,
      context.clientProfileId,
      context.id,
      context.hiringEpisodeId,
      context.organizationId,
      state.currentStage,
      state.lastEventId,
      state.lastEventAt,
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
    ],
  )
  if (result.rowCount !== 1) {
    throw new Error('Outcome projection update returned no row.')
  }
}

async function persistLegacyCommercialState(
  context: OutcomeOpportunityContext,
  payload: OpportunityOutcomeInput,
  requestedSnoozeDays: number | undefined,
  db: OutcomeDb,
): Promise<void> {
  if (!['accepted', 'dismissed', 'snoozed', 'contacted'].includes(payload.eventType)) {
    return
  }
  const snoozeDays = Math.min(
    Math.max(Math.trunc(requestedSnoozeDays ?? 7), 1),
    90,
  )
  const updated = await db.query(
    `UPDATE opportunities
     SET
       status = $1,
       snoozed_until = CASE
         WHEN $1 = 'snoozed'
           THEN $3::timestamptz + ($4 * INTERVAL '1 day')
         ELSE NULL
       END,
       updated_at = NOW()
     WHERE id = $2
       AND owner_id = $5
       AND superseded_at IS NULL`,
    [
      payload.eventType,
      context.id,
      payload.occurredAt,
      snoozeDays,
      context.ownerId,
    ],
  )
  if (updated.rowCount !== 1) {
    throw new Error('Legacy opportunity state update returned no row.')
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
       $1, $2, $3, $4, $5,
       CASE
         WHEN $5 = 'snoozed'
           THEN $6::timestamptz + ($7 * INTERVAL '1 day')
         ELSE NULL
       END
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
      payload.eventType,
      payload.occurredAt,
      snoozeDays,
    ],
  )
  if (episodeState.rowCount !== 1) {
    throw new Error('Legacy episode state update returned no row.')
  }
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
