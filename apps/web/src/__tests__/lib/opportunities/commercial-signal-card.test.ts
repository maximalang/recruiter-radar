import {
  parseCommercialSignalCard,
} from '@/lib/opportunities/commercial-signal-card'

const CARD = {
  version: 'commercial-signal-card-v1',
  scoreVersion: 'opportunity-v3',
  status: 'qualified_actionable',
  whatChanged: conclusion('Компания ускорила найм инженерной команды.'),
  whyNotOrdinaryHiring: conclusion('Темп вышел за подтверждённый baseline.'),
  whyAgency: conclusion('Нагрузка охватывает несколько дефицитных ролей.'),
  whyThisAgency: heuristic('Профиль ролей совпадает с DNA агентства.'),
  whyNow: conclusion('Активный episode подтверждён на этой неделе.'),
  metrics: {
    externalAgencyPropensity: metric(0.81, 'propensity.multi_role_pressure'),
    agencyFit: metric(0.76, 'agency_fit.role_family_match'),
    opportunityQuality: metric(0.84, 'quality.confirmed_state_change'),
    actionability: metric(0.68, 'actionability.corporate_path'),
  },
  recommendedAction: heuristic('Проверить корпоративный HR-канал и подготовить черновик.'),
  constraints: [heuristic('Бюджет и готовность работать с агентством не подтверждены.')],
}

describe('commercial signal card contract', () => {
  it('accepts a complete versioned snapshot with bounded model metrics', () => {
    expect(parseCommercialSignalCard(CARD, new Set(['101']))).toEqual(CARD)
  })

  it('rejects evidence claims that do not resolve to the card timeline', () => {
    expect(parseCommercialSignalCard({
      ...CARD,
      whatChanged: conclusion('Неизвестное изменение.', ['999']),
    }, new Set(['101']))).toBeNull()
  })

  it('rejects unsupported versions, opaque scores, and incomplete sections', () => {
    expect(parseCommercialSignalCard({
      ...CARD,
      version: 'commercial-signal-card-v2',
    }, new Set(['101']))).toBeNull()
    expect(parseCommercialSignalCard({
      ...CARD,
      dealProbability: 0.91,
    }, new Set(['101']))).toBeNull()
    expect(parseCommercialSignalCard({
      ...CARD,
      whyAgency: null,
    }, new Set(['101']))).toBeNull()
  })
})

function conclusion(text: string, evidenceIds = ['101']) {
  return { text, basis: 'evidence', evidenceIds }
}

function heuristic(text: string) {
  return { text, basis: 'heuristic', evidenceIds: [] }
}

function metric(value: number, reasonCode: string) {
  return { value, reasonCodes: [reasonCode] }
}
