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
// The route imports source-criticality, which opens the shared DB pool at
// import time through the registry chain; keep the test hermetic.
jest.mock('@/lib/db-pool', () => ({ getPool: jest.fn(() => null) }))

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

  afterEach(() => {
    process.env.CRON_API_KEY = 'cron-test-key'
  })

  afterAll(() => {
    delete process.env.CRON_API_KEY
  })

  test('CASE F: a real failed source remains HTTP 207 and success=false', async () => {
    runScheduledSourceRefresh.mockResolvedValueOnce([
      {
        source: 'hh',
        success: true,
        outcome: 'ingested',
        fetchedCount: 1,
        upsertedCount: 1,
      },
      {
        source: 'funding-business-signals',
        success: false,
        outcome: 'failed',
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
        failedRequired: 0,
        failedOptional: 1,
        deliveryImpactingFailure: false,
      },
    })
    // Every detail carries its delivery-impact criticality.
    expect(body.data.details).toEqual([
      expect.objectContaining({ source: 'hh', criticality: 'required' }),
      expect.objectContaining({ source: 'funding-business-signals', criticality: 'optional' }),
    ])
  })

  test('CASE G: a required-source failure is flagged as delivery-impacting in the payload', async () => {
    runScheduledSourceRefresh.mockResolvedValueOnce([
      {
        source: 'career-pages',
        success: false,
        outcome: 'failed',
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
        total: 1,
        failed: 1,
        failedRequired: 1,
        failedOptional: 0,
        deliveryImpactingFailure: true,
      },
    })
    // Unknown source ids must map to unknown criticality (fail-closed).
    runScheduledSourceRefresh.mockResolvedValueOnce([
      { source: 'mystery-source', success: false, outcome: 'failed' },
    ])
    const unknownResponse = await POST(request())
    const unknownBody = await unknownResponse.json()
    expect(unknownBody).toMatchObject({
      data: {
        failedRequired: 1,
        deliveryImpactingFailure: true,
        details: [expect.objectContaining({ source: 'mystery-source', criticality: 'unknown' })],
      },
    })
  })

  test('CASE H: a rate-limited REQUIRED source with success:true is an effective failure (HTTP 207, delivery-impacting)', async () => {
    // The ingest reports throttling with success:true; counting only !success
    // would hide a missed required refresh window inside HTTP 200.
    runScheduledSourceRefresh.mockResolvedValueOnce([
      { source: 'hh', success: true, outcome: 'rate-limited', fetchedCount: 0, upsertedCount: 0 },
    ])

    const response = await POST(request())
    const body = await response.json()

    expect(response.status).toBe(207)
    expect(body).toMatchObject({
      success: false,
      data: {
        total: 1,
        succeeded: 0,
        failed: 1,
        rateLimited: 1,
        failedRequired: 1,
        failedOptional: 0,
        deliveryImpactingFailure: true,
        details: [expect.objectContaining({ source: 'hh', outcome: 'rate-limited', criticality: 'required' })],
      },
    })
  })

  test('CASE I: a rate-limited UNKNOWN-criticality source with success:true fails closed', async () => {
    runScheduledSourceRefresh.mockResolvedValueOnce([
      { source: 'mystery-source', success: true, outcome: 'rate-limited' },
    ])

    const response = await POST(request())
    const body = await response.json()

    expect(response.status).toBe(207)
    expect(body).toMatchObject({
      success: false,
      data: {
        failed: 1,
        failedRequired: 1,
        deliveryImpactingFailure: true,
        details: [expect.objectContaining({ source: 'mystery-source', criticality: 'unknown' })],
      },
    })
  })

  test('CASE J: a rate-limited OPTIONAL source with success:true stays observable but non-delivery-impacting (budgeted partial)', async () => {
    runScheduledSourceRefresh.mockResolvedValueOnce([
      { source: 'hh', success: true, outcome: 'ingested', fetchedCount: 5, upsertedCount: 5 },
      { source: 'funding-business-signals', success: true, outcome: 'rate-limited', fetchedCount: 0, upsertedCount: 0 },
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
        failedRequired: 0,
        failedOptional: 1,
        deliveryImpactingFailure: false,
        details: expect.arrayContaining([
          expect.objectContaining({ source: 'funding-business-signals', outcome: 'rate-limited', criticality: 'optional' }),
        ]),
      },
    })
  })

  test('CASE K: deferred outcomes are never effective failures (full-success 200 preserved)', async () => {
    runScheduledSourceRefresh.mockResolvedValueOnce([
      { source: 'hh', success: true, outcome: 'ingested', fetchedCount: 3, upsertedCount: 3 },
      { source: 'company-newsrooms', success: true, outcome: 'deferred', fetchedCount: 0, upsertedCount: 0 },
    ])

    const response = await POST(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      success: true,
      data: {
        total: 2,
        succeeded: 2,
        failed: 0,
        deferred: 1,
        deliveryImpactingFailure: false,
      },
    })
  })

  test('does not expose the cron secret configuration name when the service is unconfigured', async () => {
    delete process.env.CRON_API_KEY

    const response = await POST(request())
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ success: false, error: 'Source refresh service is not configured.' })
    expect(JSON.stringify(body)).not.toContain('CRON_API_KEY')
  })
})
