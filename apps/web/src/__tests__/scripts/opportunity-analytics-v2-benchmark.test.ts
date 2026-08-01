import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const benchmark = readFileSync(
  resolve(
    process.cwd(),
    '..',
    '..',
    'packages',
    'db',
    'scripts',
    'benchmark-opportunity-outcome-funnel.mjs',
  ),
  'utf8',
)

describe('Opportunity Analytics v2 benchmark contract', () => {
  it('measures 100k target-tenant events inside a multi-tenant fixture', () => {
    expect(benchmark).toContain('generate_series(1, 200000)')
    expect(benchmark).toContain('owners: 10')
    expect(benchmark).toContain('workspaces: 10')
    expect(benchmark).toContain('targetOutcomeEvents: 100000')
    expect(benchmark).toContain('outcomeEvents: 200000')
    expect(benchmark).toContain('targetCorrections: 1000')
  })

  it('benchmarks effective events in an exact owner and workspace scope', () => {
    expect(benchmark).toContain('scoped_opportunity.workspace_id = 1')
    expect(benchmark).toContain("event.event_type <> 'reverted'")
    expect(benchmark).toContain('correction.reverts_event_id = event.id')
    expect(benchmark).toContain('benchmark_outcome_owner_reverts_idx')
    expect(benchmark).toContain("cohort_snapshot->>'agencyDnaVersion' = 'dna-v2'")
    expect(benchmark).toContain('PERCENTILE_CONT(0.5)')
    expect(benchmark).toContain('reason_counts AS')
    expect(benchmark).toContain('calibrationResult')
  })

  it('fails closed on latency or a missing owner-scoped event index', () => {
    expect(benchmark).toContain('metrics.executionTimeMs > 1000')
    expect(benchmark).toContain(
      "indexName.startsWith('benchmark_outcome_owner_')",
    )
    expect(benchmark).toContain(
      "event: 'opportunity_analytics_v2.benchmark_completed'",
    )
    expect(benchmark).toContain('regressionGuardMs: 1000')
    expect(benchmark).toContain('calibrationExport: calibration')
  })
})
