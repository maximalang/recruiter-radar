import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../../../../..')
const dockerfile = fs.readFileSync(path.join(root, 'apps/web/Dockerfile'), 'utf8')
const workflow = fs.readFileSync(path.join(root, '.github/workflows/test.yml'), 'utf8')

describe('source runtime final image', () => {
  it('ships the runtime verifier and MTProto dependency closure', () => {
    expect(dockerfile).toContain('verify-source-runtime-image.mjs')
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

  it('runs filesystem, browser, migration and health-table checks against the final image', () => {
    expect(workflow).toContain('Verify source runtime final image')
    expect(workflow).toContain('verify-source-runtime-image.mjs --filesystem --browser')
    expect(workflow).toContain('packages/db/scripts/migrate.mjs')
    expect(workflow).toContain('verify-source-runtime-image.mjs --database')
  })
})
