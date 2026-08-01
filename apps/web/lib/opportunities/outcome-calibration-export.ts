import type { PoolClient } from 'pg'

import { getPool } from '@/lib/db-pool'
import {
  isCompleteOpportunityAnalyticsCohort,
  type OpportunityAnalyticsCohort,
} from './analytics-cohort'
import {
  buildOutcomeAnalyticsV2Scope,
  type OutcomeAnalyticsV2Filter,
} from './outcome-analytics-v2'
import { OUTCOME_REASON_LABELS } from './outcome-domain'

type CalibrationDb = Pick<PoolClient, 'query'>

export const MAX_OUTCOME_CALIBRATION_RECORDS = 5_000

type PrivacySafeCalibrationCohort = Omit<
  OpportunityAnalyticsCohort,
  'clientProfileId' | 'specialization'
>

export class OutcomeCalibrationExportLimitError extends Error {
  readonly code = 'outcome_calibration_export_too_large'

  constructor() {
    super('Outcome calibration export exceeds the 5,000-row limit.')
    this.name = 'OutcomeCalibrationExportLimitError'
  }
}

export interface OutcomeCalibrationRecord extends PrivacySafeCalibrationCohort {
  opportunityReference: string
  cohortAt: string
  cohortChannel: string | null
  cohortContactPathType: string | null
  shownAt: string | null
  openedAt: string | null
  acceptedAt: string | null
  contactedAt: string | null
  repliedAt: string | null
  meetingAt: string | null
  proposalAt: string | null
  wonAt: string | null
  lostAt: string | null
  terminalStatus: 'open' | 'dismissed' | 'won' | 'lost'
  terminalReasonCode: string | null
  maturityStatus: 'mature' | 'immature'
  sampleStatus: 'ready' | 'insufficient_data'
  confirmedRevenueMinor: string | null
}

interface CalibrationRow {
  opportunityReference: string
  cohortAt: string
  cohortSnapshot: unknown
  cohortChannel: string | null
  cohortContactPathType: string | null
  shownAt: string | null
  openedAt: string | null
  acceptedAt: string | null
  contactedAt: string | null
  repliedAt: string | null
  meetingAt: string | null
  proposalAt: string | null
  wonAt: string | null
  lostAt: string | null
  terminalStatus: string
  terminalReasonCode: string | null
  confirmedRevenueMinor: string | null
  cohortSize: string
}

export async function getOutcomeCalibrationDataset(
  input: OutcomeAnalyticsV2Filter,
  db: CalibrationDb | null = getPool(),
): Promise<OutcomeCalibrationRecord[]> {
  if (!db) throw new Error('DATABASE_URL is not set.')
  const scope = buildOutcomeAnalyticsV2Scope(input)
  const params = [
    ...scope.params,
    MAX_OUTCOME_CALIBRATION_RECORDS + 1,
  ]
  const limitParameter = `$${params.length}`
  const result = await db.query<CalibrationRow>(
    `${scope.cte}, per_opportunity AS (
       SELECT
         event.opportunity_id,
         event.cohort_at,
         event.cohort_snapshot,
         event.cohort_channel,
         event.cohort_contact_path_type,
         MIN(event.occurred_at) FILTER (
           WHERE event.event_type = 'shown'
         )::TEXT AS "shownAt",
         MIN(event.occurred_at) FILTER (
           WHERE event.event_type = 'opened'
         )::TEXT AS "openedAt",
         MIN(event.occurred_at) FILTER (
           WHERE event.event_type = 'accepted'
         )::TEXT AS "acceptedAt",
         MIN(event.occurred_at) FILTER (
           WHERE event.event_type = 'contacted'
         )::TEXT AS "contactedAt",
         MIN(event.occurred_at) FILTER (
           WHERE event.event_type = 'replied'
         )::TEXT AS "repliedAt",
         MIN(event.occurred_at) FILTER (
           WHERE event.event_type = 'meeting'
         )::TEXT AS "meetingAt",
         MIN(event.occurred_at) FILTER (
           WHERE event.event_type = 'proposal'
         )::TEXT AS "proposalAt",
         MIN(event.occurred_at) FILTER (
           WHERE event.event_type = 'won'
         )::TEXT AS "wonAt",
         MIN(event.occurred_at) FILTER (
           WHERE event.event_type = 'lost'
         )::TEXT AS "lostAt",
         CASE
           WHEN BOOL_OR(event.event_type = 'won') THEN 'won'
           WHEN BOOL_OR(event.event_type = 'lost') THEN 'lost'
           WHEN BOOL_OR(event.event_type = 'dismissed') THEN 'dismissed'
           ELSE 'open'
         END AS "terminalStatus",
         MIN(event.reason_code) FILTER (
           WHERE event.event_type IN ('dismissed', 'lost')
         ) AS "terminalReasonCode",
         (MAX(event.value_minor) FILTER (
           WHERE event.event_type = 'won'
             AND event.value_minor IS NOT NULL
             AND event.currency = 'RUB'
         ))::TEXT AS "confirmedRevenueMinor"
       FROM cohort_events event
       GROUP BY
         event.opportunity_id,
         event.cohort_at,
         event.cohort_snapshot,
         event.cohort_channel,
         event.cohort_contact_path_type
     )
     SELECT
       scoped_opportunity.public_reference::TEXT AS "opportunityReference",
       event.cohort_at::TEXT AS "cohortAt",
       event.cohort_snapshot AS "cohortSnapshot",
       event.cohort_channel AS "cohortChannel",
       event.cohort_contact_path_type AS "cohortContactPathType",
       event."shownAt",
       event."openedAt",
       event."acceptedAt",
       event."contactedAt",
       event."repliedAt",
       event."meetingAt",
       event."proposalAt",
       event."wonAt",
       event."lostAt",
       event."terminalStatus",
       event."terminalReasonCode",
       event."confirmedRevenueMinor",
       COUNT(*) OVER ()::TEXT AS "cohortSize"
     FROM per_opportunity event
     JOIN opportunities scoped_opportunity
       ON scoped_opportunity.id = event.opportunity_id
      AND scoped_opportunity.owner_id = $1
      AND scoped_opportunity.workspace_id = $2
     ORDER BY event.cohort_at, scoped_opportunity.public_reference
     LIMIT ${limitParameter}`,
    params,
  )
  if (result.rows.length > MAX_OUTCOME_CALIBRATION_RECORDS) {
    throw new OutcomeCalibrationExportLimitError()
  }
  return result.rows.map((row) => toCalibrationRecord(row, input))
}

const COLUMNS = [
  'opportunityReference',
  'cohortAt',
  'clientProfileVersion',
  'agencyDnaVersion',
  'hiringMode',
  'matchedRoleFamilies',
  'matchedIndustries',
  'matchedRegions',
  'organizationSizeBucket',
  'episodeType',
  'confidenceGate',
  'scoreBucket',
  'externalSupportNeedBucket',
  'sourceFamilies',
  'scoringVersion',
  'cohortChannel',
  'cohortContactPathType',
  'shownAt',
  'openedAt',
  'acceptedAt',
  'contactedAt',
  'repliedAt',
  'meetingAt',
  'proposalAt',
  'wonAt',
  'lostAt',
  'terminalStatus',
  'terminalReasonCode',
  'maturityStatus',
  'sampleStatus',
  'confirmedRevenueMinor',
] as const satisfies readonly (keyof OutcomeCalibrationRecord)[]

type CalibrationColumn = (typeof COLUMNS)[number]

export function outcomeCalibrationToCsv(
  records: readonly OutcomeCalibrationRecord[],
): string {
  const lines = [
    COLUMNS.join(','),
    ...records.map((record) => COLUMNS
      .map((column) => csvCell(exportValue(record, column)))
      .join(',')),
  ]
  return `\uFEFF${lines.join('\r\n')}\r\n`
}

function toCalibrationRecord(
  row: CalibrationRow,
  input: OutcomeAnalyticsV2Filter,
): OutcomeCalibrationRecord {
  const snapshot = isCompleteOpportunityAnalyticsCohort(row.cohortSnapshot)
    ? row.cohortSnapshot
    : unknownSnapshot()
  const maturityDays = Math.max(
    1,
    Math.min(365, Math.trunc(input.maturityDays ?? 30)),
  )
  const terminalStatus = isTerminalStatus(row.terminalStatus)
    ? row.terminalStatus
    : 'open'
  const terminalReasonCode = row.terminalReasonCode &&
    OUTCOME_REASON_LABELS[row.terminalReasonCode]
    ? row.terminalReasonCode
    : null
  return {
    opportunityReference: row.opportunityReference,
    cohortAt: row.cohortAt,
    ...toPrivacySafeCalibrationCohort(snapshot),
    cohortChannel: row.cohortChannel,
    cohortContactPathType: row.cohortContactPathType,
    shownAt: row.shownAt,
    openedAt: row.openedAt,
    acceptedAt: row.acceptedAt,
    contactedAt: row.contactedAt,
    repliedAt: row.repliedAt,
    meetingAt: row.meetingAt,
    proposalAt: row.proposalAt,
    wonAt: row.wonAt,
    lostAt: row.lostAt,
    terminalStatus,
    terminalReasonCode,
    maturityStatus: daysBetween(row.cohortAt, input.to) >= maturityDays
      ? 'mature'
      : 'immature',
    sampleStatus: numberValue(row.cohortSize) >= 10
      ? 'ready'
      : 'insufficient_data',
    confirmedRevenueMinor: /^\d+$/.test(row.confirmedRevenueMinor ?? '')
      ? row.confirmedRevenueMinor
      : null,
  }
}

function toPrivacySafeCalibrationCohort(
  snapshot: OpportunityAnalyticsCohort,
): PrivacySafeCalibrationCohort {
  return {
    clientProfileVersion: snapshot.clientProfileVersion,
    agencyDnaVersion: snapshot.agencyDnaVersion,
    hiringMode: snapshot.hiringMode,
    matchedRoleFamilies: snapshot.matchedRoleFamilies,
    matchedIndustries: snapshot.matchedIndustries,
    matchedRegions: snapshot.matchedRegions,
    organizationSizeBucket: snapshot.organizationSizeBucket,
    episodeType: snapshot.episodeType,
    confidenceGate: snapshot.confidenceGate,
    scoreBucket: snapshot.scoreBucket,
    externalSupportNeedBucket: snapshot.externalSupportNeedBucket,
    sourceFamilies: snapshot.sourceFamilies,
    scoringVersion: snapshot.scoringVersion,
  }
}

function unknownSnapshot(): OpportunityAnalyticsCohort {
  return {
    clientProfileId: 'unknown',
    clientProfileVersion: 'unknown',
    agencyDnaVersion: 'unknown',
    hiringMode: 'unknown',
    specialization: null,
    matchedRoleFamilies: [],
    matchedIndustries: [],
    matchedRegions: [],
    organizationSizeBucket: 'unknown',
    episodeType: 'unknown',
    confidenceGate: 'D',
    scoreBucket: 'unknown',
    externalSupportNeedBucket: 'low',
    sourceFamilies: [],
    scoringVersion: 'unknown',
  }
}

function isTerminalStatus(
  value: string,
): value is OutcomeCalibrationRecord['terminalStatus'] {
  return ['open', 'dismissed', 'won', 'lost'].includes(value)
}

function exportValue(
  record: OutcomeCalibrationRecord,
  column: CalibrationColumn,
): string {
  const value = record[column]
  const text = Array.isArray(value) ? value.join(' | ') : String(value ?? '')
  return neutralizeSpreadsheetFormula(text)
}

function neutralizeSpreadsheetFormula(value: string): string {
  return /^[\t\n\v\f\r ]*[=+\-@]/.test(value) ? `'${value}` : value
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function numberValue(value: string | null | undefined): number {
  const number = Number(value ?? 0)
  return Number.isFinite(number) ? number : 0
}

function daysBetween(from: string, to: string): number {
  const milliseconds = Date.parse(to) - Date.parse(from)
  if (!Number.isFinite(milliseconds)) return 0
  return Math.max(0, Math.floor(milliseconds / (24 * 60 * 60 * 1000)))
}
