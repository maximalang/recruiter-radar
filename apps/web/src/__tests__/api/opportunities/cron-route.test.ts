/** @jest-environment node */

import { NextRequest } from 'next/server'

jest.mock('@/lib/opportunities/jobs', () => ({
  detectHiringEpisodesJob: jest.fn(),
  buildOpportunitiesJob: jest.fn(),
  expireOpportunitiesJob: jest.fn(),
  backfillOpportunitiesJob: jest.fn(),
}))

import { backfillOpportunitiesJob } from '@/lib/opportunities/jobs'
import { POST } from '@/app/api/cron/opportunities/[job]/route'

const mockedBackfill = jest.mocked(backfillOpportunitiesJob)

function request(path: string, key?: string) {
  return new NextRequest(`https://recruiter-radar.ru${path}`, {
    method: 'POST',
    headers: key ? { 'x-api-key': key } : undefined,
  })
}

describe('opportunity cron API', () => {
  const testKey = ['test', 'opportunity', 'cron', 'key'].join('-')
  const originalKey = process.env.CRON_API_KEY
  const originalFlag = process.env.OPPORTUNITY_ENGINE_V1_ENABLED

  beforeEach(() => {
    process.env.CRON_API_KEY = testKey
    process.env.OPPORTUNITY_ENGINE_V1_ENABLED = 'true'
    jest.clearAllMocks()
  })

  afterAll(() => {
    if (originalKey === undefined) delete process.env.CRON_API_KEY
    else process.env.CRON_API_KEY = originalKey
    if (originalFlag === undefined) delete process.env.OPPORTUNITY_ENGINE_V1_ENABLED
    else process.env.OPPORTUNITY_ENGINE_V1_ENABLED = originalFlag
  })

  it('fails closed for missing credentials and a disabled engine', async () => {
    expect((await POST(
      request('/api/cron/opportunities/backfill-opportunities'),
      { params: Promise.resolve({ job: 'backfill-opportunities' }) },
    )).status).toBe(401)

    process.env.OPPORTUNITY_ENGINE_V1_ENABLED = 'false'
    expect((await POST(
      request('/api/cron/opportunities/backfill-opportunities', testKey),
      { params: Promise.resolve({ job: 'backfill-opportunities' }) },
    )).status).toBe(409)
    expect(mockedBackfill).not.toHaveBeenCalled()
  })

  it('keeps backfill read-only by default and requires apply=true for writes', async () => {
    mockedBackfill.mockResolvedValue({
      detection: {
        enabled: true, dryRun: true, scanned: 0, created: 0,
        updated: 0, skipped: 0, failed: 0, expired: 0,
      },
      opportunities: {
        enabled: true, dryRun: true, scanned: 0, created: 0,
        updated: 0, skipped: 0, failed: 0, expired: 0,
      },
    })

    const dryRun = await POST(
      request('/api/cron/opportunities/backfill-opportunities', testKey),
      { params: Promise.resolve({ job: 'backfill-opportunities' }) },
    )
    expect(dryRun.status).toBe(200)
    expect(mockedBackfill).toHaveBeenLastCalledWith(expect.objectContaining({
      dryRun: true,
    }))

    await POST(
      request('/api/cron/opportunities/backfill-opportunities?apply=true', testKey),
      { params: Promise.resolve({ job: 'backfill-opportunities' }) },
    )
    expect(mockedBackfill).toHaveBeenLastCalledWith(expect.objectContaining({
      dryRun: false,
    }))
  })
})
