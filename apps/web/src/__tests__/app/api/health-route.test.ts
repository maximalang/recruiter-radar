/** @jest-environment node */

jest.mock('@/lib/db-pool', () => ({
  getPool: jest.fn(),
}))

import { GET } from '@/app/api/health/route'
import { getPool } from '@/lib/db-pool'

const mockedGetPool = jest.mocked(getPool)
const DEPLOY_SHA = '9c343597a1e49175220d4c95134d4a03fb8bcd0d'

describe('public health route', () => {
  const originalDeploySha = process.env.RR_DEPLOY_SHA
  const originalPublicOrigin = process.env.PUBLIC_APP_ORIGIN
  const originalRedisUrl = process.env.REDIS_URL

  beforeEach(() => {
    process.env.RR_DEPLOY_SHA = DEPLOY_SHA
    process.env.PUBLIC_APP_ORIGIN = 'https://recruiter-radar.ru'
    delete process.env.REDIS_URL
    jest.clearAllMocks()
  })

  afterAll(() => {
    restore('RR_DEPLOY_SHA', originalDeploySha)
    restore('PUBLIC_APP_ORIGIN', originalPublicOrigin)
    restore('REDIS_URL', originalRedisUrl)
  })

  it('returns exact deploy and non-secret readiness assertions', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ ok: 1 }] })
      .mockResolvedValueOnce({ rows: [{ current: true }] })
    mockedGetPool.mockReturnValue({ query } as never)

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      status: 'healthy',
      db: 'ok',
      redis: 'unavailable',
      version: { deploySha: DEPLOY_SHA },
      checks: {
        database: 'ok',
        migrations: 'current',
        configuration: 'ready',
        redis: 'unavailable',
      },
      timestamp: expect.any(String),
    })
    expect(JSON.stringify(body)).not.toMatch(/DATABASE_URL|PUBLIC_APP_ORIGIN|secret|provider/i)
    expect(query).toHaveBeenNthCalledWith(2, expect.stringContaining('schema_migrations'), [expect.any(String)])
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('fails readiness when the expected migration is not applied', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ ok: 1 }] })
      .mockResolvedValueOnce({ rows: [{ current: false }] })
    mockedGetPool.mockReturnValue({ query } as never)

    const response = await GET()

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      status: 'unhealthy',
      checks: { database: 'ok', migrations: 'pending' },
    })
  })

  it('reports invalid deployment identity without exposing its raw value', async () => {
    process.env.RR_DEPLOY_SHA = 'not-a-sha-with-sensitive-context'
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ ok: 1 }] })
      .mockResolvedValueOnce({ rows: [{ current: true }] })
    mockedGetPool.mockReturnValue({ query } as never)

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.version.deploySha).toBeNull()
    expect(body.checks.configuration).toBe('incomplete')
    expect(JSON.stringify(body)).not.toContain('not-a-sha')
  })
})

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
