import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const SHA = '9c343597a1e49175220d4c95134d4a03fb8bcd0d'
const SCRIPT = path.resolve(process.cwd(), '../../scripts/deploy/verify-public-readiness.mjs')

describe('public readiness verifier', () => {
  it('accepts the exact non-secret production contract', () => {
    expect(run({
      status: 'healthy',
      version: { deploySha: SHA },
      checks: {
        database: 'ok',
        migrations: 'current',
        configuration: 'ready',
        redis: 'unavailable',
      },
    })).toContain(`"deploySha":"${SHA}"`)
  })

  it.each([
    ['wrong SHA', { deploySha: '0'.repeat(40) }],
    ['pending migration', { migrations: 'pending' }],
    ['incomplete configuration', { configuration: 'incomplete' }],
  ])('rejects %s', (_label, patch) => {
    const payload = healthPayload(patch)
    expect(() => run(payload)).toThrow()
  })
})

function healthPayload(patch: {
  deploySha?: string
  migrations?: string
  configuration?: string
}) {
  return {
    status: 'healthy',
    version: { deploySha: patch.deploySha ?? SHA },
    checks: {
      database: 'ok',
      migrations: patch.migrations ?? 'current',
      configuration: patch.configuration ?? 'ready',
      redis: 'unavailable',
    },
  }
}

function run(payload: unknown): string {
  const moduleUrl = pathToFileURL(SCRIPT).href
  const expression = [
    `import(${JSON.stringify(moduleUrl)})`,
    `.then(({assertPublicReadiness}) => {`,
    `const result = assertPublicReadiness(JSON.parse(process.argv[1]), process.argv[2]);`,
    `process.stdout.write(JSON.stringify(result));`,
    `})`,
  ].join('')
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', expression, JSON.stringify(payload), SHA], {
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.status !== 0) throw new Error(result.stderr.trim())
  return result.stdout
}
