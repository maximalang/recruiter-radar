import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const migrationPath = resolve(
  process.cwd(),
  '..',
  '..',
  'packages',
  'db',
  'migrations',
  '20260801100000_add_agency_dna_v1.sql',
)
const rollbackPath = resolve(
  process.cwd(),
  '..',
  '..',
  'packages',
  'db',
  'migrations',
  '20260801100000_add_agency_dna_v1.down.sql',
)
const backfillPath = resolve(
  process.cwd(),
  '..',
  '..',
  'packages',
  'db',
  'scripts',
  'backfill-agency-dna-v1.mjs',
)

describe('Agency DNA v1 migration contract', () => {
  const migration = readFileSync(migrationPath, 'utf8')
  const rollback = readFileSync(rollbackPath, 'utf8')
  const backfill = readFileSync(backfillPath, 'utf8')
  const compactMigration = migration.replace(/\s+/g, ' ')

  it('extends client_profiles without creating a parallel agency profile', () => {
    expect(migration).toContain('ALTER TABLE client_profiles')
    expect(migration).toContain('service_types TEXT[]')
    expect(migration).toContain('target_seniorities TEXT[]')
    expect(migration).toContain('minimum_engagement_value_minor BIGINT')
    expect(migration).toContain('preferred_engagement_types TEXT[]')
    expect(migration).toContain('case_studies JSONB')
    expect(migration).toContain('current_capacity TEXT')
    expect(migration).toContain('agency_dna_version BIGINT')
    expect(migration).toContain('agency_dna_snapshot_hash TEXT')
    expect(migration).not.toMatch(/CREATE TABLE\s+agency_profiles\b/i)
  })

  it('keeps account restrictions tenant-scoped and free of contact fields', () => {
    expect(migration).toContain('CREATE TABLE agency_account_restrictions')
    expect(compactMigration).toContain(
      'FOREIGN KEY (client_profile_id, owner_id, workspace_id)',
    )
    expect(compactMigration).toContain(
      'REFERENCES client_profiles(id, owner_id, workspace_id)',
    )
    expect(compactMigration).toContain(
      'FOREIGN KEY (workspace_id, created_by_user_id)',
    )
    expect(migration).toMatch(
      /restriction_type IN \([\s\S]*'existing_client'[\s\S]*'former_client'[\s\S]*'do_not_contact'[\s\S]*'conflict'/,
    )
    expect(migration).not.toMatch(/email|phone|contact_value/i)
  })

  it('records immutable opportunity snapshots without replacing the ledger', () => {
    expect(migration).toContain('CREATE TABLE opportunity_agency_dna_snapshots')
    expect(migration).toContain('agency_dna_version BIGINT NOT NULL')
    expect(migration).toContain('agency_dna_snapshot_hash TEXT NOT NULL')
    expect(migration).toContain('snapshot JSONB NOT NULL')
    expect(migration).toContain('capability_matches JSONB NOT NULL')
    expect(migration).toContain('restriction_snapshot JSONB NOT NULL')
    expect(migration).toContain('opportunity_agency_dna_snapshots_append_only')
    expect(migration).not.toMatch(/CREATE TABLE\s+.*outcome.*ledger/i)
  })

  it('versions only Agency DNA changes and leaves backfill explicit', () => {
    expect(migration).toContain('maintain_agency_dna_version')
    expect(migration).toContain('agency_dna_profile_snapshot')
    expect(migration).toContain('accountRestrictions')
    expect(migration).toContain('agency_account_restrictions_lock_profile')
    expect(migration).toContain('agency_account_restrictions_maintain_version')
    expect(migration).toContain('maintain_agency_dna_restriction_version')
    expect(migration).not.toMatch(
      /UPDATE\s+client_profiles\s+SET\s+agency_dna_snapshot_hash\s*=/i,
    )
    expect(backfill).toContain("args.includes('--apply')")
    expect(backfill).toContain("args.includes('--dry-run')")
    expect(backfill).toContain("args.indexOf('--workspace-id')")
    expect(backfill).toContain('agency_dna.backfill_completed')
  })

  it('refuses rollback after Agency DNA history exists', () => {
    expect(rollback).toContain('agency dna rollback refused')
    expect(rollback).toContain('opportunity_agency_dna_snapshots')
    expect(rollback).toContain('agency_account_restrictions')
    expect(rollback).toContain('DROP TRIGGER IF EXISTS client_profiles_maintain_agency_dna')
  })
})
