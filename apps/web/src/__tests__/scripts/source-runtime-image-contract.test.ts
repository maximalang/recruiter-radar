import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../../../../..')
const dockerfile = fs.readFileSync(path.join(root, 'apps/web/Dockerfile'), 'utf8')
const workflow = fs.readFileSync(path.join(root, '.github/workflows/test.yml'), 'utf8')
const verifier = fs.readFileSync(
  path.join(root, 'packages/db/scripts/verify-source-runtime-image.mjs'),
  'utf8',
)

describe('source runtime final image', () => {
  it('ships the runtime verifier, target observation wrapper and MTProto dependency closure', () => {
    expect(dockerfile).toContain('verify-source-runtime-image.mjs')
    expect(dockerfile).toContain('source-career-pages-runtime.mjs')
    expect(verifier).toContain("'source-career-pages-runtime.mjs'")
    expect(dockerfile).toContain('/app/packages/db/industry-media-feed-registry.json')
    expect(verifier).toContain("'packages/db/industry-media-feed-registry.json'")
    for (const dependency of [
      'teleproto',
      'big-integer',
      'mime',
      'node-localstorage',
      'store2',
      'write-file-atomic',
      'slide',
      'graceful-fs',
      'imurmurhash',
      'playwright',
      'playwright-core',
    ]) {
      expect(dockerfile).toContain(`/app/node_modules/${dependency}`)
    }
  })

  it('provides a non-root persistent state directory without auto-activating snapshots', () => {
    expect(dockerfile).toContain('SOURCE_RUNTIME_STATE_ROOT=/var/lib/recruiter-radar/source-state')
    expect(dockerfile).toContain('VOLUME ["/var/lib/recruiter-radar"]')
    expect(dockerfile).not.toMatch(/^ENV SOURCE_SNAPSHOT_ROOT=/m)
  })

  it('requires target-scope and daily-run migrations plus their database contracts', () => {
    expect(verifier).toContain('20260814060000_add_source_target_run_scope.sql')
    expect(verifier).toContain('20260814070000_add_daily_radar_run_lease.sql')
    expect(verifier).toContain("'daily_radar_run_state'")
    for (const column of [
      'execution_source_id',
      'organization_id',
      'target_key',
      'target_outcome',
      'source_target_key',
    ]) expect(verifier).toContain(column)
  })

  it('runs filesystem, browser, migration and health-table checks against the final image', () => {
    expect(workflow).toContain('Verify source runtime final image')
    expect(workflow).toContain('verify-source-runtime-image.mjs --filesystem --browser')
    expect(workflow).toContain('packages/db/scripts/migrate.mjs')
    expect(workflow).toContain('verify-source-runtime-image.mjs --database')
  })
})
