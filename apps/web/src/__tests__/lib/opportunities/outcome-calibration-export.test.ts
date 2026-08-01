import {
  OutcomeCalibrationExportLimitError,
  getOutcomeCalibrationDataset,
  outcomeCalibrationToCsv,
  type OutcomeCalibrationRecord,
} from '@/lib/opportunities/outcome-calibration-export'
import type { OpportunityAnalyticsCohort } from '@/lib/opportunities/analytics-cohort'

const INPUT = {
  ownerId: '7', workspaceId: '9',
  from: '2026-07-01T00:00:00.000Z',
  to: '2026-08-15T00:00:00.000Z',
  cohort: 'shown' as const,
  maturityDays: 30,
}

const SNAPSHOT = {
  clientProfileId: '8', clientProfileVersion: 'profile-v2',
  agencyDnaVersion: 'dna-v2', hiringMode: 'specialist',
  specialization: 'IT recruitment', matchedRoleFamilies: ['backend'],
  matchedIndustries: ['it'], matchedRegions: ['moscow'],
  organizationSizeBucket: 'medium', episodeType: 'vacancy_spike',
  confidenceGate: 'A', scoreBucket: '80-89',
  externalSupportNeedBucket: 'high', sourceFamilies: ['hh'],
  scoringVersion: 'opportunity-v2',
} satisfies OpportunityAnalyticsCohort

const RECORD: OutcomeCalibrationRecord = {
  opportunityReference: '11111111-1111-4111-8111-111111111111',
  cohortAt: '2026-07-01T00:00:00.000Z',
  clientProfileVersion: SNAPSHOT.clientProfileVersion,
  agencyDnaVersion: SNAPSHOT.agencyDnaVersion,
  hiringMode: SNAPSHOT.hiringMode,
  matchedRoleFamilies: ['\n=HYPERLINK("https://bad.invalid")'],
  matchedIndustries: SNAPSHOT.matchedIndustries,
  matchedRegions: SNAPSHOT.matchedRegions,
  organizationSizeBucket: SNAPSHOT.organizationSizeBucket,
  episodeType: SNAPSHOT.episodeType,
  confidenceGate: SNAPSHOT.confidenceGate,
  scoreBucket: SNAPSHOT.scoreBucket,
  externalSupportNeedBucket: SNAPSHOT.externalSupportNeedBucket,
  sourceFamilies: SNAPSHOT.sourceFamilies,
  scoringVersion: SNAPSHOT.scoringVersion,
  cohortChannel: 'email', cohortContactPathType: 'corporate_email',
  shownAt: '2026-07-01T00:00:00.000Z', openedAt: null,
  acceptedAt: '2026-07-02T00:00:00.000Z',
  contactedAt: '2026-07-03T00:00:00.000Z', repliedAt: null,
  meetingAt: null, proposalAt: null, wonAt: null, lostAt: null,
  terminalStatus: 'open', terminalReasonCode: null,
  maturityStatus: 'mature', sampleStatus: 'ready',
  confirmedRevenueMinor: null,
}

describe('Outcome calibration export', () => {
  it('maps only allowlisted cohort facts from effective workspace events', async () => {
    const query = jest.fn(async (_sql: string, _params: unknown[]) => ({
      rowCount: 1,
      rows: [{
        opportunityReference: RECORD.opportunityReference,
        cohortAt: RECORD.cohortAt,
        cohortSnapshot: SNAPSHOT,
        cohortChannel: 'email', cohortContactPathType: 'corporate_email',
        shownAt: RECORD.shownAt, openedAt: null, acceptedAt: RECORD.acceptedAt,
        contactedAt: RECORD.contactedAt, repliedAt: null, meetingAt: null,
        proposalAt: null, wonAt: null, lostAt: null,
        terminalStatus: 'open', terminalReasonCode: null,
        confirmedRevenueMinor: null, cohortSize: '12',
      }],
    }))

    const rows = await getOutcomeCalibrationDataset(INPUT, { query } as never)
    const [sql, params] = query.mock.calls[0] ?? []

    expect(String(sql)).toContain('scoped_opportunity.workspace_id = $2')
    expect(String(sql)).toContain("correction.event_type = 'reverted'")
    expect(params.at(-1)).toBe(5001)
    expect(rows).toEqual([{
      ...RECORD,
      matchedRoleFamilies: ['backend'],
    }])
    expect(rows[0]).not.toHaveProperty('assignedUserId')
    expect(rows[0]).not.toHaveProperty('ownerId')
    expect(rows[0]).not.toHaveProperty('workspaceId')
    expect(rows[0]).not.toHaveProperty('clientProfileId')
    expect(rows[0]).not.toHaveProperty('specialization')
  })

  it('emits deterministic formula-safe CSV with no forbidden columns', () => {
    const csv = outcomeCalibrationToCsv([RECORD])
    const header = csv.slice(1).split('\r\n')[0]

    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain(`"'\n=HYPERLINK(""https://bad.invalid"")"`)
    expect(header).toContain('opportunityReference,cohortAt')
    expect(header).not.toMatch(
      /ownerId|workspaceId|assignedUser|clientProfileId|specialization|organizationName|email|reasonNote|metadata|evidenceUrl/i,
    )
  })

  it('refuses to silently truncate a cohort over 5,000 rows', async () => {
    const query = jest.fn(async (_sql: string, _params: unknown[]) => ({
      rowCount: 5001,
      rows: Array.from({ length: 5001 }, () => ({
        opportunityReference: RECORD.opportunityReference,
        cohortAt: RECORD.cohortAt,
        cohortSnapshot: SNAPSHOT,
        cohortChannel: null, cohortContactPathType: null,
        shownAt: RECORD.shownAt, openedAt: null, acceptedAt: null,
        contactedAt: null, repliedAt: null, meetingAt: null,
        proposalAt: null, wonAt: null, lostAt: null,
        terminalStatus: 'open', terminalReasonCode: null,
        confirmedRevenueMinor: null, cohortSize: '5001',
      })),
    }))

    await expect(getOutcomeCalibrationDataset(INPUT, { query } as never))
      .rejects.toBeInstanceOf(OutcomeCalibrationExportLimitError)
  })
})
