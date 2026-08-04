import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../../../../..')
const migration = fs.readFileSync(path.join(
  root,
  'packages/db/migrations/20260804150000_add_opportunity_candidates_v3.sql',
), 'utf8')
const rollback = fs.readFileSync(path.join(
  root,
  'packages/db/migrations/20260804150000_add_opportunity_candidates_v3.down.sql',
), 'utf8')
const rootPackage = fs.readFileSync(path.join(root, 'package.json'), 'utf8')
const workflow = fs.readFileSync(path.join(root, '.github/workflows/test.yml'), 'utf8')
const downVerifier = fs.readFileSync(path.join(
  root,
  'packages/db/scripts/verify-opportunity-engine-down.mjs',
), 'utf8')
const ancestorVerifiers = [
  'verify-company-events-v1.mjs',
  'verify-company-state-v1.mjs',
  'verify-signal-episodes-v2.mjs',
  'verify-commercial-theses-v1.mjs',
  'verify-external-agency-propensity-v1.mjs',
  'verify-agency-dna-match-v2.mjs',
].map((name) => fs.readFileSync(path.join(
  root,
  'packages/db/scripts',
  name,
), 'utf8'))

describe('Opportunity Quality and Actionability v3 migration', () => {
  it('adds an append-only candidate layer without changing opportunities', () => {
    expect(migration).toMatch(/CREATE TABLE opportunity_candidates\b/)
    expect(migration).toMatch(/CREATE TABLE opportunity_candidate_evidence\b/)
    expect(migration).not.toMatch(/ALTER TABLE opportunities\b/)
    expect(migration).not.toMatch(/INSERT INTO opportunities\b/)
    expect(migration).toContain(
      'BEFORE UPDATE OR DELETE ON opportunity_candidates',
    )
    expect(migration).toContain(
      'BEFORE UPDATE OR DELETE ON opportunity_candidate_evidence',
    )
  })

  it('stores quality and actionability separately with versioned replay inputs', () => {
    for (const field of [
      'quality_score NUMERIC(6, 5) NOT NULL',
      'actionability_score NUMERIC(6, 5) NOT NULL',
      'ranking_score NUMERIC(6, 5) NOT NULL',
      'quality_components JSONB NOT NULL',
      'actionability_components JSONB NOT NULL',
      'hard_gates JSONB NOT NULL',
      'feature_snapshot JSONB NOT NULL',
      'evidence_hash TEXT NOT NULL',
      'input_hash TEXT NOT NULL',
      'score_version TEXT NOT NULL',
      'feature_schema_version TEXT NOT NULL',
      'gate_version TEXT NOT NULL',
      'rollout_mode TEXT NOT NULL',
      'fallback_scoring_version TEXT NOT NULL',
    ]) {
      expect(migration).toContain(field)
    }
    expect(migration).toContain("score_version = 'opportunity-v3'")
    expect(migration).toContain(
      "feature_schema_version = 'opportunity-quality-features-v3'",
    )
    expect(migration).toContain(
      "gate_version = 'opportunity-quality-gates-v3'",
    )
  })

  it('supports all v3 lifecycle states and a lossy legacy projection', () => {
    for (const status of [
      'qualified_actionable',
      'qualified_needs_enrichment',
      'review',
      'blocked',
      'expired',
      'dismissed',
    ]) {
      expect(migration).toContain(`'${status}'`)
    }
    for (const mode of ['find', 'grow', 'reactivate', 'blocked']) {
      expect(migration).toContain(`'${mode}'`)
    }
    expect(migration).toContain(
      "legacy_status_projection IN ('new', 'review', 'dismissed')",
    )
  })

  it('binds every candidate to exact tenant-scoped upstream lineage', () => {
    expect(migration).toContain('agency_dna_match_snapshot_id BIGINT NOT NULL')
    expect(migration).toContain('propensity_snapshot_id BIGINT NOT NULL')
    expect(migration).toContain('commercial_thesis_id BIGINT NOT NULL')
    expect(migration).toContain('signal_episode_id BIGINT NOT NULL')
    expect(migration).toContain('company_state_snapshot_id BIGINT NOT NULL')
    expect(migration).toContain('validate_opportunity_candidate_source')
    expect(migration).toContain(
      'match.workspace_id = NEW.workspace_id',
    )
    expect(migration).toContain(
      'match.client_profile_id = NEW.client_profile_id',
    )
    expect(migration).toContain(
      'match.propensity_snapshot_id = NEW.propensity_snapshot_id',
    )
    expect(migration).toContain(
      'propensity.commercial_thesis_id = NEW.commercial_thesis_id',
    )
    expect(migration).toContain(
      'thesis.signal_episode_id = NEW.signal_episode_id',
    )
    expect(migration).toContain(
      'state_change.snapshot_id = NEW.company_state_snapshot_id',
    )
  })

  it('rejects stale generations and evidence outside the Agency Match source', () => {
    expect(migration).toContain('validate_opportunity_candidate_generation')
    expect(migration).toContain('PG_ADVISORY_XACT_LOCK(HASHTEXTEXTENDED(')
    expect(migration).toContain(
      'opportunity candidate generation must append exactly once',
    )
    expect(migration).toContain('newer_match.match_generation > match.match_generation')
    expect(migration).toContain('stale Agency DNA Match source')
    expect(migration).toContain('validate_opportunity_candidate_evidence')
    expect(migration).toContain(
      'candidate evidence must come from its Agency DNA Match source',
    )
    expect(migration).toContain('require_opportunity_candidate_evidence')
  })

  it('permits only corporate path categories and stores no contact values', () => {
    for (const category of [
      'hr-email',
      'careers-email',
      'generic-email',
      'contact-form',
      'career-page',
    ]) {
      expect(migration).toContain(`'${category}'`)
    }
    expect(migration).toContain(
      "NOT (features->'actionability' ? 'contactValues')",
    )
    expect(migration).not.toMatch(/personal_(email|phone)/i)
  })

  it('refuses lossy rollback when candidate rows exist', () => {
    expect(rollback).toContain(
      'LOCK TABLE opportunity_candidates IN ACCESS EXCLUSIVE MODE',
    )
    expect(rollback).toContain(
      'IF EXISTS (SELECT 1 FROM opportunity_candidates)',
    )
    expect(rollback).toContain('opportunity scoring v3 rollback refused')
    expect(rollback.indexOf('DROP TABLE opportunity_candidate_evidence'))
      .toBeLessThan(rollback.indexOf('DROP TABLE opportunity_candidates'))
  })

  it('runs its isolated PostgreSQL gate after Agency Match', () => {
    expect(rootPackage).toContain('"test:opportunity-scoring-v3:db"')
    const parentGate = workflow.indexOf(
      'run: npm run test:agency-dna-match-v2:db',
    )
    const scoringGate = workflow.indexOf(
      'run: npm run test:opportunity-scoring-v3:db',
    )
    expect(parentGate).toBeGreaterThan(-1)
    expect(scoringGate).toBeGreaterThan(parentGate)
  })

  it('rolls the child schema down before every ancestor', () => {
    for (const verifier of ancestorVerifiers) {
      const child = verifier.indexOf(
        'database.query(opportunityScoringV3DownSql)',
      )
      const namedParent = verifier.indexOf(
        'database.query(agencyDnaMatchDownSql)',
      )
      const parent = namedParent > -1
        ? namedParent
        : verifier.indexOf('database.query(downSql)', child)
      expect(child).toBeGreaterThan(-1)
      expect(parent).toBeGreaterThan(child)
    }
    const childDown = downVerifier.indexOf(
      "'20260804150000_add_opportunity_candidates_v3.down.sql'",
    )
    const parentDown = downVerifier.indexOf(
      "'20260804140000_add_agency_dna_match_v2.down.sql'",
    )
    expect(childDown).toBeGreaterThan(-1)
    expect(parentDown).toBeGreaterThan(childDown)
    expect(downVerifier).toContain('PRE_FIXTURE_DOWN_MIGRATIONS = 18')
  })
})
