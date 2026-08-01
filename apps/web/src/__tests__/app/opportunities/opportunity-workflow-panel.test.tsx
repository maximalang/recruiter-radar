/** @jest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { OpportunityWorkflowPanel } from '@/app/opportunities/opportunity-workflow-panel'

const refresh = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}))

const ASSIGNEES = [
  { userId: '7', displayName: 'Мария', role: 'owner' as const },
  { userId: '42', displayName: 'Иван', role: 'recruiter' as const },
  { userId: '81', displayName: 'Анна', role: 'recruiter' as const },
]
const WORKFLOW = {
  assignedToUserId: '42',
  nextActionType: 'follow_up' as const,
  nextActionDueAt: '2026-08-02 06:30:00+00',
  workflowPriority: 'high' as const,
  internalNote: 'Проверить доказательства перед следующим шагом.',
  lastEventId: '81',
  updatedAt: '2026-08-01T12:00:00.000Z',
}

describe('OpportunityWorkflowPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('gives viewers a readable plan without mutation controls', () => {
    render(<OpportunityWorkflowPanel
      opportunityId="10"
      workflow={WORKFLOW}
      assignees={ASSIGNEES}
      actorUserId="90"
      actorRole="viewer"
    />)

    expect(screen.getByText('Проверить доказательства перед следующим шагом.'))
      .toBeInTheDocument()
    expect(screen.getByText('Иван')).toBeInTheDocument()
    expect(screen.queryByText('Изменить рабочий план')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Сохранить план' })).toBeNull()
  })

  it('lets an unassigned recruiter claim the opportunity for themself', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        state: { ...WORKFLOW, assignedToUserId: '42' },
      }),
    }) as jest.Mock
    render(<OpportunityWorkflowPanel
      opportunityId="10"
      workflow={null}
      assignees={ASSIGNEES}
      actorUserId="42"
      actorRole="recruiter"
    />)

    fireEvent.click(screen.getByText('Изменить рабочий план'))
    expect(screen.queryByRole('option', { name: 'Анна' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Взять в работу' }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/opportunities/10/workflow',
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({
          'Idempotency-Key': expect.any(String),
        }),
        body: JSON.stringify({ assignedToUserId: '42' }),
      }),
    ))
    expect(await screen.findByRole('status')).toHaveTextContent('План сохранён')
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('submits only changed workflow fields and announces server validation', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'workflow_note_personal_contact' }),
    }) as jest.Mock
    render(<OpportunityWorkflowPanel
      opportunityId="10"
      workflow={WORKFLOW}
      assignees={ASSIGNEES}
      actorUserId="7"
      actorRole="owner"
    />)

    fireEvent.click(screen.getByText('Изменить рабочий план'))
    fireEvent.change(screen.getByLabelText('Внутренняя заметка'), {
      target: { value: 'Написать recruiter@example.ru' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить план' }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))
    const init = jest.mocked(global.fetch).mock.calls[0]?.[1]
    expect(JSON.parse(String(init?.body))).toEqual({
      internalNote: 'Написать recruiter@example.ru',
    })
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Не добавляйте личные email или телефоны',
    )
    expect(refresh).not.toHaveBeenCalled()
  })

  it('prevents a recruiter from editing a teammate assignment', () => {
    render(<OpportunityWorkflowPanel
      opportunityId="10"
      workflow={{ ...WORKFLOW, assignedToUserId: '81' }}
      assignees={ASSIGNEES}
      actorUserId="42"
      actorRole="recruiter"
    />)

    expect(screen.getByText('Анна')).toBeInTheDocument()
    expect(screen.queryByText('Изменить рабочий план')).toBeNull()
  })
})
