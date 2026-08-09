import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(__dirname, '../../../../..')

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

describe('runtime documentation contract', () => {
  const currentState = read('docs/CURRENT_STATE.md')
  const architecture = read('docs/architecture.md')
  const selfServe = read('docs/self-serve-mvp.md')
  const sourceRegistry = read('packages/db/scripts/source-registry.mjs')

  test('every registered source is represented in the current-state snapshot', () => {
    const sourceIds = new Set<string>()

    for (const match of sourceRegistry.matchAll(/\bid:\s*['"]([^'"]+)['"]/g)) {
      sourceIds.add(match[1])
    }

    expect(sourceIds.size).toBeGreaterThan(0)

    for (const sourceId of sourceIds) {
      expect(currentState).toContain(`\`${sourceId}\``)
    }
  })

  test('architecture does not hard-code a registry source count', () => {
    expect(architecture).not.toMatch(/\b\d+\s+(?:источник|источника|источников)\s+в\s+registry/iu)
    expect(architecture).toContain('status: active')
    expect(architecture).toContain('promotionStatus')
  })

  test('production orchestration is not documented as n8n-owned', () => {
    const combined = `${architecture}\n${selfServe}`

    expect(combined).not.toContain('n8n is orchestration only')
    expect(combined).not.toContain('## n8n setup')
    expect(combined).toContain('/api/cron/daily-radar')
    expect(combined).toContain('/api/cron/notification-delivery-retry')
  })

  test('external readiness blockers remain explicit', () => {
    expect(currentState).toContain('External blockers')
    expect(currentState).toContain('production secrets')
    expect(currentState).toContain('RF payment provider')
    expect(currentState).toContain('gold set')
  })
})
