import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../../../../..')
const up = fs.readFileSync(path.join(root, 'packages/db/migrations/20260814050000_add_source_scheduler_state.sql'), 'utf8')
const down = fs.readFileSync(path.join(root, 'packages/db/migrations/20260814050000_add_source_scheduler_state.down.sql'), 'utf8')

test('adds persisted cadence and cooldown state without destructive data changes', () => {
  expect(up).toContain('CREATE TABLE source_scheduler_state')
  for (const field of [
    'expected_refresh_interval_seconds', 'next_eligible_run_at',
    'cooldown_until', 'last_scheduler_outcome', 'consecutive_failures',
  ]) expect(up).toContain(field)
  expect(up).not.toMatch(/DELETE\s+FROM|TRUNCATE|UPDATE\s+(signals|opportunities)/i)
  expect(down).toContain('DROP TABLE IF EXISTS source_scheduler_state')
})
