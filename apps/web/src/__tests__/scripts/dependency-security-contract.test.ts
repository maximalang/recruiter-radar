import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(process.cwd(), '..', '..')
const webPackage = JSON.parse(
  readFileSync(resolve(root, 'apps', 'web', 'package.json'), 'utf8'),
) as { dependencies?: Record<string, string> }
const lockfile = readFileSync(resolve(root, 'package-lock.json'), 'utf8')
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
})
