import { getSourceCriticality, hasDeliveryImpactingFailure } from '@/lib/sources/source-criticality'
// Exhaustive registry coverage: primary + runnable-supporting IDs must all map
// to a non-unknown criticality; only unregistered ids stay 'unknown'.
import { getPrimarySourceIds, getAllSourceIds } from '@/lib/sources/source-registry'
import { getRunnableDailySupportingSourceIds } from '@/lib/lead-discovery/source-ingest'

describe('source criticality contract', () => {
  // Controlled env: every snapshot-gated supporting source becomes runnable so
  // the exhaustive check covers the full refreshable set, not just defaults.
  const RUNNABLE_ENV: Record<string, string> = {
    SOURCE_SNAPSHOT_ROOT: '/tmp/rr-test-snapshots',
    FNS_OPEN_DATA_INPUT_FILE: 'fns-input.json',
    GOVERNMENT_PROCUREMENT_INPUT_FILE: 'procurement-input.json',
    ROSSTAT_OPEN_DATA_INPUT_FILE: 'rosstat-input.json',
    ROSPATENT_OPEN_DATA_INPUT_FILE: 'rospatent-input.json',
  }

  test('every primary source id resolves to required (never unknown)', () => {
    const ids = getPrimarySourceIds()
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) {
      expect(getSourceCriticality(id)).toBe('required')
    }
  })

  test('every runnable daily supporting source id resolves to a defined criticality', () => {
    const ids = getRunnableDailySupportingSourceIds(RUNNABLE_ENV)
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) {
      const criticality = getSourceCriticality(id)
      expect(['required', 'optional']).toContain(criticality)
    }
  })

  test('unregistered ids stay unknown (fail-closed)', () => {
    for (const id of ['mystery-source', '', 'hh-typo']) {
      expect(getSourceCriticality(id)).toBe('unknown')
      expect(hasDeliveryImpactingFailure([{ source: id, outcome: 'failed' }])).toBe(true)
    }
  })

  test('the whole registry is covered: no registered id is unknown', () => {
    // Guards against future registry entries silently falling into fail-closed
    // unknown and permanently red clocks until someone notices.
    for (const id of getAllSourceIds()) {
      expect(getSourceCriticality(id)).not.toBe('unknown')
    }
  })

  test('digest-lead-originating sources are required', () => {
    expect(getSourceCriticality('hh')).toBe('required')
    expect(getSourceCriticality('career-pages')).toBe('required')
    expect(getSourceCriticality('greenhouse')).toBe('required')
  })

  test('confidence-gated digest-allowed sources are required', () => {
    expect(getSourceCriticality('rabota-rossii')).toBe('required')
    expect(getSourceCriticality('superjob')).toBe('required')
  })

  test('the mandatory organization-identity enricher is required', () => {
    expect(getSourceCriticality('egrul-fns')).toBe('required')
  })

  test('enrichment/context-only sources are optional', () => {
    expect(getSourceCriticality('funding-business-signals')).toBe('optional')
    expect(getSourceCriticality('company-newsrooms')).toBe('optional')
    expect(getSourceCriticality('github-company-org')).toBe('optional')
    expect(getSourceCriticality('cbr-registry')).toBe('optional')
  })

  test('unregistered ids map to unknown (fail-closed)', () => {
    expect(getSourceCriticality('mystery-source')).toBe('unknown')
    expect(getSourceCriticality('')).toBe('unknown')
  })

  test('hasDeliveryImpactingFailure: required or unknown failure impacts delivery', () => {
    expect(hasDeliveryImpactingFailure([
      { source: 'funding-business-signals', outcome: 'failed' },
    ])).toBe(false)
    expect(hasDeliveryImpactingFailure([
      { source: 'hh', outcome: 'failed' },
    ])).toBe(true)
    expect(hasDeliveryImpactingFailure([
      { source: 'mystery-source', outcome: 'failed' },
    ])).toBe(true)
    expect(hasDeliveryImpactingFailure([])).toBe(false)
  })

  test('deferred never counts as delivery-impacting; rate-limited impacts only required sources', () => {
    expect(hasDeliveryImpactingFailure([
      { source: 'hh', outcome: 'deferred' },
      { source: 'superjob', outcome: 'deferred' },
      { source: 'funding-business-signals', outcome: 'rate-limited' },
    ])).toBe(false)
    // A required source that was rate-limited missed its refresh window:
    // digest/evidence inputs go stale, so this must fail closed.
    expect(hasDeliveryImpactingFailure([
      { source: 'hh', outcome: 'rate-limited' },
    ])).toBe(true)
  })
})
