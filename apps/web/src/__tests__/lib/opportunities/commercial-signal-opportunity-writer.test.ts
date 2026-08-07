import {
  buildCommercialSignalCard,
  buildCommercialSignalLineageKey,
  CommercialSignalLineageError,
  compatibilityEpisodeType,
} from '@/lib/opportunities/commercial-signal-opportunity-writer'

describe('Commercial Signal exact-lineage writer', () => {
  it('keys lineage by exact episode and candidate generations', () => {
    const base = {
      workspaceId: '10',
      clientProfileId: '20',
      organizationId: '30',
      signalEpisodeIdentity: 'a'.repeat(64),
      signalEpisodeGeneration: 2,
      candidateIdentity: 'b'.repeat(64),
      candidateGeneration: 4,
      scoreVersion: 'opportunity-v3',
    }
    const lineage = buildCommercialSignalLineageKey(base)

    expect(lineage).toMatch(/^[a-f0-9]{64}$/)
    expect(buildCommercialSignalLineageKey({
      ...base,
      candidateGeneration: 5,
    })).not.toBe(lineage)
    expect(buildCommercialSignalLineageKey({
      ...base,
      signalEpisodeGeneration: 3,
    })).not.toBe(lineage)
  })

  it.each([
    ['vacancy_acceleration', 'vacancy_spike'],
    ['persistent_hiring_problem', 'repeated_vacancies'],
    ['role_cluster', 'new_role_cluster'],
    ['new_region_expansion', 'new_region'],
    ['hiring_restart', 'hiring_restart'],
    ['sustained_hiring', 'sustained_hiring'],
    ['leadership_led_expansion', 'vacancy_spike'],
    ['recruiting_capacity_gap', 'vacancy_spike'],
    ['new_unit_buildout', 'new_role_cluster'],
    ['business_expansion', 'vacancy_spike'],
    ['reactivation_window', 'hiring_restart'],
  ])('maps %s to deterministic compatibility type %s', (episode, expected) => {
    expect(compatibilityEpisodeType(episode)).toBe(expected)
  })

  it('fails closed for unknown episode types', () => {
    expect(() => compatibilityEpisodeType('vacancy')).toThrow(
      CommercialSignalLineageError,
    )
  })

  it('builds a strict evidence-first card without deal probability claims', () => {
    const card = buildCommercialSignalCard({
      status: 'qualified_actionable',
      signalEpisodeType: 'vacancy_acceleration',
      episodeValidUntil: '2026-08-12T12:00:00.000Z',
      baselineDeviation: 3.25,
      qualityScore: 0.81,
      actionabilityScore: 0.76,
      qualityComponents: {
        agencyFit: { score: 0.88, reasons: [] },
        externalAgencyPropensity: { score: 0.79, reasons: [] },
      },
    }, ['11', '12'])

    expect(card.version).toBe('commercial-signal-card-v1')
    expect(card.status).toBe('qualified_actionable')
    expect(card.whatChanged.evidenceIds).toEqual(['11', '12'])
    expect(card.whyNotOrdinaryHiring.evidenceIds).toEqual([])
    expect(card.metrics.opportunityQuality.value).toBe(0.81)
    const serialized = JSON.stringify(card)
    expect(serialized).not.toMatch(/\b\d{1,3}%\b|dealProbability|winProbability/i)
    expect(serialized).not.toMatch(/\b(?:high|medium|low)\s+probability\b/i)
    expect(serialized).not.toMatch(/(?:высокая|средняя|низкая)\s+вероятност/i)
  })

  it('cannot materialize a card without evidence', () => {
    expect(() => buildCommercialSignalCard({
      status: 'qualified_needs_enrichment',
      signalEpisodeType: 'persistent_hiring_problem',
      episodeValidUntil: '2026-08-12T12:00:00.000Z',
      baselineDeviation: null,
      qualityScore: 0.72,
      actionabilityScore: 0.2,
      qualityComponents: {
        agencyFit: { score: 0.8, reasons: [] },
        externalAgencyPropensity: { score: 0.7, reasons: [] },
      },
    }, [])).toThrow(CommercialSignalLineageError)
  })
})
