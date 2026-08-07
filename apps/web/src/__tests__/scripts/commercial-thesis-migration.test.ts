import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const migrationPath = resolve(
  process.cwd(), '..', '..', 'packages', 'db', 'migrations',
  '20260804120000_add_commercial_theses_v1.sql',
)
const rollbackPath = resolve(
  process.cwd(), '..', '..', 'packages', 'db', 'migrations',
  '20260804120000_add_commercial_theses_v1.down.sql',
)

describe('Commercial Thesis v1 migration contract', () => {
  const migration = readFileSync(migrationPath, 'utf8')
  const rollback = readFileSync(rollbackPath, 'utf8')
  const compact = migration.replace(/\s+/g, ' ')

  it('adds an isolated thesis layer without writing legacy readers', () => {
    expect(migration).toMatch(/CREATE TABLE commercial_theses\b/)
    expect(migration).toMatch(/CREATE TABLE commercial_thesis_evidence\b/)
    expect(migration).not.toMatch(/UPDATE\s+(hiring_episodes|opportunities)/i)
    expect(migration).not.toMatch(/INSERT\s+INTO\s+(hiring_episodes|opportunities)/i)
  })

  it('stores every required structured section', () => {
    for (const column of [
      'what_changed JSONB NOT NULL',
      'signal_episode_generation INTEGER NOT NULL',
      'why_it_matters JSONB NOT NULL',
      'probable_hiring_problem JSONB NOT NULL',
      'why_external_agency_may_be_needed JSONB NOT NULL',
      'why_this_agency_fits JSONB NOT NULL',
      'why_now JSONB NOT NULL',
      'recommended_service JSONB NOT NULL',
      'recommended_persona JSONB NOT NULL',
      'recommended_angle JSONB NOT NULL',
      'risks JSONB NOT NULL',
      'limitations JSONB NOT NULL',
      'evidence_hash TEXT NOT NULL',
      'input_hash TEXT NOT NULL',
      'engine_version TEXT NOT NULL',
    ]) {
      expect(compact).toContain(column)
    }
    for (const classification of [
      'confirmed_fact',
      'rule_based_inference',
      'heuristic_hypothesis',
      'unknown',
    ]) {
      expect(migration).toContain(`'${classification}'`)
    }
    expect(compact).toContain(
      "JSONB_TYPEOF(item->'evidenceRefs') IS DISTINCT FROM 'array'",
    )
  })

  it('binds the source episode and evidence to one organization', () => {
    expect(compact).toContain(
      'FOREIGN KEY (signal_episode_id, organization_id) REFERENCES signal_episodes(id, organization_id)',
    )
    expect(compact).toContain(
      'FOREIGN KEY (evidence_id, organization_id) REFERENCES evidence_items(id, org_id)',
    )
    expect(migration).toContain('validate_commercial_thesis_source')
    expect(migration).toContain('validate_commercial_thesis_evidence')
    expect(migration).toContain('require_commercial_thesis_evidence')
    expect(compact).toContain('DEFERRABLE INITIALLY DEFERRED')
  })

  it('is append-only and idempotent by identity generation and input', () => {
    expect(compact).toContain(
      'UNIQUE (organization_id, engine_version, thesis_identity, thesis_generation)',
    )
    expect(compact).toContain(
      'UNIQUE (organization_id, engine_version, input_hash)',
    )
    expect(compact).toContain('BEFORE UPDATE OR DELETE ON commercial_theses')
    expect(compact).toContain(
      'BEFORE UPDATE OR DELETE ON commercial_thesis_evidence',
    )
  })

  it('locks and refuses a data-loss rollback', () => {
    expect(rollback.indexOf(
      'LOCK TABLE commercial_theses IN ACCESS EXCLUSIVE MODE',
    )).toBeLessThan(
      rollback.indexOf('IF EXISTS (SELECT 1 FROM commercial_theses)'),
    )
    expect(rollback).toContain('commercial thesis v1 rollback refused')
    expect(rollback.indexOf('DROP TABLE commercial_thesis_evidence'))
      .toBeLessThan(rollback.indexOf('DROP TABLE commercial_theses'))
  })
})
