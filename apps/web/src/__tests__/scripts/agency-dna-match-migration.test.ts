import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(process.cwd(), '..', '..')
const migrations = resolve(root, 'packages', 'db', 'migrations')
const migration = readFileSync(resolve(
  migrations,
  '20260804140000_add_agency_dna_match_v2.sql',
), 'utf8')
const rollback = readFileSync(resolve(
  migrations,
  '20260804140000_add_agency_dna_match_v2.down.sql',
), 'utf8')
const parentVerifier = readFileSync(resolve(
  root,
  'packages',
  'db',
  'scripts',
  'verify-external-agency-propensity-v1.mjs',
), 'utf8')
const compact = migration.replace(/\s+/g, ' ')

describe('Agency DNA Match v2 migration contract', () => {
  it('extends the versioned Agency DNA with explicit missing dimensions', () => {
    for (const column of [
      'technology_qualification_tags TEXT[] NOT NULL',
      'preferred_regions TEXT[] NOT NULL',
      'minimum_fee_minor BIGINT',
      'average_fee_minor BIGINT',
      'minimum_opportunity_value_minor BIGINT',
      'undesirable_hiring_types TEXT[] NOT NULL',
    ]) {
      expect(compact).toContain(column)
    }
    for (const field of [
      'technologyQualificationTags',
      'preferredRegions',
      'minimumFeeMinor',
      'averageFeeMinor',
      'minimumOpportunityValueMinor',
      'undesirableHiringTypes',
    ]) {
      expect(migration).toContain(`'${field}'`)
    }
    expect(compact).toContain('DROP TRIGGER client_profiles_maintain_agency_dna')
    expect(compact).toContain('UPDATE client_profiles SET technology_qualification_tags = technology_qualification_tags')
  })

  it('adds an isolated tenant-scoped append-only match and evidence layer', () => {
    expect(migration).toMatch(/CREATE TABLE agency_dna_match_snapshots\b/)
    expect(migration).toMatch(/CREATE TABLE agency_dna_match_evidence\b/)
    expect(migration).not.toMatch(/UPDATE\s+(opportunities|hiring_episodes)/i)
    expect(migration).not.toMatch(/INSERT\s+INTO\s+(opportunities|hiring_episodes)/i)
    expect(compact).toContain(
      'FOREIGN KEY (client_profile_id, owner_id, workspace_id) REFERENCES client_profiles(id, owner_id, workspace_id)',
    )
    expect(compact).toContain(
      'REFERENCES external_agency_propensity_snapshots( id, organization_id, workspace_id, client_profile_id )',
    )
    expect(compact).toContain(
      'FOREIGN KEY (evidence_id, organization_id) REFERENCES evidence_items(id, org_id)',
    )
  })

  it('stores reproducible dimensions, mode calculations, and capacity policy', () => {
    for (const column of [
      'propensity_generation INTEGER NOT NULL',
      'agency_dna_version BIGINT NOT NULL',
      'agency_dna_snapshot_hash TEXT NOT NULL',
      'agency_dna_snapshot JSONB NOT NULL',
      'match_identity TEXT NOT NULL',
      'match_generation INTEGER NOT NULL',
      'fit_score NUMERIC(6, 5) NOT NULL',
      'coverage NUMERIC(6, 5) NOT NULL',
      'level TEXT NOT NULL',
      'dimensions JSONB NOT NULL',
      'reasons JSONB NOT NULL',
      'unknown_dimensions JSONB NOT NULL',
      'selection_policy JSONB NOT NULL',
      'modes JSONB NOT NULL',
      'feature_snapshot JSONB NOT NULL',
      'evidence_hash TEXT NOT NULL',
      'input_hash TEXT NOT NULL',
      'feature_version TEXT NOT NULL',
    ]) {
      expect(compact).toContain(column)
    }
    for (const mode of ['find', 'grow', 'reactivate']) {
      expect(migration).toContain(`'${mode}'`)
    }
    for (const capacity of ['low', 'normal', 'high']) {
      expect(migration).toContain(`'${capacity}'`)
    }
  })

  it('keeps evidence, profile, organization-record, and policy reasons distinct', () => {
    expect(migration).toContain('agency_dna_match_reasons_valid')
    for (const basis of [
      'evidence',
      'agency_profile',
      'organization_record',
      'policy',
    ]) {
      expect(migration).toContain(`'${basis}'`)
    }
    expect(compact).toContain(
      "item->>'basis' = 'evidence' AND JSONB_ARRAY_LENGTH(item->'evidenceIds') = 0",
    )
    expect(compact).toContain(
      "item->>'basis' <> 'evidence' AND JSONB_ARRAY_LENGTH(item->'evidenceIds') <> 0",
    )
  })

  it('binds the exact propensity, Agency DNA generation, and evidence lineage', () => {
    expect(migration).toContain('validate_agency_dna_match_source')
    expect(migration).toContain('validate_agency_dna_match_evidence')
    expect(migration).toContain('require_agency_dna_match_evidence')
    expect(compact).toContain('DEFERRABLE INITIALLY DEFERRED')
    expect(compact).toMatch(
      /UNIQUE \( workspace_id, client_profile_id, organization_id, feature_version, match_identity, match_generation \)/,
    )
    expect(compact).toMatch(
      /UNIQUE \( workspace_id, client_profile_id, organization_id, feature_version, input_hash \)/,
    )
  })

  it('makes match data immutable and refuses lossy rollback', () => {
    expect(compact).toContain(
      'BEFORE UPDATE OR DELETE ON agency_dna_match_snapshots',
    )
    expect(compact).toContain(
      'BEFORE UPDATE OR DELETE ON agency_dna_match_evidence',
    )
    expect(rollback).toContain(
      'LOCK TABLE agency_dna_match_snapshots IN ACCESS EXCLUSIVE MODE',
    )
    expect(rollback).toContain('agency DNA match v2 rollback refused')
    expect(rollback).toContain('Agency DNA v2 profile rollback refused')
    expect(rollback.indexOf('DROP TABLE agency_dna_match_evidence'))
      .toBeLessThan(rollback.indexOf('DROP TABLE agency_dna_match_snapshots'))
  })

  it('tears down the child schema before the parent propensity verifier', () => {
    const childDown = parentVerifier.indexOf('agencyDnaMatchDownSql')
    const childApply = parentVerifier.indexOf(
      'await database.query(agencyDnaMatchDownSql)',
    )
    const parentApply = parentVerifier.indexOf('await database.query(downSql)')

    expect(childDown).toBeGreaterThan(-1)
    expect(childApply).toBeGreaterThan(childDown)
    expect(parentApply).toBeGreaterThan(childApply)
    expect(parentVerifier).not.toContain('CASCADE')
  })
})
