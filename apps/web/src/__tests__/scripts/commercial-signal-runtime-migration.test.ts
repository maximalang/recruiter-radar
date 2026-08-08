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

describe('Commercial Signal rollback data preservation', () => {
  it('keeps new dismissal reasons valid without rewriting outcome history', () => {
    expect(runtimeDown).not.toMatch(/UPDATE\s+opportunity_outcome_events/i)
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
})
