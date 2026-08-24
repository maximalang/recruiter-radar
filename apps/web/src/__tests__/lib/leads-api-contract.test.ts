import { NextRequest } from 'next/server'

const mockGenerateLeads = jest.fn().mockResolvedValue([])
const mockScoreExistingLeads = jest.fn().mockResolvedValue([])
const mockGenerateAndScoreLeads = jest.fn().mockResolvedValue([])

jest.mock('@/lib/lead-discovery/multi-source-lead-generator', () => ({
  MultiSourceLeadGenerator: jest.fn().mockImplementation(() => ({
    generateLeads: mockGenerateLeads,
    getLastRunSourceReport: jest.fn().mockReturnValue({}),
    getSourceAnalytics: jest.fn().mockReturnValue({ sources: [] }),
  })),
}))

jest.mock('@/lib/lead-discovery/lead-scoring-service', () => ({
  LeadScoringService: jest.fn().mockImplementation(() => ({
    scoreExistingLeads: mockScoreExistingLeads,
    generateAndScoreLeads: mockGenerateAndScoreLeads,
    getScoringInsights: jest.fn().mockReturnValue(null),
  })),
}))

import { POST as generatePOST } from '@/app/api/leads/generate/route'
import { POST as scorePOST } from '@/app/api/leads/score/route'

const ORIGINAL_ENV = process.env

function makeRequest(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': 'lead-contract-key',
    },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env = { ...ORIGINAL_ENV, LEAD_API_KEY: 'lead-contract-key' }
  mockGenerateLeads.mockResolvedValue([])
  mockScoreExistingLeads.mockResolvedValue([])
  mockGenerateAndScoreLeads.mockResolvedValue([])
})

afterAll(() => {
  process.env = ORIGINAL_ENV
})

describe('/api/leads/generate source selection contract', () => {
  it('preserves an omitted sources filter for canonical defaults', async () => {
    await generatePOST(makeRequest('/api/leads/generate', {}))

    expect(mockGenerateLeads).toHaveBeenCalledWith(
      expect.not.objectContaining({ sources: expect.anything() }),
    )
  })

  it('preserves an explicit empty source selection', async () => {
    await generatePOST(makeRequest('/api/leads/generate', { sources: [] }))

    expect(mockGenerateLeads).toHaveBeenCalledWith(
      expect.objectContaining({ sources: [] }),
    )
  })

  it('preserves an explicit registered source selection', async () => {
    await generatePOST(makeRequest('/api/leads/generate', { sources: ['hh'] }))

    expect(mockGenerateLeads).toHaveBeenCalledWith(
      expect.objectContaining({ sources: ['hh'] }),
    )
  })

  it('returns the canonical zero average for an empty result', async () => {
    const response = await generatePOST(makeRequest('/api/leads/generate', {}))
    const payload = await response.json()

    expect(payload.data.summary).toMatchObject({
      totalLeads: 0,
      avgScore: 0,
      confidenceBreakdown: { A: 0, B: 0, C: 0, D: 0 },
      sourceCoverage: {},
    })
  })

  it.each([0, -1, 1.5, 501, '100', null])(
    'rejects invalid maxResults=%p before running generation',
    async (maxResults) => {
      const response = await generatePOST(makeRequest('/api/leads/generate', { maxResults }))
      const payload = await response.json()

      expect(response.status).toBe(400)
      expect(payload.error).toMatch(/maxResults must be an integer/)
      expect(mockGenerateLeads).not.toHaveBeenCalled()
    },
  )
})

describe('/api/leads/score source selection contract', () => {
  const agencyProfile = { industries: ['IT'] }

  it('preserves an omitted sources filter for canonical defaults', async () => {
    await scorePOST(makeRequest('/api/leads/score', { agencyProfile }))

    expect(mockGenerateAndScoreLeads).toHaveBeenCalledWith(
      expect.not.objectContaining({ sources: expect.anything() }),
    )
  })

  it('preserves an explicit empty source selection', async () => {
    await scorePOST(makeRequest('/api/leads/score', { agencyProfile, sources: [] }))

    expect(mockGenerateAndScoreLeads).toHaveBeenCalledWith(
      expect.objectContaining({ sources: [] }),
    )
  })

  it('preserves an explicit registered source selection', async () => {
    await scorePOST(makeRequest('/api/leads/score', { agencyProfile, sources: ['hh'] }))

    expect(mockGenerateAndScoreLeads).toHaveBeenCalledWith(
      expect.objectContaining({ sources: ['hh'] }),
    )
  })

  it('returns the canonical zero average for an empty result', async () => {
    const response = await scorePOST(makeRequest('/api/leads/score', { agencyProfile }))
    const payload = await response.json()

    expect(payload.data.summary).toMatchObject({
      totalLeads: 0,
      avgScore: 0,
      confidenceBreakdown: { A: 0, B: 0, C: 0, D: 0 },
      sourceCoverage: {},
    })
  })

  it.each([0, -1, 1.5, 501, '100', null])(
    'rejects invalid maxResults=%p before running scoring',
    async (maxResults) => {
      const response = await scorePOST(makeRequest('/api/leads/score', { agencyProfile, maxResults }))
      const payload = await response.json()

      expect(response.status).toBe(400)
      expect(payload.error).toMatch(/maxResults must be an integer/)
      expect(mockGenerateAndScoreLeads).not.toHaveBeenCalled()
    },
  )
})
