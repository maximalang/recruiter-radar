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
const rootPackage = readFileSync(resolve(root, 'package.json'), 'utf8')
const testWorkflow = readFileSync(
  resolve(root, '.github', 'workflows', 'test.yml'),
  'utf8',
)
const ancestorRollbackVerifiers = [
  'verify-company-events-v1.mjs',
  'verify-company-state-v1.mjs',
  'verify-signal-episodes-v2.mjs',
  'verify-commercial-theses-v1.mjs',
].map((name) => ({
  name,
  source: readFileSync(resolve(root, 'packages', 'db', 'scripts', name), 'utf8'),
}))
const opportunityDownVerifier = readFileSync(resolve(
  root,
  'packages',
  'db',
  'scripts',
  'verify-opportunity-engine-down.mjs',
), 'utf8')
const dbRunner = readFileSync(resolve(
  root,
  'packages',
  'db',
  'scripts',
  'run-agency-dna-match-v2-db-tests.mjs',
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
    expect(compact).toContain(
      "NEW.feature_snapshot #>> '{propensity,episodeStage}' = propensity.feature_snapshot->>'episodeStage'",
    )
    expect(compact).toContain(
      "NEW.feature_snapshot #> '{company,roleFamilies}' = propensity.feature_snapshot->'roleFamilies'",
    )
    expect(compact).toContain(
      "NEW.feature_snapshot #> '{company,episodeRegions}' = TO_JSONB(ARRAY(",
    )
    expect(compact).toContain(
      "NEW.feature_snapshot #> '{company,remoteStatus}' = 'null'::JSONB",
    )
    expect(migration).toContain('agency_dna_match_normalized_text_array')
    expect(migration).toContain('agency_dna_match_specialization_terms')
    expect(migration).toContain('agency_dna_match_case_studies_equal')
    expect(compact).toContain(
      "NEW.feature_snapshot #> '{agency,roles}' = agency_dna_match_normalized_text_array(TO_JSONB(profile.roles))",
    )
    expect(compact).toContain(
      "NEW.feature_snapshot #>> '{agency,accountRestriction}' IS NOT DISTINCT FROM (",
    )
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
    expect(rollback).toContain(
      'DROP FUNCTION agency_dna_match_case_studies_equal(JSONB, JSONB)',
    )
    expect(rollback.indexOf('DROP TABLE agency_dna_match_evidence'))
      .toBeLessThan(rollback.indexOf('DROP TABLE agency_dna_match_snapshots'))
  })

  it('tears down the child schema before every ancestor verifier', () => {
    for (const { name, source } of [
      { name: 'verify-external-agency-propensity-v1.mjs', source: parentVerifier },
      ...ancestorRollbackVerifiers,
    ]) {
      const childDown = source.indexOf('agencyDnaMatchDownSql')
      const childApply = source.indexOf(
        'await database.query(agencyDnaMatchDownSql)',
      )
      const propensityApply = source.indexOf(
        'await database.query(externalAgencyPropensityDownSql)',
      )
      const directParentApply = source.indexOf('await database.query(downSql)')
      const parentApply = propensityApply > -1 ? propensityApply : directParentApply

      expect(childDown).toBeGreaterThan(-1)
      expect(childApply).toBeGreaterThan(childDown)
      expect(parentApply).toBeGreaterThan(childApply)
      expect(source).not.toContain('DROP TABLE agency_dna_match_snapshots CASCADE')
      expect(name).toMatch(/^verify-/)
    }

    const matchDown = opportunityDownVerifier.indexOf(
      "'20260804140000_add_agency_dna_match_v2.down.sql'",
    )
    const propensityDown = opportunityDownVerifier.indexOf(
      "'20260804130000_add_external_agency_propensity_v1.down.sql'",
    )
    expect(matchDown).toBeGreaterThan(-1)
    expect(propensityDown).toBeGreaterThan(matchDown)
    expect(opportunityDownVerifier).toContain(
      'const PRE_FIXTURE_DOWN_MIGRATIONS = 16',
    )
    expect(opportunityDownVerifier).not.toContain('CASCADE')
  })

  it('registers an isolated PostgreSQL gate after External Agency Propensity', () => {
    expect(rootPackage).toContain('"test:agency-dna-match-v2:db"')
    expect(dbRunner).toContain('AGENCY_DNA_MATCH_V2_DB_TEST_ACK')
    expect(dbRunner).toContain('agency-dna-match-runtime-db.test.ts')
    expect(dbRunner).toContain('verify-agency-dna-match-v2.mjs')
    const propensityGate = testWorkflow.indexOf(
      'run: npm run test:external-agency-propensity-v1:db',
    )
    const matchGate = testWorkflow.indexOf(
      'run: npm run test:agency-dna-match-v2:db',
    )
    expect(propensityGate).toBeGreaterThan(-1)
    expect(matchGate).toBeGreaterThan(propensityGate)
  })
})
