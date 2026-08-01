/** @jest-environment node */

import { NextRequest } from 'next/server'

jest.mock('@/lib/opportunities/authorization', () => ({
  getOpportunityAuthorizationContext: jest.fn(),
  getOpportunityDataAccessContext: jest.fn(),
}))
jest.mock('@/lib/opportunities/outcome-analytics-v2', () => ({
  getOutcomeAnalyticsV2Summary: jest.fn(),
}))

import { GET } from '@/app/api/opportunities/outcomes/analytics/route'
import {
  getOpportunityAuthorizationContext,
  getOpportunityDataAccessContext,
} from '@/lib/opportunities/authorization'
import { getOutcomeAnalyticsV2Summary } from '@/lib/opportunities/outcome-analytics-v2'

const mockedAuthorization = jest.mocked(getOpportunityAuthorizationContext)
const mockedAccess = jest.mocked(getOpportunityDataAccessContext)
const mockedSummary = jest.mocked(getOutcomeAnalyticsV2Summary)

describe('Outcome Analytics v2 route', () => {
  const previous = {
    engine: process.env.OPPORTUNITY_ENGINE_V1_ENABLED,
    outcomes: process.env.OPPORTUNITY_OUTCOMES_ENABLED,
    workspace: process.env.OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED,
    analytics: process.env.OPPORTUNITY_ANALYTICS_V2_ENABLED,
  }

  beforeEach(() => {
    process.env.OPPORTUNITY_ENGINE_V1_ENABLED = 'true'
    process.env.OPPORTUNITY_OUTCOMES_ENABLED = 'true'
    process.env.OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED = 'true'
    process.env.OPPORTUNITY_ANALYTICS_V2_ENABLED = 'true'
    jest.clearAllMocks()
    mockedAuthorization.mockResolvedValue({
      dataOwnerId: '7', workspaceId: '9', actorUserId: '42',
      actorRole: 'recruiter', permissions: ['opportunities:read'],
      authMode: 'auth_v2',
    })
    mockedAccess.mockReturnValue({
      ownerId: '7', workspaceId: '9', actorUserId: '42',
      actorWorkspaceId: '9', actorRoleSnapshot: 'recruiter',
      authMode: 'auth_v2',
    })
    mockedSummary.mockResolvedValue({
      period: { from: '2026-07-01T00:00:00.000Z', to: '2026-08-01T00:00:00.000Z' },
      cohort: {
        eventType: 'contacted',
        policy: 'first_effective_event_ever_closed_window',
        downstreamBefore: '2026-08-01T00:00:00.000Z',
        size: 0, cohortAgeDays: 0, observationWindowDays: 0,
        matured: false, maturityThresholdDays: 30,
      },
      minimumConversionSample: 10,
      conversions: [],
      terminalOutcomes: {
        won: 0, lost: 0, completed: 0, winRate: null,
        status: 'insufficient_data', sampleStatus: 'insufficient_data',
        maturityStatus: 'immature', denominator: 'effective_won_plus_lost',
      },
      reasons: [],
      confirmedRevenue: {
        currency: 'RUB', confirmedValueMinor: '0',
        wonWithConfirmedValue: 0, wonWithoutConfirmedValue: 0,
        valuePolicy: 'effective_won_confirmed_rub_only',
      },
    })
  })

  afterAll(() => {
    restore('OPPORTUNITY_ENGINE_V1_ENABLED', previous.engine)
    restore('OPPORTUNITY_OUTCOMES_ENABLED', previous.outcomes)
    restore('OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED', previous.workspace)
    restore('OPPORTUNITY_ANALYTICS_V2_ENABLED', previous.analytics)
  })

  it('passes only validated event-time and cohort dimensions to one workspace', async () => {
    const response = await GET(request(
      '?from=2026-07-01T00:00:00.000Z&to=2026-08-01T00:00:00.000Z' +
      '&cohort=contacted&channel=email&contactPathType=corporate_email' +
      '&assignedUserId=unknown&agencyDnaVersion=dna-v2' +
      '&clientProfileId=8&matchedRoleFamily=backend&maturityDays=45',
    ))

    expect(response.status).toBe(200)
    expect(mockedAuthorization).toHaveBeenCalledWith('opportunities:read')
    expect(mockedSummary).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: '7', workspaceId: '9', cohort: 'contacted',
      channel: 'email', contactPathType: 'corporate_email',
      assignedUserId: 'unknown', agencyDnaVersion: 'dna-v2',
      clientProfileId: '8', matchedRoleFamily: 'backend', maturityDays: 45,
    }))
  })

  it('rejects biased or malformed filters before querying the ledger', async () => {
    const biased = await GET(request('?cohort=accepted&channel=email'))
    const badAssignee = await GET(request('?assignedUserId=7%2C8'))
    const oversizedAssignee = await GET(request(
      '?assignedUserId=9999999999999999999',
    ))
    const badPeriod = await GET(request('?from=never'))

    expect(biased.status).toBe(400)
    expect(badAssignee.status).toBe(400)
    expect(oversizedAssignee.status).toBe(400)
    expect(badPeriod.status).toBe(400)
    expect(mockedSummary).not.toHaveBeenCalled()
  })

  it('is undiscoverable while disabled or without exact Auth v2 workspace access', async () => {
    process.env.OPPORTUNITY_ANALYTICS_V2_ENABLED = 'false'
    expect((await GET(request(''))).status).toBe(404)

    process.env.OPPORTUNITY_ANALYTICS_V2_ENABLED = 'true'
    mockedAccess.mockReturnValueOnce({
      ownerId: '7', workspaceId: null, actorUserId: '7',
      actorWorkspaceId: null, actorRoleSnapshot: null, authMode: 'legacy',
    })
    expect((await GET(request(''))).status).toBe(404)
    expect(mockedSummary).not.toHaveBeenCalled()
  })
})

function request(search: string) {
  return new NextRequest(
    `https://recruiter-radar.ru/api/opportunities/outcomes/analytics${search}`,
  )
}

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
