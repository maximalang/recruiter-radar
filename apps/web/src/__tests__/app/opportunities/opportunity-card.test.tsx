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

describe('OpportunityCard', () => {
  it('renders evidence-backed brief copy and the evidence timeline', () => {
    render(<OpportunityCard opportunity={OPPORTUNITY} />)

    expect(screen.getByRole('heading', { name: 'Пример ускорила найм' })).toBeInTheDocument()
    expect(screen.getByText('За 14 дней открыто 8 вакансий.')).toBeInTheDocument()
    expect(screen.getByText('Почему подходит агентству')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Лента доказательств' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Backend developer' })).toHaveAttribute(
      'href',
      'https://example.test/jobs/1',
    )
    expect(screen.getByRole('button', { name: 'В работу' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Открыть' })).toHaveAttribute(
      'href',
      '#evidence-10',
    )
    expect(screen.getByLabelText('Оценка возможности: 82 из 100')).toBeInTheDocument()
  })

  it('does not make a non-http evidence URL clickable', () => {
    render(<OpportunityCard opportunity={{
      ...OPPORTUNITY,
      evidenceTimeline: [{
        ...OPPORTUNITY.evidenceTimeline[0],
        url: 'javascript:alert(1)',
      }],
    }} />)
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

    expect(screen.getByText('Предложение')).toBeInTheDocument()
    expect(screen.queryByText('Связались')).toBeNull()
  })

  it('renders the complete strategist card with explicit evidence and heuristic labels', () => {
    render(<OpportunityCard opportunity={{
      ...OPPORTUNITY,
      strategistBrief: {
        version: 'opportunity-strategist-v1',
        whatChanged: evidenceConclusion('Открыто 8 вакансий.', ['1']),
        whyNow: evidenceConclusion('Сигнал появился на этой неделе.', ['1']),
        problemHypothesis: heuristicConclusion('Команде может требоваться помощь.'),
        agencyFitExplanation: heuristicConclusion('Есть профильное совпадение.'),
        externalSupportNeedExplanation: evidenceConclusion(
          'Темп найма вырос.',
          ['1'],
        ),
        recommendedPersona: heuristicConclusion('Проверить функцию HRD.'),
        recommendedAngle: heuristicConclusion('Начать со сложных ролей.'),
        recommendedCaseStudy: heuristicConclusion('Точного кейса нет.'),
        recommendedNextAction: heuristicConclusion('Подготовить ручной черновик.'),
        riskSignals: [heuristicConclusion('Бюджет не подтверждён.')],
        limitations: [heuristicConclusion('Нужна ручная проверка.')],
      },
    }} />)

    expect(screen.getByRole('heading', {
      name: 'Стратегическая карточка',
    })).toBeInTheDocument()
    expect(screen.getAllByText('Основано на доказательствах').length)
      .toBeGreaterThan(0)
    expect(screen.getAllByText('Гипотеза — проверьте вручную').length)
      .toBeGreaterThan(0)
    expect(screen.getAllByText('Подтверждения: №1').length).toBeGreaterThan(0)
    expect(screen.getByText('Риски')).toBeInTheDocument()
    expect(screen.getByText('Ограничения')).toBeInTheDocument()
    expect(screen.getByText('Подготовить ручной черновик.')).toBeInTheDocument()
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
