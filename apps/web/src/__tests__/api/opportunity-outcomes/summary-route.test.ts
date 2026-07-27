/** @jest-environment node */

import { NextRequest } from 'next/server'

jest.mock('@/lib/session', () => ({
  getOwnerIdFromSession: jest.fn(),
}))
jest.mock('@/lib/opportunities/outcome-repository', () => ({
  getOutcomeFunnelSummary: jest.fn(),
}))

import { GET } from '@/app/api/opportunities/outcomes/summary/route'
import { getOutcomeFunnelSummary } from '@/lib/opportunities/outcome-repository'
import { getOwnerIdFromSession } from '@/lib/session'

const mockedOwner = jest.mocked(getOwnerIdFromSession)
const mockedSummary = jest.mocked(getOutcomeFunnelSummary)

describe('opportunity outcome summary API', () => {
  const originalEngine = process.env.OPPORTUNITY_ENGINE_V1_ENABLED
  const originalOutcomes = process.env.OPPORTUNITY_OUTCOMES_ENABLED

  beforeEach(() => {
    process.env.OPPORTUNITY_ENGINE_V1_ENABLED = 'true'
    process.env.OPPORTUNITY_OUTCOMES_ENABLED = 'true'
    mockedOwner.mockResolvedValue('7')
    mockedSummary.mockResolvedValue({
      period: {
        from: '2026-07-01T00:00:00.000Z',
        to: '2026-07-27T00:00:00.000Z',
      },
      cohort: {
        eventType: 'shown',
        policy: 'first_event_in_period_closed_window',
        downstreamBefore: '2026-07-27T00:00:00.000Z',
        size: 0,
      },
      minimumConversionSample: 10,
      activityCounts: [],
      cohortCounts: [],
      conversions: [],
      terminalOutcomes: {
        won: 0,
        lost: 0,
        completed: 0,
        winRate: null,
        status: 'insufficient_data',
      },
    })
    jest.clearAllMocks()
  })

  afterAll(() => {
    restore('OPPORTUNITY_ENGINE_V1_ENABLED', originalEngine)
    restore('OPPORTUNITY_OUTCOMES_ENABLED', originalOutcomes)
  })

  it('is tenant scoped and passes only controlled filters', async () => {
    const response = await GET(request(
      '?from=2026-07-01T00:00:00.000Z&to=2026-07-27T00:00:00.000Z' +
      '&episodeType=vacancy_spike&confidenceGate=A&sourceFamily=hh&scoreBucket=80-89',
    ))

    expect(response.status).toBe(200)
    expect(mockedSummary).toHaveBeenCalledWith({
      ownerId: '7',
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-27T00:00:00.000Z',
      episodeType: 'vacancy_spike',
      confidenceGate: 'A',
      sourceFamily: 'hh',
      scoreBucket: '80-89',
      cohort: 'shown',
    })
  })

  it('rejects malformed periods and filters before querying analytics', async () => {
    const malformedPeriod = await GET(request('?from=never'))
    const broadPeriod = await GET(request(
      '?from=2024-01-01T00:00:00.000Z&to=2026-01-02T00:00:00.000Z',
    ))
    const invalidFilter = await GET(request('?sourceFamily=hh%20OR%201=1'))

    expect(malformedPeriod.status).toBe(400)
    expect(broadPeriod.status).toBe(400)
    expect(invalidFilter.status).toBe(400)
    expect(mockedSummary).not.toHaveBeenCalled()
  })

  it('does not expose analytics while the ledger flag is disabled', async () => {
    process.env.OPPORTUNITY_OUTCOMES_ENABLED = 'false'
    const response = await GET(request(''))
    expect(response.status).toBe(404)
    expect(mockedSummary).not.toHaveBeenCalled()
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
