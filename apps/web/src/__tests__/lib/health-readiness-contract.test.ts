import { readdirSync } from 'node:fs'
import path from 'node:path'

import { EXPECTED_LATEST_MIGRATION } from '@/lib/health-readiness'

describe('health migration readiness contract', () => {
  it('tracks the latest forward migration in the repository', () => {
    const migrationsDirectory = path.resolve(process.cwd(), '../../packages/db/migrations')
    const latestMigration = readdirSync(migrationsDirectory)
      .filter((file) => file.endsWith('.sql') && !file.endsWith('.down.sql'))
      .sort()
      .at(-1)
      ?.replace(/\.sql$/, '')

    expect(EXPECTED_LATEST_MIGRATION).toBe(latestMigration)
  })
})
