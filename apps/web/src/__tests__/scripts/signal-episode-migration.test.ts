import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const migrationPath = resolve(
  process.cwd(),
  '..',
  '..',
  'packages',
  'db',
  'migrations',
  '20260804110000_add_signal_episodes_v2.sql',
)
const rollbackPath = resolve(
  process.cwd(),
  '..',
  '..',
  'packages',
  'db',
  'migrations',
  '20260804110000_add_signal_episodes_v2.down.sql',
)

describe('Signal Episodes v2 migration contract', () => {
  const migration = readFileSync(migrationPath, 'utf8')
  const rollback = readFileSync(rollbackPath, 'utf8')
  const compactMigration = migration.replace(/\s+/g, ' ')

  it('adds a separate episode layer without switching legacy readers', () => {
    for (const table of [
      'signal_episodes',
      'signal_episode_state_changes',
      'signal_episode_events',
      'signal_episode_evidence',
    ]) {
      expect(migration).toMatch(new RegExp(`CREATE TABLE ${table}\\b`))
    }
    expect(migration).not.toMatch(/UPDATE\s+(hiring_episodes|opportunities)/i)
    expect(migration).not.toMatch(/INSERT\s+INTO\s+(hiring_episodes|opportunities)/i)
  })

  it('stores the complete episode contract and all supported types', () => {
    for (const column of [
      'episode_type TEXT NOT NULL',
      'stage TEXT NOT NULL',
      'started_at TIMESTAMPTZ NOT NULL',
      'last_seen_at TIMESTAMPTZ NOT NULL',
      'valid_until TIMESTAMPTZ NOT NULL',
      'intensity DOUBLE PRECISION NOT NULL',
      'direction TEXT NOT NULL',
      'baseline_deviation DOUBLE PRECISION',
      'role_families TEXT[] NOT NULL',
      'regions TEXT[] NOT NULL',
      'seniority_distribution JSONB NOT NULL',
      'problem_hypotheses TEXT[] NOT NULL',
      'evidence_hash TEXT NOT NULL',
      'engine_version TEXT NOT NULL',
    ]) {
      expect(compactMigration).toContain(column)
    }
    for (const type of [
      'vacancy_acceleration',
      'persistent_hiring_problem',
      'role_cluster',
      'new_region_expansion',
      'hiring_restart',
      'sustained_hiring',
      'leadership_led_expansion',
      'recruiting_capacity_gap',
      'new_unit_buildout',
      'business_expansion',
      'reactivation_window',
    ]) {
      expect(migration).toContain(`'${type}'`)
    }
  })

  it('binds state changes, events, and evidence to the same organization', () => {
    expect(compactMigration).toContain(
      'FOREIGN KEY (company_state_change_id, organization_id) REFERENCES company_state_changes(id, organization_id)',
    )
    expect(compactMigration).toContain(
      'FOREIGN KEY (company_event_id, organization_id) REFERENCES company_events(id, organization_id)',
    )
    expect(compactMigration).toContain(
      'FOREIGN KEY (evidence_id, organization_id) REFERENCES evidence_items(id, org_id)',
    )
    expect(migration).toContain('validate_signal_episode_evidence')
  })

  it('is append-only, bounded, and idempotent by generation and input', () => {
    expect(compactMigration).toContain(
      'UNIQUE (organization_id, engine_version, episode_identity, episode_generation)',
    )
    expect(compactMigration).toContain(
      'UNIQUE (organization_id, engine_version, input_hash)',
    )
    expect(compactMigration).toContain('intensity BETWEEN 0 AND 1')
    expect(compactMigration).toContain('started_at <= last_seen_at')
    expect(compactMigration).toContain('last_seen_at < valid_until')
    for (const table of [
      'signal_episodes',
      'signal_episode_state_changes',
      'signal_episode_events',
      'signal_episode_evidence',
    ]) {
      expect(compactMigration).toContain(`BEFORE UPDATE OR DELETE ON ${table}`)
    }
  })

  it('refuses a data-loss rollback before dropping dependencies in reverse order', () => {
    expect(rollback.indexOf(
      'LOCK TABLE signal_episodes IN ACCESS EXCLUSIVE MODE',
    )).toBeLessThan(
      rollback.indexOf('IF EXISTS (SELECT 1 FROM signal_episodes)'),
    )
    expect(rollback).toContain('signal episodes v2 rollback refused')
    expect(rollback.indexOf('DROP TABLE signal_episode_evidence')).toBeLessThan(
      rollback.indexOf('DROP TABLE signal_episodes'),
    )
  })
})
