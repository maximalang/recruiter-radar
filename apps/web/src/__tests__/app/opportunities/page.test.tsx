/** @jest-environment jsdom */

import { render, screen } from '@testing-library/react'

jest.mock('@/lib/session', () => ({
  getOwnerIdFromSession: jest.fn(),
}))
jest.mock('@/lib/opportunities/repository', () => ({
  listOpportunities: jest.fn(),
}))
jest.mock('@/app/ui/site-footer', () => ({
  SiteFooter: () => <footer />,
}))

import OpportunitiesPage from '@/app/opportunities/page'
import { listOpportunities } from '@/lib/opportunities/repository'
import { getOwnerIdFromSession } from '@/lib/session'

describe('opportunities page', () => {
  const originalFlag = process.env.OPPORTUNITY_ENGINE_V1_ENABLED

  beforeEach(() => {
    process.env.OPPORTUNITY_ENGINE_V1_ENABLED = 'true'
    jest.mocked(getOwnerIdFromSession).mockResolvedValue('7')
    jest.mocked(listOpportunities).mockResolvedValue({
      opportunities: [],
      total: 0,
      page: 1,
      pageSize: 50,
      nextOffset: null,
    })
  })

  afterAll(() => {
    if (originalFlag === undefined) delete process.env.OPPORTUNITY_ENGINE_V1_ENABLED
    else process.env.OPPORTUNITY_ENGINE_V1_ENABLED = originalFlag
  })

  it('shows the four Morning Brief counters and evidence-first empty state', async () => {
    render(await OpportunitiesPage({ searchParams: Promise.resolve({}) }))

    expect(screen.getByRole('heading', {
      name: 'Коммерческие возможности на сегодня',
    })).toBeInTheDocument()
    for (const label of [
      'Новые opportunities',
      'Требуют внимания',
      'Высокая достоверность',
      'Истекают скоро',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.getByText(
      'Радар пока не обнаружил достаточно подтверждённых коммерческих возможностей под ваш профиль.',
    )).toBeInTheDocument()
    expect(screen.getByText(
      'Мы не показываем компании только потому, что у них есть одна вакансия.',
    )).toBeInTheDocument()
  })
})
