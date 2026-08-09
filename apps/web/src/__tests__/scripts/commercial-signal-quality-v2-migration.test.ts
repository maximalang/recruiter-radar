import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../../../../..')
const migration = fs.readFileSync(path.join(
  root,
  'packages/db/migrations/20260809100000_add_commercial_signal_quality_v2.sql',
), 'utf8')
const rollback = fs.readFileSync(path.join(
  root,
  'packages/db/migrations/20260809100000_add_commercial_signal_quality_v2.down.sql',
), 'utf8')
const companyEventsVerifier = fs.readFileSync(path.join(
  root,
  'packages/db/scripts/verify-company-events-v1.mjs',
), 'utf8')
const opportunityEngineDownVerifier = fs.readFileSync(path.join(
  root,
  'packages/db/scripts/verify-opportunity-engine-down.mjs',
), 'utf8')

describe('Commercial Signal Quality Engine v2 migration', () => {
  it('adds an append-only shadow layer without rewriting v3 candidates', () => {
    expect(migration).toMatch(/CREATE TABLE commercial_signal_quality_snapshots\b/)
    expect(migration).toMatch(/CREATE TABLE commercial_signal_quality_evidence\b/)
    expect(migration).toMatch(
      /CREATE TABLE commercial_signal_quality_opportunity_lineage\b/,
    )
    expect(migration).not.toMatch(/ALTER TABLE opportunity_candidates\b/)
    expect(migration).not.toMatch(/UPDATE opportunity_candidates\b/)
    expect(migration).toContain(
      'BEFORE UPDATE OR DELETE ON commercial_signal_quality_snapshots',
    )
    expect(migration).toContain(
      'BEFORE UPDATE OR DELETE ON commercial_signal_quality_evidence',
    )
  })

  it('stores score, coverage, confidence, components and heuristic calibration honestly', () => {
    for (const field of [
      'quality_score NUMERIC(6, 5) NOT NULL',
      'quality_coverage NUMERIC(6, 5) NOT NULL',
      'quality_confidence NUMERIC(6, 5) NOT NULL',
      'critical_coverage NUMERIC(6, 5) NOT NULL',
      'components JSONB NOT NULL',
      'reason_codes TEXT[] NOT NULL',
      'feature_snapshot JSONB NOT NULL',
      'input_hash TEXT NOT NULL',
      'decision_at TIMESTAMPTZ NOT NULL',
    ]) {
      expect(migration).toContain(field)
    }
    expect(migration).toContain("feature_version = 'commercial-signal-quality-v2'")
    expect(migration).toContain("model_type = 'heuristic'")
    expect(migration).toContain("calibration_status = 'uncalibrated'")
  })

  it('binds snapshots and evidence to exact tenant-scoped v3 lineage', () => {
    expect(migration).toContain('candidate_id BIGINT NOT NULL')
    expect(migration).toContain('organization_id BIGINT NOT NULL')
    expect(migration).toContain('workspace_id BIGINT NOT NULL')
    expect(migration).toContain('client_profile_id BIGINT NOT NULL')
    expect(migration).toContain('REFERENCES opportunity_candidates(')
    expect(migration).toContain('REFERENCES opportunity_candidate_evidence(')
    expect(migration).toContain('REFERENCES evidence_items(id, org_id)')
    expect(migration).toContain('PRIMARY KEY (opportunity_lineage_id)')
    expect(migration).not.toContain('link_commercial_signal_quality_lineage')
    expect(migration).toContain('quality.decision_at <= lineage.created_at')
    expect(migration).toContain('lineage.created_at <= quality.valid_until')
  })

  it('persists provenance and correlation reasons for every evidence item', () => {
    for (const field of [
      'source_family TEXT NOT NULL',
      'source_kind TEXT NOT NULL',
      'decision_role TEXT NOT NULL',
      'source_domain TEXT NOT NULL',
      'upstream_origin TEXT',
      'canonical_url TEXT',
      'vacancy_fingerprint TEXT',
      'publication_fingerprint TEXT',
      'organization_domain TEXT',
      'content_fingerprint TEXT',
      'observed_at TIMESTAMPTZ NOT NULL',
      'evidence_independence_group TEXT NOT NULL',
      'correlation_reason_code TEXT NOT NULL',
    ]) {
      expect(migration).toContain(field)
    }
    for (const reason of [
      'EVIDENCE_INDEPENDENT',
      'EVIDENCE_CORRELATED',
      'EVIDENCE_REPUBLICATION',
      'EVIDENCE_SAME_UPSTREAM',
      'EVIDENCE_ORIGIN_UNKNOWN',
    ]) {
      expect(migration).toContain(`'${reason}'`)
    }
  })

  it('refuses a lossy rollback when quality history exists', () => {
    expect(rollback).toContain(
      'LOCK TABLE commercial_signal_quality_snapshots IN ACCESS EXCLUSIVE MODE',
    )
    expect(rollback).toContain(
      'OR EXISTS (SELECT 1 FROM commercial_signal_quality_snapshots)',
    )
    expect(rollback).toContain(
      'LOCK TABLE commercial_signal_quality_opportunity_lineage',
    )
    expect(rollback).toContain('commercial signal quality v2 rollback refused')
    expect(rollback.indexOf('DROP TABLE commercial_signal_quality_evidence'))
      .toBeLessThan(rollback.indexOf('DROP TABLE commercial_signal_quality_snapshots'))
  })

  it('registers Quality v2 before every ancestor rollback', () => {
    const qualityFeedbackDown =
      '20260809110000_add_query_plan_quality_feedback_v2.down.sql'
    const qualityDown =
      '20260809100000_add_commercial_signal_quality_v2.down.sql'
    const commercialSignalDown =
      '20260807170000_add_commercial_signal_canary_runtime.down.sql'

    for (const verifier of [companyEventsVerifier, opportunityEngineDownVerifier]) {
      expect(verifier).toContain(qualityFeedbackDown)
      expect(verifier).toContain(qualityDown)
      expect(verifier.indexOf(qualityFeedbackDown))
        .toBeLessThan(verifier.indexOf(qualityDown))
      expect(verifier.indexOf(qualityDown))
        .toBeLessThan(verifier.indexOf(commercialSignalDown))
    }
  })
})
