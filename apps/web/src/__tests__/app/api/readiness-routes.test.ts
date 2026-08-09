/** @jest-environment node */

import { NextRequest } from 'next/server'

jest.mock('@/lib/operational-readiness', () => ({
  getOperationalReadinessReport: jest.fn(),
}))
jest.mock('@/lib/source-freshness', () => ({
  getSourceFreshnessReport: jest.fn(),
}))
jest.mock('@/lib/payment-readiness', () => ({
  buildPaymentReadinessReport: jest.fn(),
}))
jest.mock('@/lib/operational-dependencies', () => ({
  getOperationalDependencyReport: jest.fn(),
}))

import { getOperationalReadinessReport } from '@/lib/operational-readiness'
import { getSourceFreshnessReport } from '@/lib/source-freshness'
import { buildPaymentReadinessReport } from '@/lib/payment-readiness'
import { getOperationalDependencyReport } from '@/lib/operational-dependencies'
import { GET as getOperationalReadiness } from '@/app/api/health/readiness/route'
import { GET as getPaymentReadiness } from '@/app/api/health/payment-readiness/route'

const mockedOperational = jest.mocked(getOperationalReadinessReport)
const mockedFreshness = jest.mocked(getSourceFreshnessReport)
const mockedPayment = jest.mocked(buildPaymentReadinessReport)
const mockedDependencies = jest.mocked(getOperationalDependencyReport)

function request(path: string, apiKey?: string): NextRequest {
  return new NextRequest(`https://recruiter-radar.ru${path}`, {
    headers: apiKey ? { 'x-api-key': apiKey } : undefined,
  })
}

describe('protected readiness endpoints', () => {
  const originalKey = process.env.CRON_API_KEY

  afterEach(() => {
    jest.clearAllMocks()
    if (originalKey === undefined) delete process.env.CRON_API_KEY
    else process.env.CRON_API_KEY = originalKey
  })

  beforeEach(() => {
    mockedDependencies.mockResolvedValue({
      generatedAt: '2026-08-09T10:00:00.000Z',
      criticalReady: true,
      database: { state: 'ok', latencyMs: 2 },
      email: { state: 'configured_unverified', provider: 'postbox' },
      workflow: { state: 'ok', queue: 'database' },
      providers: {
        payment: { state: 'optional_unavailable', provider: null },
        telegram: { state: 'optional_unavailable' },
        webPush: { state: 'optional_unavailable' },
      },
    })
  })

  test('fails closed when the operator key is not configured', async () => {
    delete process.env.CRON_API_KEY
    expect((await getOperationalReadiness(request('/api/health/readiness'))).status).toBe(503)
    expect((await getPaymentReadiness(request('/api/health/payment-readiness'))).status).toBe(503)
    expect(mockedOperational).not.toHaveBeenCalled()
    expect(mockedFreshness).not.toHaveBeenCalled()
    expect(mockedPayment).not.toHaveBeenCalled()
    expect(mockedDependencies).not.toHaveBeenCalled()
  })

  test('rejects missing and wrong keys', async () => {
    process.env.CRON_API_KEY = 'correct-key-with-enough-entropy'
    expect((await getOperationalReadiness(request('/api/health/readiness'))).status).toBe(401)
    expect((await getPaymentReadiness(request('/api/health/payment-readiness', 'wrong-key'))).status).toBe(401)
    expect(mockedOperational).not.toHaveBeenCalled()
    expect(mockedFreshness).not.toHaveBeenCalled()
    expect(mockedPayment).not.toHaveBeenCalled()
    expect(mockedDependencies).not.toHaveBeenCalled()
  })

  test('returns aggregate operational and source freshness state to an authorized operator', async () => {
    process.env.CRON_API_KEY = 'correct-key-with-enough-entropy'
    mockedOperational.mockResolvedValue({
      windowHours: 24,
      generatedAt: '2026-07-20T10:00:00.000Z',
      profiles: {
        eligible: 2,
        delivered: 1,
        missed: 1,
        reasons: { no_digest_run: 0, digest_failed: 0, empty_digest: 0, delivery_failed: 1, not_delivered: 0 },
        details: [],
      },
      delivery: [],
      sourceActions: [],
      performance: { digestRunP95Ms: 100, deliveryP95Ms: 50 },
      externalBlockers: [],
    })
    mockedFreshness.mockResolvedValue([
      { source: 'hh', latestOccurredAt: '2026-07-20T09:00:00.000Z', lagHours: 1, signalCount: 42 },
    ])

    const response = await getOperationalReadiness(
      request('/api/health/readiness?windowHours=48', 'correct-key-with-enough-entropy'),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      status: 'degraded',
      report: {
        sourceFreshness: [{ source: 'hh', lagHours: 1, signalCount: 42 }],
        dependencies: { criticalReady: true, database: { state: 'ok' } },
      },
    })
    expect(mockedOperational).toHaveBeenCalledWith(48)
    expect(mockedFreshness).toHaveBeenCalledTimes(1)
    expect(mockedDependencies).toHaveBeenCalledTimes(1)
  })

  test('returns honest sales-assisted state without payment configuration', async () => {
    process.env.CRON_API_KEY = 'correct-key-with-enough-entropy'
    mockedPayment.mockReturnValue(paymentReport({
      selfServeCheckoutReady: false,
      selfServePilotReady: false,
      integrationStatus: 'blocked',
      customerFlow: 'saved_request',
    }))

    const response = await getPaymentReadiness(
      request('/api/health/payment-readiness', 'correct-key-with-enough-entropy'),
    )
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true, status: 'sales-assisted' })
    expect(JSON.stringify(body)).not.toMatch(/customerContact|providerPaymentId|password|secret/i)
  })

  test('returns integration-ready before external live verification', async () => {
    process.env.CRON_API_KEY = 'correct-key-with-enough-entropy'
    mockedPayment.mockReturnValue(paymentReport({
      selfServeCheckoutReady: true,
      selfServePilotReady: true,
      integrationStatus: 'ready',
      customerFlow: 'self_service_payment',
    }))

    const response = await getPaymentReadiness(
      request('/api/health/payment-readiness', 'correct-key-with-enough-entropy'),
    )
    expect(await response.json()).toMatchObject({ ok: true, status: 'integration-ready' })
  })
})

function paymentReport(input: {
  selfServeCheckoutReady: boolean
  selfServePilotReady: boolean
  integrationStatus: 'ready' | 'blocked'
  customerFlow: 'self_service_payment' | 'saved_request'
}) {
  return {
    provider: input.selfServeCheckoutReady ? 'robokassa' as const : null,
    mode: input.selfServeCheckoutReady ? 'test' as const : null,
    checkoutConfigured: input.selfServeCheckoutReady,
    webhookConfigured: input.selfServeCheckoutReady,
    siteUrlConfigured: true,
    selfServeCheckoutReady: input.selfServeCheckoutReady,
    selfServePilotReady: input.selfServePilotReady,
    recurringBillingReady: false as const,
    refundsConfigured: false,
    npdReceiptsConfigured: false,
    merchantModerationReady: false,
    liveLaunchReady: false,
    integration: { status: input.integrationStatus, blockers: input.integrationStatus === 'ready' ? [] : ['credentials absent'] },
    launch: { status: 'blocked' as const, blockers: ['external verification required'] },
    rfProvider: {
      status: input.integrationStatus,
      provider: input.selfServeCheckoutReady ? 'robokassa' as const : null,
      blockers: input.integrationStatus === 'ready' ? [] : ['credentials absent'],
    },
    customerFlow: {
      pilot: input.customerFlow,
      monthly: input.customerFlow,
      quarterly: input.customerFlow,
    },
  }
}
