/** @jest-environment jsdom */

import { render, screen } from '@testing-library/react'

import { OpportunityFunnel } from '@/app/opportunities/opportunity-funnel'

describe('OpportunityFunnel', () => {
  it('shows absolute counts and does not overstate a small sample', () => {
    render(<OpportunityFunnel summary={{
      period: {
        from: '2026-07-01T00:00:00.000Z',
        to: '2026-07-27T00:00:00.000Z',
      },
      minimumConversionSample: 10,
      stages: [
        { eventType: 'shown', label: 'Показано', count: 4 },
        { eventType: 'opened', label: 'Открыто', count: 3 },
      ],
      conversions: [{
        from: 'shown',
        to: 'opened',
        sampleSize: 4,
        converted: 3,
        rate: null,
        medianHours: null,
        status: 'insufficient_data',
      }],
    }} />)

    expect(screen.getByText('Показано')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('Недостаточно данных')).toBeInTheDocument()
    expect(screen.queryByText('75%')).toBeNull()
  })
})
