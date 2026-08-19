import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const workflow = readFileSync(
  resolve(process.cwd(), '..', '..', '.github', 'workflows', 'test.yml'),
  'utf8',
)
const productionAcceptance = readFileSync(
  resolve(process.cwd(), '..', '..', 'scripts', 'run-production-acceptance.mjs'),
  'utf8',
)
const hardeningSmokeWorkflow = readFileSync(
  resolve(process.cwd(), '..', '..', '.github', 'workflows', 'hardening-smoke.yml'),
  'utf8',
)
const smokeVerifier = readFileSync(
  resolve(process.cwd(), '..', '..', 'packages', 'db', 'scripts', 'verify-smoke.mjs'),
  'utf8',
)
const browserRunners = [
  resolve(process.cwd(), 'scripts', 'verify-landing-production.mjs'),
  resolve(process.cwd(), '..', '..', 'scripts', 'verify-responsive-surfaces.mjs'),
  resolve(process.cwd(), '..', '..', 'packages', 'db', 'scripts', 'run-auth-v2-account-team-e2e.mjs'),
  resolve(process.cwd(), '..', '..', 'packages', 'db', 'scripts', 'run-auth-v2-passkey-e2e.mjs'),
].map((path) => readFileSync(path, 'utf8'))
const authBrowserRunners = browserRunners.slice(2)

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
      'production-acceptance:',
      'security-audit:',
      'docker-build:',
    ]) {
      expect(workflow).toContain(job)
    }
  })

  it('runs migration and production acceptance against a disposable database', () => {
    expect(workflow).toContain('npm run test:entitlements:migration:db')
    expect(workflow).toContain('npm run test:production:acceptance')
    expect(workflow).not.toContain('playwright install-deps chromium')
    expect(workflow).not.toContain('playwright install --with-deps chromium')
    expect(productionAcceptance).toContain('run-workspace-billing-db-tests.mjs')
    expect(workflow).toContain("ENTITLEMENT_DISPOSABLE_DB_CONFIRMED: 'true'")
    expect(workflow).toContain("WORKSPACE_BILLING_DISPOSABLE_DB_CONFIRMED: 'true'")
  })

  it('uses and verifies the runner image browser without a region-dependent download', () => {
    expect(workflow).toContain(
      'PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: /usr/bin/google-chrome',
    )
    expect(workflow).toContain('test -x "$PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"')
    expect(workflow).toContain('"$PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH" --version')
    for (const runner of browserRunners) {
      expect(runner).toContain('process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH')
    }
  })

  it('generates ignored browser icon assets before direct Next.js auth runs', () => {
    for (const runner of authBrowserRunners) {
      expect(runner).toContain("'generate-app-icons.mjs'")
      expect(runner).toContain('await run(process.execPath, [iconGenerationScript]')
    }
  })

  it('acknowledges source lineage writes only on the disposable hardening database', () => {
    expect(hardeningSmokeWorkflow).toContain('POSTGRES_DB: test')
    expect(hardeningSmokeWorkflow).toContain(
      'DATABASE_URL: postgres://postgres:postgres@127.0.0.1:5432/test',
    )
    expect(hardeningSmokeWorkflow).toContain(
      'SOURCE_IDENTITY_LINEAGE_DB_TEST_ACK: isolated',
    )
    expect(smokeVerifier).toContain(
      "'./verify-source-identity-lineage.mjs'",
    )
  })

  it('runs landing and responsive browser audits and retains evidence artifacts', () => {
    expect(workflow).toContain('npm run test:types --workspace @recruiter-radar/web')
    expect(workflow).toContain('npm run test:landing:e2e')
    expect(workflow).toContain('npm run test:responsive-surfaces')
    expect(workflow).toContain("LANDING_REQUIRE_ANALYTICS_CONSENT: 'true'")
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
    expect(workflow).toMatch(/Upload Playwright screenshots and traces\s+if: always\(\)/)
    expect(workflow).toContain('playwright-report')
    expect(workflow).toContain('test-results')
  })
})
