const profileRows = [
  { id: '101', deliveryFrequency: 'daily' },
  { id: '202', deliveryFrequency: 'daily' },
]
const runDigestForClientProfile = jest.fn(async (_arg: unknown) => ({ run: { id: 'unused' } }))
const deliverCandidatesForRun = jest.fn(async (_runId: unknown) => ({
  ok: true,
  sent: 0,
  failed: 0,
  skipped: 0,
  failures: [] as Array<{ digestCandidateId: number; error: string }>,
}))
const enrichRunCandidates = jest.fn(async (_runId: unknown) => undefined)
const heartbeatDailyRadarRun = jest.fn(async (_lease: unknown) => true)
const attachDailyRadarProfileDigestRun = jest.fn(async (lease: { digestRunId: string | null }, runId: string) => {
  lease.digestRunId = runId
  return true
})
const finishDailyRadarProfile = jest.fn(async (_lease: unknown, _status: unknown, _error?: unknown) => true)
const claimDailyRadarProfile = jest.fn(async (_lease: unknown, _profileId: unknown) => ({
  acquired: false,
  persisted: true,
  runDate: '2026-08-14',
  clientProfileId: '0',
  leaseId: 'lease',
  attemptCount: 0,
  digestRunId: null as string | null,
  status: 'failed',
}))

jest.mock('@/lib/db', () => ({
  getPool: () => ({ query: jest.fn(async () => ({ rows: profileRows })) }),
}))
jest.mock('@/lib/digest', () => ({
  runDigestForClientProfile: (arg: unknown) => runDigestForClientProfile(arg),
}))
jest.mock('@/lib/digest/deliver-candidates', () => ({
  deliverCandidatesForRun: (runId: unknown) => deliverCandidatesForRun(runId),
}))
jest.mock('@/lib/ai/enrichment/enrichRunCandidates', () => ({
  enrichRunCandidates: (runId: unknown) => enrichRunCandidates(runId),
}))
jest.mock('@/lib/delivery/nextDeliveryHint', () => ({ shouldDeliverOnRun: () => true }))
jest.mock('@/lib/opportunities/commercial-signal-rollout', () => ({
  getCommercialSignalCanaryWorkspaceId: () => null,
  resolveCommercialSignalRollout: () => ({ effectiveMode: 'off' }),
}))
jest.mock('@/lib/daily-radar-run-state', () => ({
  claimDailyRadarRun: jest.fn(),
  finishDailyRadarRun: jest.fn(),
  recordDailyRadarSourceRefreshResult: jest.fn(),
  recordDailyRadarTemporalResult: jest.fn(),
  heartbeatDailyRadarRun: (lease: unknown) => heartbeatDailyRadarRun(lease),
  claimDailyRadarProfile: (lease: unknown, profileId: unknown) => claimDailyRadarProfile(lease, profileId),
  attachDailyRadarProfileDigestRun: (lease: { digestRunId: string | null }, runId: string) =>
    attachDailyRadarProfileDigestRun(lease, runId),
  finishDailyRadarProfile: (lease: unknown, status: unknown, error?: unknown) =>
    finishDailyRadarProfile(lease, status, error),
}))
jest.mock('@/lib/lead-discovery/source-ingest', () => ({
  isNoActiveProfiles: () => false,
  runSourceTemporalIntelligence: jest.fn(),
}))
jest.mock('@/lib/lead-discovery/scheduled-source-refresh', () => ({ runScheduledSourceRefresh: jest.fn() }))
jest.mock('@/lib/runtime', () => ({ logEvent: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }))

import {
  generateAndDeliverDigests,
  resolveDailyRadarFinalStatus,
} from '@/app/api/cron/daily-radar/route'
import type { DailyRadarLease } from '@/lib/daily-radar-run-state'

const dailyLease = (attemptCount: number): DailyRadarLease => ({
  acquired: true,
  persisted: true,
  runDate: '2026-08-14',
  leaseId: `00000000-0000-4000-8000-00000000000${attemptCount}`,
  attemptCount,
})

describe('daily radar partial retry', () => {
  test('keeps the run recoverable while any profile still has a safe retry', () => {
    expect(resolveDailyRadarFinalStatus({
      allOk: false,
      attemptCount: 1,
      terminalProfiles: 1,
      retryableFailedProfiles: 1,
    })).toBe('partial')
    expect(resolveDailyRadarFinalStatus({
      allOk: false,
      attemptCount: 1,
      terminalProfiles: 1,
      retryableFailedProfiles: 0,
    })).toBe('terminal')
    expect(resolveDailyRadarFinalStatus({
      allOk: false,
      attemptCount: 3,
      terminalProfiles: 0,
      retryableFailedProfiles: 1,
    })).toBe('terminal')
  })

  beforeEach(() => {
    jest.clearAllMocks()
    runDigestForClientProfile
      .mockResolvedValueOnce({ run: { id: 'run-a' } })
      .mockResolvedValueOnce({ run: { id: 'run-b' } })
    deliverCandidatesForRun
      .mockResolvedValueOnce({ ok: true, sent: 1, failed: 0, skipped: 0, failures: [] })
      .mockResolvedValueOnce({ ok: false, sent: 0, failed: 1, skipped: 0, failures: [{ digestCandidateId: 0, error: 'profile B failed' }] })
      .mockResolvedValueOnce({ ok: true, sent: 1, failed: 0, skipped: 0, failures: [] })
  })

  test('profile A sent + profile B failed -> retry skips A and retries B on the same digest run', async () => {
    claimDailyRadarProfile
      .mockResolvedValueOnce({ acquired: true, persisted: true, runDate: '2026-08-14', clientProfileId: '101', leaseId: 'lease-1', attemptCount: 1, digestRunId: null, status: 'running' })
      .mockResolvedValueOnce({ acquired: true, persisted: true, runDate: '2026-08-14', clientProfileId: '202', leaseId: 'lease-1', attemptCount: 1, digestRunId: null, status: 'running' })
      .mockResolvedValueOnce({ acquired: false, persisted: true, runDate: '2026-08-14', clientProfileId: '101', leaseId: 'lease-2', attemptCount: 1, digestRunId: 'run-a', status: 'completed' })
      .mockResolvedValueOnce({ acquired: true, persisted: true, runDate: '2026-08-14', clientProfileId: '202', leaseId: 'lease-2', attemptCount: 2, digestRunId: 'run-b', status: 'running' })

    const first = await generateAndDeliverDigests(dailyLease(1), profileRows as any)
    expect(first.map((result) => result.ok)).toEqual([true, false])
    expect(runDigestForClientProfile).toHaveBeenCalledTimes(2)
    expect(deliverCandidatesForRun).toHaveBeenNthCalledWith(1, 'run-a')
    expect(deliverCandidatesForRun).toHaveBeenNthCalledWith(2, 'run-b')

    const second = await generateAndDeliverDigests(dailyLease(2), profileRows as any)
    expect(second.map((result) => result.ok)).toEqual([true, true])
    expect(second[0]).toMatchObject({ clientProfileId: '101', skipped: 1, retried: true })
    expect(second[1]).toMatchObject({ clientProfileId: '202', digestRunId: 'run-b', retried: true })

    expect(runDigestForClientProfile).toHaveBeenCalledTimes(2)
    expect(deliverCandidatesForRun).toHaveBeenCalledTimes(3)
    expect(deliverCandidatesForRun).toHaveBeenNthCalledWith(3, 'run-b')
    expect(deliverCandidatesForRun).not.toHaveBeenNthCalledWith(3, 'run-a')
  })
})
