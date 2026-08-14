import {
  runSupportingSourceScheduler,
} from '@/lib/lead-discovery/supporting-source-scheduler'
import type { IngestResult } from '@/lib/lead-discovery/source-ingest'

const ok = (source: IngestResult['source']): IngestResult => ({
  source, success: true, outcome: 'expected-zero', fetchedCount: 0,
  upsertedCount: 0,
})

test('bounds global and per-host supporting concurrency', async () => {
  let active = 0
  let maxActive = 0
  const activeByHost = new Map<string, number>()
  let maxGithubHost = 0
  const run = jest.fn(async (source: IngestResult['source']) => {
    active += 1
    maxActive = Math.max(maxActive, active)
    const host = source === 'github-company-org' || source === 'company-site'
      ? 'company-public-web'
      : source
    activeByHost.set(host, (activeByHost.get(host) ?? 0) + 1)
    maxGithubHost = Math.max(maxGithubHost, activeByHost.get('company-public-web') ?? 0)
    await new Promise((resolve) => setTimeout(resolve, 5))
    active -= 1
    activeByHost.set(host, (activeByHost.get(host) ?? 1) - 1)
    return ok(source)
  })

  const results = await runSupportingSourceScheduler({
    sources: ['github-company-org', 'company-site', 'industry-media'],
    run,
    now: new Date('2026-01-01T00:00:00.000Z'),
    globalConcurrency: 2,
    scheduleOverrides: {
      'github-company-org': { hostKey: 'company-public-web', perHostConcurrency: 1 },
      'company-site': { hostKey: 'company-public-web', perHostConcurrency: 1 },
    },
  })

  expect(results).toHaveLength(3)
  expect(maxActive).toBeLessThanOrEqual(2)
  expect(maxGithubHost).toBe(1)
})

test('skips credential-gated and persisted deferred sources without spawning', async () => {
  const run = jest.fn(async (source: IngestResult['source']) => ok(source))
  const db = {
    query: jest.fn(async (sql: string) => {
      if (sql.includes('FROM source_scheduler_state')) return { rows: [{
        sourceId: 'github-company-org',
        nextEligibleRunAt: '2026-01-02T00:00:00.000Z',
        cooldownUntil: null,
        consecutiveFailures: 0,
      }] }
      return { rows: [], rowCount: 1 }
    }),
  }

  const results = await runSupportingSourceScheduler({
    sources: ['youtube-company-channels', 'github-company-org'],
    run,
    db,
    env: {},
    inheritedEnv: {},
    now: new Date('2026-01-01T00:00:00.000Z'),
  })

  expect(run).not.toHaveBeenCalled()
  expect(results.map((result) => result.outcome)).toEqual([
    'credential-gated', 'deferred',
  ])
  expect(results.every((result) => result.success)).toBe(true)
})

test('persists a cooldown and keeps a 429 from failing the daily stage', async () => {
  const writes: Array<readonly unknown[] | undefined> = []
  const db = {
    query: jest.fn(async (sql: string, params?: readonly unknown[]) => {
      if (sql.includes('FROM source_scheduler_state')) return { rows: [] }
      writes.push(params)
      return { rows: [], rowCount: 1 }
    }),
  }

  const [result] = await runSupportingSourceScheduler({
    sources: ['industry-media'],
    run: async (source) => ({
      source, success: false, outcome: 'failed', error: 'HTTP 429 rate limited',
    }),
    db,
    now: new Date('2026-01-01T00:00:00.000Z'),
  })

  expect(result).toMatchObject({ success: true, outcome: 'rate-limited' })
  expect(writes[0]).toEqual(expect.arrayContaining([
    'industry-media', 'rate_limited',
  ]))
  expect(writes[0]?.some((value) =>
    value === '2026-01-01T06:00:00.000Z')).toBe(true)
})
