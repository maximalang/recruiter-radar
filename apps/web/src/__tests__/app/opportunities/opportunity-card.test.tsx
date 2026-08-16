/** @jest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import type { OpportunityItem } from '@/lib/opportunities/repository'
import { OpportunityCard } from '@/app/opportunities/opportunity-card'
import { OpportunityActions } from '@/app/opportunities/opportunity-actions'

const refresh = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}))

const OPPORTUNITY: OpportunityItem = {
  id: '10',
  publicReference: '2bc92f8e-8930-4af1-b743-14c0c0df2650',
  ownerId: '7',
  clientProfileId: '8',
  organizationId: '9',
  hiringEpisodeId: '11',
  organizationName: 'Пример',
  organizationDomain: 'example.test',
  episodeType: 'vacancy_spike',
  episodeStatus: 'active',
  episodeStartedAt: '2026-07-20T00:00:00.000Z',
  episodeLastSeenAt: '2026-07-26T00:00:00.000Z',
  status: 'new',
  commercialStage: 'new',
  workflowState: 'active',
  title: 'Пример ускорила найм',
  whyNow: 'За 14 дней открыто 8 вакансий.',
  problemHypothesis: 'Темп найма может повышать потребность в поддержке.',
  recommendedAngle: 'Предложить помощь с двумя сложными ролями.',
  recommendedPersona: 'Руководитель подбора или HRD.',
  recommendedAction: 'Подготовить персональное обращение.',
  opportunityScore: 0.82,
  confidenceGate: 'A',
  scores: {},
  evidenceHash: 'a'.repeat(64),
  validFrom: '2026-07-26T00:00:00.000Z',
  validUntil: '2026-08-15T00:00:00.000Z',
  snoozedUntil: null,
  metadata: {},
  strategistBrief: null,
  workflow: null,
  createdAt: '2026-07-26T00:00:00.000Z',
  updatedAt: '2026-07-26T00:00:00.000Z',
  evidenceCount: 1,
  factCount: 1,
  publicationCount: 1,
  sourceFamilyCount: 1,
  directEvidenceCount: 1,
  agencyFitExplanation: 'Роли совпадают со специализацией агентства.',
  evidenceTimeline: [{
    id: '1',
    kind: 'signal',
    source: 'career-pages',
    title: 'Backend developer',
    url: 'https://example.test/jobs/1',
    occurredAt: '2026-07-25T00:00:00.000Z',
    tier: 'direct',
  }],
}

function openAnalysis() {
  const cue = screen.getByText('Анализ')
  const summary = cue.closest('summary')
  expect(summary).not.toBeNull()
  fireEvent.click(summary as HTMLElement)
}

describe('Situation row', () => {
  it('keeps episode identity, change, proof and temporal state in the scan surface', () => {
    render(<OpportunityCard opportunity={OPPORTUNITY} />)

    expect(screen.getByRole('heading', { name: 'Всплеск найма' })).toBeInTheDocument()
    expect(screen.getByText('Пример')).toBeInTheDocument()
    expect(screen.getByText('За 14 дней открыто 8 вакансий.')).toBeInTheDocument()
    expect(screen.getByText(/1 факт · 1 источник · высокое подтверждение/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Ситуация с/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/Оценка возможности:/)).toBeNull()
    expect(screen.getByText('Анализ').closest('details')).not.toHaveAttribute('open')
  })

  it('reveals evidence-backed decision detail without losing the temporal list hierarchy', () => {
    render(<OpportunityCard opportunity={OPPORTUNITY} />)
    openAnalysis()

    expect(screen.getByText('Почему подходит агентству')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Доказательства' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Backend developer' })).toHaveAttribute(
      'href',
      'https://example.test/jobs/1',
    )
    expect(screen.getByRole('button', { name: 'В работу' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Открыть' })).toHaveAttribute(
      'href',
      '#evidence-10',
    )
  })

  it('marks insufficient strategist data honestly after the user opens analysis', () => {
    render(<OpportunityCard opportunity={OPPORTUNITY} />)
    openAnalysis()

    expect(screen.getByRole('article')).toHaveAttribute('data-content-state', 'insufficient')
    expect(screen.getByText(
      'Для части выводов пока недостаточно подтверждённых данных.',
    )).toHaveAttribute('role', 'status')
    expect(screen.getAllByText('Недостаточно подтверждённых данных.').length)
      .toBeGreaterThan(0)
  })

  it('marks an expired validity window as stale without hiding evidence', () => {
    render(<OpportunityCard opportunity={{
      ...OPPORTUNITY,
      validUntil: '2020-01-01T00:00:00.000Z',
    }} />)

    expect(screen.getByRole('article')).toHaveAttribute('data-freshness', 'stale')
    openAnalysis()
    expect(screen.getByText(/Срок актуальности закончился/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Backend developer' })).toBeInTheDocument()
  })

  it('does not make a non-http evidence URL clickable', () => {
    render(<OpportunityCard opportunity={{
      ...OPPORTUNITY,
      evidenceTimeline: [{
        ...OPPORTUNITY.evidenceTimeline[0],
        url: 'javascript:alert(1)',
      }],
    }} />)
    openAnalysis()
    expect(screen.queryByRole('link', { name: 'Backend developer' })).toBeNull()
    expect(screen.getByText('Backend developer')).toBeInTheDocument()
  })

  it('renders the authoritative projected stage when legacy status is stale', () => {
    render(<OpportunityCard
      opportunity={{
        ...OPPORTUNITY,
        status: 'contacted',
        commercialStage: 'proposal',
      }}
      outcomesUiEnabled
    />)

    expect(screen.getByText(/Предложение/)).toBeInTheDocument()
    expect(screen.queryByText('Связались')).toBeNull()
  })

  it('preserves explicit evidence and hypothesis labels in strategist detail', () => {
    render(<OpportunityCard opportunity={{
      ...OPPORTUNITY,
      strategistBrief: {
        version: 'opportunity-strategist-v1',
        whatChanged: evidenceConclusion('Открыто 8 вакансий.', ['1']),
        whyNow: evidenceConclusion('Сигнал появился на этой неделе.', ['1']),
        problemHypothesis: heuristicConclusion('Команде может требоваться помощь.'),
        agencyFitExplanation: heuristicConclusion('Есть профильное совпадение.'),
        externalSupportNeedExplanation: evidenceConclusion('Темп найма вырос.', ['1']),
        recommendedPersona: heuristicConclusion('Проверить функцию HRD.'),
        recommendedAngle: heuristicConclusion('Начать со сложных ролей.'),
        recommendedCaseStudy: heuristicConclusion('Точного кейса нет.'),
        recommendedNextAction: heuristicConclusion('Подготовить ручной черновик.'),
        riskSignals: [heuristicConclusion('Бюджет не подтверждён.')],
        limitations: [heuristicConclusion('Нужна ручная проверка.')],
      },
    }} />)
    openAnalysis()

    expect(screen.getByRole('article')).toHaveAttribute('data-content-state', 'complete')
    expect(screen.getAllByText('Основано на доказательствах').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Гипотеза — проверьте вручную').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Подтверждения: №1').length).toBeGreaterThan(0)
    expect(screen.getByText('Подготовить ручной черновик.')).toBeInTheDocument()
  })

  it('renders Commercial Signal detail without reintroducing an opaque overall score', () => {
    render(<OpportunityCard
      opportunity={{
        ...OPPORTUNITY,
        metadata: { commercialSignalCard: commercialSignalCard() },
        evidenceTimeline: [{
          ...OPPORTUNITY.evidenceTimeline[0],
          id: '101',
          kind: 'evidence',
        }],
      }}
      commercialSignalUiEnabled
    />)
    openAnalysis()

    for (const heading of [
      'Что изменилось',
      'Почему это важно',
      'Почему сейчас',
      'Что сделать сейчас',
      'Ограничения',
    ]) {
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
    }
    expect(screen.queryByLabelText(/Оценка возможности:/)).toBeNull()
    expect(screen.getAllByRole('link', { name: 'Подтверждено · №101' })).toHaveLength(4)
    expect(screen.getByText('Как радар сделал вывод').closest('details')).not.toHaveAttribute('open')
    expect(screen.getByText('Подготовить проверяемый черновик обращения.')).toBeInTheDocument()
  })

  it('fails closed when Commercial Signal metadata is invalid', () => {
    render(<OpportunityCard
      opportunity={{
        ...OPPORTUNITY,
        metadata: {
          commercialSignalCard: {
            ...commercialSignalCard(),
            version: 'commercial-signal-card-v2',
          },
        },
      }}
      commercialSignalUiEnabled
    />)
    openAnalysis()

    expect(screen.queryByLabelText(/Оценка возможности:/)).toBeNull()
    expect(screen.getByText(/Данных для новой оценки ситуации пока недостаточно/))
      .toHaveAttribute('role', 'status')
    expect(screen.queryByText('Opportunity Quality')).toBeNull()
    expect(screen.queryByText(/snapshot|legacy-score/i)).toBeNull()
  })

  it.each([
    [1, 1, '1 факт · 1 источник'],
    [2, 2, '2 факта · 2 источника'],
    [5, 5, '5 фактов · 5 источников'],
  ])('pluralizes proof counts for %i items without badge-cloud duplication', (factCount, sourceFamilyCount, expected) => {
    render(<OpportunityCard opportunity={{
      ...OPPORTUNITY,
      factCount,
      sourceFamilyCount,
    }} />)

    expect(screen.getByText(new RegExp(expected))).toBeInTheDocument()
  })
})

describe('OpportunityActions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('sends an allowlisted action and refreshes the server view', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as jest.Mock
    render(<OpportunityActions opportunityId="10" currentStatus="new" />)

    fireEvent.click(screen.getByRole('button', { name: 'В работу' }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/opportunities/10/outcomes',
      expect.objectContaining({ method: 'POST' }),
    ))
    const requestInit = jest.mocked(global.fetch).mock.calls[0]?.[1]
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      eventType: 'accepted',
      occurredAt: expect.any(String),
    })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('announces a recoverable action error', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false }) as jest.Mock
    render(<OpportunityActions opportunityId="10" currentStatus="new" />)

    fireEvent.click(screen.getByRole('button', { name: 'Отложить' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Действие не сохранилось',
    )
  })
})

function evidenceConclusion(text: string, supportingEvidenceIds: string[]) {
  return { text, basis: 'evidence' as const, supportingEvidenceIds }
}

function heuristicConclusion(text: string) {
  return { text, basis: 'heuristic' as const, supportingEvidenceIds: [] }
}

function commercialSignalCard() {
  return {
    version: 'commercial-signal-card-v1',
    scoreVersion: 'opportunity-v3',
    status: 'qualified_actionable',
    whatChanged: cardConclusion('Компания ускорила найм инженерной команды.'),
    whyNotOrdinaryHiring: cardConclusion('Темп вышел за подтверждённый baseline.'),
    whyAgency: cardConclusion('Нагрузка охватывает несколько дефицитных ролей.'),
    whyThisAgency: cardHeuristic('Профиль ролей совпадает с DNA агентства.'),
    whyNow: cardConclusion('Активный episode подтверждён на этой неделе.'),
    metrics: {
      externalAgencyPropensity: cardMetric(0.81, 'propensity.multi_role_pressure'),
      agencyFit: cardMetric(0.76, 'agency_fit.role_family_match'),
      opportunityQuality: cardMetric(0.84, 'quality.confirmed_state_change'),
      actionability: cardMetric(0.68, 'actionability.corporate_path'),
    },
    recommendedAction: cardHeuristic('Подготовить проверяемый черновик обращения.'),
    constraints: [cardHeuristic('Бюджет и готовность работать с агентством не подтверждены.')],
  }
}

function cardConclusion(text: string) {
  return { text, basis: 'evidence', evidenceIds: ['101'] }
}

function cardHeuristic(text: string) {
  return { text, basis: 'heuristic', evidenceIds: [] }
}

function cardMetric(value: number, reasonCode: string) {
  return { value, reasonCodes: [reasonCode] }
}
