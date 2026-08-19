/** @jest-environment node */

import { NextRequest } from 'next/server'

jest.mock('@/lib/operational-readiness', () => ({
  getOperationalReadinessReport: jest.fn(),
}))
jest.mock('@/lib/source-freshness', () => ({
  getSourceFreshnessReport: jest.fn(),
}))
jest.mock('@/lib/operational-dependencies', () => ({
  getOperationalDependencyReport: jest.fn(),
}))
jest.mock('@/lib/payment-readiness', () => ({
  buildPaymentReadinessReport: jest.fn(),
}))

import { GET as getOperationalReadiness } from '@/app/api/health/readiness/route'
import { GET as getPaymentReadiness } from '@/app/api/health/payment-readiness/route'

const OLD_KEY = process.env.CRON_API_KEY

function request(path: string): NextRequest {
  return new NextRequest(`https://recruiter-radar.ru${path}`, {
    headers: { 'x-api-key': 'anything' },
  })
}

describe('readiness endpoint configuration security', () => {
  beforeEach(() => {
    delete process.env.CRON_API_KEY
  })

  afterAll(() => {
    if (OLD_KEY === undefined) delete process.env.CRON_API_KEY
    else process.env.CRON_API_KEY = OLD_KEY
  })

  it('does not expose the cron credential name from operational readiness', async () => {
    const response = await getOperationalReadiness(request('/api/health/readiness'))
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(JSON.stringify(body)).not.toContain('CRON_API_KEY')
  })

  it('does not expose the cron credential name from payment readiness', async () => {
    const response = await getPaymentReadiness(request('/api/health/payment-readiness'))
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(JSON.stringify(body)).not.toContain('CRON_API_KEY')
  })
})
