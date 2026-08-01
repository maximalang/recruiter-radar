/** @jest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import {
  OpportunityOutcomeImpression,
  OpportunityOutcomePanel,
} from '@/app/opportunities/opportunity-outcome-panel'

const refresh = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}))

describe('opportunity outcome UI tracking', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('records shown once for the same mounted brief cycle', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as jest.Mock
    const view = render(
      <OpportunityOutcomeImpression opportunityId="10" cycleId="brief:2026-07-27" />,
    )
    view.rerender(
      <OpportunityOutcomeImpression opportunityId="10" cycleId="brief:2026-07-27" />,
    )

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/opportunities/10/outcomes',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"eventType":"shown"'),
      }),
    )
  })

  it('records opened once per panel interaction and renders safe history', async () => {
    global.fetch = jest.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method === 'POST') return { ok: true, json: async () => ({}) }
      return {
        ok: true,
        json: async () => ({
          state: {
            currentStage: 'accepted',
            lastEventAt: '2026-07-27T10:00:00.000Z',
            dealValueMinor: null,
            currency: null,
          },
          events: [{
            eventType: 'accepted',
            label: 'Взято в работу',
            occurredAt: '2026-07-27T10:00:00.000Z',
            actorType: 'user',
            reason: null,
            channel: null,
            valueMinor: null,
            currency: null,
            metadata: {},
          }],
        }),
      }
    }) as jest.Mock
    render(
      <OpportunityOutcomePanel opportunityId="10" fallbackStage="accepted" />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Коммерческий статус' }))
    expect(await screen.findByText('Взято в работу')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Свернуть' }))
    fireEvent.click(screen.getByRole('button', { name: 'Коммерческий статус' }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(3))

    const openedCalls = jest.mocked(global.fetch).mock.calls.filter(([, options]) =>
      String(options?.body).includes('"eventType":"opened"'),
    )
    expect(openedCalls).toHaveLength(1)
  })

  it('requires a channel and safe contact path for contacted', async () => {
    global.fetch = jest.fn(async (url: string, options?: RequestInit) => {
      if (String(url).endsWith('/outcomes') && options?.method !== 'POST') {
        return {
          ok: true,
          json: async () => ({ state: { currentStage: 'accepted' }, events: [] }),
        }
      }
      return { ok: true, json: async () => ({}) }
    }) as jest.Mock
    render(
      <OpportunityOutcomePanel opportunityId="10" fallbackStage="accepted" />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Коммерческий статус' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Связались' }))
    fireEvent.change(screen.getByLabelText('Канал обращения'), {
      target: { value: 'email' },
    })
    fireEvent.change(screen.getByLabelText('Безопасный путь контакта'), {
      target: { value: 'corporate_email' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/opportunities/10/outcomes',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"eventType":"contacted"'),
      }),
    ))
    expect(jest.mocked(global.fetch).mock.calls.some(([, options]) =>
      String(options?.body).includes('"channel":"email"'),
    )).toBe(true)
    expect(jest.mocked(global.fetch).mock.calls.some(([, options]) =>
      String(options?.body).includes('"contactPathType":"corporate_email"'),
    )).toBe(true)
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(4)
      expect(refresh).toHaveBeenCalled()
    })
  })

  it('retries the same canonical command without changing its payload', async () => {
    let acceptedAttempts = 0
    global.fetch = jest.fn(async (url: string, options?: RequestInit) => {
      const body = String(options?.body ?? '')
      if (body.includes('"eventType":"accepted"')) {
        acceptedAttempts += 1
        return { ok: acceptedAttempts > 1, json: async () => (
          acceptedAttempts > 1 ? {} : { error: 'temporary_failure' }
        ) }
      }
      if (String(url).endsWith('/outcomes') && options?.method !== 'POST') {
        return {
          ok: true,
          json: async () => ({
            state: { currentStage: 'new', workflowState: 'active' },
            events: [],
          }),
        }
      }
      return { ok: true, json: async () => ({}) }
    }) as jest.Mock
    render(<OpportunityOutcomePanel opportunityId="10" fallbackStage="new" />)

    fireEvent.click(screen.getByRole('button', { name: 'Коммерческий статус' }))
    const accepted = await screen.findByRole('button', { name: 'В работу' })
    await waitFor(() => expect(accepted).toBeEnabled())
    fireEvent.click(accepted)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(
      'Результат не сохранился',
    ))
    fireEvent.click(screen.getByRole('button', { name: 'В работу' }))

    await waitFor(() => expect(acceptedAttempts).toBe(2))
    const acceptedBodies = jest.mocked(global.fetch).mock.calls
      .map(([, options]) => String(options?.body ?? ''))
      .filter((body) => body.includes('"eventType":"accepted"'))
    expect(acceptedBodies).toHaveLength(2)
    expect(acceptedBodies[1]).toBe(acceptedBodies[0])
  })

  it('uses the server correction target and removes correction after revert', async () => {
    let reverted = false
    global.fetch = jest.fn(async (_url: string, options?: RequestInit) => {
      const body = String(options?.body ?? '')
      if (options?.method === 'POST') {
        if (body.includes('"eventType":"reverted"')) reverted = true
        return { ok: true, json: async () => ({}) }
      }
      return {
        ok: true,
        json: async () => ({
          state: {
            currentStage: reverted ? 'proposal' : 'won',
            commercialStage: reverted ? 'proposal' : 'won',
            workflowState: 'active',
          },
          correction: reverted
            ? {
                canRevert: false,
                targetEventId: null,
                targetEventType: null,
                targetOccurredAt: null,
              }
            : {
                canRevert: true,
                targetEventId: '75',
                targetEventType: 'won',
                targetOccurredAt: '2026-07-27T12:00:00.000Z',
              },
          pagination: {
            pageSize: 50,
            totalItems: reverted ? 2 : 1,
            sortOrder: 'append_desc',
            hasMore: false,
            nextBeforeEventId: null,
          },
          events: reverted
            ? [
                {
                  eventType: 'reverted',
                  label: 'Исправление',
                  occurredAt: '2026-07-27T12:05:00.000Z',
                  recordedAt: '2026-07-27T12:05:01.000Z',
                  appendOrder: '76',
                  actorType: 'user',
                  reason: null,
                  channel: null,
                  contactPathType: null,
                  contactReferenceLabel: null,
                  valueMinor: null,
                  currency: null,
                  metadata: {},
                  revertsEventId: '75',
                  isEffective: true,
                  isReverted: false,
                  revertedByEventId: null,
                },
                {
                  eventType: 'won',
                  label: 'Выиграно',
                  occurredAt: '2026-07-27T12:00:00.000Z',
                  recordedAt: '2026-07-27T12:00:01.000Z',
                  appendOrder: '75',
                  actorType: 'user',
                  reason: null,
                  channel: null,
                  contactPathType: null,
                  contactReferenceLabel: null,
                  valueMinor: null,
                  currency: null,
                  metadata: {},
                  revertsEventId: null,
                  isEffective: false,
                  isReverted: true,
                  revertedByEventId: '76',
                },
              ]
            : [],
        }),
      }
    }) as jest.Mock
    render(<OpportunityOutcomePanel opportunityId="10" fallbackStage="won" />)

    fireEvent.click(screen.getByRole('button', { name: 'Коммерческий статус' }))
    fireEvent.click(await screen.findByRole('button', {
      name: 'Отменить последнее изменение',
    }))

    await waitFor(() => {
      expect(jest.mocked(global.fetch).mock.calls.some(([, options]) =>
        String(options?.body).includes('"revertsEventId":"75"'),
      )).toBe(true)
      expect(screen.queryByRole('button', {
        name: 'Отменить последнее изменение',
      })).not.toBeInTheDocument()
    })
    expect(await screen.findByText('Отменено')).toBeInTheDocument()
    expect(screen.getByText('Исправление')).toBeInTheDocument()
  })

  it('loads earlier append-cursor pages without duplicate events', async () => {
    global.fetch = jest.fn(async (url: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        return { ok: true, json: async () => ({}) }
      }
      const earlier = String(url).includes('beforeEventId=75')
      return {
        ok: true,
        json: async () => ({
          state: { currentStage: 'accepted', workflowState: 'active' },
          correction: {
            canRevert: false,
            targetEventId: null,
            targetEventType: null,
            targetOccurredAt: null,
          },
          pagination: {
            pageSize: 50,
            totalItems: 75,
            sortOrder: 'append_desc',
            hasMore: !earlier,
            nextBeforeEventId: earlier ? null : '75',
          },
          events: [{
            eventType: earlier ? 'shown' : 'accepted',
            label: earlier ? 'Показано' : 'Взято в работу',
            occurredAt: earlier
              ? '2026-07-01T10:00:00.000Z'
              : '2026-07-27T10:00:00.000Z',
            recordedAt: earlier
              ? '2026-07-01T10:00:01.000Z'
              : '2026-07-27T10:00:01.000Z',
            appendOrder: earlier ? '25' : '75',
            actorType: 'user',
            reason: null,
            channel: null,
            contactPathType: null,
            contactReferenceLabel: null,
            valueMinor: null,
            currency: null,
            metadata: {},
            revertsEventId: null,
            isEffective: true,
            isReverted: false,
            revertedByEventId: null,
          }],
        }),
      }
    }) as jest.Mock
    render(<OpportunityOutcomePanel opportunityId="10" fallbackStage="accepted" />)

    fireEvent.click(screen.getByRole('button', { name: 'Коммерческий статус' }))
    fireEvent.click(await screen.findByRole('button', {
      name: 'Показать более ранние события',
    }))

    expect(await screen.findByText('Показано')).toBeInTheDocument()
    expect(screen.getAllByText('Взято в работу')).toHaveLength(1)
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/opportunities/10/outcomes?beforeEventId=75&pageSize=50',
      { cache: 'no-store' },
    )
  })
})
