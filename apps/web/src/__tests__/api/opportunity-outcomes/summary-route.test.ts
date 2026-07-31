/** @jest-environment node */

import { NextRequest } from 'next/server'

jest.mock('@/lib/auth-v2/authorization', () => {
  const getAuthorizedOwnerId = jest.fn()
  return {
    getAuthorizedOwnerId,
    getSession: jest.fn(async ({ permission }) => {
      const ownerId = await getAuthorizedOwnerId(permission)
      return ownerId ? {
        mode: 'legacy',
        userId: ownerId,
        dataOwnerId: ownerId,
        workspaceId: null,
        role: null,
        session: null,
      } : null
    }),
  }
})
jest.mock('@/lib/opportunities/outcome-repository', () => ({
  getOutcomeFunnelSummary: jest.fn(),
}))

import { GET } from '@/app/api/opportunities/outcomes/summary/route'
import { getOutcomeFunnelSummary } from '@/lib/opportunities/outcome-repository'
import { getAuthorizedOwnerId } from '@/lib/auth-v2/authorization'

const mockedOwner = jest.mocked(getAuthorizedOwnerId)
const mockedSummary = jest.mocked(getOutcomeFunnelSummary)

describe('opportunity outcome summary API', () => {
  const originalEngine = process.env.OPPORTUNITY_ENGINE_V1_ENABLED
  const originalOutcomes = process.env.OPPORTUNITY_OUTCOMES_ENABLED
  const originalCanaryOwners = process.env.OPPORTUNITY_CANARY_OWNER_IDS

  beforeEach(() => {
    process.env.OPPORTUNITY_ENGINE_V1_ENABLED = 'true'
    process.env.OPPORTUNITY_OUTCOMES_ENABLED = 'true'
    delete process.env.OPPORTUNITY_CANARY_OWNER_IDS
    mockedOwner.mockResolvedValue('7')
    mockedSummary.mockResolvedValue({
      period: {
        from: '2026-07-01T00:00:00.000Z',
        to: '2026-07-27T00:00:00.000Z',
      },
      cohort: {
        eventType: 'shown',
        policy: 'first_effective_event_ever_closed_window',
        downstreamBefore: '2026-07-27T00:00:00.000Z',
        size: 0,
        cohortAgeDays: 26,
        observationWindowDays: 26,
        matured: false,
        maturityThresholdDays: 30,
      },
      minimumConversionSample: 10,
      effectiveActivityCounts: [],
      ledgerActivityCounts: [],
      correctionsCount: 0,
      cohortCounts: [],
      conversions: [],
      terminalOutcomes: {
        won: 0,
        lost: 0,
        completed: 0,
        winRate: null,
        status: 'insufficient_data',
        denominator: 'effective_won_plus_lost',
      },
    })
    jest.clearAllMocks()
  })

  afterAll(() => {
    restore('OPPORTUNITY_ENGINE_V1_ENABLED', originalEngine)
    restore('OPPORTUNITY_OUTCOMES_ENABLED', originalOutcomes)
    restore('OPPORTUNITY_CANARY_OWNER_IDS', originalCanaryOwners)
  })

  it('is tenant scoped and passes only controlled filters', async () => {
    const response = await GET(request(
      '?from=2026-07-01T00:00:00.000Z&to=2026-07-27T00:00:00.000Z' +
      '&episodeType=vacancy_spike&confidenceGate=A&sourceFamily=hh&scoreBucket=80-89' +
      '&externalSupportNeedBucket=high&maturityDays=45',
    ))

    expect(response.status).toBe(200)
    expect(mockedSummary).toHaveBeenCalledWith({
      ownerId: '7',
      workspaceId: null,
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-27T00:00:00.000Z',
      episodeType: 'vacancy_spike',
      confidenceGate: 'A',
      sourceFamily: 'hh',
      scoreBucket: '80-89',
      externalSupportNeedBucket: 'high',
      cohort: 'shown',
      maturityDays: 45,
    })
  })

  it('rejects malformed periods and filters before querying analytics', async () => {
    const malformedPeriod = await GET(request('?from=never'))
    const broadPeriod = await GET(request(
      '?from=2024-01-01T00:00:00.000Z&to=2026-01-02T00:00:00.000Z',
    ))
    const invalidFilter = await GET(request('?sourceFamily=hh%20OR%201=1'))
    const invalidMaturity = await GET(request('?maturityDays=0'))

    expect(malformedPeriod.status).toBe(400)
    expect(broadPeriod.status).toBe(400)
    expect(invalidFilter.status).toBe(400)
    expect(invalidMaturity.status).toBe(400)
    expect(mockedSummary).not.toHaveBeenCalled()
  })

  it('does not expose analytics while the ledger flag is disabled', async () => {
    process.env.OPPORTUNITY_OUTCOMES_ENABLED = 'false'
    const response = await GET(request(''))
    expect(response.status).toBe(404)
    expect(mockedSummary).not.toHaveBeenCalled()
  })

  it('exposes analytics only to the configured canary owner', async () => {
    process.env.OPPORTUNITY_ENGINE_V1_ENABLED = 'false'
    process.env.OPPORTUNITY_OUTCOMES_ENABLED = 'false'
    process.env.OPPORTUNITY_CANARY_OWNER_IDS = '7'

    mockedOwner.mockResolvedValueOnce('8')
    const denied = await GET(request(''))
    expect(denied.status).toBe(404)
    expect(mockedSummary).not.toHaveBeenCalled()

    mockedOwner.mockResolvedValueOnce('7')
    const allowed = await GET(request(''))
    expect(allowed.status).toBe(200)
    expect(mockedSummary).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: '7',
    }))
  })
})

function request(search: string) {
  return new NextRequest(
    `https://recruiter-radar.ru/api/opportunities/outcomes/summary${search}`,
  )
}

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
