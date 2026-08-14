import { NextRequest } from 'next/server'

const dbQuery = jest.fn(async () => ({
  rowCount: 1,
  rows: [{ runStateReady: true, profileStateReady: true }],
}))
const claimDailyRadarRun = jest.fn()
const runScheduledSourceRefresh = jest.fn()
const runSourceTemporalIntelligence = jest.fn()
const runDigestForClientProfile = jest.fn()
const deliverCandidatesForRun = jest.fn()

jest.mock('@/lib/db', () => ({
  getPool: () => ({ query: dbQuery }),
}))
jest.mock('@/lib/digest', () => ({
  runDigestForClientProfile: (arg: unknown) => runDigestForClientProfile(arg),
}))
jest.mock('@/lib/digest/deliver-candidates', () => ({
  deliverCandidatesForRun: (runId: unknown) => deliverCandidatesForRun(runId),
}))
jest.mock('@/lib/ai/enrichment/enrichRunCandidates', () => ({ enrichRunCandidates: jest.fn() }))
jest.mock('@/lib/delivery/nextDeliveryHint', () => ({ shouldDeliverOnRun: () => true }))
jest.mock('@/lib/opportunities/commercial-signal-rollout', () => ({
  getCommercialSignalCanaryWorkspaceId: () => null,
  resolveCommercialSignalRollout: () => ({ effectiveMode: 'off' }),
}))
jest.mock('@/lib/daily-radar-run-state', () => ({
  claimDailyRadarRun: () => claimDailyRadarRun(),
  finishDailyRadarRun: jest.fn(),
  recordDailyRadarSourceRefreshResult: jest.fn(),
  recordDailyRadarTemporalResult: jest.fn(),
  heartbeatDailyRadarRun: jest.fn(),
  claimDailyRadarProfile: jest.fn(),
  attachDailyRadarProfileDigestRun: jest.fn(),
  finishDailyRadarProfile: jest.fn(),
  dailyRadarNextRetryAt: jest.fn(),
}))
jest.mock('@/lib/lead-discovery/source-ingest', () => ({
  isNoActiveProfiles: () => false,
  runSourceTemporalIntelligence: () => runSourceTemporalIntelligence(),
}))
jest.mock('@/lib/lead-discovery/scheduled-source-refresh', () => ({
  runScheduledSourceRefresh: () => runScheduledSourceRefresh(),
}))
jest.mock('@/lib/runtime', () => ({ logEvent: jest.fn(), logWarn: jest.fn() }))

import { POST } from '@/app/api/cron/daily-radar/route'

const request = (payload: unknown) => new NextRequest('http://localhost/api/cron/daily-radar', {
  method: 'POST',
  headers: { 'x-api-key': 'cron-test-key', 'content-type': 'application/json' },
  body: JSON.stringify(payload),
})

describe('manual Daily Radar dispatch safety', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.CRON_API_KEY = 'cron-test-key'
  })

  afterAll(() => {
    delete process.env.CRON_API_KEY
  })

  test('verify mode checks runtime and DB readiness without claiming or delivering', async () => {
    const response = await POST(request({ mode: 'verify' }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      mode: 'verify',
      data: { database: 'ready' },
    })
    expect(dbQuery).toHaveBeenCalledTimes(1)
    expect(claimDailyRadarRun).not.toHaveBeenCalled()
    expect(runScheduledSourceRefresh).not.toHaveBeenCalled()
    expect(runSourceTemporalIntelligence).not.toHaveBeenCalled()
    expect(runDigestForClientProfile).not.toHaveBeenCalled()
    expect(deliverCandidatesForRun).not.toHaveBeenCalled()
  })

  test('manual deliver mode fails closed without the exact confirmation', async () => {
    const response = await POST(request({ mode: 'deliver', confirm: 'deliver' }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: 'Manual delivery requires confirm=DELIVER.',
    })
    expect(claimDailyRadarRun).not.toHaveBeenCalled()
  })

  test('verify mode reports a safe unavailable response when the database check fails', async () => {
    dbQuery.mockRejectedValueOnce(new Error('sensitive database detail'))

    const response = await POST(request({ mode: 'verify' }))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      success: false,
      mode: 'verify',
      error: 'Database readiness check failed.',
    })
    expect(claimDailyRadarRun).not.toHaveBeenCalled()
  })
})
