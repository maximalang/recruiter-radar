import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repositoryRoot = resolve(process.cwd(), '..', '..')
const runnerPath = resolve(
  repositoryRoot,
  'scripts',
  'deploy',
  'run-commercial-signal-production-canary.sh',
)
const runner = existsSync(runnerPath) ? readFileSync(runnerPath, 'utf8') : ''
const workflow = readFileSync(
  resolve(repositoryRoot, '.github', 'workflows', 'deploy.yml'),
  'utf8',
)
const runbook = readFileSync(
  resolve(repositoryRoot, 'docs', 'commercial-signal-production-canary.md'),
  'utf8',
)
const testWorkflow = readFileSync(
  resolve(repositoryRoot, '.github', 'workflows', 'test.yml'),
  'utf8',
)

describe('Commercial Signal production canary host runner', () => {
  it('ships one deploy-installed operator entrypoint', () => {
    expect(existsSync(runnerPath)).toBe(true)
    expect(workflow).toContain(
      'bash -n scripts/deploy/run-commercial-signal-production-canary.sh',
    )
    expect(workflow).toContain(
      'run-commercial-signal-production-canary.${DEPLOY_SHA}.sh',
    )
    expect(workflow).toContain('rm -f -- "$staged_canary_runner"')
    expect(workflow).toContain(
      'mv "$staged_canary_runner" /opt/recruiter-radar/run-commercial-signal-production-canary.sh',
    )
    expect(testWorkflow).toContain(
      'bash scripts/test/commercial-signal-canary-host-runner.sh',
    )
  })

  it('holds the deploy lock and refuses unsafe or ambiguous scope', () => {
    expect(runner).toContain('/tmp/recruiter-radar-deployment.lock')
    expect(runner).toContain('flock -n 9')
    expect(runner).toContain('deployment_marker="$app_dir/.deployment-switched"')
    expect(runner).toContain('RUN_ONE_WORKSPACE_CANARY')
    expect(runner).toContain('RR_CANARY_EXPECTED_SHA')
    expect(runner).toContain('RR_CANARY_WORKSPACE_ID')
    expect(runner).toContain('COMMERCIAL_SIGNAL_ALLOWED_QUERY_SOURCES=rabota-rossii')
    expect(runner).toContain('enabled_flag_count')
    expect(runner).toContain('expected_image_id')
  })

  it('keeps the operator session alive and captures a failed runner explicitly', () => {
    expect(runner).toContain('canary_runner=active')
    expect(runner).toContain('RR_CANARY_HEARTBEAT_SECONDS')
    expect(runner).toContain('nohup docker compose exec -T')
    expect(runner).toContain('if wait "$runner_pid"; then')
    expect(runner).toContain('runner_status=$?')
    expect(runner).toContain("trap 'note_operator_signal HUP' HUP")
    expect(runner).toContain("trap '' PIPE")
  })

  it('archives any receipt before restoring the dark runtime', () => {
    const archiveFunction = runner.indexOf('archive_receipt_if_present()')
    const cleanupFunction = runner.indexOf('restore_dark_runtime()')
    const archiveDuringCleanup = runner.indexOf(
      'archive_receipt_if_present',
      cleanupFunction,
    )
    const restoreDuringCleanup = runner.indexOf(
      'restore_original_environment',
      cleanupFunction,
    )

    expect(archiveFunction).toBeGreaterThan(-1)
    expect(cleanupFunction).toBeGreaterThan(archiveFunction)
    expect(archiveDuringCleanup).toBeGreaterThan(cleanupFunction)
    expect(restoreDuringCleanup).toBeGreaterThan(archiveDuringCleanup)
    expect(runner).toContain('receipt_archived=true')
    expect(runner).toContain('rollback_dark=true')
    expect(runner).toContain('cmp -s -- "$environment_backup" "$environment_file"')
  })

  it('documents the durable host entrypoint and no-retry interrupt rule', () => {
    expect(runbook).toContain(
      '/opt/recruiter-radar/run-commercial-signal-production-canary.sh',
    )
    expect(runbook).toContain('canary_runner=active')
    expect(runbook).toContain('receipt_archived=true')
    expect(runbook).toContain('rollback_dark=true')
    expect(runbook).toContain('Do not start a second canary after an interrupted run')
  })
})
