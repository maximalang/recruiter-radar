import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const migrationPath = resolve(
  process.cwd(),
  '..',
  '..',
  'packages',
  'db',
  'migrations',
  '20260804100000_add_company_state_v1.sql',
)
const rollbackPath = resolve(
  process.cwd(),
  '..',
  '..',
  'packages',
  'db',
  'migrations',
  '20260804100000_add_company_state_v1.down.sql',
)

describe('Company State v1 migration contract', () => {
  const migration = readFileSync(migrationPath, 'utf8')
  const rollback = readFileSync(rollbackPath, 'utf8')
  const compactMigration = migration.replace(/\s+/g, ' ')

  it('stores explicit snapshots and state changes without switching readers', () => {
    for (const table of [
      'company_state_snapshots',
      'company_state_snapshot_events',
      'company_state_snapshot_evidence',
      'company_state_changes',
      'company_state_change_events',
      'company_state_change_evidence',
    ]) {
      expect(migration).toMatch(new RegExp(`CREATE TABLE ${table}\\b`))
    }
    expect(migration).not.toMatch(/UPDATE\s+(hiring_episodes|opportunities)/i)
    expect(migration).not.toMatch(/INSERT\s+INTO\s+(hiring_episodes|opportunities)/i)
  })

  it('persists the required baseline dimensions and explicit low-history state', () => {
    for (const column of [
      'hiring_baseline JSONB NOT NULL',
      'current_hiring_velocity JSONB NOT NULL',
      'role_distribution JSONB NOT NULL',
      'seniority_distribution JSONB NOT NULL',
      'region_distribution JSONB NOT NULL',
      'vacancy_lifetime JSONB NOT NULL',
      'repost_rate JSONB NOT NULL',
      'recruiting_capacity_signals JSONB NOT NULL',
      'business_change_signals JSONB NOT NULL',
      'state_classification TEXT NOT NULL',
      'state_confidence DOUBLE PRECISION NOT NULL',
      'feature_version TEXT NOT NULL',
      'evidence_hash TEXT NOT NULL',
      'input_hash TEXT NOT NULL',
    ]) {
      expect(compactMigration).toContain(column)
    }
    expect(compactMigration).toContain(
      "state_classification IN ( 'insufficient_history', 'accelerating', 'steady', 'slowing' )",
    )
  })

  it('enforces tenant-safe event and evidence provenance', () => {
    expect(compactMigration).toContain(
      'FOREIGN KEY (company_event_id, organization_id) REFERENCES company_events(id, organization_id)',
    )
    expect(compactMigration).toContain(
      'FOREIGN KEY (evidence_id, organization_id) REFERENCES evidence_items(id, org_id)',
    )
    expect(compactMigration).toContain(
      'FOREIGN KEY (snapshot_id, organization_id) REFERENCES company_state_snapshots(id, organization_id)',
    )
    expect(migration).toContain('validate_company_state_snapshot_evidence')
    expect(migration).toContain('validate_company_state_change_evidence')
  })

  it('constrains hashes, confidence, windows, and deterministic replay', () => {
    expect(compactMigration).toContain(
      'UNIQUE (organization_id, feature_version, input_hash)',
    )
    expect(compactMigration).toContain(
      'UNIQUE (organization_id, feature_version, change_fingerprint)',
    )
    expect(compactMigration).toContain('state_confidence BETWEEN 0 AND 1')
    expect(compactMigration).toContain('confidence BETWEEN 0 AND 1')
    expect(compactMigration).toContain("evidence_hash ~ '^[a-f0-9]{64}$'")
    expect(compactMigration).toContain("input_hash ~ '^[a-f0-9]{64}$'")
    expect(compactMigration).toContain(
      'observation_ended_at <= snapshot_at',
    )
  })

  it('makes snapshots, changes, and provenance append-only', () => {
    expect(migration).toContain('company state records are append-only')
    for (const table of [
      'company_state_snapshots',
      'company_state_snapshot_events',
      'company_state_snapshot_evidence',
      'company_state_changes',
      'company_state_change_events',
      'company_state_change_evidence',
    ]) {
      expect(compactMigration).toContain(
        `BEFORE UPDATE OR DELETE ON ${table}`,
      )
    }
  })

  it('refuses data-loss rollback under an exclusive parent lock', () => {
    expect(rollback.indexOf(
      'LOCK TABLE company_state_snapshots IN ACCESS EXCLUSIVE MODE',
    )).toBeLessThan(
      rollback.indexOf('IF EXISTS (SELECT 1 FROM company_state_snapshots)'),
    )
    expect(rollback).toContain('company state v1 rollback refused')
    expect(rollback.indexOf('DROP TABLE company_state_change_evidence')).toBeLessThan(
      rollback.indexOf('DROP TABLE company_state_changes'),
    )
    expect(rollback.indexOf('DROP TABLE company_state_changes')).toBeLessThan(
      rollback.indexOf('DROP TABLE company_state_snapshots'),
    )
  })
})
