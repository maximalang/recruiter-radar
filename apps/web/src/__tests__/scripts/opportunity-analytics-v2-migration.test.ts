import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const migration = read('20260801150000_add_opportunity_analytics_v2.sql')
const rollback = read('20260801150000_add_opportunity_analytics_v2.down.sql')
const assigneeGuard = read(
  '20260801151000_enforce_opportunity_analytics_assignee_scope.sql',
)
const assigneeGuardRollback = read(
  '20260801151000_enforce_opportunity_analytics_assignee_scope.down.sql',
)
const downVerifier = readScript('verify-opportunity-engine-down.mjs')

describe('Opportunity Analytics v2 migration contract', () => {
  it('adds immutable event-time assignment attribution without a backfill', () => {
    expect(migration).toContain('ADD COLUMN assigned_user_id BIGINT')
    expect(migration).toContain('opportunity_outcome_events_assigned_user_fkey')
    expect(migration).toContain('REFERENCES users(id)')
    expect(migration).not.toMatch(/UPDATE\s+opportunity_outcome_events/i)
  })

  it('refuses to erase captured attribution and participates in full rollback', () => {
    expect(rollback).toContain('assigned-user attribution exists')
    expect(rollback).toContain('DROP COLUMN assigned_user_id')
    expect(downVerifier).toContain(
      '20260801151000_enforce_opportunity_analytics_assignee_scope.down.sql',
    )
    expect(downVerifier).toContain(
      '20260801150000_add_opportunity_analytics_v2.down.sql',
    )
    expect(downVerifier).toContain('PRE_FIXTURE_DOWN_MIGRATIONS = 12')
  })

  it('enforces event-time assignee membership inside PostgreSQL', () => {
    expect(assigneeGuard).toContain('JOIN workspace_members member')
    expect(assigneeGuard).toContain(
      'member.workspace_id = opportunity.workspace_id',
    )
    expect(assigneeGuard).toContain('member.user_id = NEW.assigned_user_id')
    expect(assigneeGuard).toContain('FOR KEY SHARE OF member')
    expect(assigneeGuard).toContain(
      'outcome event assignee must belong to the opportunity workspace',
    )
    expect(assigneeGuardRollback).toContain(
      'DROP TRIGGER opportunity_outcome_events_assignee_scope',
    )
  })
})

function read(name: string) {
  return readFileSync(resolve(
    process.cwd(), '..', '..', 'packages', 'db', 'migrations', name,
  ), 'utf8')
}

function readScript(name: string) {
  return readFileSync(resolve(
    process.cwd(), '..', '..', 'packages', 'db', 'scripts', name,
  ), 'utf8')
}
