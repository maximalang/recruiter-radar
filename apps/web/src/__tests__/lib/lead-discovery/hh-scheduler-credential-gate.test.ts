import { runSupportingSourceScheduler } from '@/lib/lead-discovery/supporting-source-scheduler'

describe('HH scheduler credential gate', () => {
  test('HH_USER_AGENT alone is credential-gated and does not execute ingest', async () => {
    const run = jest.fn(async () => ({
      source: 'hh' as const,
      success: true,
      outcome: 'fetched' as const,
      fetchedCount: 1,
      upsertedCount: 1,
    }))

    const results = await runSupportingSourceScheduler({
      sources: ['hh'],
      run,
      db: null,
      env: { HH_USER_AGENT: 'Recruiter Radar ops@example.com' },
      inheritedEnv: {},
      now: new Date('2026-08-14T10:00:00.000Z'),
    })

    expect(run).not.toHaveBeenCalled()
    expect(results).toEqual([
      expect.objectContaining({
        source: 'hh',
        success: true,
        outcome: 'credential-gated',
        fetchedCount: 0,
        upsertedCount: 0,
      }),
    ])
  })

  test('complete HH application credentials make the scheduler runnable', async () => {
    const run = jest.fn(async () => ({
      source: 'hh' as const,
      success: true,
      outcome: 'fetched' as const,
      fetchedCount: 1,
      upsertedCount: 1,
    }))

    const results = await runSupportingSourceScheduler({
      sources: ['hh'],
      run,
      db: null,
      env: {
        HH_USER_AGENT: 'Recruiter Radar ops@example.com',
        HH_CLIENT_ID: 'client-id',
        HH_CLIENT_SECRET: 'client-secret',
      },
      inheritedEnv: {},
      now: new Date('2026-08-14T10:00:00.000Z'),
    })

    expect(run).toHaveBeenCalledTimes(1)
    expect(results[0]).toMatchObject({ source: 'hh', outcome: 'fetched' })
  })
})
