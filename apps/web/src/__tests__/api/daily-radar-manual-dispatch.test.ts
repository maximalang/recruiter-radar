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
const loadDailyRadarProfileEligibility = jest.fn()
const isNoActiveProfiles = jest.fn(() => false)
const finishDailyRadarRun = jest.fn(async () => true)
const recordDailyRadarSourceRefreshResult = jest.fn(async () => true)
const recordDailyRadarTemporalResult = jest.fn(async () => true)
const heartbeatDailyRadarRun = jest.fn(async () => true)

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
  finishDailyRadarRun: (...args: unknown[]) => finishDailyRadarRun(...args),
  recordDailyRadarSourceRefreshResult: (...args: unknown[]) => recordDailyRadarSourceRefreshResult(...args),
  recordDailyRadarTemporalResult: (...args: unknown[]) => recordDailyRadarTemporalResult(...args),
  heartbeatDailyRadarRun: (...args: unknown[]) => heartbeatDailyRadarRun(...args),
  summarizeDailyRadarProfiles: jest.fn(async () => ({ profilesTotal: 0, profilesCompleted: 0, profilesFailed: 0, profilesRetryable: 0, profilesTerminal: 0, profilesSkipped: 0, profilesRunning: 0 })),
  claimDailyRadarProfile: jest.fn(),
  attachDailyRadarProfileDigestRun: jest.fn(),
  finishDailyRadarProfile: jest.fn(),
  dailyRadarNextRetryAt: jest.fn(),
}))
jest.mock('@/lib/daily-radar-profile-eligibility', () => ({
  loadDailyRadarProfileEligibility: (...args: unknown[]) => loadDailyRadarProfileEligibility(...args),
}))
jest.mock('@/lib/lead-discovery/source-ingest', () => ({
  isNoActiveProfiles: (...args: unknown[]) => isNoActiveProfiles(...args),
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
    isNoActiveProfiles.mockReturnValue(false)
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

  test('scheduled mode treats zero eligible profiles as a healthy no-op when other stages are healthy', async () => {
    claimDailyRadarRun.mockResolvedValueOnce({ acquired: true, persisted: true, runDate: '2026-08-16', leaseId: '00000000-0000-4000-8000-000000000001', attemptCount: 1 })
    runScheduledSourceRefresh.mockResolvedValueOnce([])
    runSourceTemporalIntelligence.mockResolvedValueOnce({ success: true, reason: 'expected-zero', observations: 0, derivedEvents: 0 })
    loadDailyRadarProfileEligibility.mockResolvedValueOnce({
      eligible: [],
      summary: {
        total: 1,
        active: 1,
        eligible: 0,
        excluded: { no_configured_channel: 1 },
      },
    })

    const response = await POST(request({}))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      reason: 'completed',
      data: {
        temporal: { reason: 'expected-zero' },
        digest: {
          eligibility: {
            active: 1,
            eligible: 0,
            excluded: { no_configured_channel: 1 },
          },
        },
      },
    })
    expect(runDigestForClientProfile).not.toHaveBeenCalled()
    expect(deliverCandidatesForRun).not.toHaveBeenCalled()
  })

  test('scheduled mode reports no active profiles as a healthy classified no-op', async () => {
    claimDailyRadarRun.mockResolvedValueOnce({ acquired: true, persisted: true, runDate: '2026-08-16', leaseId: '00000000-0000-4000-8000-000000000001', attemptCount: 1 })
    runScheduledSourceRefresh.mockResolvedValueOnce({ error: 'no_active_profiles', hint: 'not logged' })
    isNoActiveProfiles.mockReturnValueOnce(true)
    runSourceTemporalIntelligence.mockResolvedValueOnce({ success: true, reason: 'expected-zero', observations: 0, derivedEvents: 0 })
    loadDailyRadarProfileEligibility.mockResolvedValueOnce({
      eligible: [],
      summary: { total: 1, active: 0, eligible: 0, excluded: { profile_paused: 1 } },
    })

    const response = await POST(request({}))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      reason: 'completed',
      data: {
        ingest: { ok: true, noActiveProfiles: true, total: 0 },
        digest: { eligibility: { active: 0, eligible: 0, excluded: { profile_paused: 1 } } },
      },
    })
    expect(runSourceTemporalIntelligence).toHaveBeenCalledTimes(1)
    expect(runDigestForClientProfile).not.toHaveBeenCalled()
  })
})
