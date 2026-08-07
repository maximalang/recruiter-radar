import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const migrationPath = resolve(
  process.cwd(),
  '..',
  '..',
  'packages',
  'db',
  'migrations',
  '20260801120000_add_opportunity_scoring_v2.sql',
)
const rollbackPath = resolve(
  process.cwd(),
  '..',
  '..',
  'packages',
  'db',
  'migrations',
  '20260801120000_add_opportunity_scoring_v2.down.sql',
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

describe('Opportunity Scoring v2 migration contract', () => {
  const migration = readFileSync(migrationPath, 'utf8')
  const rollback = readFileSync(rollbackPath, 'utf8')
  const downVerifier = readFileSync(downVerifierPath, 'utf8')
  const compactMigration = migration.replace(/\s+/g, ' ')

  it('extends opportunities with versioned v2 ranking state', () => {
    expect(migration).toContain('ALTER TABLE opportunities')
    expect(migration).toContain('feature_schema_version TEXT')
    expect(migration).toContain('gate_version TEXT')
    expect(migration).toContain('component_scores JSONB')
    expect(migration).toContain('hard_gate_results JSONB')
    expect(migration).toContain('ranking_score DOUBLE PRECISION')
    expect(migration).toContain('action_queue_eligible BOOLEAN')
    expect(migration).toContain("'opportunity-features-v1'")
    expect(migration).toContain("'opportunity-gates-v1'")
  })

  it('stores immutable, tenant-scoped scoring snapshots', () => {
    expect(migration).toContain('CREATE TABLE opportunity_scoring_snapshots')
    expect(compactMigration).toContain(
      'FOREIGN KEY (opportunity_id, owner_id, workspace_id)',
    )
    expect(compactMigration).toContain(
      'REFERENCES opportunities(id, owner_id, workspace_id)',
    )
    expect(compactMigration).toContain(
      'FOREIGN KEY (client_profile_id, owner_id, workspace_id)',
    )
    expect(compactMigration).toContain(
      'REFERENCES client_profiles(id, owner_id, workspace_id)',
    )
    expect(migration).toContain('opportunity_scoring_snapshots_append_only')
    expect(migration).toContain(
      'UNIQUE (opportunity_id, scoring_version, input_hash)',
    )
  })

  it('persists reproducibility and baseline comparison without probability claims', () => {
    expect(migration).toContain('baseline_scoring_version TEXT NOT NULL')
    expect(migration).toContain('profile_snapshot_hash TEXT NOT NULL')
    expect(migration).toContain('evidence_hash TEXT NOT NULL')
    expect(migration).toContain('config_hash TEXT NOT NULL')
    expect(migration).toContain('input_hash TEXT NOT NULL')
    expect(migration).toContain('comparison_input_hash TEXT NOT NULL')
    expect(migration).toContain('baseline_component_scores JSONB NOT NULL')
    expect(migration).toContain('baseline_ranking_score DOUBLE PRECISION NOT NULL')
    expect(migration).not.toMatch(/deal_probability|win_probability/i)
  })

  it('keeps personal contact data outside scoring persistence', () => {
    expect(migration).not.toMatch(/personal_email|personal_phone|contact_value/i)
    expect(migration).not.toMatch(/CREATE TABLE\s+.*outcome.*ledger/i)
  })

  it('refuses unsafe rollback and participates in the full down verifier', () => {
    expect(rollback).toContain('opportunity scoring v2 rollback refused')
    expect(rollback).toContain('opportunity_scoring_snapshots')
    expect(rollback).toContain("scoring_version LIKE 'opportunity-v2%'")
    expect(downVerifier).toContain(
      '20260801120000_add_opportunity_scoring_v2.down.sql',
    )
    expect(downVerifier).toContain('PRE_FIXTURE_DOWN_MIGRATIONS = 18')
  })
})
