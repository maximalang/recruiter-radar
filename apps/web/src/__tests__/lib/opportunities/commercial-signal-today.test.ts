import {
  filterActionableCommercialSignalToday,
  isActionableCommercialSignalTodayCandidate,
} from '@/lib/opportunities/commercial-signal-today'

describe('Commercial Signal authoritative Today gate', () => {
  it('rejects a legacy/raw opportunity without an exact qualified_actionable Commercial Signal card', () => {
    expect(isActionableCommercialSignalTodayCandidate({
      metadata: {
        sourceType: 'job_posting',
        parserCandidate: true,
      },
    })).toBe(false)
  })

  it('keeps qualified_needs_enrichment out of actionable Today', () => {
    expect(isActionableCommercialSignalTodayCandidate({
      metadata: {
        commercialSignalCard: {
          version: 'commercial-signal-card-v1',
          scoreVersion: 'opportunity-v3',
          status: 'qualified_needs_enrichment',
        },
      },
    })).toBe(false)
  })

  it('admits only the exact current qualified_actionable v3 card', () => {
    const candidates = [
      {
        id: 'raw',
        metadata: { sourceType: 'job_posting' },
      },
      {
        id: 'enrich',
        metadata: {
          commercialSignalCard: {
            version: 'commercial-signal-card-v1',
            scoreVersion: 'opportunity-v3',
            status: 'qualified_needs_enrichment',
          },
        },
      },
      {
        id: 'actionable',
        metadata: {
          commercialSignalCard: {
            version: 'commercial-signal-card-v1',
            scoreVersion: 'opportunity-v3',
            status: 'qualified_actionable',
          },
        },
      },
    ]

    expect(filterActionableCommercialSignalToday(candidates).map(({ id }) => id))
      .toEqual(['actionable'])
  })
})
