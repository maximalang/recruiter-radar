import { pathToFileURL } from 'node:url'

const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/

export function assertPublicReadiness(payload, expectedDeploySha) {
  if (!FULL_COMMIT_SHA.test(expectedDeploySha)) {
    throw new Error('Expected deploy SHA must be a full lowercase commit SHA.')
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Public health response must be a JSON object.')
  }
  const expected = {
    status: 'healthy',
    deploySha: expectedDeploySha,
    database: 'ok',
    migrations: 'current',
    configuration: 'ready',
  }
  const actual = {
    status: payload.status,
    deploySha: payload.version?.deploySha,
    database: payload.checks?.database,
    migrations: payload.checks?.migrations,
    configuration: payload.checks?.configuration,
  }
  for (const [name, expectedValue] of Object.entries(expected)) {
    if (actual[name] !== expectedValue) {
      throw new Error(
        `Public readiness ${name} mismatch: expected ${expectedValue}, received ${String(actual[name])}.`,
      )
    }
  }
  if (!['ok', 'unavailable'].includes(payload.checks?.redis)) {
    throw new Error('Public readiness Redis status must be ok or unavailable.')
  }
  return actual
}

async function verifyRoute(origin, path) {
  const response = await fetch(new URL(path, origin), {
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) {
    throw new Error(`Critical route ${path} returned HTTP ${response.status}.`)
  }
}

async function main() {
  const [originValue, expectedDeploySha] = process.argv.slice(2)
  if (!originValue || !expectedDeploySha) {
    throw new Error('Usage: verify-public-readiness.mjs <origin> <expected-deploy-sha>')
  }
  const origin = new URL(originValue)
  const healthResponse = await fetch(new URL('/api/health', origin), {
    signal: AbortSignal.timeout(30_000),
  })
  if (!healthResponse.ok) {
    throw new Error(`Public health returned HTTP ${healthResponse.status}.`)
  }
  const readiness = assertPublicReadiness(await healthResponse.json(), expectedDeploySha)
  await Promise.all([
    verifyRoute(origin, '/'),
    verifyRoute(origin, '/login'),
  ])
  process.stdout.write(`${JSON.stringify({ ok: true, ...readiness, criticalRoutes: ['/', '/login'] })}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
