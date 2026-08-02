import { getOutcomeAnalyticsV2Summary } from '@/lib/opportunities/outcome-analytics-v2'

const BASE_INPUT = {
  ownerId: '7',
  workspaceId: '9',
  from: '2026-07-01T00:00:00.000Z',
  to: '2026-08-15T00:00:00.000Z',
  cohort: 'shown' as const,
  maturityDays: 30,
}

const BASE_ROW = {
  cohortSize: '20',
  cohortFirstAt: '2026-07-01T00:00:00.000Z',
  cohortLastAt: '2026-07-10T00:00:00.000Z',
  shownCohortCount: '20',
  openedCohortCount: '16',
  acceptedCohortCount: '12',
  contactedCohortCount: '10',
  repliedCohortCount: '8',
  meetingCohortCount: '6',
  proposalCohortCount: '4',
  wonCohortCount: '2',
  lostCohortCount: '3',
  shownOpenedPairs: '16', shownOpenedMedianHours: '2.5',
  openedAcceptedPairs: '12', openedAcceptedMedianHours: '5',
  acceptedContactedPairs: '10', acceptedContactedMedianHours: '12',
  contactedRepliedPairs: '8', contactedRepliedMedianHours: '24',
  repliedMeetingPairs: '6', repliedMeetingMedianHours: '36',
  meetingProposalPairs: '4', meetingProposalMedianHours: '48',
  proposalWonPairs: '2', proposalWonMedianHours: null,
  contactedLostPairs: '3', contactedLostMedianHours: '72',
  repliedLostPairs: '3', repliedLostMedianHours: '48',
  meetingLostPairs: '2', meetingLostMedianHours: null,
  proposalLostPairs: '1', proposalLostMedianHours: null,
  reasonCounts: JSON.stringify([
    { eventType: 'lost', reasonCode: 'price', count: '2' },
    { eventType: 'dismissed', reasonCode: 'bad_fit', count: '1' },
  ]),
  wonWithConfirmedValue: '1',
  wonWithoutConfirmedValue: '1',
  confirmedRevenueMinor: '250000',
}

describe('Outcome Analytics v2 repository', () => {
  it('scopes effective cohorts to one workspace and reports mature facts', async () => {
    const query = jest.fn(async (_sql: string, _params: unknown[]) => ({
      rows: [BASE_ROW],
      rowCount: 1,
    }))

    const result = await getOutcomeAnalyticsV2Summary({
      ...BASE_INPUT,
      agencyDnaVersion: 'dna-v2',
      matchedRoleFamily: 'backend',
      channel: 'email',
      contactPathType: 'corporate_email',
      assignedUserId: '42',
      cohort: 'contacted',
    }, { query } as never)

    const [sql, params] = query.mock.calls[0] ?? []
    expect(String(sql)).toContain('scoped_opportunity.workspace_id = $2')
    expect(String(sql)).toContain("correction.event_type = 'reverted'")
    expect(String(sql)).toContain('cohort_snapshot->>\'agencyDnaVersion\'')
    expect(String(sql)).toContain('cohort_channel')
    expect(String(sql)).toContain('cohort_assigned_user_id')
    expect(params).toEqual(expect.arrayContaining([
      '7', '9', 'dna-v2', 'backend', 'email', 'corporate_email', '42',
    ]))

    expect(result.cohort).toMatchObject({
      eventType: 'contacted',
      size: 20,
      matured: true,
    })
    expect(result.conversions[0]).toMatchObject({
      from: 'contacted',
      to: 'replied',
      sampleSize: 10,
      converted: 8,
      rate: 0.8,
      status: 'ready',
    })
    expect(result.terminalOutcomes).toMatchObject({
      won: 2,
      lost: 3,
      completed: 5,
      winRate: null,
      sampleStatus: 'insufficient_data',
      maturityStatus: 'mature',
    })
    expect(result.reasons).toEqual([
      { eventType: 'dismissed', reasonCode: 'bad_fit', label: expect.any(String), count: 1 },
      { eventType: 'lost', reasonCode: 'price', label: expect.any(String), count: 2 },
    ])
    expect(result.confirmedRevenue).toEqual({
      currency: 'RUB',
      confirmedValueMinor: '250000',
      wonWithConfirmedValue: 1,
      wonWithoutConfirmedValue: 1,
      valuePolicy: 'effective_won_confirmed_rub_only',
    })
    expect(result).not.toHaveProperty('revenueForecast')
  })

  it('hides rates for an immature cohort even when the sample is sufficient', async () => {
    const query = jest.fn(async (_sql: string, _params: unknown[]) => ({
      rows: [{
        ...BASE_ROW,
        cohortLastAt: '2026-08-01T00:00:00.000Z',
        wonCohortCount: '8',
        lostCohortCount: '4',
      }],
      rowCount: 1,
    }))

    const result = await getOutcomeAnalyticsV2Summary(BASE_INPUT, {
      query,
    } as never)

    expect(result.cohort.matured).toBe(false)
    expect(result.conversions[0]).toMatchObject({
      sampleStatus: 'ready',
      maturityStatus: 'immature',
      status: 'immature',
      rate: null,
    })
    expect(result.terminalOutcomes).toMatchObject({
      sampleStatus: 'ready',
      maturityStatus: 'immature',
      status: 'immature',
      winRate: null,
    })
  })
})
