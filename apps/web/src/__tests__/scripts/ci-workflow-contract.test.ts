import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const workflow = readFileSync(
  resolve(process.cwd(), '..', '..', '.github', 'workflows', 'test.yml'),
  'utf8',
)

describe('pull request CI workflow contract', () => {
  it('runs the complete release gate for codex pushes and integration pull requests', () => {
    expect(workflow).toContain('codex/**')
    expect(workflow).toContain('pull_request:')
    expect(workflow).toContain("branches: [ main, 'codex/**' ]")
    expect(workflow).toContain('group: ${{ github.workflow }}-${{ github.ref }}')
    expect(workflow).toContain('cancel-in-progress: true')

    for (const job of [
      'lint-and-types:',
      'unit-tests:',
      'web-build:',
      'landing-playwright:',
      'security-audit:',
      'docker-build:',
    ]) {
      expect(workflow).toContain(job)
    }
    expect(workflow).toContain('npm run test:company-events-v1:db')
  })

  it('runs landing and responsive browser audits and retains failure artifacts', () => {
    expect(workflow).toContain('npm run test:types --workspace @recruiter-radar/web')
    expect(workflow).toContain('npm run test:landing:e2e')
    expect(workflow).toContain('npm run test:responsive-surfaces')
    expect(workflow).toContain(
      'LANDING_ANALYTICS_RATE_LIMIT_SALT: test-landing-rate-limit-salt-at-least-32-characters',
    )
    expect(workflow).toContain(
      'PUBLIC_APP_ORIGIN: https://recruiter-radar.ru',
    )
    expect(workflow).toContain('node apps/web/scripts/prepare-standalone.mjs')
    expect(workflow).toContain('-o /tmp/landing-ready.html')
    expect(workflow).toContain('grep -q')
    expect(workflow).toContain('data-deploy-anchor="recruiter-radar-landing-v3"')
    expect(workflow).toContain(
      'node scripts/verify-production-server-log.mjs /tmp/landing-server.log',
    )
    expect(workflow.indexOf('- name: Stop production server')).toBeLessThan(
      workflow.indexOf('- name: Verify production server log'),
    )
    expect(workflow.indexOf('- name: Verify production server log')).toBeLessThan(
      workflow.indexOf('- name: Upload Playwright screenshots and traces'),
    )
    expect(workflow).toContain('if: always()')
    expect(workflow).toContain('playwright-report')
    expect(workflow).toContain('test-results')
  })
})
