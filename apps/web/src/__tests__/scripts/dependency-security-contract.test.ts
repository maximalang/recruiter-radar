import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(process.cwd(), '..', '..')
const webPackage = JSON.parse(
  readFileSync(resolve(root, 'apps', 'web', 'package.json'), 'utf8'),
) as { dependencies?: Record<string, string> }
const lockfile = readFileSync(resolve(root, 'package-lock.json'), 'utf8')
const rootPackage = JSON.parse(
  readFileSync(resolve(root, 'package.json'), 'utf8'),
) as { dependencies?: Record<string, string> }
const parsedLockfile = JSON.parse(lockfile) as {
  packages?: Record<string, {
    version?: string
    resolved?: string
    integrity?: string
    license?: string
    scripts?: Record<string, string>
    dependencies?: Record<string, string>
  }>
}
const dockerfile = readFileSync(resolve(root, 'apps', 'web', 'Dockerfile'), 'utf8')

describe('production dependency security contract', () => {
  it('does not ship the vulnerable Crawlee fingerprint dependency chain', () => {
    expect(webPackage.dependencies).not.toHaveProperty('crawlee')
    expect(lockfile).not.toContain('node_modules/generative-bayesian-network')
    expect(lockfile).not.toContain('node_modules/adm-zip')
  })

  it('ships the browser executable required by the SPA crawler', () => {
    expect(dockerfile).toMatch(/apk add --no-cache[^\r\n]*\bchromium\b/)
    expect(dockerfile).toContain(
      'PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser',
    )
  })

  it('pins the audited MTProto runtime without install hooks or telemetry dependencies', () => {
    expect(rootPackage.dependencies?.teleproto).toBe('1.228.5')
    const runtime = parsedLockfile.packages?.['node_modules/teleproto']
    expect(runtime).toMatchObject({
      version: '1.228.5',
      resolved: 'https://registry.npmjs.org/teleproto/-/teleproto-1.228.5.tgz',
      license: 'MIT',
    })
    expect(runtime?.integrity).toMatch(/^sha512-/)
    expect(runtime?.scripts).toBeUndefined()
    expect(Object.keys(runtime?.dependencies ?? {}).sort()).toEqual([
      'big-integer', 'mime', 'node-localstorage', 'socks', 'store2',
    ])
    expect(Object.keys(runtime?.dependencies ?? {}).join(' ')).not.toMatch(
      /analytics|datadog|newrelic|posthog|segment|sentry|telemetry/i,
    )
  })
})
