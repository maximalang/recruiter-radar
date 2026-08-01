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
  it('measures the required multi-tenant 100k-event fixture with corrections', () => {
    expect(benchmark).toContain('generate_series(1, 100000)')
    expect(benchmark).toContain('owners: 10')
    expect(benchmark).toContain('workspaces: 10')
    expect(benchmark).toContain('opportunities: 10000')
    expect(benchmark).toContain('corrections: 1000')
  })

  it('benchmarks effective events in an exact owner and workspace scope', () => {
    expect(benchmark).toContain('scoped_opportunity.workspace_id = 1')
    expect(benchmark).toContain("event.event_type <> 'reverted'")
    expect(benchmark).toContain('correction.reverts_event_id = event.id')
    expect(benchmark).toContain("cohort_snapshot->>'agencyDnaVersion' = 'dna-v2'")
  })

  it('fails closed on latency or a missing owner-scoped event index', () => {
    expect(benchmark).toContain('analyticsV2.executionTimeMs > 1000')
    expect(benchmark).toContain("name.startsWith('benchmark_outcome_owner_')")
    expect(benchmark).toContain(
      "event: 'opportunity_analytics_v2.benchmark_completed'",
    )
    expect(benchmark).toContain('regressionGuardMs: 1000')
  })
})
