import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(process.cwd(), '..', '..')
const webPackage = JSON.parse(
  readFileSync(resolve(root, 'apps', 'web', 'package.json'), 'utf8'),
) as { dependencies?: Record<string, string> }
const lockfile = readFileSync(resolve(root, 'package-lock.json'), 'utf8')

describe('production dependency security contract', () => {
  it('does not ship the vulnerable Crawlee fingerprint dependency chain', () => {
    expect(webPackage.dependencies).not.toHaveProperty('crawlee')
    expect(lockfile).not.toContain('node_modules/generative-bayesian-network')
    expect(lockfile).not.toContain('node_modules/adm-zip')
  })
})
