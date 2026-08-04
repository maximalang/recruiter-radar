import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(process.cwd(), '..', '..')
const migrations = resolve(root, 'packages', 'db', 'migrations')
const migration = readFileSync(resolve(
  migrations,
  '20260804130000_add_external_agency_propensity_v1.sql',
), 'utf8')
const rollback = readFileSync(resolve(
  migrations,
  '20260804130000_add_external_agency_propensity_v1.down.sql',
), 'utf8')
const rootPackage = readFileSync(resolve(root, 'package.json'), 'utf8')
const testWorkflow = readFileSync(
  resolve(root, '.github', 'workflows', 'test.yml'),
  'utf8',
)
const dbRunner = readFileSync(resolve(
  root,
  'packages',
  'db',
  'scripts',
  'run-external-agency-propensity-v1-db-tests.mjs',
), 'utf8')
const compact = migration.replace(/\s+/g, ' ')

describe('External Agency Propensity v1 migration contract', () => {
  it('adds an isolated tenant-scoped snapshot layer', () => {
    expect(migration).toMatch(
      /CREATE TABLE external_agency_propensity_snapshots\b/,
    )
    expect(migration).toMatch(
      /CREATE TABLE external_agency_propensity_evidence\b/,
    )
    expect(migration).not.toMatch(/UPDATE\s+(opportunities|hiring_episodes)/i)
    expect(migration).not.toMatch(/INSERT\s+INTO\s+(opportunities|hiring_episodes)/i)
  })

  it('stores the required reproducible output without a probability', () => {
    for (const column of [
      'commercial_thesis_generation INTEGER NOT NULL',
      'agency_dna_version BIGINT NOT NULL',
      'agency_dna_snapshot_hash TEXT NOT NULL',
      'propensity_identity TEXT NOT NULL',
      'propensity_generation INTEGER NOT NULL',
      'score NUMERIC(6, 5) NOT NULL',
      'level TEXT NOT NULL',
      'positive_reasons JSONB NOT NULL',
      'negative_reasons JSONB NOT NULL',
      'feature_snapshot JSONB NOT NULL',
      'evidence_hash TEXT NOT NULL',
      'input_hash TEXT NOT NULL',
      'feature_version TEXT NOT NULL',
    ]) {
      expect(compact).toContain(column)
    }
    for (const level of ['high', 'medium', 'low', 'insufficient_evidence']) {
      expect(migration).toContain(`'${level}'`)
    }
    expect(compact).not.toMatch(/\bprobability\s+(NUMERIC|REAL|DOUBLE|JSONB|TEXT)/i)
    expect(compact).not.toMatch(/\beligibility\s+(BOOLEAN|JSONB|TEXT)/i)
  })

  it('binds profile, thesis, and evidence to one tenant and organization', () => {
    expect(compact).toContain(
      'FOREIGN KEY (client_profile_id, owner_id, workspace_id) REFERENCES client_profiles(id, owner_id, workspace_id)',
    )
    expect(compact).toContain(
      'FOREIGN KEY (commercial_thesis_id, organization_id) REFERENCES commercial_theses(id, organization_id)',
    )
    expect(compact).toContain(
      'FOREIGN KEY (evidence_id, organization_id) REFERENCES evidence_items(id, org_id)',
    )
    expect(migration).toContain('validate_external_agency_propensity_source')
    expect(migration).toContain('validate_external_agency_propensity_evidence')
    expect(migration).toContain('require_external_agency_propensity_evidence')
    expect(compact).toContain('DEFERRABLE INITIALLY DEFERRED')
  })

  it('validates reason basis and prevents evidence masquerading', () => {
    expect(migration).toContain('external_agency_propensity_reasons_valid')
    expect(compact).not.toContain('JSONB_ARRAY_LENGTH(reasons) > 0')
    for (const basis of ['evidence', 'agency_profile', 'policy']) {
      expect(migration).toContain(`'${basis}'`)
    }
    expect(compact).toContain(
      "item->>'basis' = 'evidence' AND JSONB_ARRAY_LENGTH(item->'evidenceIds') = 0",
    )
    expect(compact).toContain(
      "item->>'basis' <> 'evidence' AND JSONB_ARRAY_LENGTH(item->'evidenceIds') <> 0",
    )
  })

  it('is append-only and idempotent by identity generation and input', () => {
    expect(compact).toMatch(
      /UNIQUE \(\s*workspace_id, client_profile_id, organization_id, feature_version, propensity_identity, propensity_generation\s*\)/,
    )
    expect(compact).toMatch(
      /UNIQUE \(\s*workspace_id, client_profile_id, organization_id, feature_version, input_hash\s*\)/,
    )
    expect(compact).toContain(
      'BEFORE UPDATE OR DELETE ON external_agency_propensity_snapshots',
    )
    expect(compact).toContain(
      'BEFORE UPDATE OR DELETE ON external_agency_propensity_evidence',
    )
  })

  it('locks and refuses a data-loss rollback', () => {
    expect(rollback.indexOf(
      'LOCK TABLE external_agency_propensity_snapshots IN ACCESS EXCLUSIVE MODE',
    )).toBeLessThan(
      rollback.indexOf(
        'IF EXISTS (SELECT 1 FROM external_agency_propensity_snapshots)',
      ),
    )
    expect(rollback).toContain('external agency propensity v1 rollback refused')
    expect(rollback.indexOf('DROP TABLE external_agency_propensity_evidence'))
      .toBeLessThan(
        rollback.indexOf('DROP TABLE external_agency_propensity_snapshots'),
      )
  })

  it('registers an isolated PostgreSQL runtime gate after Commercial Thesis', () => {
    expect(rootPackage).toContain('"test:external-agency-propensity-v1:db"')
    expect(dbRunner).toContain('EXTERNAL_AGENCY_PROPENSITY_V1_DB_TEST_ACK')
    expect(dbRunner).toContain('external-agency-propensity-runtime-db.test.ts')
    expect(dbRunner).toContain('verify-external-agency-propensity-v1.mjs')
    const thesisGate = testWorkflow.indexOf(
      'run: npm run test:commercial-theses-v1:db',
    )
    const propensityGate = testWorkflow.indexOf(
      'run: npm run test:external-agency-propensity-v1:db',
    )
    expect(thesisGate).toBeGreaterThan(-1)
    expect(propensityGate).toBeGreaterThan(thesisGate)
  })
})
