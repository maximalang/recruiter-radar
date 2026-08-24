import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('responsive audit visual readiness', () => {
  it('retries visual readiness when an auth redirect destroys the page context', () => {
    const audit = readFileSync(
      resolve(process.cwd(), '..', '..', 'scripts', 'verify-responsive-surfaces.mjs'),
      'utf8',
    )

    expect(audit).toContain('RETRYABLE_CONTEXT_ERROR')
    expect(audit).toContain('Execution context was destroyed')
    expect(audit).toContain("await page.waitForLoadState('load'")
    expect(audit).toContain('const settledUrl = page.url()')
    expect(audit).toContain('if (page.url() === settledUrl) return')
    expect(audit).not.toContain("waitForLoadState('networkidle'")
  })
})
