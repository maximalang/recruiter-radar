import { NextRequest } from 'next/server'

const dbQuery = jest.fn(async () => ({
  rowCount: 1,
  rows: [{
    runStateReady: true,
    profileStateReady: true,
    migrationsCurrent: true,
    temporalStateReady: true,
    deliveryStateReady: true,
  }],
}))
const claimDailyRadarRun = jest.fn()
const runScheduledSourceRefresh = jest.fn()
const runSourceTemporalIntelligence = jest.fn()
const runDigestForClientProfile = jest.fn()
const deliverCandidatesForRun = jest.fn()
const loadDailyRadarProfileEligibility = jest.fn() as jest.Mock
const isNoActiveProfiles = jest.fn(() => false) as jest.Mock
const finishDailyRadarRun = jest.fn(async () => true) as jest.Mock
const recordDailyRadarSourceRefreshResult = jest.fn(async () => true) as jest.Mock
const recordDailyRadarTemporalResult = jest.fn(async () => true) as jest.Mock
const heartbeatDailyRadarRun = jest.fn(async () => true) as jest.Mock
const summarizeDailyRadarProfiles = jest.fn(async () => ({
  profilesTotal: 0,
  profilesCompleted: 0,
  profilesFailed: 0,
  profilesRetryable: 0,
  profilesTerminal: 0,
  profilesSkipped: 0,
  profilesRunning: 0,
})) as jest.Mock
const claimDailyRadarProfile = jest.fn(async () => ({
  acquired: false,
  persisted: true,
  runDate: '2026-08-16',
  clientProfileId: 'profile-1',
  leaseId: 'profile-lease',
  attemptCount: 1,
  digestRunId: 'existing-run',
  status: 'completed',
})) as jest.Mock
const dailyRadarNextRetryAt = jest.fn(() => null) as jest.Mock

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
  finishDailyRadarRun: (lease: unknown, status: unknown, now?: unknown, summary?: unknown) =>
    finishDailyRadarRun(lease, status, now, summary),
  recordDailyRadarSourceRefreshResult: (lease: unknown, value: unknown) =>
    recordDailyRadarSourceRefreshResult(lease, value),
  recordDailyRadarTemporalResult: (lease: unknown, value: unknown) =>
    recordDailyRadarTemporalResult(lease, value),
  heartbeatDailyRadarRun: (lease: unknown, now?: unknown) => heartbeatDailyRadarRun(lease, now),
  summarizeDailyRadarProfiles: (lease: unknown) => summarizeDailyRadarProfiles(lease),
  claimDailyRadarProfile: (lease: unknown, profileId: unknown) => claimDailyRadarProfile(lease, profileId),
  attachDailyRadarProfileDigestRun: jest.fn(),
  finishDailyRadarProfile: jest.fn(),
  dailyRadarNextRetryAt: (lease: unknown, status: unknown, now: unknown) => dailyRadarNextRetryAt(lease, status, now),
}))
jest.mock('@/lib/daily-radar-profile-eligibility', () => ({
  loadDailyRadarProfileEligibility: (options: unknown) => loadDailyRadarProfileEligibility(options),
}))
jest.mock('@/lib/lead-discovery/source-ingest', () => ({
  isNoActiveProfiles: (result: unknown) => isNoActiveProfiles(result),
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

const acquiredLease = (attemptCount = 1) => ({
  acquired: true,
  persisted: true,
  runDate: '2026-08-16',
  leaseId: `00000000-0000-4000-8000-00000000000${attemptCount}`,
  attemptCount,
})

const zeroEligible = (excluded: Record<string, number> = { entitlement_inactive: 1 }) => ({
  eligible: [],
  summary: {
    total: 1,
    active: 1,
    eligible: 0,
    excluded,
  },
})

describe('manual Daily Radar dispatch safety', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    isNoActiveProfiles.mockReturnValue(false)
    loadDailyRadarProfileEligibility.mockResolvedValue(zeroEligible())
    summarizeDailyRadarProfiles.mockResolvedValue({
      profilesTotal: 0,
      profilesCompleted: 0,
      profilesFailed: 0,
      profilesRetryable: 0,
      profilesTerminal: 0,
      profilesSkipped: 0,
      profilesRunning: 0,
    })
    claimDailyRadarProfile.mockResolvedValue({
      acquired: false,
      persisted: true,
      runDate: '2026-08-16',
      clientProfileId: 'profile-1',
      leaseId: 'profile-lease',
      attemptCount: 1,
      digestRunId: 'existing-run',
      status: 'completed',
    })
    dailyRadarNextRetryAt.mockReturnValue(null)
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
      data: {
        runtime: 'ready',
        database: 'ready',
        migrations: 'current',
        schedulerState: 'ready',
        temporal: 'ready',
        deliveryInfrastructure: 'ready',
        profileSelection: {
          total: 1,
          active: 1,
          eligible: 0,
          excluded: { entitlement_inactive: 1 },
        },
      },
    })
    expect(dbQuery).toHaveBeenCalledTimes(1)
    expect(loadDailyRadarProfileEligibility).toHaveBeenCalledTimes(1)
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

  test('verify mode fails closed when temporal readiness is missing', async () => {
    dbQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{
        runStateReady: true,
        profileStateReady: true,
        migrationsCurrent: true,
        temporalStateReady: false,
        deliveryStateReady: true,
      }],
    })

    const response = await POST(request({ mode: 'verify' }))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      success: false,
      mode: 'verify',
      error: 'Daily Radar temporal state is not ready.',
    })
    expect(loadDailyRadarProfileEligibility).not.toHaveBeenCalled()
    expect(claimDailyRadarRun).not.toHaveBeenCalled()
  })

  test('scheduled zero-eligible day is a healthy no-op when all stages are healthy', async () => {
    claimDailyRadarRun.mockResolvedValueOnce(acquiredLease())
    runScheduledSourceRefresh.mockResolvedValueOnce([])
    runSourceTemporalIntelligence.mockResolvedValueOnce({ success: true, reason: 'expected-zero', observations: 0, derivedEvents: 0 })
    loadDailyRadarProfileEligibility.mockResolvedValueOnce(zeroEligible({ no_configured_channel: 1 }))

    const response = await POST(request({}))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      reason: 'no-eligible-profiles',
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
    expect(finishDailyRadarRun).toHaveBeenCalledWith(
      expect.anything(),
      'completed',
      expect.any(Date),
      expect.anything(),
    )
    expect(runDigestForClientProfile).not.toHaveBeenCalled()
    expect(deliverCandidatesForRun).not.toHaveBeenCalled()
  })

  test('CASE A/G: zero eligible + failed source + healthy temporal completes while exposing only safe failed-source fields', async () => {
    claimDailyRadarRun.mockResolvedValueOnce(acquiredLease())
    runScheduledSourceRefresh.mockResolvedValueOnce([{
      source: 'test-source',
      success: false,
      outcome: 'failure',
      fetchedCount: 0,
      upsertedCount: 0,
      error: 'provider-token=must-not-enter-failedSources',
      diagnostics: { parsedCount: 0, normalizedCount: 0 },
    }])
    runSourceTemporalIntelligence.mockResolvedValueOnce({ success: true, reason: 'expected-zero', observations: 0, derivedEvents: 0 })
    loadDailyRadarProfileEligibility.mockResolvedValueOnce(zeroEligible())

    const response = await POST(request({}))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      success: true,
      terminal: false,
      reason: 'no-eligible-profiles',
      data: {
        ingest: {
          ok: false,
          failed: 1,
          failedSources: [{ source: 'test-source', outcome: 'failure' }],
        },
        temporal: { ok: true, reason: 'expected-zero' },
        digest: { eligibility: { active: 1, eligible: 0 } },
      },
    })
    expect(Object.keys(body.data.ingest.failedSources[0]).sort()).toEqual(['outcome', 'source'])
    expect(JSON.stringify(body.data.ingest.failedSources)).not.toContain('provider-token')
    expect(recordDailyRadarSourceRefreshResult).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ok: false, failed: 1 }),
    )
    expect(finishDailyRadarRun).toHaveBeenCalledWith(
      expect.anything(),
      'completed',
      expect.any(Date),
      expect.anything(),
    )
    expect(runDigestForClientProfile).not.toHaveBeenCalled()
    expect(deliverCandidatesForRun).not.toHaveBeenCalled()
  })

  test('CASE B: zero eligible does not hide temporal failure', async () => {
    claimDailyRadarRun.mockResolvedValueOnce(acquiredLease())
    runScheduledSourceRefresh.mockResolvedValueOnce([])
    runSourceTemporalIntelligence.mockResolvedValueOnce({
      success: false,
      reason: 'parser-failed',
      observations: 0,
      derivedEvents: 0,
      error: 'temporal parser failed',
    })
    loadDailyRadarProfileEligibility.mockResolvedValueOnce(zeroEligible())

    const response = await POST(request({}))
    const body = await response.json()

    expect(response.status).toBe(207)
    expect(body).toMatchObject({
      success: false,
      terminal: false,
      reason: 'partial',
      data: {
        temporal: { ok: false, reason: 'parser-failed' },
        digest: { eligibility: { eligible: 0 } },
      },
    })
    expect(finishDailyRadarRun).toHaveBeenCalledWith(
      expect.anything(),
      'partial',
      expect.any(Date),
      expect.anything(),
    )
  })

  test('CASE C: eligible profile keeps existing ingest fail-closed recovery contract', async () => {
    claimDailyRadarRun.mockResolvedValueOnce(acquiredLease())
    runScheduledSourceRefresh.mockResolvedValueOnce([{
      source: 'test-source',
      success: false,
      outcome: 'failure',
      fetchedCount: 0,
      upsertedCount: 0,
      diagnostics: {},
    }])
    runSourceTemporalIntelligence.mockResolvedValueOnce({ success: true, reason: 'expected-zero', observations: 0, derivedEvents: 0 })
    loadDailyRadarProfileEligibility.mockResolvedValueOnce({
      eligible: [{ id: 'profile-1', deliveryFrequency: 'daily' }],
      summary: { total: 1, active: 1, eligible: 1, excluded: {} },
    })

    const response = await POST(request({}))
    const body = await response.json()

    expect(response.status).toBe(207)
    expect(body).toMatchObject({
      success: false,
      terminal: false,
      reason: 'partial',
      data: {
        ingest: { ok: false, failedSources: [{ source: 'test-source', outcome: 'failure' }] },
        temporal: { ok: true },
        digest: { eligibility: { eligible: 1 } },
      },
    })
    expect(finishDailyRadarRun).toHaveBeenCalledWith(
      expect.anything(),
      'partial',
      expect.any(Date),
      expect.anything(),
    )
  })

  test('CASE D: completed healthy no-op makes later recovery triggers clean already-completed no-ops', async () => {
    claimDailyRadarRun
      .mockResolvedValueOnce(acquiredLease(1))
      .mockResolvedValueOnce({ acquired: false, persisted: true, runDate: '2026-08-16', attemptCount: 1, reason: 'already-completed', nextRetryAt: null })
      .mockResolvedValueOnce({ acquired: false, persisted: true, runDate: '2026-08-16', attemptCount: 1, reason: 'already-completed', nextRetryAt: null })
    runScheduledSourceRefresh.mockResolvedValueOnce([{
      source: 'test-source',
      success: false,
      outcome: 'failure',
      fetchedCount: 0,
      upsertedCount: 0,
      diagnostics: {},
    }])
    runSourceTemporalIntelligence.mockResolvedValueOnce({ success: true, reason: 'expected-zero', observations: 0, derivedEvents: 0 })
    loadDailyRadarProfileEligibility.mockResolvedValueOnce(zeroEligible())

    const first = await POST(request({}))
    const recovery1 = await POST(request({}))
    const recovery2 = await POST(request({}))

    expect(first.status).toBe(200)
    await expect(first.json()).resolves.toMatchObject({ success: true, reason: 'no-eligible-profiles' })
    expect(recovery1.status).toBe(200)
    await expect(recovery1.json()).resolves.toMatchObject({ success: true, skipped: true, reason: 'already-completed', attemptCount: 1 })
    expect(recovery2.status).toBe(200)
    await expect(recovery2.json()).resolves.toMatchObject({ success: true, skipped: true, reason: 'already-completed', attemptCount: 1 })
    expect(runScheduledSourceRefresh).toHaveBeenCalledTimes(1)
    expect(runSourceTemporalIntelligence).toHaveBeenCalledTimes(1)
    expect(finishDailyRadarRun).toHaveBeenCalledTimes(1)
    expect(finishDailyRadarRun).toHaveBeenCalledWith(
      expect.anything(),
      'completed',
      expect.any(Date),
      expect.anything(),
    )
  })

  test('scheduled mode reports no active profiles as a healthy classified no-op', async () => {
    claimDailyRadarRun.mockResolvedValueOnce(acquiredLease())
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
      reason: 'no-eligible-profiles',
      data: {
        ingest: { ok: true, noActiveProfiles: true, total: 0, failedSources: [] },
        digest: { eligibility: { active: 0, eligible: 0, excluded: { profile_paused: 1 } } },
      },
    })
    expect(runSourceTemporalIntelligence).toHaveBeenCalledTimes(1)
    expect(runDigestForClientProfile).not.toHaveBeenCalled()
  })
})
