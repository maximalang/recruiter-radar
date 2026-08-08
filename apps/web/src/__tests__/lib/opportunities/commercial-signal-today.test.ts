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
      evidenceTimeline: [],
    })).toBe(false)
  })

  it('rejects an incomplete card even when its markers claim actionable', () => {
    expect(isActionableCommercialSignalTodayCandidate({
      metadata: {
        commercialSignalCard: {
          version: 'commercial-signal-card-v1',
          scoreVersion: 'opportunity-v3',
          status: 'qualified_actionable',
        },
      },
      evidenceTimeline: [{ id: '101' }],
    })).toBe(false)
  })

  it('admits only the exact current qualified_actionable v3 card', () => {
    const actionableCard = commercialSignalCard('qualified_actionable')
    const candidates = [
      {
        id: 'raw',
        metadata: { sourceType: 'job_posting' },
        evidenceTimeline: [],
      },
      {
        id: 'enrich',
        metadata: {
          commercialSignalCard: commercialSignalCard(
            'qualified_needs_enrichment',
          ),
        },
        evidenceTimeline: [{ id: '101' }],
      },
      {
        id: 'actionable',
        metadata: {
          commercialSignalCard: actionableCard,
        },
        evidenceTimeline: [{ id: '101' }],
      },
      {
        id: 'forged-evidence',
        metadata: {
          commercialSignalCard: actionableCard,
        },
        evidenceTimeline: [{ id: '999' }],
      },
    ]

    expect(filterActionableCommercialSignalToday(candidates).map(({ id }) => id))
      .toEqual(['actionable'])
  })
})

function commercialSignalCard(
  status: 'qualified_actionable' | 'qualified_needs_enrichment',
) {
  return {
    version: 'commercial-signal-card-v1',
    scoreVersion: 'opportunity-v3',
    status,
    whatChanged: evidenceConclusion('Подтверждено изменение найма.'),
    whyNotOrdinaryHiring: evidenceConclusion('Темп выше baseline.'),
    whyAgency: evidenceConclusion('Нужна внешняя поддержка.'),
    whyThisAgency: heuristicConclusion('Есть совпадение с DNA агентства.'),
    whyNow: evidenceConclusion('Сигнал актуален сейчас.'),
    metrics: {
      externalAgencyPropensity: metric(0.81, 'propensity.multi_role_pressure'),
      agencyFit: metric(0.76, 'agency_fit.role_family_match'),
      opportunityQuality: metric(0.84, 'quality.confirmed_state_change'),
      actionability: metric(0.68, 'actionability.corporate_path'),
    },
    recommendedAction: heuristicConclusion('Подготовить черновик обращения.'),
    constraints: [heuristicConclusion('Бюджет не подтвержден.')],
  }
}

function evidenceConclusion(text: string) {
  return { text, basis: 'evidence', evidenceIds: ['101'] }
}

function heuristicConclusion(text: string) {
  return { text, basis: 'heuristic', evidenceIds: [] }
}

function metric(value: number, reasonCode: string) {
  return { value, reasonCodes: [reasonCode] }
}
