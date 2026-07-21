import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const script = readFileSync(
  resolve(process.cwd(), '..', '..', 'packages', 'db', 'scripts', 'verify-sources-live-config.mjs'),
  'utf8',
)

describe('source live readiness contract', () => {
  it('requires the named launch sources and no blockers', () => {
    expect(script).toContain("const REQUIRED_LAUNCH_SOURCES = ['hh', 'career-pages']")
    expect(script).toContain('REQUIRED_LAUNCH_SOURCES.every')
    expect(script).toContain('results.blockers.length === 0')
  })

  it('recognizes the conventional career-page target inventory when present', () => {
    expect(script).toContain("resolve(scriptDir, 'career-pages-targets.json')")
    expect(script).toContain('existsSync(defaultCareerPageTargets)')
  })

  it('treats the public Rabota Rossii source as environment-independent', () => {
    expect(script).toMatch(/case 'rabota-rossii':[\s\S]*?result\.productionReady = true;/)
    expect(script).not.toContain("process.env.RABOTA_ROSSII_SEARCH_TEXT || !process.env.DATABASE_URL")
  })
})
