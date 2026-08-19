/**
 * Tests for API auth on /api/leads/generate and /api/leads/score — T1.3
 *
 * POST endpoints require x-api-key matching LEAD_API_KEY (fallback DIGEST_API_KEY).
 * GET endpoints remain open (documentation only).
 * 500 responses must not leak error.message or credential names.
 */

import { NextRequest, NextResponse } from 'next/server'

// ---- Mock the heavy dependencies ----
jest.mock('@/lib/lead-discovery/multi-source-lead-generator', () => ({
  MultiSourceLeadGenerator: jest.fn().mockImplementation(() => ({
    generateLeads: jest.fn().mockResolvedValue([]),
    getLastRunSourceReport: jest.fn().mockReturnValue({}),
    getSourceAnalytics: jest.fn().mockReturnValue({ sources: [] }),
  })),
}))
jest.mock('@/lib/lead-discovery/lead-aggregator', () => ({
  LeadAggregator: jest.fn().mockImplementation(() => ({
    aggregate: jest.fn().mockResolvedValue([]),
  })),
}))
jest.mock('@/lib/lead-discovery/lead-scoring-service', () => ({
  LeadScoringService: jest.fn().mockImplementation(() => ({
    generateAndScoreLeads: jest.fn().mockResolvedValue([]),
    getScoringInsights: jest.fn().mockReturnValue(null),
  })),
}))

import { POST as generatePOST, GET as generateGET } from '@/app/api/leads/generate/route'
import { POST as scorePOST, GET as scoreGET } from '@/app/api/leads/score/route'

const ORIGINAL_ENV = process.env

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, LEAD_API_KEY: 'test-lead-key-123' }
})

afterEach(() => {
  process.env = ORIGINAL_ENV
})

function makeNextRequest(body: unknown, apiKey?: string): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey !== undefined) {
    headers['x-api-key'] = apiKey
  }
  return new NextRequest('http://localhost/api/leads/test', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

// ============================================================
// /api/leads/generate
// ============================================================
describe('T1.3: /api/leads/generate auth', () => {
  it('POST without x-api-key → 401', async () => {
    const req = makeNextRequest({ companies: [] })
    const res = await generatePOST(req)
    expect(res.status).toBe(401)
  })

  it('POST with wrong x-api-key → 401', async () => {
    const req = makeNextRequest({ companies: [] }, 'wrong-key')
    const res = await generatePOST(req)
    expect(res.status).toBe(401)
  })

  it('POST with correct x-api-key → success (non-401)', async () => {
    const req = makeNextRequest({ companies: [] }, 'test-lead-key-123')
    const res = await generatePOST(req)
    expect(res.status).not.toBe(401)
  })

  it('GET remains open (no auth required)', async () => {
    const res = await generateGET()
    expect(res.status).toBe(200)
  })
})

// ============================================================
// /api/leads/score
// ============================================================
describe('T1.3: /api/leads/score auth', () => {
  it('POST without x-api-key → 401', async () => {
    const req = makeNextRequest({ agencyProfile: { industries: ['IT'] } })
    const res = await scorePOST(req)
    expect(res.status).toBe(401)
  })

  it('POST with wrong x-api-key → 401', async () => {
    const req = makeNextRequest({ agencyProfile: { industries: ['IT'] } }, 'wrong')
    const res = await scorePOST(req)
    expect(res.status).toBe(401)
  })

  it('POST with correct x-api-key → success (non-401)', async () => {
    const req = makeNextRequest({ agencyProfile: { industries: ['IT'] } }, 'test-lead-key-123')
    const res = await scorePOST(req)
    expect(res.status).not.toBe(401)
  })

  it('GET remains open (no auth required)', async () => {
    const res = await scoreGET()
    expect(res.status).toBe(200)
  })
})

// ============================================================
// Error message leak check (C-8)
// ============================================================
describe('T1.3: 500 responses must not leak error details', () => {
  it('generate route 500 does not expose details field', async () => {
    // Send malformed JSON to trigger catch block
    const req = new NextRequest('http://localhost/api/leads/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'x-api-key': 'test-lead-key-123' },
      body: 'not json{{{',
    })
    const res = await generatePOST(req)
    if (res.status === 500) {
      const body = await res.json()
      expect(body.details).toBeUndefined()
    }
  })

  it('score route 500 does not expose details field', async () => {
    const req = new NextRequest('http://localhost/api/leads/score', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'x-api-key': 'test-lead-key-123' },
      body: 'not json{{{',
    })
    const res = await scorePOST(req)
    if (res.status === 500) {
      const body = await res.json()
      expect(body.details).toBeUndefined()
    }
  })

  it('generate route does not disclose credential environment names when unconfigured', async () => {
    process.env = { ...ORIGINAL_ENV }
    delete process.env.LEAD_API_KEY
    delete process.env.DIGEST_API_KEY

    const res = await generatePOST(makeNextRequest({ companies: [] }))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(JSON.stringify(body)).not.toContain('LEAD_API_KEY')
    expect(JSON.stringify(body)).not.toContain('DIGEST_API_KEY')
  })

  it('score route does not disclose credential environment names when unconfigured', async () => {
    process.env = { ...ORIGINAL_ENV }
    delete process.env.LEAD_API_KEY
    delete process.env.DIGEST_API_KEY

    const res = await scorePOST(makeNextRequest({ agencyProfile: { industries: ['IT'] } }))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(JSON.stringify(body)).not.toContain('LEAD_API_KEY')
    expect(JSON.stringify(body)).not.toContain('DIGEST_API_KEY')
  })
})
