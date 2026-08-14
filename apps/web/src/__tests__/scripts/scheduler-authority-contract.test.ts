import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(process.cwd(), '..', '..')
const read = (...parts: string[]) => readFileSync(resolve(repoRoot, ...parts), 'utf8')

const dailyRadarWorkflow = read('.github', 'workflows', 'daily-radar-clock.yml')
const sourceRefreshWorkflow = read('.github', 'workflows', 'source-refresh-clock.yml')
const governmentWorkflow = read('.github', 'workflows', 'government-source-clocks.yml')
const railwayCron = read('cron', 'railway.toml')
const n8nDaily = JSON.parse(read('n8n', 'workflows', 'hh-daily.json')) as { active?: boolean }
const readme = read('README.md')
const architecture = read('docs', 'architecture.md')
const schedulerRunbook = read('docs', 'runbooks', 'production-scheduler-authority.md')
const governmentRunbook = read('docs', 'runbooks', 'government-source-trust-and-lifecycle.md')
const hostUpgradeRunbook = read('docs', 'production-host-upgrade.md')
const n8nSetup = read('docs', 'n8n-setup.md')

describe('production scheduler authority', () => {
  it('keeps GitHub Actions as the only repository-authorized production clock', () => {
    expect(dailyRadarWorkflow).toContain('schedule:')
    expect(dailyRadarWorkflow).toContain("cron: '15 6 * * *'")
    expect(dailyRadarWorkflow).toContain("cron: '15 9 * * *'")
    expect(sourceRefreshWorkflow).toContain('schedule:')
    expect(governmentWorkflow).toContain('schedule:')

    expect(railwayCron).not.toMatch(/^\s*cronSchedule\s*=/m)
    expect(railwayCron).toContain('GitHub Actions is the only production clock authority')
    expect(n8nDaily.active).toBe(false)
    expect(readme).not.toContain('VPS cron через `/api/cron/daily-radar`')
    expect(architecture).not.toContain('VPS cron + product APIs')
    expect(schedulerRunbook).toContain('09:15 UTC recovery probe')
    expect(governmentRunbook).toContain('Do not install a second host cron')
    expect(hostUpgradeRunbook).not.toContain('daily radar: `run-daily-radar.sh`')
    expect(hostUpgradeRunbook).toContain('never install `run-daily-radar.sh`')
    expect(n8nSetup).toContain('Do not activate HH Daily')
  })

  it('keeps retry eligibility in PostgreSQL and uses GitHub only as primary/recovery triggers', () => {
    expect(dailyRadarWorkflow).not.toContain('const maxAttempts')
    expect(dailyRadarWorkflow).not.toContain('setTimeout')
    expect(dailyRadarWorkflow).toContain("body?.reason === 'retry-backoff'")
    expect(dailyRadarWorkflow).toContain("body?.reason === 'already-running'")
    expect(dailyRadarWorkflow).toContain("body?.reason === 'attempt-limit'")
    expect(dailyRadarWorkflow).toContain("trigger='primary'")
    expect(dailyRadarWorkflow).toContain("trigger='recovery'")
    expect(dailyRadarWorkflow).toContain('-e DAILY_RADAR_TRIGGER="$DAILY_RADAR_TRIGGER"')
  })
})
