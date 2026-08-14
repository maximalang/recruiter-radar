import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../../../../..')
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const targetScopeMigration = read('packages/db/migrations/20260814060000_add_source_target_run_scope.sql')
const targetScopeDown = read('packages/db/migrations/20260814060000_add_source_target_run_scope.down.sql')
const dailyLeaseMigration = read('packages/db/migrations/20260814070000_add_daily_radar_run_lease.sql')
const dailyLeaseDown = read('packages/db/migrations/20260814070000_add_daily_radar_run_lease.down.sql')
const careerRuntime = read('packages/db/scripts/source-career-pages-runtime.mjs')
const lifecycle = read('apps/web/lib/opportunities/canonical-vacancy-lifecycle-repository.ts')
const sourceSchedules = read('apps/web/lib/sources/source-schedules.ts')
const scheduledRefresh = read('apps/web/lib/lead-discovery/scheduled-source-refresh.ts')
const sourceClock = read('.github/workflows/source-refresh-clock.yml')
const dailyClock = read('.github/workflows/daily-radar-clock.yml')
const governmentClocks = read('.github/workflows/government-source-clocks.yml')
const productionPreflight = read('scripts/deploy/verify-source-production-runtime.sh')

describe('source runtime hardening contract', () => {
  it('persists target-scoped run provenance without changing the source inventory', () => {
    for (const column of [
      'scope TEXT',
      'execution_source_id TEXT',
      'organization_id BIGINT',
      'target_key TEXT',
      'target_outcome TEXT',
      'source_target_key TEXT',
    ]) expect(targetScopeMigration).toContain(column)
    expect(targetScopeMigration).toContain("scope IN ('source', 'target')")
    expect(targetScopeMigration).toContain("WHERE scope = 'target'")
    expect(targetScopeDown).toContain('DROP COLUMN IF EXISTS source_target_key')
  })

  it('maps unified career execution back to the exact provenance source and target', () => {
    expect(sourceSchedules).toContain('resolveSourceExecutionId')
    expect(sourceSchedules).toContain("resolveSourceExecutionId(source) === 'career-pages'")
    for (const adapter of [
      'greenhouse-board',
      'lever-postings',
      'ashby-job-board',
      'recruitee-careers',
      'workable-public-jobs',
      'smartrecruiters-postings',
    ]) expect(careerRuntime).toContain(adapter)
    expect(careerRuntime).toContain("execution_source_id")
    expect(careerRuntime).toContain("'career-pages', 'target'")
    expect(careerRuntime).toContain("payload->'raw'->>'raw_target_id'")
  })

  it('uses only exact successful target coverage as absence proof', () => {
    expect(lifecycle).toContain("scope = 'target'")
    expect(lifecycle).toContain("target_outcome IN ('parsed', 'no-vacancies-present')")
    expect(lifecycle).toContain('resolveSuccessfulAbsenceRunIds')
    expect(lifecycle).toContain('sourceTargetKeys')
    expect(lifecycle).not.toMatch(/target_outcome IN \([^)]*not-modified/i)
  })

  it('serializes scheduler processes while retaining persisted cadence state', () => {
    expect(scheduledRefresh).toContain('pg_try_advisory_lock')
    expect(scheduledRefresh).toContain('pg_advisory_unlock')
    expect(scheduledRefresh).toContain('runSupportingSourceScheduler')
    expect(scheduledRefresh).toContain('getPrimarySourceIds')
    expect(scheduledRefresh).toContain('getDailySupportingSourceIds')
  })

  it('has separate real clocks for source refresh, daily delivery, and official snapshots', () => {
    expect(sourceClock).toContain("cron: '45 * * * *'")
    expect(sourceClock).toContain('/api/cron/source-refresh')
    expect(dailyClock).toContain("cron: '15 6 * * *'")
    expect(dailyClock).toContain('/api/cron/daily-radar')
    for (const source of [
      'government-procurement',
      'rosstat-open-data',
      'fns-open-data',
      'rospatent-open-data',
    ]) expect(governmentClocks).toContain(source)
  })

  it('makes daily delivery idempotent and keeps schedule verification honest before merge', () => {
    expect(dailyLeaseMigration).toContain('CREATE TABLE daily_radar_run_state')
    expect(dailyLeaseMigration).toContain("status IN ('running', 'completed', 'failed')")
    expect(dailyLeaseDown).toContain('DROP TABLE IF EXISTS daily_radar_run_state')
    expect(productionPreflight).toContain('"productionScheduled":false')
    expect(productionPreflight).toContain('"scheduleAuthority":"github-actions"')
    expect(productionPreflight).toContain('"scheduleVerification":"external-after-merge"')
  })
})
