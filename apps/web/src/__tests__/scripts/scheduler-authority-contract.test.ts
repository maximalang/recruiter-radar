import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(process.cwd(), '..', '..')
const read = (...parts: string[]) => readFileSync(resolve(repoRoot, ...parts), 'utf8')

const dailyRadarWorkflow = read('.github', 'workflows', 'daily-radar-clock.yml')
const sourceRefreshWorkflow = read('.github', 'workflows', 'source-refresh-clock.yml')
const governmentWorkflow = read('.github', 'workflows', 'government-source-clocks.yml')
const railwayCron = read('cron', 'railway.toml')
const n8nDaily = JSON.parse(read('n8n', 'workflows', 'hh-daily.json')) as { active?: boolean }

describe('production scheduler authority', () => {
  it('keeps GitHub Actions as the only repository-authorized production clock', () => {
    expect(dailyRadarWorkflow).toContain('schedule:')
    expect(dailyRadarWorkflow).toContain("cron: '15 6 * * *'")
    expect(sourceRefreshWorkflow).toContain('schedule:')
    expect(governmentWorkflow).toContain('schedule:')

    expect(railwayCron).not.toMatch(/^\s*cronSchedule\s*=/m)
    expect(railwayCron).toContain('GitHub Actions is the only production clock authority')
    expect(n8nDaily.active).toBe(false)
  })

  it('keeps bounded retry/backoff in the daily GitHub clock', () => {
    expect(dailyRadarWorkflow).toContain('const maxAttempts = 3')
    expect(dailyRadarWorkflow).toContain("response.status === 207 || response.status >= 500")
    expect(dailyRadarWorkflow).toContain('attempt * 60_000')
  })
})
