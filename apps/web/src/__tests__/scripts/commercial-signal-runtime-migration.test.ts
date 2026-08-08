import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repositoryRoot = resolve(process.cwd(), '..', '..')
const migrationsRoot = resolve(repositoryRoot, 'packages', 'db', 'migrations')
const runtimeDown = readFileSync(resolve(
  migrationsRoot,
  '20260807170000_add_commercial_signal_canary_runtime.down.sql',
), 'utf8')
const taxonomyDown = readFileSync(resolve(
  migrationsRoot,
  '20260807175500_extend_commercial_signal_annotation_taxonomy.down.sql',
), 'utf8')
const enrichmentDown = readFileSync(resolve(
  migrationsRoot,
  '20260807173000_harden_company_event_and_enrichment_lineage.down.sql',
), 'utf8')
const yieldMetricsDown = readFileSync(resolve(
  migrationsRoot,
  '20260807174500_extend_query_plan_yield_metrics.down.sql',
), 'utf8')
const supplyMetricsDown = readFileSync(resolve(
  migrationsRoot,
  '20260807180500_complete_query_plan_supply_metrics.down.sql',
), 'utf8')
const isolatedCleanup = readFileSync(resolve(
  repositoryRoot,
  'packages',
  'db',
  'scripts',
  'lib',
  'commercial-signal-isolated-test-cleanup.mjs',
), 'utf8')
const isolatedCleanupRunner = readFileSync(resolve(
  repositoryRoot,
  'packages',
  'db',
  'scripts',
  'rollback-commercial-signal-test-dependents.mjs',
), 'utf8')

describe('Commercial Signal rollback data preservation', () => {
  it('keeps new dismissal reasons valid without rewriting outcome history', () => {
    expect(runtimeDown).not.toMatch(/UPDATE\s+opportunity_outcome_events/i)
    expect(runtimeDown).not.toMatch(/DROP\s+COLUMN/i)
    expect(runtimeDown).not.toMatch(/DROP\s+TABLE/i)
    expect(runtimeDown).not.toMatch(
      /DROP\s+TRIGGER[\s\S]*commercial_signal.*append_only/i,
    )
    expect(runtimeDown).not.toMatch(
      /DROP\s+TRIGGER[\s\S]*opportunity_outcome_events_snapshot_commercial_signal_lineage/i,
    )
    for (const reason of [
      'ordinary_hiring',
      'wrong_role',
      'wrong_company_size',
      'weak_external_need',
      'internal_only',
      'bad_timing',
      'bad_economics',
      'stale',
      'wrong_persona',
      'no_safe_contact',
    ]) {
      expect(runtimeDown).toContain(`'${reason}'`)
    }
  })

  it('never disables append-only annotations or translates historical reasons', () => {
    expect(taxonomyDown).not.toMatch(
      /DROP\s+TRIGGER\s+IF\s+EXISTS\s+commercial_signal_annotations_append_only/i,
    )
    expect(taxonomyDown).not.toMatch(/UPDATE\s+commercial_signal_annotations/i)
    expect(runtimeDown).not.toMatch(/commercial_signal_annotations[\s\S]*DROP TABLE/i)
    for (const reason of [
      'weak_agency_fit',
      'stale_signal',
      'duplicate_event',
      'unverified_company',
      'internal_recruiting_sufficient',
      'no_actual_change',
    ]) {
      expect(taxonomyDown).toContain(`'${reason}'`)
    }
  })

  it('preserves append-only corporate enrichment evidence on rollback', () => {
    expect(enrichmentDown).not.toMatch(
      /DROP\s+TRIGGER[\s\S]*commercial_signal_enrichment_evidence_append_only/i,
    )
    expect(enrichmentDown).not.toMatch(
      /DROP\s+TABLE[\s\S]*commercial_signal_enrichment_evidence/i,
    )
  })

  it('preserves append-only query-plan metric snapshots on rollback', () => {
    for (const down of [yieldMetricsDown, supplyMetricsDown]) {
      expect(down).not.toMatch(/DROP\s+COLUMN/i)
    }
  })

  it('confines destructive cleanup to explicitly acknowledged test databases', () => {
    expect(isolatedCleanup).toMatch(/DROP\s+TABLE/i)
    expect(isolatedCleanupRunner).toContain(
      `COMMERCIAL_SIGNAL_TEST_ROLLBACK_ACK !== 'isolated'`,
    )
    expect(isolatedCleanupRunner).toContain(
      'COMMERCIAL_SIGNAL_ISOLATED_TEST_CLEANUP_SQL',
    )
  })
})
