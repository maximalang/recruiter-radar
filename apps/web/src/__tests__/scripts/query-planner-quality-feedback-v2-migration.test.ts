import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../../../../..')
const migration = fs.readFileSync(path.join(
  root,
  'packages/db/migrations/20260809110000_add_query_plan_quality_feedback_v2.sql',
), 'utf8')
const rollback = fs.readFileSync(path.join(
  root,
  'packages/db/migrations/20260809110000_add_query_plan_quality_feedback_v2.down.sql',
), 'utf8')
const materializer = fs.readFileSync(path.join(
  root,
  'packages/db/scripts/materialize-query-plan-yield-v2.mjs',
), 'utf8')

describe('Query Planner quality feedback v2 migration', () => {
  it('persists required downstream quality numerators and fetch rates', () => {
    for (const field of [
      'independent_events BIGINT',
      'strong_reviewed_opportunities BIGINT',
      'ordinary_hiring_opportunities BIGINT',
      'independent_event_fetch_rate NUMERIC(8,7)',
      'episode_fetch_rate NUMERIC(8,7)',
      'qualified_fetch_rate NUMERIC(8,7)',
      'strong_reviewed_fetch_rate NUMERIC(8,7)',
    ]) {
      expect(migration).toContain(field)
    }
  })

  it('materializes metrics through exact query-plan, candidate and review lineage', () => {
    expect(materializer).toContain('commercial_signal_opportunity_query_plans')
    expect(materializer).toContain('commercial_signal_quality_snapshots')
    expect(materializer).toContain('commercial_signal_quality_evidence')
    expect(materializer).toContain('evidence_independence_group')
    expect(materializer).toContain('commercial_signal_annotations')
    expect(materializer).toContain("annotation.label IN ('strong', 'acceptable')")
    expect(materializer).toContain("annotation.reason_code = 'ordinary_hiring'")
  })

  it('keeps reply and meeting counts per exact query plan', () => {
    expect(materializer).toContain("BOOL_OR(outcome.event_type = 'replied')")
    expect(materializer).toContain("BOOL_OR(outcome.event_type = 'meeting')")
    expect(materializer).toContain('counts.replied')
    expect(materializer).toContain('counts.meetings')
  })

  it('refuses to discard materialized quality feedback history', () => {
    expect(rollback).toContain('query plan quality feedback rollback refused')
    expect(rollback).toContain('independent_events IS NOT NULL')
    expect(rollback).toContain('DROP COLUMN independent_events')
  })
})
