import { NextRequest } from 'next/server'

const mockIngestSource = jest.fn().mockResolvedValue({
  source: 'hh',
  success: true,
  outcome: 'expected-zero',
  fetchedCount: 0,
  upsertedCount: 0,
})
const mockIngestAllPrimarySources = jest.fn().mockResolvedValue([])

jest.mock('@/lib/lead-discovery/source-ingest', () => ({
  ingestSource: mockIngestSource,
  ingestAllPrimarySources: mockIngestAllPrimarySources,
  isNoActiveProfiles: jest.fn().mockReturnValue(false),
}))

jest.mock('@/lib/sources/source-registry', () => ({
  getAllSourceIds: jest.fn().mockReturnValue(['hh', 'career-pages']),
  getPrimarySourceIds: jest.fn().mockReturnValue(['hh']),
  getSourceRegistry: jest.fn().mockReturnValue([
    {
      id: 'hh',
      name: 'HH',
      category: 'job-board',
      requiredEnvVars: ['HH_API_TOKEN'],
      description: 'Hiring source',
    },
    {
      id: 'career-pages',
      name: 'Career pages',
      category: 'company-owned',
      requiredEnvVars: [],
      description: 'Company career pages',
    },
  ]),
}))

import { GET, POST } from '@/app/api/sources/ingest/route'

const ORIGINAL_ENV = process.env

function makeRequest(body: unknown, apiKey = 'ingest-test-key'): NextRequest {
  return new NextRequest('http://localhost/api/sources/ingest', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env = { ...ORIGINAL_ENV, INGEST_API_KEY: 'ingest-test-key' }
})

afterAll(() => {
  process.env = ORIGINAL_ENV
})

describe('/api/sources/ingest security contract', () => {
  it('does not disclose the credential environment variable when unconfigured', async () => {
    process.env = { ...ORIGINAL_ENV }
    delete process.env.INGEST_API_KEY

    const response = await POST(makeRequest({ source: 'hh' }))
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(JSON.stringify(payload)).not.toContain('INGEST_API_KEY')
  })

  it.each([
    null,
    [],
    { source: 42 },
    { sources: 'hh' },
    { sources: ['hh', 42] },
    { env: [] },
    { env: { HH_QUERY: 42 } },
  ])('rejects malformed payload %p before ingestion', async (body) => {
    const response = await POST(makeRequest(body))

    expect(response.status).toBe(400)
    expect(mockIngestSource).not.toHaveBeenCalled()
    expect(mockIngestAllPrimarySources).not.toHaveBeenCalled()
  })

  it('accepts a validated single-source request', async () => {
    const response = await POST(makeRequest({ source: 'hh', env: { HH_PROVIDER_API_URL: 'https://example.test' } }))

    expect(response.status).toBe(200)
    expect(mockIngestSource).toHaveBeenCalledWith('hh', { HH_PROVIDER_API_URL: 'https://example.test' })
  })

  it('does not expose required environment variable names in public GET metadata', async () => {
    const response = await GET()
    const payload = await response.json()
    const serialized = JSON.stringify(payload)

    expect(response.status).toBe(200)
    expect(serialized).not.toContain('HH_API_TOKEN')
    expect(payload.endpoints['/api/sources/ingest'].availableSources).toEqual([
      expect.objectContaining({ id: 'hh', requiresConfiguration: true }),
      expect.objectContaining({ id: 'career-pages', requiresConfiguration: false }),
    ])
  })
})
