import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const migrationPath = resolve(
  process.cwd(),
  '..',
  '..',
  'packages',
  'db',
  'migrations',
  '20260801130000_add_opportunity_workflow_v1.sql',
)
const rollbackPath = resolve(
  process.cwd(),
  '..',
  '..',
  'packages',
  'db',
  'migrations',
  '20260801130000_add_opportunity_workflow_v1.down.sql',
)
const downVerifierPath = resolve(
  process.cwd(),
  '..',
  '..',
  'packages',
  'db',
  'scripts',
  'verify-opportunity-engine-down.mjs',
)

describe('Opportunity workflow v1 migration contract', () => {
  const migration = readFileSync(migrationPath, 'utf8')
  const rollback = readFileSync(rollbackPath, 'utf8')
  const downVerifier = readFileSync(downVerifierPath, 'utf8')
  const compactMigration = migration.replace(/\s+/g, ' ')

  it('adds an append-only workspace activity log with immutable actor context', () => {
    expect(migration).toContain('CREATE TABLE opportunity_workflow_events')
    expect(migration).toContain('opportunity_workflow_events_append_only')
    expect(migration).toContain('actor_user_id BIGINT NOT NULL')
    expect(migration).toContain('actor_workspace_id BIGINT NOT NULL')
    expect(migration).toContain('actor_role_snapshot TEXT NOT NULL')
    expect(migration).toContain('idempotency_key TEXT NOT NULL')
    expect(migration).toContain('payload_hash TEXT NOT NULL')
    expect(compactMigration).toContain(
      'FOREIGN KEY (opportunity_id, owner_id, workspace_id)',
    )
    expect(compactMigration).toContain(
      'REFERENCES opportunities(id, owner_id, workspace_id)',
    )
  })

  it('stores only the minimal workflow projection and no correspondence', () => {
    expect(migration).toContain('CREATE TABLE opportunity_workflow_state')
    expect(migration).toContain('assigned_to_user_id BIGINT')
    expect(migration).toContain('next_action_type TEXT')
    expect(migration).toContain('next_action_due_at TIMESTAMPTZ')
    expect(migration).toContain('workflow_priority TEXT NOT NULL')
    expect(migration).toContain('internal_note TEXT')
    expect(migration).not.toMatch(/message_body|thread_id|email_body|contact_value/i)
    expect(migration).not.toMatch(/analytics_snapshot/i)
  })

  it('constrains tenant identities, workflow values, note size, and query indexes', () => {
    expect(compactMigration).toContain(
      'FOREIGN KEY (workspace_id, assigned_to_user_id)',
    )
    expect(compactMigration).toContain(
      'REFERENCES workspace_members(workspace_id, user_id)',
    )
    expect(migration).toContain("next_action_type IN (")
    expect(migration).toContain("workflow_priority IN ('low', 'normal', 'high')")
    expect(migration).toContain('CHAR_LENGTH(internal_note) <= 2000')
    expect(migration).toContain('opportunity_workflow_state_today_idx')
    expect(migration).toContain('opportunity_workflow_state_assignee_idx')
  })

  it('refuses rollback after activity exists instead of deleting audit history', () => {
    expect(rollback).toContain('opportunity workflow v1 rollback refused')
    expect(rollback).toContain('opportunity_workflow_events')
    expect(rollback).toContain('opportunity_workflow_state')
    expect(downVerifier).toContain(
      '20260801130000_add_opportunity_workflow_v1.down.sql',
    )
    expect(downVerifier).toContain('PRE_FIXTURE_DOWN_MIGRATIONS = 11')
  })
})
