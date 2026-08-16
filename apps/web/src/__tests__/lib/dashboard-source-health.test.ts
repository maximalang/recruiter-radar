import { getPool } from '@/lib/db'
import { getDashboardSourceHealth } from '@/lib/dashboard-data'

jest.mock('@/lib/db', () => ({ getPool: jest.fn() }))
jest.mock('@/lib/db-pool', () => ({ getPool: jest.fn() }))
jest.mock('@/lib/sources/source-registry', () => ({
  getSourceRegistry: () => [
    { id: 'hh', name: 'HeadHunter' },
    { id: 'fns-open-data', name: 'FNS open data' },
    { id: 'greenhouse', name: 'Greenhouse' },
    { id: 'youtube-company-channels', name: 'YouTube company channels' },
  ],
}))
jest.mock('@/lib/entitlements', () => ({ getEffectiveEntitlement: jest.fn() }))
jest.mock('@/lib/leads-data', () => ({ getLeadsForAllProfiles: jest.fn(), getPendingReviewCount: jest.fn() }))
jest.mock('@/lib/clientProfiles', () => ({ listClientProfiles: jest.fn(), resolveHiringMode: jest.fn() }))

const mockedGetPool = getPool as jest.MockedFunction<typeof getPool>

describe('getDashboardSourceHealth', () => {
  it('aggregates accepted records from append-only observations into real time windows', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [{
        source_id: 'hh',
        last_attempt_at: '2026-08-14T00:00:00.000Z',
        last_successful_fetch_at: '2026-08-14T00:00:00.000Z',
        last_successful_normalization_at: '2026-08-14T00:00:00.000Z',
        records_fetched: '900',
        records_accepted: '800',
        records_accepted_1h: '3',
        records_accepted_24h: '30',
        records_accepted_7d: '300',
        duplicate_records: '20',
        organization_resolution_rejects: '2',
        blocked_count: '1',
        rate_limited_count: '4',
        extraction_methods: { api: 800 },
        last_latency_ms: 50,
        consecutive_failures: 0,
      }],
    })
    mockedGetPool.mockReturnValue({ query } as never)

    const result = await getDashboardSourceHealth()

    expect(query.mock.calls[0]?.[0]).toContain('FROM source_run_observations')
    expect(query.mock.calls[0]?.[0]).toContain("INTERVAL '1 hour'")
    expect(query.mock.calls[0]?.[0]).toContain("INTERVAL '24 hours'")
    expect(query.mock.calls[0]?.[0]).toContain("INTERVAL '7 days'")
    expect(result[0]).toMatchObject({
      recordsProcessed: 800,
      recordsProcessed1h: 3,
      recordsProcessed24h: 30,
      recordsProcessed7d: 300,
      organizationResolutionRejects: 2,
      blocked: 1,
      rateLimited: 4,
    })
  })

  it('measures staleness from successful work against each source cadence', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-14T12:00:00.000Z'))
    const query = jest.fn().mockResolvedValue({ rows: [
      {
        source_id: 'hh', last_attempt_at: '2026-08-14T12:00:00.000Z',
        last_successful_fetch_at: '2026-08-12T12:00:00.000Z',
        last_successful_normalization_at: '2026-08-12T12:00:00.000Z',
        records_fetched: '1', records_accepted: '1', consecutive_failures: 0,
      },
      {
        source_id: 'fns-open-data', last_attempt_at: '2026-08-12T12:00:00.000Z',
        last_successful_fetch_at: '2026-08-12T12:00:00.000Z',
        last_successful_normalization_at: '2026-08-12T12:00:00.000Z',
        records_fetched: '0', records_accepted: '0', consecutive_failures: 0,
      },
    ] })
    mockedGetPool.mockReturnValue({ query } as never)

    const result = await getDashboardSourceHealth()

    expect(result.find((source) => source.id === 'hh')).toMatchObject({
      status: 'critical', lastRun: '2026-08-12T12:00:00.000Z',
    })
    expect(result.find((source) => source.id === 'fns-open-data')).toMatchObject({
      status: 'excellent', expectedRefreshIntervalSeconds: 604800,
    })
    jest.useRealTimers()
  })

  it('uses unified career-pages health for hosted ATS and labels missing credentials inactive', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-14T12:00:00.000Z'))
    const query = jest.fn().mockResolvedValue({ rows: [
      {
        source_id: 'career-pages', last_attempt_at: '2026-08-14T11:00:00.000Z',
        last_successful_fetch_at: '2026-08-14T11:00:00.000Z',
        last_successful_normalization_at: '2026-08-14T11:00:00.000Z',
        records_fetched: '5', records_accepted: '5', consecutive_failures: 0,
      },
      {
        source_id: 'youtube-company-channels', scheduler_outcome: 'credential_gated',
        consecutive_failures: 0,
      },
    ] })
    mockedGetPool.mockReturnValue({ query } as never)

    const result = await getDashboardSourceHealth()

    expect(result.find((source) => source.id === 'greenhouse')).toMatchObject({
      status: 'excellent', recordsProcessed: 5,
    })
    expect(result.find((source) => source.id === 'youtube-company-channels')).toMatchObject({
      status: 'inactive', overall: 0,
    })
    jest.useRealTimers()
  })
})
