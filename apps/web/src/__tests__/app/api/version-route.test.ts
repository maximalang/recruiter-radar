/** @jest-environment node */

import { GET } from '@/app/api/version/route'

describe('public version route', () => {
  const originalDeploySha = process.env.RR_DEPLOY_SHA
  const originalVercelGitSha = process.env.VERCEL_GIT_COMMIT_SHA
  const originalBuildTime = process.env.BUILD_TIME

  beforeEach(() => {
    process.env.RR_DEPLOY_SHA = '9c343597a1e49175220d4c95134d4a03fb8bcd0d'
    process.env.VERCEL_GIT_COMMIT_SHA = 'fallback-sha'
    process.env.BUILD_TIME = '2026-08-18T10:00:00.000Z'
  })

  afterAll(() => {
    restore('RR_DEPLOY_SHA', originalDeploySha)
    restore('VERCEL_GIT_COMMIT_SHA', originalVercelGitSha)
    restore('BUILD_TIME', originalBuildTime)
  })

  it('returns validated deployment identity without allowing intermediary caching', async () => {
    const response = GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(body).toEqual({
      gitSha: '9c343597a1e49175220d4c95134d4a03fb8bcd0d',
      buildTime: '2026-08-18T10:00:00.000Z',
      environment: process.env.NODE_ENV ?? 'unknown',
      runtimeVersion: process.version,
    })
  })

  it('does not expose an invalid deployment identity', async () => {
    process.env.RR_DEPLOY_SHA = 'not-a-valid-sha'

    const response = GET()
    const body = await response.json()

    expect(body.gitSha).toBe('fallback-sha')
    expect(JSON.stringify(body)).not.toContain('not-a-valid-sha')
  })
})

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
