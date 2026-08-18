/** @jest-environment node */

import { GET } from '@/app/api/version/route'

describe('public version route', () => {
  const originalGitSha = process.env.GIT_SHA
  const originalVercelGitSha = process.env.VERCEL_GIT_COMMIT_SHA
  const originalBuildTime = process.env.BUILD_TIME

  beforeEach(() => {
    process.env.GIT_SHA = '9c343597a1e49175220d4c95134d4a03fb8bcd0d'
    process.env.VERCEL_GIT_COMMIT_SHA = 'fallback-sha'
    process.env.BUILD_TIME = '2026-08-18T10:00:00.000Z'
  })

  afterAll(() => {
    restore('GIT_SHA', originalGitSha)
    restore('VERCEL_GIT_COMMIT_SHA', originalVercelGitSha)
    restore('BUILD_TIME', originalBuildTime)
  })

  it('returns runtime identity without allowing intermediary caching', async () => {
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
})

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
