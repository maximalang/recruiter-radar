/** @jest-environment jsdom */

import { fireEvent, render, screen, within } from '@testing-library/react'

jest.mock('@/lib/auth-v2/authorization', () => {
  const getAuthorizedOwnerId = jest.fn()
  return {
    getAuthorizedOwnerId,
    getSession: jest.fn(async ({ permission }) => {
      const ownerId = await getAuthorizedOwnerId(permission)
      return ownerId ? {
        mode: 'legacy',
        userId: ownerId,
        dataOwnerId: ownerId,
        workspaceId: null,
        role: null,
        session: null,
      } : null
    }),
  }
})
jest.mock('@/lib/opportunities/repository', () => ({
  getOpportunityOutcomeOperationalSummary: jest.fn(),
  listOpportunities: jest.fn(),
}))
jest.mock('@/lib/opportunities/opportunity-workflow-repository', () => ({
  listOpportunityWorkflowAssignees: jest.fn(),
}))
jest.mock('@/app/ui/site-footer', () => ({
  SiteFooter: () => <footer />,
}))

import OpportunitiesPage from '@/app/opportunities/page'
import {
  getOpportunityOutcomeOperationalSummary,
  listOpportunities,
} from '@/lib/opportunities/repository'
import { getAuthorizedOwnerId } from '@/lib/auth-v2/authorization'
import { getSession } from '@/lib/auth-v2/authorization'
import { listOpportunityWorkflowAssignees } from '@/lib/opportunities/opportunity-workflow-repository'

describe('opportunities page', () => {
  const originalFlag = process.env.OPPORTUNITY_ENGINE_V1_ENABLED
  const originalOutcomesUiFlag =
    process.env.OPPORTUNITY_OUTCOMES_UI_ENABLED
  const originalOutcomesFlag = process.env.OPPORTUNITY_OUTCOMES_ENABLED
  const originalCanaryOwners = process.env.OPPORTUNITY_CANARY_OWNER_IDS
  const originalWorkspace = process.env.OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED
  const originalWorkflow = process.env.OPPORTUNITY_WORKFLOW_V1_ENABLED

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.OPPORTUNITY_ENGINE_V1_ENABLED = 'true'
    process.env.OPPORTUNITY_OUTCOMES_ENABLED = 'true'
    process.env.OPPORTUNITY_OUTCOMES_UI_ENABLED = 'true'
    delete process.env.OPPORTUNITY_CANARY_OWNER_IDS
    delete process.env.OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED
    delete process.env.OPPORTUNITY_WORKFLOW_V1_ENABLED
    jest.mocked(getAuthorizedOwnerId).mockResolvedValue('7')
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
      followUpCount: 0,
      overdueCount: 0,
    })
    jest.mocked(listOpportunityWorkflowAssignees).mockResolvedValue([])
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
    if (originalCanaryOwners === undefined) {
      delete process.env.OPPORTUNITY_CANARY_OWNER_IDS
    } else {
      process.env.OPPORTUNITY_CANARY_OWNER_IDS = originalCanaryOwners
    }
    restore('OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED', originalWorkspace)
    restore('OPPORTUNITY_WORKFLOW_V1_ENABLED', originalWorkflow)
  })

  it('shows the four Morning Brief counters and evidence-first empty state', async () => {
    render(await OpportunitiesPage({ searchParams: Promise.resolve({}) }))

    expect(screen.getByRole('heading', { name: 'Сегодня' })).toBeInTheDocument()
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

  it('loads outcomes UI for the configured canary owner with global flags false', async () => {
    process.env.OPPORTUNITY_ENGINE_V1_ENABLED = 'false'
    process.env.OPPORTUNITY_OUTCOMES_ENABLED = 'false'
    process.env.OPPORTUNITY_OUTCOMES_UI_ENABLED = 'false'
    process.env.OPPORTUNITY_CANARY_OWNER_IDS = '7'

    render(await OpportunitiesPage({ searchParams: Promise.resolve({}) }))

    expect(getOpportunityOutcomeOperationalSummary).toHaveBeenCalledWith(
      '7',
      undefined,
      null,
    )
    expect(listOpportunities).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: '7',
    }))
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

  it('loads the Phase 7 Today queue and tenant-scoped assignees for Phase 10', async () => {
    process.env.OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED = 'true'
    process.env.OPPORTUNITY_WORKFLOW_V1_ENABLED = 'true'
    jest.mocked(getSession).mockResolvedValueOnce({
      mode: 'auth_v2',
      userId: '42',
      dataOwnerId: '7',
      workspaceId: '9',
      role: 'recruiter',
      session: null,
    })
    jest.mocked(listOpportunityWorkflowAssignees).mockResolvedValue([
      { userId: '42', displayName: 'Иван', role: 'recruiter' },
    ])

    render(await OpportunitiesPage({ searchParams: Promise.resolve({}) }))

    expect(listOpportunities).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: '7',
      workspaceId: '9',
      view: 'today',
      morningBriefOnly: false,
    }))
    expect(listOpportunityWorkflowAssignees).toHaveBeenCalledWith('9')
  })

  it('makes five action lanes primary and keeps search in secondary Research Mode', async () => {
    enableWorkflowSession()
    jest.mocked(getOpportunityOutcomeOperationalSummary).mockResolvedValue({
      newCount: 2,
      acceptedCount: 3,
      pipelineCount: 7,
      snoozedCount: 1,
      wonCount: 0,
      lostCount: 0,
      dismissedCount: 0,
      overdueSnoozeCount: 1,
      followUpCount: 4,
      overdueCount: 5,
    })

    render(await OpportunitiesPage({ searchParams: Promise.resolve({}) }))

    expect(screen.getByRole('heading', { name: 'Сегодня' })).toBeInTheDocument()
    const lanes = screen.getByRole('navigation', { name: 'Действия на сегодня' })
    for (const [label, value, href] of [
      ['Новые возможности', '2', '/opportunities?view=morning'],
      ['Нужно связаться', '3', '/opportunities?view=accepted'],
      ['Ожидают follow-up', '4', '/opportunities?view=follow_up'],
      ['Просрочено', '5', '/opportunities?view=overdue'],
      ['Активный pipeline', '7', '/opportunities?view=pipeline'],
    ]) {
      const link = within(lanes).getByRole('link', { name: new RegExp(label) })
      expect(link).toHaveAttribute('href', href)
      expect(within(link).getByText(value)).toBeInTheDocument()
    }

    const researchToggle = screen.getByText('Режим исследования')
    fireEvent.click(researchToggle)
    expect(screen.getByRole('searchbox', {
      name: 'Компания или возможность',
    })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Найти' })).toBeInTheDocument()
  })

  it('passes bounded Research Mode search and new lane views to the tenant repository', async () => {
    enableWorkflowSession()

    render(await OpportunitiesPage({
      searchParams: Promise.resolve({
        view: 'follow_up',
        q: `  ${'Север'.repeat(30)}  `,
        gate: 'A',
      }),
    }))

    expect(listOpportunities).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: '7',
      workspaceId: '9',
      view: 'follow_up',
      query: 'Север'.repeat(16),
      confidenceGate: 'A',
    }))
  })

  it('renders permission denied without querying opportunity data', async () => {
    jest.mocked(getAuthorizedOwnerId).mockResolvedValue(null)

    render(await OpportunitiesPage({ searchParams: Promise.resolve({}) }))

    expect(screen.getByText('Нет доступа к возможностям')).toBeInTheDocument()
    expect(listOpportunities).not.toHaveBeenCalled()
    expect(getOpportunityOutcomeOperationalSummary).not.toHaveBeenCalled()
  })

  it('distinguishes a narrowed no-data result from an empty workspace', async () => {
    enableWorkflowSession()

    render(await OpportunitiesPage({
      searchParams: Promise.resolve({ view: 'overdue' }),
    }))

    expect(screen.getByText(
      'В выбранной очереди пока нет возможностей.',
    )).toBeInTheDocument()
    expect(screen.queryByText(
      /Радар пока не обнаружил достаточно подтверждённых/,
    )).toBeNull()
  })
})

function enableWorkflowSession() {
  process.env.OPPORTUNITY_WORKSPACE_CONTEXT_ENABLED = 'true'
  process.env.OPPORTUNITY_WORKFLOW_V1_ENABLED = 'true'
  jest.mocked(getSession).mockResolvedValueOnce({
    mode: 'auth_v2',
    userId: '42',
    dataOwnerId: '7',
    workspaceId: '9',
    role: 'recruiter',
    session: null,
  })
}

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
