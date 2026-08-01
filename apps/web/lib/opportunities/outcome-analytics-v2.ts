import type { PoolClient } from 'pg'

import { getPool } from '@/lib/db-pool'
import { OUTCOME_REASON_LABELS } from './outcome-domain'

type AnalyticsDb = Pick<PoolClient, 'query'>

export type OutcomeAnalyticsCohortEvent = 'shown' | 'accepted' | 'contacted'

export interface OutcomeAnalyticsV2Filter {
  ownerId: string | number
  workspaceId: string | number
  from: string
  to: string
  clientProfileId?: string | null
  clientProfileVersion?: string | null
  agencyDnaVersion?: string | null
  hiringMode?: string | null
  specialization?: string | null
  matchedRoleFamily?: string | null
  matchedIndustry?: string | null
  matchedRegion?: string | null
  organizationSizeBucket?: string | null
  episodeType?: string | null
  confidenceGate?: string | null
  sourceFamily?: string | null
  scoreBucket?: string | null
  externalSupportNeedBucket?: 'low' | 'medium' | 'high' | null
  scoringVersion?: string | null
  channel?: string | null
  contactPathType?: string | null
  assignedUserId?: string | null
  cohort?: OutcomeAnalyticsCohortEvent
  maturityDays?: number
}

type ReadinessStatus = 'ready' | 'insufficient_data' | 'immature'

export interface OutcomeAnalyticsV2Summary {
  period: { from: string; to: string }
  cohort: {
    eventType: OutcomeAnalyticsCohortEvent
    policy: 'first_effective_event_ever_closed_window'
    downstreamBefore: string
    size: number
    cohortAgeDays: number
    observationWindowDays: number
    matured: boolean
    maturityThresholdDays: number
  }
  minimumConversionSample: number
  conversions: Array<{
    from: string
    to: string
    sampleSize: number
    converted: number
    rate: number | null
    medianHours: number | null
    status: ReadinessStatus
    sampleStatus: 'ready' | 'insufficient_data'
    maturityStatus: 'mature' | 'immature'
  }>
  terminalOutcomes: {
    won: number
    lost: number
    completed: number
    winRate: number | null
    status: ReadinessStatus
    sampleStatus: 'ready' | 'insufficient_data'
    maturityStatus: 'mature' | 'immature'
    denominator: 'effective_won_plus_lost'
  }
  reasons: Array<{
    eventType: 'dismissed' | 'lost'
    reasonCode: string
    label: string
    count: number
  }>
  confirmedRevenue: {
    currency: 'RUB'
    confirmedValueMinor: string
    wonWithConfirmedValue: number
    wonWithoutConfirmedValue: number
    valuePolicy: 'effective_won_confirmed_rub_only'
  }
}

type AnalyticsRow = Record<string, string | null>

export async function getOutcomeAnalyticsV2Summary(
  input: OutcomeAnalyticsV2Filter,
  db: AnalyticsDb | null = getPool(),
): Promise<OutcomeAnalyticsV2Summary> {
  if (!db) throw new Error('DATABASE_URL is not set.')
  const scope = buildOutcomeAnalyticsV2Scope(input)
  const result = await db.query<AnalyticsRow>(
    `${scope.cte}, per_opportunity AS (
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
     ), reason_counts AS (
       SELECT event_type, reason_code, COUNT(*)::TEXT AS reason_count
       FROM cohort_events
       WHERE event_type IN ('dismissed', 'lost')
         AND reason_code IS NOT NULL
       GROUP BY event_type, reason_code
     )
     SELECT
       (SELECT COUNT(*) FROM cohort)::TEXT AS "cohortSize",
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
       ${medianSql('proposal_at', 'lost_at', 'proposalLost')},
       (SELECT COALESCE(
          JSONB_AGG(
            JSONB_BUILD_OBJECT(
              'eventType', event_type,
              'reasonCode', reason_code,
              'count', reason_count
            ) ORDER BY event_type, reason_code
          ),
          '[]'::jsonb
        )::TEXT FROM reason_counts) AS "reasonCounts",
       (SELECT COUNT(*)::TEXT FROM cohort_events
        WHERE event_type = 'won'
          AND value_minor IS NOT NULL
          AND currency = 'RUB') AS "wonWithConfirmedValue",
       (SELECT COUNT(*)::TEXT FROM cohort_events
        WHERE event_type = 'won'
          AND (value_minor IS NULL OR currency IS DISTINCT FROM 'RUB'))
          AS "wonWithoutConfirmedValue",
       (SELECT COALESCE(SUM(value_minor), 0)::TEXT FROM cohort_events
        WHERE event_type = 'won'
          AND value_minor IS NOT NULL
          AND currency = 'RUB') AS "confirmedRevenueMinor"
     FROM per_opportunity`,
    scope.params,
  )
  return toSummary(input, result.rows[0] ?? {})
}

export interface OutcomeAnalyticsV2SqlScope {
  cte: string
  params: unknown[]
}

export function buildOutcomeAnalyticsV2Scope(
  input: OutcomeAnalyticsV2Filter,
): OutcomeAnalyticsV2SqlScope {
  const cohortEvent = input.cohort ?? 'shown'
  const params: unknown[] = [
    String(input.ownerId),
    String(input.workspaceId),
    input.from,
    input.to,
    cohortEvent,
  ]
  const clauses: string[] = []
  addSnapshotFilter(params, clauses, input.clientProfileId, 'clientProfileId')
  addSnapshotFilter(
    params,
    clauses,
    input.clientProfileVersion,
    'clientProfileVersion',
  )
  addSnapshotFilter(params, clauses, input.agencyDnaVersion, 'agencyDnaVersion')
  addSnapshotFilter(params, clauses, input.hiringMode, 'hiringMode')
  addSnapshotFilter(params, clauses, input.specialization, 'specialization')
  addSnapshotArrayFilter(
    params,
    clauses,
    input.matchedRoleFamily,
    'matchedRoleFamilies',
  )
  addSnapshotArrayFilter(
    params,
    clauses,
    input.matchedIndustry,
    'matchedIndustries',
  )
  addSnapshotArrayFilter(
    params,
    clauses,
    input.matchedRegion,
    'matchedRegions',
  )
  addSnapshotFilter(
    params,
    clauses,
    input.organizationSizeBucket,
    'organizationSizeBucket',
  )
  addSnapshotFilter(params, clauses, input.episodeType, 'episodeType')
  addSnapshotFilter(params, clauses, input.confidenceGate, 'confidenceGate')
  addSnapshotArrayFilter(params, clauses, input.sourceFamily, 'sourceFamilies')
  addSnapshotFilter(params, clauses, input.scoreBucket, 'scoreBucket')
  addSnapshotFilter(
    params,
    clauses,
    input.externalSupportNeedBucket,
    'externalSupportNeedBucket',
  )
  addSnapshotFilter(params, clauses, input.scoringVersion, 'scoringVersion')
  addColumnFilter(params, clauses, input.channel, 'cohort_channel')
  addColumnFilter(
    params,
    clauses,
    input.contactPathType,
    'cohort_contact_path_type',
  )
  if (input.assignedUserId === 'unknown') {
    clauses.push('cohort_assigned_user_id IS NULL')
  } else {
    addColumnFilter(
      params,
      clauses,
      input.assignedUserId,
      'cohort_assigned_user_id',
    )
  }

  return {
    params,
    cte: `WITH scoped_opportunities AS (
       SELECT scoped_opportunity.id
       FROM opportunities scoped_opportunity
       WHERE scoped_opportunity.owner_id = $1
         AND scoped_opportunity.workspace_id = $2
     ), cohort_ranked AS (
       SELECT
         event.opportunity_id,
         event.occurred_at AS cohort_at,
         event.analytics_snapshot AS cohort_snapshot,
         event.channel AS cohort_channel,
         event.contact_path_type AS cohort_contact_path_type,
         event.assigned_user_id AS cohort_assigned_user_id,
         ROW_NUMBER() OVER (
           PARTITION BY event.opportunity_id
           ORDER BY event.occurred_at, event.id
         ) AS cohort_rank
       FROM opportunity_outcome_events event
       JOIN scoped_opportunities scoped_opportunity
         ON scoped_opportunity.id = event.opportunity_id
       WHERE event.owner_id = $1
         AND event.event_type = $5
         AND event.occurred_at < $4::timestamptz
         AND NOT EXISTS (
           SELECT 1
           FROM opportunity_outcome_events correction
           WHERE correction.owner_id = event.owner_id
             AND correction.opportunity_id = event.opportunity_id
             AND correction.event_type = 'reverted'
             AND correction.reverts_event_id = event.id
         )
     ), cohort_candidates AS (
       SELECT
         opportunity_id,
         cohort_at,
         cohort_snapshot,
         cohort_channel,
         cohort_contact_path_type,
         cohort_assigned_user_id
       FROM cohort_ranked
       WHERE cohort_rank = 1
         AND cohort_at >= $3::timestamptz
         AND cohort_at < $4::timestamptz
     ), cohort AS (
       SELECT *
       FROM cohort_candidates
       ${clauses.length > 0 ? `WHERE ${clauses.join('\n         AND ')}` : ''}
     ), cohort_events AS (
       SELECT
         event.*,
         cohort.cohort_at,
         cohort.cohort_snapshot,
         cohort.cohort_channel,
         cohort.cohort_contact_path_type,
         cohort.cohort_assigned_user_id
       FROM cohort
       JOIN opportunity_outcome_events event
         ON event.owner_id = $1
        AND event.opportunity_id = cohort.opportunity_id
       WHERE event.event_type <> 'reverted'
         AND event.occurred_at >= cohort.cohort_at
         AND event.occurred_at < $4::timestamptz
         AND NOT EXISTS (
           SELECT 1
           FROM opportunity_outcome_events correction
           WHERE correction.owner_id = event.owner_id
             AND correction.opportunity_id = event.opportunity_id
             AND correction.event_type = 'reverted'
             AND correction.reverts_event_id = event.id
         )
     )`,
  }
}

function addSnapshotFilter(
  params: unknown[],
  clauses: string[],
  value: string | null | undefined,
  field: string,
) {
  if (!value) return
  params.push(value)
  clauses.push(`cohort_snapshot->>'${field}' = $${params.length}`)
}

function addSnapshotArrayFilter(
  params: unknown[],
  clauses: string[],
  value: string | null | undefined,
  field: string,
) {
  if (!value) return
  params.push(value)
  clauses.push(`cohort_snapshot->'${field}' ? $${params.length}`)
}

function addColumnFilter(
  params: unknown[],
  clauses: string[],
  value: string | null | undefined,
  column: string,
) {
  if (!value) return
  params.push(value)
  clauses.push(`${column} = $${params.length}`)
}

function toSummary(
  input: OutcomeAnalyticsV2Filter,
  row: AnalyticsRow,
): OutcomeAnalyticsV2Summary {
  const cohortEvent = input.cohort ?? 'shown'
  const minimumConversionSample = 10
  const maturityThresholdDays = Math.max(
    1,
    Math.min(365, Math.trunc(input.maturityDays ?? 30)),
  )
  const cohortSize = numberValue(row.cohortSize)
  const cohortFirstAt = row.cohortFirstAt ?? input.from
  const cohortLastAt = row.cohortLastAt ?? cohortFirstAt
  const cohortAgeDays = daysBetween(cohortFirstAt, input.to)
  const observationWindowDays = daysBetween(cohortLastAt, input.to)
  const matured = cohortSize > 0 &&
    observationWindowDays >= maturityThresholdDays
  const counts = Object.fromEntries(
    STAGES.map((eventType) => [
      eventType,
      numberValue(row[`${eventType}CohortCount`]),
    ]),
  ) as Record<(typeof STAGES)[number], number>
  const pairs = cohortEvent === 'shown'
    ? [...DISCOVERY_PAIRS, ...COMMERCIAL_PAIRS]
    : cohortEvent === 'accepted'
      ? COMMERCIAL_PAIRS
      : CONTACTED_PAIRS
  const conversions = pairs.map(([from, to, key]) => {
    const sampleSize = counts[from]
    const converted = numberValue(row[`${key}Pairs`])
    const sampleReady = sampleSize >= minimumConversionSample
    const rateReady = sampleReady && matured
    return {
      from,
      to,
      sampleSize,
      converted,
      rate: rateReady && sampleSize > 0
        ? Number((converted / sampleSize).toFixed(4))
        : null,
      medianHours: converted >= 3
        ? nullableNumber(row[`${key}MedianHours`])
        : null,
      status: readinessStatus(sampleReady, matured),
      sampleStatus: sampleReady ? 'ready' as const : 'insufficient_data' as const,
      maturityStatus: matured ? 'mature' as const : 'immature' as const,
    }
  })
  const won = counts.won
  const lost = counts.lost
  const completed = won + lost
  const terminalSampleReady = completed >= minimumConversionSample
  const terminalReady = terminalSampleReady && matured

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
    conversions,
    terminalOutcomes: {
      won,
      lost,
      completed,
      winRate: terminalReady && completed > 0
        ? Number((won / completed).toFixed(4))
        : null,
      status: readinessStatus(terminalSampleReady, matured),
      sampleStatus: terminalSampleReady ? 'ready' : 'insufficient_data',
      maturityStatus: matured ? 'mature' : 'immature',
      denominator: 'effective_won_plus_lost',
    },
    reasons: parseReasonCounts(row.reasonCounts),
    confirmedRevenue: {
      currency: 'RUB',
      confirmedValueMinor: integerText(row.confirmedRevenueMinor),
      wonWithConfirmedValue: numberValue(row.wonWithConfirmedValue),
      wonWithoutConfirmedValue: numberValue(row.wonWithoutConfirmedValue),
      valuePolicy: 'effective_won_confirmed_rub_only',
    },
  }
}

const STAGES = [
  'shown', 'opened', 'accepted', 'contacted', 'replied', 'meeting',
  'proposal', 'won', 'lost',
] as const

const DISCOVERY_PAIRS = [
  ['shown', 'opened', 'shownOpened'],
  ['opened', 'accepted', 'openedAccepted'],
] as const

const COMMERCIAL_PAIRS = [
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

const CONTACTED_PAIRS = COMMERCIAL_PAIRS.slice(1)

function medianSql(left: string, right: string, key: string): string {
  const valid = `${left} IS NOT NULL AND ${right} IS NOT NULL AND ${right} >= ${left}`
  return `COUNT(*) FILTER (WHERE ${valid})::TEXT AS "${key}Pairs",
       ROUND((
         PERCENTILE_CONT(0.5) WITHIN GROUP (
           ORDER BY EXTRACT(EPOCH FROM (${right} - ${left}))
         ) FILTER (WHERE ${valid}) / 3600
       )::NUMERIC, 2)::TEXT AS "${key}MedianHours"`
}

function readinessStatus(
  sampleReady: boolean,
  matured: boolean,
): ReadinessStatus {
  if (!sampleReady) return 'insufficient_data'
  return matured ? 'ready' : 'immature'
}

function parseReasonCounts(
  value: string | null | undefined,
): OutcomeAnalyticsV2Summary['reasons'] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
      const item = entry as Record<string, unknown>
      if (
        !['dismissed', 'lost'].includes(String(item.eventType)) ||
        typeof item.reasonCode !== 'string'
      ) return []
      const count = Number(item.count)
      if (!Number.isFinite(count) || count < 0) return []
      return [{
        eventType: item.eventType as 'dismissed' | 'lost',
        reasonCode: item.reasonCode,
        label: OUTCOME_REASON_LABELS[item.reasonCode] ?? item.reasonCode,
        count,
      }]
    }).sort((left, right) =>
      left.eventType.localeCompare(right.eventType) ||
      left.reasonCode.localeCompare(right.reasonCode))
  } catch {
    return []
  }
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

function integerText(value: string | null | undefined): string {
  return /^\d+$/.test(value ?? '') ? String(value) : '0'
}

function daysBetween(from: string, to: string): number {
  const milliseconds = Date.parse(to) - Date.parse(from)
  if (!Number.isFinite(milliseconds)) return 0
  return Math.max(0, Math.floor(milliseconds / (24 * 60 * 60 * 1000)))
}
