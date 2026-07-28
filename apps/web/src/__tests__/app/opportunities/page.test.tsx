/** @jest-environment jsdom */

import { render, screen } from '@testing-library/react'

jest.mock('@/lib/session', () => ({
  getOwnerIdFromSession: jest.fn(),
}))
jest.mock('@/lib/opportunities/repository', () => ({
  getOpportunityOutcomeOperationalSummary: jest.fn(),
  listOpportunities: jest.fn(),
}))
jest.mock('@/app/ui/site-footer', () => ({
  SiteFooter: () => <footer />,
}))

import OpportunitiesPage from '@/app/opportunities/page'
import {
  getOpportunityOutcomeOperationalSummary,
  listOpportunities,
} from '@/lib/opportunities/repository'
import { getOwnerIdFromSession } from '@/lib/session'

describe('opportunities page', () => {
  const originalFlag = process.env.OPPORTUNITY_ENGINE_V1_ENABLED
  const originalOutcomesUiFlag =
    process.env.OPPORTUNITY_OUTCOMES_UI_ENABLED
  const originalOutcomesFlag = process.env.OPPORTUNITY_OUTCOMES_ENABLED

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.OPPORTUNITY_ENGINE_V1_ENABLED = 'true'
    process.env.OPPORTUNITY_OUTCOMES_ENABLED = 'true'
    process.env.OPPORTUNITY_OUTCOMES_UI_ENABLED = 'true'
    jest.mocked(getOwnerIdFromSession).mockResolvedValue('7')
    jest.mocked(listOpportunities).mockResolvedValue({
      opportunities: [],
      total: 0,
      page: 1,
      pageSize: 50,
      nextOffset: null,
    })
    jest.mocked(getOpportunityOutcomeOperationalSummary).mockResolvedValue({
      newCount: 0,
      acceptedCount: 0,
      pipelineCount: 0,
      snoozedCount: 0,
      wonCount: 0,
      lostCount: 0,
      dismissedCount: 0,
      overdueSnoozeCount: 0,
    })
  })

  afterAll(() => {
    if (originalFlag === undefined) delete process.env.OPPORTUNITY_ENGINE_V1_ENABLED
    else process.env.OPPORTUNITY_ENGINE_V1_ENABLED = originalFlag
    if (originalOutcomesUiFlag === undefined) {
      delete process.env.OPPORTUNITY_OUTCOMES_UI_ENABLED
    } else {
      process.env.OPPORTUNITY_OUTCOMES_UI_ENABLED = originalOutcomesUiFlag
    }
    if (originalOutcomesFlag === undefined) {
      delete process.env.OPPORTUNITY_OUTCOMES_ENABLED
    } else {
      process.env.OPPORTUNITY_OUTCOMES_ENABLED = originalOutcomesFlag
    }
  })

  it('shows the four Morning Brief counters and evidence-first empty state', async () => {
    render(await OpportunitiesPage({ searchParams: Promise.resolve({}) }))

    expect(screen.getByRole('heading', {
      name: 'Коммерческие возможности на сегодня',
    })).toBeInTheDocument()
    for (const label of [
      'Новые возможности',
      'В работе',
      'Коммерческий pipeline',
      'Отложены',
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
    expect(screen.getByText(
      'Радар пока не обнаружил достаточно подтверждённых коммерческих возможностей под ваш профиль.',
    )).toBeInTheDocument()
    expect(screen.getByText(
      'Мы не показываем компании только потому, что у них есть одна вакансия.',
    )).toBeInTheDocument()
  })

  it('keeps lifecycle navigation fail-closed when outcome UI is disabled', async () => {
    process.env.OPPORTUNITY_OUTCOMES_UI_ENABLED = 'false'
    render(await OpportunitiesPage({
      searchParams: Promise.resolve({ view: 'pipeline' }),
    }))

    expect(getOpportunityOutcomeOperationalSummary).not.toHaveBeenCalled()
    expect(listOpportunities).toHaveBeenCalledWith(expect.objectContaining({
      view: 'morning',
      morningBriefOnly: true,
    }))
    expect(screen.queryByText('Коммерческий pipeline')).toBeNull()
  })
})
