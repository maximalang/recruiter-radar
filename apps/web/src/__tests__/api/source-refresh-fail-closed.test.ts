import { NextRequest } from 'next/server'

const runScheduledSourceRefresh = jest.fn()
const isNoActiveProfiles = jest.fn((_results: unknown) => false)

jest.mock('@/lib/lead-discovery/source-ingest', () => ({
  isNoActiveProfiles: (results: unknown) => isNoActiveProfiles(results),
}))
jest.mock('@/lib/lead-discovery/scheduled-source-refresh', () => ({
  runScheduledSourceRefresh: () => runScheduledSourceRefresh(),
}))
jest.mock('@/lib/runtime', () => ({ logEvent: jest.fn(), logWarn: jest.fn() }))

import { POST } from '@/app/api/cron/source-refresh/route'

const request = () => new NextRequest('http://localhost/api/cron/source-refresh', {
  method: 'POST',
  headers: { 'x-api-key': 'cron-test-key', 'content-type': 'application/json' },
  body: '{}',
})

describe('standalone Source Refresh fail-closed contract', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.CRON_API_KEY = 'cron-test-key'
    isNoActiveProfiles.mockReturnValue(false)
  })

  afterAll(() => {
    delete process.env.CRON_API_KEY
  })

  test('CASE F: a real failed source remains HTTP 207 and success=false', async () => {
    runScheduledSourceRefresh.mockResolvedValueOnce([
      {
        source: 'test-source',
        success: true,
        outcome: 'success',
        fetchedCount: 1,
        upsertedCount: 1,
      },
      {
        source: 'failed-source',
        success: false,
        outcome: 'failure',
        fetchedCount: 0,
        upsertedCount: 0,
      },
    ])

    const response = await POST(request())
    const body = await response.json()

    expect(response.status).toBe(207)
    expect(body).toMatchObject({
      success: false,
      data: {
        total: 2,
        succeeded: 1,
        failed: 1,
      },
    })
  })
})
