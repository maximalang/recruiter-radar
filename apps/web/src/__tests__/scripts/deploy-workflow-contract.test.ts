import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const workflow = readFileSync(
  resolve(process.cwd(), '..', '..', '.github', 'workflows', 'deploy.yml'),
  'utf8',
)
const dockerfile = readFileSync(
  resolve(process.cwd(), 'Dockerfile'),
  'utf8',
)
const caddyConfigurator = readFileSync(
  resolve(process.cwd(), '..', '..', 'scripts', 'deploy', 'configure-caddy-real-ip.sh'),
  'utf8',
)
const runtimeConfigurator = readFileSync(
  resolve(process.cwd(), '..', '..', 'scripts', 'deploy', 'configure-notification-encryption.sh'),
  'utf8',
)
const testWorkflow = readFileSync(
  resolve(process.cwd(), '..', '..', '.github', 'workflows', 'test.yml'),
  'utf8',
)
const caddySmoke = readFileSync(
  resolve(process.cwd(), '..', '..', 'scripts', 'test', 'landing-events-caddy-smoke.sh'),
  'utf8',
)
const paymentReconciliationWorkflow = readFileSync(
  resolve(
    process.cwd(),
    '..',
    '..',
    '.github',
    'workflows',
    'payment-telemetry-reconciliation.yml',
  ),
  'utf8',
)
const dockerEntrypoint = readFileSync(
  resolve(process.cwd(), 'docker-entrypoint.sh'),
  'utf8',
)
const rollbackGuard = readFileSync(
  resolve(process.cwd(), '..', '..', 'scripts', 'deploy', 'rollback-guard.sh'),
  'utf8',
)
const deploymentRecovery = readFileSync(
  resolve(process.cwd(), '..', '..', 'scripts', 'deploy', 'recover-deployment.sh'),
  'utf8',
)
const paymentReconciliationScript = readFileSync(
  resolve(
    process.cwd(),
    '..',
    '..',
    'packages',
    'db',
    'scripts',
    'reconcile-payment-success-telemetry.mjs',
  ),
  'utf8',
)
const metrikaValidator = readFileSync(
  resolve(
    process.cwd(),
    '..',
    '..',
    'scripts',
    'deploy',
    'validate-metrika-id.sh',
  ),
  'utf8',
)

describe('production deploy workflow contract', () => {
  it('deploys main only after the Tests workflow succeeds', () => {
    expect(workflow).toContain('workflow_run:')
    expect(workflow).toContain('workflows: [Tests]')
    expect(workflow).toContain("github.event.workflow_run.conclusion == 'success'")
    expect(workflow).toContain("github.event.workflow_run.event == 'push'")
    expect(workflow).toContain("github.event.workflow_run.head_branch == 'main'")
  })

  it('checks out and tags the exact tested commit', () => {
    expect(workflow).toContain('github.event.workflow_run.head_sha')
    expect(workflow).toContain('recruiter-radar:${DEPLOY_SHA}')
    expect(workflow).not.toContain('docker build -f apps/web/Dockerfile -t recruiter-radar:latest')
    expect(workflow).toContain('--build-arg NEXT_PUBLIC_YANDEX_METRIKA_ID=')
    expect(workflow).toContain('scripts/deploy/validate-metrika-id.sh')
    expect(workflow).toContain(
      'METRIKA_ID: ${{ vars.NEXT_PUBLIC_YANDEX_METRIKA_ID }}',
    )
    expect(workflow).not.toContain(
      'metrika_id="${{ vars.NEXT_PUBLIC_YANDEX_METRIKA_ID }}"',
    )
    expect(metrikaValidator).toContain(
      'NEXT_PUBLIC_YANDEX_METRIKA_ID is missing or invalid',
    )
    expect(workflow).not.toContain('NEXT_PUBLIC_LANDING_ANALYTICS_ENDPOINT')
    expect(dockerfile).not.toContain('NEXT_PUBLIC_LANDING_ANALYTICS_ENDPOINT')
    expect(dockerfile).toContain('ENV PUBLIC_APP_ORIGIN="https://recruiter-radar.ru"')
  })

  it('validates production configuration before building the image', () => {
    const configurationPreflightIndex = workflow.indexOf(
      'Preflight production server configuration',
    )
    const dockerBuildIndex = workflow.indexOf('Build immutable Docker image')

    expect(configurationPreflightIndex).toBeGreaterThan(-1)
    expect(dockerBuildIndex).toBeGreaterThan(configurationPreflightIndex)
    expect(workflow).toContain(
      '/opt/recruiter-radar/configure-notification-encryption.sh --preflight',
    )
  })

  it('always cleans only the current SHA preflight helper when recovery is not pending', () => {
    const cleanupStart = workflow.indexOf(
      'name: Cleanup staged preflight configurator',
    )
    const rollbackJobStart = workflow.indexOf('\n  rollback:', cleanupStart)
    const cleanupStep = workflow.slice(cleanupStart, rollbackJobStart)

    expect(cleanupStart).toBeGreaterThan(-1)
    expect(rollbackJobStart).toBeGreaterThan(cleanupStart)
    expect(cleanupStep).toContain('if: always()')
    expect(cleanupStep).toContain(
      'staged_configurator="/opt/recruiter-radar/configure-notification-encryption.${DEPLOY_SHA}.sh"',
    )
    expect(cleanupStep).toContain(
      'deployment_marker="/opt/recruiter-radar/.deployment-switched"',
    )
    expect(cleanupStep).toContain(
      'if [ ! -e "$deployment_marker" ] && [ ! -L "$deployment_marker" ]; then',
    )
    expect(cleanupStep).toContain('rm -f -- "$staged_configurator"')
    expect(cleanupStep).not.toContain(
      'rm -f -- /opt/recruiter-radar/configure-notification-encryption.*.sh',
    )
  })

  it('keeps a rollback image and never deletes all unused images', () => {
    expect(workflow).toContain('recruiter-radar:rollback')
    expect(workflow).toContain('Rollback production deployment')
    expect(workflow).not.toContain('docker image prune -af')
  })

  it('persists the switched deployment and recovers on errors or signals', () => {
    expect(workflow).toContain('/opt/recruiter-radar/.deployment-switched')
    expect(workflow).toContain('rollback_guard_write_marker')
    expect(workflow).toContain('rollback_guard_finalize')
    expect(workflow).toContain('scripts/deploy/recover-deployment.sh')
    expect(workflow).toContain("needs.deploy.result == 'failure'")
    expect(workflow).toContain("needs.deploy.result == 'cancelled'")
    expect(workflow).not.toContain("steps.deploy.outcome == 'success'")
    expect(
      workflow.indexOf('Refuse unresolved production recovery state'),
    ).toBeLessThan(
      workflow.indexOf('Upload runtime configurator for preflight'),
    )
    expect(workflow).toContain(
      'Current production container is not running and healthy',
    )
    expect(workflow).toContain(
      'configure-notification-encryption.${DEPLOY_SHA}.sh',
    )
    expect(workflow).toContain(
      'mv "$staged_notification" /opt/recruiter-radar/configure-notification-encryption.sh',
    )
    expect(workflow).toContain('flock -w 180 9')
    expect(workflow).toContain('RR_DEPLOYMENT_LOCK_HELD=true')
    expect(workflow).toContain(
      'recover-deployment.external.${DEPLOY_SHA}.sh',
    )
    expect(
      workflow.indexOf('Upload isolated recovery helper'),
    ).toBeLessThan(
      workflow.indexOf('Recover marked deployment'),
    )
    expect(workflow).toContain(
      "docker image inspect --format '{{.Id}}' recruiter-radar:latest",
    )
    expect(workflow).not.toContain(
      "docker inspect --format '{{.Image}}' recruiter-radar:latest",
    )
    expect(rollbackGuard).toContain('trap rollback_on_int INT')
    expect(rollbackGuard).toContain('trap rollback_on_term TERM')
    expect(deploymentRecovery).toContain('previous_image_id')
    expect(deploymentRecovery).toContain('flock -w 180')
    expect(deploymentRecovery).toContain(
      'Previous production image is already running',
    )
    expect(deploymentRecovery).toContain('docker image inspect "$previous_image_id"')
    expect(deploymentRecovery).toContain('rm -f "$marker_path"')
  })

  it('configures a validated trusted client IP header before deployment', () => {
    expect(workflow).toContain('configure-caddy-real-ip.sh')
    expect(caddyConfigurator).toContain('target_site_line="recruiter-radar.ru {"')
    expect(caddyConfigurator).toContain('$0 == target_site_line')
    expect(caddyConfigurator).toContain('proxy_layout')
    expect(caddyConfigurator).toContain('header_up X-Real-IP {remote_host}')
    expect(caddyConfigurator).toContain('header_up X-Forwarded-Proto https')
    expect(caddyConfigurator).toContain('header_up Host recruiter-radar.ru')
    expect(caddyConfigurator).toContain('Trust boundary')
    expect(caddyConfigurator).toContain(
      'Unknown reverse_proxy directives found; refusing an unsafe Caddyfile rewrite.',
    )
    expect(caddyConfigurator).toContain('restored_validation_status')
    expect(caddyConfigurator).toContain('Caddyfile.restore.')
    expect(caddyConfigurator).toContain(
      'mv "$restore_temporary_path" "$config_path"',
    )
    expect(caddyConfigurator).toContain('CanReload')
    expect(caddyConfigurator).toContain(
      'caddy reload --config "$config_path" --adapter caddyfile',
    )
    expect(caddyConfigurator).toContain('reload_caddy')
    expect(caddyConfigurator).toContain('previous configuration was restored')
    expect(caddyConfigurator).toContain('exit "$reload_status"')
    expect(testWorkflow).toContain('scripts/test/configure-caddy-production.sh')
  })

  it('binds Node to loopback and requires the production analytics salt', () => {
    expect(runtimeConfigurator).toContain('127.0.0.1:3000:3000')
    expect(runtimeConfigurator).toContain('ports: !override')
    expect(runtimeConfigurator).toContain('LANDING_ANALYTICS_RATE_LIMIT_SALT is required')
    expect(runtimeConfigurator).toContain(
      'LANDING_ANALYTICS_RATE_LIMIT_SALT: ${LANDING_ANALYTICS_RATE_LIMIT_SALT:?',
    )
    expect(runtimeConfigurator).toContain('Preserve the caller stdin so an SSH deployment heredoc continues')
    expect(runtimeConfigurator).toContain("  ' </dev/null")
  })

  it('runs landing events through a real Caddy container', () => {
    expect(testWorkflow).toContain('Caddy landing events smoke')
    expect(testWorkflow).toContain('scripts/test/landing-events-caddy-smoke.sh')
    expect(caddySmoke).toContain('caddy:2-alpine')
    expect(caddySmoke).toContain('header_up X-Real-IP {remote_host}')
    expect(caddySmoke).toContain('header_up X-Forwarded-Proto https')
    expect(caddySmoke).toContain('header_up Host recruiter-radar.ru')
    expect(caddySmoke).toContain('landing-events-smoke')
    expect(workflow).toContain('"dryRun":true')
  })

  it('validates stack pull requests with the Opportunity Engine database gates', () => {
    const pullRequestSection = testWorkflow.slice(
      testWorkflow.indexOf('pull_request:'),
      testWorkflow.indexOf('concurrency:'),
    )

    expect(pullRequestSection).toContain("'codex/**'")
    expect(testWorkflow).toContain('npm run test:opportunity-engine:db')
    expect(testWorkflow).toContain('npm run test:opportunity-engine:down')
  })

  it('reconciles payment telemetry after migrations without blocking startup', () => {
    const migrationIndex = dockerEntrypoint.indexOf(
      'node packages/db/scripts/migrate.mjs',
    )
    const reconciliationIndex = dockerEntrypoint.indexOf(
      'node packages/db/scripts/reconcile-payment-success-telemetry.mjs',
    )
    const applicationIndex = dockerEntrypoint.indexOf(
      'exec node apps/web/server.js',
    )

    expect(migrationIndex).toBeGreaterThan(-1)
    expect(reconciliationIndex).toBeGreaterThan(migrationIndex)
    expect(applicationIndex).toBeGreaterThan(reconciliationIndex)
    expect(dockerEntrypoint).toContain('timeout -s TERM 45')
    expect(dockerEntrypoint).toContain(
      'Payment telemetry reconciliation failed; application startup continues.',
    )
  })

  it('runs the idempotent payment reconciliation daily under a process lock', () => {
    expect(paymentReconciliationWorkflow).toContain('schedule:')
    expect(paymentReconciliationWorkflow).toContain("cron: '")
    expect(paymentReconciliationWorkflow).toContain('flock -n')
    expect(paymentReconciliationWorkflow).toContain(
      'test -n "${DATABASE_URL:-}"',
    )
    expect(paymentReconciliationWorkflow).toContain(
      'packages/db/scripts/reconcile-payment-success-telemetry.mjs',
    )
    expect(paymentReconciliationScript).toContain(
      'WITH paid_orders AS MATERIALIZED',
    )
    expect(paymentReconciliationScript).toContain(
      'statement_timeout: 30_000',
    )
    for (const summaryField of [
      'scanned',
      'inserted',
      'already_present',
      'failed',
    ]) {
      expect(paymentReconciliationScript).toContain(summaryField)
    }
  })

  it('uses stable server-rendered deploy markers rather than mutable landing copy', () => {
    expect(workflow).toContain('data-deploy-anchor="recruiter-radar-landing-v3"')
    expect(workflow).toContain('data-brand-header="recruiter-radar-v3"')
    expect(workflow).not.toContain('Каждый день Recruiter Radar находит лучшие компании')
    expect(workflow).not.toContain("grep -q 'data-mark=\"false\"'")
  })
})
