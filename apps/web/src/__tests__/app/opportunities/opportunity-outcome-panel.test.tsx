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
      '/api/opportunities/10/action',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"channel":"email"'),
      }),
    ))
    expect(jest.mocked(global.fetch).mock.calls.some(([, options]) =>
      String(options?.body).includes('"contactPathType":"corporate_email"'),
    )).toBe(true)
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(4)
      expect(refresh).toHaveBeenCalled()
    })
  })
})
